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
FUNCTION_NAME="iss_api_get_loc_fact"

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

# Test 1: Verify unauthenticated access is blocked
echo -e "\n${YELLOW}Test 1: Verifying unauthenticated access is blocked...${NC}"
echo "📡 Making unauthenticated request..."
RESPONSE=$(curl -s -w "\n%{http_code}" "$FUNCTION_URL?location=Paris")
HTTP_CODE=$(echo "$RESPONSE" | tail -n 1)
BODY=$(echo "$RESPONSE" | sed '$d')

if [ "$HTTP_CODE" -eq 403 ] || [ "$HTTP_CODE" -eq 401 ]; then
    echo -e "${GREEN}✅ Unauthenticated access correctly blocked with HTTP $HTTP_CODE${NC}"
else
    echo -e "${RED}❌ Unexpected status code for unauthenticated access: HTTP $HTTP_CODE${NC}"
    echo "Expected: 401 or 403"
    echo "Response body:"
    echo "$BODY"
    exit 1
fi

# Test 2: Verify authenticated access works with valid location
echo -e "\n${YELLOW}Test 2: Verifying authenticated access with valid location...${NC}"
# Get authentication token
echo "🔑 Getting authentication token..."
AUTH_TOKEN=$(gcloud auth print-identity-token)

# Make the authenticated request
echo "📡 Making authenticated request for Paris..."
RESPONSE=$(curl -s -w "\n%{http_code}" -H "Authorization: Bearer $AUTH_TOKEN" "$FUNCTION_URL?location=Paris")
HTTP_CODE=$(echo "$RESPONSE" | tail -n 1)
BODY=$(echo "$RESPONSE" | sed '$d')

# Check HTTP status code
if [ "$HTTP_CODE" -eq 200 ]; then
    echo -e "${GREEN}✅ Function returned HTTP 200${NC}"
else
    echo -e "${RED}❌ Function returned HTTP $HTTP_CODE${NC}"
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
REQUIRED_FIELDS=("location" "fact" "status")
for field in "${REQUIRED_FIELDS[@]}"; do
    if ! echo "$BODY" | jq -e ".$field" > /dev/null 2>&1; then
        echo -e "${RED}❌ Missing required field: $field${NC}"
        echo "Response body:"
        echo "$BODY"
        exit 1
    fi
done

# Print the actual fun fact
echo -e "\n${GREEN}✅ Fun fact about Paris:${NC}"
echo "$BODY" | jq -r '.fact'

# Test 3: Verify error handling for missing location
echo -e "\n${YELLOW}Test 3: Verifying error handling for missing location...${NC}"
RESPONSE=$(curl -s -w "\n%{http_code}" -H "Authorization: Bearer $AUTH_TOKEN" "$FUNCTION_URL")
HTTP_CODE=$(echo "$RESPONSE" | tail -n 1)
BODY=$(echo "$RESPONSE" | sed '$d')

if [ "$HTTP_CODE" -eq 400 ]; then
    echo -e "${GREEN}✅ Function correctly returned HTTP 400 for missing location${NC}"
else
    echo -e "${RED}❌ Unexpected status code for missing location: HTTP $HTTP_CODE${NC}"
    echo "Response body:"
    echo "$BODY"
    exit 1
fi

# Print successful response
echo -e "\n${GREEN}✅ All tests passed successfully!${NC}"
echo "📊 Complete Response for Paris:"
echo "$BODY" | jq '.'
