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
FUNCTION_NAME="iss_api_query_assistant"

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
echo "📍 Function URL: ${FUNCTION_URL}"

# Test 1: Basic ISS location query
echo -e "\n${YELLOW}Test 1: Basic ISS location query${NC}"
echo "📡 Making request..."
RESPONSE=$(curl -s -X POST "${FUNCTION_URL}" \
    -H "Content-Type: application/json" \
    -d '{
        "query": "Where is the ISS right now?"
    }')
echo "Response: ${RESPONSE}"
if [[ $RESPONSE == *"success"* ]]; then
    echo -e "${GREEN}✅ Test 1 passed: Got valid response for location query${NC}"
else
    echo -e "${RED}❌ Test 1 failed: Invalid response for location query${NC}"
fi

# Test 2: Empty query
echo -e "\n${YELLOW}Test 2: Empty query${NC}"
echo "📡 Making request..."
RESPONSE=$(curl -s -X POST "${FUNCTION_URL}" \
    -H "Content-Type: application/json" \
    -d '{
        "query": ""
    }')
echo "Response: ${RESPONSE}"
if [[ $RESPONSE == *"error"* ]]; then
    echo -e "${GREEN}✅ Test 2 passed: Empty query was rejected${NC}"
else
    echo -e "${RED}❌ Test 2 failed: Empty query was accepted${NC}"
fi

# Test 3: Missing query field
echo -e "\n${YELLOW}Test 3: Missing query field${NC}"
echo "📡 Making request..."
RESPONSE=$(curl -s -X POST "${FUNCTION_URL}" \
    -H "Content-Type: application/json" \
    -d '{}')
echo "Response: ${RESPONSE}"
if [[ $RESPONSE == *"error"* ]]; then
    echo -e "${GREEN}✅ Test 3 passed: Missing query field was rejected${NC}"
else
    echo -e "${RED}❌ Test 3 failed: Missing query field was accepted${NC}"
fi

# Test 4: Country-specific query
echo -e "\n${YELLOW}Test 4: Country-specific query${NC}"
echo "📡 Making request..."
RESPONSE=$(curl -s -X POST "${FUNCTION_URL}" \
    -H "Content-Type: application/json" \
    -d '{
        "query": "When was the ISS last over the United States?"
    }')
echo "Response: ${RESPONSE}"
if [[ $RESPONSE == *"success"* ]]; then
    echo -e "${GREEN}✅ Test 4 passed: Got valid response for country query${NC}"
else
    echo -e "${RED}❌ Test 4 failed: Invalid response for country query${NC}"
fi

# Test 5: Non-ISS query
echo -e "\n${YELLOW}Test 5: Non-ISS query${NC}"
echo "📡 Making request..."
RESPONSE=$(curl -s -X POST "${FUNCTION_URL}" \
    -H "Content-Type: application/json" \
    -d '{
        "query": "What is the weather like today?"
    }')
echo "Response: ${RESPONSE}"
if [[ $RESPONSE == *"success"* && $RESPONSE == *"can only answer questions about the International Space Station"* ]]; then
    echo -e "${GREEN}✅ Test 5 passed: Non-ISS query was properly handled${NC}"
else
    echo -e "${RED}❌ Test 5 failed: Non-ISS query was not properly handled${NC}"
fi

# Test 6: CORS headers
echo -e "\n${YELLOW}Test 6: CORS headers${NC}"
echo "📡 Making request..."
RESPONSE=$(curl -s -X OPTIONS "${FUNCTION_URL}" \
    -H "Origin: http://localhost:8080" \
    -H "Access-Control-Request-Method: POST" \
    -H "Access-Control-Request-Headers: Content-Type" \
    -i)
echo "Response headers: ${RESPONSE}"
if [[ $RESPONSE == *"access-control-allow-origin: *"* || $RESPONSE == *"Access-Control-Allow-Origin: *"* ]]; then
    echo -e "${GREEN}✅ Test 6 passed: CORS headers are correctly set${NC}"
else
    echo -e "${RED}❌ Test 6 failed: CORS headers are missing${NC}"
    echo "Headers received:"
    echo "$RESPONSE"
fi
