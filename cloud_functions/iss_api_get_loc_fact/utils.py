from google.cloud import secretmanager
from google.cloud import storage
from vertexai.generative_models import GenerativeModel
from vertexai import init
import traceback
import logging
from config import GEMINI_SETTINGS, DEFAULT_LOCATION_FACT_PROMPT

def getSecret(secret_id):
    try:
        client = secretmanager.SecretManagerServiceClient()
        name = f"projects/iss-sky-scanner-20241222/secrets/{secret_id}/versions/latest"
        response = client.access_secret_version(name=name)
        secret_value = response.payload.data.decode('UTF-8')
        # Log first few characters of the key to verify which version we got
        logging.info(f"Retrieved secret starting with: {secret_value[:8]}...")
        return secret_value
    except Exception as e:
        logging.warning(f"Failed to get secret {secret_id}: {str(e)}")
        return None

def get_location_fact_prompt():
    """Fetch prompt from GCS or fall back to default."""
    try:
        storage_client = storage.Client()
        bucket = storage_client.bucket('iss-sky-scanner-config')
        blob = bucket.blob('prompts/location_fact_prompt.txt')
        prompt = blob.download_as_text()
        if not prompt:
            logging.info("Empty prompt received from GCS, using default")
            return DEFAULT_LOCATION_FACT_PROMPT
        logging.info("Successfully retrieved prompt from GCS")
        return prompt
    except Exception as e:
        logging.info(f"Failed to get prompt from GCS, using default: {str(e)}")
        return DEFAULT_LOCATION_FACT_PROMPT

def generate_location_fun_fact(location):
    """Generate a fun fact about a location using Vertex AI Gemini 2.5 Flash.
    
    Args:
        location: The location name to generate a fact about.
        
    Returns:
        Tuple of (fact_text, error_info). error_info is None on success.
    """
    debug_info = []
    
    try:
        debug_info.append("Initializing Vertex AI")
        # Initialize Vertex AI - uses service account credentials automatically
        # in Cloud Functions environment
        init(
            project=GEMINI_SETTINGS['project_id'],
            location=GEMINI_SETTINGS['location']
        )
        
        debug_info.append(f"Using model: {GEMINI_SETTINGS['model']}")
        debug_info.append(f"Attempting Gemini call for location: {location}")
        
        # Create model instance
        model = GenerativeModel(GEMINI_SETTINGS['model'])
        
        # Get and format prompt
        prompt = get_location_fact_prompt().format(location=location)
        
        # Generate content
        response = model.generate_content(
            prompt,
            generation_config={
                'temperature': GEMINI_SETTINGS['temperature'],
                'max_output_tokens': GEMINI_SETTINGS['max_output_tokens'],
            }
        )
        
        fact_text = response.text.strip()
        debug_info.append("Successfully generated fact")
        return fact_text, None
        
    except Exception as err:
        error_info = {
            "error_type": str(type(err)),
            "error_message": str(err),
            "traceback": traceback.format_exc(),
            "debug_steps": debug_info
        }
        logging.error(f"Error generating location fact: {error_info}")
        return "An interesting fact about this location is coming soon!", error_info
