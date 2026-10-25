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

# Function-specific configuration
FUNCTION_NAME="iss_api_query_time_range"

# Print current configuration
echo "🚀 Preparing to deploy $FUNCTION_NAME..."
echo "Project: $PROJECT_ID"
echo "Region: $REGION"
echo "Runtime: $RUNTIME"
echo "Service Account: $SERVICE_ACCOUNT_EMAIL"

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

ALLOW_UNAUTH_FLAG="--allow-unauthenticated"  # This endpoint doesn't require auth

gcloud functions deploy $FUNCTION_NAME \
    --region=$REGION \
    --runtime=$RUNTIME \
    --trigger-http \
    $ALLOW_UNAUTH_FLAG \
    --service-account=$SERVICE_ACCOUNT_EMAIL \
    --memory=$MEMORY \
    --timeout=$TIMEOUT \
    --min-instances=$MIN_INSTANCES \
    --max-instances=$MAX_INSTANCES \
    --ingress-settings=$INGRESS_SETTINGS \
    --entry-point=$FUNCTION_NAME

# Check deployment status
if [ $? -eq 0 ]; then
    echo "✅ Function deployed successfully!"
    
    # Get the function URL
    FUNCTION_URL=$(gcloud functions describe $FUNCTION_NAME --region=$REGION --format='get(serviceConfig.uri)')
    echo "📍 Function URL: $FUNCTION_URL"
    
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
