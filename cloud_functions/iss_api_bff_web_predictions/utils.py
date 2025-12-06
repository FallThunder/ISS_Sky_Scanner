import logging
from concurrent.futures import ThreadPoolExecutor
from google.cloud import secretmanager
from google.cloud import firestore
from datetime import datetime, timezone, timedelta
import time

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Initialize Firestore client (reused across invocations)
try:
    db = firestore.Client()
    logger.info("Successfully initialized Firestore client")
except Exception as e:
    logger.error(f"Failed to initialize Firestore client: {str(e)}")
    raise

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
    Fetches the most recent prediction document from Firestore and returns only future predictions.
    Gets the latest prediction document (by source_timestamp) and filters to only include
    predictions where the predicted timestamp is in the future.
    
    Returns:
        dict: Aggregated predictions grouped by predicted timestamp
    """
    try:
        logger.info("Fetching prediction documents from Firestore")
        
        current_time = datetime.now(timezone.utc)
        
        # Use Firestore query to get the most recent prediction document
        predictions_collection = db.collection('iss_loc_predictions')
        
        # Query documents ordered by source_timestamp descending to get the latest one
        # Limit to 1 to get only the most recent document
        query = predictions_collection.order_by('source_timestamp', direction=firestore.Query.DESCENDING).limit(1)
        docs = list(query.stream())
        
        if not docs:
            logger.warning("No prediction documents found in Firestore")
            return {
                'orbital_mechanics': [],
                'sgp4': [],
                'prediction_count': 0
            }
        
        # Get the most recent document
        doc = docs[0]
        doc_data = doc.to_dict()
        source_timestamp = doc_data.get('source_timestamp')
        predictions = doc_data.get('predictions', [])
        
        logger.info(f"Processing latest document with source_timestamp: {source_timestamp}, {len(predictions)} total predictions")
        
        # Separate predictions by method and filter to only include future predictions
        orbital_mechanics_all = []
        sgp4_all = []
        
        future_count = 0
        past_count = 0
        
        for pred in predictions:
            pred_timestamp = pred.get('timestamp')
            if not pred_timestamp:
                continue
            
            # Only include predictions for future times
            try:
                pred_dt = datetime.fromisoformat(pred_timestamp.replace('Z', '+00:00'))
                if pred_dt <= current_time:
                    past_count += 1
                    continue  # Skip past predictions
                
                future_count += 1
                
                # Add source_timestamp to each prediction
                pred_with_source = pred.copy()
                pred_with_source['source_timestamp'] = source_timestamp
                
                method = pred.get('method', 'orbital_mechanics')
                if method == 'sgp4':
                    sgp4_all.append(pred_with_source)
                else:
                    orbital_mechanics_all.append(pred_with_source)
            except Exception as e:
                logger.warning(f"Error processing prediction: {str(e)}")
                continue
        
        # Sort by timestamp
        orbital_mechanics_all.sort(key=lambda x: x.get('timestamp', ''))
        sgp4_all.sort(key=lambda x: x.get('timestamp', ''))
        
        logger.info(f"From latest document: {future_count} future predictions, {past_count} past predictions filtered out")
        logger.info(f"Aggregated {len(orbital_mechanics_all)} orbital mechanics predictions and {len(sgp4_all)} SGP4 predictions")
        
        return {
            'orbital_mechanics': orbital_mechanics_all,
            'sgp4': sgp4_all,  # Return all SGP4 predictions, not just one
            'prediction_count': len(orbital_mechanics_all) + len(sgp4_all)
        }
        
    except Exception as e:
        logger.error(f"Error fetching all predictions: {str(e)}")
        # If query fails (e.g., index not ready), fall back to limited fetch
        logger.info("Falling back to limited fetch without timestamp filter")
        try:
            predictions_collection = db.collection('iss_loc_predictions')
            docs = predictions_collection.order_by('source_timestamp', direction=firestore.Query.DESCENDING).limit(50).stream()
            
            orbital_mechanics_all = []
            sgp4_all = []
            current_time = datetime.now(timezone.utc)
            
            for doc in docs:
                doc_data = doc.to_dict()
                source_timestamp = doc_data.get('source_timestamp')
                predictions = doc_data.get('predictions', [])
                
                for pred in predictions:
                    pred_timestamp = pred.get('timestamp')
                    if not pred_timestamp:
                        continue
                    try:
                        pred_dt = datetime.fromisoformat(pred_timestamp.replace('Z', '+00:00'))
                        if pred_dt <= current_time:
                            continue
                    except Exception:
                        continue
                    
                    pred_with_source = pred.copy()
                    pred_with_source['source_timestamp'] = source_timestamp
                    
                    method = pred.get('method', 'orbital_mechanics')
                    if method == 'sgp4':
                        sgp4_all.append(pred_with_source)
                    else:
                        orbital_mechanics_all.append(pred_with_source)
            
            orbital_mechanics_all.sort(key=lambda x: x.get('timestamp', ''))
            sgp4_all.sort(key=lambda x: x.get('timestamp', ''))
            
            return {
                'orbital_mechanics': orbital_mechanics_all,
                'sgp4': sgp4_all,
                'prediction_count': len(orbital_mechanics_all) + len(sgp4_all)
            }
        except Exception as fallback_error:
            logger.error(f"Fallback query also failed: {str(fallback_error)}")
            return None


def _process_historical_prediction(pred_data, cutoff_time, current_time):
    """
    Helper function to process a single historical prediction dataset.
    Takes ALL predictions from the found document and filters only by the 90-minute window.
    This ensures we get the complete graph since all predictions from the source document are included.
    
    Args:
        pred_data: Prediction data from Firestore
        cutoff_time: 90-minute cutoff time (for filtering overall window)
        current_time: Current time
    """
    predictions_list = []
    if pred_data and pred_data.get('orbital_mechanics'):
        for pred in pred_data['orbital_mechanics']:
            pred_timestamp = pred.get('timestamp')
            if pred_timestamp:
                try:
                    pred_dt = datetime.fromisoformat(pred_timestamp.replace('Z', '+00:00'))
                    # Include ALL predictions from the document that fall within the 90-minute window
                    # This automatically gives us the complete graph since all predictions are present
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
        # Since predictions start 5 minutes ahead of source, we need to fetch from 5 minutes earlier
        # to get predictions that start at the target time
        # e.g., to get predictions starting at 90 min ago, fetch from 95 min ago (which predicts 5 min ahead = 90 min ago)
        time_90min_ago = current_time - timedelta(minutes=95)  # Fetch from 95 min ago to get predictions starting at 90 min ago
        time_60min_ago = current_time - timedelta(minutes=65)  # Fetch from 65 min ago to get predictions starting at 60 min ago
        time_30min_ago = current_time - timedelta(minutes=35)  # Fetch from 35 min ago to get predictions starting at 30 min ago
        
        logger.info(f"Historical predictions - Current time: {current_time.isoformat()}")
        logger.info(f"Historical predictions - Fetching from 95 min ago (to get predictions starting at 90 min ago): {time_90min_ago.isoformat()}")
        logger.info(f"Historical predictions - Fetching from 65 min ago (to get predictions starting at 60 min ago): {time_60min_ago.isoformat()}")
        logger.info(f"Historical predictions - Fetching from 35 min ago (to get predictions starting at 30 min ago): {time_30min_ago.isoformat()}")
        
        # Round each timestamp to nearest 5-minute interval
        rounded_90min = round_timestamp_to_5_minutes(time_90min_ago.isoformat())
        rounded_60min = round_timestamp_to_5_minutes(time_60min_ago.isoformat())
        rounded_30min = round_timestamp_to_5_minutes(time_30min_ago.isoformat())
        
        logger.info(f"Historical predictions - 95 min ago (rounded): {rounded_90min}")
        logger.info(f"Historical predictions - 65 min ago (rounded): {rounded_60min}")
        logger.info(f"Historical predictions - 35 min ago (rounded): {rounded_30min}")
        
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
        # We use source_timestamp to find the right documents (95, 65, 35 min ago)
        # Then include ALL predictions from those documents within the 90-minute window
        # This automatically gives us the complete graph since all predictions are present
        with ThreadPoolExecutor(max_workers=3) as executor:
            future_90_proc = executor.submit(_process_historical_prediction, pred_data_90, cutoff_time, current_time)
            future_60_proc = executor.submit(_process_historical_prediction, pred_data_60, cutoff_time, current_time)
            future_30_proc = executor.submit(_process_historical_prediction, pred_data_30, cutoff_time, current_time)
            
            predictions_90min = future_90_proc.result()
            predictions_60min = future_60_proc.result()
            predictions_30min = future_30_proc.result()
        
        logger.info(f"Historical predictions: 90min={len(predictions_90min)}, 60min={len(predictions_60min)}, 30min={len(predictions_30min)}")
        
        # Log first and last prediction timestamps for each period
        if predictions_90min:
            first_90 = predictions_90min[0].get('timestamp')
            last_90 = predictions_90min[-1].get('timestamp')
            logger.info(f"90min predictions - First: {first_90}, Last: {last_90}")
            first_90_dt = datetime.fromisoformat(first_90.replace('Z', '+00:00'))
            minutes_from_now_90 = (current_time - first_90_dt).total_seconds() / 60
            logger.info(f"90min predictions - First prediction is {minutes_from_now_90:.1f} minutes ago")
        
        if predictions_60min:
            first_60 = predictions_60min[0].get('timestamp')
            last_60 = predictions_60min[-1].get('timestamp')
            logger.info(f"60min predictions - First: {first_60}, Last: {last_60}")
            first_60_dt = datetime.fromisoformat(first_60.replace('Z', '+00:00'))
            minutes_from_now_60 = (current_time - first_60_dt).total_seconds() / 60
            logger.info(f"60min predictions - First prediction is {minutes_from_now_60:.1f} minutes ago")
        
        if predictions_30min:
            first_30 = predictions_30min[0].get('timestamp')
            last_30 = predictions_30min[-1].get('timestamp')
            logger.info(f"30min predictions - First: {first_30}, Last: {last_30}")
            first_30_dt = datetime.fromisoformat(first_30.replace('Z', '+00:00'))
            minutes_from_now_30 = (current_time - first_30_dt).total_seconds() / 60
            logger.info(f"30min predictions - First prediction is {minutes_from_now_30:.1f} minutes ago")
        
        return {
            'predictions_90min_ago': predictions_90min,
            'predictions_60min_ago': predictions_60min,
            'predictions_30min_ago': predictions_30min
        }
        
    except Exception as e:
        logger.error(f"Error fetching historical predictions: {str(e)}")
        return None


def get_all_predictions_data():
    """
    Gets all prediction data including current and historical predictions.
    Combines get_all_predictions() and get_historical_predictions() in parallel.
    
    Returns:
        dict: Combined prediction data with current and historical predictions
    """
    try:
        logger.info("Fetching all prediction data...")
        
        # Fetch both in parallel
        with ThreadPoolExecutor(max_workers=2) as executor:
            future_predictions = executor.submit(get_all_predictions)
            future_historical = executor.submit(get_historical_predictions)
            
            # Wait for all to complete with timeout handling
            try:
                predictions = future_predictions.result(timeout=10)
            except Exception as e:
                logger.warning(f"Predictions fetch failed: {str(e)}")
                predictions = None
            
            try:
                historical_predictions = future_historical.result(timeout=8)
            except Exception as e:
                logger.warning(f"Historical predictions fetch failed: {str(e)}")
                historical_predictions = None
        
        # Combine the data
        result = {
            'status': 'success',
            'predictions': predictions,
            'historical_predictions': historical_predictions
        }
        
        return result
        
    except Exception as e:
        logger.error(f"Error getting prediction data: {str(e)}")
        return {
            'status': 'error',
            'error': str(e),
            'predictions': None,
            'historical_predictions': None
        }
