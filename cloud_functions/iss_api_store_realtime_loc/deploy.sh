#!/bin/bash

# Exit on any error
set -e

# Load common configuration
CONFIG_FILE="../config/deployment_config.sh"
if [ ! -f "$CONFIG_FILE" ]; then
    echo "❌ Error: Configuration file not found at $CONFIG_FILE"
    exit 1
fi
source "$CONFIG_FILE"

# Fetches the location and then waits on prediction generation, so it
# needs longer than the default timeout.
TIMEOUT="120s"

# Function-specific configuration
FUNCTION_NAME="iss_api_store_realtime_loc"
TOPIC_NAME="iss_locator_trigger"
# Convert function name to valid Cloud Run service name (replace underscores with dashes)
SERVICE_NAME=$(echo $FUNCTION_NAME | tr '_' '-')

# Print current configuration
echo "🚀 Preparing to deploy $FUNCTION_NAME..."
echo "Project: $PROJECT_ID"
echo "Region: $REGION"
echo "Runtime: $RUNTIME"
echo "Service Account: $SERVICE_ACCOUNT_EMAIL"
echo "Trigger: Pub/Sub topic $TOPIC_NAME"

# Verify gcloud is installed
if ! command -v gcloud &> /dev/null; then
    echo "❌ Error: gcloud CLI is not installed"
    exit 1
fi

# Verify jq is installed (needed for testing)
if ! command -v jq &> /dev/null; then
    echo "❌ Error: jq is not installed"
    echo "Please install jq using: brew install jq"
    exit 1
fi

# Verify authentication
if ! gcloud auth list --filter=status:ACTIVE --format="get(account)" &> /dev/null; then
    echo "❌ Error: Not authenticated with gcloud"
    echo "Please run: gcloud auth login"
    exit 1
fi

# Project-wide setup (APIs, service account, IAM roles, Firestore indexes).
# deploy_all_functions.sh runs it once up front and sets
# SKIP_PROJECT_SETUP=true so parallel deploys don't race on the IAM policy.
if [ "$SKIP_PROJECT_SETUP" != "true" ]; then
    ../config/setup_project.sh
fi

# Deploy the function
echo "📦 Deploying function..."

# Create an event trigger for the function
echo "🔗 Creating event trigger..."
gcloud functions deploy $FUNCTION_NAME \
    --region=$REGION \
    --runtime=$RUNTIME \
    --trigger-event=google.pubsub.topic.publish \
    --trigger-resource=$TOPIC_NAME \
    --service-account=$SERVICE_ACCOUNT_EMAIL \
    --memory=$MEMORY \
    --timeout=$TIMEOUT \
    --min-instances=$MIN_INSTANCES \
    --max-instances=$MAX_INSTANCES \
    --ingress-settings=$INGRESS_SETTINGS \
    --set-env-vars=GOOGLE_CLOUD_PROJECT=$PROJECT_ID \
    --no-allow-unauthenticated

# Get the Cloud Run URL
echo "🔍 Getting Cloud Run service URL..."
CLOUD_RUN_URL=$(gcloud run services describe $SERVICE_NAME --region=$REGION --format='value(status.url)' || echo "")

# Grant invoker permission to the service account
echo "🔑 Granting invoker permission to service accounts..."
gcloud run services add-iam-policy-binding $SERVICE_NAME \
    --member="serviceAccount:$SERVICE_ACCOUNT_EMAIL" \
    --role="roles/run.invoker" \
    --region=$REGION

gcloud run services add-iam-policy-binding $SERVICE_NAME \
    --member="serviceAccount:service-${PROJECT_NUMBER}@gcp-sa-pubsub.iam.gserviceaccount.com" \
    --role="roles/run.invoker" \
    --region=$REGION

# Check deployment status
if [ $? -eq 0 ]; then
    echo "✅ Function deployed successfully!"
    if [ ! -z "$CLOUD_RUN_URL" ]; then
        echo "📍 Cloud Run URL: $CLOUD_RUN_URL"
    fi
    
    # Log success
    echo "🔄 Function will be triggered every 5 minutes by Cloud Scheduler"
    
    # Run tests
    echo ""
    echo "🧪 Running tests..."
    if [ -f "./test_function.sh" ]; then
        chmod +x ./test_function.sh
        ./test_function.sh
    else
        echo "❌ Test script not found at ./test_function.sh"
        exit 1
    fi
else
    echo "❌ Deployment failed"
    exit 1
fi
