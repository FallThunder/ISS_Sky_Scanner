from google.cloud import firestore
from datetime import datetime
import logging
from typing import Dict, Any, List, Optional

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

def parse_timestamp(timestamp_str: str) -> datetime:
    """
    Parse an ISO format timestamp string into a datetime object.
    
    Args:
        timestamp_str (str): ISO format timestamp string
        
    Returns:
        datetime: Parsed datetime object
    """
    try:
        return datetime.fromisoformat(timestamp_str.replace('Z', '+00:00'))
    except ValueError as e:
        logger.error(f"Error parsing timestamp {timestamp_str}: {e}")
        raise ValueError(f"Invalid timestamp format. Expected ISO format, got: {timestamp_str}")

def query_location_history(
    start_time: Optional[str] = None,
    end_time: Optional[str] = None,
    country_code: Optional[str] = None,
    latitude_range: Optional[tuple] = None,
    longitude_range: Optional[tuple] = None,
    limit: int = 100,
    order_by: str = 'timestamp',
    order_direction: str = 'DESCENDING'
) -> List[Dict[str, Any]]:
    """
    Query ISS location history with a single filter parameter.
    Note: Only one filter parameter (start_time/end_time, country_code, latitude_range, or longitude_range)
    should be provided at a time to avoid complex indexing requirements.
    
    Args:
        start_time (str, optional): ISO format start timestamp
        end_time (str, optional): ISO format end timestamp
        country_code (str, optional): Two-letter country code to filter by
        latitude_range (tuple, optional): (min_lat, max_lat) to filter by
        longitude_range (tuple, optional): (min_lon, max_lon) to filter by
        limit (int): Maximum number of results to return (default: 100)
        order_by (str): Field to order by (default: 'timestamp')
        order_direction (str): 'ASCENDING' or 'DESCENDING' (default: 'DESCENDING')
        
    Returns:
        List[Dict]: List of location data entries matching the criteria
    """
    try:
        # Initialize Firestore client
        db = firestore.Client()
        
        # Start building the query
        query = db.collection('iss_loc_history')
        
        # Count how many filters are being applied
        filter_count = sum(1 for x in [
            bool(start_time or end_time),  # Count time range as one filter
            bool(country_code),
            bool(latitude_range),
            bool(longitude_range)
        ] if x)
        
        if filter_count > 1:
            raise ValueError("Only one filter parameter can be used at a time")
        
        # Apply single filter based on which parameter is provided
        if start_time or end_time:
            if start_time:
                query = query.where('timestamp', '>=', start_time)
            if end_time:
                query = query.where('timestamp', '<=', end_time)
        elif country_code:
            query = query.where('country_code', '==', country_code.upper())
        elif latitude_range:
            min_lat, max_lat = latitude_range
            query = query.where('latitude', '>=', float(min_lat))
            query = query.where('latitude', '<=', float(max_lat))
        elif longitude_range:
            min_lon, max_lon = longitude_range
            query = query.where('longitude', '>=', float(min_lon))
            query = query.where('longitude', '<=', float(max_lon))
        
        # Apply ordering
        direction = firestore.Query.DESCENDING if order_direction.upper() == 'DESCENDING' else firestore.Query.ASCENDING
        query = query.order_by(order_by, direction=direction)
        
        # Apply limit
        query = query.limit(limit)
        
        # Execute query
        docs = query.stream()
        
        # Convert to list of dictionaries
        results = []
        for doc in docs:
            data = doc.to_dict()
            results.append(data)
            
        logger.info(f"Found {len(results)} matching records")
        return results
        
    except Exception as e:
        logger.error(f"Error querying location history: {str(e)}")
        raise
