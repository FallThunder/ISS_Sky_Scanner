#!/bin/bash

# Project Configuration
export PROJECT_ID="iss-sky-scanner-20241222"
export PROJECT_NAME="ISS-Sky-Scanner"
export PROJECT_NUMBER="768423610307"

# Regional Configuration
export REGION="us-east1"

# Runtime Configuration
export RUNTIME="python310"

# Service Account Configuration
export SERVICE_ACCOUNT_NAME="iss-tracker-service"
export SERVICE_ACCOUNT_EMAIL="${SERVICE_ACCOUNT_NAME}@${PROJECT_ID}.iam.gserviceaccount.com"

# Function Default Configuration
export MEMORY="256MB"
export TIMEOUT="30s"
export MIN_INSTANCES=0
export MAX_INSTANCES=1

# Security Configuration
export INGRESS_SETTINGS="all"           # Allow external access, use authentication for security
export ALLOW_UNAUTHENTICATED="false"    # Require authentication for all functions

# Required APIs
export REQUIRED_APIS=(
    "cloudfunctions.googleapis.com"      # Cloud Functions
    "cloudbuild.googleapis.com"          # Cloud Build
    "artifactregistry.googleapis.com"    # Artifact Registry
    "cloudscheduler.googleapis.com"      # Cloud Scheduler (for future use)
    "run.googleapis.com"                 # Cloud Run (required for 2nd gen functions)
    "compute.googleapis.com"             # Compute Engine (for service accounts)
    "eventarc.googleapis.com"            # Eventarc (required for Pub/Sub triggers)
    "pubsub.googleapis.com"              # Pub/Sub (for event triggers)
)
