# ISS Sky Scanner

Real-time ISS tracker: Python Cloud Functions on GCP (project
`iss-sky-scanner-20241222`, region `us-east1`), a static web frontend in
`docs/` (GitHub Pages: https://fallthunder.github.io/ISS_Sky_Scanner/), and an
ESP32 LCD display in `iss_display_apps/iss_esp_display/`.

Style and naming rules live in `.cursorrules` (PEP 8, `iss_api_*` names,
light `main.py` + logic in `utils.py`). The existing code does not keep to 79
columns; don't reflow lines you aren't changing. `ISS_Tracker_Call_Flow.md`
has the call graph.

## Layout

- `cloud_functions/iss_api_*/`: one independently deployable function per
  directory (`main.py`, `utils.py`, `requirements.txt`, `deploy.sh`,
  `test_function.sh`). Each directory is uploaded alone, so functions share no
  code; helpers are duplicated on purpose.
- `cloud_functions/config/`: `deployment_config.sh` (runtime, memory, timeout
  defaults), `setup_project.sh` (idempotent project-wide setup: APIs, service
  account IAM roles, Firestore composite indexes) and
  `deploy_all_functions.sh` (setup once, then two parallel waves: internal
  APIs, then their callers).
- `cloud_functions/tests/`: pytest suite. `conftest.load_function(name)`
  imports a function's `utils`/`main` fresh with Firestore mocked.
- `docs/`: frontend (plain ES modules, no build step). Map view + Metrics
  Tables view. `Metrics Fix Plan.md` is an aspirational greenfield spec, not a
  description of the current code.

## Commands

```bash
# Tests (Python 3.12). Network tests hit wheretheiss.at / ARISS / BigDataCloud.
pip install -r cloud_functions/tests/requirements-dev.txt \
    $(for f in cloud_functions/iss_api_*/requirements.txt; do echo -r $f; done)
pytest cloud_functions/tests
pytest cloud_functions/tests -m "not network"

# Run one function locally
cd cloud_functions/iss_api_get_realtime_loc && functions-framework --target iss_api_get_realtime_loc --port 8091

# Frontend
python3 -m http.server -d docs 8000

# ESP32 firmware (needs include/secrets.h, from secrets.h.example)
cd iss_display_apps/iss_esp_display && pio run
```

Deployment needs the `gcloud` CLI (`brew install --cask gcloud-cli`)
authenticated to the project. Deploy one function with
`cd cloud_functions/<fn> && ./deploy.sh`, or several/all with
`cloud_functions/config/deploy_all_functions.sh [fn ...]`; logs go to
`/tmp/deploy_<fn>.log`. Each `deploy.sh` runs `test_function.sh` afterwards,
so "failed" can mean "deployed, tests failed"; the master script reports the
two separately. Read production errors with
`gcloud logging read 'resource.type="cloud_run_revision" AND resource.labels.service_name="iss-api-<name-with-dashes>"' --freshness=30m`.
Deploying is outward-facing: confirm with the user first.

Project-wide changes (new IAM role, API, Firestore index) go in
`setup_project.sh`, not in a function's `deploy.sh`: the parallel deploy
skips per-function setup (`SKIP_PROJECT_SETUP=true`) because concurrent
project IAM edits collide.

## Data contracts (the frontend depends on these)

- `iss_loc_history` entries: `{timestamp, latitude, longitude, location,
  country_code}`. Timestamps are ISO strings with a `+00:00` offset and are
  compared as strings in Firestore queries, so always build query bounds with
  `datetime.now(timezone.utc).isoformat()`, never `utcnow()` + `'Z'`.
- Failed fetches are stored as **error entries**: `is_error_entry: true`,
  `isEmpty: true`, null coordinates, `diagnostics`. Anything that needs a real
  position must skip them: `iss_api_query_loc_history?valid_only=true`, or
  check `is_error_entry` / `latitude is None` yourself.
- `iss_loc_predictions` document ID = source timestamp floored to 5 minutes.
  `iss_api_bff_web_predictions` reads the docs 35/65/95 minutes before "now"
  (floored) for the "predicted 30/60/90 min ago" series.
- Response shapes of the BFFs, `iss_api_query_time_range` and
  `iss_api_query_assistant` are consumed by `docs/js/*` and the ESP32 firmware
  (`fun_fact`, `location`, `timestamp`). Change them only together.

## Known pitfalls (learned the hard way)

- **Don't use Open Notify** (`api.open-notify.org`). As of Oct 2026 it returns
  positions hours stale while stamping them with the current time. The
  primary source is wheretheiss.at; the fallback is SGP4 on the ARISS TLE
  (CelesTrak as backup). Check any new source against SGP4 before trusting it.
- **Timeout budget**: `iss_api_store_realtime_loc` (120s) waits 25s for
  `iss_api_get_realtime_loc`, whose upstream calls are 5s each, then up to 30s
  for predictions. The default function timeout is 30s
  (`deployment_config.sh`); per-function overrides go in that function's
  `deploy.sh` after `source "$CONFIG_FILE"`.
- **Gemini models retire after about 12-15 months.** `gemini-2.5-flash-lite`
  retired 2026-10-20 and broke fun facts. Both call sites use
  `gemini-3.5-flash-lite` on Vertex AI via the `google-genai` SDK
  (`location='global'`, service-account auth, no API keys):
  `iss_api_get_loc_fact/config.py` and `GEMINI_MODEL` in
  `iss_api_query_assistant/utils.py`. (The old AI Studio key secret was
  found invalid in Oct 2026, which is why chat moved to Vertex.) Check the
  lifecycle pages before touching these. Gemini 3 thinking tokens count
  against `max_output_tokens`, so keep headroom; both call sites retry
  without `thinkingConfig` on a 400.
- **Runtimes**: `python310` was deprecated 2026-10-04; everything now runs
  `python312` (deprecated 2028-10-02). Requirements use `>=current,<next-major`
  pins. An unpinned `google-cloud-aiplatform` is what broke the old Vertex
  SDK path.
- `iss_api_query_loc_history` and `iss_api_store_feedback` are IAM-protected:
  a browser gets 403. Only the BFFs, `iss_api_query_time_range` and
  `iss_api_query_assistant` are public.
- The live site has no staging environment. Frontend changes go live when
  pushed to `main`.

## Frontend notes

- Map tiles come from Esri's keyless `Canvas/World_Dark_Gray_Base`. CARTO
  `basemaps.cartocdn.com` now serves an "API KEY REQUIRED" placeholder
  image (with HTTP 200!) for keyless requests. Check tile providers by
  looking at a tile, not the status code.
- The frontend never computes positions: everything comes from the backend
  (see `Metrics Fix Plan.md`'s one-line rule). History can contain duplicate
  timestamps and empty (`isEmpty`) slots; dedupe by timestamp, prefer
  entries with coordinates, and never treat `0` as a missing coordinate.
- Auto-refresh keeps the slider on the user's selected *timestamp*, not its
  index, because each refresh shifts the 24h window.
- Chat (`#chatButton`, `js/chat.js`) talks to `iss_api_query_assistant`. It
  was hidden from Nov 2025 to Oct 2026 while the assistant was broken; to hide
  it again, add `style="display: none;"` to the button in `docs/index.html`.
  Feedback goes through the chat assistant (`action: store_feedback`); there
  is no standalone feedback widget because `iss_api_store_feedback` isn't
  public.
- With live data often empty, test UI changes in a headless browser with
  intercepted mock responses (sinusoidal ground track: lat = 51.6 *
  sin(phase), about +22.5° longitude per 5 minutes) as well as against the
  live backend.
