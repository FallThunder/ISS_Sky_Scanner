# ISS Location Fun Facts API

This Cloud Function generates interesting facts about locations using Google's Gemini 1.5 Flash API. It is designed to be called by other APIs within this project to enhance the ISS tracking experience with location-based trivia.

## Features

- Uses Gemini 1.5 Flash for fast, concise fact generation
- Generates facts about any geographical location
- Limits responses to 20 words for quick consumption
- Includes comprehensive error handling and logging
- Requires authentication for access
- Configurable prompt via Google Cloud Storage

## Prompt Configuration

The function uses a configurable prompt stored in Google Cloud Storage:

- **Location**: `gs://iss-sky-scanner-config/prompts/location_fact_prompt.txt`
- **Format**: Text file containing the prompt template with a `{location}` placeholder
- **Fallback**: If GCS access fails, uses a default prompt from `config.py`
- **Updates**: Changes to the GCS prompt take effect immediately without redeployment

To update the prompt:
```bash
echo "Your new prompt text {location}" | gsutil cp - gs://iss-sky-scanner-config/prompts/location_fact_prompt.txt
```

## API Response Format

The API returns a JSON response with the following structure:

```json
{
    "location": "Paris",
    "fact": "Paris has more bridges than Venice.",
    "status": "success",
    "version": "1.0"
}
```

### Error Response

If an error occurs, the API returns:

```json
{
    "error": "Error message",
    "status": "error"
}
```

## Dependencies

- `flask`: Web framework for Cloud Functions
- `functions-framework`: Google Cloud Functions framework
- `google-cloud-secret-manager`: For accessing the Gemini API key
- `google-cloud-storage`: For accessing the configurable prompt
- `google-generativeai`: Google's Generative AI client library

## Authentication

This function:
1. Requires authentication for incoming requests
2. Uses service account credentials for Secret Manager and GCS access
3. Retrieves the Gemini API key from Secret Manager

## Local Development

1. Install dependencies:
   ```bash
   pip install -r requirements.txt
   ```

2. Set up authentication:
   ```bash
   export GOOGLE_APPLICATION_CREDENTIALS="path/to/service-account-key.json"
   ```

3. Run locally:
   ```bash
   functions-framework --target iss_api_get_loc_fact --debug
   ```

4. Test the endpoint:
   ```bash
   ./test_function.sh
   ```

## Deployment

Deploy to Google Cloud Functions using:

```bash
./deploy.sh
```

## Testing

The test script verifies:
1. Unauthenticated access is blocked
2. Authenticated access works
3. Response format is correct
4. Required fields are present
5. Fact generation works for sample locations
6. Prompt configuration is working (GCS and fallback)

## Error Handling

The function handles several types of errors:
- Authentication failures
- Missing location parameter
- Gemini API issues
- Secret Manager access issues
- GCS prompt access issues (falls back to default)

## Related Components

- `iss_api_bff_esp`: Uses this API for IoT display
- `iss_api_bff_web`: Uses this API for web display
- Secret Manager: Stores the Gemini API key
- Cloud Storage: Stores the configurable prompt

## Security

- Requires authentication for all requests
- Uses Secret Manager for secure API key storage
- Service account has minimal required permissions:
  - Secret Manager access for API key
  - GCS Object Viewer for prompt configuration
