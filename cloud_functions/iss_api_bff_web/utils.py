import requests
import logging
from google.auth.transport.requests import Request
from google.oauth2 import id_token
from google.cloud import secretmanager
from google.cloud import firestore
from datetime import datetime, timezone

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# API URLs
LAST_LOC_URL = "https://us-east1-iss-sky-scanner-20241222.cloudfunctions.net/iss_api_query_loc_history"
FACT_URL = "https://iss-api-get-loc-fact-cklav7ht2q-ue.a.run.app"

# Initialize Firestore client
try:
    db = firestore.Client()
    logger.info("Successfully initialized Firestore client")
except Exception as e:
    logger.error(f"Failed to initialize Firestore client: {str(e)}")
    raise

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


def round_timestamp_to_5_minutes(iso_timestamp: str) -> str:
    """
    Rounds an ISO timestamp to the nearest 5-minute interval.
    
    Args:
        iso_timestamp: ISO format timestamp string
        
    Returns:
        ISO format timestamp string rounded to 5-minute interval
    """
    try:
        # Parse the ISO timestamp
        dt = datetime.fromisoformat(iso_timestamp.replace('Z', '+00:00'))
        
        # Round to nearest 5 minutes
        minutes = dt.minute
        rounded_minutes = (minutes // 5) * 5
        rounded_dt = dt.replace(minute=rounded_minutes, second=0, microsecond=0)
        
        # Return in ISO format
        return rounded_dt.isoformat()
    except Exception as e:
        logger.error(f"Error rounding timestamp: {str(e)}")
        return iso_timestamp  # Return original if rounding fails


def get_predictions_for_timestamp(timestamp: str):
    """
    Fetches predictions from Firestore for a given timestamp.
    
    Args:
        timestamp: ISO format timestamp string
        
    Returns:
        dict: Predictions data or None if not found
    """
    try:
        # Round timestamp to 5-minute interval (matching how predictions are stored)
        rounded_timestamp = round_timestamp_to_5_minutes(timestamp)
        
        logger.info(f"Fetching predictions for timestamp: {rounded_timestamp}")
        
        # Get predictions document from Firestore
        doc_ref = db.collection('iss_loc_predictions').document(rounded_timestamp)
        doc = doc_ref.get()
        
        if not doc.exists:
            logger.info(f"No predictions found for timestamp: {rounded_timestamp}")
            return None
        
        data = doc.to_dict()
        
        # Extract and format predictions
        predictions = data.get('predictions', [])
        
        # Separate predictions by method
        orbital_predictions = [p for p in predictions if p.get('method') == 'orbital_mechanics']
        sgp4_predictions = [p for p in predictions if p.get('method') == 'sgp4']
        
        return {
            'orbital_mechanics': orbital_predictions,
            'sgp4': sgp4_predictions[0] if sgp4_predictions else None,  # Only one SGP4 prediction
            'source_timestamp': data.get('source_timestamp'),
            'prediction_count': len(predictions)
        }
        
    except Exception as e:
        logger.error(f"Error fetching predictions: {str(e)}")
        return None


def get_all_predictions():
    """
    Fetches ALL prediction documents from Firestore and aggregates them by predicted timestamp.
    This allows showing multiple prediction dots for the same future time from different prediction cycles.
    
    Returns:
        dict: Aggregated predictions grouped by predicted timestamp
    """
    try:
        logger.info("Fetching all prediction documents from Firestore")
        
        # Get all prediction documents
        predictions_collection = db.collection('iss_loc_predictions')
        docs = predictions_collection.stream()
        
        # Dictionary to aggregate predictions by their predicted timestamp
        # Key: predicted timestamp (rounded to 5 minutes), Value: list of predictions for that time
        aggregated_predictions = {}
        
        current_time = datetime.now(timezone.utc)
        
        for doc in docs:
            doc_data = doc.to_dict()
            predictions = doc_data.get('predictions', [])
            
            for pred in predictions:
                pred_timestamp = pred.get('timestamp')
                if not pred_timestamp:
                    continue
                
                # Round predicted timestamp to 5-minute interval for grouping
                rounded_pred_timestamp = round_timestamp_to_5_minutes(pred_timestamp)
                
                # Only include predictions for future times
                try:
                    pred_dt = datetime.fromisoformat(pred_timestamp.replace('Z', '+00:00'))
                    if pred_dt <= current_time:
                        continue  # Skip past predictions
                except Exception:
                    continue
                
                # Initialize list for this timestamp if it doesn't exist
                if rounded_pred_timestamp not in aggregated_predictions:
                    aggregated_predictions[rounded_pred_timestamp] = []
                
                # Add this prediction to the list for this timestamp
                aggregated_predictions[rounded_pred_timestamp].append(pred)
        
        # Separate predictions by method and aggregate
        orbital_mechanics_all = []
        sgp4_all = []
        
        for timestamp, preds in aggregated_predictions.items():
            for pred in preds:
                method = pred.get('method', 'orbital_mechanics')
                if method == 'sgp4':
                    # For SGP4, we want all predictions (one per source timestamp)
                    sgp4_all.append(pred)
                else:
                    # For orbital mechanics, we want all predictions
                    orbital_mechanics_all.append(pred)
        
        # Sort by timestamp
        orbital_mechanics_all.sort(key=lambda x: x.get('timestamp', ''))
        sgp4_all.sort(key=lambda x: x.get('timestamp', ''))
        
        logger.info(f"Aggregated {len(orbital_mechanics_all)} orbital mechanics predictions and {len(sgp4_all)} SGP4 predictions")
        
        return {
            'orbital_mechanics': orbital_mechanics_all,
            'sgp4': sgp4_all,  # Return all SGP4 predictions, not just one
            'prediction_count': len(orbital_mechanics_all) + len(sgp4_all)
        }
        
    except Exception as e:
        logger.error(f"Error fetching all predictions: {str(e)}")
        return None

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
        # Ensure country code is preserved
        if 'country_code' not in location_info:
            location_info['country_code'] = ''  # Add empty country code if not present
        
        # Fetch ALL predictions (aggregated from all prediction cycles)
        logger.info("Fetching all predictions from all prediction cycles")
        predictions = get_all_predictions()
        if predictions:
            location_info['predictions'] = predictions
            logger.info(f"Added {predictions.get('prediction_count', 0)} total predictions to response")
        else:
            logger.info("No predictions found")
            location_info['predictions'] = None
        
        return location_info

    except Exception as e:
        logger.error(f"Error getting ISS location with fact: {str(e)}")
        return None
