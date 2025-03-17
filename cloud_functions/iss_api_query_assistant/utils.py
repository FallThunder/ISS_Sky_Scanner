from typing import Dict, Any
import requests
import logging
from google.cloud import secretmanager
import google.auth.transport.requests
import google.auth
import google.oauth2.id_token

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

def get_gemini_api_key() -> str:
    """
    Get the Gemini API key from Secret Manager.
    
    Returns:
        str: The API key
    """
    try:
        client = secretmanager.SecretManagerServiceClient()
        name = "projects/iss-sky-scanner-20241222/secrets/iss-sky-scanner-google-studio-api-key/versions/latest"
        response = client.access_secret_version(request={"name": name})
        return response.payload.data.decode("UTF-8")
    except Exception as e:
        logger.error(f"Error getting Gemini API key: {str(e)}")
        raise

# System prompt that sets the context
SYSTEM_PROMPT = """You are a friendly AI assistant that helps people find information about the International Space Station's location and basic facts. The database is updated every 5 minutes with the ISS's location.

RESPONSE FORMAT:
For database queries, respond with:
{
    "message": "[Your friendly response here]",
    "action": "query_db",
    "data": {
        "collection": "iss_loc_history",
        [appropriate query parameters based on the question]
    }
}

For basic ISS facts (altitude, speed, size), respond with:
{
    "message": "[Your friendly response about the requested fact]",
    "action": "none",
    "data": {}
}

For feedback submissions, respond with:
{
    "message": "[Your friendly thank you message]",
    "action": "store_feedback",
    "data": {
        "collection": "iss_sky_scanner_feedback",
        "rating": "[rating]",
        "feedback": "[feedback]"
    }
}

For non-ISS queries, respond with:
{
    "message": "[Your friendly response explaining your focus on ISS-related questions]",
    "action": "none",
    "data": {}
}

PERSONALITY GUIDELINES:
1. Be friendly and enthusiastic
2. Be direct and concise
3. Focus on providing accurate information
4. Use a conversational tone
5. Be helpful and encouraging

CRITICAL RULES:
1. NEVER add explanations about how you work
2. NEVER mention database details or limitations
3. NEVER apologize or express uncertainty
4. NEVER handle feedback outside of the exact format above
5. For current location queries, ALWAYS query the database for the most recent entry
6. For country queries, use standard ISO country codes (US, IN, GB, FR, DE, JP, CA, AU, etc.)"""

def query_gemini(prompt: str, api_key: str) -> Dict[Any, Any]:
    """
    Query the Gemini API with a given prompt.
    
    Args:
        prompt (str): The text prompt to send to Gemini
        api_key (str): The API key for Gemini
        
    Returns:
        Dict: The JSON response from the API
    """
    # Combine system prompt with user's question
    full_prompt = f"{SYSTEM_PROMPT}\n\nQuestion: {prompt}\nAnswer:"

    # API endpoint
    url = f"https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent"
    
    # Request headers
    headers = {
        'Content-Type': 'application/json'
    }
    
    # Request payload
    payload = {
        "contents": [{
            "parts": [{"text": full_prompt}]
        }]
    }
    
    try:
        # Make the API request
        response = requests.post(
            f"{url}?key={api_key}",
            headers=headers,
            json=payload
        )
        
        # Check if request was successful
        response.raise_for_status()
        
        # Return the JSON response
        return response.json()
        
    except requests.exceptions.RequestException as e:
        logger.error(f"Error making request to Gemini API: {e}")
        raise

def extract_response_text(response: Dict[Any, Any]) -> str:
    """
    Extract the text response from Gemini API's JSON response.
    
    Args:
        response (Dict): The JSON response from Gemini API
        
    Returns:
        str: The extracted text response
    """
    try:
        return response['candidates'][0]['content']['parts'][0]['text']
    except (KeyError, IndexError) as e:
        logger.error(f"Error extracting response text: {e}")
        return "Sorry, I couldn't process that response."

def get_cors_headers(is_preflight: bool = False) -> Dict[str, str]:
    """
    Returns the appropriate CORS headers.
    
    Args:
        is_preflight (bool): Whether this is a preflight request
        
    Returns:
        Dict[str, str]: CORS headers
    """
    headers = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization'
    }
    
    if is_preflight:
        headers['Access-Control-Max-Age'] = '3600'
    
    return headers

def query_database(query_data, auth_session):
    """
    Query the ISS location history database using the provided query data.
    
    Args:
        query_data (dict): Query parameters from the AI response
        auth_session: Authenticated session for making requests
        
    Returns:
        dict: Formatted response from the database
    """
    logger.info(f"Querying database with data: {query_data}")
    
    # Use the parameters directly from the AI's query_data
    params = {}
    for key in ['country_code', 'limit', 'order_by', 'order_direction']:
        if key in query_data:
            params[key] = query_data[key]
    
    logger.info(f"Using parameters: {params}")
    
    # Make the request to the location history API
    url = "https://us-east1-iss-sky-scanner-20241222.cloudfunctions.net/iss_api_query_loc_history"
    
    try:
        # Get credentials and create request object
        credentials, project = google.auth.default()
        request = google.auth.transport.requests.Request()
        
        # Refresh credentials
        credentials.refresh(request)
        
        # Get ID token with audience set to the target URL
        token = google.oauth2.id_token.fetch_id_token(request, url)
        
        # Add the token to headers
        headers = {
            'Authorization': f'Bearer {token}'
        }
        
        logger.info("Making authenticated request with ID token")
        response = requests.get(url, params=params, headers=headers)
        logger.info(f"Response status code: {response.status_code}")
        logger.info(f"Response headers: {response.headers}")
        logger.info(f"Raw response: {response.text}")
        
        if response.status_code != 200:
            logger.error(f"Error response from database: {response.text}")
            raise Exception(f"Database query failed with status {response.status_code}")
            
        data = response.json()
        logger.info(f"Parsed response data: {data}")
        
        if data.get('status') != 'success':
            logger.error(f"Error in database response: {data.get('error')}")
            raise Exception(data.get('error', 'Unknown database error'))
            
        locations = data.get('locations', [])
        if not locations:
            logger.warning("No locations found in database response")
            raise Exception("No matching location data found")
            
        return format_database_response(locations)
        
    except Exception as e:
        logger.error(f"Error querying database: {str(e)}")
        logger.error(f"Error type: {type(e)}")
        logger.error(f"Error args: {e.args}")
        if hasattr(e, '__traceback__'):
            import traceback
            logger.error(f"Traceback: {traceback.format_exc()}")
        raise

def format_database_response(locations):
    """
    Format the database response into a user-friendly message.
    
    Args:
        locations (list): List of location entries from the database
        
    Returns:
        str: Formatted message about the location(s)
    """
    if not locations:
        raise Exception("No location data available")
        
    # For current location queries, we only use the first (most recent) location
    location = locations[0]
    
    # Extract the location details
    timestamp = location.get('timestamp')
    latitude = location.get('latitude')
    longitude = location.get('longitude')
    country = location.get('country_code', 'Unknown')
    
    # Format the timestamp
    from datetime import datetime
    dt = datetime.fromisoformat(timestamp.replace('Z', '+00:00'))
    formatted_time = dt.strftime('%I:%M %p UTC on %B %d, %Y')
    
    # Format the coordinates with 4 decimal places
    lat_str = f"{abs(latitude):.4f}°{'N' if latitude >= 0 else 'S'}"
    lon_str = f"{abs(longitude):.4f}°{'E' if longitude >= 0 else 'W'}"
    
    # Build the message
    message = f"The ISS was at {lat_str}, {lon_str}"
    if country != 'Unknown':
        message += f" over {country}"
    message += f" at {formatted_time}."
    
    return message

def format_timestamp(timestamp):
    """Format a timestamp into a user-friendly string."""
    from datetime import datetime
    dt = datetime.fromisoformat(timestamp.replace('Z', '+00:00'))
    return dt.strftime('%B %d, %Y at %I:%M:%S %p UTC')

def store_feedback(feedback_data, auth_session):
    """
    Store feedback in Firestore using the feedback API.
    
    Args:
        feedback_data (dict): Feedback data including rating and comment
        auth_session: Authenticated session for making requests
        
    Returns:
        dict: Response from the feedback API
    """
    base_url = 'https://us-east1-iss-sky-scanner-20241222.cloudfunctions.net/iss_api_store_feedback'
    
    try:
        # Get credentials and create request object
        credentials, project = google.auth.default()
        request = google.auth.transport.requests.Request()
        
        # Refresh credentials
        credentials.refresh(request)
        
        # Get ID token with audience set to the target URL
        token = google.oauth2.id_token.fetch_id_token(request, base_url)
        
        # Add the token to headers
        headers = {
            'Authorization': f'Bearer {token}',
            'Content-Type': 'application/json'
        }
        
        logger.info("Making authenticated request with ID token")
        response = requests.post(base_url, json={
            'rating': int(feedback_data['rating']),
            'feedback': feedback_data['feedback'],
            'userAgent': feedback_data.get('userAgent', 'Unknown')
        }, headers=headers)
        
        response.raise_for_status()
        return response.json()
        
    except Exception as e:
        logger.error(f"Error storing feedback: {str(e)}")
        logger.error(f"Error type: {type(e)}")
        logger.error(f"Error args: {e.args}")
        if hasattr(e, '__traceback__'):
            import traceback
            logger.error(f"Traceback: {traceback.format_exc()}")
        raise
