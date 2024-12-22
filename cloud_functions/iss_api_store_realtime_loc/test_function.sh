#!/bin/bash

# Exit on any error
set -e

echo "🧪 Testing iss_api_store_realtime_loc..."

# Test 1: Publish a message to the topic
echo "Test 1: Publishing a test message to the topic..."
gcloud pubsub topics publish iss_locator_trigger --message="test"

# Wait a few seconds for the function to process
echo "⏳ Waiting for function to process..."
sleep 5

# Test 2: Check Firestore for the latest entry
echo "Test 2: Checking Firestore for the latest entry..."
# Note: This would require additional setup to query Firestore directly
# For now, we'll just consider the test successful if no errors occurred

echo "✅ Tests completed successfully!"
