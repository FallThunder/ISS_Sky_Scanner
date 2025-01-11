import os
import requests
import json
from typing import Dict, Any

def query_gemini(prompt: str) -> Dict[Any, Any]:
    """
    Query the Gemini API with a given prompt.
    
    Args:
        prompt (str): The text prompt to send to Gemini
        
    Returns:
        Dict: The JSON response from the API
    """
    # Get API key from environment variable
    api_key = "AIzaSyBiplOYEyayI-SkLIAG2Z_rCb3groJrVrs"

    # API endpoint
    url = f"https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent"
    
    # Request headers
    headers = {
        'Content-Type': 'application/json'
    }
    
    # Request payload
    payload = {
        "contents": [{
            "parts": [{"text": prompt}]
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
        print(f"Error making request to Gemini API: {e}")
        raise

def main():
    try:
        # Example usage
        response = query_gemini("Give me a fun fact about the ISS")
        print(json.dumps(response, indent=2))
    except Exception as e:
        print(f"Error: {e}")

if __name__ == "__main__":
    main()
