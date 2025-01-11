import requests
import logging
from google.auth.transport.requests import Request
from google.oauth2 import id_token
from google.cloud import secretmanager

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# API URLs
LAST_LOC_URL = "https://us-east1-iss-sky-scanner-20241222.cloudfunctions.net/iss_api_query_loc_history"
FACT_URL = "https://iss-api-get-loc-fact-cklav7ht2q-ue.a.run.app"

def get_secret(secret_id):
    """
    Gets a secret from Secret Manager.
    """
    try:
        client = secretmanager.SecretManagerServiceClient()
        name = f"projects/iss-sky-scanner-20241222/secrets/{secret_id}/versions/latest"
        response = client.access_secret_version(name=name)
        return response.payload.data.decode('UTF-8')
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

def get_iss_location_with_fact():
    """
    Gets the latest ISS location and a fun fact about that location.
    Combines data from iss_api_query_loc_history (with limit=1) and iss_api_get_loc_fact.
    
    Returns:
        dict: Combined location data and fun fact
    """
    try:
        # Get latest ISS location
        logger.info("Fetching latest ISS location...")
        token = get_id_token(LAST_LOC_URL)
        headers = {"Authorization": f"Bearer {token}"}
        location_response = requests.get(f"{LAST_LOC_URL}?limit=1", headers=headers)
        location_response.raise_for_status()
        location_data = location_response.json()

        if location_data.get('status') != 'success':
            logger.error(f"Error getting location: {location_data}")
            return None

        # Extract the first (and only) location from the results
        if not location_data.get('locations') or len(location_data['locations']) == 0:
            logger.error("No location data found")
            return None
            
        location_info = location_data['locations'][0]

        # Get fun fact about the location
        location = location_info.get('location')
        logger.info(f"Fetching fun fact for location: {location}")
        token = get_id_token(FACT_URL)  # Get a new token for the fact API
        headers = {"Authorization": f"Bearer {token}"}
        fact_response = requests.get(f"{FACT_URL}?location={location}", headers=headers)
        fact_response.raise_for_status()
        fact_data = fact_response.json()

        # Combine the data
        location_info['fun_fact'] = fact_data.get('fact', 'Fun fact coming soon!')
        location_info['status'] = 'success'  # Add status field for backward compatibility
        return location_info

    except Exception as e:
        logger.error(f"Error getting ISS location with fact: {str(e)}")
        return None
