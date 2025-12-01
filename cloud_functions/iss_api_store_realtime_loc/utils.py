import requests
from typing import Dict, Any, OrderedDict
import logging
from google.cloud import firestore
from google.auth.transport.requests import Request
from google.oauth2 import id_token
import google.auth
from datetime import datetime, timezone

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Initialize Firestore client
try:
    db = firestore.Client()
    logger.info("Successfully initialized Firestore client")
except Exception as e:
    logger.error(f"Failed to initialize Firestore client: {str(e)}")
    raise

collection_name = 'iss_loc_history'

def get_id_token(target_audience: str = None) -> str:
    """
    Gets an ID token for authenticating with other Cloud Functions.
    
    Args:
        target_audience: URL of the target Cloud Function. If None, uses default.
    """
    try:
        logger.info("Getting ID token...")
        # Get credentials from the environment
        credentials, project = google.auth.default()
        logger.info(f"Got credentials for project: {project}")
        
        # Request a token with the target audience
        if target_audience is None:
            target_audience = 'https://iss-api-get-realtime-loc-cklav7ht2q-ue.a.run.app'
            auth_req = Request()
            token = id_token.fetch_id_token(auth_req, target_audience)
            logger.info("Successfully obtained ID token")
            return token
    except Exception as e:
        logger.error(f"Error getting ID token: {str(e)}")
        raise

def get_iss_location() -> Dict[str, Any]:
    """
    Calls the iss_api_get_realtime_loc function to get current ISS location.
    Returns location data if successful.
    """
    try:
        logger.info("Getting ISS location...")
        # Get authentication token
        token = get_id_token()
        
        # Make authenticated request
        headers = {
            'Authorization': f'Bearer {token}'
        }
        logger.info("Making request to iss_api_get_realtime_loc...")
        response = requests.get(
            'https://iss-api-get-realtime-loc-cklav7ht2q-ue.a.run.app',
            headers=headers,
            timeout=10
        )
        response.raise_for_status()
        location_data = response.json()
        logger.info(f"Got ISS location data: {location_data}")
        return location_data
    except Exception as e:
        logger.error(f"Error fetching ISS location: {str(e)}")
        return {'error': f'Failed to fetch ISS location: {str(e)}'}

def store_iss_location() -> Dict[str, Any]:
    """
    Fetches current ISS location and stores it in Firestore.
    Returns:
        Dictionary containing the stored data or error message
    """
    try:
        logger.info("Starting store_iss_location...")
        # Get ISS location
        location_data = get_iss_location()
        if location_data.get('error'):
            logger.error(f"Error in get_iss_location: {location_data['error']}")
            return location_data

        logger.info("Preparing document data...")
        # Convert Unix timestamp to ISO format
        iso_timestamp = datetime.fromtimestamp(location_data['timestamp'], tz=timezone.utc).isoformat()
        
        # Prepare document data with ordered fields
        doc_data = OrderedDict([
            ('timestamp', iso_timestamp),
            ('latitude', location_data['latitude']),
            ('longitude', location_data['longitude']),
            ('location', location_data['location_details']['location_name']),
            ('country_code', location_data['location_details'].get('country_code', ''))  # Add country code
        ])

        # Store in Firestore
        logger.info(f"Storing document in collection: {collection_name}")
        doc_ref = db.collection(collection_name).document()
        doc_ref.set(dict(doc_data))  # Convert OrderedDict to dict for Firestore
        
        logger.info(f"Successfully stored ISS location data with ID: {doc_ref.id}")
        result = dict(doc_data)  # Convert OrderedDict to dict for JSON response
        result['document_id'] = doc_ref.id  # Add document ID for linking predictions
        return result

    except Exception as e:
        error_msg = f"Error storing ISS location: {str(e)}"
        logger.error(error_msg)
        return {'error': error_msg}


def generate_predictions_for_location(location_data: Dict[str, Any]) -> Dict[str, Any]:
    """
    Calls the iss_api_generate_predictions function to generate predictions.
    This function handles errors gracefully - if prediction generation fails,
    it logs the error but doesn't fail the entire operation.
    
    Args:
        location_data: Dictionary containing location data with document_id
        
    Returns:
        Dictionary containing prediction result or None if failed
    """
    try:
        # Get the prediction function URL
        import os
        prediction_url = os.environ.get(
            'PREDICTION_FUNCTION_URL',
            'https://iss-api-generate-predictions-cklav7ht2q-ue.a.run.app'
        )
        
        logger.info("Generating predictions for stored location...")
        
        # Get authentication token
        token = get_id_token(target_audience=prediction_url)
        
        # Prepare request payload
        payload = {
            'timestamp': location_data['timestamp'],
            'latitude': location_data['latitude'],
            'longitude': location_data['longitude'],
            'document_id': location_data['document_id'],
            'location': location_data.get('location', ''),
            'country_code': location_data.get('country_code', '')
        }
        
        # Make authenticated request
        headers = {
            'Authorization': f'Bearer {token}',
            'Content-Type': 'application/json'
        }
        
        logger.info(f"Calling prediction function at {prediction_url}...")
        response = requests.post(
            prediction_url,
            json=payload,
            headers=headers,
            timeout=30  # Longer timeout for prediction generation
        )
        response.raise_for_status()
        result = response.json()
        
        logger.info(f"Successfully generated predictions: {result.get('data', {}).get('prediction_count', 0)} predictions")
        return result
        
    except Exception as e:
        # Log error but don't fail - prediction generation is non-critical
        logger.warning(f"Failed to generate predictions (non-critical): {str(e)}")
        return None
