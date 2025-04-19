import functions_framework
from flask import jsonify, request
import logging
from datetime import datetime, timedelta
from utils import query_time_range
from flask_cors import CORS

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

@functions_framework.http
def iss_api_query_time_range(request):
    """
    HTTP Cloud Function to query ISS location history for a specified number of minutes.
    
    Query Parameters:
        minutes (int): Number of minutes of history to fetch (default: 60, max: 1440)
    
    Returns:
        flask.Response: JSON response containing the ISS location data for the time range
    """
    # Handle CORS
    if request.method == 'OPTIONS':
        headers = {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET',
            'Access-Control-Allow-Headers': 'Content-Type',
            'Access-Control-Max-Age': '3600'
        }
        return ('', 204, headers)

    # Set CORS headers for the main request
    headers = {
        'Access-Control-Allow-Origin': '*'
    }
    
    try:
        # Get minutes parameter, default to 60 minutes (1 hour), cap at 1440 (24 hours)
        try:
            minutes = min(max(int(request.args.get('minutes', 60)), 1), 1440)
        except ValueError:
            return jsonify({
                'error': 'Minutes parameter must be an integer',
                'status': 'error'
            }), 400, headers

        # Query the data
        results = query_time_range(minutes=minutes)
        
        if not results:
            return jsonify({
                'error': 'No location data found for the specified time range',
                'status': 'error'
            }), 404, headers

        # Return the data
        response_data = {
            'locations': results,
            'count': len(results),
            'minutes_requested': minutes,
            'status': 'success'
        }

        return jsonify(response_data), 200, headers

    except Exception as e:
        logger.error(f"Unexpected error in main function: {str(e)}")
        return jsonify({
            'error': 'Internal server error',
            'message': str(e),
            'status': 'error'
        }), 500, headers
