# Data Store

This project will use a Firestore database named '(default)' using a collection named `iss_loc_history` to store the location history of the International Space Station.

# APIs

All APIs are written using Python/Flask. They will be deployed as Google Cloud Functions. Here's a list of APIs and their functions:

1. **iss_api_get_realtime_loc**
   - Fetches the current location of the International Space Station from an existing public API
   - Uses another API to reverse search the coordinates to find what the ISS is flying over

2. **iss_api_store_realtime_loc**
   - Calls the `iss_api_get_realtime_loc` to fetch the current location of the Space Station
   - Stores the location data in the Firestore collection
   - Invoked every 5 minutes through a pub/sub topic

3. **iss_api_get_loc_fact**
   - Uses Gemini 1.5 Flash (GenAI API) to find a fun fact about a given location

4. **iss_api_get_last_stored_loc**
   - Reads and returns the latest entry in the Firestore collection

5. **iss_api_bff_esp** (Backend for Frontend - IoT App)
   - Calls `iss_api_get_last_stored_loc` to find the last stored location of the ISS
   - Uses `iss_api_get_loc_fact` to find a fun fact about the location
   - Combines and serves the data to the IoT app

6. **iss_api_bff_web** (Backend for Frontend - Web App)
   - Calls `iss_api_get_last_stored_loc` to find the last stored location of the ISS
   - Uses `iss_api_get_loc_fact` to find a fun fact about the location
   - Combines and serves the data to the web app
