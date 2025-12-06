import requests
from typing import Dict, Any, OrderedDict, Tuple
import logging
import json
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

def classify_error(error: Exception, error_source: str, additional_info: Dict[str, Any] = None) -> Tuple[str, str, Dict[str, Any]]:
    """
    Classifies an error into a category and extracts error message with detailed diagnostics.
    
    Args:
        error: The exception that occurred
        error_source: Where the error occurred (e.g., "iss_api_get_realtime_loc", "reverse_geocode", "firestore")
        additional_info: Optional dictionary with additional diagnostic information
    
    Returns:
        Tuple of (error_type, error_message, diagnostics_dict)
    """
    import traceback
    
    error_str = str(error).lower()
    error_message = str(error)
    diagnostics = additional_info.copy() if additional_info else {}
    
    # Add exception type and full traceback
    diagnostics['exception_type'] = type(error).__name__
    diagnostics['traceback'] = traceback.format_exc()
    
    # Check for timeout errors and get more details
    if 'timeout' in error_str or 'timed out' in error_str or isinstance(error, requests.exceptions.Timeout):
        timeout_type = 'unknown'
        if isinstance(error, requests.exceptions.ConnectTimeout):
            timeout_type = 'connect_timeout'
        elif isinstance(error, requests.exceptions.ReadTimeout):
            timeout_type = 'read_timeout'
        elif 'read timeout' in error_str:
            timeout_type = 'read_timeout'
        elif 'connect timeout' in error_str:
            timeout_type = 'connect_timeout'
        
        diagnostics['timeout_type'] = timeout_type
        return ('timeout', error_message, diagnostics)
    
    # Check for HTTP/API errors
    if isinstance(error, requests.exceptions.HTTPError):
        diagnostics['status_code'] = error.response.status_code if hasattr(error, 'response') and error.response else None
        diagnostics['response_headers'] = dict(error.response.headers) if hasattr(error, 'response') and error.response else None
        return ('api_failure', error_message, diagnostics)
    if isinstance(error, requests.exceptions.RequestException):
        diagnostics['request_exception_type'] = type(error).__name__
        return ('api_failure', error_message, diagnostics)
    
    # Check for connection errors
    if isinstance(error, requests.exceptions.ConnectionError):
        diagnostics['connection_error'] = True
        return ('connection_error', error_message, diagnostics)
    
    # Check for geocoding errors (if error_source indicates it)
    if error_source == 'reverse_geocode':
        return ('geocoding_failure', error_message, diagnostics)
    
    # Check for Firestore errors
    if 'firestore' in error_str or error_source == 'firestore':
        return ('firestore_error', error_message, diagnostics)
    
    # Default to unknown
    return ('unknown', error_message, diagnostics)

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
    import time
    request_start_time = time.time()
    request_url = 'https://iss-api-get-realtime-loc-cklav7ht2q-ue.a.run.app'
    timeout_value = 10
    
    try:
        logger.info("Getting ISS location...")
        token_start_time = time.time()
        
        # Get authentication token
        token = get_id_token()
        token_duration = time.time() - token_start_time
        logger.info(f"Token obtained in {token_duration:.2f} seconds")
        
        # Make authenticated request
        logger.info(f"Making request to {request_url} with timeout={timeout_value}s...")
        request_made_time = time.time()
        
        response = requests.get(
            request_url,
            headers={'Authorization': f'Bearer {token}'},
            timeout=timeout_value
        )
        
        request_duration = time.time() - request_made_time
        logger.info(f"Request completed in {request_duration:.2f} seconds, status: {response.status_code}")
        total_duration = time.time() - request_start_time
        
        # Check for HTTP errors before parsing JSON
        if response.status_code >= 400:
            error_details = {
                'error_step': 'cloud_function_http_error',
                'request_url': request_url,
                'http_status_code': response.status_code,
                'total_duration_seconds': round(total_duration, 2),
                'token_duration_seconds': round(token_duration, 2),
                'request_duration_seconds': round(request_duration, 2),
                'error_timestamp': datetime.now(timezone.utc).isoformat()
            }
            
            # Try to parse error response
            try:
                error_response = response.json()
                error_details['upstream_error_type'] = error_response.get('error_type', 'unknown')
                error_details['upstream_error_message'] = error_response.get('error', 'Unknown error')
                error_details['upstream_error_details'] = error_response.get('error_details', {})
                logger.error(f"HTTP {response.status_code} from iss_api_get_realtime_loc: {error_response.get('error')}")
            except:
                error_details['response_text'] = response.text[:500]  # First 500 chars
                logger.error(f"HTTP {response.status_code} from iss_api_get_realtime_loc (non-JSON response)")
            
            http_error = requests.exceptions.HTTPError(f"HTTP {response.status_code} from {request_url}")
            store_error_entry(http_error, 'iss_api_get_realtime_loc', error_details)
            return {'error': f'HTTP {response.status_code} from iss_api_get_realtime_loc', 'error_details': error_details}
        
        # Parse successful response
        try:
            location_data = response.json()
        except Exception as e:
            error_details = {
                'error_step': 'json_parse_error',
                'request_url': request_url,
                'http_status_code': response.status_code,
                'total_duration_seconds': round(total_duration, 2),
                'response_text_preview': response.text[:500] if hasattr(response, 'text') else 'N/A',
                'error_timestamp': datetime.now(timezone.utc).isoformat()
            }
            logger.error(f"Failed to parse JSON response: {str(e)}")
            store_error_entry(e, 'iss_api_get_realtime_loc', error_details)
            return {'error': f'Failed to parse response from iss_api_get_realtime_loc: {str(e)}', 'error_details': error_details}
        
        # Check if the response contains error information from iss_api_get_realtime_loc
        if 'error' in location_data:
            # This means iss_api_get_realtime_loc returned an error
            error_type = location_data.get('error_type', 'unknown')
            error_details_from_api = location_data.get('error_details', {})
            
            # Enhance error details with our own timing info
            error_details = {
                'upstream_error_type': error_type,
                'upstream_error_message': location_data.get('error', 'Unknown error'),
                'upstream_error_details': error_details_from_api,
                'request_url': request_url,
                'timeout_value': timeout_value,
                'total_duration_seconds': round(total_duration, 2),
                'token_duration_seconds': round(token_duration, 2),
                'request_duration_seconds': round(request_duration, 2),
                'http_status_code': response.status_code,
                'error_timestamp': datetime.now(timezone.utc).isoformat()
            }
            
            logger.error(f"iss_api_get_realtime_loc returned error: {error_type} - {location_data.get('error')}")
            logger.error(f"Enhanced error details: {error_details}")
            
            # Create an exception to store
            upstream_error = Exception(f"Upstream error from iss_api_get_realtime_loc: {location_data.get('error')}")
            store_error_entry(upstream_error, 'iss_api_get_realtime_loc', error_details)
            return {'error': location_data.get('error'), 'error_type': error_type, 'error_details': error_details}
        
        logger.info(f"Got ISS location data in {total_duration:.2f} seconds total")
        if 'timing' in location_data:
            logger.info(f"Upstream timing: {location_data['timing']}")
        return location_data
        
    except requests.exceptions.Timeout as e:
        # This is a timeout calling iss_api_get_realtime_loc (not inside it)
        request_duration = time.time() - request_made_time if 'request_made_time' in locals() else None
        total_duration = time.time() - request_start_time
        token_duration = time.time() - token_start_time if 'token_start_time' in locals() else None
        
        error_details = {
            'error_step': 'cloud_function_timeout',  # Timeout calling our own Cloud Function
            'request_url': request_url,
            'timeout_value': timeout_value,
            'total_duration_seconds': round(total_duration, 2),
            'token_duration_seconds': round(token_duration, 2) if token_duration else None,
            'request_duration_seconds': round(request_duration, 2) if request_duration else None,
            'timeout_exceeded': True,
            'error_timestamp': datetime.now(timezone.utc).isoformat()
        }
        
        logger.error(f"Timeout error after {total_duration:.2f} seconds: {str(e)}")
        logger.error(f"Error details: {error_details}")
        
        # Store detailed error
        store_error_entry(e, 'iss_api_get_realtime_loc', error_details)
        return {'error': f'Failed to fetch ISS location: {str(e)}', 'error_details': error_details}
        
    except Exception as e:
        total_duration = time.time() - request_start_time
        token_duration = time.time() - token_start_time if 'token_start_time' in locals() else None
        
        error_details = {
            'error_step': 'cloud_function_error',  # Error calling our own Cloud Function
            'request_url': request_url,
            'timeout_value': timeout_value,
            'total_duration_seconds': round(total_duration, 2),
            'token_duration_seconds': round(token_duration, 2) if token_duration else None,
            'error_timestamp': datetime.now(timezone.utc).isoformat()
        }
        
        logger.error(f"Error fetching ISS location after {total_duration:.2f} seconds: {str(e)}")
        logger.error(f"Error details: {error_details}")
        
        # Store detailed error
        store_error_entry(e, 'iss_api_get_realtime_loc', error_details)
        return {'error': f'Failed to fetch ISS location: {str(e)}', 'error_details': error_details}

def store_error_entry(error: Exception, error_source: str, additional_info: Dict[str, Any] = None) -> None:
    """
    Stores an error entry in Firestore when location fetch/store fails.
    
    Args:
        error: The exception that occurred
        error_source: Where the error occurred (e.g., "iss_api_get_realtime_loc", "reverse_geocode", "firestore")
        additional_info: Optional dictionary with additional diagnostic information
    """
    try:
        # Classify the error with detailed diagnostics
        error_type, error_message, diagnostics = classify_error(error, error_source, additional_info)
        
        # Get current time and round to 5-minute interval
        current_time = datetime.now(timezone.utc)
        rounded_time = round_timestamp_to_5_minutes(current_time)
        iso_timestamp = rounded_time.isoformat()
        
        # Prepare error document with detailed diagnostics
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
            ('country_code', ''),
            ('diagnostics', diagnostics)  # Add detailed diagnostics
        ])
        
        # Store error entry in Firestore
        logger.info(f"Storing error entry in collection: {collection_name}")
        logger.info(f"Error type: {error_type}, Diagnostics keys: {list(diagnostics.keys())}")
        doc_ref = db.collection(collection_name).document()
        doc_ref.set(dict(error_doc))
        
        logger.info(f"Successfully stored error entry with ID: {doc_ref.id}, type: {error_type}, source: {error_source}")
        # Log diagnostics summary (excluding traceback for readability)
        diagnostics_summary = {k: v for k, v in diagnostics.items() if k != 'traceback'}
        logger.info(f"Diagnostics summary: {json.dumps(diagnostics_summary, indent=2, default=str)}")
        
    except Exception as e:
        # If storing error entry fails, log it but don't raise (to avoid infinite loop)
        logger.error(f"Failed to store error entry: {str(e)}")
        import traceback
        logger.error(f"Traceback: {traceback.format_exc()}")

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
            # Store error entry in Firestore (error details already captured in get_iss_location)
            error = Exception(location_data['error'])
            error_details = location_data.get('error_details', {})
            store_error_entry(error, 'iss_api_get_realtime_loc', error_details)
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
        # Store error entry in Firestore with details
        error_details = {
            'error_step': 'firestore_write',
            'error_timestamp': datetime.now(timezone.utc).isoformat()
        }
        store_error_entry(e, 'firestore', error_details)
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
