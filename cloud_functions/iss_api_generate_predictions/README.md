# ISS Prediction Generation API

This Cloud Function generates ISS position predictions for the next 90 minutes (18 predictions at 5-minute intervals) and stores them in Firestore.

## Features

- Generates 18 predictions (5, 10, 15, ..., 90 minutes ahead) for a given ISS location
- Stores predictions in `iss_loc_predictions` collection
- Links predictions to source document in `iss_loc_history` collection
- Rounds timestamps to 5-minute intervals for consistent document IDs
- Uses Firestore DocumentReference for bidirectional linking

## Data Model

Each document in the `iss_loc_predictions` collection contains:

```json
{
    "source_timestamp": "2024-01-15T15:00:00Z",
    "source_timestamp_unix": 1705334400,
    "source_document_id": "abc123xyz456",
    "source_document_ref": <DocumentReference>,
    "source_latitude": 45.123,
    "source_longitude": -122.678,
    "source_location": "Portland, Oregon, USA",
    "source_country_code": "US",
    "predictions": [
        {
            "minutes_ahead": 5,
            "timestamp": "2024-01-15T15:05:00Z",
            "timestamp_unix": 1705334700,
            "latitude": 45.234,
            "longitude": -122.789
        },
        ...
    ],
    "prediction_count": 18,
    "generated_at": "2024-01-15T15:00:05Z"
}
```

## API Endpoint

**Method**: POST  
**Authentication**: Required (ID token)  
**Content-Type**: application/json

### Request Body

```json
{
    "timestamp": "2024-01-15T15:00:00Z",
    "latitude": 45.123,
    "longitude": -122.678,
    "document_id": "abc123xyz456",
    "location": "Portland, Oregon, USA",
    "country_code": "US"
}
```

### Response

Success (200):
```json
{
    "status": "success",
    "data": {
        "status": "success",
        "document_id": "2024-01-15T15:00:00Z",
        "prediction_count": 18
    }
}
```

Error (400/500):
```json
{
    "error": "Error message",
    "status": "error"
}
```

## Dependencies

- `flask`: Web framework for Cloud Functions
- `functions-framework`: Google Cloud Functions framework
- `google-cloud-firestore`: Firestore client library
- `google-auth`: For service-to-service authentication

## Authentication

The function:
- Requires authentication for incoming requests (ID token)
- Uses service account credentials for Firestore access
- Can be called by other Cloud Functions in the project

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
   functions-framework --target iss_api_generate_predictions --debug
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

## Integration

This function is automatically called by `iss_api_store_realtime_loc` after successfully storing a location. It handles cases where the NASA API fails and no location data is available.

## Prediction Algorithm

The prediction algorithm is implemented in `utils.py` in the `generate_predictions()` function. The current implementation uses placeholder logic and should be replaced with the actual orbital mechanics calculation.

## Error Handling

The function handles:
- Missing required fields in request
- Invalid timestamp formats
- Firestore connection issues
- Prediction generation failures

## Related Components

- `iss_api_store_realtime_loc`: Calls this function after storing location
- `iss_loc_history`: Source collection for location data
- `iss_loc_predictions`: Target collection for prediction data
