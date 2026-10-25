# Data Store

Firestore database `(default)`:

- `iss_loc_history`: the ISS location every 5 minutes. A failed fetch is
  stored as an error entry (`is_error_entry: true`, `isEmpty: true`, null
  coordinates) so the history shows the gap.
- `iss_loc_predictions`: one document per source timestamp (document ID = the
  timestamp rounded down to 5 minutes), holding 19 predictions for +5 to +95
  minutes.
- `iss_sky_scanner_feedback`: user feedback.

# Call Flow

## Every 5 minutes (write path)

```
Cloud Scheduler ─→ Pub/Sub topic iss_locator_trigger
                     └─→ iss_api_store_realtime_loc
                           ├─→ iss_api_get_realtime_loc (ID token, 25s timeout)
                           │     ├─→ wheretheiss.at   (fallback: ARISS/CelesTrak TLE + SGP4)
                           │     └─→ BigDataCloud reverse geocoding (api-bdc.io)
                           ├─→ Firestore iss_loc_history   (location or error entry)
                           └─→ iss_api_generate_predictions (ID token, valid locations only)
                                 ├─→ ARISS TLE (fetched once per request)
                                 └─→ Firestore iss_loc_predictions
```

## Web app (read path)

| Frontend call | Function | Reads |
|---|---|---|
| Current location + fun fact | `iss_api_bff_web` (API key) | `iss_api_query_loc_history?limit=1&valid_only=true` and `iss_api_get_loc_fact` |
| 24h / 90m history | `iss_api_query_time_range` (public) | `iss_loc_history` |
| Predictions (future + made 30/60/90 min ago) | `iss_api_bff_web_predictions` (API key) | `iss_loc_predictions` |
| Chat | `iss_api_query_assistant` (public) | Gemini API, `iss_api_query_loc_history` |

## ESP32 display

`iss_api_bff_esp` (API key) works like `iss_api_bff_web`: the latest valid
location plus a fun fact.

# APIs

1. **iss_api_get_realtime_loc** (internal): fetches the current ISS position
   and reverse geocodes it.
2. **iss_api_store_realtime_loc** (Pub/Sub): stores the location, then
   triggers prediction generation.
3. **iss_api_generate_predictions** (internal): orbital-mechanics predictions
   from the current fix and the previous valid fix within 30 minutes (SGP4
   fallback after outages).
4. **iss_api_get_loc_fact** (internal): Gemini 3.5 Flash-Lite fun fact for a
   location name.
5. **iss_api_query_loc_history** (internal): filtered history queries.
6. **iss_api_query_time_range** (public): the last N minutes of history.
7. **iss_api_store_feedback** (internal): stores feedback.
8. **iss_api_query_assistant** (public): natural-language chat.
9. **iss_api_bff_web**, **iss_api_bff_web_predictions**, **iss_api_bff_esp**
   (public, API key): backends for the frontends.
