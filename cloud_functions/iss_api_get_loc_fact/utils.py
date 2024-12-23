from google.cloud import secretmanager
import google.generativeai as genai
import traceback

def getSecret(secret_id):
    client = secretmanager.SecretManagerServiceClient()
    name = f"projects/iss-sky-scanner-20241222/secrets/{secret_id}/versions/latest"
    response = client.access_secret_version(name=name)
    return response.payload.data.decode('UTF-8')

def generate_location_fun_fact(location):
    debug_info = []
    
    try:
        api_key = getSecret('iss-sky-scanner-gemini-api-key')
        debug_info.append(f"API key retrieved: {'success' if api_key else 'failed'}")
        debug_info.append(f"Attempting Gemini call for location: {location}")
        genai.configure(api_key=api_key)
        
        model = genai.GenerativeModel('gemini-1.5-flash')
        prompt = fr"""Generate a brief, interesting fact about {location}. Respond in a maximum of 12 words.
        Focus on real, verifiable information."""

        
        response = model.generate_content(
            prompt,
            generation_config={
                'temperature': 0.7,
                'max_output_tokens': 150,
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
        return "An interesting fact about this location is coming soon!", error_info
