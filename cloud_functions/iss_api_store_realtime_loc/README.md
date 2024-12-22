# ISS Location Storage API

This Cloud Function fetches the current location of the International Space Station and stores it in Firestore. It is designed to be called periodically (every 5 minutes) through a pub/sub topic.

## Features

- Calls `iss_api_get_realtime_loc` to fetch current ISS location
- Stores location data in Firestore collection `iss_loc_history`
- Uses authenticated service-to-service communication
- Includes comprehensive error handling and logging

## Data Model

Each document in the `iss_loc_history` collection contains:

```json
{
    "timestamp": 1703289600,
    "latitude": 45.12345,
    "longitude": -122.67890,
    "location_details": {
        "location_name": "Over the Pacific Ocean",
        "raw_data": { ... }
    }
}
```

## Dependencies

- `flask`: Web framework for Cloud Functions
- `functions-framework`: Google Cloud Functions framework
- `requests`: For making HTTP requests
- `google-cloud-firestore`: Firestore client library
- `google-auth`: For service-to-service authentication

## Authentication

The function:
1. Requires authentication for incoming requests
2. Uses service account credentials for Firestore access
3. Generates ID tokens for calling `iss_api_get_realtime_loc`

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
   functions-framework --target iss_api_store_realtime_loc --debug
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
3. Data is properly stored in Firestore
4. Response format is correct

## Error Handling

The function handles several types of errors:
- Authentication failures
- Network issues with `iss_api_get_realtime_loc`
- Firestore write failures
- Invalid response formats

## Related Components

- `iss_api_get_realtime_loc`: Provides real-time ISS location data
- Pub/Sub topic (to be created): Will trigger this function every 5 minutes
- Firestore collection: Stores the historical location data
