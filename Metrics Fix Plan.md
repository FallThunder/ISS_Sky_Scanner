Here’s a “from-scratch” spec you can hand to Cursor. It keeps the same APIs and behavior, but treats this as a brand-new greenfield frontend, not a refactor of existing code.

---

# ISS Sky Scanner – Greenfield Frontend Specification

## 1. Overview

Build a **static, client-side web application** that visualizes the current and historical position of the ISS and compares actual positions against prediction models.

Key characteristics:

* Pure frontend (static files, no server-side code).
* No global app state shared between pages.
* Each page is **self-contained** and **fetches its own data**.
* Minimal dependencies: **Leaflet** for maps, **Chart.js** for charts, vanilla JS modules for logic.

---

## 2. Tech Stack & Project Structure

### 2.1 Tech Stack

* **HTML/CSS/JavaScript (ES6 modules, no bundler required)**
* **Leaflet** for mapping
* **Chart.js** for charts
* Target browsers: latest Chrome, Firefox, Safari

### 2.2 File Structure

```text
docs/
├── index.html                 # Single-page shell with tab navigation
├── css/
│   └── styles.css             # All layout and visual styles
├── js/
│   ├── config.js              # API endpoints and constants
│   ├── shared/
│   │   ├── api-client.js      # Fetch wrapper, errors, retry
│   │   ├── date-utils.js      # Date & time helpers
│   │   └── map-utils.js       # Leaflet helpers
│   ├── map-page/
│   │   ├── map-controller.js  # Page controller
│   │   ├── location-manager.js# Data transformation for map
│   │   └── history-slider.js  # Slider and time navigation
│   ├── metrics-page/
│   │   ├── metrics-controller.js  # Page controller
│   │   └── chart-manager.js       # Chart.js setup & updates
│   └── widgets/
│       ├── message-banner.js  # Site-wide banner
│       └── feedback-widget.js # Feedback UI & submission
└── assets/
    └── iss-icon.svg
```

* `index.html` contains both main views: **Map** and **Metrics**, shown/hidden via JS.
* Navigation is handled client-side via hash (`#map`, `#metrics`).

---

## 3. Configuration & APIs

### 3.1 `config.js`

```js
export const API_CONFIG = {
  CURRENT_LOCATION_URL: 'https://iss-api-bff-web-cklav7ht2q-ue.a.run.app',
  PREDICTIONS_URL: 'https://iss-api-bff-web-predictions-cklav7ht2q-ue.a.run.app',
  HISTORY_RANGE_URL: 'https://us-east1-iss-sky-scanner-20241222.cloudfunctions.net/iss_api_query_time_range',
  LOCATION_QUERY_URL: 'https://us-east1-iss-sky-scanner-20241222.cloudfunctions.net/iss_api_query_loc_history',
  CHAT_URL: 'https://us-east1-iss-sky-scanner-20241222.cloudfunctions.net/iss_api_query_assistant',
  FEEDBACK_URL: 'https://us-east1-iss-sky-scanner-20241222.cloudfunctions.net/iss_api_store_feedback',
  MESSAGE_URL: 'https://storage.googleapis.com/iss_sky_scanner_site_message/website_message.txt',
  API_KEY: 'BY4FlGM1Kau2eHP6sJR9AiLuvg81ckGo'
};
```

### 3.2 API Usage by Page

#### Map Page

1. **Current ISS Location** (every 5 minutes)

   * `GET CURRENT_LOCATION_URL?api_key={API_KEY}`
   * Response:

     ```json
     {
       "timestamp": "2024-01-15T10:25:00Z",
       "latitude": "45.1234",
       "longitude": "-122.5678",
       "location": "Portland, Oregon, USA",
       "country_code": "US",
       "fun_fact": "Portland is known as..."
     }
     ```

2. **24-Hour History** (once on page init)

   * `GET HISTORY_RANGE_URL?minutes=1440`
   * Returns an array of 288 location objects (5-minute intervals).

3. **90-Minute Predictions** (on init, and after each location refresh)

   * `GET PREDICTIONS_URL?api_key={API_KEY}`
   * Response:

     ```json
     {
       "status": "success",
       "predictions": {
         "orbital_mechanics": [...],
         "sgp4": [...]
       }
     }
     ```

#### Metrics Page

1. **90-Minute Location History**

   * `GET HISTORY_RANGE_URL?minutes=90`
   * 19 entries (0–90 min in 5-minute steps).

2. **Historical Predictions**

   * `GET PREDICTIONS_URL?api_key={API_KEY}&historical=true`
   * Response:

     ```json
     {
       "status": "success",
       "historical_predictions": {
         "predictions_90min_ago": [...],
         "predictions_60min_ago": [...],
         "predictions_30min_ago": [...]
       }
     }
     ```

#### Shared Widgets

* **Message banner:** `GET MESSAGE_URL` (plain text).
* **Feedback submission:** `POST FEEDBACK_URL`.
* **Chat:** out of scope for now (endpoint exists but UI disabled).

---

## 4. Data Models

```ts
interface Location {
  timestamp: string;       // ISO 8601
  latitude: number;
  longitude: number;
  location?: string;
  countryCode?: string;
  funFact?: string;
  isEmpty?: boolean;       // Placeholder when data is missing
}

interface Prediction {
  timestamp: string;       // prediction time
  latitude: number;
  longitude: number;
  method: 'orbital_mechanics' | 'sgp4';
  minutesAhead: number;
  sourceTimestamp: string; // when the prediction was generated
}

interface PredictionGroup {
  timestamp: string;      // rounded to nearest 5-minute interval
  centroidLat: number;
  centroidLon: number;
  predictions: Prediction[];
}
```

Map page and Metrics page transform raw API shapes into these normalized models before rendering.

---

## 5. Application Architecture

### 5.1 Page Isolation

* Two logical pages:

  * **Map View** (`view-map`)
  * **Metrics View** (`view-metrics`)
* Each page has its own controller:

  * `MapController`
  * `MetricsController`
* No shared JavaScript state between pages:

  * No global arrays or shared history objects.
  * No cross-page references.

On navigation:

1. Current controller’s `destroy()` is called.
2. DOM for previous view remains but is hidden.
3. New controller is created and `init()` is called.

### 5.2 Navigation & Routing (index.html)

* Tabs at the top:

  * `<button class="nav-tab" data-view="map">Map</button>`
  * `<button class="nav-tab" data-view="metrics">Metrics</button>`
* JS in `index.html` (module script):

```js
let currentController = null;
let currentPage = null;

async function switchToPage(pageName) {
  document.querySelectorAll('.view').forEach(v =>
    v.classList.remove('active')
  );

  if (currentController?.destroy) {
    currentController.destroy();
    currentController = null;
  }

  const view = document.getElementById(`view-${pageName}`);
  view.classList.add('active');

  if (pageName === 'map') {
    const { MapController } = await import('./js/map-page/map-controller.js');
    currentController = new MapController();
  } else if (pageName === 'metrics') {
    const { MetricsController } = await import('./js/metrics-page/metrics-controller.js');
    currentController = new MetricsController();
  }

  await currentController.init();
  currentPage = pageName;
  window.location.hash = pageName;
}

document.querySelectorAll('.nav-tab').forEach(tab => {
  tab.addEventListener('click', () => switchToPage(tab.dataset.view));
});

window.addEventListener('popstate', () => {
  const page = window.location.hash.slice(1) || 'map';
  switchToPage(page);
});

window.addEventListener('load', () => {
  const initialPage = window.location.hash.slice(1) || 'map';
  switchToPage(initialPage);
});
```

---

## 6. Map Page Specification

### 6.1 Required Data

```ts
{
  currentLocation: Location | null;
  history: Location[];      // 288 entries (past 24h)
  predictions: PredictionGroup[]; // next 90 min in 5-min steps
}
```

### 6.2 Features

1. **Interactive Map**

   * Leaflet map with a dark basemap.
   * ISS marker with popup:

     * Coordinates (formatted with N/S, E/W).
     * Location name.
     * Country flag emoji.
   * World-wrap: markers on all visible world copies.
   * “Center on ISS” button.
   * Prediction path as a dashed polyline.

2. **History & Future Slider**

   * Range covers:

     * 24h past (288 points) + 90min future (18 points) = 306 positions.
   * Position index mapping:

     * `0` → 24 hours ago.
     * `287` → “Now” (current location).
     * `288–305` → prediction steps.
   * Display:

     * Local time and UTC time for selected point.
     * Indicator when selecting a prediction (future).

3. **Navigation Controls**

   * Jump buttons:

     * `-24h`, `Now`, `+90m`.
   * Step controls:

     * `◀` / `▶` (±5 min).
     * `-15m` / `+15m`.
     * `-30m` / `+30m`.
     * `-1h` / `+1h`.
   * All buttons disabled at range boundaries.

4. **Info Cards**

   * Coordinate display: `45.1234° N, 122.5678° W`.
   * Location name + country flag.
   * “Last updated” timestamp (local + UTC).
   * Fun fact text.

5. **Prediction Legend**

   * Toggle to show/hide prediction path.
   * Visual state indicating whether predictions are visible.

6. **Auto-Refresh**

   * Fetch new current location every 5 minutes.
   * Behavior:

     * Align to real time (xx:x0 or xx:x5 style intervals, as appropriate).
     * After each successful fetch:

       * Update `currentLocation`.
       * Shift `history` if needed.
       * Recompute prediction groups.
       * Update map and slider.
   * Retry logic:

     * On failure, retry every 7s up to 5 attempts.
     * Stop retrying 60s before next scheduled refresh window.

7. **Error Handling**

   * User-friendly error message on failures.
   * If refresh fails but existing `currentLocation` exists:

     * Show warning and keep last known position.
   * Empty-state message if no history is available.

### 6.3 Map Page State Management

```js
export class MapController {
  constructor() {
    this.currentLocation = null;
    this.history = [];
    this.predictions = [];
    this.sliderPosition = 287;
    this.autoRefreshTimer = null;
    this.retryTimer = null;
    this.isFetching = false;
    this.map = null;
    this.mapMarkers = [];
    this.predictionLayer = null;
  }

  async init() {
    this.initUIRefs();            // cache DOM elements
    this.showLoader('Loading ISS data...');
    await Promise.all([
      this.loadHistory(),
      this.loadCurrentLocation(),
      this.loadPredictions()
    ]);
    this.initMap();
    this.initSlider();
    this.initControls();
    this.updateUIFromSlider();
    this.startAutoRefresh();
    this.hideLoader();
  }

  destroy() {
    clearTimeout(this.autoRefreshTimer);
    clearTimeout(this.retryTimer);
    if (this.map) {
      this.map.remove();
      this.map = null;
    }
    // Remove event listeners as needed.
  }
}
```

Implementation details:

* `loadHistory()`: uses `ApiClient` to fetch 24h data and normalize into `Location[]`.
* `loadCurrentLocation()`: fetches current location and sets `sliderPosition = 287`.
* `loadPredictions()`: fetches predictions, groups into `PredictionGroup[]`.
* `updateUIFromSlider()`: chooses data source (history vs predictions) and updates map + cards.

---

## 7. Metrics Page Specification

### 7.1 Required Data

```ts
{
  historicalLocations: Location[];   // last 90 min, 19 entries
  predictions90: Prediction[];       // predicted positions made 90 min ago
  predictions60: Prediction[];       // predicted positions made 60 min ago
  predictions30: Prediction[];       // predicted positions made 30 min ago
}
```

### 7.2 Features

1. **Graph Selector**

   * Dropdown to choose:

     * “Latitude vs Time”
     * “Longitude vs Time”
   * Only one chart visible at a time.

2. **Charts (Chart.js)**

   * X-axis: time in minutes from now (`-90, -85, ..., 0`).
   * Y-axis:

     * Latitude: `[-90, 90]`.
     * Longitude: `[-180, 180]`.
   * Datasets:

     * Historical actual path: solid red.
     * Prediction paths:

       * 90 min ago (dashed orange).
       * 60 min ago (dashed gold).
       * 30 min ago (dashed yellow).
   * Tooltips show:

     * Value (4 decimal places).
     * Local + UTC timestamps.
   * Legend supports click-to-toggle dataset visibility.

3. **Metrics Map**

   * Leaflet dark basemap.
   * Paths:

     * Actual historical path (solid red).
     * Predicted paths in different dashed colors.
   * World-wrap handling for dateline crossing.
   * Auto-fit bounds to show all paths.

4. **Path Legend**

   * Checkboxes:

     * True historical path
     * Predicted 90 min ago
     * Predicted 60 min ago
     * Predicted 30 min ago
   * Toggling affects both map and chart visibility.

5. **Empty & Partial Data States**

   * If any prediction series is missing:

     * Show notice but render available data.
   * If core historical data missing:

     * Show empty-state message with retry option.

### 7.3 Metrics Page State Management

```js
export class MetricsController {
  constructor() {
    this.historicalLocations = [];
    this.predictions90 = [];
    this.predictions60 = [];
    this.predictions30 = [];
    this.charts = { latitude: null, longitude: null };
    this.map = null;
    this.layers = {
      historical: null,
      pred90: null,
      pred60: null,
      pred30: null
    };
    this.pathVisibility = {
      historical: true,
      pred90: true,
      pred60: true,
      pred30: true
    };
  }

  async init() {
    this.initUIRefs();
    this.showLoader('Loading metrics...');
    await Promise.all([
      this.loadHistoricalData(),
      this.loadHistoricalPredictions()
    ]);
    this.initCharts();
    this.initMap();
    this.renderCharts();
    this.renderMapPaths();
    this.initLegendControls();
    this.hideLoader();
  }

  destroy() {
    Object.values(this.charts).forEach(c => c?.destroy?.());
    if (this.map) {
      this.map.remove();
      this.map = null;
    }
  }
}
```

---

## 8. Shared Modules

### 8.1 `api-client.js`

Responsibilities:

* Wrap `fetch` with:

  * JSON parsing.
  * Error handling with `ApiError`.
  * Optional retry with exponential backoff.
  * Optional timeout.

Sketch:

```js
export class ApiError extends Error {
  constructor(message, statusCode, response) {
    super(message);
    this.statusCode = statusCode;
    this.response = response;
  }
}

export class ApiClient {
  static async fetchJson(url, options = {}) {
    const controller = new AbortController();
    const timeout = options.timeout ?? 10000;
    const id = setTimeout(() => controller.abort(), timeout);

    try {
      const res = await fetch(url, { ...options, signal: controller.signal });
      if (!res.ok) {
        throw new ApiError(`API returned ${res.status}`, res.status, await res.text());
      }
      return await res.json();
    } finally {
      clearTimeout(id);
    }
  }

  static async fetchWithRetry(url, { retries = 3, retryDelayMs = 500, ...opts } = {}) {
    let attempt = 0;
    while (true) {
      try {
        return await this.fetchJson(url, opts);
      } catch (err) {
        attempt++;
        if (attempt > retries) throw err;
        await new Promise(r => setTimeout(r, retryDelayMs * attempt));
      }
    }
  }
}
```

### 8.2 `date-utils.js`

Responsibilities:

* Round timestamps to nearest 5 minutes (UTC).
* Format timestamps for UI (`"Jan 15, 2024 10:25 AM Local\nJan 15, 2024 6:25 PM UTC"`).
* Format coordinates with N/S, E/W.
* Country code → flag emoji.

### 8.3 `map-utils.js`

Responsibilities:

* Initialize Leaflet maps with dark tiles.
* Create ISS markers with custom icon.
* Handle world-wrap (duplicate markers on wrapped worlds).
* Normalize coordinate paths that cross the dateline.
* Draw prediction paths as polylines.

---

## 9. Widgets

### 9.1 Message Banner (`message-banner.js`)

* On `DOMContentLoaded`:

  * Fetch banner text from `MESSAGE_URL`.
  * If non-empty, display at top of page with dismiss button.
* Methods:

  * `init()`, `show(message)`, `hide()`.

### 9.2 Feedback Widget (`feedback-widget.js`)

* Star rating (e.g., 1–5).
* Free-text field with character limit & counter.
* Submit button:

  * Validates rating + text.
  * Sends `POST` to `FEEDBACK_URL`.
  * Shows success or error confirmation.

---

## 10. UX, Responsiveness & Accessibility

### 10.1 Responsive Layout

* **Mobile first**:

  * Map is full-width with controls stacked.
  * Charts are full-width, legends below.
* **Desktop**:

  * Map + info cards side-by-side.
  * Metrics: chart and map can be stacked or side-by-side depending on width.

### 10.2 Accessibility

* ARIA labels for all controls.
* Keyboard navigation:

  * Tab order logical.
  * Space/Enter activate buttons and toggle checkboxes.
* Visible focus outline for interactive elements.
* Screen-reader updates on:

  * New data arrival.
  * Error/empty-state messages.

---

## 11. Performance Targets

* Initial map view:

  * Time to interactive: < 2s.
  * All initial API calls: < 3s (under normal network conditions).
* Page switch:

  * DOM view switch: < 100ms.
  * New data load: < 2s.
* Chart render: < 500ms for metrics page.
* Map path drawing: < 300ms.
* Auto-refresh update (map):

  * Fetch + update with no visible jank.

---

## 12. Testing

### 12.1 Unit Tests (Jest or similar)

* `DateUtils.roundToNearest5Minutes()`.
* `DateUtils.formatCoordinates()`.
* `MapUtils.normalizeLongitudePath()`.
* `ApiClient.fetchWithRetry()` (incl. backoff).
* Prediction centroid calculations and grouping.

### 12.2 Integration Tests

* MapController lifecycle:

  * `init()` loads data, renders map, slider works.
  * `destroy()` cleans timers & map.
* MetricsController lifecycle:

  * `init()` loads data, renders charts & map, legend toggles.
* Page switching:

  * Repeated switch between `map` and `metrics` produces no memory leaks (no orphan timers, maps, or charts).
* Auto-refresh behavior:

  * Triggers at correct intervals.
  * Stops on `destroy()`.

### 12.3 E2E Tests (Playwright or similar)

* Load app → map visible → ISS marker present.
* Change tabs → metrics view visible → graphs rendered.
* Move slider → map position and info cards update.
* Toggle legend → chart/map datasets hide/show.
* Simulated API failure → error messages & graceful fallback.

---

## 13. Scope & Non-Goals

**Included:**

* Map view with 24h history + 90min predictions.
* Metrics view with 90min comparison charts + map.
* Feedback widget and message banner.
* Page isolation and clean controller lifecycles.

**Out of Scope (future work):**

* Offline support / service workers.
* WebSocket real-time updates.
* > 24h historical data visualizations.
* Custom arbitrary time ranges.
* Data export (CSV/JSON).
* Notifications for overhead passes.
* 3D globe visualization.

---

If you’d like, I can next generate **starter files** (e.g., `index.html`, `config.js`, stub controllers) in a Cursor-friendly layout so you can drop them directly into your repo.
