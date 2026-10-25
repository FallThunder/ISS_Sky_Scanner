from google.cloud import firestore
from datetime import datetime, timedelta, timezone
import logging
from typing import Dict, Any, List

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

def query_time_range(minutes: int = 60) -> List[Dict[str, Any]]:
    """
    Query ISS location history for a specified number of minutes from now.
    
    Args:
        minutes (int): Number of minutes of history to fetch (default: 60)
        
    Returns:
        List[Dict]: List of location data entries within the time range
    """
    try:
        # Initialize Firestore client
        db = firestore.Client()
        
        # Calculate time range. Stored timestamps are ISO strings with a
        # +00:00 offset, so the bounds use the same format to compare
        # correctly as strings.
        now = datetime.now(timezone.utc)
        start_time = now - timedelta(minutes=minutes)
        
        start_time_str = start_time.isoformat()
        now_str = now.isoformat()
        
        # Build and execute query
        query = db.collection('iss_loc_history')\
            .where('timestamp', '>=', start_time_str)\
            .where('timestamp', '<=', now_str)\
            .order_by('timestamp', direction=firestore.Query.DESCENDING)
        
        # Execute query
        docs = query.stream()
        
        # Convert to list of dictionaries with only required fields,
        # keeping one entry per timestamp (a real location wins over an
        # error entry for the same slot)
        results = []
        index_by_timestamp = {}
        for doc in docs:
            data = doc.to_dict()
            
            # Error entries mark a failed fetch: no coordinates
            if data.get('is_error_entry', False):
                entry = {
                    'timestamp': data['timestamp'],
                    'latitude': None,
                    'longitude': None,
                    'location': None,
                    'isEmpty': True
                }
            else:
                entry = {
                    'timestamp': data['timestamp'],
                    'latitude': data.get('latitude'),
                    'longitude': data.get('longitude'),
                    'location': data.get('location', ''),
                    'isEmpty': data.get('isEmpty', False)
                }
            
            existing_index = index_by_timestamp.get(entry['timestamp'])
            if existing_index is None:
                index_by_timestamp[entry['timestamp']] = len(results)
                results.append(entry)
            elif results[existing_index]['isEmpty'] and not entry['isEmpty']:
                results[existing_index] = entry
            
        logger.info(f"Found {len(results)} records in the last {minutes} minutes")
        return results
        
    except Exception as e:
        logger.error(f"Error querying location history: {str(e)}")
        raise
