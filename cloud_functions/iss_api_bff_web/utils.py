import requests
import logging
from concurrent.futures import ThreadPoolExecutor, as_completed
from google.auth.transport.requests import Request
from google.oauth2 import id_token
from google.cloud import secretmanager
from google.cloud import firestore
from datetime import datetime, timezone, timedelta

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
    Fetches prediction documents from Firestore and aggregates them by predicted timestamp.
    Limits to recent documents (last 24 hours) to optimize performance.
    This allows showing multiple prediction dots for the same future time from different prediction cycles.
    
    Returns:
        dict: Aggregated predictions grouped by predicted timestamp
    """
    try:
        logger.info("Fetching prediction documents from Firestore")
        
        current_time = datetime.now(timezone.utc)
        # Only process predictions from the last 24 hours to limit query size
        cutoff_time = current_time - timedelta(hours=24)
        
        # Get all prediction documents (we'll filter by source_timestamp in memory)
        # This is safer than relying on Firestore indexes
        predictions_collection = db.collection('iss_loc_predictions')
        docs = predictions_collection.limit(500).stream()  # Limit to 500 most recent docs
        
        # Separate predictions by method and aggregate
        orbital_mechanics_all = []
        sgp4_all = []
        
        doc_count = 0
        for doc in docs:
            doc_count += 1
            doc_data = doc.to_dict()
            source_timestamp = doc_data.get('source_timestamp')
            
            # Skip documents older than 24 hours
            if source_timestamp:
                try:
                    source_dt = datetime.fromisoformat(source_timestamp.replace('Z', '+00:00'))
                    if source_dt < cutoff_time:
                        continue  # Skip old documents
                except Exception:
                    pass  # Continue if timestamp parsing fails
            
            predictions = doc_data.get('predictions', [])
            
            for pred in predictions:
                pred_timestamp = pred.get('timestamp')
                if not pred_timestamp:
                    continue
                
                # Only include predictions for future times
                try:
                    pred_dt = datetime.fromisoformat(pred_timestamp.replace('Z', '+00:00'))
                    if pred_dt <= current_time:
                        continue  # Skip past predictions
                except Exception:
                    continue
                
                # Add source_timestamp to each prediction
                pred_with_source = pred.copy()
                pred_with_source['source_timestamp'] = source_timestamp
                
                method = pred.get('method', 'orbital_mechanics')
                if method == 'sgp4':
                    sgp4_all.append(pred_with_source)
                else:
                    orbital_mechanics_all.append(pred_with_source)
        
        # Sort by timestamp
        orbital_mechanics_all.sort(key=lambda x: x.get('timestamp', ''))
        sgp4_all.sort(key=lambda x: x.get('timestamp', ''))
        
        logger.info(f"Processed {doc_count} documents, aggregated {len(orbital_mechanics_all)} orbital mechanics predictions and {len(sgp4_all)} SGP4 predictions")
        
        return {
            'orbital_mechanics': orbital_mechanics_all,
            'sgp4': sgp4_all,  # Return all SGP4 predictions, not just one
            'prediction_count': len(orbital_mechanics_all) + len(sgp4_all)
        }
        
    except Exception as e:
        logger.error(f"Error fetching all predictions: {str(e)}")
        return None


def _process_historical_prediction(pred_data, cutoff_time, current_time):
    """Helper function to process a single historical prediction dataset."""
    predictions_list = []
    if pred_data and pred_data.get('orbital_mechanics'):
        for pred in pred_data['orbital_mechanics']:
            pred_timestamp = pred.get('timestamp')
            if pred_timestamp:
                try:
                    pred_dt = datetime.fromisoformat(pred_timestamp.replace('Z', '+00:00'))
                    # Only include predictions that fall within the 90-minute window
                    if pred_dt >= cutoff_time and pred_dt <= current_time:
                        predictions_list.append({
                            'timestamp': pred_timestamp,
                            'latitude': pred.get('latitude'),
                            'longitude': pred.get('longitude'),
                            'source_timestamp': pred_data.get('source_timestamp')
                        })
                except Exception:
                    continue
    return predictions_list


def get_historical_predictions():
    """
    Fetches predictions made at 90, 60, and 30 minutes ago (rounded to 5-minute intervals).
    Filters predictions to only include those that fall within the 90-minute historical window.
    Uses parallel fetching to speed up the process.
    
    Returns:
        dict: Predictions grouped by source time period, or None if error
    """
    try:
        current_time = datetime.now(timezone.utc)
        
        # Calculate timestamps for 90, 60, and 30 minutes ago
        time_90min_ago = current_time - timedelta(minutes=90)
        time_60min_ago = current_time - timedelta(minutes=60)
        time_30min_ago = current_time - timedelta(minutes=30)
        
        # Round each timestamp to nearest 5-minute interval
        rounded_90min = round_timestamp_to_5_minutes(time_90min_ago.isoformat())
        rounded_60min = round_timestamp_to_5_minutes(time_60min_ago.isoformat())
        rounded_30min = round_timestamp_to_5_minutes(time_30min_ago.isoformat())
        
        # Calculate cutoff time for filtering (90 minutes before current time)
        cutoff_time = current_time - timedelta(minutes=90)
        
        # Fetch predictions in parallel
        with ThreadPoolExecutor(max_workers=3) as executor:
            future_90 = executor.submit(get_predictions_for_timestamp, rounded_90min)
            future_60 = executor.submit(get_predictions_for_timestamp, rounded_60min)
            future_30 = executor.submit(get_predictions_for_timestamp, rounded_30min)
            
            # Wait for all to complete and get results
            pred_data_90 = future_90.result()
            pred_data_60 = future_60.result()
            pred_data_30 = future_30.result()
        
        # Process predictions in parallel
        with ThreadPoolExecutor(max_workers=3) as executor:
            future_90_proc = executor.submit(_process_historical_prediction, pred_data_90, cutoff_time, current_time)
            future_60_proc = executor.submit(_process_historical_prediction, pred_data_60, cutoff_time, current_time)
            future_30_proc = executor.submit(_process_historical_prediction, pred_data_30, cutoff_time, current_time)
            
            predictions_90min = future_90_proc.result()
            predictions_60min = future_60_proc.result()
            predictions_30min = future_30_proc.result()
        
        logger.info(f"Historical predictions: 90min={len(predictions_90min)}, 60min={len(predictions_60min)}, 30min={len(predictions_30min)}")
        
        return {
            'predictions_90min_ago': predictions_90min,
            'predictions_60min_ago': predictions_60min,
            'predictions_30min_ago': predictions_30min
        }
        
    except Exception as e:
        logger.error(f"Error fetching historical predictions: {str(e)}")
        return None


def _fetch_location():
    """Helper function to fetch ISS location."""
    token = get_id_token(LAST_LOC_URL)
    headers = {"Authorization": f"Bearer {token}"}
    response = requests.get(f"{LAST_LOC_URL}?limit=1", headers=headers, timeout=10)
    response.raise_for_status()
    return response.json()


def _fetch_fact(location):
    """Helper function to fetch fun fact."""
    token = get_id_token(FACT_URL)
    headers = {"Authorization": f"Bearer {token}"}
    response = requests.get(f"{FACT_URL}?location={location}", headers=headers, timeout=10)
    response.raise_for_status()
    return response.json()


def get_iss_location_with_fact():
    """
    Gets the latest ISS location and a fun fact about that location.
    Combines data from iss_api_query_loc_history (with limit=1) and iss_api_get_loc_fact.
    Uses parallel execution to fetch location and fact simultaneously, then fetches predictions.
    
    Returns:
        dict: Combined location data and fun fact
    """
    try:
        # Fetch location and fact in parallel
        logger.info("Fetching latest ISS location and fun fact in parallel...")
        location_info = None
        
        with ThreadPoolExecutor(max_workers=2) as executor:
            # Start both requests in parallel
            future_location = executor.submit(_fetch_location)
            
            # We need location first to get the location string for the fact API
            # So we'll wait for location, then fetch fact
            location_data = future_location.result()
            
            if location_data.get('status') != 'success':
                logger.error(f"Error getting location: {location_data}")
                return None

            # Extract the first (and only) location from the results
            if not location_data.get('locations') or len(location_data['locations']) == 0:
                logger.error("No location data found")
                return None
                
            location_info = location_data['locations'][0]
            location = location_info.get('location')
            
            # Now fetch fact in parallel with predictions
            future_fact = executor.submit(_fetch_fact, location)
            future_predictions = executor.submit(get_all_predictions)
            future_historical = executor.submit(get_historical_predictions)
            
            # Wait for all to complete
            fact_data = future_fact.result()
            predictions = future_predictions.result()
            historical_predictions = future_historical.result()

        # Combine the data
        location_info['fun_fact'] = fact_data.get('fact', 'Fun fact coming soon!')
        location_info['status'] = 'success'  # Add status field for backward compatibility
        # Ensure country code is preserved
        if 'country_code' not in location_info:
            location_info['country_code'] = ''  # Add empty country code if not present
        
        # Add predictions
        if predictions:
            location_info['predictions'] = predictions
            logger.info(f"Added {predictions.get('prediction_count', 0)} total predictions to response")
        else:
            logger.info("No predictions found")
            location_info['predictions'] = None
        
        # Add historical predictions
        if historical_predictions:
            location_info['historical_predictions'] = historical_predictions
            logger.info("Added historical predictions to response")
        else:
            logger.info("No historical predictions found")
            location_info['historical_predictions'] = None
        
        return location_info

    except Exception as e:
        logger.error(f"Error getting ISS location with fact: {str(e)}")
        return None
