from google.cloud import firestore
from datetime import datetime, timedelta
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
        
        # Calculate time range
        now = datetime.utcnow()
        start_time = now - timedelta(minutes=minutes)
        
        # Convert to ISO format strings
        start_time_str = start_time.isoformat() + 'Z'
        now_str = now.isoformat() + 'Z'
        
        # Build and execute query
        query = db.collection('iss_loc_history')\
            .where('timestamp', '>=', start_time_str)\
            .where('timestamp', '<=', now_str)\
            .order_by('timestamp', direction=firestore.Query.DESCENDING)
        
        # Execute query
        docs = query.stream()
        
        # Convert to list of dictionaries with only required fields
        results = []
        for doc in docs:
            data = doc.to_dict()
            results.append({
                'timestamp': data['timestamp'],
                'latitude': data['latitude'],
                'longitude': data['longitude'],
                'location': data.get('location', '')  # Using get() with default empty string
            })
            
        logger.info(f"Found {len(results)} records in the last {minutes} minutes")
        return results
        
    except Exception as e:
        logger.error(f"Error querying location history: {str(e)}")
        raise
