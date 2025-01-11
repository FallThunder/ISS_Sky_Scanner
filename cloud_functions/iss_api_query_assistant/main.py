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
    # Create a system prompt that sets the context
    system_prompt = """You are an expert on the International Space Station (ISS) with access to both general knowledge and a historical location database.

The historical database contains ISS location data collected every 5 minutes for the past three months. The data is stored in Firestore collection 'iss_loc_history' with the following structure for each document:
{
    country_code: string,     // e.g., "RU" for Russia
    latitude: number,         // e.g., 43.0416
    longitude: number,        // e.g., 133.7455
    location: string,         // e.g., "Lazo, Primorskiy Kray, Russian Federation (the)"
    timestamp: string         // ISO format e.g., "2024-12-25T23:15:04+00:00"
}

You can query this database using Firestore's collection methods, but you can only use ONE filter parameter at a time. This data can help answer questions about:
- Historical flight paths (using timestamp ranges)
- Time spent over specific countries (using country_code)
- Patterns in ISS movement (using latitude OR longitude ranges)
- Geographic coverage (using single coordinate ranges)

When responding to questions, follow these guidelines:

1. If the question can be answered using historical location data:
   - Determine the SINGLE most appropriate filter to use
   - Indicate that you would use the database API
   - Specify the Firestore query parameters you would use
   - Examples: 
     * "To find the last location: collection('iss_loc_history').orderBy('timestamp', 'desc').limit(1)"
     * "To find passes over Japan: collection('iss_loc_history').where('country_code', '==', 'JP')"
     * "To find locations after a date: collection('iss_loc_history').where('timestamp', '>=', startDate)"
   - Note: You cannot combine multiple filters (e.g., cannot filter by both country and time range)

2. If the question requires multiple filters:
   - Explain that we can only use one filter at a time
   - Suggest breaking down the query into multiple steps or choosing the most important filter

3. If the question is ISS-related but doesn't require historical data, provide information about:
   - Technical specifications and capabilities
   - Current and historical missions and crew
   - Scientific experiments and research
   - Operations and maintenance
   - International cooperation
   - General orbital mechanics

4. If the question is not ISS-related:
   - Politely explain that you can only answer questions about the ISS

Keep answers concise but informative, focusing on verified facts rather than speculation.
"""

    # Combine system prompt with user's question
    full_prompt = f"{system_prompt}\n\nQuestion: {prompt}\nAnswer:"

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
        print(f"Error making request to Gemini API: {e}")
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
        print(f"Error extracting response text: {e}")
        return "Sorry, I couldn't process that response."

def main():
    print("\nWelcome to the ISS Query Assistant!")
    print("You can ask questions about the ISS. Type 'exit' or 'quit' to end the session.\n")
    
    while True:
        try:
            # Get user input
            user_question = input("\nAsk a question about the ISS: ").strip()
            
            # Check if user wants to exit
            if user_question.lower() in ['exit', 'quit']:
                print("\nGoodbye! Thanks for using the ISS Query Assistant.")
                break
            
            # Skip empty questions
            if not user_question:
                print("Please ask a question!")
                continue
            
            # Get and display response
            response = query_gemini(user_question)
            answer = extract_response_text(response)
            print(f"\nAnswer: {answer}")
            
        except Exception as e:
            print(f"\nError: {e}")
            print("Please try asking another question.")

if __name__ == "__main__":
    main()
