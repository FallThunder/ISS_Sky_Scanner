import requests
import logging
from google.auth.transport.requests import Request
from google.oauth2 import id_token
from google.cloud import secretmanager
import time

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# API URLs
LAST_LOC_URL = "https://us-east1-iss-sky-scanner-20241222.cloudfunctions.net/iss_api_query_loc_history"
FACT_URL = "https://iss-api-get-loc-fact-cklav7ht2q-ue.a.run.app"

# Initialize Secret Manager client (reused across invocations)
_secret_client = None
def _get_secret_client():
    """Get or create Secret Manager client."""
    global _secret_client
    if _secret_client is None:
        _secret_client = secretmanager.SecretManagerServiceClient()
    return _secret_client

# In-memory cache for API key (cached for 5 minutes)
_api_key_cache = {
    'value': None,
    'expires_at': 0
}

def get_secret(secret_id):
    """
    Gets a secret from Secret Manager with caching for API keys.
    """
    # Cache API keys for 5 minutes to reduce Secret Manager calls
    if secret_id in ['iss-sky-scanner-web-api-key', 'iss-sky-scanner-esp-api-key']:
        current_time = time.time()
        if _api_key_cache['value'] and _api_key_cache['expires_at'] > current_time:
            return _api_key_cache['value']
    
    try:
        client = _get_secret_client()
        name = f"projects/iss-sky-scanner-20241222/secrets/{secret_id}/versions/latest"
        response = client.access_secret_version(name=name)
        secret_value = response.payload.data.decode('UTF-8')
        
        # Cache API keys
        if secret_id in ['iss-sky-scanner-web-api-key', 'iss-sky-scanner-esp-api-key']:
            _api_key_cache['value'] = secret_value
            _api_key_cache['expires_at'] = time.time() + 300  # 5 minutes
        
        return secret_value
    except Exception as e:
        logger.error(f"Error getting secret: {str(e)}")
        raise

def validate_api_key(api_key):
    """
    Validates the provided API key against the stored secret.
    """
    try:
        stored_key = get_secret('iss-sky-scanner-esp-api-key')
        return api_key == stored_key
    except Exception as e:
        logger.error(f"Error validating API key: {str(e)}")
        return False

def get_id_token(target_url):
    """
    Gets an ID token for authenticating with other Cloud Functions.
    """
    try:
        return id_token.fetch_id_token(Request(), target_url)
    except Exception as e:
        logger.error(f"Error getting ID token: {str(e)}")
        raise


# Reuse requests session for connection pooling
_session = None
def _get_session():
    """Get or create requests session for connection reuse."""
    global _session
    if _session is None:
        _session = requests.Session()
        # Set default timeout
        _session.timeout = 8
    return _session

def _fetch_location():
    """Helper function to fetch ISS location."""
    session = _get_session()
    token = get_id_token(LAST_LOC_URL)
    headers = {"Authorization": f"Bearer {token}"}
    response = session.get(f"{LAST_LOC_URL}?limit=1", headers=headers, timeout=8)
    response.raise_for_status()
    return response.json()


def _fetch_fact(location):
    """Helper function to fetch fun fact."""
    session = _get_session()
    token = get_id_token(FACT_URL)
    headers = {"Authorization": f"Bearer {token}"}
    response = session.get(f"{FACT_URL}?location={location}", headers=headers, timeout=8)
    response.raise_for_status()
    return response.json()


def get_iss_location_with_fact():
    """
    Gets the latest ISS location and a fun fact about that location.
    Combines data from iss_api_query_loc_history (with limit=1) and iss_api_get_loc_fact.
    Optimized for performance with parallel execution and connection reuse.
    
    Returns:
        dict: Combined location data and fun fact
    """
    try:
        logger.info("Fetching latest ISS location and fun fact...")
        
        # Fetch location first (required for fact API)
        location_data = _fetch_location()
        
        if location_data.get('status') != 'success':
            logger.error(f"Error getting location: {location_data}")
            return None

        # Extract the first (and only) location from the results
        if not location_data.get('locations') or len(location_data['locations']) == 0:
            logger.error("No location data found")
            return None
            
        location_info = location_data['locations'][0]
        location = location_info.get('location')
        
        # Fetch fact
        try:
            fact_data = _fetch_fact(location)
        except Exception as e:
            logger.warning(f"Fact fetch failed: {str(e)}")
            fact_data = {'fact': 'Fun fact coming soon!'}

        # Combine the data
        location_info['fun_fact'] = fact_data.get('fact', 'Fun fact coming soon!')
        location_info['status'] = 'success'  # Add status field for backward compatibility
        # Ensure country code is preserved
        if 'country_code' not in location_info:
            location_info['country_code'] = ''  # Add empty country code if not present
        
        return location_info

    except Exception as e:
        logger.error(f"Error getting ISS location with fact: {str(e)}")
        return None
