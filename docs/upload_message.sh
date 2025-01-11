#!/bin/bash

# Exit on any error
set -e

# Set variables
MESSAGE_FILE="website_message.txt"
BUCKET_NAME="iss_sky_scanner_site_message"
BUCKET_LOCATION="us-east1"

# Check if message file exists
if [ ! -f "$MESSAGE_FILE" ]; then
    echo "Error: $MESSAGE_FILE not found"
    exit 1
fi

# Create bucket if it doesn't exist
if ! gsutil ls -b "gs://${BUCKET_NAME}" > /dev/null 2>&1; then
    echo "Creating bucket gs://${BUCKET_NAME} in ${BUCKET_LOCATION}..."
    gsutil mb -l ${BUCKET_LOCATION} "gs://${BUCKET_NAME}"
    
    # Make bucket publicly readable
    echo "Setting bucket public read access..."
    gsutil iam ch allUsers:objectViewer "gs://${BUCKET_NAME}"
    
    # Set CORS policy using existing cors.json
    if [ -f "cors.json" ]; then
        echo "Setting CORS policy..."
        gsutil cors set cors.json "gs://${BUCKET_NAME}"
    fi
fi

# Upload the message file
echo "Uploading message file to gs://${BUCKET_NAME}/${MESSAGE_FILE}..."
gsutil cp "${MESSAGE_FILE}" "gs://${BUCKET_NAME}/${MESSAGE_FILE}"

# Make the file publicly readable (redundant but ensures the file is public)
echo "Setting public read access on the file..."
gsutil acl ch -u AllUsers:R "gs://${BUCKET_NAME}/${MESSAGE_FILE}"

echo "Upload complete! Message file is available at: https://storage.googleapis.com/${BUCKET_NAME}/${MESSAGE_FILE}"
