from google.cloud import secretmanager
from google.cloud import storage
import google.generativeai as genai
import traceback
import logging
from config import GEMINI_SETTINGS, DEFAULT_LOCATION_FACT_PROMPT

def getSecret(secret_id):
    try:
        client = secretmanager.SecretManagerServiceClient()
        name = f"projects/iss-sky-scanner-20241222/secrets/{secret_id}/versions/latest"
        response = client.access_secret_version(name=name)
        return response.payload.data.decode('UTF-8')
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
    debug_info = []
    
    try:
        api_key = getSecret('iss-sky-scanner-genai-api-key')
        if not api_key:
            raise ValueError("Failed to retrieve API key")
            
        debug_info.append("API key retrieved successfully")
        debug_info.append(f"Attempting Gemini call for location: {location}")
        genai.configure(api_key=api_key)
        
        model = genai.GenerativeModel(GEMINI_SETTINGS['model'])
        prompt = get_location_fact_prompt().format(location=location)
        
        response = model.generate_content(
            prompt,
            generation_config={
                'temperature': GEMINI_SETTINGS['temperature'],
                'max_output_tokens': GEMINI_SETTINGS['max_output_tokens'],
            }
        )
        return response.text.strip(), None
        
    except Exception as err:
        error_info = {
            "error_type": str(type(err)),
            "error_message": str(err),
            "traceback": traceback.format_exc(),
            "debug_steps": debug_info
        }
        logging.error(f"Error generating location fact: {error_info}")
        return "An interesting fact about this location is coming soon!", error_info
