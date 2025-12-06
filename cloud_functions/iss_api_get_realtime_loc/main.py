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
    import time
    import traceback
    request_start_time = time.time()
    
    try:
        # Get ISS location from NASA API
        logger.info("Fetching ISS location from NASA API...")
        iss_location_start = time.time()
        iss_location = fetch_iss_location()
        iss_location_duration = time.time() - iss_location_start
        
        if not iss_location:
            error_details = {
                'error_step': 'nasa_api_fetch',
                'nasa_api_duration_seconds': round(iss_location_duration, 2),
                'error_timestamp': time.time()
            }
            logger.error(f"Failed to fetch ISS location from NASA API after {iss_location_duration:.2f} seconds")
            return jsonify({
                'error': 'Failed to fetch ISS location from NASA API',
                'error_type': 'nasa_api_failure',
                'error_details': error_details
            }), 500

        logger.info(f"Successfully fetched ISS location in {iss_location_duration:.2f} seconds")

        # Get location details from BigDataCloud
        logger.info("Reverse geocoding location...")
        geocode_start = time.time()
        location_details = reverse_geocode(
            iss_location['latitude'],
            iss_location['longitude']
        )
        geocode_duration = time.time() - geocode_start

        if not location_details:
            logger.warning(f"Reverse geocoding failed after {geocode_duration:.2f} seconds, continuing without location details")
            # Don't fail the entire request if geocoding fails - location is still valid

        # Combine the data
        total_duration = time.time() - request_start_time
        response_data = {
            'timestamp': iss_location['timestamp'],
            'latitude': iss_location['latitude'],
            'longitude': iss_location['longitude'],
            'location_details': location_details if location_details else 'Location details unavailable',
            'timing': {
                'nasa_api_duration_seconds': round(iss_location_duration, 2),
                'geocode_duration_seconds': round(geocode_duration, 2),
                'total_duration_seconds': round(total_duration, 2)
            }
        }

        logger.info(f"Successfully processed request in {total_duration:.2f} seconds")
        return jsonify(response_data), 200

    except Exception as e:
        total_duration = time.time() - request_start_time
        error_details = {
            'error_step': 'internal_error',
            'exception_type': type(e).__name__,
            'total_duration_seconds': round(total_duration, 2),
            'traceback': traceback.format_exc(),
            'error_timestamp': time.time()
        }
        logger.error(f"Unexpected error in main function after {total_duration:.2f} seconds: {str(e)}")
        logger.error(f"Traceback: {traceback.format_exc()}")
        return jsonify({
            'error': 'Internal server error',
            'error_type': 'internal_code_error',
            'message': str(e),
            'error_details': error_details
        }), 500
