from google.cloud import firestore
from google.cloud import secretmanager
from datetime import datetime, timezone
import logging

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Initialize Firestore client
db = firestore.Client()
collection_name = 'iss_sky_scanner_feedback'

def get_secret(secret_id):
    """
    Gets a secret from Google Secret Manager.
    
    Args:
        secret_id: The ID of the secret to get
        
    Returns:
        str: The secret value
    """
    try:
        client = secretmanager.SecretManagerServiceClient()
        name = f"projects/iss-sky-scanner-20241222/secrets/{secret_id}/versions/latest"
        response = client.access_secret_version(request={"name": name})
        return response.payload.data.decode("UTF-8")
    except Exception as e:
        logger.error(f"Error getting secret {secret_id}: {str(e)}")
        return None

def validate_api_key(request):
    """
    Validates the API key from the request.
    
    Args:
        request: The Flask request object
        
    Returns:
        bool: Whether the API key is valid
    """
    try:
        # Get API key from query parameters
        api_key = request.args.get('api_key')
        if not api_key:
            logger.warning("No API key provided")
            return False
            
        # Get valid API key from Secret Manager
        valid_key = get_secret('iss-feedback-api-key')
        if not valid_key:
            logger.error("Could not retrieve valid API key")
            return False
            
        # Compare keys
        return api_key == valid_key
        
    except Exception as e:
        logger.error(f"Error validating API key: {str(e)}")
        return False

def validate_feedback_data(request_json):
    """
    Validates the feedback data from the request.
    
    Args:
        request_json: The JSON data from the request
        
    Returns:
        tuple: (is_valid, error_message)
    """
    if not request_json:
        return False, 'No JSON data provided'

    # Validate required fields
    required_fields = ['rating', 'feedback']
    for field in required_fields:
        if field not in request_json:
            return False, f'Missing required field: {field}'

    # Validate rating
    rating = request_json['rating']
    if not isinstance(rating, int) or rating < 1 or rating > 5:
        return False, 'Rating must be an integer between 1 and 5'

    # Validate feedback length
    feedback = request_json['feedback'].strip()
    word_count = len(feedback.split())
    if word_count > 100:
        return False, 'Feedback must not exceed 100 words'

    return True, None

def store_feedback(feedback_data):
    """
    Stores the feedback data in Firestore.
    
    Args:
        feedback_data: Dictionary containing the feedback data
        
    Returns:
        tuple: (success, message)
    """
    try:
        # Prepare document data
        doc_data = {
            'rating': feedback_data['rating'],
            'feedback': feedback_data['feedback'].strip(),
            'timestamp': datetime.now(timezone.utc).isoformat(),
            'user_agent': feedback_data.get('userAgent', 'Not provided')
        }

        # Store in Firestore
        doc_ref = db.collection(collection_name).document()
        doc_ref.set(doc_data)
        
        logger.info(f'Stored feedback with ID: {doc_ref.id}')
        return True, 'Feedback stored successfully'

    except Exception as e:
        logger.error(f'Error storing feedback: {str(e)}')
        return False, 'Internal server error'

def get_cors_headers(is_preflight=False):
    """
    Returns the appropriate CORS headers.
    
    Args:
        is_preflight: Whether this is a preflight request
        
    Returns:
        dict: CORS headers
    """
    headers = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Requested-With'
    }
    
    if is_preflight:
        headers['Access-Control-Max-Age'] = '3600'
    
    return headers
