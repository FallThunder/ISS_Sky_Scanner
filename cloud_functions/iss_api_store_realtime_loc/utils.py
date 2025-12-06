import requests
from typing import Dict, Any, OrderedDict, Tuple
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

def classify_error(error: Exception, error_source: str) -> Tuple[str, str]:
    """
    Classifies an error into a category and extracts error message.
    
    Args:
        error: The exception that occurred
        error_source: Where the error occurred (e.g., "iss_api_get_realtime_loc", "reverse_geocode", "firestore")
    
    Returns:
        Tuple of (error_type, error_message)
    """
    error_str = str(error).lower()
    error_message = str(error)
    
    # Check for timeout errors
    if 'timeout' in error_str or 'timed out' in error_str:
        return ('timeout', error_message)
    
    # Check for HTTP/API errors
    if isinstance(error, requests.exceptions.HTTPError):
        return ('api_failure', error_message)
    if isinstance(error, requests.exceptions.RequestException):
        return ('api_failure', error_message)
    
    # Check for geocoding errors (if error_source indicates it)
    if error_source == 'reverse_geocode':
        return ('geocoding_failure', error_message)
    
    # Check for Firestore errors
    if 'firestore' in error_str or error_source == 'firestore':
        return ('firestore_error', error_message)
    
    # Default to unknown
    return ('unknown', error_message)

def round_timestamp_to_5_minutes(dt: datetime) -> datetime:
    """
    Rounds a datetime to the nearest 5-minute interval (floor).
    
    Args:
        dt: Datetime to round
    
    Returns:
        Rounded datetime
    """
    rounded_minutes = (dt.minute // 5) * 5
    return dt.replace(minute=rounded_minutes, second=0, microsecond=0)

def get_id_token(target_audience: str = None) -> str:
    """
    Gets an ID token for authenticating with other Cloud Functions.
    
    Args:
        target_audience: URL of the target Cloud Function. If None, uses default.
    """
    try:
        logger.info(f"Getting ID token for audience: {target_audience}")
        # Get credentials from the environment
        credentials, project = google.auth.default()
        logger.info(f"Got credentials for project: {project}")
        
        # Request a token with the target audience
        auth_req = Request()
        if target_audience is None:
            target_audience = 'https://iss-api-get-realtime-loc-cklav7ht2q-ue.a.run.app'
        
        token = id_token.fetch_id_token(auth_req, target_audience)
        logger.info(f"Successfully obtained ID token for {target_audience}")
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

def store_error_entry(error: Exception, error_source: str) -> None:
    """
    Stores an error entry in Firestore when location fetch/store fails.
    
    Args:
        error: The exception that occurred
        error_source: Where the error occurred (e.g., "iss_api_get_realtime_loc", "firestore")
    """
    try:
        # Classify the error
        error_type, error_message = classify_error(error, error_source)
        
        # Get current time and round to 5-minute interval
        current_time = datetime.now(timezone.utc)
        rounded_time = round_timestamp_to_5_minutes(current_time)
        iso_timestamp = rounded_time.isoformat()
        
        # Prepare error document
        error_doc = OrderedDict([
            ('timestamp', iso_timestamp),
            ('is_error_entry', True),
            ('error_type', error_type),
            ('error_message', error_message),
            ('error_source', error_source),
            ('isEmpty', True),
            ('latitude', None),
            ('longitude', None),
            ('location', None),
            ('country_code', '')
        ])
        
        # Store error entry in Firestore
        logger.info(f"Storing error entry in collection: {collection_name}")
        doc_ref = db.collection(collection_name).document()
        doc_ref.set(dict(error_doc))
        
        logger.info(f"Successfully stored error entry with ID: {doc_ref.id}, type: {error_type}, source: {error_source}")
        
    except Exception as e:
        # If storing error entry fails, log it but don't raise (to avoid infinite loop)
        logger.error(f"Failed to store error entry: {str(e)}")

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
            # Store error entry in Firestore
            error = Exception(location_data['error'])
            store_error_entry(error, 'iss_api_get_realtime_loc')
            return location_data

        logger.info("Preparing document data...")
        # Convert Unix timestamp to ISO format
        iso_timestamp = datetime.fromtimestamp(location_data['timestamp'], tz=timezone.utc).isoformat()
        
        # Handle location_details - it might be a dict or a string
        location_details = location_data.get('location_details', {})
        if isinstance(location_details, dict):
            location_name = location_details.get('location_name', 'Location details unavailable')
            country_code = location_details.get('country_code', '')
        else:
            # If location_details is a string (e.g., 'Location details unavailable')
            location_name = location_details if isinstance(location_details, str) else 'Location details unavailable'
            country_code = ''
        
        # Prepare document data with ordered fields
        doc_data = OrderedDict([
            ('timestamp', iso_timestamp),
            ('latitude', location_data['latitude']),
            ('longitude', location_data['longitude']),
            ('location', location_name),
            ('country_code', country_code)
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
        # Store error entry in Firestore
        store_error_entry(e, 'firestore')
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
