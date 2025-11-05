"""Local test script for Gemini 2.5 Flash implementation.

This script tests the generate_location_fun_fact function with
gemini-2.5-flash before integrating into production code.
"""

import os
import sys
from typing import Tuple, Optional
from google.cloud import secretmanager
from google.cloud import storage
from vertexai.generative_models import GenerativeModel
from vertexai import init
import traceback
import logging

# Add parent directory to path to import config and utils
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from config import GEMINI_SETTINGS, DEFAULT_LOCATION_FACT_PROMPT

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)


def get_secret(secret_id: str) -> Optional[str]:
    """Get secret from Secret Manager.
    
    Args:
        secret_id: The secret ID to retrieve.
        
    Returns:
        Secret value or None if retrieval fails.
    """
    try:
        client = secretmanager.SecretManagerServiceClient()
        name = f"projects/iss-sky-scanner-20241222/secrets/{secret_id}/versions/latest"
        response = client.access_secret_version(name=name)
        secret_value = response.payload.data.decode('UTF-8')
        logger.info(f"Retrieved secret starting with: {secret_value[:8]}...")
        return secret_value
    except Exception as e:
        logger.warning(f"Failed to get secret {secret_id}: {str(e)}")
        return None


def get_location_fact_prompt() -> str:
    """Fetch prompt from GCS or fall back to default.
    
    Returns:
        Prompt string to use for location fact generation.
    """
    try:
        storage_client = storage.Client()
        bucket = storage_client.bucket('iss-sky-scanner-config')
        blob = bucket.blob('prompts/location_fact_prompt.txt')
        prompt = blob.download_as_text()
        if not prompt:
            logger.info("Empty prompt received from GCS, using default")
            return DEFAULT_LOCATION_FACT_PROMPT
        logger.info("Successfully retrieved prompt from GCS")
        return prompt
    except Exception as e:
        logger.info(f"Failed to get prompt from GCS, using default: {str(e)}")
        return DEFAULT_LOCATION_FACT_PROMPT


def generate_location_fun_fact(location: str) -> Tuple[str, Optional[dict]]:
    """Generate a fun fact about a location using Vertex AI Gemini 2.5 Flash.
    
    Args:
        location: The location name to generate a fact about.
        
    Returns:
        Tuple of (fact_text, error_info). error_info is None on success.
    """
    debug_info = []
    
    try:
        debug_info.append("Initializing Vertex AI")
        logger.info("Initializing Vertex AI with project and location")
        
        # Initialize Vertex AI - will use application default credentials
        # For local testing, use: gcloud auth application-default login
        # In Cloud Functions, uses service account automatically
        init(
            project=GEMINI_SETTINGS['project_id'],
            location=GEMINI_SETTINGS['location']
        )
        
        debug_info.append(f"Using model: {GEMINI_SETTINGS['model']}")
        logger.info(f"Attempting Gemini call for location: {location}")
        
        # Create model instance
        model = GenerativeModel(GEMINI_SETTINGS['model'])
        
        # Get and format prompt
        prompt = get_location_fact_prompt().format(location=location)
        logger.info(f"Prompt: {prompt}")
        
        # Generate content
        response = model.generate_content(
            prompt,
            generation_config={
                'temperature': GEMINI_SETTINGS['temperature'],
                'max_output_tokens': GEMINI_SETTINGS['max_output_tokens'],
            }
        )
        
        fact_text = response.text.strip()
        logger.info(f"Generated fact: {fact_text}")
        debug_info.append("Successfully generated fact")
        return fact_text, None
        
    except Exception as err:
        error_info = {
            "error_type": str(type(err)),
            "error_message": str(err),
            "traceback": traceback.format_exc(),
            "debug_steps": debug_info
        }
        logger.error(f"Error generating location fact: {error_info}")
        return "An interesting fact about this location is coming soon!", error_info


def test_gemini_2_5():
    """Test function to verify Gemini 2.5 Flash implementation."""
    test_locations = [
        "Tokyo, Japan",
        "Paris, France",
        "New York, USA",
        "Sydney, Australia"
    ]
    
    print("=" * 60)
    print("Testing Gemini 2.5 Flash Implementation")
    print("=" * 60)
    print(f"Model: {GEMINI_SETTINGS['model']}")
    print(f"Temperature: {GEMINI_SETTINGS['temperature']}")
    print(f"Max Output Tokens: {GEMINI_SETTINGS['max_output_tokens']}")
    print("=" * 60)
    print()
    
    for location in test_locations:
        print(f"Testing location: {location}")
        print("-" * 60)
        
        fact, error_info = generate_location_fun_fact(location)
        
        if error_info:
            print(f"ERROR: {error_info['error_message']}")
            print(f"Error Type: {error_info['error_type']}")
            if 'traceback' in error_info:
                print(f"Traceback:\n{error_info['traceback']}")
        else:
            print(f"SUCCESS: {fact}")
        
        print()
    
    print("=" * 60)
    print("Test completed")
    print("=" * 60)


if __name__ == "__main__":
    test_gemini_2_5()
