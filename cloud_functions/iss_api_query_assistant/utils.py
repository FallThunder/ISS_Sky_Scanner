from typing import Dict, Any
import json
import requests
import logging
from google import genai
from google.genai import errors, types
import google.auth.transport.requests
import google.auth
import google.oauth2.id_token

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Gemini on Vertex AI, authenticated as the function's service account
# (roles/aiplatform.user); no API key involved.
# Model lifecycle: https://docs.cloud.google.com/vertex-ai/generative-ai/docs/learn/model-versions
GEMINI_MODEL = 'gemini-3.5-flash-lite'
GEMINI_PROJECT = 'iss-sky-scanner-20241222'
GEMINI_LOCATION = 'global'
GEMINI_TIMEOUT_MS = 20000

_genai_client = None


def get_genai_client() -> genai.Client:
    """Get or create the Vertex AI Gen AI client (reused across requests)."""
    global _genai_client
    if _genai_client is None:
        _genai_client = genai.Client(
            vertexai=True,
            project=GEMINI_PROJECT,
            location=GEMINI_LOCATION,
            http_options=types.HttpOptions(timeout=GEMINI_TIMEOUT_MS),
        )
    return _genai_client

# System prompt that sets the context
SYSTEM_PROMPT = """You are a friendly AI assistant that helps people find information about the International Space Station's location and basic facts. The database is updated every 5 minutes with the ISS's location.

RESPONSE FORMAT:
Always respond with a single JSON object and nothing else.

For database queries, respond with:
{
    "message": "[Your friendly response here]",
    "action": "query_db",
    "data": {
        "collection": "iss_loc_history",
        [appropriate query parameters based on the question]
    }
}
Supported query parameters: "country_code" (ISO 3166-1 alpha-2),
"limit" (integer), "order_by" ("timestamp"), "order_direction"
("ASCENDING" or "DESCENDING"). For the current or most recent location use
{"limit": 1, "order_by": "timestamp", "order_direction": "DESCENDING"}.

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

def query_gemini(prompt: str) -> str:
    """
    Query Gemini with the user's question.

    Args:
        prompt (str): The user's question

    Returns:
        str: The model's reply (a JSON object as text)
    """
    config = types.GenerateContentConfig(
        system_instruction=SYSTEM_PROMPT,
        response_mime_type='application/json',
        thinking_config=types.ThinkingConfig(thinking_level='LOW'),
    )
    client = get_genai_client()
    try:
        response = client.models.generate_content(
            model=GEMINI_MODEL, contents=prompt, config=config
        )
    except errors.ClientError as e:
        # Not every model accepts every thinking level; retry with the
        # model's default rather than failing the request
        if e.code != 400:
            raise
        logger.warning(f"Retrying without thinking config: {e}")
        config.thinking_config = None
        response = client.models.generate_content(
            model=GEMINI_MODEL, contents=prompt, config=config
        )

    if not response.text:
        raise ValueError("Empty response from Gemini")
    return response.text


def parse_model_json(text: str) -> Dict[str, Any]:
    """
    Parse the model's JSON reply, tolerating Markdown code fences.

    Args:
        text (str): Raw model output

    Returns:
        Dict: The parsed object
    """
    cleaned = text.strip()
    if cleaned.startswith('```'):
        cleaned = cleaned.split('\n', 1)[1] if '\n' in cleaned else ''
        cleaned = cleaned.rsplit('```', 1)[0]
    return json.loads(cleaned)


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
    # Skip failed-fetch entries (null coordinates) so answers are real data
    params = {'valid_only': 'true'}
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
        response = requests.get(url, params=params, headers=headers, timeout=15)
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
        }, headers=headers, timeout=15)
        
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
