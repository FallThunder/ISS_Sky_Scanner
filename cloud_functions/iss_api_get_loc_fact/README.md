# ISS Location Fun Facts API

This Cloud Function generates interesting facts about locations using Google's Gemini 1.5 Flash API. It is designed to be called by other APIs within this project to enhance the ISS tracking experience with location-based trivia.

## Features

- Uses Gemini 1.5 Flash for fast, concise fact generation
- Generates facts about any geographical location
- Limits responses to 12 words for quick consumption
- Includes comprehensive error handling and logging
- Requires authentication for access

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
- `google-generativeai`: Google's Generative AI client library

## Authentication

This function:
1. Requires authentication for incoming requests
2. Uses service account credentials for Secret Manager access
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

## Error Handling

The function handles several types of errors:
- Authentication failures
- Missing location parameter
- Gemini API issues
- Secret Manager access issues

## Related Components

- `iss_api_bff_esp`: Uses this API for IoT display
- `iss_api_bff_web`: Uses this API for web display
- Secret Manager: Stores the Gemini API key

## Security

- Requires authentication for all requests
- Uses Secret Manager for secure API key storage
- Service account has minimal required permissions
