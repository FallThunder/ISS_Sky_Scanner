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

function hidePredictionsLoading() {
    const loadingElement = document.getElementById('predictions-loading');
    const spinner = document.getElementById('loading-spinner');
    const checkmark = document.getElementById('loading-checkmark');
    const loadingText = document.getElementById('loading-text');
    
    if (loadingElement && spinner && checkmark && loadingText) {
        spinner.style.display = 'none';
        checkmark.style.display = 'flex';
        loadingText.textContent = 'Predictions ready!';
        
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
let lastDataTimestamp = null;
let retryCount = 0;
let isFetching = false;
let lastRefreshTime = null;

const locationHistory = new LocationHistoryManager();
// Make locationHistory available globally for metrics page
if (typeof window !== 'undefined') {
    window.locationHistory = locationHistory;
}
let historySlider = null;

// Initialize the application
async function init() {
    console.log('init: Starting initialization...');
    initMap();
    initializeLegendToggle();
    
    console.log('init: Initializing location history...');
    await locationHistory.initializeHistory();
    console.log('init: Location history initialized, count:', locationHistory.getLocations().length);
    
    showPredictionsLoading();
    
    console.log('init: Creating history slider...');
    historySlider = new HistorySlider(locationHistory, updateMapFromHistory);
    historySlider.initialize();
    console.log('init: History slider initialized');
    
    console.log('init: Waiting 100ms before fetching data...');
    await new Promise(resolve => setTimeout(resolve, 100));
    
    // Listen for map view being shown (for tab navigation)
    window.addEventListener('mapViewShown', () => {
        if (map) {
            // Close any open popups before resizing to prevent text wrapping issues
            map.closePopup();
            
            // Invalidate map size to fix rendering after being hidden
            setTimeout(() => {
                map.invalidateSize();
                
                // Reopen popup after resize if there's a marker
                if (issMarker && issMarker.length > 0) {
                    setTimeout(() => {
                        const center = map.getCenter();
                        const closestMarker = issMarker.reduce((prev, curr) => {
                            const prevDist = Math.abs(prev.getLatLng().lng - center.lng);
                            const currDist = Math.abs(curr.getLatLng().lng - center.lng);
                            return currDist < prevDist ? curr : prev;
                        });
                        if (closestMarker && closestMarker.getPopup()) {
                            closestMarker.openPopup();
                        }
                    }, 100);
                }
            }, 50);
        }
    });
    
    console.log('init: Fetching ISS data and predictions in parallel...');
    
    // Fetch both APIs in parallel for faster loading
    await Promise.allSettled([
        fetchISSData(),
        fetchPredictionsData()
    ]);
    
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

    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
        attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors, © <a href="https://carto.com/attributions">CARTO</a>',
        maxZoom: 19,
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
            const center = map.getCenter();
            const closestMarker = issMarker.reduce((prev, curr) => {
                const prevDist = Math.abs(prev.getLatLng().lng - center.lng);
                const currDist = Math.abs(curr.getLatLng().lng - center.lng);
                return currDist < prevDist ? curr : prev;
            });
            
            // Only open popup if one of the markers has a popup bound
            if (closestMarker && closestMarker.getPopup()) {
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
                    const center = map.getCenter();
                    const closestMarker = issMarker.reduce((prev, curr) => {
                        const prevDist = Math.abs(prev.getLatLng().lng - center.lng);
                        const currDist = Math.abs(curr.getLatLng().lng - center.lng);
                        return currDist < prevDist ? curr : prev;
                    });
                    map.panTo(closestMarker.getLatLng());
                } else if (!Array.isArray(issMarker)) {
                    map.panTo(issMarker.getLatLng());
                }
            }
        });
        
        return div;
    };
    centerButton.addTo(map);
}

function redrawPathsForWorldCopies() {
    // Redraw prediction paths when map view changes
    if (predictionsVisible) {
        updatePredictionDisplay();
    }
            }


function formatCoordinates(lat, lon) {
    const latDir = lat >= 0 ? 'N' : 'S';
    const lonDir = lon >= 0 ? 'E' : 'W';
    return `${Math.abs(lat).toFixed(4)}° ${latDir}, ${Math.abs(lon).toFixed(4)}° ${lonDir}`;
}

function formatTimestamp(timestamp) {
    const date = new Date(timestamp);
    
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
    
    try {
        // Fetch both current location and 24-hour history in parallel
        const [currentResponse, historyFetched] = await Promise.all([
            fetch(`${config.API_URL}?api_key=${config.API_KEY}`),
            locationHistory.fetchHistory()
        ]);
        
        if (!currentResponse.ok) {
            const errorText = await currentResponse.text();
            console.error('API Error in retry:', errorText);
            throw new Error(`API returned ${currentResponse.status}: ${errorText}`);
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
            retryTimer = setTimeout(() => {
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
        
        // Update actual locations map for accuracy comparison
        updateActualLocations(data);
        
        // Check if user is viewing "now" (most recent position) before updating
        const filledHistoryCount = locationHistory.getFilledHistoryCount();
        const slider = document.getElementById('history-slider');
        const isViewingNow = !slider || parseInt(slider.value) === filledHistoryCount - 1;
        
        // Update UI (but don't pan map if this is not initial load)
        const addResult = updateUI(data, !isInitialLoad);
        
        // Update slider range
        historySlider.updateSliderRange();
        
        // Only move to newest entry if user is currently viewing "now" or if it's initial load
        if (isViewingNow || isInitialLoad) {
            const newFilledHistoryCount = locationHistory.getFilledHistoryCount();
            historySlider.setSliderValue(newFilledHistoryCount - 1, true);
            console.log('New data loaded - moved slider to newest entry at position:', newFilledHistoryCount - 1);
        } else {
            console.log('User is viewing history, keeping slider position');
        }
        
        // Hide any previous error messages
        document.getElementById('error').style.display = 'none';
        
        // Reset fetching flag before scheduling next auto-refresh
        isFetching = false;
        
        // Wait 5 seconds for predictions to be generated before fetching
        setTimeout(() => {
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
        
        // Show error but still schedule next attempt
        showError(
            'Failed to fetch ISS data. Will retry automatically.',
            `Error: ${error.message}`
        );
        
        // Schedule next auto-refresh even on error
        startAutoRefresh();
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
    
    // Calculate marker position - use centroid for prediction groups
    let lat, lon;
    
    // Check if this is a prediction group first (they have coordinates in predictions array)
    if (location.isPredictionGroup && location.predictions && location.predictions.length > 0) {
        // Calculate centroid of all predictions for this source timestamp
        const predictions = location.predictions.filter(p => p.method !== 'sgp4'); // Exclude SGP4
        if (predictions.length > 0) {
            let sumLat = 0;
            const lonValues = [];
            
            predictions.forEach(pred => {
                const predLat = parseFloat(pred.latitude);
                const predLon = parseFloat(pred.longitude);
                if (!isNaN(predLat) && !isNaN(predLon)) {
                    sumLat += predLat;
                    let normalizedLon = predLon;
                    while (normalizedLon > 180) normalizedLon -= 360;
                    while (normalizedLon < -180) normalizedLon += 360;
                    lonValues.push(normalizedLon);
                }
            });
            
            if (lonValues.length > 0) {
                // Calculate centroid longitude handling wrapping
                const refLon = lonValues[0];
                let sumOffset = 0;
                
                lonValues.forEach(lonVal => {
                    let offset = lonVal - refLon;
                    if (offset > 180) offset -= 360;
                    if (offset < -180) offset += 360;
                    sumOffset += offset;
                });
                
                const avgOffset = sumOffset / lonValues.length;
                let centroidLon = refLon + avgOffset;
                
                while (centroidLon > 180) centroidLon -= 360;
                while (centroidLon < -180) centroidLon += 360;
                
                lat = sumLat / predictions.length;
                lon = centroidLon;
                console.log('updateMapFromHistory - Using centroid for prediction group:', { lat, lon, predictionCount: predictions.length });
            } else {
                // Fallback to first prediction if centroid calculation fails
                lat = parseFloat(location.latitude);
                lon = parseFloat(location.longitude);
            }
        } else {
            // Fallback to location coordinates
            lat = parseFloat(location.latitude);
            lon = parseFloat(location.longitude);
        }
    } else {
        // Use location coordinates directly for historical data
        // Check if this is a placeholder entry (no data available) or missing coordinates
        // Note: We check specifically for null/undefined, not falsy values, because 0 is a valid coordinate
        const hasValidCoordinates = 
            location.latitude !== null && location.latitude !== undefined &&
            location.longitude !== null && location.longitude !== undefined;
        
        if (location.isEmpty || !hasValidCoordinates) {
            console.log('updateMapFromHistory - Placeholder or missing coordinates, removing markers');
            // Remove existing markers
            if (issMarker) {
                if (Array.isArray(issMarker)) {
                    issMarker.forEach(marker => {
                        map.removeLayer(marker);
                        if (marker.uncertaintyCircles) {
                            marker.uncertaintyCircles.forEach(circle => map.removeLayer(circle));
                        }
                    });
                } else {
                    map.removeLayer(issMarker);
                    if (issMarker.uncertaintyCircles) {
                        issMarker.uncertaintyCircles.forEach(circle => map.removeLayer(circle));
                    }
                }
            }
            issMarker = null;
            
            // Only show "no data available" message if we've actually loaded data
            // This prevents showing the message during initial load before data is fetched
            if (isCurrentLocationLoaded) {
                showNoDataMessage(location.timestamp);
            }
            return;
        }
        
        lat = parseFloat(location.latitude);
        lon = parseFloat(location.longitude);
    }
    
    // Validate coordinates are valid numbers
    if (isNaN(lat) || isNaN(lon)) {
        console.warn('updateMapFromHistory - Invalid coordinates after parsing:', { lat, lon, location });
        // If it's a prediction group but we couldn't calculate coordinates, show no data message
        if (location.isPredictionGroup) {
            showNoDataMessage(location.timestamp);
        }
        return;
    }
    
    console.log('updateMapFromHistory - Displaying marker at:', { lat, lon });
    
    // Remove existing markers if they exist
    if (issMarker) {
        if (Array.isArray(issMarker)) {
            issMarker.forEach(marker => {
                map.removeLayer(marker);
                // Remove uncertainty circles if they exist
                if (marker.uncertaintyCircles) {
                    marker.uncertaintyCircles.forEach(circle => map.removeLayer(circle));
                }
            });
        } else {
            map.removeLayer(issMarker);
            // Remove uncertainty circles if they exist
            if (issMarker.uncertaintyCircles) {
                issMarker.uncertaintyCircles.forEach(circle => map.removeLayer(circle));
            }
        }
    }
    
    // Check if this is a prediction (future location)
    const isPrediction = location.isPredicted || location.isPredictionGroup;
    const now = new Date();
    const locationTime = new Date(location.timestamp);
    const isFuture = locationTime > now;
    
    // If this is a prediction, show a simple marker
    if (isPrediction || isFuture) {
        console.log('updateMapFromHistory - Handling prediction selection');
        
        // Remove any existing ISS markers
        if (issMarker) {
            if (Array.isArray(issMarker)) {
                issMarker.forEach(marker => {
                    map.removeLayer(marker);
                    if (marker.uncertaintyCircles) {
                        marker.uncertaintyCircles.forEach(circle => map.removeLayer(circle));
                    }
                });
            } else {
                map.removeLayer(issMarker);
                if (issMarker.uncertaintyCircles) {
                    issMarker.uncertaintyCircles.forEach(circle => map.removeLayer(circle));
                }
            }
        }
        issMarker = null;
        
        // Remove any existing prediction marker
        if (currentPredictionMarker) {
            map.removeLayer(currentPredictionMarker);
            currentPredictionMarker = null;
        }
        
        // Calculate minutes ahead
        const minutesAhead = Math.round((locationTime - now) / (1000 * 60));
        
        // Create popup content
        const popupContent = `<b>Predicted Location:</b><br>${formatCoordinates(lat, lon)}<br><small>${minutesAhead} minutes ahead</small>`;
        
        // Create simple prediction dot icon
        const predictionDotIcon = L.divIcon({
            className: 'prediction-dot-icon',
            html: '<div style="background-color: #FF6B6B; width: 10px; height: 10px; border-radius: 50%; border: 1px solid white;"></div>',
            iconSize: [12, 12],
            iconAnchor: [6, 6],
            popupAnchor: [0, -6]
        });
        
        // Create marker at prediction location
        currentPredictionMarker = L.marker([lat, lon], { icon: predictionDotIcon }).addTo(map);
        currentPredictionMarker.bindPopup(popupContent);
        
        // Pan to the prediction location
        map.panTo([lat, lon]);
        
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
        const closestMarker = issMarker.reduce((prev, curr) => {
            const prevDist = Math.abs(prev.getLatLng().lng - targetLng);
            const currDist = Math.abs(curr.getLatLng().lng - targetLng);
            return currDist < prevDist ? curr : prev;
        });
        closestMarker.openPopup();
    }
    
    // Update prediction display based on current slider position
    updatePredictionDisplay();
}

// Update prediction display on map (using same approach as metrics page)
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
    
    // Get all predictions from locationHistory (flat array)
    const allPredictions = locationHistory.getPredictions();
    
    if (!allPredictions || allPredictions.length === 0) {
        console.log('updatePredictionDisplay: No predictions available');
        return;
    }
    
    // Filter to only future predictions (last entry already removed in setPredictionsFromAPI)
    const now = new Date();
    const futurePredictions = allPredictions.filter(pred => {
        const predTime = new Date(pred.timestamp);
        return predTime > now;
    });
    
    if (futurePredictions.length === 0) {
        console.log('updatePredictionDisplay: No future predictions');
        return;
    }
    
    console.log(`updatePredictionDisplay: Processing ${futurePredictions.length} future predictions`);
    
    // Group predictions by predicted timestamp (rounded to 5 minutes) and calculate centroids
    // This matches the approach used in metrics.js
    const predictionsByTimestamp = {};
    futurePredictions.forEach(pred => {
        const predTime = new Date(pred.timestamp);
        const roundedMinutes = Math.round(predTime.getMinutes() / 5) * 5;
        const roundedTime = new Date(predTime);
        roundedTime.setMinutes(roundedMinutes);
        roundedTime.setSeconds(0);
        roundedTime.setMilliseconds(0);
        const timestampKey = roundedTime.getTime().toString();
        
        if (!predictionsByTimestamp[timestampKey]) {
            predictionsByTimestamp[timestampKey] = [];
        }
        predictionsByTimestamp[timestampKey].push([
            parseFloat(pred.latitude),
            parseFloat(pred.longitude)
        ]);
    });
    
    // Calculate centroids for each timestamp group
    const centroidPoints = [];
    const sortedTimestamps = Object.keys(predictionsByTimestamp).sort((a, b) => parseFloat(a) - parseFloat(b));
    
    sortedTimestamps.forEach(timestampKey => {
        const points = predictionsByTimestamp[timestampKey];
        if (points.length === 0) return;
        
        // Calculate centroid (average of all points for this timestamp)
        let sumLat = 0;
        const lonValues = [];
        
        points.forEach(([lat, lon]) => {
            sumLat += lat;
            lonValues.push(lon);
        });
        
        // For longitude, calculate centroid handling wrapping
        const refLon = lonValues[0];
        let sumOffset = 0;
        
        lonValues.forEach(lon => {
            let offset = lon - refLon;
            if (offset > 180) offset -= 360;
            if (offset < -180) offset += 360;
            sumOffset += offset;
        });
        
        const avgOffset = sumOffset / lonValues.length;
        let centroidLon = refLon + avgOffset;
        
        // Normalize back to [-180, 180]
        while (centroidLon > 180) centroidLon -= 360;
        while (centroidLon < -180) centroidLon += 360;
        
        const centroidLat = sumLat / points.length;
        // Store centroid with its timestamp for matching predictions
        centroidPoints.push({
            lat: centroidLat,
            lon: centroidLon,
            timestamp: parseFloat(timestampKey)
        });
    });
    
    if (centroidPoints.length === 0) {
        console.log('updatePredictionDisplay: No valid centroid points');
        return;
    }
    
    console.log(`updatePredictionDisplay: Created ${centroidPoints.length} centroid points`);
    
    // Normalize longitude path for world copies (similar to metrics page)
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
    const centroidCoords = centroidPoints.map(cp => [cp.lat, cp.lon]);
    
    // Start the predicted path from the current ISS location so the first
    // prediction point connects cleanly on the map.
    let pathCoords = centroidCoords;
    if (isCurrentLocationLoaded) {
        const latestLocation = locationHistory.getLocations()[0];
        if (latestLocation && latestLocation.latitude !== null && latestLocation.longitude !== null) {
            const currentLat = parseFloat(latestLocation.latitude);
            const currentLon = parseFloat(latestLocation.longitude);
            
            if (!isNaN(currentLat) && !isNaN(currentLon)) {
                pathCoords = [[currentLat, currentLon], ...centroidCoords];
            }
        }
    }
    
    const normalizedPoints = normalizeLongitudePath(pathCoords);
    
    // Create polylines for world copies (similar to metrics page)
    // This shows the predicted path line for all predictions
    const bounds = map.getBounds();
    const west = bounds.getWest();
    const east = bounds.getEast();
    const center = bounds.getCenter();
    predictionPath = [];
    
    // Calculate which world copy to center on based on current view
    // Find the best starting offset to ensure paths are visible in current viewport
    let baseOffset = 0;
    if (normalizedPoints.length > 0) {
        const firstLon = normalizedPoints[0][1];
        // Find offset that brings the path closest to viewport center
        baseOffset = Math.round((center.lng - firstLon) / 360) * 360;
    }
    
    // Draw paths for current view and adjacent world copies
    for (let offset = baseOffset - 720; offset <= baseOffset + 720; offset += 360) {
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
    
    console.log(`updatePredictionDisplay: Displayed ${predictionPath.length} prediction paths with ${centroidPoints.length} points`);
    
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
    
    // Get the timestamp of the selected prediction (rounded to 5 minutes for matching)
    const selectedTime = new Date(selectedLocation.timestamp);
    const roundedMinutes = Math.round(selectedTime.getMinutes() / 5) * 5;
    const roundedSelectedTime = new Date(selectedTime);
    roundedSelectedTime.setMinutes(roundedMinutes);
    roundedSelectedTime.setSeconds(0);
    roundedSelectedTime.setMilliseconds(0);
    const selectedTimestampKey = roundedSelectedTime.getTime();
    
    // Find the centroid point that matches the selected timestamp
    const matchingCentroid = centroidPoints.find(cp => cp.timestamp === selectedTimestampKey);
    
    if (!matchingCentroid) {
        console.log('updatePredictionDisplay: No matching centroid found for selected prediction timestamp');
        return;
    }
    
    console.log(`updatePredictionDisplay: Showing dot for prediction at timestamp: ${selectedTimestampKey}`);
    
    // Create circle markers for the selected prediction point on all world copies
    predictionDots = [];
    let baseLon = matchingCentroid.lon;
    while (baseLon > west - 360) baseLon -= 360;
    
    for (let currLon = baseLon; currLon <= east + 720; currLon += 360) {
        // Create a circle marker for the prediction point
        const circle = L.circleMarker([matchingCentroid.lat, currLon], {
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
function updateUI(data, skipMapPan = false) {
    console.log('updateUI: Called with data:', data, 'skipMapPan:', skipMapPan);
    
    if (!data || !data.latitude || !data.longitude) {
        console.error('updateUI: Invalid data - missing latitude/longitude', data);
        return null;
    }
    
    const coordinates = document.getElementById('coordinates');
    const time = document.getElementById('time');
    const fact = document.getElementById('fact');
    
    if (!coordinates || !time || !fact) {
        console.error('updateUI: DOM elements not found');
        return null;
    }
    
    try {
        console.log('updateUI: Updating display with latest data');
        console.log('updateUI: historySlider exists?', !!historySlider);

        // Predictions are now loaded separately via fetchPredictionsData()
        // No need to process predictions here

        if (historySlider) {
            historySlider.updateSliderRange();
            
            const allLocations = locationHistory.getAllLocations();
            const historyCount = locationHistory.getLocations().length;
            if (allLocations.length > historyCount) {
                const firstPrediction = allLocations[historyCount];
                console.log('Verification - First prediction accessible:', firstPrediction ? firstPrediction.timestamp : 'null');
            }
            
            if (!historySlider.isPositioned()) {
                const filledHistoryCount = locationHistory.getFilledHistoryCount();
                historySlider.setSliderValue(filledHistoryCount - 1, true);
            }
        } else {
            console.warn('updateUI: historySlider not initialized, skipping slider updates');
        }
        
        
        const currentLocation = {
            timestamp: data.timestamp,
            latitude: data.latitude,
            longitude: data.longitude
        };
        currentISSLocation = currentLocation;
        
        // Predictions display removed - not shown on map

        // Update text displays
        coordinates.textContent = `${formatCoordinates(parseFloat(data.latitude), parseFloat(data.longitude))}${data.location ? `\n\n${data.location}` : ''}`;
        time.textContent = formatTimestamp(data.timestamp);
        fact.textContent = data.fun_fact || 'No fun fact available for this location.';

        const lat = parseFloat(data.latitude);
        const lon = parseFloat(data.longitude);
        
        const issIcon = L.icon({
            iconUrl: './assets/iss-icon.svg',
            iconSize: [32, 32],
            iconAnchor: [16, 16],
            popupAnchor: [0, -16]
        });
        
        if (issMarker) {
            if (Array.isArray(issMarker)) {
                issMarker.forEach(marker => {
                    map.removeLayer(marker);
                    if (marker.uncertaintyCircles) {
                        marker.uncertaintyCircles.forEach(circle => map.removeLayer(circle));
                    }
                });
            } else {
                map.removeLayer(issMarker);
                // Remove uncertainty circles if they exist
                if (issMarker.uncertaintyCircles) {
                    issMarker.uncertaintyCircles.forEach(circle => map.removeLayer(circle));
                }
            }
        }

        const bounds = map.getBounds();
        const west = bounds.getWest();
        const east = bounds.getEast();
        const center = bounds.getCenter();

        let baseLon = lon;
        while (baseLon > west - 360) baseLon -= 360;

        issMarker = [];

        for (let currLon = baseLon; currLon <= east + 720; currLon += 360) {
            const marker = L.marker([lat, currLon], { icon: issIcon }).addTo(map);
            if (data.location) {
                const flag = getCountryFlag(data.location, data.country_code);
                const flagText = flag ? ` ${flag}` : '';
                marker.bindPopup(`<b>ISS Location:</b><br>${data.location}${flagText}`);
            }
            issMarker.push(marker);
        }

        // Only pan map and open popup on initial load or when user is viewing "now"
        if (!skipMapPan) {
            // Find the closest marker to center for panning
            let targetLng = lon;
            while (targetLng < center.lng - 180) targetLng += 360;
            while (targetLng > center.lng + 180) targetLng -= 360;
            
            map.panTo([lat, targetLng]);
            
            // Update prediction display after map finishes panning (on initial load)
            // This ensures paths are drawn relative to the correct viewport
            map.once('moveend', () => {
                if (predictionsVisible) {
                    updatePredictionDisplay();
                }
            });
            
            if (data.location && issMarker.length > 0) {
                const closestMarker = issMarker.reduce((prev, curr) => {
                    const prevDist = Math.abs(prev.getLatLng().lng - targetLng);
                    const currDist = Math.abs(curr.getLatLng().lng - targetLng);
                    return currDist < prevDist ? curr : prev;
                });
                closestMarker.openPopup();
            }
        } else {
            console.log('updateUI: Skipping map pan - auto-refresh with user viewing history');
        }
        
        console.log('updateUI: Completed successfully');
        return null;
    } catch (error) {
        console.error('updateUI: Error processing data:', error);
        console.error('updateUI: Error stack:', error);
        return null;
    }
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
        const timeStr = date.toLocaleString();
        const messageText = noDataMessage.querySelector('span');
        if (messageText) {
            messageText.textContent = `Location data is not available for ${timeStr}`;
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
        console.log('fetchPredictionsData: sgp4:', data.predictions?.sgp4?.length || 0);
        
        if (data.status === 'success' && data.predictions) {
            console.log('fetchPredictionsData: Setting predictions from API...');
            console.log('fetchPredictionsData: Full predictions object:', JSON.stringify(data.predictions, null, 2));
            locationHistory.setPredictionsFromAPI(data.predictions);
            
            // Store historical predictions for metrics page
            if (typeof window !== 'undefined') {
                window.historicalPredictions = data.historical_predictions || null;
                console.log('fetchPredictionsData: Storing historical predictions for metrics:', data.historical_predictions ? 'present' : 'null');
                
                // Trigger metrics update if metrics page is already initialized
                if (typeof window !== 'undefined' && window.updateMetricsGraphs) {
                    window.updateMetricsGraphs();
                }
            }
            
            // Update prediction display on map
            updatePredictionDisplay();
            
            console.log('fetchPredictionsData: Completed successfully');
        } else {
            console.warn('fetchPredictionsData: No predictions data in response');
            locationHistory.setPredictionsFromAPI(null);
            // Clear prediction display if no predictions
            updatePredictionDisplay();
        }
        
    } catch (error) {
        console.error('fetchPredictionsData: Error caught:', error);
        console.error('fetchPredictionsData: Error stack:', error.stack);
        // Don't show error to user for predictions - it's background loading
        locationHistory.setPredictionsFromAPI(null);
        // Clear prediction display on error
        updatePredictionDisplay();
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
        
        updateActualLocations(data);
        console.log('fetchISSData: About to call updateUI with data:', data);
        console.log('fetchISSData: historySlider exists?', !!historySlider);
        updateUI(data, false); // Don't skip map pan on initial load
        
        if (historySlider) {
            historySlider.updateSliderRange();
            const filledHistoryCount = locationHistory.getFilledHistoryCount();
            historySlider.setSliderValue(filledHistoryCount - 1, true);
        } else {
            console.warn('fetchISSData: historySlider not initialized, skipping slider updates');
        }
        
        document.getElementById('error').style.display = 'none';
        console.log('fetchISSData: Completed successfully');
        
        // Mark that initial load is complete and hide loading animation
        if (isInitialLoad) {
            isInitialLoad = false;
            // Wait for map rendering to complete before hiding loading screen
            requestAnimationFrame(() => {
                requestAnimationFrame(() => {
                    hidePredictionsLoading();
                });
            });
        }
        
        // Predictions are fetched in parallel in init(), or separately in fetchISSDataWithRetry()
        // No need to call here to avoid duplicate calls
        
    } catch (error) {
        console.error('fetchISSData: Error caught:', error);
        console.error('fetchISSData: Error stack:', error.stack);
        showError(
            'Failed to fetch initial ISS data. Auto-refresh will continue.',
            `Error: ${error.message}`
        );
        // Mark initial load as complete even on error and hide loading animation
        if (isInitialLoad) {
            isInitialLoad = false;
            requestAnimationFrame(() => {
                requestAnimationFrame(() => {
                    hidePredictionsLoading();
                });
            });
        }
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

// Calculate distance between two lat/lon points using Haversine formula
function calculateDistance(lat1, lon1, lat2, lon2) {
    const R = 6371; // Earth's radius in kilometers
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = 
        Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
        Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c; // Distance in kilometers
}

// Convert kilometers to miles
function kmToMiles(km) {
    return km * 0.621371;
}

// Get distance class for styling (now uses miles)
function getDistanceClass(distanceMiles) {
    if (distanceMiles <= 6.2) return 'distance-excellent'; // ~10 km
    if (distanceMiles <= 31.1) return 'distance-good'; // ~50 km
    if (distanceMiles <= 124.3) return 'distance-fair'; // ~200 km
    return 'distance-poor';
}

// Convert degrees to miles
// Latitude: 1 degree = 69 miles (constant)
// Longitude: 1 degree = 69 * cos(latitude) miles (varies by latitude)
function degreesToMilesLat(degrees) {
    return degrees * 69;
}

function degreesToMilesLon(degrees, latitude) {
    return degrees * 69 * Math.cos(latitude * Math.PI / 180);
}

// Store actual locations for comparison
const actualLocations = new Map(); // key: timestamp (rounded to 5 min), value: location data


// Display predictions for the next hour in the table

// Round timestamp to nearest 5 minutes
function roundToNearest5Minutes(date) {
    const rounded = new Date(date);
    const minutes = rounded.getMinutes();
    const roundedMinutes = Math.round(minutes / 5) * 5;
    rounded.setMinutes(roundedMinutes);
    rounded.setSeconds(0);
    rounded.setMilliseconds(0);
    return rounded.toISOString();
}

// Get prediction timestamp key for matching (rounds to 5-minute intervals)
function getPredictionKey(timestamp) {
    const date = new Date(timestamp);
    // Round to nearest 5 minutes
    const minutes = date.getMinutes();
    const roundedMinutes = Math.round(minutes / 5) * 5;
    const rounded = new Date(date);
    rounded.setMinutes(roundedMinutes);
    rounded.setSeconds(0);
    rounded.setMilliseconds(0);
    return rounded.toISOString();
}

// Update actual locations map when new data arrives
function updateActualLocations(locationData) {
    if (!locationData || !locationData.timestamp) return;
    
    const timestamp = new Date(locationData.timestamp);
    const roundedTimestamp = roundToNearest5Minutes(timestamp);
    
    actualLocations.set(roundedTimestamp, {
        timestamp: locationData.timestamp,
        latitude: locationData.latitude,
        longitude: locationData.longitude,
        location: locationData.location
    });
    
    // Clean up old entries (keep only last 24 hours)
    const cutoffTime = new Date(Date.now() - 24 * 60 * 60 * 1000);
    for (const [key, value] of actualLocations.entries()) {
        const entryTime = new Date(value.timestamp);
        if (entryTime < cutoffTime) {
            actualLocations.delete(key);
        }
    }
    
}



// Normalize longitude path to avoid wrapping issues
// Adjusts longitudes to follow the shortest path, avoiding jumps across ±180°
function normalizeLongitudePath(points) {
    if (points.length === 0) return points;
    
    const normalized = [[points[0][0], points[0][1]]]; // Start with first point as-is
    
    for (let i = 1; i < points.length; i++) {
        const prevLon = normalized[i - 1][1];
        let currLon = points[i][1];
        
        // Calculate the difference
        let diff = currLon - prevLon;
        
        // If the difference is greater than 180°, we've crossed the date line
        // Adjust to follow the shorter path
        if (diff > 180) {
            currLon -= 360; // Go west instead of east
        } else if (diff < -180) {
            currLon += 360; // Go east instead of west
        }
        
        normalized.push([points[i][0], currLon]);
    }
    
    return normalized;
}

// Prediction path drawing functions removed - predictions not displayed on map

