# ISS Sky Scanner

## Greenfield Frontend Specification (Authoritative)

---

## 1. Executive Summary

Build a static, browser-only frontend for **ISS Sky Scanner** that visualizes International Space Station position data and prediction comparisons using **precomputed backend data only**.

**The frontend performs zero orbital math or prediction logic.**
All coordinates—historical, current, and predicted—are fetched from backend APIs and rendered as-is.

The application consists of two fully isolated views:

* **Map View** – Real-time ISS location with 24h history and 90-minute future predictions.
* **Metrics View** – Comparison of recent actual positions against predictions made 30, 60, and 90 minutes earlier.

---

## 2. Core Architectural Principles

### 2.1 Page Isolation

* Map page and Metrics page are **independent modules**
* No shared JavaScript state between pages
* No global mutable objects
* Each page:

  * Fetches its own data
  * Manages its own timers
  * Cleans up fully on exit

✅ Fresh data on every page switch
✅ No race conditions
✅ Predictable lifecycle
✅ Easier testing and debugging

---

### 2.2 Frontend Responsibility Boundary

**Backend**

* Computes ISS positions
* Computes all predictions
* Determines prediction intervals

**Frontend**

* Fetches backend data
* Parses and normalizes JSON
* Sorts / groups by timestamps (for UI only)
* Renders maps, sliders, and charts

🚫 No prediction computation
🚫 No interpolation or extrapolation
🚫 No orbital mechanics in the browser

---

## 3. Technology Stack

* **HTML5 / CSS3**
* **JavaScript (ES Modules, no build step)**
* **Leaflet.js** – Maps
* **Chart.js** – Metrics graphs
* **Static hosting** (GitHub Pages / GCS / similar)

Target browsers:

* Chrome (latest)
* Firefox (latest)
* Safari (latest)

---

## 4. Project Structure

```text
docs/
├── index.html                 # App shell + navigation
├── css/
│   └── styles.css             # Global styles
├── js/
│   ├── config.js              # API URLs & constants
│   ├── shared/
│   │   ├── api-client.js      # Fetch + retry + errors
│   │   ├── date-utils.js      # Formatting helpers
│   │   └── map-utils.js       # Leaflet helpers
│   ├── map-page/
│   │   ├── map-controller.js
│   │   ├── location-manager.js
│   │   └── history-slider.js
│   ├── metrics-page/
│   │   ├── metrics-controller.js
│   │   └── chart-manager.js
│   └── widgets/
│       ├── message-banner.js
│       └── feedback-widget.js
└── assets/
    └── iss-icon.svg
```

---

## 5. API Configuration (Browser-Facing)

### 5.1 config.js

```js
export const API_CONFIG = {
  HISTORY_RANGE_URL:
    'https://us-east1-iss-sky-scanner-20241222.cloudfunctions.net/iss_api_query_time_range',

  CURRENT_LOCATION_URL:
    'https://iss-api-bff-web-cklav7ht2q-ue.a.run.app/?api_key=BY4FlGM1Kau2eHP6sJR9AiLuvg81ckGo',

  PREDICTIONS_URL:
    'https://iss-api-bff-web-predictions-cklav7ht2q-ue.a.run.app/',
};
```

---

## 6. Data Models (Normalized Frontend Types)

### 6.1 Location

```ts
interface Location {
  timestamp: string;        // ISO 8601
  latitude: number;
  longitude: number;
  location?: string;
  countryCode?: string;
  funFact?: string;
  isEmpty?: boolean;        // gaps in history
}
```

---

### 6.2 Prediction

> Predictions are **never computed** in the frontend.
> This model represents backend output only.

```ts
interface Prediction {
  timestamp: string;        // predicted target time
  latitude: number;
  longitude: number;
  method?: 'orbital_mechanics' | 'sgp4';
  minutesAhead?: number;    // supplied or inferred for labeling only
  sourceTimestamp: string; // when prediction was made
}
```

---

## 7. API Usage by Page

### 7.1 Map Page APIs

1. **24-Hour History**

```text
GET ?minutes=1440
```

2. **Current Location**

```text
GET /?api_key=API_KEY
```

3. **Live Predictions (90 min future)**

```text
GET /?api_key=API_KEY
```

---

### 7.2 Metrics Page APIs

1. **90-Minute Actual History**

```text
GET ?minutes=90
```

2. **Historical Predictions**

```text
GET /?api_key=API_KEY&historical=true
```

---

## 8. Normalization Rules (Critical)

### 8.1 History Range Normalization

* Sort ascending by timestamp
* Deduplicate timestamps
* Prefer non-empty records over `isEmpty=true`
* Preserve gaps (`isEmpty`) for slider visualization
* **Frontend never fills missing points**

---

### 8.2 Prediction Normalization

* Use backend coordinates verbatim
* No resampling
* No smoothing
* No interpolation
* `minutesAhead` is used **only for labels and grouping**

---

## 9. Navigation & Routing

* Single HTML shell with tab navigation
* Views shown / hidden via CSS
* URL hash controls routing:

  * `#map`
  * `#metrics`

### Page Switching Rules

1. Destroy active page controller
2. Clear timers & event listeners
3. Initialize new page controller
4. Fetch data fresh

---

## 10. Map Page Specification

### 10.1 Features

✅ Leaflet dark-themed world map
✅ ISS marker with popup
✅ 24-hour history path
✅ 90-minute future prediction path (dashed)
✅ International date line handling
✅ World-wrap rendering

---

### 10.2 History & Prediction Slider

* Domain:

  * All history points + prediction points
* Index represents **actual backend points only**
* “Now” marker at latest real location
* Labels:

  * Local time
  * UTC time
  * Prediction indicator for future points

---

### 10.3 Controls

* Jump: `-24h`, `Now`, `+90m`
* Step: ±5m, ±15m, ±30m, ±1h
* Buttons auto-disable at bounds

---

### 10.4 Auto-Refresh

* Current location refresh every 5 minutes
* Retry:

  * 7s interval
  * Max 5 attempts
* Stop retrying 60s before next scheduled refresh

---

### 10.5 State Management

```js
class MapController {
  currentLocation = null;
  history = [];
  predictions = [];
  sliderIndex = null;
  autoRefreshTimer = null;

  async init() {}
  destroy() {}
}
```

---

## 11. Metrics Page Specification

### 11.1 Features

✅ Latitude or Longitude vs time graph
✅ True historical path
✅ Prediction overlays:

* Predicted 90 min ago
* Predicted 60 min ago
* Predicted 30 min ago

✅ Metrics comparison map
✅ Toggle legend controls

---

### 11.2 Charts

* Chart.js
* X axis: time from -90 → 0 minutes
* Y axis: latitude or longitude
* Tooltips:

  * Value (4 decimals)
  * Local + UTC timestamp

---

### 11.3 State Management

```js
class MetricsController {
  historicalLocations = [];
  predictions30 = [];
  predictions60 = [];
  predictions90 = [];
  charts = {};
  map = null;

  async init() {}
  destroy() {}
}
```

---

## 12. Shared Components

### 12.1 ApiClient

* Timeout
* Retry with backoff
* Consistent error handling

---

### 12.2 DateUtils

* Timestamp formatting
* Coordinate formatting
* Country code → flag emoji

---

### 12.3 MapUtils

* Leaflet initialization
* ISS marker helpers
* Dateline-safe polyline rendering
  *(visual correction only, not geodetic changes)*

---

## 13. Widgets

### 13.1 Message Banner

* Fetch message text on load
* Display if non-empty
* Dismissible

---

### 13.2 Feedback Widget

* Star rating
* Free-text with word count
* POST to backend

---

## 14. Error Handling & Empty States

* API failure → friendly message
* Partial data → render what’s available
* No crashes on missing prediction sets
* Clear empty states for Metrics page

---

## 15. Performance Targets

* Initial map render: < 3s
* Page switch UI: < 100ms
* Chart render: < 500ms
* No memory leaks on repeated navigation
* 60fps map panning

---

## 16. Testing Strategy

### Unit

* Normalizers
* Date utils
* Slider index logic

### Integration

* Controller lifecycle
* Page switching
* Auto-refresh behavior

### E2E

* Load → Map visible
* Switch → Metrics visible
* Slider moves map
* Legend toggles paths
* API failure recovery

---

## 17. Explicit Non-Goals

🚫 Client-side prediction
🚫 Orbital math in browser
🚫 Offline mode
🚫 WebSockets
🚫 >24h history
🚫 Data export
🚫 3D globe

---

## 18. Success Criteria

✅ Pages fully isolated
✅ All ISS positions originate from backend
✅ No shared state or globals
✅ Clean teardown on navigation
✅ Maps & charts reflect backend truth exactly

---

## **One-Line Rule for Cursor**

> *“The frontend must only visualize backend-provided ISS locations and predictions; it must never calculate, adjust, or invent coordinates.”*

---
