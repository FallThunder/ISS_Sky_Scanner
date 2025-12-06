"""
Utilities for ISS prediction BFF API.

This module handles fetching and processing ISS location predictions from Firestore.
All predictions use orbital mechanics calculations (SGP4 removed).
"""
import logging
from concurrent.futures import ThreadPoolExecutor
from google.cloud import secretmanager
from google.cloud import firestore
from datetime import datetime, timezone, timedelta
import time
from typing import Dict, List, Optional, Any

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


def get_secret(secret_id: str) -> str:
    """
    Gets a secret from Secret Manager with caching for API keys.
    
    Args:
        secret_id: The secret ID to retrieve
        
    Returns:
        The secret value as a string
        
    Raises:
        Exception: If secret retrieval fails
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
    Rounds an ISO timestamp down to the nearest 5-minute interval (floor).
    This matches how prediction documents are stored in Firestore.
    
    Args:
        iso_timestamp: ISO format timestamp string
        
    Returns:
        ISO format timestamp string rounded down to 5-minute interval
    """
    try:
        dt = datetime.fromisoformat(iso_timestamp.replace('Z', '+00:00'))
        # Floor to 5-minute interval
        minutes = dt.minute
        rounded_minutes = (minutes // 5) * 5
        rounded_dt = dt.replace(minute=rounded_minutes, second=0, microsecond=0)
        return rounded_dt.isoformat()
    except Exception as e:
        logger.error(f"Error rounding timestamp: {str(e)}")
        return iso_timestamp


def fetch_prediction_document(source_timestamp: str) -> Optional[Dict[str, Any]]:
    """
    Fetches a prediction document from Firestore by source timestamp.
    
    Args:
        source_timestamp: ISO format timestamp (will be rounded to 5-minute interval)
        
    Returns:
        Dictionary with prediction data or None if not found
    """
    try:
        rounded_timestamp = round_timestamp_to_5_minutes(source_timestamp)
        logger.info(f"Fetching prediction document for source timestamp: {rounded_timestamp}")
        
        doc_ref = db.collection('iss_loc_predictions').document(rounded_timestamp)
        doc = doc_ref.get()
        
        if not doc.exists:
            logger.warning(f"No prediction document found for timestamp: {rounded_timestamp}")
            return None
        
        data = doc.to_dict()
        predictions = data.get('predictions', [])
        
        if not predictions:
            logger.warning(f"Document {rounded_timestamp} exists but has no predictions")
            return None
        
        # Filter to only orbital mechanics predictions (no SGP4)
        orbital_predictions = [
            p for p in predictions 
            if p.get('method') == 'orbital_mechanics'
        ]
        
        if orbital_predictions:
            first_pred = orbital_predictions[0].get('timestamp')
            last_pred = orbital_predictions[-1].get('timestamp')
            logger.info(
                f"Found {len(orbital_predictions)} orbital predictions: "
                f"{first_pred} to {last_pred}"
            )
        
        return {
            'orbital_mechanics': orbital_predictions,
            'source_timestamp': data.get('source_timestamp'),
            'prediction_count': len(orbital_predictions)
        }
        
    except Exception as e:
        logger.error(f"Error fetching prediction document: {str(e)}")
        return None


def get_current_predictions() -> Dict[str, Any]:
    """
    Fetches the most recent prediction document and returns only future predictions.
    
    Returns:
        Dictionary with orbital_mechanics predictions and metadata
    """
    try:
        logger.info("Fetching current predictions from Firestore")
        
        current_time = datetime.now(timezone.utc)
        
        # Query for the most recent prediction document
        predictions_collection = db.collection('iss_loc_predictions')
        query = (
            predictions_collection
            .order_by('source_timestamp', direction=firestore.Query.DESCENDING)
            .limit(1)
        )
        docs = list(query.stream())
        
        if not docs:
            logger.warning("No prediction documents found in Firestore")
            return {
                'orbital_mechanics': [],
                'prediction_count': 0
            }
        
        # Get the most recent document
        doc = docs[0]
        doc_data = doc.to_dict()
        source_timestamp = doc_data.get('source_timestamp')
        predictions = doc_data.get('predictions', [])
        
        logger.info(
            f"Processing latest document with source_timestamp: {source_timestamp}, "
            f"{len(predictions)} total predictions"
        )
        
        # Filter to only future orbital mechanics predictions
        future_predictions = []
        past_count = 0
        
        for pred in predictions:
            # Only include orbital mechanics predictions
            if pred.get('method') != 'orbital_mechanics':
                continue
            
            pred_timestamp = pred.get('timestamp')
            if not pred_timestamp:
                continue
            
            try:
                pred_dt = datetime.fromisoformat(pred_timestamp.replace('Z', '+00:00'))
                if pred_dt <= current_time:
                    past_count += 1
                    continue
                
                # Add source_timestamp to prediction
                pred_with_source = pred.copy()
                pred_with_source['source_timestamp'] = source_timestamp
                future_predictions.append(pred_with_source)
                
            except Exception as e:
                logger.warning(f"Error processing prediction: {str(e)}")
                continue
        
        # Sort by timestamp
        future_predictions.sort(key=lambda x: x.get('timestamp', ''))
        
        logger.info(
            f"From latest document: {len(future_predictions)} future predictions, "
            f"{past_count} past predictions filtered out"
        )
        
        return {
            'orbital_mechanics': future_predictions,
            'prediction_count': len(future_predictions)
        }
        
    except Exception as e:
        logger.error(f"Error fetching current predictions: {str(e)}")
        return {
            'orbital_mechanics': [],
            'prediction_count': 0
        }


def process_historical_predictions(pred_data: Optional[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """
    Processes historical prediction data into a list of predictions.
    
    Args:
        pred_data: Prediction data from Firestore or None
        
    Returns:
        List of prediction dictionaries with timestamp, latitude, longitude, source_timestamp
    """
    predictions_list = []
    
    if not pred_data or not pred_data.get('orbital_mechanics'):
        return predictions_list
    
    for pred in pred_data['orbital_mechanics']:
        pred_timestamp = pred.get('timestamp')
        if not pred_timestamp:
            continue
        
        try:
            # Validate timestamp format
            datetime.fromisoformat(pred_timestamp.replace('Z', '+00:00'))
            
            predictions_list.append({
                'timestamp': pred_timestamp,
                'latitude': pred.get('latitude'),
                'longitude': pred.get('longitude'),
                'source_timestamp': pred_data.get('source_timestamp')
            })
        except Exception as e:
            logger.warning(
                f"Error processing prediction with timestamp {pred_timestamp}: {str(e)}"
            )
            continue
    
    # Sort by timestamp to ensure correct order
    predictions_list.sort(key=lambda x: x.get('timestamp', ''))
    
    if predictions_list:
        logger.info(
            f"Processed {len(predictions_list)} predictions: "
            f"{predictions_list[0].get('timestamp')} to "
            f"{predictions_list[-1].get('timestamp')}"
        )
    
    return predictions_list


def get_historical_predictions() -> Dict[str, List[Dict[str, Any]]]:
    """
    Fetches predictions made at 90, 60, and 30 minutes ago.
    
    Key insight: Predictions are generated starting 5 minutes ahead of the source timestamp.
    So to get predictions that start at time T, we fetch the document with source_timestamp = T - 5 minutes.
    
    For historical predictions:
    - 90 min ago predictions: fetch document from 95 min ago (predictions start at 90 min ago)
    - 60 min ago predictions: fetch document from 65 min ago (predictions start at 60 min ago)
    - 30 min ago predictions: fetch document from 35 min ago (predictions start at 30 min ago)
    
    Returns:
        Dictionary with keys: predictions_90min_ago, predictions_60min_ago, predictions_30min_ago
        Each value is a list of prediction dictionaries
    """
    try:
        current_time = datetime.now(timezone.utc)
        
        # Calculate source timestamps for historical predictions
        # Predictions start 5 minutes ahead, so subtract 5 more minutes
        time_90min_source = current_time - timedelta(minutes=95)
        time_60min_source = current_time - timedelta(minutes=65)
        time_30min_source = current_time - timedelta(minutes=35)
        
        logger.info(f"Historical predictions - Current time: {current_time.isoformat()}")
        logger.info(
            f"Fetching documents from: "
            f"95min ago ({time_90min_source.isoformat()}), "
            f"65min ago ({time_60min_source.isoformat()}), "
            f"35min ago ({time_30min_source.isoformat()})"
        )
        
        # Round timestamps to 5-minute intervals
        rounded_90min = round_timestamp_to_5_minutes(time_90min_source.isoformat())
        rounded_60min = round_timestamp_to_5_minutes(time_60min_source.isoformat())
        rounded_30min = round_timestamp_to_5_minutes(time_30min_source.isoformat())
        
        logger.info(
            f"Rounded timestamps: "
            f"90min={rounded_90min}, "
            f"60min={rounded_60min}, "
            f"30min={rounded_30min}"
        )
        
        # Fetch prediction documents in parallel
        with ThreadPoolExecutor(max_workers=3) as executor:
            future_90 = executor.submit(fetch_prediction_document, rounded_90min)
            future_60 = executor.submit(fetch_prediction_document, rounded_60min)
            future_30 = executor.submit(fetch_prediction_document, rounded_30min)
            
            pred_data_90 = future_90.result()
            pred_data_60 = future_60.result()
            pred_data_30 = future_30.result()
        
        # Process predictions in parallel
        with ThreadPoolExecutor(max_workers=3) as executor:
            future_90_proc = executor.submit(process_historical_predictions, pred_data_90)
            future_60_proc = executor.submit(process_historical_predictions, pred_data_60)
            future_30_proc = executor.submit(process_historical_predictions, pred_data_30)
            
            predictions_90min = future_90_proc.result()
            predictions_60min = future_60_proc.result()
            predictions_30min = future_30_proc.result()
        
        logger.info(
            f"Historical predictions retrieved: "
            f"90min={len(predictions_90min)}, "
            f"60min={len(predictions_60min)}, "
            f"30min={len(predictions_30min)}"
        )
        
        # Log timestamp ranges for debugging
        if predictions_90min:
            first_90 = predictions_90min[0].get('timestamp')
            last_90 = predictions_90min[-1].get('timestamp')
            first_90_dt = datetime.fromisoformat(first_90.replace('Z', '+00:00'))
            minutes_ago = (current_time - first_90_dt).total_seconds() / 60
            logger.info(
                f"90min predictions: {first_90} to {last_90} "
                f"(first is {minutes_ago:.1f} minutes ago)"
            )
        
        if predictions_60min:
            first_60 = predictions_60min[0].get('timestamp')
            last_60 = predictions_60min[-1].get('timestamp')
            first_60_dt = datetime.fromisoformat(first_60.replace('Z', '+00:00'))
            minutes_ago = (current_time - first_60_dt).total_seconds() / 60
            logger.info(
                f"60min predictions: {first_60} to {last_60} "
                f"(first is {minutes_ago:.1f} minutes ago)"
            )
        
        if predictions_30min:
            first_30 = predictions_30min[0].get('timestamp')
            last_30 = predictions_30min[-1].get('timestamp')
            first_30_dt = datetime.fromisoformat(first_30.replace('Z', '+00:00'))
            minutes_ago = (current_time - first_30_dt).total_seconds() / 60
            logger.info(
                f"30min predictions: {first_30} to {last_30} "
                f"(first is {minutes_ago:.1f} minutes ago)"
            )
        
        return {
            'predictions_90min_ago': predictions_90min,
            'predictions_60min_ago': predictions_60min,
            'predictions_30min_ago': predictions_30min
        }
        
    except Exception as e:
        logger.error(f"Error fetching historical predictions: {str(e)}")
        return {
            'predictions_90min_ago': [],
            'predictions_60min_ago': [],
            'predictions_30min_ago': []
        }


def get_all_predictions_data() -> Dict[str, Any]:
    """
    Fetches all prediction data including current and historical predictions.
    Executes both fetches in parallel for better performance.
    
    Returns:
        Dictionary with status, predictions, and historical_predictions
    """
    try:
        logger.info("Fetching all prediction data...")
        
        # Fetch both in parallel
        with ThreadPoolExecutor(max_workers=2) as executor:
            future_current = executor.submit(get_current_predictions)
            future_historical = executor.submit(get_historical_predictions)
            
            # Wait for results with timeout handling
            try:
                current_predictions = future_current.result(timeout=10)
            except Exception as e:
                logger.warning(f"Current predictions fetch failed: {str(e)}")
                current_predictions = {
                    'orbital_mechanics': [],
                    'prediction_count': 0
                }
            
            try:
                historical_predictions = future_historical.result(timeout=8)
            except Exception as e:
                logger.warning(f"Historical predictions fetch failed: {str(e)}")
                historical_predictions = {
                    'predictions_90min_ago': [],
                    'predictions_60min_ago': [],
                    'predictions_30min_ago': []
                }
        
        return {
            'status': 'success',
            'predictions': current_predictions,
            'historical_predictions': historical_predictions
        }
        
    except Exception as e:
        logger.error(f"Error getting prediction data: {str(e)}")
        return {
            'status': 'error',
            'error': str(e),
            'predictions': {
                'orbital_mechanics': [],
                'prediction_count': 0
            },
            'historical_predictions': {
                'predictions_90min_ago': [],
                'predictions_60min_ago': [],
                'predictions_30min_ago': []
            }
        }
