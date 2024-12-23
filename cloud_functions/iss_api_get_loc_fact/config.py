"""Configuration settings for the ISS Location Fact API."""

GEMINI_SETTINGS = {
    'model': 'gemini-1.5-flash',
    'temperature': 0.7,
    'max_output_tokens': 150,
}

# Default prompt that will be used if Secret Manager value is not available
DEFAULT_LOCATION_FACT_PROMPT = """Generate a fascinating historical or geographical fact about {location}. 
Focus on lesser-known but verified information. Respond in a maximum of 20 words."""
