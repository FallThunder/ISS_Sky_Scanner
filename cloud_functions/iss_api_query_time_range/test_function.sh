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

# Test 1: Default parameters (60 minutes)
echo -e "\n${YELLOW}Test 1: Testing default parameters (60 minutes)...${NC}"
echo "📡 Making request..."
RESPONSE=$(curl -s -w "\n%{http_code}" $FUNCTION_URL)
HTTP_CODE=$(echo "$RESPONSE" | tail -n 1)
BODY=$(echo "$RESPONSE" | sed '$d')

if [ "$HTTP_CODE" -eq 200 ]; then
    echo -e "${GREEN}✅ Function returned HTTP 200${NC}"
else
    echo -e "${RED}❌ Function returned HTTP $HTTP_CODE${NC}"
    echo "Response body:"
    echo "$BODY"
    exit 1
fi

# Test 2: Custom minutes parameter
echo -e "\n${YELLOW}Test 2: Testing with custom minutes parameter (30 minutes)...${NC}"
echo "📡 Making request..."
RESPONSE=$(curl -s -w "\n%{http_code}" "$FUNCTION_URL?minutes=30")
HTTP_CODE=$(echo "$RESPONSE" | tail -n 1)
BODY=$(echo "$RESPONSE" | sed '$d')

if [ "$HTTP_CODE" -eq 200 ]; then
    echo -e "${GREEN}✅ Function returned HTTP 200${NC}"
else
    echo -e "${RED}❌ Function returned HTTP $HTTP_CODE${NC}"
    echo "Response body:"
    echo "$BODY"
    exit 1
fi

# Test 3: Invalid minutes parameter
echo -e "\n${YELLOW}Test 3: Testing with invalid minutes parameter...${NC}"
echo "📡 Making request..."
RESPONSE=$(curl -s -w "\n%{http_code}" "$FUNCTION_URL?minutes=invalid")
HTTP_CODE=$(echo "$RESPONSE" | tail -n 1)
BODY=$(echo "$RESPONSE" | sed '$d')

if [ "$HTTP_CODE" -eq 400 ]; then
    echo -e "${GREEN}✅ Function correctly returned HTTP 400 for invalid input${NC}"
else
    echo -e "${RED}❌ Expected HTTP 400, got HTTP $HTTP_CODE${NC}"
    echo "Response body:"
    echo "$BODY"
    exit 1
fi

# Test 4: Exceeding maximum minutes
echo -e "\n${YELLOW}Test 4: Testing with minutes exceeding maximum (2000)...${NC}"
echo "📡 Making request..."
RESPONSE=$(curl -s -w "\n%{http_code}" "$FUNCTION_URL?minutes=2000")
HTTP_CODE=$(echo "$RESPONSE" | tail -n 1)
BODY=$(echo "$RESPONSE" | sed '$d')

if [ "$HTTP_CODE" -eq 200 ]; then
    # Verify it was capped at 1440
    MINUTES_REQUESTED=$(echo "$BODY" | jq -r '.minutes_requested')
    if [ "$MINUTES_REQUESTED" -eq 1440 ]; then
        echo -e "${GREEN}✅ Function correctly capped minutes at 1440${NC}"
    else
        echo -e "${RED}❌ Function did not cap minutes at 1440 (got $MINUTES_REQUESTED)${NC}"
        exit 1
    fi
else
    echo -e "${RED}❌ Function returned HTTP $HTTP_CODE${NC}"
    echo "Response body:"
    echo "$BODY"
    exit 1
fi

# Validate JSON response format for successful requests
echo -e "\n${YELLOW}Test 5: Validating response format...${NC}"
RESPONSE=$(curl -s "$FUNCTION_URL")

# Check if response is valid JSON
if ! echo "$RESPONSE" | jq empty 2>/dev/null; then
    echo -e "${RED}❌ Response is not valid JSON${NC}"
    echo "Response body:"
    echo "$RESPONSE"
    exit 1
fi

# Check required fields
REQUIRED_FIELDS=("locations" "count" "minutes_requested" "status")
for field in "${REQUIRED_FIELDS[@]}"; do
    if ! echo "$RESPONSE" | jq -e ".$field" > /dev/null 2>&1; then
        echo -e "${RED}❌ Missing required field: $field${NC}"
        echo "Response body:"
        echo "$RESPONSE"
        exit 1
    fi
done

echo -e "${GREEN}✅ Response format validation successful${NC}"
echo "📊 Sample response:"
echo "$RESPONSE" | jq '.'

echo -e "\n${GREEN}✅ All tests passed successfully!${NC}"
