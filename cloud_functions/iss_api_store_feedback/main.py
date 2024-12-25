import functions_framework
from flask import jsonify, request
import logging
from utils import validate_feedback_data, store_feedback, get_cors_headers, validate_api_key

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

@functions_framework.http
def iss_api_store_feedback(request):
    """
    HTTP Cloud Function to store user feedback in Firestore.
    
    Args:
        request (flask.Request): The request object
        
    Returns:
        flask.Response: JSON response indicating success or failure
    """
    # Handle CORS preflight request
    if request.method == 'OPTIONS':
        headers = get_cors_headers(is_preflight=True)
        return ('', 204, headers)

    try:
        # Validate API key
        if not validate_api_key(request):
            return jsonify({
                'error': 'Invalid or missing API key',
                'status': 'error'
            }), 401, get_cors_headers()

        # Get and validate request data
        request_json = request.get_json(silent=True)
        is_valid, error_message = validate_feedback_data(request_json)
        
        if not is_valid:
            return jsonify({
                'error': error_message,
                'status': 'error'
            }), 400, get_cors_headers()

        # Store the feedback
        success, message = store_feedback(request_json)
        
        if not success:
            return jsonify({
                'error': message,
                'status': 'error'
            }), 500, get_cors_headers()
        
        return jsonify({
            'message': message,
            'status': 'success'
        }), 200, get_cors_headers()

    except Exception as e:
        logger.error(f'Error in main function: {str(e)}')
        return jsonify({
            'error': 'Internal server error',
            'status': 'error'
        }), 500, get_cors_headers()
