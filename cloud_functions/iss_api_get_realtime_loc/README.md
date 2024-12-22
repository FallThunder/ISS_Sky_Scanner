# ISS Real-time Location API

This Cloud Function fetches and returns the current location of the International Space Station (ISS) along with details about what it's flying over. This is an internal API meant to be called only by other APIs within this project.

## Features

- Fetches real-time ISS coordinates from Open Notify API
- Reverse geocodes the coordinates using BigDataCloud API
- Provides natural location descriptions for both land and water
- Includes comprehensive error handling and logging

## API Response Format

The API returns a JSON response with the following structure:

```json
{
    "timestamp": 1703289600,
    "latitude": 45.12345,
    "longitude": -122.67890,
    "location_details": {
        "location_name": "San Francisco, California, United States",
        "raw_data": {
            // Full BigDataCloud API response
        }
    }
}
```

### Example Responses

Over Land:
```json
{
    "timestamp": 1703289600,
    "latitude": 37.7749,
    "longitude": -122.4194,
    "location_details": {
        "location_name": "San Francisco, California, United States",
        "raw_data": { ... }
    }
}
```

Over Water:
```json
{
    "timestamp": 1703289600,
    "latitude": 23.4567,
    "longitude": -155.6789,
    "location_details": {
        "location_name": "Over the Pacific Ocean",
        "raw_data": { ... }
    }
}
```

## Error Response

If an error occurs, the API returns:

```json
{
    "error": "Internal server error",
    "message": "Error details..."
}
```

## Local Development

1. Install dependencies:
   ```bash
   pip install -r requirements.txt
   ```

2. Run locally:
   ```bash
   functions-framework --target iss_api_get_realtime_loc --debug
   ```

3. Test the endpoint:
   ```bash
   curl http://localhost:8080
   ```

## Deployment

Deploy to Google Cloud Functions using:

```bash
gcloud functions deploy iss_api_get_realtime_loc \
    --runtime python310 \
    --trigger-http \
    --no-allow-unauthenticated
```

## Security

This function is internal and requires authentication. It should only be called by other Google Cloud services within the same project using appropriate authentication mechanisms.

## External APIs Used

1. **Open Notify API**
   - Endpoint: `http://api.open-notify.org/iss-now.json`
   - Used to fetch real-time ISS coordinates
   - No authentication required

2. **BigDataCloud Reverse Geocoding API**
   - Endpoint: `https://api.bigdatacloud.net/data/reverse-geocode-client`
   - Used to get location details from coordinates
   - No authentication required for client version

## Dependencies

- `functions-framework`: Google Cloud Functions framework
- `requests`: For making HTTP requests to external APIs
