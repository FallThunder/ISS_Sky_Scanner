import functions_framework
from flask import jsonify
from utils import fetch_iss_location, reverse_geocode
import logging

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

@functions_framework.http
def iss_api_get_realtime_loc(request):
    """
    HTTP Cloud Function to get the current location of the ISS.
    This is an internal API meant to be called only by other APIs in this project.
    
    Args:
        request (flask.Request): The request object
    Returns:
        flask.Response: JSON response containing ISS location data
    """
    try:
        # Get ISS location
        iss_location = fetch_iss_location()
        if not iss_location:
            return jsonify({
                'error': 'Failed to fetch ISS location'
            }), 500

        # Get location details
        location_details = reverse_geocode(
            iss_location['latitude'],
            iss_location['longitude']
        )

        # Combine the data
        response_data = {
            'timestamp': iss_location['timestamp'],
            'latitude': iss_location['latitude'],
            'longitude': iss_location['longitude'],
            'location_details': location_details if location_details else 'Location details unavailable'
        }

        return jsonify(response_data), 200

    except Exception as e:
        logger.error(f"Unexpected error in main function: {str(e)}")
        return jsonify({
            'error': 'Internal server error',
            'message': str(e)
        }), 500
