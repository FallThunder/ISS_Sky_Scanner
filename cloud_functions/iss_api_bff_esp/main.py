import logging
import functions_framework
from flask import jsonify, request
from utils import get_iss_location_with_fact, get_secret

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

@functions_framework.http
def iss_api_bff_esp(request):
    """
    Backend for Frontend (BFF) for the ESP IoT app.
    Combines data from iss_api_get_last_stored_loc and iss_api_get_loc_fact.
    
    Returns:
        JSON response with ISS location data and fun fact
    """
    # Handle CORS preflight request
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
        'Access-Control-Allow-Origin': '*',
        'Content-Type': 'application/json'
    }

    # Validate API key from query parameters
    api_key = request.args.get('api_key')
    if not api_key:
        logger.warning("No API key provided")
        return (jsonify({'error': 'API key is missing'}), 400, headers)
    
    try:
        expected_api_key = get_secret('iss-sky-scanner-esp-api-key')
        if api_key != expected_api_key:
            logger.warning("Invalid API key")
            return (jsonify({'error': 'Invalid API key'}), 403, headers)
    except Exception as e:
        logger.error(f"Error validating API key: {str(e)}")
        return (jsonify({'error': 'Error validating API key'}), 500, headers)

    # Get ISS location with fun fact
    result = get_iss_location_with_fact()
    if not result:
        return (jsonify({'error': 'Failed to get ISS location data'}), 500, headers)

    return (jsonify(result), 200, headers)
