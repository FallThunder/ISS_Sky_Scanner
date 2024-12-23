# ISS Location Backend-for-Frontend (ESP)

This Cloud Function serves as a Backend-for-Frontend (BFF) for the ESP IoT device display. It aggregates data from multiple ISS tracking APIs and formats it specifically for the ESP display requirements.

## Features

- Fetches latest ISS location from storage
- Retrieves location-based facts using the configurable fact generation service
- Formats data specifically for ESP display constraints
- Handles authentication and rate limiting
- Provides error handling suitable for IoT devices

## API Response Format

The API returns a JSON response optimized for ESP consumption:

```json
{
    "latitude": "48.8566",
    "longitude": "2.3522",
    "location": "Paris, France",
    "fact": "Paris has more bridges than Venice.",
    "timestamp": "2024-01-01T12:00:00Z",
    "status": "success"
}
```

### Error Response

If an error occurs, the API returns a simplified error format suitable for ESP:

```json
{
    "error": "Brief error message",
    "status": "error"
}
```

## Dependencies

- `flask`: Web framework for Cloud Functions
- `functions-framework`: Google Cloud Functions framework
- `requests`: For calling internal APIs

## Upstream Services

This BFF integrates with:

1. `iss_api_get_last_stored_loc`:
   - Provides the most recent ISS location
   - Returns coordinates and location name

2. `iss_api_get_loc_fact`:
   - Generates location-based facts
   - Uses configurable prompts from GCS
   - Falls back to default prompt if needed

## Authentication

This function:
1. Requires API key for incoming requests
2. Uses service account for upstream API calls
3. Manages authentication for all upstream services

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
   functions-framework --target iss_api_bff_esp --debug
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
1. Authentication works correctly
2. Response format matches ESP requirements
3. All required fields are present
4. Error handling is ESP-friendly
5. Integration with upstream services works

## Error Handling

The function provides ESP-friendly error handling for:
- Authentication failures
- Upstream service issues
- Data formatting problems
- Timeout conditions

## Security

- Requires API key for access
- Uses service accounts for upstream calls
- Implements rate limiting
- Provides minimal necessary data to ESP
