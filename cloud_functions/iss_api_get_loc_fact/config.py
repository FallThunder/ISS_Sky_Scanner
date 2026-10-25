"""Configuration settings for the ISS Location Fact API."""

# Model lifecycle: https://docs.cloud.google.com/vertex-ai/generative-ai/docs/learn/model-versions
# gemini-3.5-flash-lite is supported until at least 2027-07-21.
GEMINI_SETTINGS = {
    'model': 'gemini-3.5-flash-lite',
    'project_id': 'iss-sky-scanner-20241222',
    # The global endpoint serves every current model; regional endpoints
    # (e.g. us-east1) don't always carry the newest ones.
    'location': 'global',
    'temperature': 0.7,
    # Thinking tokens count against this limit, so leave headroom beyond
    # the ~20-word answer.
    'max_output_tokens': 1024,
    'thinking_level': 'LOW',
    'timeout_ms': 7000,  # Callers (the BFFs) give up after 8s
}

# Default prompt used if the GCS prompt file is not available
DEFAULT_LOCATION_FACT_PROMPT = """Generate a fascinating historical or geographical fact about {location}. 
Focus on lesser-known but verified information. Respond in a maximum of 20 words."""
