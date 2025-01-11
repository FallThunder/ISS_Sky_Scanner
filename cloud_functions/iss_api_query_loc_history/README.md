# ISS Last Stored Location API

This Cloud Function retrieves the most recent location of the International Space Station from the Firestore database. It is designed to be called by other APIs within this project to provide historical location data.

## Features

- Retrieves latest ISS location from Firestore collection `iss_loc_history`
- Orders entries by timestamp to ensure latest data
- Provides location details including coordinates and descriptive location
- Includes comprehensive error handling and logging
- Requires authentication for access

## API Response Format

The API returns a JSON response with the following structure:

```json
{
    "timestamp": "2024-12-23T01:40:06+00:00",
    "latitude": 37.4188,
    "longitude": 125.1156,
    "location_details": "Over the Yellow Sea",
    "status": "success",
    "version": "1.0"
}
```

### Error Response

If an error occurs, the API returns:

```json
{
    "error": "Error message",
    "status": "error",
    "message": "Detailed error message"
}
```

## Dependencies

- `flask`: Web framework for Cloud Functions
- `functions-framework`: Google Cloud Functions framework
- `google-cloud-firestore`: Firestore client library

## Authentication

This function:
1. Requires authentication for incoming requests
2. Uses service account credentials for Firestore access
3. Only accepts requests from within the same GCP project

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
   functions-framework --target iss_api_get_last_stored_loc --debug
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
5. Data retrieval from Firestore works

## Error Handling

The function handles several types of errors:
- Authentication failures
- Firestore access issues
- Missing data scenarios
- Invalid response formats

## Related Components

- `iss_api_store_realtime_loc`: Stores the data that this API retrieves
- `iss_api_bff_esp`: Uses this API for IoT display
- `iss_api_bff_web`: Uses this API for web display
- Firestore collection: Stores the historical location data

## Security

- Requires authentication for all requests
- Uses service account with minimal required permissions (datastore.user)
- Internal API not exposed to public internet
