#!/bin/bash

# Master deployment script for all ISS Sky Scanner Cloud Functions
# This script deploys all functions sequentially to avoid IAM conflicts
# Can be run in the background with: nohup ./deploy_all_functions.sh > deploy.log 2>&1 &

set -e

# Get the script directory and project root
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
FUNCTIONS_DIR="$SCRIPT_DIR/.."

# Load common configuration
CONFIG_FILE="$SCRIPT_DIR/deployment_config.sh"
if [ ! -f "$CONFIG_FILE" ]; then
    echo "❌ Error: Configuration file not found at $CONFIG_FILE"
    exit 1
fi
source "$CONFIG_FILE"

# Change to functions directory
cd "$FUNCTIONS_DIR"

# List of all functions to deploy (in dependency order)
FUNCTIONS=(
    "iss_api_get_realtime_loc"
    "iss_api_store_realtime_loc"
    "iss_api_generate_predictions"
    "iss_api_bff_web"
    "iss_api_bff_web_predictions"
    "iss_api_bff_esp"
    "iss_api_get_loc_fact"
    "iss_api_query_loc_history"
    "iss_api_query_time_range"
    "iss_api_query_assistant"
    "iss_api_store_feedback"
)

# Track results
SUCCESS=()
FAILED=()
START_TIME=$(date +%s)

echo "=========================================="
echo "ISS Sky Scanner - Master Deployment"
echo "=========================================="
echo "Project: $PROJECT_ID"
echo "Region: $REGION"
echo "Functions to deploy: ${#FUNCTIONS[@]}"
echo "Start time: $(date)"
echo "=========================================="
echo ""

# Deploy each function
for func in "${FUNCTIONS[@]}"; do
    echo ""
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo "Deploying: $func"
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo "Start: $(date '+%H:%M:%S')"
    
    if [ ! -d "$func" ]; then
        echo "⚠️  Directory not found: $func"
        FAILED+=("$func (not found)")
        continue
    fi
    
    if [ ! -f "$func/deploy.sh" ]; then
        echo "⚠️  No deploy.sh found for $func"
        FAILED+=("$func (no deploy script)")
        continue
    fi
    
    # Change to function directory and deploy
    cd "$func"
    chmod +x deploy.sh
    
    # Run deployment (suppress output but capture errors)
    if ./deploy.sh > /tmp/deploy_${func}.log 2>&1; then
        SUCCESS+=("$func")
        echo "✅ $func deployed successfully"
        echo "End: $(date '+%H:%M:%S')"
    else
        FAILED+=("$func")
        echo "❌ $func deployment failed"
        echo "End: $(date '+%H:%M:%S')"
        echo "Last 5 lines of log:"
        tail -5 /tmp/deploy_${func}.log 2>/dev/null || echo "No log available"
    fi
    
    cd "$FUNCTIONS_DIR"
    
    # Small delay to avoid IAM conflicts
    sleep 2
done

END_TIME=$(date +%s)
DURATION=$((END_TIME - START_TIME))
MINUTES=$((DURATION / 60))
SECONDS=$((DURATION % 60))

echo ""
echo "=========================================="
echo "Deployment Summary"
echo "=========================================="
echo "Total duration: ${MINUTES}m ${SECONDS}s"
echo "End time: $(date)"
echo ""
echo "✅ Successful: ${#SUCCESS[@]}"
for func in "${SUCCESS[@]}"; do
    echo "   ✓ $func"
done

if [ ${#FAILED[@]} -gt 0 ]; then
    echo ""
    echo "❌ Failed: ${#FAILED[@]}"
    for func in "${FAILED[@]}"; do
        echo "   ✗ $func"
    done
    echo ""
    echo "Log files are available at: /tmp/deploy_<function_name>.log"
    exit 1
fi

echo ""
echo "✅ All ${#SUCCESS[@]} functions deployed successfully!"
echo ""
echo "Log files are available at: /tmp/deploy_<function_name>.log"
