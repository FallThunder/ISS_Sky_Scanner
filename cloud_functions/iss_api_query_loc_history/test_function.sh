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
FUNCTION_NAME="iss_api_query_loc_history"

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

# Get authentication token
echo "🔑 Getting authentication token..."
AUTH_TOKEN=$(gcloud auth print-identity-token)

# Helper function for making authenticated requests
make_request() {
    local endpoint=$1
    local expected_status=$2
    local test_name=$3
    
    echo -e "\n${YELLOW}Test: $test_name${NC}"
    echo "📡 Making request to: $endpoint"
    
    RESPONSE=$(curl -s -w "\n%{http_code}" -H "Authorization: Bearer $AUTH_TOKEN" "$endpoint")
    HTTP_CODE=$(echo "$RESPONSE" | tail -n 1)
    BODY=$(echo "$RESPONSE" | sed '$d')
    
    if [ "$HTTP_CODE" -eq "$expected_status" ]; then
        echo -e "${GREEN}✅ Received expected HTTP $expected_status${NC}"
        echo "Response:"
        echo "$BODY" | jq '.'
        return 0
    else
        echo -e "${RED}❌ Expected HTTP $expected_status but got $HTTP_CODE${NC}"
        echo "Response:"
        echo "$BODY" | jq '.'
        return 1
    fi
}

# Test 1: Verify unauthenticated access is blocked
echo -e "\n${YELLOW}Test 1: Verifying unauthenticated access is blocked...${NC}"
RESPONSE=$(curl -s -w "\n%{http_code}" "$FUNCTION_URL")
HTTP_CODE=$(echo "$RESPONSE" | tail -n 1)
if [ "$HTTP_CODE" -eq 403 ] || [ "$HTTP_CODE" -eq 401 ]; then
    echo -e "${GREEN}✅ Unauthenticated access correctly blocked${NC}"
else
    echo -e "${RED}❌ Unexpected status code: $HTTP_CODE${NC}"
    exit 1
fi

# Test 2: Get latest location (default behavior)
make_request "$FUNCTION_URL" 200 "Get latest location (default behavior)"

# Test 3: Query with country code
make_request "$FUNCTION_URL?country_code=US&limit=5" 200 "Query locations in US"

# Test 4: Query with time range
START_TIME=$(date -u -v-1d +"%Y-%m-%dT%H:%M:%SZ")  # 24 hours ago
END_TIME=$(date -u +"%Y-%m-%dT%H:%M:%SZ")  # now
make_request "$FUNCTION_URL?start_time=$START_TIME&end_time=$END_TIME&limit=5" 200 "Query last 24 hours"

# Test 5: Query with latitude/longitude range
make_request "$FUNCTION_URL?latitude_range=30,50&longitude_range=-100,-80&limit=5" 200 "Query specific geo region"

# Test 6: Test invalid parameters
make_request "$FUNCTION_URL?latitude_range=invalid" 400 "Test invalid latitude range"
make_request "$FUNCTION_URL?order_by=invalid_field" 400 "Test invalid order_by field"

# Test 7: Test ordering
make_request "$FUNCTION_URL?order_by=latitude&order_direction=ASCENDING&limit=5" 200 "Test ordering by latitude"

echo -e "\n${GREEN}✅ All tests completed!${NC}"
