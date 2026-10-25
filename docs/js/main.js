import config from './config.js';
import LocationHistoryManager from './locationHistory.js';
import HistorySlider from './historySlider.js';

// Initialize the application when the page loads
window.addEventListener('load', init);

// Loading state management
function showPredictionsLoading() {
    const loadingElement = document.getElementById('predictions-loading');
    if (loadingElement) {
        loadingElement.classList.remove('hidden');
    }
}

function hidePredictionsLoading(predictionsLoaded = true) {
    const loadingElement = document.getElementById('predictions-loading');
    const spinner = document.getElementById('loading-spinner');
    const checkmark = document.getElementById('loading-checkmark');
    const loadingText = document.getElementById('loading-text');

    if (loadingElement && spinner && checkmark && loadingText) {
        spinner.style.display = 'none';
        checkmark.style.display = predictionsLoaded ? 'flex' : 'none';
        loadingText.textContent = predictionsLoaded ? 'Predictions ready!' : 'Predictions are currently unavailable';
        
        setTimeout(() => {
            loadingElement.classList.add('fade-out');
            setTimeout(() => {
                loadingElement.classList.add('hidden');
            }, 800);
        }, 900);
    }
}

let map = null;
let issMarker = null;
let currentISSLocation = null;
let isCurrentLocationLoaded = false;
let isInitialLoad = true; // Track if this is the first time loading data

// Prediction display variables
let predictionPath = []; // Array of polylines for world copies
let predictionDots = []; // Array of circle markers for selected prediction dots
let predictionsVisible = true;
let currentPredictionMarker = null; // Single marker for current prediction selection

const AUTO_REFRESH_INTERVAL = 5 * 60 * 1000;
const RETRY_INTERVAL = 7 * 1000;
const MAX_RETRY_ATTEMPTS = 5;
const RETRY_STOP_THRESHOLD = 60 * 1000;
let autoRefreshTimer = null;
let retryTimer = null;
let predictionsRefreshTimer = null;
let lastDataTimestamp = null;
let retryCount = 0;
let isFetching = false;
let lastRefreshTime = null;

const locationHistory = new LocationHistoryManager();
// Make locationHistory available globally when needed elsewhere
if (typeof window !== 'undefined') {
    window.locationHistory = locationHistory;
}
let historySlider = null;

// Initialize the application
async function init() {
    console.log('init: Starting initialization...');
    initMap();
    initializeLegendToggle();

    // Listen for map view being shown (for tab navigation). Registered right after the map
    // is created so a quick tab switch during the initial history fetch isn't missed
    // (the map may have been created while its tab was hidden, i.e. with a 0x0 size).
    window.addEventListener('mapViewShown', () => {
        if (map) {
            // Close any open popups before resizing to prevent text wrapping issues
            map.closePopup();

            // Invalidate map size to fix rendering after being hidden
            setTimeout(() => {
                map.invalidateSize();

                // Reopen popup after resize if there's a marker
                if (Array.isArray(issMarker) && issMarker.length > 0) {
                    setTimeout(() => {
                        if (!Array.isArray(issMarker) || issMarker.length === 0) return;
                        const closestMarker = getClosestMarker(issMarker, map.getCenter().lng);
                        if (closestMarker && closestMarker.getPopup()) {
                            closestMarker.openPopup();
                        }
                    }, 100);
                }
            }, 50);
        }
    });

    showPredictionsLoading();

    console.log('init: Initializing location history...');
    await locationHistory.initializeHistory();
    console.log('init: Location history initialized, count:', locationHistory.getLocations().length);

    console.log('init: Creating history slider...');
    historySlider = new HistorySlider(locationHistory, updateMapFromHistory);
    historySlider.initialize();
    console.log('init: History slider initialized');

    console.log('init: Fetching ISS data and predictions in parallel...');

    // Fetch both APIs in parallel for faster loading
    const [, predictionsResult] = await Promise.allSettled([
        fetchISSData(),
        fetchPredictionsData()
    ]);

    // Hide the loading animation once both requests have settled
    const predictionsLoaded = predictionsResult.status === 'fulfilled' && predictionsResult.value === true;
    requestAnimationFrame(() => {
        requestAnimationFrame(() => {
            hidePredictionsLoading(predictionsLoaded);
        });
    });

    console.log('init: Initialization complete');
    
    startAutoRefresh();
    setupVisibilityChangeHandler();
}

// Initialize legend toggle functionality
function initializeLegendToggle() {
    const legendPredicted = document.getElementById('legend-predicted');
    
    if (legendPredicted) {
        legendPredicted.addEventListener('click', () => {
            predictionsVisible = !predictionsVisible;
            updateLegendVisualState();
            updatePredictionDisplay();
        });
    }
    
    updateLegendVisualState();
}

function updateLegendVisualState() {
    const legendPredicted = document.getElementById('legend-predicted');
    
    if (legendPredicted) {
        if (predictionsVisible) {
            legendPredicted.classList.remove('disabled');
        } else {
            legendPredicted.classList.add('disabled');
        }
    }
}

function initMap() {
    // Initialize map with dark mode and world wrap
    map = L.map('map', {
        worldCopyJump: true,  // Makes panning across the dateline smoother
        maxBoundsViscosity: 1.0,  // Ensures smooth scrolling at edges
        renderer: L.canvas({ antimeridian: true }),  // Enable multiple instances of markers
        center: [0, 0],
        zoom: 2
    });

    // CARTO basemaps (dark_all) now return an "API KEY REQUIRED" placeholder tile for
    // keyless requests, so use Esri's keyless dark gray canvas instead.
    L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}', {
        attribution: 'Tiles &copy; <a href="https://www.esri.com/">Esri</a> &mdash; Esri, HERE, Garmin, &copy; OpenStreetMap contributors',
        maxZoom: 16,
        className: 'dark-map',
        backgroundColor: '#1a1a1a'  // Match our dark theme background
    }).addTo(map);

    // Listen for map view changes to redraw prediction paths for world copies
    // and to update which ISS marker shows the popup
    map.on('moveend', () => {
        if (predictionsVisible) {
            updatePredictionDisplay();
        }
        
        // Update popup to show on marker closest to viewport center
        if (issMarker && Array.isArray(issMarker) && issMarker.length > 0) {
            const closestMarker = getClosestMarker(issMarker, map.getCenter().lng);

            // Only (re)open the popup if it moved to a different world copy. Re-opening an
            // already-open popup re-runs Leaflet's autopan, which fires another moveend and
            // loops forever (stack overflow when the popup can't fully fit in the viewport).
            if (closestMarker && closestMarker.getPopup() && !closestMarker.isPopupOpen()) {
                // Close all other popups first
                issMarker.forEach(marker => {
                    if (marker !== closestMarker && marker.getPopup()) {
                        marker.closePopup();
                    }
                });
                // Open popup on closest marker
                closestMarker.openPopup();
            }
        }
    });

    // Add custom center on ISS button
    const centerButton = L.control({position: 'topleft'});
    centerButton.onAdd = function () {
        const div = L.DomUtil.create('div', 'leaflet-bar leaflet-control');
        div.innerHTML = `
            <a href="#" title="Center on ISS" style="
                font-size: 18px;
                font-weight: bold;
                color: #fff;
                text-decoration: none;
                text-align: center;
                background-color: #2d2d2d;
                width: 30px;
                height: 30px;
                line-height: 30px;
                display: flex;
                align-items: center;
                justify-content: center;
            ">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <circle cx="12" cy="12" r="7"/>
                    <line x1="12" y1="1" x2="12" y2="3"/>
                    <line x1="12" y1="21" x2="12" y2="23"/>
                    <line x1="1" y1="12" x2="3" y2="12"/>
                    <line x1="21" y1="12" x2="23" y2="12"/>
                </svg>
            </a>
        `;
        
        // Prevent map interactions on the control
        L.DomEvent.disableClickPropagation(div);
        L.DomEvent.disableScrollPropagation(div);
        
        const link = div.querySelector('a');
        L.DomEvent.on(link, 'click', function(e) {
            L.DomEvent.preventDefault(e);
            if (issMarker) {
                if (Array.isArray(issMarker) && issMarker.length > 0) {
                    // Find the marker closest to the current viewport center
                    const closestMarker = getClosestMarker(issMarker, map.getCenter().lng);
                    map.panTo(closestMarker.getLatLng());
                } else if (!Array.isArray(issMarker)) {
                    map.panTo(issMarker.getLatLng());
                }
            } else if (currentPredictionMarker) {
                map.panTo(currentPredictionMarker.getLatLng());
            }
        });
        
        return div;
    };
    centerButton.addTo(map);
}

// Return the marker (out of its world copies) whose longitude is closest to targetLng
function getClosestMarker(markers, targetLng) {
    return markers.reduce((prev, curr) => {
        const prevDist = Math.abs(prev.getLatLng().lng - targetLng);
        const currDist = Math.abs(curr.getLatLng().lng - targetLng);
        return currDist < prevDist ? curr : prev;
    });
}

// True when both coordinates are present and numeric (0 is a valid coordinate)
function hasValidCoordinates(lat, lon) {
    return lat !== null && lat !== undefined && lat !== '' &&
        lon !== null && lon !== undefined && lon !== '' &&
        Number.isFinite(Number(lat)) && Number.isFinite(Number(lon));
}

// Remove all ISS marker copies from the map
function clearIssMarkers() {
    if (issMarker) {
        const markers = Array.isArray(issMarker) ? issMarker : [issMarker];
        markers.forEach(marker => {
            map.removeLayer(marker);
            if (marker.uncertaintyCircles) {
                marker.uncertaintyCircles.forEach(circle => map.removeLayer(circle));
            }
        });
    }
    issMarker = null;
}

function formatCoordinates(lat, lon) {
    const latDir = lat >= 0 ? 'N' : 'S';
    const lonDir = lon >= 0 ? 'E' : 'W';
    return `${Math.abs(lat).toFixed(4)}° ${latDir}, ${Math.abs(lon).toFixed(4)}° ${lonDir}`;
}

function formatTimestamp(timestamp) {
    const date = new Date(timestamp);
    if (!timestamp || Number.isNaN(date.getTime())) {
        return 'Unknown';
    }

    const localTimeStr = date.toLocaleString('en-US', {
        year: 'numeric',
        month: 'numeric',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
        second: '2-digit',
        hour12: true,
        timeZoneName: 'short'
    });

    const utcStr = date.toLocaleString('en-US', {
        year: 'numeric',
        month: 'numeric',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
        second: '2-digit',
        hour12: true,
        timeZone: 'UTC'
    }) + ' UTC';

    return `${localTimeStr}\n\n${utcStr}`;
}

function startAutoRefresh() {
    if (autoRefreshTimer) {
        clearTimeout(autoRefreshTimer);
    }
    if (retryTimer) {
        clearTimeout(retryTimer);
    }
    
    retryCount = 0;
    
    const now = new Date();
    const nextUpdate = getNextScheduledUpdate(now);
    const timeUntilUpdate = nextUpdate.getTime() - now.getTime();
    
    autoRefreshTimer = setTimeout(() => {
        fetchISSDataWithRetry();
    }, timeUntilUpdate);
    
    console.log('Auto-refresh started - next update at:', nextUpdate.toLocaleTimeString());
}

// Setup Page Visibility API to handle tab switching
function setupVisibilityChangeHandler() {
    document.addEventListener('visibilitychange', () => {
        if (!document.hidden) {
            // Tab became visible again
            console.log('Tab became visible, checking if refresh needed...');
            
            // Check if we missed a scheduled update while tab was hidden
            if (lastRefreshTime) {
                const timeSinceLastRefresh = Date.now() - lastRefreshTime;
                const missedUpdate = timeSinceLastRefresh > AUTO_REFRESH_INTERVAL;
                
                if (missedUpdate) {
                    console.log(`Missed update detected (${Math.round(timeSinceLastRefresh / 1000)}s since last refresh), triggering refresh...`);
                    // Cancel any pending timers and fetch immediately
                    if (autoRefreshTimer) clearTimeout(autoRefreshTimer);
                    if (retryTimer) clearTimeout(retryTimer);
                    fetchISSDataWithRetry();
                } else {
                    console.log(`No missed update (${Math.round(timeSinceLastRefresh / 1000)}s since last refresh)`);
                }
            }
        } else {
            // Tab became hidden
            console.log('Tab became hidden');
        }
    });
}

function getNextScheduledUpdate(currentTime) {
    const nextUpdate = new Date(currentTime);
    const currentMinutes = nextUpdate.getMinutes();
    const current5MinMark = Math.floor(currentMinutes / 5) * 5;
    let nextMinuteMark = current5MinMark + 5;
    
    if (nextMinuteMark >= 60) {
        nextUpdate.setHours(nextUpdate.getHours() + 1);
        nextUpdate.setMinutes(nextMinuteMark - 60);
    } else {
        nextUpdate.setMinutes(nextMinuteMark);
    }
    
    nextUpdate.setSeconds(0);
    nextUpdate.setMilliseconds(0);
    
    return nextUpdate;
}

function getTimeUntilNextUpdate() {
    const now = new Date();
    const nextUpdate = getNextScheduledUpdate(now);
    return nextUpdate.getTime() - now.getTime();
}

// Fetch ISS data with retry logic for new data
async function fetchISSDataWithRetry() {
    // Prevent concurrent API calls
    if (isFetching) {
        console.log('API call already in progress, skipping duplicate request');
        return;
    }
    
    isFetching = true;
    
    // Capture what the user is looking at *before* history is refetched, since the
    // refetch shifts the 24h window (slider indices then point at different times)
    const slider = document.getElementById('history-slider');
    const previousFilledCount = locationHistory.getFilledHistoryCount();
    const isViewingNow = !slider || previousFilledCount === 0 ||
        parseInt(slider.value) === previousFilledCount - 1;
    const selectedTimestamp = historySlider ? historySlider.getCurrentSliderInfo().timestamp : null;
    
    try {
        // Fetch the current location first; the 24-hour history is only refetched once
        // there is new data (retries for unchanged data would otherwise refetch it each time)
        const currentResponse = await fetch(`${config.API_URL}?api_key=${config.API_KEY}`);
        
        if (!currentResponse.ok) {
            const errorText = await currentResponse.text();
            console.error('API Error in retry:', errorText);
            throw new Error(`API returned ${currentResponse.status}`);
        }
        
        const contentType = currentResponse.headers.get('content-type');
        if (!contentType || !contentType.includes('application/json')) {
            const text = await currentResponse.text();
            console.error('Unexpected content type in retry. Response text:', text.substring(0, 500));
            throw new Error(`Expected JSON but got ${contentType}`);
        }
        
        const data = await currentResponse.json();
        console.log('Received data in retry:', data);
        
        // Check if we have new data
        if (lastDataTimestamp && data.timestamp === lastDataTimestamp) {
            // Check if we should stop retrying
            const timeUntilNextUpdate = getTimeUntilNextUpdate();
            const shouldStopRetrying = 
                retryCount >= MAX_RETRY_ATTEMPTS || 
                timeUntilNextUpdate <= RETRY_STOP_THRESHOLD;
            
            if (shouldStopRetrying) {
                console.log('Stopping retries - max attempts reached or too close to next scheduled update');
                console.log(`Retry count: ${retryCount}/${MAX_RETRY_ATTEMPTS}, Time until next update: ${Math.round(timeUntilNextUpdate / 1000)}s`);
                
                // Reset retry count and schedule next auto-refresh
                retryCount = 0;
                isFetching = false;
                startAutoRefresh();
                return;
            }
            
            // Increment retry count and schedule retry
            retryCount++;
            console.log(`No new data available, retrying in 7 seconds... (attempt ${retryCount}/${MAX_RETRY_ATTEMPTS})`);
            
            isFetching = false; // Allow next retry attempt
            if (retryTimer) clearTimeout(retryTimer);
            retryTimer = setTimeout(() => {
                retryTimer = null;
                fetchISSDataWithRetry();
            }, RETRY_INTERVAL);
            
            return;
        }
        
        // We have new data, clear any pending retry timer and reset retry count
        if (retryTimer) {
            clearTimeout(retryTimer);
            retryTimer = null;
        }
        retryCount = 0;
        lastDataTimestamp = data.timestamp;
        lastRefreshTime = Date.now();
        
        await locationHistory.fetchHistory();
        
        // Update the info cards; only touch the map (marker + pan) when the user is
        // viewing "now" - otherwise the historical/predicted marker they selected stays
        updateUI(data, { updateMap: isViewingNow, skipMapPan: !isViewingNow });
        
        restoreSliderPosition(isViewingNow, selectedTimestamp);
        
        // Hide any previous error messages
        document.getElementById('error').style.display = 'none';
        
        // Reset fetching flag before scheduling next auto-refresh
        isFetching = false;
        
        // Wait 5 seconds for predictions to be generated before fetching
        if (predictionsRefreshTimer) clearTimeout(predictionsRefreshTimer);
        predictionsRefreshTimer = setTimeout(() => {
            predictionsRefreshTimer = null;
            fetchPredictionsData().catch(err => {
                console.error('Background predictions fetch failed:', err);
            });
        }, 5000);
        
        // Schedule next auto-refresh
        startAutoRefresh();
        
    } catch (error) {
        console.error('Error in auto-refresh:', error);
        
        // Reset fetching flag on error
        isFetching = false;
        
        // History may have been refetched before the failure; keep the slider consistent
        restoreSliderPosition(isViewingNow, selectedTimestamp);
        
        // Show error but still schedule next attempt
        showError(
            'Failed to fetch ISS data. Will retry automatically.',
            `Error: ${error.message}`
        );
        
        // Schedule next auto-refresh even on error
        startAutoRefresh();
    }
}

// After history/predictions change, put the slider back where the user was:
// on "now" if they were viewing now, otherwise on the same timestamp (if still in range)
function restoreSliderPosition(wasViewingNow, selectedTimestamp) {
    if (!historySlider) return;
    historySlider.updateSliderRange();
    const nowIndex = locationHistory.getFilledHistoryCount() - 1;
    
    if (wasViewingNow || !selectedTimestamp) {
        historySlider.setSliderValue(nowIndex, true);
        console.log('Moved slider to newest entry at position:', nowIndex);
        return;
    }
    
    if (!historySlider.setSliderToTimestamp(selectedTimestamp, true)) {
        // Selected time scrolled out of the window (or prediction was replaced) - go to now
        historySlider.setSliderValue(nowIndex);
    }
}

// Check if data is stale (more than 5 minutes old)
function isDataStale(timestamp) {
    const now = new Date();
    const dataTime = new Date(timestamp);
    return (now - dataTime) > 5 * 60 * 1000; // 5 minutes in milliseconds
}

// Check if new data should be available
function shouldHaveNewData(timestamp) {
    const dataTime = new Date(timestamp);
    const nextUpdateTime = new Date(dataTime);
    
    // Find the next xx:x5:xx time after the data timestamp
    nextUpdateTime.setMinutes(Math.ceil(nextUpdateTime.getMinutes() / 5) * 5);
    nextUpdateTime.setSeconds(0);
    
    return new Date() > nextUpdateTime;
}

// Update timestamp display state
function updateTimestampState(timestamp) {
    const timestampCard = document.getElementById('timestamp');
    const statusMessage = document.getElementById('time-status');
    
    if (isDataStale(timestamp)) {
        if (shouldHaveNewData(timestamp)) {
            // Data is stale and new data is available - show blue flash
            timestampCard.classList.remove('stale');
            timestampCard.classList.add('update-available');
            statusMessage.textContent = 'New data available! Click refresh to update.';
        } else {
            // Data is stale but no new data yet - show solid red
            timestampCard.classList.add('stale');
            timestampCard.classList.remove('update-available');
            statusMessage.textContent = 'Data is outdated. No newer information available yet.';
        }
    } else {
        // Data is fresh - no special styling
        timestampCard.classList.remove('stale');
        timestampCard.classList.remove('update-available');
        statusMessage.textContent = '';
    }
}

// Monitor data age and notify when new data might be available
function startDataAgeMonitor(timestamp) {
    // Initial update
    updateTimestampState(timestamp);
    
    // Clear any existing monitor
    if (window.dataAgeMonitor) {
        clearInterval(window.dataAgeMonitor);
    }
    
    // Then check every second
    window.dataAgeMonitor = setInterval(() => {
        updateTimestampState(timestamp);
    }, 1000);
}

// Update map and info from history location
function updateMapFromHistory(location) {
    if (!location) {
        console.warn('updateMapFromHistory - No location provided');
        return;
    }
    
    console.log('updateMapFromHistory - Location:', {
        timestamp: location.timestamp,
        isEmpty: location.isEmpty,
        hasLatitude: location.latitude !== null && location.latitude !== undefined,
        hasLongitude: location.longitude !== null && location.longitude !== undefined,
        latitude: location.latitude,
        longitude: location.longitude
    });
    
    // Don't update map until current ISS location has been loaded
    // This prevents showing random historical locations before the API call completes
    if (!isCurrentLocationLoaded) {
        console.log('Skipping map update - current ISS location not yet loaded');
        return;
    }
    
    // Hide "no data available" message if it's showing (we'll show it later if needed)
    hideNoDataMessage();
    
    if (location.isEmpty || !hasValidCoordinates(location.latitude, location.longitude)) {
        console.log('updateMapFromHistory - Placeholder or missing coordinates, removing markers');
        clearIssMarkers();
        if (currentPredictionMarker) {
            map.removeLayer(currentPredictionMarker);
            currentPredictionMarker = null;
        }
        showNoDataMessage(location.timestamp);
        updatePredictionDisplay();
        return;
    }
    
    const lat = parseFloat(location.latitude);
    const lon = parseFloat(location.longitude);
    
    console.log('updateMapFromHistory - Displaying marker at:', { lat, lon });
    
    // Remove existing markers if they exist
    clearIssMarkers();
    
    // Check if this is a prediction (future location)
    const isPrediction = location.isPredicted || location.isPredictionGroup;
    const now = new Date();
    const locationTime = new Date(location.timestamp);
    const isFuture = locationTime > now;
    
    // If this is a prediction, show a simple marker
    if (isPrediction || isFuture) {
        console.log('updateMapFromHistory - Handling prediction selection');
        
        // Remove any existing ISS markers
        clearIssMarkers();
        
        // Remove any existing prediction marker
        if (currentPredictionMarker) {
            map.removeLayer(currentPredictionMarker);
            currentPredictionMarker = null;
        }
        
        // Calculate minutes ahead
        const minutesAhead = Math.round((locationTime - now) / (1000 * 60));
        const aheadText = minutesAhead >= 0 ? `${minutesAhead} minutes ahead` : `${Math.abs(minutesAhead)} minutes ago`;
        
        // Create popup content
        const popupContent = `<b>Predicted Location:</b><br>${formatCoordinates(lat, lon)}<br><small>${aheadText}</small>`;
        
        // Place the marker on the world copy closest to the current view so panning
        // doesn't jump across the map when the view is on a wrapped copy
        const viewCenterLng = map.getCenter().lng;
        let predLng = lon;
        while (predLng < viewCenterLng - 180) predLng += 360;
        while (predLng > viewCenterLng + 180) predLng -= 360;
        
        // Create simple prediction dot icon
        const predictionDotIcon = L.divIcon({
            className: 'prediction-dot-icon',
            html: '<div style="background-color: #FF6B6B; width: 10px; height: 10px; border-radius: 50%; border: 1px solid white;"></div>',
            iconSize: [12, 12],
            iconAnchor: [6, 6],
            popupAnchor: [0, -6]
        });
        
        // Create marker at prediction location
        currentPredictionMarker = L.marker([lat, predLng], { icon: predictionDotIcon }).addTo(map);
        currentPredictionMarker.bindPopup(popupContent);
        
        // Pan to the prediction location
        map.panTo([lat, predLng]);
        
        // Open popup
        currentPredictionMarker.openPopup();
        
        // Update prediction display to show paths for this selected prediction
        updatePredictionDisplay();
        
        return; // Don't create ISS icon markers for predictions
    }
    
    // If not a prediction, remove prediction marker
    if (currentPredictionMarker) {
        map.removeLayer(currentPredictionMarker);
        currentPredictionMarker = null;
    }
    
    // Use ISS icon for historical/current locations only
    const markerIcon = L.icon({
        iconUrl: './assets/iss-icon.svg',
        iconSize: [32, 32],
        iconAnchor: [16, 16],
        popupAnchor: [0, -16]
    });

    // Get map bounds
    const bounds = map.getBounds();
    const west = bounds.getWest();
    const east = bounds.getEast();
    const center = bounds.getCenter();

    // Calculate base longitude that's west of the current view with extra buffer
    let baseLon = lon;
    while (baseLon > west - 360) baseLon -= 360;  // Add one more world width to the west

    // Create array to hold markers
    issMarker = [];

    // Check if this is the most recent location
    const slider = document.getElementById('history-slider');
    const filledHistoryCount = locationHistory.getFilledHistoryCount();
    const isCurrentLocation = parseInt(slider.value) === filledHistoryCount - 1;
    
    let popupContent = '';
    
    if (isPrediction || isFuture) {
        // For predictions, show title and coordinates only
        popupContent = `<b>Predicted Location:</b><br>`;
        popupContent += formatCoordinates(lat, lon);
    } else {
        // Historical or current location
        let popupPrefix = 'Historical Location';
        if (isCurrentLocation) {
            popupPrefix = 'ISS Location';
        }
        
        popupContent = `<b>${popupPrefix}:</b><br>`;
        if (location.location) {
            const flag = getCountryFlag(location.location, location.country_code);
            const flagText = flag ? ` ${flag}` : '';
            popupContent += `${location.location}${flagText}`;
        } else {
            popupContent += formatCoordinates(lat, lon);
        }
    }
    
    // Add markers for all visible longitudes with extra buffer
    for (let currLon = baseLon; currLon <= east + 720; currLon += 360) {  // Add two world widths to the east
        const marker = L.marker([lat, currLon], { icon: markerIcon }).addTo(map);
        marker.bindPopup(popupContent);
        issMarker.push(marker);
    }

    // Find the closest marker to center for panning
    let targetLng = lon;
    while (targetLng < center.lng - 180) targetLng += 360;
    while (targetLng > center.lng + 180) targetLng -= 360;
    
    map.panTo([lat, targetLng]);
    
    // Open popup on the marker closest to the target position (not current center)
    // Open popup for any location (historical, current, or prediction)
    if (issMarker.length > 0) {
        getClosestMarker(issMarker, targetLng).openPopup();
    }
    
    // Update prediction display based on current slider position
    updatePredictionDisplay();
}

// Update prediction display on map
function updatePredictionDisplay() {
    if (!map) {
        console.log('updatePredictionDisplay: Map not initialized');
        return;
    }
    
    // Remove existing prediction paths
    if (predictionPath && predictionPath.length > 0) {
        predictionPath.forEach(path => {
            if (path && map.hasLayer(path)) {
                map.removeLayer(path);
            }
        });
        predictionPath = [];
    }
    
    // Remove existing prediction dots
    if (predictionDots && predictionDots.length > 0) {
        predictionDots.forEach(dot => {
            if (dot && map.hasLayer(dot)) {
                map.removeLayer(dot);
            }
        });
        predictionDots = [];
    }
    
    // If predictions are hidden, stop here
    if (!predictionsVisible) {
        console.log('updatePredictionDisplay: Predictions hidden');
        return;
    }
    
    const allPredictions = locationHistory.getPredictions();
    if (!allPredictions || allPredictions.length === 0) {
        console.log('updatePredictionDisplay: No predictions available');
        return;
    }

    const now = new Date();
    const futurePredictions = allPredictions
        .map(pred => ({
            ...pred,
            lat: parseFloat(pred.latitude),
            lon: parseFloat(pred.longitude),
            time: new Date(pred.timestamp)
        }))
        .filter(pred => !isNaN(pred.lat) && !isNaN(pred.lon) && pred.time > now)
        .sort((a, b) => a.time - b.time);

    if (futurePredictions.length === 0) {
        console.log('updatePredictionDisplay: No future predictions');
        return;
    }

    console.log(`updatePredictionDisplay: Processing ${futurePredictions.length} future predictions`);
    
    // Normalize longitude path for world copies
    const normalizeLongitudePath = (points) => {
        if (points.length === 0) return points;
        
        const normalized = [points[0]];
        for (let i = 1; i < points.length; i++) {
            const [lat, lon] = points[i];
            const [prevLat, prevLon] = normalized[normalized.length - 1];
            
            // Find the longitude offset that minimizes the distance
            let bestLon = lon;
            let minDist = Math.abs(lon - prevLon);
            
            for (let offset = -360; offset <= 360; offset += 360) {
                const offsetLon = lon + offset;
                const dist = Math.abs(offsetLon - prevLon);
                if (dist < minDist) {
                    minDist = dist;
                    bestLon = offsetLon;
                }
            }
            
            normalized.push([lat, bestLon]);
        }
        
        return normalized;
    };
    
    // Extract just the [lat, lon] pairs for path normalization
    const predictionCoords = futurePredictions.map(pred => [pred.lat, pred.lon]);
    
    // Start the predicted path from the current ISS location so the first
    // prediction point connects cleanly on the map.
    // Only connect when the known position is recent relative to the first prediction;
    // otherwise (e.g. stale "latest valid" position) the connector would be a bogus line.
    let pathCoords = predictionCoords;
    const startLocation = (currentISSLocation && hasValidCoordinates(currentISSLocation.latitude, currentISSLocation.longitude))
        ? currentISSLocation
        : locationHistory.getLocations().find(loc => !loc.isEmpty && hasValidCoordinates(loc.latitude, loc.longitude));
    if (startLocation) {
        const gapMs = futurePredictions[0].time - new Date(startLocation.timestamp);
        if (gapMs > 0 && gapMs <= 15 * 60 * 1000) {
            pathCoords = [[parseFloat(startLocation.latitude), parseFloat(startLocation.longitude)], ...predictionCoords];
        }
    }
    
    const normalizedPoints = normalizeLongitudePath(pathCoords);
    
    // Create polylines for world copies
    // This shows the predicted path line for all predictions
    const bounds = map.getBounds();
    const west = bounds.getWest();
    const east = bounds.getEast();
    predictionPath = [];
    
    for (let offset = -720; offset <= 720; offset += 360) {
        const offsetPathPoints = normalizedPoints.map(point => [point[0], point[1] + offset]);
        const polyline = L.polyline(offsetPathPoints, {
            color: '#FF6B6B',
            weight: 2.5,
            opacity: 0.7,
            dashArray: '5, 5',
            smoothFactor: 1.0
        }).addTo(map);
        polyline.bindPopup('Predicted Path');
        predictionPath.push(polyline);
    }
    
    console.log(`updatePredictionDisplay: Displayed ${predictionPath.length} prediction paths with ${predictionCoords.length} points`);
    
    // Now check if slider is on a prediction and show dots for that specific prediction
    const slider = document.getElementById('history-slider');
    if (!slider) {
        console.log('updatePredictionDisplay: Slider not found, skipping dots');
        return;
    }
    
    const sliderValue = parseInt(slider.value);
    const filledHistoryCount = locationHistory.getFilledHistoryCount();
    
    // Only show dots if slider is on a prediction (value >= filledHistoryCount)
    if (sliderValue < filledHistoryCount) {
        console.log('updatePredictionDisplay: Slider is on history, not showing prediction dots');
        return;
    }
    
    // Get the currently selected location to determine which prediction to show dots for
    const selectedLocation = locationHistory.getLocationAt(sliderValue);
    if (!selectedLocation || (!selectedLocation.isPredicted && !selectedLocation.isPredictionGroup)) {
        console.log('updatePredictionDisplay: Selected location is not a prediction, not showing dots');
        return;
    }
    
    // Use exact prediction timestamp to avoid client-side smoothing
    const selectedTimestampKey = new Date(selectedLocation.timestamp).getTime();
    
    const matchingPrediction = futurePredictions.find(pred => pred.time.getTime() === selectedTimestampKey);
    
    if (!matchingPrediction) {
        console.log('updatePredictionDisplay: No matching prediction found for selected timestamp');
        return;
    }
    
    console.log(`updatePredictionDisplay: Showing dot for prediction at timestamp: ${selectedTimestampKey}`);
    
    // Create circle markers for the selected prediction point on all world copies
    predictionDots = [];
    let baseLon = matchingPrediction.lon;
    while (baseLon > west - 360) baseLon -= 360;
    
    for (let currLon = baseLon; currLon <= east + 720; currLon += 360) {
        // Create a circle marker for the prediction point
        const circle = L.circleMarker([matchingPrediction.lat, currLon], {
            radius: 6,
            fillColor: '#FF6B6B',
            color: '#FFFFFF',
            weight: 1,
            opacity: 0.9,
            fillOpacity: 0.7
        }).addTo(map);
        circle.bindPopup('Predicted Location');
        predictionDots.push(circle);
    }
    
    console.log(`updatePredictionDisplay: Displayed ${predictionDots.length} prediction dots for selected prediction`);
}

// Update the UI with ISS data
// options.updateMap: redraw the ISS marker (false when the user is viewing another time)
// options.skipMapPan: don't pan/open the popup
function updateUI(data, { updateMap = true, skipMapPan = false } = {}) {
    console.log('updateUI: Called with data:', data, 'updateMap:', updateMap, 'skipMapPan:', skipMapPan);
    
    const coordinates = document.getElementById('coordinates');
    const time = document.getElementById('time');
    const fact = document.getElementById('fact');
    
    if (!coordinates || !time || !fact) {
        console.error('updateUI: DOM elements not found');
        return null;
    }
    
    // The API can return an error placeholder (status "success" but null coordinates).
    // Show a friendly state instead of a marker at null/NaN.
    if (!data || !hasValidCoordinates(data.latitude, data.longitude)) {
        console.warn('updateUI: Current location unavailable (missing latitude/longitude)', data);
        showLocationUnavailable(data);
        if (updateMap && map) {
            clearIssMarkers();
            if (currentPredictionMarker) {
                map.removeLayer(currentPredictionMarker);
                currentPredictionMarker = null;
            }
            showNoDataMessage(data && data.timestamp);
        }
        return null;
    }
    
    try {
        currentISSLocation = {
            timestamp: data.timestamp,
            latitude: data.latitude,
            longitude: data.longitude
        };
        
        const lat = parseFloat(data.latitude);
        const lon = parseFloat(data.longitude);
        
        // Update text displays
        coordinates.textContent = `${formatCoordinates(lat, lon)}${data.location ? `\n\n${data.location}` : ''}`;
        time.textContent = formatTimestamp(data.timestamp);
        fact.textContent = data.fun_fact || 'No fun fact available for this location.';
        
        if (!updateMap) {
            console.log('updateUI: User is viewing another time, leaving map markers alone');
            return null;
        }
        
        hideNoDataMessage();
        clearIssMarkers();
        if (currentPredictionMarker) {
            map.removeLayer(currentPredictionMarker);
            currentPredictionMarker = null;
        }
        
        const issIcon = L.icon({
            iconUrl: './assets/iss-icon.svg',
            iconSize: [32, 32],
            iconAnchor: [16, 16],
            popupAnchor: [0, -16]
        });
        
        const bounds = map.getBounds();
        const west = bounds.getWest();
        const east = bounds.getEast();
        const center = bounds.getCenter();
        
        let baseLon = lon;
        while (baseLon > west - 360) baseLon -= 360;
        
        let popupContent = '<b>ISS Location:</b><br>';
        if (data.location) {
            const flag = getCountryFlag(data.location, data.country_code);
            popupContent += `${data.location}${flag ? ` ${flag}` : ''}`;
        } else {
            popupContent += formatCoordinates(lat, lon);
        }
        
        issMarker = [];
        for (let currLon = baseLon; currLon <= east + 720; currLon += 360) {
            const marker = L.marker([lat, currLon], { icon: issIcon }).addTo(map);
            marker.bindPopup(popupContent);
            issMarker.push(marker);
        }
        
        // Only pan map and open popup on initial load or when user is viewing "now"
        if (!skipMapPan) {
            // Find the closest marker to center for panning
            let targetLng = lon;
            while (targetLng < center.lng - 180) targetLng += 360;
            while (targetLng > center.lng + 180) targetLng -= 360;
            
            map.panTo([lat, targetLng]);
            
            if (issMarker.length > 0) {
                getClosestMarker(issMarker, targetLng).openPopup();
            }
        }
        
        updatePredictionDisplay();
        console.log('updateUI: Completed successfully');
        return null;
    } catch (error) {
        console.error('updateUI: Error processing data:', error);
        return null;
    }
}

// Friendly state for when the current location isn't available
function showLocationUnavailable(data) {
    const coordinates = document.getElementById('coordinates');
    const time = document.getElementById('time');
    const fact = document.getElementById('fact');
    
    currentISSLocation = null;
    
    // Point to the most recent valid position from history, if there is one
    const lastKnown = locationHistory.getLocations().find(loc => !loc.isEmpty && hasValidCoordinates(loc.latitude, loc.longitude));
    let text = 'Live position temporarily unavailable.';
    if (lastKnown) {
        text += `\n\nLast known: ${formatCoordinates(parseFloat(lastKnown.latitude), parseFloat(lastKnown.longitude))} at ${new Date(lastKnown.timestamp).toLocaleString()}`;
    }
    if (coordinates) coordinates.textContent = text;
    if (time) time.textContent = data && data.timestamp ? formatTimestamp(data.timestamp) : 'Unknown';
    if (fact) fact.textContent = (data && data.fun_fact) || 'No fun fact available right now.';
}

// Show error message
function showError(message, details = '') {
    const errorDiv = document.getElementById('error');
    const errorMessage = errorDiv.querySelector('.error-message');
    errorMessage.textContent = message;
    if (details) {
        const detailsPara = document.createElement('p');
        detailsPara.textContent = details;
        detailsPara.style.fontSize = '0.9em';
        detailsPara.style.marginTop = '0.5em';
        errorMessage.appendChild(detailsPara);
    }
    errorDiv.style.display = 'block';
}

// Show "no data available" message for placeholder entries
function showNoDataMessage(timestamp) {
    const noDataMessage = document.getElementById('no-data-message');
    if (noDataMessage) {
        const date = new Date(timestamp);
        const messageText = noDataMessage.querySelector('span');
        if (messageText) {
            messageText.textContent = timestamp && !Number.isNaN(date.getTime())
                ? `Location data is not available for ${date.toLocaleString()}`
                : 'Location data is not available right now';
        }
        noDataMessage.style.display = 'flex';
    }
}

// Hide "no data available" message
function hideNoDataMessage() {
    const noDataMessage = document.getElementById('no-data-message');
    if (noDataMessage) {
        noDataMessage.style.display = 'none';
    }
}

// Fetch predictions data separately
async function fetchPredictionsData() {
    try {
        console.log('fetchPredictionsData: Starting fetch...');
        const response = await fetch(`${config.PREDICTIONS_API_URL}?api_key=${config.API_KEY}`);
        console.log('fetchPredictionsData: Response received, status:', response.status);
        
        if (!response.ok) {
            throw new Error(`Predictions API returned ${response.status}`);
        }
        
        const data = await response.json();
        console.log('fetchPredictionsData: Data parsed', data);
        console.log('fetchPredictionsData: predictions data:', data.predictions);
        console.log('fetchPredictionsData: orbital_mechanics:', data.predictions?.orbital_mechanics?.length || 0);
        
        if (data.status === 'success' && data.predictions) {
            console.log('fetchPredictionsData: Setting predictions from API...');
                locationHistory.setPredictionsFromAPI(data.predictions);

            // Update prediction display on map
            // On initial load, wait a bit for map to finish positioning
            if (isInitialLoad) {
                setTimeout(() => {
                    updatePredictionDisplay();
                }, 100);
            } else {
                updatePredictionDisplay();
            };
            
            console.log('fetchPredictionsData: Completed successfully');
            refreshSliderAfterPredictionsChange();
            // Only count predictions that are newer than the history (stale ones are dropped)
            return locationHistory.fillGapsInPredictions().length > 0;
        } else {
            console.warn('fetchPredictionsData: No predictions data in response');
            locationHistory.setPredictionsFromAPI(null);
            // Clear prediction display if no predictions
            updatePredictionDisplay();
            refreshSliderAfterPredictionsChange();
            return false;
        }
        
    } catch (error) {
        console.error('fetchPredictionsData: Error caught:', error);
        // Don't show error to user for predictions - it's background loading
        locationHistory.setPredictionsFromAPI(null);
        // Clear prediction display on error
        updatePredictionDisplay();
        refreshSliderAfterPredictionsChange();
        return false;
    }
}

// Predictions change the slider's max; keep the current selection (by timestamp) valid
function refreshSliderAfterPredictionsChange() {
    if (!historySlider) return;
    const slider = document.getElementById('history-slider');
    const filledHistoryCount = locationHistory.getFilledHistoryCount();
    const wasOnPrediction = slider && filledHistoryCount > 0 && parseInt(slider.value) >= filledHistoryCount;
    const selectedTimestamp = wasOnPrediction ? historySlider.getCurrentSliderInfo().timestamp : null;
    historySlider.updateSliderRange();
    if (wasOnPrediction && !historySlider.setSliderToTimestamp(selectedTimestamp)) {
        // The selected prediction no longer exists - fall back to "now"
        historySlider.setSliderValue(filledHistoryCount - 1);
    }
}

// Fetch ISS data (initial load)
async function fetchISSData() {
    try {
        console.log('fetchISSData: Starting fetch...');
        const response = await fetch(`${config.API_URL}?api_key=${config.API_KEY}`);
        console.log('fetchISSData: Response received, status:', response.status);
        
        if (!response.ok) {
            throw new Error(`API returned ${response.status}`);
        }
        
        const data = await response.json();
        console.log('fetchISSData: Data parsed, calling updateUI...');
        
        isCurrentLocationLoaded = true;
        lastDataTimestamp = data.timestamp;
        lastRefreshTime = Date.now();
        
        updateUI(data, { updateMap: true, skipMapPan: false }); // Pan on initial load
        
        if (historySlider) {
            historySlider.updateSliderRange();
            const filledHistoryCount = locationHistory.getFilledHistoryCount();
            historySlider.setSliderValue(filledHistoryCount - 1, true);
        }
        
        document.getElementById('error').style.display = 'none';
        console.log('fetchISSData: Completed successfully');
    } catch (error) {
        console.error('fetchISSData: Error caught:', error);
        // Still allow the history slider to drive the map (it is gated on this flag)
        isCurrentLocationLoaded = true;
        showLocationUnavailable(null);
        if (historySlider) {
            historySlider.updateSliderRange();
            // Show the newest history entry on the map instead of an empty map
            const filledHistoryCount = locationHistory.getFilledHistoryCount();
            if (filledHistoryCount > 0) {
                historySlider.setSliderValue(filledHistoryCount - 1);
            }
        }
        showError(
            'Failed to fetch initial ISS data. Auto-refresh will continue.',
            `Error: ${error.message}`
        );
    } finally {
        isInitialLoad = false;
    }
}

// Convert country code to flag emoji
function getCountryFlag(location, countryCode) {
    try {
        // Skip if it's an ocean or sea
        if (location.includes('Ocean') || location.includes('Sea')) {
            return '';
        }

        // If we have a country code, use it directly
        if (countryCode) {
            // Convert country code to flag emoji (using regional indicator symbols)
            return String.fromCodePoint(...Array.from(countryCode).map(char => 127397 + char.charCodeAt()));
        }
        
        return ''; // Return empty string if no country code
    } catch (e) {
        console.warn('Error getting country flag:', e);
        return '';
    }
}
