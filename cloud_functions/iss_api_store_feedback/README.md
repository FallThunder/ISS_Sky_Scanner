# ISS Sky Scanner Feedback Storage API

This Cloud Function stores user feedback about the ISS Sky Scanner project in Firestore. It validates and processes feedback submissions from the web interface.

## Features

- Stores user feedback with ratings and comments
- Validates input data (rating range, word count)
- Uses UTC timestamps for consistent timing
- Includes user agent information
- Implements CORS for web access
- Provides error handling and logging

## API Response Format

The API accepts POST requests with JSON data in the following format:

```json
{
    "rating": 5,          // Integer 1-5
    "feedback": "text",   // String, max 100 words
    "userAgent": "..."    // Optional browser info
}
```

Success Response:
```json
{
    "message": "Feedback stored successfully",
    "status": "success"
}
```

Error Response:
```json
{
    "error": "Error message",
    "status": "error"
}
```

## Data Storage

Feedback is stored in Firestore with the following structure:
- Collection: `iss_sky_scanner_feedback`
- Document fields:
  - `rating`: Integer (1-5)
  - `feedback`: String
  - `timestamp`: ISO 8601 UTC timestamp
  - `user_agent`: String

## Error Handling

The function handles:
- Missing or invalid JSON data
- Invalid rating values
- Feedback exceeding word limit
- Database connection issues
- General runtime errors

## Security

- Requires no authentication (public endpoint)
- Implements input validation
- Uses Firestore security rules
- Provides CORS configuration

## Related Components

- Web Interface: Provides feedback UI
- Firestore: Stores feedback data
- Frontend JS: Handles feedback submission
