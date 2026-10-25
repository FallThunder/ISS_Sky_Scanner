# ISS Real-time Location API

This Cloud Function fetches and returns the current location of the International Space Station (ISS) along with details about what it's flying over. This is an internal API meant to be called only by other APIs within this project.

## Features

- Fetches real-time ISS coordinates from wheretheiss.at, falling back to
  SGP4 propagation of the latest TLE if that API is unavailable
- Reverse geocodes the coordinates offline from Natural Earth polygons
  (`geodata.json`): "State, Country" over land, "Over the <sea/ocean>" over water
- Reports which source answered in the `source` field (`wheretheiss.at` or
  `tle_sgp4`)
- Bounded upstream timeouts (5s each) so the caller's 25s timeout is never hit
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
        "location_name": "California, United States of America",
        "country_code": "US",
        "raw_data": {"country": "United States of America", "state": "California"}
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
    --runtime python312 \
    --trigger-http \
    --no-allow-unauthenticated
```

## Security

This function is internal and requires authentication. It should only be called by other Google Cloud services within the same project using appropriate authentication mechanisms.

## External APIs Used

1. **Where the ISS at? API** (primary)
   - Endpoint: `https://api.wheretheiss.at/v1/satellites/25544`
   - Used to fetch real-time ISS coordinates
   - No authentication required

2. **ISS TLE** (fallback)
   - Endpoints: `https://live.ariss.org/iss.txt`, then CelesTrak
   - Propagated to the current time with SGP4 (skyfield)

3. **Reverse geocoding: none (offline)**
   - `geodata.json` holds simplified [Natural Earth](https://www.naturalearthdata.com/)
     marine, country and state/province polygons (public domain). Regenerate it
     with `python cloud_functions/tools/build_geodata.py`.
   - BigDataCloud's free `reverse-geocode-client` endpoint was used until
     October 2026. Its terms forbid server-side calls, and it began rejecting
     Cloud Run's IPs (HTTP 400), so every location came back as
     "Location details unavailable".
   - Used to get location details from coordinates
   - No authentication required for client version

## Dependencies

- `functions-framework`: Google Cloud Functions framework
- `requests`: For making HTTP requests to external APIs
- `skyfield`: SGP4 propagation for the TLE fallback

> Open Notify (`api.open-notify.org`) was removed as a source in October 2026:
> it returns positions hours out of date while reporting the current
> timestamp.
