# ISS Query Assistant API

This Cloud Function provides a natural language interface for querying information about the International Space Station (ISS). It uses Google's Gemini AI model to understand and respond to questions about the ISS, including historical location data.

## Features

- Natural language processing of ISS-related questions
- Access to historical ISS location data
- Support for various query types:
  - Current and historical locations
  - Country-specific passes
  - Technical specifications
  - Mission information
  - Scientific experiments
- Feedback collection capability

## API Endpoints

The function exposes a single HTTP endpoint that accepts POST requests.

### Query Endpoint

```
POST https://[REGION]-[PROJECT_ID].cloudfunctions.net/iss_api_query_assistant
```

#### Request Format

```json
{
    "query": "Your question about the ISS"
}
```

#### Response Format

```json
{
    "response": {
        "message": "Response message",
        "action": "query_db|store_feedback|none",
        "data": {
            // Action-specific data
        }
    },
    "status": "success|error"
}
```

## Dependencies

- Flask for HTTP handling
- Google Cloud Secret Manager for API key management
- Google Gemini AI for natural language processing
- Google Cloud Functions Framework

## Configuration

The function requires the following secret to be set up in Google Cloud Secret Manager:
- `iss-sky-scanner-google-studio-api-key`: API key for Gemini AI

## Deployment

Use the provided `deploy.sh` script to deploy the function:

```bash
./deploy.sh
```

## Testing

Use the provided `test_function.sh` script to test the deployed function:

```bash
./test_function.sh
```

## Error Handling

The function includes comprehensive error handling for:
- Invalid or missing queries
- API authentication issues
- Malformed requests
- Internal processing errors

## Security

- CORS enabled for web access
- API key stored securely in Secret Manager
- Input validation and sanitization
- Error message sanitization
