from google.cloud import storage
from google import genai
from google.genai import errors, types
import traceback
import logging
from config import GEMINI_SETTINGS, DEFAULT_LOCATION_FACT_PROMPT

_genai_client = None


def get_genai_client():
    """Get or create the Vertex AI Gen AI client (reused across requests).

    Authenticates with the function's service account, which needs
    roles/aiplatform.user.
    """
    global _genai_client
    if _genai_client is None:
        _genai_client = genai.Client(
            vertexai=True,
            project=GEMINI_SETTINGS['project_id'],
            location=GEMINI_SETTINGS['location'],
            http_options=types.HttpOptions(
                timeout=GEMINI_SETTINGS['timeout_ms']
            ),
        )
    return _genai_client


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
    """Generate a fun fact about a location using Gemini on Vertex AI.
    
    Args:
        location: The location name to generate a fact about.
        
    Returns:
        Tuple of (fact_text, error_info). error_info is None on success.
    """
    debug_info = []
    
    try:
        client = get_genai_client()
        debug_info.append(f"Using model: {GEMINI_SETTINGS['model']}")
        debug_info.append(f"Attempting Gemini call for location: {location}")
        
        # Get and format prompt
        prompt = get_location_fact_prompt().format(location=location)

        config = types.GenerateContentConfig(
            temperature=GEMINI_SETTINGS['temperature'],
            max_output_tokens=GEMINI_SETTINGS['max_output_tokens'],
            thinking_config=types.ThinkingConfig(
                thinking_level=GEMINI_SETTINGS['thinking_level']
            ),
        )
        try:
            response = client.models.generate_content(
                model=GEMINI_SETTINGS['model'], contents=prompt, config=config
            )
        except errors.ClientError as err:
            # Not every model accepts every thinking level; retry with the
            # model's default rather than failing the fact entirely
            if err.code != 400:
                raise
            debug_info.append(f"Retrying without thinking config: {err}")
            config.thinking_config = None
            response = client.models.generate_content(
                model=GEMINI_SETTINGS['model'], contents=prompt, config=config
            )

        if not response.text:
            raise ValueError(
                f"Empty response (finish reason: "
                f"{response.candidates[0].finish_reason if response.candidates else 'none'})"
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
