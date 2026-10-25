#!/bin/bash

# One-time, idempotent project setup shared by every function:
# enables APIs, ensures the service account exists, grants its IAM roles and
# creates the Firestore composite indexes the queries need.
#
# Each function's deploy.sh runs this unless SKIP_PROJECT_SETUP=true.
# deploy_all_functions.sh runs it once up front and then deploys in
# parallel; doing the project IAM edits concurrently would collide on the
# policy's etag.

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/deployment_config.sh"

echo "🔧 Project setup for $PROJECT_ID"

echo "📡 Enabling required APIs..."
gcloud services enable "${REQUIRED_APIS[@]}" --project="$PROJECT_ID"

if ! gcloud iam service-accounts describe "$SERVICE_ACCOUNT_EMAIL" --project="$PROJECT_ID" &>/dev/null; then
    echo "👤 Creating service account: $SERVICE_ACCOUNT_NAME..."
    gcloud iam service-accounts create "$SERVICE_ACCOUNT_NAME" \
        --project="$PROJECT_ID" \
        --display-name="ISS Tracker Service Account"
fi

# Roles the functions' shared service account needs (the union of what the
# individual deploy scripts used to grant):
#   datastore.user                Firestore reads/writes
#   cloudfunctions.invoker        calling the internal functions
#   secretmanager.secretAccessor  BFF and feedback API keys
#   aiplatform.user               Gemini on Vertex AI (facts and chat)
SERVICE_ACCOUNT_ROLES=(
    "roles/datastore.user"
    "roles/cloudfunctions.invoker"
    "roles/secretmanager.secretAccessor"
    "roles/aiplatform.user"
)

echo "🔑 Granting IAM roles to $SERVICE_ACCOUNT_EMAIL..."
for role in "${SERVICE_ACCOUNT_ROLES[@]}"; do
    gcloud projects add-iam-policy-binding "$PROJECT_ID" \
        --member="serviceAccount:$SERVICE_ACCOUNT_EMAIL" \
        --role="$role" \
        --condition=None \
        --quiet > /dev/null
    echo "   ✓ $role"
done

# Previously granted by iss_api_get_realtime_loc's deploy script
gcloud projects add-iam-policy-binding "$PROJECT_ID" \
    --member="serviceAccount:$PROJECT_ID@appspot.gserviceaccount.com" \
    --role="roles/cloudfunctions.serviceAgent" \
    --condition=None \
    --quiet > /dev/null
echo "   ✓ roles/cloudfunctions.serviceAgent (appspot service account)"

# Firestore composite indexes (country filter + timestamp ordering, used by
# iss_api_query_loc_history?country_code=..., e.g. from the chat assistant)
echo "🗂️  Ensuring Firestore indexes..."
for order in descending ascending; do
    output=$(gcloud firestore indexes composite create \
        --project="$PROJECT_ID" \
        --database='(default)' \
        --collection-group=iss_loc_history \
        --query-scope=collection \
        --field-config=field-path=country_code,order=ascending \
        --field-config=field-path=timestamp,order=$order \
        --async 2>&1) && echo "   ✓ country_code + timestamp $order (building)" || {
        if echo "$output" | grep -q "ALREADY_EXISTS\|already exists"; then
            echo "   ✓ country_code + timestamp $order (exists)"
        else
            echo "$output"
            exit 1
        fi
    }
done

echo "✅ Project setup complete"
