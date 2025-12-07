Fix Metrics Page Historical Data Not Displaying

 Problem Analysis

 The metrics page is not displaying historical location data because of a race condition between data loading and metrics initialization:

 1. Metrics.js doesn't call APIs - it reads from window.locationHistory and window.historicalPredictions set by main.js
 2. Lazy initialization - metrics page only initializes when the user clicks the "Metrics" tab
 3. Race condition - if metrics tab is clicked before main.js completes loading data, charts are empty
 4. Insufficient delay - 300ms timeout doesn't guarantee data availability
 5. No retry mechanism - if data isn't ready, metrics stays empty permanently

 Root Cause

 docs/js/metrics.js (lines 36-40):
 // Add a small delay to ensure locationHistory is available
 setTimeout(() => {
     updateGraphsWithHistoricalData();
 }, 300);

 This arbitrary 300ms delay doesn't account for:
 - Initial 24-hour history API call: iss_api_query_time_range?minutes=1440
 - Predictions API call: iss_api_bff-web-predictions
 - Network latency

 Solution

 Implement a data readiness check instead of arbitrary delays:

 Option 1: Data Ready Event (Recommended)

 Have main.js dispatch a custom event when data is ready, and metrics.js listens for it.

 Option 2: Polling with Timeout

 Poll for data availability with exponential backoff until ready or timeout.

 Option 3: Direct Update Hook

 Expose a function in metrics.js that main.js calls after loading data.

 Implementation Plan

 Approach: Data Ready Event (Clean separation of concerns)

 Files to modify:
 - docs/js/main.js - Dispatch data ready events
 - docs/js/metrics.js - Listen for data ready events and retry

 Changes:

 1. main.js - Dispatch events when data is ready

 Location: After line 72 (history initialized):
 console.log('init: Location history initialized, count:', locationHistory.getLocations().length);
 // Dispatch event to notify metrics that history data is ready
 window.dispatchEvent(new CustomEvent('issHistoryReady'));

 Location: After line 1232 (predictions loaded):
 // Trigger metrics update if metrics page is already initialized
 if (typeof window !== 'undefined' && window.updateMetricsGraphs) {
     window.updateMetricsGraphs();
 }
 // Dispatch event to notify metrics that predictions are ready
 window.dispatchEvent(new CustomEvent('issPredictionsReady'));

 2. metrics.js - Listen for data ready events

 Replace initMetricsPage() implementation (lines 31-40):
 function initMetricsPage() {
     initMetricsMap();
     initMetricsGraphs();
     initGraphSelector();
     initMetricsLegendToggle();

     // Set up event listeners for data ready events
     window.addEventListener('issHistoryReady', () => {
         console.log('[metrics] Received issHistoryReady event, updating graphs');
         updateGraphsWithHistoricalData();
     });

     window.addEventListener('issPredictionsReady', () => {
         console.log('[metrics] Received issPredictionsReady event, updating graphs');
         updateGraphsWithHistoricalData();
     });

     // Try immediate update (data might already be loaded)
     updateGraphsWithHistoricalData();
 }

 Add state check to updateGraphsWithHistoricalData() (before line 550):
 function updateGraphsWithHistoricalData() {
     // Check if data is available
     const hasHistory = window.locationHistory &&
                       window.locationHistory.getLocations &&
                       window.locationHistory.getLocations().length > 0;

     if (!hasHistory) {
         console.log('[metrics] No data available yet, will retry when data ready event fires');
         return;
     }

     try {
         // ... rest of existing code

 3. handleMetricsViewShown() - Ensure update on tab switch

 Update line 1271 in metrics.js:
 // Refresh graphs with latest data when view is shown
 // No delay needed - updateGraphsWithHistoricalData handles missing data gracefully
 updateGraphsWithHistoricalData();

 Testing Plan

 1. Clear sessionStorage before testing to ensure fresh state
 2. Click Metrics tab immediately on page load - should show loading or empty, then populate when data arrives
 3. Click Metrics tab after data loads - should populate immediately
 4. Check console logs for event firing and data retrieval messages
 5. Verify predictions appear on graphs after prediction API completes

 Expected Behavior After Fix

 - Metrics page gracefully handles empty state
 - Updates automatically when data becomes available
 - No more arbitrary timeouts
 - Works regardless of when user clicks Metrics tab
 - Console logs show clear data flow
