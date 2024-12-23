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
FUNCTION_NAME="iss_api_bff_web"

# Print current configuration
echo "🔧 Current configuration:"
echo "Project ID: $PROJECT_ID"
echo "Region: $REGION"
echo "Runtime: $RUNTIME"
echo "Service Account Email: $SERVICE_ACCOUNT_EMAIL"

# Verify gcloud and jq are installed
command -v gcloud >/dev/null 2>&1 || { echo "❌ Error: gcloud is not installed" >&2; exit 1; }
command -v jq >/dev/null 2>&1 || { echo "❌ Error: jq is not installed" >&2; exit 1; }

# Check gcloud auth status
if ! gcloud auth list 2>/dev/null | grep -q "ACTIVE"; then
    echo "❌ Error: Not authenticated with gcloud"
    exit 1
fi

# Enable required APIs
echo "🔄 Enabling required APIs..."
for api in "${REQUIRED_APIS[@]}"; do
    gcloud services enable "$api" --project="$PROJECT_ID"
done

# Create service account if it doesn't exist
if ! gcloud iam service-accounts describe "$SERVICE_ACCOUNT_EMAIL" --project="$PROJECT_ID" >/dev/null 2>&1; then
    echo "🔑 Creating service account..."
    gcloud iam service-accounts create "$SERVICE_ACCOUNT_NAME" \
        --display-name="$SERVICE_ACCOUNT_NAME" \
        --project="$PROJECT_ID"
fi

# Grant necessary roles to the service account
echo "🔑 Granting roles to service account..."
for role in "${IAM_ROLES[@]}"; do
    gcloud projects add-iam-policy-binding "$PROJECT_ID" \
        --member="serviceAccount:$SERVICE_ACCOUNT_EMAIL" \
        --role="$role" \
        --condition=None
done

# Deploy the function
echo "🚀 Deploying function..."
gcloud functions deploy "$FUNCTION_NAME" \
    --gen2 \
    --runtime="$RUNTIME" \
    --region="$REGION" \
    --source="." \
    --entry-point="$FUNCTION_NAME" \
    --trigger-http \
    --service-account="$SERVICE_ACCOUNT_EMAIL" \
    --memory=256Mi \
    --timeout=60s \
    --min-instances=0 \
    --max-instances=1 \
    --ingress-settings=all \
    --project="$PROJECT_ID"

# Get the function URL
FUNCTION_URL=$(gcloud functions describe "$FUNCTION_NAME" \
    --gen2 \
    --region="$REGION" \
    --format='get(serviceConfig.uri)' \
    --project="$PROJECT_ID")

echo "✅ Function deployed successfully!"
echo "Function URL: $FUNCTION_URL"

# Run tests if test script exists
if [ -f "./test_function.sh" ]; then
    echo "🧪 Running tests..."
    chmod +x ./test_function.sh
    ./test_function.sh
fi
