# ISS Location Backend-for-Frontend (Web)

This Cloud Function serves as a Backend-for-Frontend (BFF) for the web interface. It aggregates data from multiple ISS tracking APIs and formats it for web consumption, providing a rich user experience.

## Features

- Fetches latest ISS location from storage
- Retrieves location-based facts using the configurable fact generation service
- Formats data for web display with additional metadata
- Provides CORS support for web clients
- Implements caching for performance

## API Response Format

The API returns a detailed JSON response for web consumption:

```json
{
    "iss_data": {
        "latitude": "48.8566",
        "longitude": "2.3522",
        "location": "Paris, France",
        "fact": "Paris has more bridges than Venice.",
        "timestamp": "2024-01-01T12:00:00Z",
        "altitude": "408 km",
        "velocity": "7.66 km/s"
    },
    "metadata": {
        "last_update": "2024-01-01T12:00:00Z",
        "data_freshness": "5 seconds",
        "fact_source": "Gemini 1.5 Flash"
    },
    "status": "success"
}
```

### Error Response

If an error occurs, the API returns:

```json
{
    "error": {
        "message": "Detailed error message",
        "code": "ERROR_CODE"
    },
    "status": "error"
}
```

## Dependencies

- `flask`: Web framework for Cloud Functions
- `functions-framework`: Google Cloud Functions framework
- `requests`: For calling internal APIs
- `flask-cors`: For CORS support

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
   functions-framework --target iss_api_bff_web --debug
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
2. CORS headers are present
3. Response format is web-friendly
4. All required fields are present
5. Metadata is accurate
6. Integration with upstream services works

## Error Handling

The function provides detailed error handling for:
- Authentication failures
- Upstream service issues
- Data formatting problems
- Rate limiting
- Timeout conditions

## Performance

- Implements response caching
- Uses concurrent requests where possible
- Optimizes payload size
- Provides data freshness indicators

## Security

- Requires API key for access
- Uses service accounts for upstream calls
- Implements rate limiting
- Provides CORS configuration
- Sanitizes all output data
