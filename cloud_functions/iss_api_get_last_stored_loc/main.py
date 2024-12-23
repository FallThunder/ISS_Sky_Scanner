import functions_framework
from flask import jsonify
import logging
from utils import get_last_stored_location

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

@functions_framework.http
def iss_api_get_last_stored_loc(request):
    """
    HTTP Cloud Function to get the latest stored location of the ISS from Firestore.
    This is an internal API meant to be called only by other APIs in this project.
    
    Args:
        request (flask.Request): The request object
    Returns:
        flask.Response: JSON response containing the latest ISS location data
    """
    try:
        # Get the latest location data
        location_data = get_last_stored_location()
        if not location_data:
            return jsonify({
                'error': 'No location data found',
                'status': 'error'
            }), 404

        # Return the data
        response_data = {
            'timestamp': location_data.get('timestamp'),
            'latitude': location_data.get('latitude'),
            'longitude': location_data.get('longitude'),
            'location_details': location_data.get('location', 'Location details unavailable'),
            'status': 'success',
            'version': '1.0'
        }

        return jsonify(response_data), 200

    except Exception as e:
        logger.error(f"Unexpected error in main function: {str(e)}")
        return jsonify({
            'error': 'Internal server error',
            'message': str(e),
            'status': 'error'
        }), 500
