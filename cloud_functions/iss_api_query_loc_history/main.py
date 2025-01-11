import functions_framework
from flask import jsonify, request
import logging
from utils import query_location_history, parse_timestamp
from typing import Dict, Any, Optional, Tuple

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

def parse_range_parameter(param: Optional[str]) -> Optional[Tuple[float, float]]:
    """
    Parse a range parameter from string format "min,max"
    
    Args:
        param (str): String in format "min,max"
        
    Returns:
        tuple: (min, max) values as floats, or None if param is None
    """
    if not param:
        return None
    try:
        min_val, max_val = map(float, param.split(','))
        return (min_val, max_val)
    except (ValueError, AttributeError) as e:
        raise ValueError(f"Invalid range format. Expected 'min,max', got: {param}")

@functions_framework.http
def iss_api_query_loc_history(request):
    """
    HTTP Cloud Function to query ISS location history from Firestore with various filters.
    This is an internal API meant to be called only by other APIs in this project.
    
    Query Parameters:
        start_time (str, optional): ISO format start timestamp
        end_time (str, optional): ISO format end timestamp
        country_code (str, optional): Two-letter country code to filter by
        latitude_range (str, optional): "min,max" latitude range
        longitude_range (str, optional): "min,max" longitude range
        limit (int, optional): Maximum number of results (default: 100)
        order_by (str, optional): Field to order by (default: 'timestamp')
        order_direction (str, optional): 'ASCENDING' or 'DESCENDING' (default: 'DESCENDING')
    
    Returns:
        flask.Response: JSON response containing the filtered ISS location data
    """
    try:
        # Extract query parameters
        params = request.args
        
        # Parse timestamps if provided
        start_time = params.get('start_time')
        end_time = params.get('end_time')
        if start_time:
            parse_timestamp(start_time)  # Validate format
        if end_time:
            parse_timestamp(end_time)  # Validate format
            
        # Parse range parameters
        try:
            lat_range = parse_range_parameter(params.get('latitude_range'))
            lon_range = parse_range_parameter(params.get('longitude_range'))
        except ValueError as e:
            return jsonify({
                'error': str(e),
                'status': 'error'
            }), 400
            
        # Get other parameters
        country_code = params.get('country_code')
        limit = min(int(params.get('limit', 100)), 1000)  # Cap at 1000 results
        order_by = params.get('order_by', 'timestamp')
        order_direction = params.get('order_direction', 'DESCENDING')
        
        # Validate order_by field
        valid_fields = {'timestamp', 'latitude', 'longitude', 'country_code'}
        if order_by not in valid_fields:
            return jsonify({
                'error': f'Invalid order_by field. Must be one of: {valid_fields}',
                'status': 'error'
            }), 400
            
        # Query the data
        results = query_location_history(
            start_time=start_time,
            end_time=end_time,
            country_code=country_code,
            latitude_range=lat_range,
            longitude_range=lon_range,
            limit=limit,
            order_by=order_by,
            order_direction=order_direction
        )
        
        if not results:
            return jsonify({
                'error': 'No matching location data found',
                'status': 'error'
            }), 404

        # Return the data
        response_data = {
            'locations': results,
            'count': len(results),
            'status': 'success',
            'version': '1.0'
        }

        return jsonify(response_data), 200

    except ValueError as e:
        logger.error(f"Validation error: {str(e)}")
        return jsonify({
            'error': str(e),
            'status': 'error'
        }), 400
    except Exception as e:
        logger.error(f"Unexpected error in main function: {str(e)}")
        return jsonify({
            'error': 'Internal server error',
            'message': str(e),
            'status': 'error'
        }), 500
