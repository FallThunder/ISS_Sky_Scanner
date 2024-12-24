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

def get_id_token() -> str:
    """
    Gets an ID token for authenticating with other Cloud Functions.
    """
    try:
        logger.info("Getting ID token...")
        # Get credentials from the environment
        credentials, project = google.auth.default()
        logger.info(f"Got credentials for project: {project}")
        
        # Request a token with the target audience
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
        return dict(doc_data)  # Convert OrderedDict to dict for JSON response

    except Exception as e:
        error_msg = f"Error storing ISS location: {str(e)}"
        logger.error(error_msg)
        return {'error': error_msg}
