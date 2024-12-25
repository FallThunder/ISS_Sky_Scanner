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
FUNCTION_NAME="iss_api_store_feedback"

# Colors for output
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Get the function URL
FUNCTION_URL=$(gcloud functions describe $FUNCTION_NAME --region=$REGION --format='get(serviceConfig.uri)')
if [ -z "$FUNCTION_URL" ]; then
    echo -e "${RED}❌ Error: Could not get function URL${NC}"
    exit 1
fi

# Get API key from Secret Manager
API_KEY=$(gcloud secrets versions access latest --secret="iss-feedback-api-key")
if [ -z "$API_KEY" ]; then
    echo -e "${RED}❌ Error: Could not get API key from Secret Manager${NC}"
    exit 1
fi

echo "🧪 Testing $FUNCTION_NAME..."
echo "📍 Function URL: ${FUNCTION_URL}"
echo "Using API key: '${API_KEY}'"

# Test 1: No API key
echo -e "\n${YELLOW}Test 1: No API key${NC}"
echo "📡 Making request..."
RESPONSE=$(curl -s -X POST "${FUNCTION_URL}" \
    -H "Content-Type: application/json" \
    -d '{
        "rating": 5,
        "feedback": "Test feedback message",
        "userAgent": "Test Script"
    }')
echo "Response: ${RESPONSE}"
if [[ $RESPONSE == *"error"* ]]; then
    echo -e "${GREEN}✅ Test 1 passed: Request without API key was rejected${NC}"
else
    echo -e "${RED}❌ Test 1 failed: Request without API key was accepted${NC}"
fi

# Test 2: Invalid API key
echo -e "\n${YELLOW}Test 2: Invalid API key${NC}"
echo "📡 Making request..."
RESPONSE=$(curl -s -X POST "${FUNCTION_URL}?api_key=invalid_key" \
    -H "Content-Type: application/json" \
    -d '{
        "rating": 5,
        "feedback": "Test feedback message",
        "userAgent": "Test Script"
    }')
echo "Response: ${RESPONSE}"
if [[ $RESPONSE == *"error"* ]]; then
    echo -e "${GREEN}✅ Test 2 passed: Request with invalid API key was rejected${NC}"
else
    echo -e "${RED}❌ Test 2 failed: Request with invalid API key was accepted${NC}"
fi

# Test 3: Valid feedback submission
echo -e "\n${YELLOW}Test 3: Valid feedback submission${NC}"
echo "📡 Making request..."
RESPONSE=$(curl -s -X POST "${FUNCTION_URL}?api_key=${API_KEY}" \
    -H "Content-Type: application/json" \
    -d '{
        "rating": 5,
        "feedback": "Test feedback message",
        "userAgent": "Test Script"
    }')
echo "Response: ${RESPONSE}"
if [[ $RESPONSE == *"success"* ]]; then
    echo -e "${GREEN}✅ Test 3 passed: Valid feedback was accepted${NC}"
else
    echo -e "${RED}❌ Test 3 failed: Valid feedback was rejected${NC}"
fi

# Test 4: Invalid rating
echo -e "\n${YELLOW}Test 4: Invalid rating${NC}"
echo "📡 Making request..."
RESPONSE=$(curl -s -X POST "${FUNCTION_URL}?api_key=${API_KEY}" \
    -H "Content-Type: application/json" \
    -d '{
        "rating": 6,
        "feedback": "Test feedback",
        "userAgent": "Test Script"
    }')
echo "Response: ${RESPONSE}"
if [[ $RESPONSE == *"error"* ]]; then
    echo -e "${GREEN}✅ Test 4 passed: Invalid rating was rejected${NC}"
else
    echo -e "${RED}❌ Test 4 failed: Invalid rating was accepted${NC}"
fi

# Test 5: Too long feedback
echo -e "\n${YELLOW}Test 5: Too long feedback${NC}"
echo "📡 Making request..."
RESPONSE=$(curl -s -X POST "${FUNCTION_URL}?api_key=${API_KEY}" \
    -H "Content-Type: application/json" \
    -d "{
        \"rating\": 4,
        \"feedback\": \"$(python3 -c 'print("test " * 101)')\",
        \"userAgent\": \"Test Script\"
    }")
echo "Response: ${RESPONSE}"
if [[ $RESPONSE == *"error"* ]]; then
    echo -e "${GREEN}✅ Test 5 passed: Too long feedback was rejected${NC}"
else
    echo -e "${RED}❌ Test 5 failed: Too long feedback was accepted${NC}"
fi

# Test 6: Missing required field
echo -e "\n${YELLOW}Test 6: Missing required field${NC}"
echo "📡 Making request..."
RESPONSE=$(curl -s -X POST "${FUNCTION_URL}?api_key=${API_KEY}" \
    -H "Content-Type: application/json" \
    -d '{
        "rating": 5,
        "userAgent": "Test Script"
    }')
echo "Response: ${RESPONSE}"
if [[ $RESPONSE == *"error"* ]]; then
    echo -e "${GREEN}✅ Test 6 passed: Missing field was rejected${NC}"
else
    echo -e "${RED}❌ Test 6 failed: Missing field was accepted${NC}"
fi

# Test 7: CORS headers
echo -e "\n${YELLOW}Test 7: CORS headers${NC}"
echo "📡 Making request..."
RESPONSE=$(curl -s -X OPTIONS "${FUNCTION_URL}" \
    -H "Origin: http://localhost:8080" \
    -H "Access-Control-Request-Method: POST" \
    -H "Access-Control-Request-Headers: Content-Type" \
    -v 2>&1)
if [[ $RESPONSE == *"Access-Control-Allow-Origin: *"* ]]; then
    echo -e "${GREEN}✅ Test 7 passed: CORS headers are correctly set${NC}"
else
    echo -e "${RED}❌ Test 7 failed: CORS headers are missing${NC}"
fi
