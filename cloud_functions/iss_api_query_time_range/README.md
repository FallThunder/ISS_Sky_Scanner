# ISS Location History Time Range Query

This Cloud Function provides an API endpoint to query the ISS location history for a specified time range.

## Description

The function retrieves ISS location data points from Firestore for a specified number of minutes in the past. It's designed to support the web interface's timeline slider functionality, allowing users to view the ISS's path over time.

## API Specification

### Endpoint

```
GET /iss_api_query_time_range
```

### Query Parameters

- `minutes` (optional): Number of minutes of history to fetch
  - Default: 60 (1 hour)
  - Minimum: 1
  - Maximum: 1440 (24 hours)

### Response Format

```json
{
    "locations": [
        {
            "timestamp": "2024-03-21T10:30:00Z",
            "latitude": 45.123,
            "longitude": -122.456,
            "country_code": "US",
            "location_details": "Portland, Oregon, United States"
        },
        // ... more locations
    ],
    "count": 42,
    "minutes_requested": 60,
    "status": "success"
}
```

### Error Responses

```json
{
    "error": "Error message here",
    "status": "error"
}
```

## Development

### Prerequisites

- Python 3.10 or higher
- Google Cloud SDK
- Access to Google Cloud Project with Firestore enabled

### Local Testing

1. Set up your environment:
   ```bash
   python3 -m venv venv
   source venv/bin/activate
   pip install -r requirements.txt
   ```

2. Run the function locally:
   ```bash
   functions-framework --target=iss_api_query_time_range
   ```

3. Test with curl:
   ```bash
   curl "http://localhost:8080?minutes=30"
   ```

### Deployment

1. Ensure you have the necessary permissions and are authenticated with gcloud.

2. Run the deployment script:
   ```bash
   ./deploy.sh
   ```

## Usage Examples

1. Get last hour of data (default):
   ```bash
   curl "$FUNCTION_URL"
   ```

2. Get last 30 minutes of data:
   ```bash
   curl "$FUNCTION_URL?minutes=30"
   ```

3. Get full 24 hours of data:
   ```bash
   curl "$FUNCTION_URL?minutes=1440"
   ```
