import functions_framework
from flask import jsonify
import logging
from utils import store_iss_location
from collections import OrderedDict
import base64
import json

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

@functions_framework.cloud_event
def iss_api_store_realtime_loc(cloud_event):
    """
    Cloud Function triggered by Pub/Sub that fetches current ISS location and stores it in Firestore.
    This function is triggered every 5 minutes by Cloud Scheduler via Pub/Sub.
    
    Args:
        cloud_event (CloudEvent): The cloud event object containing the Pub/Sub message
    Returns:
        dict: A dictionary containing the status of the operation
    """
    try:
        logger.info("Function triggered by Pub/Sub")
        logger.info(f"Cloud Event Type: {cloud_event['type']}")
        logger.info(f"Cloud Event Subject: {cloud_event.get('subject', 'No subject')}")
        
        # Store the ISS location data
        logger.info("Calling store_iss_location...")
        result = store_iss_location()
        
        if result.get('error'):
            logger.error(f"Error storing ISS location: {result.get('error')}")
            return {'error': result.get('error')}, 500
            
        # Log success with the ISS timestamp
        logger.info(f"Successfully stored ISS location at timestamp {result['timestamp']}")
        return {'status': 'success', 'data': result}, 200

    except Exception as e:
        error_msg = f"Unexpected error in main function: {str(e)}"
        logger.error(error_msg)
        return {'error': error_msg}, 500
