ISS Sky Scanner - Frontend Rebuild Specification

 Executive Summary

 Rebuild the frontend with strict page separation - each page is self-contained and makes its own API calls. No shared state between pages. Fresh data loaded on every page switch.

 ---
 Architecture Principles

 1. Page Isolation

 - Map page and Metrics page are completely independent
 - No shared JavaScript state between pages (no window.locationHistory, window.historicalPredictions)
 - Each page manages its own data lifecycle
 - Fresh API calls when switching pages (acceptable tradeoff for simplicity)

 2. Module Organization

 docs/
 ├── index.html                 # Main HTML with tab navigation
 ├── css/
 │   └── styles.css            # All styles
 ├── js/
 │   ├── config.js             # API endpoints and constants
 │   ├── shared/               # Shared utilities (NEW)
 │   │   ├── api-client.js    # API fetch wrapper
 │   │   ├── date-utils.js    # Timestamp formatting
 │   │   └── map-utils.js     # Leaflet helpers
 │   ├── map-page/             # Map view (NEW structure)
 │   │   ├── map-controller.js
 │   │   ├── location-manager.js
 │   │   └── history-slider.js
 │   ├── metrics-page/         # Metrics view (NEW structure)
 │   │   ├── metrics-controller.js
 │   │   └── chart-manager.js
 │   └── widgets/              # Shared UI widgets
 │       ├── message-banner.js
 │       ├── chat-widget.js    # (currently disabled)
 │       └── feedback-widget.js
 └── assets/
     └── iss-icon.svg

 ---
 API Specification

 Configuration (config.js)

 export const API_CONFIG = {
   // Current ISS location
   CURRENT_LOCATION_URL: 'https://iss-api-bff-web-cklav7ht2q-ue.a.run.app',

   // Predictions (90 minutes ahead)
   PREDICTIONS_URL: 'https://iss-api-bff-web-predictions-cklav7ht2q-ue.a.run.app',

   // Historical data (for metrics comparison)
   HISTORY_RANGE_URL: 'https://us-east1-iss-sky-scanner-20241222.cloudfunctions.net/iss_api_query_time_range',

   // Query specific location history
   LOCATION_QUERY_URL: 'https://us-east1-iss-sky-scanner-20241222.cloudfunctions.net/iss_api_query_loc_history',

   // Chat assistant
   CHAT_URL: 'https://us-east1-iss-sky-scanner-20241222.cloudfunctions.net/iss_api_query_assistant',

   // Feedback submission
   FEEDBACK_URL: 'https://us-east1-iss-sky-scanner-20241222.cloudfunctions.net/iss_api_store_feedback',

   // Message banner
   MESSAGE_URL: 'https://storage.googleapis.com/iss_sky_scanner_site_message/website_message.txt',

   // API Key
   API_KEY: 'BY4FlGM1Kau2eHP6sJR9AiLuvg81ckGo'
 };

 API Endpoints by Page

 Map Page APIs

 1. Current ISS Location (called every 5 minutes)
   - URL: CURRENT_LOCATION_URL?api_key={API_KEY}
   - Response:
 {
   "timestamp": "2024-01-15T10:25:00Z",
   "latitude": "45.1234",
   "longitude": "-122.5678",
   "location": "Portland, Oregon, USA",
   "country_code": "US",
   "fun_fact": "Portland is known as..."
 }
 2. 24-Hour History (called once on page load)
   - URL: HISTORY_RANGE_URL?minutes=1440
   - Returns array of 288 locations (one per 5 minutes)
 3. 90-Minute Predictions (called on page load, then 5s after each refresh)
   - URL: PREDICTIONS_URL?api_key={API_KEY}
   - Response:
 {
   "status": "success",
   "predictions": {
     "orbital_mechanics": [...],  // Array of predictions
     "sgp4": [...]                 // Array of predictions
   }
 }

 Metrics Page APIs

 1. 90-Minute History (called on page load)
   - URL: HISTORY_RANGE_URL?minutes=90
   - Returns last 90 minutes of actual ISS positions
 2. Historical Predictions (called on page load)
   - URL: PREDICTIONS_URL?api_key={API_KEY}&historical=true
   - Response:
 {
   "status": "success",
   "historical_predictions": {
     "predictions_90min_ago": [...],
     "predictions_60min_ago": [...],
     "predictions_30min_ago": [...]
   }
 }

 Shared Widget APIs

 - Message Banner: Fetch from MESSAGE_URL
 - Feedback: POST to FEEDBACK_URL
 - Chat (disabled): POST to CHAT_URL

 ---
 Page Specifications

 Map Page (Map View)

 Data Requirements

 {
   currentLocation: {
     timestamp: string,
     latitude: number,
     longitude: number,
     location: string,
     countryCode: string,
     funFact: string
   },

   history: [
     // Array of 288 locations (24 hours)
     // Index 0 = 24 hours ago
     // Index 287 = most recent (now)
     // Some entries may be placeholders: { timestamp, isEmpty: true }
   ],

   predictions: [
     // Array of predictions for next 90 minutes
     // Grouped by 5-minute intervals
     // Each group has centroid calculated
   ]
 }

 Features

 1. Interactive Map
   - Leaflet.js with dark theme tiles
   - ISS marker with popup (coordinates + location + flag)
   - World-wrap support (markers on both sides of dateline)
   - Center-on-ISS button
   - Prediction path overlay (dashed red line)
 2. History Slider
   - Range: 24 hours past → current → 90 minutes future
   - Total positions: 288 (history) + 18 (predictions) = 306
   - Current position marked as "Now"
   - Time display: Local time + UTC
   - Prediction indicator when in future
 3. Navigation Controls
   - Jump buttons:
       - -24h → Oldest position
     - Now → Current time
     - +90m → Latest prediction
   - Step buttons:
       - ◀ / ▶ → ±5 minutes
     - -15m / +15m
     - -30m / +30m
     - -1h / +1h
   - Buttons disabled at boundaries
 4. Info Cards
   - Current coordinates (formatted with N/S, E/W)
   - Location name with flag emoji
   - Last updated timestamp
   - Fun fact about location
 5. Prediction Legend
   - Toggle visibility of prediction path
   - Visual indicator when predictions shown/hidden
 6. Auto-Refresh
   - Fetch new location every 5 minutes (on xx:x5:xx marks)
   - Retry logic: 7-second intervals, max 5 attempts
   - Stop retrying 60 seconds before next scheduled update
   - Loading/success indicators
 7. Error Handling
   - Display error message on API failure
   - Graceful degradation (show last known data)
   - Retry mechanism with exponential backoff

 State Management

 class MapController {
   constructor() {
     this.currentLocation = null;
     this.history = [];            // 288 entries
     this.predictions = [];        // 18 entries (90 min / 5 min intervals)
     this.sliderPosition = 287;    // Default to "now"
     this.autoRefreshTimer = null;
     this.retryTimer = null;
     this.isFetching = false;
   }

   async init() {
     await this.loadHistory();      // Fetch 24h history
     await this.loadCurrentLocation(); // Fetch current
     await this.loadPredictions();  // Fetch predictions
     this.initMap();
     this.initSlider();
     this.startAutoRefresh();
   }

   destroy() {
     clearTimeout(this.autoRefreshTimer);
     clearTimeout(this.retryTimer);
     // Clean up Leaflet map
   }
 }

 Lifecycle

 1. Page Load / Tab Switch to Map
    ↓
 2. Initialize MapController
    ↓
 3. Fetch APIs in parallel:
    - loadHistory() → 24h data
    - loadCurrentLocation() → current ISS
    - loadPredictions() → 90min predictions
    ↓
 4. Render UI:
    - Update info cards
    - Draw map with current location
    - Set slider range (0-305)
    - Position slider at "now" (287)
    ↓
 5. Start auto-refresh (5-minute cycle)
    ↓
 6. On tab switch away:
    - Call destroy()
    - Clear timers
    - Remove event listeners

 ---
 Metrics Page (Metrics View)

 Data Requirements

 {
   historicalLocations: [
     // Last 90 minutes of actual ISS positions
     // 19 entries (one per 5 minutes)
     { timestamp, latitude, longitude }
   ],

   historicalPredictions: {
     predictions90minAgo: [...],  // What we predicted 90 min ago
     predictions60minAgo: [...],  // What we predicted 60 min ago
     predictions30minAgo: [...]   // What we predicted 30 min ago
   }
 }

 Features

 1. Graph Selector
   - Dropdown to toggle between:
       - Latitude over time
     - Longitude over time
   - Single graph visible at a time
 2. Chart.js Graphs
   - X-axis: Time (minutes from now, -90 to 0)
   - Y-axis: Latitude (-90° to 90°) or Longitude (-180° to 180°)
   - Datasets:
       - Historical Path (solid red line)
     - Predicted 90min ago (dashed orange)
     - Predicted 60min ago (dashed gold)
     - Predicted 30min ago (dashed yellow)
   - Interactive tooltips:
       - Value (4 decimal places)
     - Timestamp (local + UTC)
   - Legend with click-to-toggle
 3. Metrics Map
   - Leaflet.js with dark theme
   - Overlaid paths:
       - True historical (solid red)
     - Prediction paths (dashed orange/gold/yellow)
   - World-wrap support
   - Auto-fit bounds to show all paths
 4. Path Legend
   - Toggle visibility:
       - ☑ True Historical Path
     - ☑ Predicted 90min ago
     - ☑ Predicted 60min ago
     - ☑ Predicted 30min ago
   - Click to show/hide each path
 5. Empty State
   - Show message if no data available
   - Graceful handling of missing predictions

 State Management

 class MetricsController {
   constructor() {
     this.historicalLocations = [];
     this.predictions90 = [];
     this.predictions60 = [];
     this.predictions30 = [];
     this.charts = { latitude: null, longitude: null };
     this.map = null;
     this.pathVisibility = {
       historical: true,
       pred90: true,
       pred60: true,
       pred30: true
     };
   }

   async init() {
     await this.loadHistoricalData();
     await this.loadHistoricalPredictions();
     this.initCharts();
     this.initMap();
     this.renderCharts();
     this.renderMapPaths();
   }

   destroy() {
     // Destroy Chart.js instances
     // Clean up Leaflet map
   }
 }

 Lifecycle

 1. Tab Switch to Metrics
    ↓
 2. Initialize MetricsController
    ↓
 3. Fetch APIs in parallel:
    - loadHistoricalData() → 90min history
    - loadHistoricalPredictions() → comparison data
    ↓
 4. Render UI:
    - Create Chart.js graphs
    - Draw metrics map
    - Process predictions for intervals
    - Match predictions to 5-minute marks
    ↓
 5. Interactive updates:
    - Graph selector changes
    - Legend toggle clicks
    - Map pan/zoom
    ↓
 6. On tab switch away:
    - Call destroy()
    - Clean up charts and map

 ---
 Shared Components

 1. API Client (api-client.js)

 export class ApiClient {
   static async fetch(url, options = {}) {
     // Centralized fetch wrapper
     // Error handling
     // Retry logic
     // Request timeout
     // Response validation
   }

   static async fetchWithRetry(url, maxRetries = 3) {
     // Exponential backoff
   }
 }

 2. Date Utils (date-utils.js)

 export class DateUtils {
   static roundToNearest5Minutes(date) {
     // Round to 5-minute interval
     // Use UTC methods for consistency
   }

   static formatTimestamp(isoString) {
     // Return: "Jan 15, 2024 10:25:00 AM PST\nJan 15, 2024 6:25:00 PM UTC"
   }

   static formatCoordinates(lat, lon) {
     // Return: "45.1234° N, 122.5678° W"
   }

   static getCountryFlag(location, countryCode) {
     // Convert country code to emoji flag
   }
 }

 3. Map Utils (map-utils.js)

 export class MapUtils {
   static createDarkMap(elementId) {
     // Initialize Leaflet with dark theme
     // Return map instance
   }

   static createISSMarker(lat, lon, location) {
     // Create ISS icon marker
     // Bind popup
   }

   static createWorldWrapMarkers(map, lat, lon, markerOptions) {
     // Create markers on all visible world copies
     // Return array of markers
   }

   static normalizeLongitudePath(points) {
     // Handle dateline crossing for polylines
     // Avoid path wrapping issues
   }

   static drawPredictionPath(map, points, options) {
     // Draw dashed polyline
     // Handle world-wrap
   }
 }

 4. Message Banner (message-banner.js)

 class MessageBanner {
   async init() {
     // Fetch message from GCS
     // Display if not empty
   }

   show(message) { /* ... */ }
   hide() { /* ... */ }
 }

 // Auto-initialize on DOMContentLoaded
 document.addEventListener('DOMContentLoaded', () => {
   new MessageBanner().init();
 });

 5. Feedback Widget (feedback-widget.js)

 class FeedbackWidget {
   init() {
     // Set up event listeners
     // Star rating
     // Word count validation
   }

   async submitFeedback(rating, text) {
     // POST to API
     // Show success/error message
   }
 }

 // Auto-initialize
 document.addEventListener('DOMContentLoaded', () => {
   new FeedbackWidget().init();
 });

 ---
 Navigation & Routing

 Tab Navigation

 // In index.html <script type="module">

 let currentPage = null;
 let currentController = null;

 async function switchToPage(pageName) {
   // Hide all views
   document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));

   // Destroy current controller
   if (currentController?.destroy) {
     currentController.destroy();
     currentController = null;
   }

   // Show new view
   const view = document.getElementById(`view-${pageName}`);
   view.classList.add('active');

   // Initialize new controller
   if (pageName === 'map') {
     const { MapController } = await import('./js/map-page/map-controller.js');
     currentController = new MapController();
     await currentController.init();
   } else if (pageName === 'metrics') {
     const { MetricsController } = await import('./js/metrics-page/metrics-controller.js');
     currentController = new MetricsController();
     await currentController.init();
   }

   currentPage = pageName;

   // Update URL hash
   window.location.hash = pageName;
 }

 // Handle tab clicks
 document.querySelectorAll('.nav-tab').forEach(tab => {
   tab.addEventListener('click', () => {
     const page = tab.dataset.view;
     switchToPage(page);
   });
 });

 // Handle browser back/forward
 window.addEventListener('popstate', () => {
   const page = window.location.hash.slice(1) || 'map';
   switchToPage(page);
 });

 // Initialize on load
 window.addEventListener('load', () => {
   const initialPage = window.location.hash.slice(1) || 'map';
   switchToPage(initialPage);
 });

 ---
 Data Models

 Location Object

 interface Location {
   timestamp: string;        // ISO 8601
   latitude: number;
   longitude: number;
   location?: string;        // "Portland, Oregon, USA"
   countryCode?: string;     // "US"
   funFact?: string;
   isEmpty?: boolean;        // Placeholder for missing data
 }

 Prediction Object

 interface Prediction {
   timestamp: string;
   latitude: number;
   longitude: number;
   method: 'orbital_mechanics' | 'sgp4';
   minutesAhead: number;
   sourceTimestamp: string;  // When prediction was made
 }

 Prediction Group (for display)

 interface PredictionGroup {
   timestamp: string;        // Rounded to 5-minute interval
   centroidLat: number;      // Average of all predictions
   centroidLon: number;      // Longitude average (handles wrapping)
   predictions: Prediction[]; // All predictions for this time
 }

 ---
 Storage Strategy

 No Persistent Storage

 - Map Page: All data in memory, cleared on page switch
 - Metrics Page: All data in memory, cleared on page switch
 - Benefits:
   - Simpler architecture
   - Always fresh data
   - No stale data issues
   - No cache invalidation complexity

 Optional: SessionStorage for Performance

 If performance becomes an issue:
 // Cache 24-hour history for 5 minutes
 const CACHE_KEY = 'iss_24h_history';
 const CACHE_DURATION = 5 * 60 * 1000; // 5 minutes

 async function loadHistory() {
   const cached = sessionStorage.getItem(CACHE_KEY);
   if (cached) {
     const { data, timestamp } = JSON.parse(cached);
     if (Date.now() - timestamp < CACHE_DURATION) {
       return data;
     }
   }

   const data = await fetchHistory();
   sessionStorage.setItem(CACHE_KEY, JSON.stringify({
     data,
     timestamp: Date.now()
   }));
   return data;
 }

 ---
 Error Handling

 API Error Handling

 class ApiError extends Error {
   constructor(message, statusCode, response) {
     super(message);
     this.statusCode = statusCode;
     this.response = response;
   }
 }

 async function fetchWithErrorHandling(url) {
   try {
     const response = await fetch(url);

     if (!response.ok) {
       throw new ApiError(
         `API returned ${response.status}`,
         response.status,
         await response.text()
       );
     }

     const data = await response.json();
     return data;

   } catch (error) {
     if (error instanceof ApiError) {
       // Show user-friendly error
       showError(`Failed to load data: ${error.message}`);
     } else {
       // Network error
       showError('Network error. Please check your connection.');
     }
     throw error;
   }
 }

 Graceful Degradation

 // Map page: Show last known location if refresh fails
 if (!newLocation && this.currentLocation) {
   showWarning('Could not fetch latest location. Showing last known position.');
 }

 // Metrics page: Show partial data if predictions unavailable
 if (!predictions60) {
   console.warn('60-minute predictions unavailable, showing available data');
   renderChartsWithPartialData();
 }

 // Empty states
 if (history.length === 0) {
   showEmptyState('No historical data available. Please try again later.');
 }

 ---
 UI/UX Requirements

 Loading States

 // Map page initialization
 showLoader('Loading ISS location...');
 await Promise.all([loadHistory(), loadCurrent(), loadPredictions()]);
 hideLoader();

 // Auto-refresh
 showRefreshIndicator(); // Subtle indicator
 await fetchNewLocation();
 hideRefreshIndicator();

 // Metrics page
 showLoader('Loading historical data...');
 await loadMetricsData();
 hideLoader();

 Responsive Design

 - Mobile-first approach
 - Map: Full-width on mobile, side-by-side with info on desktop
 - Slider: Touch-friendly on mobile
 - Graphs: Responsive Chart.js configuration
 - Navigation: Tab bar stacks on mobile

 Accessibility

 - ARIA labels for all interactive elements
 - Keyboard navigation support
 - Focus indicators
 - Screen reader announcements for data updates
 - High contrast mode support

 ---
 Performance Targets

 Initial Load (Map Page)

 - Time to Interactive: < 2 seconds
 - API calls complete: < 3 seconds
 - Map rendered: < 1 second

 Page Switch

 - View transition: < 100ms
 - Data load: < 2 seconds
 - Chart rendering: < 500ms

 Auto-Refresh

 - Fetch time: < 1 second
 - UI update: < 100ms
 - No visual jank

 Metrics Page

 - Graph rendering: < 500ms
 - Path drawing: < 300ms
 - Smooth interactions: 60fps

 ---
 Testing Strategy

 Unit Tests (Jest)

 - DateUtils.roundToNearest5Minutes()
 - MapUtils.normalizeLongitudePath()
 - ApiClient.fetchWithRetry()
 - Prediction centroid calculation
 - Timestamp matching logic

 Integration Tests

 - Map controller lifecycle
 - Metrics controller lifecycle
 - Page switching (destroy → init)
 - Auto-refresh cycle
 - Slider navigation

 E2E Tests (Playwright)

 - Full page load → map displayed
 - Tab switch → metrics displayed
 - Slider interaction → map updates
 - Legend toggle → paths hide/show
 - Error recovery → retry works

 ---
 Migration Plan

 Phase 1: Shared Utils

 1. Create js/shared/api-client.js
 2. Create js/shared/date-utils.js
 3. Create js/shared/map-utils.js
 4. Extract common functions from existing code

 Phase 2: Map Page

 1. Create js/map-page/map-controller.js
 2. Create js/map-page/location-manager.js
 3. Create js/map-page/history-slider.js
 4. Migrate logic from main.js
 5. Test map page in isolation

 Phase 3: Metrics Page

 1. Create js/metrics-page/metrics-controller.js
 2. Create js/metrics-page/chart-manager.js
 3. Migrate logic from metrics.js
 4. Test metrics page in isolation

 Phase 4: Navigation

 1. Implement page switching logic
 2. Add destroy() methods to controllers
 3. Test page transitions
 4. Verify no memory leaks

 Phase 5: Widgets

 1. Update message banner (already independent)
 2. Update feedback widget (already independent)
 3. Keep chat widget disabled

 Phase 6: Testing & Polish

 1. Add error handling
 2. Add loading states
 3. Responsive design testing
 4. Performance optimization
 5. Accessibility audit

 ---
 Success Criteria

 ✅ Functional Requirements
 - Map page displays ISS location with 24h history + 90min predictions
 - Metrics page displays last 90 minutes with prediction comparison
 - No shared state between pages
 - Fresh data on every page switch
 - Auto-refresh works on map page
 - All interactive elements work (slider, legend toggles, etc.)

 ✅ Non-Functional Requirements
 - Page switch < 100ms visual transition
 - Initial load < 3 seconds
 - No console errors
 - No memory leaks on repeated page switches
 - Mobile responsive
 - Works in Chrome, Firefox, Safari

 ✅ Code Quality
 - Clean module boundaries
 - No global state pollution
 - Testable functions
 - Documented public APIs
 - Consistent error handling

 ---
 Future Enhancements (Out of Scope)

 - Offline mode with service workers
 - Real-time WebSocket updates
 - Historical data visualization (beyond 24 hours)
 - Custom time range selection
 - Export data as CSV/JSON
 - Share specific timestamps via URL
 - Notification when ISS passes overhead
 - 3D globe visualization

 ---
 Appendix: Current vs. New Architecture

 Current Architecture Issues

 ❌ Shared global state (window.locationHistory)
 ❌ Race conditions between pages
 ❌ Metrics page depends on map page data
 ❌ Unclear initialization order
 ❌ Predictions fetched even when not needed
 ❌ Complex event-driven communication
 ❌ Memory leaks on page switch (no cleanup)

 New Architecture Benefits

 ✅ Complete page isolation
 ✅ No race conditions (each page owns its data)
 ✅ Clear initialization sequence per page
 ✅ Only fetch APIs needed for current page
 ✅ Simple, predictable data flow
 ✅ Proper cleanup on page switch
 ✅ Easier to test and debug

 ---
 End of Specification
