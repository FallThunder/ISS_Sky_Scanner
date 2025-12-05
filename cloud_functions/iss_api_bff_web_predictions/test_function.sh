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
FUNCTION_NAME="iss_api_bff_web_predictions"

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

echo "🧪 Testing $FUNCTION_NAME..."
echo "📍 Function URL: $FUNCTION_URL"

# Get the API key from Secret Manager
API_KEY=$(gcloud secrets versions access latest --secret="iss-sky-scanner-web-api-key")
if [ -z "$API_KEY" ]; then
    echo "Error: Could not get API key"
    exit 1
fi

echo "Using API key: '$API_KEY'"

# Test 1: No API key
echo -e "\n${YELLOW}Test 1: No API key${NC}"
echo "📡 Making request..."
RESPONSE=$(curl -s -w "\n%{http_code}" "$FUNCTION_URL")
HTTP_CODE=$(echo "$RESPONSE" | tail -n 1)
BODY=$(echo "$RESPONSE" | sed '$d')

# Check HTTP status code
if [ "$HTTP_CODE" -eq 400 ]; then
    echo -e "${GREEN}✅ Test 1 passed: Request without API key was rejected${NC}"
else
    echo -e "${RED}❌ Test 1 failed: Expected 400, got $HTTP_CODE${NC}"
    echo "Response body:"
    echo "$BODY"
    exit 1
fi

# Test 2: Invalid API key
echo -e "\n${YELLOW}Test 2: Invalid API key${NC}"
echo "📡 Making request..."
RESPONSE=$(curl -s -w "\n%{http_code}" "$FUNCTION_URL?api_key=invalid_key")
HTTP_CODE=$(echo "$RESPONSE" | tail -n 1)
BODY=$(echo "$RESPONSE" | sed '$d')

# Check HTTP status code
if [ "$HTTP_CODE" -eq 403 ]; then
    echo -e "${GREEN}✅ Test 2 passed: Request with invalid API key was rejected${NC}"
else
    echo -e "${RED}❌ Test 2 failed: Expected 403, got $HTTP_CODE${NC}"
    echo "Response body:"
    echo "$BODY"
    exit 1
fi

# Test 3: Valid API key
echo -e "\n${YELLOW}Test 3: Valid API key${NC}"
echo "📡 Making request..."
RESPONSE=$(curl -s -w "\n%{http_code}" "$FUNCTION_URL?api_key=$API_KEY")
HTTP_CODE=$(echo "$RESPONSE" | tail -n 1)
BODY=$(echo "$RESPONSE" | sed '$d')

# Check HTTP status code
if [ "$HTTP_CODE" -eq 200 ]; then
    echo -e "${GREEN}✅ Test 3 passed: Request with valid API key returned correct data${NC}"
else
    echo -e "${RED}❌ Test 3 failed: Expected 200, got $HTTP_CODE${NC}"
    echo "Response body:"
    echo "$BODY"
    exit 1
fi

# Parse and validate JSON response
echo "🔍 Validating response format..."
if ! echo "$BODY" | jq empty 2>/dev/null; then
    echo -e "${RED}❌ Response is not valid JSON${NC}"
    echo "Response body:"
    echo "$BODY"
    exit 1
fi

# Check required fields
REQUIRED_FIELDS=("status" "predictions" "historical_predictions")
for field in "${REQUIRED_FIELDS[@]}"; do
    if ! echo "$BODY" | jq -e ".$field" > /dev/null 2>&1; then
        echo -e "${RED}❌ Missing required field: $field${NC}"
        echo "Response body:"
        echo "$BODY"
        exit 1
    fi
done

# Print the prediction data
echo -e "\n${GREEN}✅ Prediction Data:${NC}"
echo "$BODY" | jq '.'

# Test 4: CORS headers
echo -e "\n${YELLOW}Test 4: CORS headers${NC}"
echo "📡 Making request..."
RESPONSE=$(curl -s -w "\n%{http_code}" -X OPTIONS -H "Origin: http://localhost" "$FUNCTION_URL")
HTTP_CODE=$(echo "$RESPONSE" | tail -n 1)
HEADERS=$(curl -s -I -X OPTIONS -H "Origin: http://localhost" "$FUNCTION_URL")

if [ "$HTTP_CODE" -eq 204 ] && \
   echo "$HEADERS" | grep -i "access-control-allow-origin: *" > /dev/null && \
   echo "$HEADERS" | grep -i "access-control-allow-methods: GET" > /dev/null && \
   echo "$HEADERS" | grep -i "access-control-allow-headers: Content-Type" > /dev/null; then
    echo -e "${GREEN}✅ Test 4 passed: CORS headers are correctly set${NC}"
else
    echo -e "${RED}❌ Test 4 failed: CORS headers are incorrect${NC}"
    echo "Headers:"
    echo "$HEADERS"
    exit 1
fi

echo -e "\n${GREEN}✅ All tests passed successfully!${NC}"
