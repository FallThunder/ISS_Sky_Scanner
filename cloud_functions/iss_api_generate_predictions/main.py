import functions_framework
from flask import jsonify
import logging
from utils import generate_predictions_from_location_data

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


@functions_framework.http
def iss_api_generate_predictions(request):
    """
    HTTP Cloud Function to generate ISS position predictions.
    This is an internal API meant to be called only by other APIs in this project.
    
    Expected JSON body:
    {
        "timestamp": "2024-01-15T15:00:00Z",
        "latitude": 45.123,
        "longitude": -122.678,
        "document_id": "abc123xyz456",
        "location": "Portland, Oregon, USA",
        "country_code": "US"
    }
    
    Args:
        request (flask.Request): The request object
    Returns:
        flask.Response: JSON response containing prediction generation status
    """
    try:
        # Check if request has JSON data
        if not request.is_json:
            return jsonify({
                'error': 'Request must contain JSON data',
                'status': 'error'
            }), 400
        
        # Get location data from request
        location_data = request.get_json()
        
        # Validate required fields
        required_fields = ['timestamp', 'latitude', 'longitude', 'document_id']
        missing_fields = [field for field in required_fields if field not in location_data]
        if missing_fields:
            return jsonify({
                'error': f'Missing required fields: {", ".join(missing_fields)}',
                'status': 'error'
            }), 400
        
        # Generate predictions
        logger.info("Generating predictions...")
        result = generate_predictions_from_location_data(location_data)
        
        if result.get('error'):
            logger.error(f"Error generating predictions: {result.get('error')}")
            return jsonify({
                'error': result.get('error'),
                'status': 'error'
            }), 500
        
        return jsonify({
            'status': 'success',
            'data': result
        }), 200
        
    except Exception as e:
        error_msg = f"Unexpected error in main function: {str(e)}"
        logger.error(error_msg)
        return jsonify({
            'error': error_msg,
            'status': 'error'
        }), 500
