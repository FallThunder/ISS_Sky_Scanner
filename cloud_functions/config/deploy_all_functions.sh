#!/bin/bash

# Master deployment script for all ISS Sky Scanner Cloud Functions.
#
# Runs the shared project setup (APIs, IAM, Firestore indexes) once, then
# deploys the functions in parallel in two waves: internal APIs first, then
# the functions that call them, so post-deploy tests hit updated
# dependencies. Per-function output goes to /tmp/deploy_<function>.log.
#
# Usage:
#   ./deploy_all_functions.sh                 # everything
#   ./deploy_all_functions.sh iss_api_bff_web iss_api_bff_esp   # a subset
#
# Can be run in the background with: nohup ./deploy_all_functions.sh > deploy.log 2>&1 &

set -e

# Get the script directory and project root
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
FUNCTIONS_DIR="$SCRIPT_DIR/.."

# Load common configuration
CONFIG_FILE="$SCRIPT_DIR/deployment_config.sh"
if [ ! -f "$CONFIG_FILE" ]; then
    echo "❌ Error: Configuration file not found at $CONFIG_FILE"
    exit 1
fi
source "$CONFIG_FILE"

# Check prerequisites once up front instead of failing every function
if ! command -v gcloud &> /dev/null; then
    echo "❌ Error: gcloud CLI is not installed"
    echo "Install it with: brew install --cask gcloud-cli"
    echo "Then run: gcloud auth login && gcloud config set project $PROJECT_ID"
    exit 1
fi
if ! command -v jq &> /dev/null; then
    echo "❌ Error: jq is not installed (brew install jq)"
    exit 1
fi
if [ -z "$(gcloud auth list --filter=status:ACTIVE --format='value(account)' 2>/dev/null)" ]; then
    echo "❌ Error: Not authenticated with gcloud"
    echo "Run: gcloud auth login && gcloud config set project $PROJECT_ID"
    exit 1
fi

# Wave 1: functions that only call external APIs / Firestore.
WAVE_1=(
    "iss_api_get_realtime_loc"
    "iss_api_query_loc_history"
    "iss_api_query_time_range"
    "iss_api_get_loc_fact"
    "iss_api_generate_predictions"
    "iss_api_store_feedback"
)
# Wave 2: functions that call wave 1 functions.
WAVE_2=(
    "iss_api_store_realtime_loc"
    "iss_api_bff_web"
    "iss_api_bff_web_predictions"
    "iss_api_bff_esp"
    "iss_api_query_assistant"
)

# Optional subset from the command line (keeps wave order)
if [ $# -gt 0 ]; then
    filter_wave() {
        local fn requested
        for fn in "$@"; do
            for requested in "${REQUESTED[@]}"; do
                if [ "$fn" = "$requested" ]; then echo "$fn"; fi
            done
        done
    }
    REQUESTED=("$@")
    for requested in "${REQUESTED[@]}"; do
        if [ ! -d "$FUNCTIONS_DIR/$requested" ]; then
            echo "❌ Unknown function: $requested"
            exit 1
        fi
    done
    WAVE_1=($(filter_wave "${WAVE_1[@]}"))
    WAVE_2=($(filter_wave "${WAVE_2[@]}"))
fi

SUCCESS=()
TESTS_FAILED=()
FAILED=()
START_TIME=$(date +%s)

echo "=========================================="
echo "ISS Sky Scanner - Parallel Deployment"
echo "=========================================="
echo "Project: $PROJECT_ID"
echo "Region: $REGION"
echo "Functions to deploy: $(( ${#WAVE_1[@]} + ${#WAVE_2[@]} ))"
echo "Start time: $(date)"
echo "=========================================="
echo ""

# Project-wide setup, once, serially
"$SCRIPT_DIR/setup_project.sh"
echo ""

# Deploys one wave in parallel and waits for all of it.
deploy_wave() {
    local wave_name="$1"
    shift
    local names=() pids=() func i

    [ $# -eq 0 ] && return 0
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo "$wave_name: $*"
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

    for func in "$@"; do
        (
            cd "$FUNCTIONS_DIR/$func"
            chmod +x deploy.sh
            SKIP_PROJECT_SETUP=true ./deploy.sh
        ) > "/tmp/deploy_${func}.log" 2>&1 &
        names+=("$func")
        pids+=("$!")
        echo "   ⏳ $func started ($(date '+%H:%M:%S'))"
    done

    for i in "${!pids[@]}"; do
        func="${names[$i]}"
        if wait "${pids[$i]}"; then
            SUCCESS+=("$func")
            echo "   ✅ $func deployed and tested ($(date '+%H:%M:%S'))"
        elif grep -q "Function deployed successfully" "/tmp/deploy_${func}.log"; then
            # deploy.sh runs test_function.sh after deploying; a test failure
            # means the new code is live but misbehaving
            TESTS_FAILED+=("$func")
            echo "   ⚠️  $func deployed, but post-deploy tests failed ($(date '+%H:%M:%S'))"
        else
            FAILED+=("$func")
            echo "   ❌ $func deployment failed ($(date '+%H:%M:%S'))"
            echo "      Last 5 lines of /tmp/deploy_${func}.log:"
            tail -5 "/tmp/deploy_${func}.log" | sed 's/^/      /'
        fi
    done
    echo ""
}

deploy_wave "Wave 1 (internal APIs)" "${WAVE_1[@]}"
deploy_wave "Wave 2 (callers)" "${WAVE_2[@]}"

END_TIME=$(date +%s)
DURATION=$((END_TIME - START_TIME))

echo "=========================================="
echo "Deployment Summary"
echo "=========================================="
echo "Total duration: $((DURATION / 60))m $((DURATION % 60))s"
echo "End time: $(date)"
echo ""
echo "✅ Deployed and tested: ${#SUCCESS[@]}"
for func in "${SUCCESS[@]}"; do
    echo "   ✓ $func"
done

if [ ${#TESTS_FAILED[@]} -gt 0 ]; then
    echo ""
    echo "⚠️  Deployed, tests failed: ${#TESTS_FAILED[@]}"
    for func in "${TESTS_FAILED[@]}"; do
        echo "   ! $func"
    done
fi

if [ ${#FAILED[@]} -gt 0 ]; then
    echo ""
    echo "❌ Failed to deploy: ${#FAILED[@]}"
    for func in "${FAILED[@]}"; do
        echo "   ✗ $func"
    done
fi

echo ""
echo "Log files: /tmp/deploy_<function_name>.log"

if [ ${#FAILED[@]} -gt 0 ] || [ ${#TESTS_FAILED[@]} -gt 0 ]; then
    exit 1
fi
