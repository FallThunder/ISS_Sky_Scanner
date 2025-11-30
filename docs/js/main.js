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
        // Hide spinner and show checkmark
        spinner.style.display = 'none';
        checkmark.style.display = 'flex';
        loadingText.textContent = 'Predictions ready!';
        
        // Start fade out after checkmark animation completes
        setTimeout(() => {
            loadingElement.classList.add('fade-out');
            
            // Hide completely after fade animation
            setTimeout(() => {
                loadingElement.classList.add('hidden');
            }, 800); // Match CSS transition duration
        }, 900); // Wait for checkmark animation to complete
    }
}

// Initialize map
let map = null;
let issMarker = null;
let predictionPathPolylines = []; // Store prediction path polylines (multiple copies for world wrap)
let sgp4PathPolylines = []; // Store SGP4 true path polylines (multiple copies for world wrap)
let predictionMarkers = []; // Store all prediction point markers
let currentISSLocation = null; // Store the most recent current ISS location (not historical)
let isCurrentLocationLoaded = false; // Flag to track if current ISS location has been loaded

// Path visibility state
let pathVisibility = {
    predicted: true,
    sgp4: true
};

// Auto-refresh configuration
const AUTO_REFRESH_INTERVAL = 5 * 60 * 1000; // 5 minutes in milliseconds
const RETRY_INTERVAL = 7 * 1000; // 7 seconds for retry attempts
const MAX_RETRY_ATTEMPTS = 5; // Maximum number of retry attempts
const RETRY_STOP_THRESHOLD = 60 * 1000; // Stop retrying if within 60 seconds of next scheduled update
let autoRefreshTimer = null;
let retryTimer = null;
let lastDataTimestamp = null;
let retryCount = 0; // Track current retry count
let isFetching = false; // Flag to prevent concurrent API calls

// Initialize location history manager
const locationHistory = new LocationHistoryManager();
let historySlider = null;

// Initialize the application
async function init() {
    initMap();
    initializeLegendToggle();
    await locationHistory.initializeHistory();
    
    // Predictions are now fetched from the API, no local calculation needed
    
    // Show loading animation while setting up predictions
    showPredictionsLoading();
    
    // Initialize history slider with callback to update map
    historySlider = new HistorySlider(locationHistory, updateMapFromHistory);
    historySlider.initialize();
    
    
    await fetchISSData();
    
    // Start automatic refresh
    startAutoRefresh();
    
    // TLE data is handled server-side, no need to update client-side
}

// Initialize legend toggle functionality
function initializeLegendToggle() {
    const legendPredicted = document.getElementById('legend-predicted');
    const legendSgp4 = document.getElementById('legend-sgp4');
    
    if (legendPredicted) {
        legendPredicted.addEventListener('click', () => {
            pathVisibility.predicted = !pathVisibility.predicted;
            updateLegendVisualState();
            // Redraw paths and markers
            redrawPathsForWorldCopies();
            // Also refresh markers from current slider position
            refreshPredictionMarkers();
        });
    }
    
    if (legendSgp4) {
        legendSgp4.addEventListener('click', () => {
            pathVisibility.sgp4 = !pathVisibility.sgp4;
            updateLegendVisualState();
            // Redraw paths and markers
            redrawPathsForWorldCopies();
            // Also refresh markers from current slider position
            refreshPredictionMarkers();
        });
    }
    
    updateLegendVisualState();
}

// Refresh prediction markers based on current slider position
function refreshPredictionMarkers() {
    if (!map) return;
    
    // Remove existing prediction markers
    predictionMarkers.forEach(marker => {
        if (marker && map.hasLayer(marker)) {
            map.removeLayer(marker);
        }
    });
    predictionMarkers = [];
    
    // Get current location from slider
    const slider = document.getElementById('history-slider');
    if (!slider || slider.value === '') return;
    
    const currentIndex = parseInt(slider.value);
    const location = locationHistory.getLocationAt(currentIndex);
    if (!location) return;
    
    // Get predictions for this location
    const predictions = locationHistory.getPredictions();
    if (!predictions || predictions.length === 0) return;
    
    // Create prediction icons
    const predictionDotIcon = L.divIcon({
        className: 'prediction-dot',
        html: '<div style="width: 8px; height: 8px; border-radius: 50%; background-color: #FF6B6B; border: 2px solid white; box-shadow: 0 0 4px rgba(0,0,0,0.5);"></div>',
        iconSize: [8, 8],
        iconAnchor: [4, 4]
    });
    
    const sgp4DotIcon = L.divIcon({
        className: 'sgp4-dot',
        html: '<div style="width: 10px; height: 10px; border-radius: 50%; background-color: #4ECDC4; border: 2px solid white; box-shadow: 0 0 4px rgba(0,0,0,0.5);"></div>',
        iconSize: [10, 10],
        iconAnchor: [5, 5]
    });
    
    const bounds = map.getBounds();
    const west = bounds.getWest();
    const east = bounds.getEast();
    
    predictions.forEach(pred => {
        // Check visibility based on prediction method
        const isSgp4 = pred.method === 'sgp4';
        const shouldShow = isSgp4 ? pathVisibility.sgp4 : pathVisibility.predicted;
        
        if (!shouldShow) return; // Skip this marker if visibility is disabled
        
        const predLat = parseFloat(pred.latitude);
        let predLon = parseFloat(pred.longitude);
        
        // Normalize longitude
        while (predLon > 180) predLon -= 360;
        while (predLon < -180) predLon += 360;
        
        const iconToUse = isSgp4 ? sgp4DotIcon : predictionDotIcon;
        
        let baseLon = predLon;
        while (baseLon > west - 360) baseLon -= 360;
        
        for (let currLon = baseLon; currLon <= east + 720; currLon += 360) {
            const marker = L.marker([predLat, currLon], { 
                icon: iconToUse,
                interactive: true
            }).addTo(map);
            
            const predTime = new Date(pred.timestamp);
            const minutesAhead = pred.minutes_ahead || '?';
            const methodLabel = isSgp4 ? 'SGP4' : 'Orbital Mechanics';
            const popupContent = `<b>Predicted Location (${methodLabel})</b><br>` +
                `Time: ${predTime.toLocaleString()}<br>` +
                `Minutes ahead: ${minutesAhead}<br>` +
                `Coordinates: ${predLat.toFixed(4)}, ${predLon.toFixed(4)}`;
            
            marker.bindPopup(popupContent);
            predictionMarkers.push(marker);
        }
    });
}

// Update legend visual state based on visibility
function updateLegendVisualState() {
    const legendPredicted = document.getElementById('legend-predicted');
    const legendSgp4 = document.getElementById('legend-sgp4');
    
    if (legendPredicted) {
        if (pathVisibility.predicted) {
            legendPredicted.classList.remove('disabled');
        } else {
            legendPredicted.classList.add('disabled');
        }
    }
    
    if (legendSgp4) {
        if (pathVisibility.sgp4) {
            legendSgp4.classList.remove('disabled');
        } else {
            legendSgp4.classList.add('disabled');
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
        div.onclick = function() {
            if (issMarker) {
                map.panTo(issMarker.getLatLng());
            }
            return false;
        };
        return div;
    };
    centerButton.addTo(map);
    
    // Redraw paths when map view changes (zoom/pan) to show paths on all visible world copies
    map.on('moveend', redrawPathsForWorldCopies);
}

// Redraw paths for all visible world copies when map view changes
function redrawPathsForWorldCopies() {
    if (!map) return;
    
    // Remove existing paths
    predictionPathPolylines.forEach(polyline => {
        if (polyline && map.hasLayer(polyline)) {
            map.removeLayer(polyline);
        }
    });
    predictionPathPolylines = [];
    
    sgp4PathPolylines.forEach(polyline => {
        if (polyline && map.hasLayer(polyline)) {
            map.removeLayer(polyline);
        }
    });
    sgp4PathPolylines = [];
    
    // Redraw prediction markers if we have predictions
    const predictions = locationHistory.getPredictions();
    if (predictions && predictions.length > 0) {
        // Remove existing prediction markers
        predictionMarkers.forEach(marker => {
            if (marker && map.hasLayer(marker)) {
                map.removeLayer(marker);
            }
        });
        predictionMarkers = [];
        
        // Create prediction icons
        const predictionDotIcon = L.divIcon({
            className: 'prediction-dot',
            html: '<div style="width: 8px; height: 8px; border-radius: 50%; background-color: #FF6B6B; border: 2px solid white; box-shadow: 0 0 4px rgba(0,0,0,0.5);"></div>',
            iconSize: [8, 8],
            iconAnchor: [4, 4]
        });
        
        const sgp4DotIcon = L.divIcon({
            className: 'sgp4-dot',
            html: '<div style="width: 10px; height: 10px; border-radius: 50%; background-color: #4ECDC4; border: 2px solid white; box-shadow: 0 0 4px rgba(0,0,0,0.5);"></div>',
            iconSize: [10, 10],
            iconAnchor: [5, 5]
        });
        
        const bounds = map.getBounds();
        const west = bounds.getWest();
        const east = bounds.getEast();
        
        predictions.forEach(pred => {
            // Check visibility based on prediction method
            const isSgp4 = pred.method === 'sgp4';
            const shouldShow = isSgp4 ? pathVisibility.sgp4 : pathVisibility.predicted;
            
            if (!shouldShow) return; // Skip this marker if visibility is disabled
            
            const predLat = parseFloat(pred.latitude);
            let predLon = parseFloat(pred.longitude);
            
            // Normalize longitude
            while (predLon > 180) predLon -= 360;
            while (predLon < -180) predLon += 360;
            
            const iconToUse = isSgp4 ? sgp4DotIcon : predictionDotIcon;
            
            let baseLon = predLon;
            while (baseLon > west - 360) baseLon -= 360;
            
            for (let currLon = baseLon; currLon <= east + 720; currLon += 360) {
                const marker = L.marker([predLat, currLon], { 
                    icon: iconToUse,
                    interactive: true
                }).addTo(map);
                
                const predTime = new Date(pred.timestamp);
                const minutesAhead = pred.minutes_ahead || '?';
                const methodLabel = isSgp4 ? 'SGP4' : 'Orbital Mechanics';
                const popupContent = `<b>Predicted Location (${methodLabel})</b><br>` +
                    `Time: ${predTime.toLocaleString()}<br>` +
                    `Minutes ahead: ${minutesAhead}<br>` +
                    `Coordinates: ${predLat.toFixed(4)}, ${predLon.toFixed(4)}`;
                
                marker.bindPopup(popupContent);
                predictionMarkers.push(marker);
            }
        });
    }
    
    // Redraw prediction path if we have data and visibility is enabled
    if (pathVisibility.predicted && currentPathData && currentPathData.pathPoints.length > 0) {
        const bounds = map.getBounds();
        const west = bounds.getWest();
        const east = bounds.getEast();
        const firstLon = currentPathData.pathPoints[0][1];
        let baseLon = firstLon;
        while (baseLon > west - 360) baseLon -= 360;
        
        for (let offsetLon = baseLon; offsetLon <= east + 720; offsetLon += 360) {
            const offset = offsetLon - firstLon;
            const offsetPathPoints = currentPathData.pathPoints.map(point => [point[0], point[1] + offset]);
            
            const polyline = L.polyline(offsetPathPoints, {
                color: '#FF6B6B',
                weight: 3,
                opacity: 0.8,
                dashArray: '5, 5'
            }).addTo(map);
            
            polyline.bindPopup('Predicted Path (Polynomial)');
            predictionPathPolylines.push(polyline);
        }
    }
    
    // Redraw SGP4 paths if we have data and visibility is enabled (past and future separately)
    if (pathVisibility.sgp4 && currentSgp4PathData) {
        const bounds = map.getBounds();
        const west = bounds.getWest();
        const east = bounds.getEast();
        
        // Draw past path (red/orange)
        if (currentSgp4PathData.pastPoints && currentSgp4PathData.pastPoints.length > 0) {
            const firstLon = currentSgp4PathData.pastPoints[0][1];
            let baseLon = firstLon;
            while (baseLon > west - 360) baseLon -= 360;
            
            for (let offsetLon = baseLon; offsetLon <= east + 720; offsetLon += 360) {
                const offset = offsetLon - firstLon;
                const offsetPathPoints = currentSgp4PathData.pastPoints.map(point => [point[0], point[1] + offset]);
                
                const polyline = L.polyline(offsetPathPoints, {
                    color: '#FF6B6B', // Red/orange for past
                    weight: 5,
                    opacity: 1.0,
                    fillOpacity: 0,
                    dashArray: '15, 10',
                    lineCap: 'round',
                    lineJoin: 'round'
                }).addTo(map);
                
                polyline.bindPopup('True Path (SGP4/TLE) - Past');
                sgp4PathPolylines.push(polyline);
            }
        }
        
        // Draw future path (teal/cyan)
        if (currentSgp4PathData.futurePoints && currentSgp4PathData.futurePoints.length > 0) {
            const firstLon = currentSgp4PathData.futurePoints[0][1];
            let baseLon = firstLon;
            while (baseLon > west - 360) baseLon -= 360;
            
            for (let offsetLon = baseLon; offsetLon <= east + 720; offsetLon += 360) {
                const offset = offsetLon - firstLon;
                const offsetPathPoints = currentSgp4PathData.futurePoints.map(point => [point[0], point[1] + offset]);
                
                const polyline = L.polyline(offsetPathPoints, {
                    color: '#4ECDC4', // Teal/cyan for future
                    weight: 5,
                    opacity: 1.0,
                    fillOpacity: 0,
                    dashArray: '15, 10',
                    lineCap: 'round',
                    lineJoin: 'round'
                }).addTo(map);
                
                polyline.bindPopup('True Path (SGP4/TLE) - Future');
                sgp4PathPolylines.push(polyline);
            }
        }
        
        sgp4PathPolylines.forEach(polyline => polyline.bringToFront());
    }
}


// Format coordinates to be more readable
function formatCoordinates(lat, lon) {
    const latDir = lat >= 0 ? 'N' : 'S';
    const lonDir = lon >= 0 ? 'E' : 'W';
    return `${Math.abs(lat).toFixed(4)}° ${latDir}, ${Math.abs(lon).toFixed(4)}° ${lonDir}`;
}

// Format timestamp to local time
function formatTimestamp(timestamp) {
    const date = new Date(timestamp);
    
    // Get local time with date and timezone name
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

    // Get UTC date and time
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

// Start automatic refresh timer
function startAutoRefresh() {
    // Clear any existing timers
    if (autoRefreshTimer) {
        clearTimeout(autoRefreshTimer);
    }
    if (retryTimer) {
        clearTimeout(retryTimer);
    }
    
    // Reset retry count when starting a new refresh cycle
    retryCount = 0;
    
    // Calculate time until next 5-minute mark (e.g., 2:20, 2:25, etc.)
    const now = new Date();
    const nextUpdate = getNextScheduledUpdate(now);
    const timeUntilUpdate = nextUpdate.getTime() - now.getTime();
    
    // Set up the main auto-refresh timer
    autoRefreshTimer = setTimeout(() => {
        fetchISSDataWithRetry();
    }, timeUntilUpdate);
    
    console.log('Auto-refresh started - next update at:', nextUpdate.toLocaleTimeString());
}

// Calculate the next scheduled 5-minute update time
function getNextScheduledUpdate(currentTime) {
    const nextUpdate = new Date(currentTime);
    
    // Get current minutes
    const currentMinutes = nextUpdate.getMinutes();
    
    // Calculate the current 5-minute mark (round down to nearest 5)
    const current5MinMark = Math.floor(currentMinutes / 5) * 5;
    
    // Next 5-minute mark is always current mark + 5 minutes
    // This ensures we always go to the NEXT interval, not the current one
    let nextMinuteMark = current5MinMark + 5;
    
    if (nextMinuteMark >= 60) {
        // If we're past 55 minutes, go to next hour
        nextUpdate.setHours(nextUpdate.getHours() + 1);
        nextUpdate.setMinutes(nextMinuteMark - 60);
    } else {
        nextUpdate.setMinutes(nextMinuteMark);
    }
    
    // Reset seconds and milliseconds to 0
    nextUpdate.setSeconds(0);
    nextUpdate.setMilliseconds(0);
    
    return nextUpdate;
}

// Get time until next scheduled update in milliseconds
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
        const response = await fetch(`${config.API_URL}?api_key=${config.API_KEY}`);
        
        if (!response.ok) {
            throw new Error(`API returned ${response.status}`);
        }
        
        const data = await response.json();
        
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
        
        // Update actual locations map for accuracy comparison
        updateActualLocations(data);
        
        const addResult = updateUI(data);
        
        // Update slider range and handle smart positioning
        historySlider.updateSliderRange();
        
        // Smart slider positioning based on previous position
        console.log('Smart positioning - addResult:', addResult);
        if (addResult && addResult.currentTimestamp) {
            console.log('Was at oldest position:', addResult.wasAtOldestPosition);
            console.log('Current timestamp was:', addResult.currentTimestamp);
            
            if (addResult.wasAtOldestPosition) {
                // Was at oldest position, stay at oldest position (which is now position 0)
                historySlider.setSliderValue(0, true);
                console.log('Was at oldest position, staying at oldest position (0)');
            } else {
                // Was at a specific timestamp, try to maintain that timestamp
                const found = historySlider.setSliderToTimestamp(addResult.currentTimestamp);
                if (!found) {
                    // Timestamp no longer exists (probably cleaned up), move to current time
                    const filledHistoryCount = locationHistory.getFilledHistoryCount();
                    historySlider.setSliderValue(filledHistoryCount - 1, true);
                    console.log('Previous timestamp not found (likely cleaned up), moved to current time');
                } else {
                    console.log('Maintained position at timestamp:', addResult.currentTimestamp);
                }
            }
        } else {
            // Default behavior - move to current time
            const filledHistoryCount = locationHistory.getFilledHistoryCount();
            historySlider.setSliderValue(filledHistoryCount - 1, true);
            console.log('No addResult, moved to current time');
        }
        
        // Hide any previous error messages
        document.getElementById('error').style.display = 'none';
        
        // Reset fetching flag before scheduling next auto-refresh
        isFetching = false;
        
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
        
        // Show "no data available" message
        showNoDataMessage(location.timestamp);
        return;
    }
    
    // Hide "no data available" message if it's showing
    hideNoDataMessage();
    
    // Update map marker
    const lat = parseFloat(location.latitude);
    const lon = parseFloat(location.longitude);
    
    // Validate coordinates are valid numbers
    if (isNaN(lat) || isNaN(lon)) {
        console.warn('updateMapFromHistory - Invalid coordinates after parsing:', { lat, lon, location });
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
    
    // Remove existing prediction markers
    predictionMarkers.forEach(marker => {
        if (marker && map.hasLayer(marker)) {
            map.removeLayer(marker);
        }
    });
    predictionMarkers = [];
    
    // Display all prediction points on the map (always show all predictions when available)
    const predictions = locationHistory.getPredictions();
    if (predictions && predictions.length > 0) {
        console.log('Displaying', predictions.length, 'prediction points on map');
        
        // Create prediction icon (smaller dot for orbital mechanics)
        const predictionDotIcon = L.divIcon({
            className: 'prediction-dot',
            html: '<div style="width: 8px; height: 8px; border-radius: 50%; background-color: #FF6B6B; border: 2px solid white; box-shadow: 0 0 4px rgba(0,0,0,0.5);"></div>',
            iconSize: [8, 8],
            iconAnchor: [4, 4]
        });
        
        // Create SGP4 prediction icon (different color, slightly larger)
        const sgp4DotIcon = L.divIcon({
            className: 'sgp4-dot',
            html: '<div style="width: 10px; height: 10px; border-radius: 50%; background-color: #4ECDC4; border: 2px solid white; box-shadow: 0 0 4px rgba(0,0,0,0.5);"></div>',
            iconSize: [10, 10],
            iconAnchor: [5, 5]
        });
        
        const bounds = map.getBounds();
        const west = bounds.getWest();
        const east = bounds.getEast();
        
        predictions.forEach(pred => {
            // Check visibility based on prediction method
            const isSgp4 = pred.method === 'sgp4';
            const shouldShow = isSgp4 ? pathVisibility.sgp4 : pathVisibility.predicted;
            
            if (!shouldShow) return; // Skip this marker if visibility is disabled
            
            const predLat = parseFloat(pred.latitude);
            let predLon = parseFloat(pred.longitude);
            
            // Normalize longitude
            while (predLon > 180) predLon -= 360;
            while (predLon < -180) predLon += 360;
            
            // Determine icon based on method
            const iconToUse = isSgp4 ? sgp4DotIcon : predictionDotIcon;
            
            // Calculate base longitude
            let baseLon = predLon;
            while (baseLon > west - 360) baseLon -= 360;
            
            // Add markers for all visible longitudes
            for (let currLon = baseLon; currLon <= east + 720; currLon += 360) {
                const marker = L.marker([predLat, currLon], { 
                    icon: iconToUse,
                    interactive: true
                }).addTo(map);
                
                // Create popup content
                const predTime = new Date(pred.timestamp);
                const minutesAhead = pred.minutes_ahead || '?';
                const methodLabel = isSgp4 ? 'SGP4' : 'Orbital Mechanics';
                const popupContent = `<b>Predicted Location (${methodLabel})</b><br>` +
                    `Time: ${predTime.toLocaleString()}<br>` +
                    `Minutes ahead: ${minutesAhead}<br>` +
                    `Coordinates: ${predLat.toFixed(4)}, ${predLon.toFixed(4)}`;
                
                marker.bindPopup(popupContent);
                predictionMarkers.push(marker);
            }
        });
        
        console.log('Added', predictionMarkers.length, 'prediction markers to map');
    }

    // Create icon based on location type
    const issIcon = L.icon({
        iconUrl: './assets/iss-icon.svg',
        iconSize: [32, 32],
        iconAnchor: [16, 16],
        popupAnchor: [0, -16]
    });

    // Create prediction icon (same size as regular icon)
    const predictionIcon = L.icon({
        iconUrl: './assets/iss-icon.svg',
        iconSize: [32, 32],
        iconAnchor: [16, 16],
        popupAnchor: [0, -16],
        className: 'prediction-marker'
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

    // Check if this is the most recent location or a prediction
    const slider = document.getElementById('history-slider');
    const filledHistoryCount = locationHistory.getFilledHistoryCount();
    const isCurrentLocation = parseInt(slider.value) === filledHistoryCount - 1;
    const isPrediction = location.isPredicted;
    console.log('Slider value:', slider.value, 'Filled history count:', filledHistoryCount, 'Is current:', isCurrentLocation, 'Is prediction:', isPrediction);
    
    let popupPrefix = 'Historical Location';
    if (isCurrentLocation && !isPrediction) {
        popupPrefix = 'ISS Location';
    } else if (isPrediction) {
        popupPrefix = 'Predicted Location';
    }

    // Add markers for all visible longitudes with extra buffer
    for (let currLon = baseLon; currLon <= east + 720; currLon += 360) {  // Add two world widths to the east
        const iconToUse = isPrediction ? predictionIcon : issIcon;
        const marker = L.marker([lat, currLon], { icon: iconToUse }).addTo(map);
        
        // Add uncertainty rings for predictions
        if (isPrediction && location.confidence) {
            // Calculate uncertainty radius based on confidence (lower confidence = larger radius)
            const confidence = location.confidence;
            const maxRadius = 500000; // 500km in meters
            const minRadius = 50000;  // 50km in meters
            const uncertaintyRadius = maxRadius - (confidence * (maxRadius - minRadius));
            
            // Create three concentric circles with different opacities
            const innerCircle = L.circle([lat, currLon], {
                radius: uncertaintyRadius * 0.3,
                color: '#FF6400',
                weight: 3,
                opacity: 0.8,
                fillOpacity: 0
            }).addTo(map);
            
            const middleCircle = L.circle([lat, currLon], {
                radius: uncertaintyRadius * 0.6,
                color: '#FF6400',
                weight: 2,
                opacity: 0.6,
                fillOpacity: 0
            }).addTo(map);
            
            const outerCircle = L.circle([lat, currLon], {
                radius: uncertaintyRadius,
                color: '#FF6400',
                weight: 1,
                opacity: 0.4,
                fillOpacity: 0
            }).addTo(map);
            
            // Store circles with the marker for cleanup
            marker.uncertaintyCircles = [innerCircle, middleCircle, outerCircle];
        }
        
        let popupContent = `<b>${popupPrefix}:</b><br>`;
        if (location.location) {
            const flag = getCountryFlag(location.location, location.country_code);
            const flagText = flag ? ` ${flag}` : '';
            popupContent += `${location.location}${flagText}`;
        }
        if (isPrediction && location.confidence) {
            popupContent += `<br><small>Confidence: ${Math.round(location.confidence * 100)}%</small>`;
        }
        
        marker.bindPopup(popupContent);
        issMarker.push(marker);
    }

    // Find the closest marker to center for panning
    let targetLng = lon;
    while (targetLng < center.lng - 180) targetLng += 360;
    while (targetLng > center.lng + 180) targetLng -= 360;
    
    map.panTo([lat, targetLng]);
    
    // Open popup on the marker closest to center
    // Open popup for any location (historical, current, or prediction)
    if (issMarker.length > 0) {
        const closestMarker = issMarker.reduce((prev, curr) => {
            const prevDist = Math.abs(prev.getLatLng().lng - center.lng);
            const currDist = Math.abs(curr.getLatLng().lng - center.lng);
            return currDist < prevDist ? curr : prev;
        });
        closestMarker.openPopup();
    }
}

// Update the UI with ISS data
function updateUI(data) {
    const coordinates = document.getElementById('coordinates');
    const time = document.getElementById('time');
    const fact = document.getElementById('fact');
    
    if (data.latitude && data.longitude) {
        // Add the new location to history with smart slider positioning
        const addResult = locationHistory.addLocation({
            timestamp: data.timestamp,
            latitude: data.latitude,
            longitude: data.longitude,
            location: data.location,
            fun_fact: data.fun_fact
        }, () => historySlider.getCurrentSliderInfo());

        // Set predictions from API data
        if (data.predictions && data.predictions.orbital_mechanics) {
            locationHistory.setPredictionsFromAPI(data.predictions);
            const predictions = locationHistory.predictions;
            
            console.log('Predictions loaded from API:', predictions.length);
            if (predictions.length > 0) {
                console.log('First prediction:', predictions[0]);
                console.log('Last prediction:', predictions[predictions.length - 1]);
            }

            // Store fixed predictions for accuracy table (only store once on initial load, never regenerate)
            // These predictions stay fixed so we can compare actual data against them over time
            if (!accuracyTableInitialized && predictions.length > 0) {
                // Store the first 12 predictions (next hour) for the accuracy table
                accuracyTablePredictions = predictions.slice(0, 12).map(p => ({ ...p })); // Deep copy
                accuracyTableInitialized = true; // Mark as initialized so it never gets regenerated
                console.log('Stored', accuracyTablePredictions.length, 'fixed predictions for accuracy table');
                console.log('First prediction time:', accuracyTablePredictions[0].timestamp);
                console.log('Last prediction time:', accuracyTablePredictions[accuracyTablePredictions.length - 1].timestamp);
                console.log('Accuracy table predictions are now FIXED and will not be regenerated');
            }
        } else {
            console.log('No predictions available in API response');
            locationHistory.predictions = [];
        }

        // Update slider range after predictions are generated
        historySlider.updateSliderRange();
        
        // Verify slider can access predictions
        const allLocations = locationHistory.getAllLocations();
        const historyCount = locationHistory.getLocations().length;
        if (allLocations.length > historyCount) {
            const firstPrediction = allLocations[historyCount];
            console.log('Verification - First prediction accessible:', firstPrediction ? firstPrediction.timestamp : 'null');
        }
        
        // Display prediction accuracy table (uses fixed predictions)
        displayPredictionAccuracyTable();
        
        // Historical validation disabled - predictions now come from API
        // displayHistoricalValidation(); // Disabled - would need server-side historical predictions
        
        // Draw prediction paths using API data
        const currentLocation = {
            timestamp: data.timestamp,
            latitude: data.latitude,
            longitude: data.longitude
        };
        // Store the current location
        currentISSLocation = currentLocation;
        // Use predictions from API if available
        drawPredictionPathsFromAPI(currentLocation, data.predictions);
        
        // Set slider to current time position (middle of slider) if not already positioned
        if (!historySlider.isPositioned()) {
            const filledHistoryCount = locationHistory.getFilledHistoryCount();
            historySlider.setSliderValue(filledHistoryCount - 1, true);
        }
        
        // Hide loading animation now that predictions are ready
        hidePredictionsLoading();

        // Update text displays
        coordinates.textContent = `${formatCoordinates(parseFloat(data.latitude), parseFloat(data.longitude))}${data.location ? `\n\n${data.location}` : ''}`;
        time.textContent = formatTimestamp(data.timestamp);
        fact.textContent = data.fun_fact || 'No fun fact available for this location.';

        // Update map
        const lat = parseFloat(data.latitude);
        const lon = parseFloat(data.longitude);
        
        // Create a custom icon for the ISS
        const issIcon = L.icon({
            iconUrl: './assets/iss-icon.svg',
            iconSize: [32, 32],
            iconAnchor: [16, 16],
            popupAnchor: [0, -16]
        });
        
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

        // Add markers for all visible longitudes with extra buffer
        for (let currLon = baseLon; currLon <= east + 720; currLon += 360) {  // Add two world widths to the east
            const marker = L.marker([lat, currLon], { icon: issIcon }).addTo(map);
            if (data.location) {
                const flag = getCountryFlag(data.location, data.country_code);
                const flagText = flag ? ` ${flag}` : '';
                marker.bindPopup(`<b>ISS Location:</b><br>${data.location}${flagText}`);
            }
            issMarker.push(marker);
        }

        // Find the closest marker to center for panning
        let targetLng = lon;
        while (targetLng < center.lng - 180) targetLng += 360;
        while (targetLng > center.lng + 180) targetLng -= 360;
        
        map.panTo([lat, targetLng]);
        
        // Open popup on the marker closest to center
        if (data.location && issMarker.length > 0) {
            const closestMarker = issMarker.reduce((prev, curr) => {
                const prevDist = Math.abs(prev.getLatLng().lng - center.lng);
                const currDist = Math.abs(curr.getLatLng().lng - center.lng);
                return currDist < prevDist ? curr : prev;
            });
            closestMarker.openPopup();
        }
        
        // Return the addResult for smart slider positioning
        return addResult;
    } else {
        console.error('Unexpected data structure:', data);
        showError('Received invalid data structure from API');
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

// Fetch ISS data (initial load)
async function fetchISSData() {
    try {
        console.log('Fetching initial data from:', config.API_URL);
        const response = await fetch(`${config.API_URL}?api_key=${config.API_KEY}`);
        console.log('Response status:', response.status);
        
        if (!response.ok) {
            const errorText = await response.text();
            console.error('API Error:', errorText);
            throw new Error(`API returned ${response.status}: ${errorText}`);
        }
        
        const data = await response.json();
        console.log('Received initial data:', data);
        
        // Mark that current location has been loaded
        isCurrentLocationLoaded = true;
        
        // Store the timestamp for comparison
        lastDataTimestamp = data.timestamp;
        
        // Update actual locations map for accuracy comparison
        updateActualLocations(data);
        
        const addResult = updateUI(data);
        
        // Update slider range and reset to current time position (middle of slider)
        historySlider.updateSliderRange();
        const filledHistoryCount = locationHistory.getFilledHistoryCount();
        console.log('Resetting slider - Filled history count:', filledHistoryCount, 'Current time position:', filledHistoryCount - 1);
        historySlider.setSliderValue(filledHistoryCount - 1, true); // Skip map update since map already shows current data
        
        // Hide any previous error messages
        document.getElementById('error').style.display = 'none';
        
    } catch (error) {
        console.error('Error details:', error);
        showError(
            'Failed to fetch initial ISS data. Auto-refresh will continue.',
            `Error: ${error.message}`
        );
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

// Store fixed predictions for accuracy table (don't regenerate these)
// These are set once on initial load and never change
let accuracyTablePredictions = [];
let accuracyTableInitialized = false;

// Display predictions for the next hour in the table
function displayPredictionAccuracyTable() {
    // Always use fixed predictions for accuracy table (set on initial load, never regenerated)
    const predictions = accuracyTablePredictions;
    if (!predictions || predictions.length === 0) {
        // Show placeholder if predictions haven't been initialized yet
        const tableBody = document.getElementById('prediction-table-body');
        if (tableBody) {
            tableBody.innerHTML = '<tr><td colspan="6" class="no-predictions">Predictions will appear here once calculated...</td></tr>';
        }
        return;
    }
    
    // Use all stored fixed predictions (should be exactly 12 for the next hour)
    const nextHourPredictions = predictions;
    
    const tableBody = document.getElementById('prediction-table-body');
    if (!tableBody) return;
    
    // Clear existing rows
    tableBody.innerHTML = '';
    
        if (nextHourPredictions.length === 0) {
        tableBody.innerHTML = '<tr><td colspan="6" class="no-predictions">No predictions available yet...</td></tr>';
        return;
    }
    
    // Create rows for each prediction
    nextHourPredictions.forEach((prediction) => {
        const row = document.createElement('tr');
        
        // Format time
        const predTime = new Date(prediction.timestamp);
        const timeStr = predTime.toLocaleTimeString('en-US', {
            hour: 'numeric',
            minute: '2-digit',
            hour12: true
        });
        
        // Get prediction key for matching (rounds to 5-minute intervals)
        const predictionKey = getPredictionKey(predTime);
        
        // Check if we have actual data for this timestamp
        // Try exact match first, then check within 2.5 minutes tolerance
        let actualLocation = actualLocations.get(predictionKey);
        
        // If no exact match, try to find closest match within 2.5 minutes
        if (!actualLocation) {
            const predTimeMs = predTime.getTime();
            let closestMatch = null;
            let closestDiff = Infinity;
            
            for (const [key, value] of actualLocations.entries()) {
                const actualTimeMs = new Date(value.timestamp).getTime();
                const diff = Math.abs(predTimeMs - actualTimeMs);
                // Match if within 2.5 minutes (half of 5-minute interval)
                if (diff <= 2.5 * 60 * 1000 && diff < closestDiff) {
                    closestDiff = diff;
                    closestMatch = value;
                }
            }
            
            if (closestMatch) {
                actualLocation = closestMatch;
            }
        }
        
        // Time column
        const timeCell = document.createElement('td');
        timeCell.className = 'prediction-time';
        timeCell.textContent = timeStr;
        row.appendChild(timeCell);
        
        // Predicted location column
        const predLocCell = document.createElement('td');
        predLocCell.className = 'prediction-location';
        predLocCell.textContent = formatCoordinates(
            parseFloat(prediction.latitude),
            parseFloat(prediction.longitude)
        );
        row.appendChild(predLocCell);
        
        // Actual location column
        const actualLocCell = document.createElement('td');
        if (actualLocation) {
            actualLocCell.className = 'actual-location';
            actualLocCell.textContent = formatCoordinates(
                parseFloat(actualLocation.latitude),
                parseFloat(actualLocation.longitude)
            );
        } else {
            actualLocCell.className = 'prediction-location-pending';
            actualLocCell.textContent = 'Pending...';
        }
        row.appendChild(actualLocCell);
        
        // Distance column
        const distanceCell = document.createElement('td');
        if (actualLocation) {
            const distanceKm = calculateDistance(
                parseFloat(prediction.latitude),
                parseFloat(prediction.longitude),
                parseFloat(actualLocation.latitude),
                parseFloat(actualLocation.longitude)
            );
            const distanceMiles = kmToMiles(distanceKm);
            distanceCell.className = `distance-value ${getDistanceClass(distanceMiles)}`;
            distanceCell.textContent = `${distanceMiles.toFixed(1)} mi`;
            
            // Record prediction accuracy for improving confidence calculations (still in km for internal use)
            // Prediction accuracy tracking removed - predictions now come from API
        } else {
            distanceCell.className = 'prediction-location-pending';
            distanceCell.textContent = '-';
        }
        row.appendChild(distanceCell);
        
        // Lat/Lon Error column (in miles)
        const errorCell = document.createElement('td');
        if (actualLocation) {
            const predLat = parseFloat(prediction.latitude);
            const predLon = parseFloat(prediction.longitude);
            const actualLat = parseFloat(actualLocation.latitude);
            const actualLon = parseFloat(actualLocation.longitude);
            
            const latErrorDeg = predLat - actualLat;
            let lonErrorDeg = predLon - actualLon;
            
            // Handle longitude wrapping (find shortest path)
            if (lonErrorDeg > 180) lonErrorDeg -= 360;
            if (lonErrorDeg < -180) lonErrorDeg += 360;
            
            // Convert to miles
            const latErrorMiles = degreesToMilesLat(latErrorDeg);
            const lonErrorMiles = degreesToMilesLon(lonErrorDeg, predLat);
            
            // Format with appropriate signs
            const latSign = latErrorMiles >= 0 ? '+' : '';
            const lonSign = lonErrorMiles >= 0 ? '+' : '';
            
            errorCell.className = 'lat-lon-error';
            errorCell.textContent = `${latSign}${latErrorMiles.toFixed(1)} mi, ${lonSign}${lonErrorMiles.toFixed(1)} mi`;
        } else {
            errorCell.className = 'prediction-location-pending';
            errorCell.textContent = '-';
        }
        row.appendChild(errorCell);
                // Minutes Ahead column
        const minutesAheadCell = document.createElement('td');
        minutesAheadCell.className = 'minutes-ahead';
        if (prediction.minutesAhead !== undefined) {
            minutesAheadCell.textContent = `${prediction.minutesAhead.toFixed(0)} min`;
        } else {
            // Calculate from timestamp if not available
            const baseTime = accuracyTablePredictions.length > 0 ? new Date(accuracyTablePredictions[0].timestamp) : new Date();
            const minutesDiff = (predTime - baseTime) / (1000 * 60);
            minutesAheadCell.textContent = `${minutesDiff.toFixed(0)} min`;
        }
        row.appendChild(minutesAheadCell);
        
        tableBody.appendChild(row);
    });
}

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
    
    // Refresh both tables
    displayPredictionAccuracyTable();
    displayHistoricalValidation();
}

// Store historical predictions for validation
let historicalValidationPredictions = [];

// Display historical validation table (predictions from 1 hour ago)
function displayHistoricalValidation() {
    const locations = locationHistory.getLocations();
    if (locations.length < 12) {
        // Need at least 1 hour of data (12 data points at 5-min intervals)
        const tableBody = document.getElementById('historical-table-body');
        if (tableBody) {
            tableBody.innerHTML = '<tr><td colspan="7" class="no-predictions">Need at least 1 hour of data for historical validation...</td></tr>';
        }
        return;
    }
    
    // Get location from 1 hour ago (12 data points back, since data comes every 5 minutes)
    const oneHourAgoIndex = 11; // 12th item (0-indexed: 0-11 = 12 items = 1 hour)
    if (locations.length <= oneHourAgoIndex) {
        return;
    }
    
    const oneHourAgoLocation = locations[oneHourAgoIndex];
    const oneHourAgoTime = new Date(oneHourAgoLocation.timestamp);
    const now = new Date();
    const hoursDiff = (now - oneHourAgoTime) / (1000 * 60 * 60);
    
    // Only generate historical predictions if we have data from approximately 1 hour ago
    // Be more lenient - allow data from 0.5 to 2 hours ago
    if (hoursDiff < 0.5 || hoursDiff > 2.0) {
        // Data is not close enough to 1 hour ago
        const tableBody = document.getElementById('historical-table-body');
        if (tableBody) {
            tableBody.innerHTML = `<tr><td colspan="7" class="no-predictions">Waiting for data from ~1 hour ago (current: ${hoursDiff.toFixed(2)} hours ago)...</td></tr>`;
        }
        return;
    }
    
    // Generate predictions from 1 hour ago
    // Regenerate if we don't have predictions or if the base time has changed significantly
    const shouldRegenerate = historicalValidationPredictions.length === 0 || 
        (historicalValidationPredictions.length > 0 && 
         Math.abs(new Date(historicalValidationPredictions[0].timestamp).getTime() - 
                  (oneHourAgoTime.getTime() + 5 * 60 * 1000)) > 10 * 60 * 1000); // More than 10 min difference
    
    if (shouldRegenerate) {
        // Get recent history from that point in time
        // locations are sorted newest first (index 0 = most recent), so:
        // - locations[oneHourAgoIndex] = 1 hour ago (this is our "current" point for predictions)
        // - locations[oneHourAgoIndex + 1] = 1 hour 5 min ago (older, BEFORE the 1-hour-ago point)
        // - locations[oneHourAgoIndex + 2] = 1 hour 10 min ago (older)
        // - locations[oneHourAgoIndex + 3] = 1 hour 15 min ago (older)
        // 
        // IMPORTANT: We must ONLY use data that was available at the 1-hour-ago time.
        // This means we use locations[oneHourAgoIndex] as current, and locations[oneHourAgoIndex + 1, +2, +3] as history.
        // We MUST NOT use locations[0] through locations[oneHourAgoIndex - 1] as those are AFTER the 1-hour-ago point.
        
        // Verify we have enough data points
        const minRequiredIndex = oneHourAgoIndex + 3; // Need at least 3 points before
        if (locations.length <= minRequiredIndex) {
            console.log('Not enough historical data for validation');
            return;
        }
        
        // Get history points that were available at the 1-hour-ago time
        // These are points BEFORE (older than) the 1-hour-ago point
        // Use same number as current predictions (3 points) for consistency
        const recentHistoryAtThatTime = [
            locations[oneHourAgoIndex],      // Current point (1 hour ago) - most recent available at that time
            locations[oneHourAgoIndex + 1],  // 5 min before (1h 5m ago)
            locations[oneHourAgoIndex + 2]   // 10 min before (1h 10m ago)
        ].filter(loc => loc !== undefined && loc !== null); // Filter out invalid entries
        
        if (recentHistoryAtThatTime.length < 2) {
            console.log('Not enough history points for velocity estimation');
            return;
        }
        
        // Verify timestamps are in correct order (newest first, which means decreasing timestamps)
        for (let i = 0; i < recentHistoryAtThatTime.length - 1; i++) {
            const time1 = new Date(recentHistoryAtThatTime[i].timestamp).getTime();
            const time2 = new Date(recentHistoryAtThatTime[i + 1].timestamp).getTime();
            if (time1 < time2) {
                console.error('ERROR: History points are not in correct order! Point', i, 'is older than point', i + 1);
                return;
            }
        }
        
        console.log('Historical validation - Using location from:', oneHourAgoTime.toISOString());
        console.log('Historical validation - Base location:', oneHourAgoLocation.latitude, oneHourAgoLocation.longitude);
        console.log('Historical validation - Recent history points:', recentHistoryAtThatTime.length);
        if (recentHistoryAtThatTime.length > 1) {
            const timeDiff = (new Date(recentHistoryAtThatTime[0].timestamp) - new Date(recentHistoryAtThatTime[1].timestamp)) / (1000 * 60);
            console.log('Historical validation - Time diff between points:', timeDiff, 'minutes');
            const latDiff = parseFloat(recentHistoryAtThatTime[0].latitude) - parseFloat(recentHistoryAtThatTime[1].latitude);
            const lonDiff = parseFloat(recentHistoryAtThatTime[0].longitude) - parseFloat(recentHistoryAtThatTime[1].longitude);
            console.log('Historical validation - Lat/Lon diff:', latDiff, lonDiff);
        }
        
        // Historical validation disabled - predictions now come from API
        // Historical predictions would need to be fetched from server for past timestamps
        historicalValidationPredictions = [];
        console.log('Historical validation disabled - predictions now come from API');
    }
    
    const tableBody = document.getElementById('historical-table-body');
    if (!tableBody) return;
    
    // Clear existing rows
    tableBody.innerHTML = '';
    
    // Show message that historical validation is disabled
    tableBody.innerHTML = '<tr><td colspan="6" class="no-predictions">Historical validation disabled - predictions now come from API</td></tr>';
    return;
    
    // Create rows for each time interval
    historicalValidationPredictions.forEach((predictionData) => {
        const minutesAhead = predictionData.minutesAhead;
        
        // Get the single prediction (polynomial equations don't use correction factors)
        const predictionKeys = Object.keys(predictionData.predictions);
        if (predictionKeys.length === 0) return;
        
        const prediction = predictionData.predictions[predictionKeys[0]];
        
        // Calculate target time
        const targetTime = new Date(oneHourAgoTime.getTime() + minutesAhead * 60 * 1000);
        const timeStr = targetTime.toLocaleTimeString('en-US', {
            hour: 'numeric',
            minute: '2-digit',
            hour12: true
        });
        
        // Find actual data for this timestamp
        const targetTimeMs = targetTime.getTime();
        let actualLocation = null;
        let closestDiff = Infinity;
        
        // First, check the locations array (contains all historical data)
        locations.forEach(loc => {
            const actualTimeMs = new Date(loc.timestamp).getTime();
            const diff = Math.abs(actualTimeMs - targetTimeMs);
            // Match if within 2.5 minutes
            if (diff <= 2.5 * 60 * 1000 && diff < closestDiff) {
                closestDiff = diff;
                actualLocation = loc;
            }
        });
        
        // Also check actualLocations map
        for (const [key, value] of actualLocations.entries()) {
            const actualTimeMs = new Date(value.timestamp).getTime();
            const diff = Math.abs(actualTimeMs - targetTimeMs);
            if (diff <= 2.5 * 60 * 1000 && diff < closestDiff) {
                closestDiff = diff;
                actualLocation = value;
            }
        }
        
        const row = document.createElement('tr');
        
        // Time column
        const timeCell = document.createElement('td');
        timeCell.className = 'prediction-time';
        timeCell.textContent = timeStr;
        row.appendChild(timeCell);
        
        // Predicted location column
        const predLocCell = document.createElement('td');
        predLocCell.className = 'prediction-location';
        predLocCell.textContent = formatCoordinates(
            prediction.latitude,
            prediction.longitude
        );
        row.appendChild(predLocCell);
        
        // Actual location column
        const actualLocCell = document.createElement('td');
        if (actualLocation) {
            actualLocCell.className = 'actual-location';
            actualLocCell.textContent = formatCoordinates(
                parseFloat(actualLocation.latitude),
                parseFloat(actualLocation.longitude)
            );
        } else {
            actualLocCell.className = 'prediction-location-pending';
            actualLocCell.textContent = 'Pending...';
        }
        row.appendChild(actualLocCell);
        
        // Distance column
        const distanceCell = document.createElement('td');
        if (actualLocation) {
            const distanceKm = calculateDistance(
                prediction.latitude,
                prediction.longitude,
                parseFloat(actualLocation.latitude),
                parseFloat(actualLocation.longitude)
            );
            const distanceMiles = kmToMiles(distanceKm);
            distanceCell.className = `distance-value ${getDistanceClass(distanceMiles)}`;
            distanceCell.textContent = `${distanceMiles.toFixed(1)} mi`;
        } else {
            distanceCell.className = 'prediction-location-pending';
            distanceCell.textContent = '-';
        }
        row.appendChild(distanceCell);
        
        // Lat/Lon Error column (in miles)
        const errorCell = document.createElement('td');
        if (actualLocation) {
            const predLat = prediction.latitude;
            const predLon = prediction.longitude;
            const actualLat = parseFloat(actualLocation.latitude);
            const actualLon = parseFloat(actualLocation.longitude);
            
            const latErrorDeg = predLat - actualLat;
            let lonErrorDeg = predLon - actualLon;
            
            // Handle longitude wrapping
            if (lonErrorDeg > 180) lonErrorDeg -= 360;
            if (lonErrorDeg < -180) lonErrorDeg += 360;
            
            // Convert to miles
            const latErrorMiles = degreesToMilesLat(latErrorDeg);
            const lonErrorMiles = degreesToMilesLon(lonErrorDeg, predLat);
            
            // Format with appropriate signs
            const latSign = latErrorMiles >= 0 ? '+' : '';
            const lonSign = lonErrorMiles >= 0 ? '+' : '';
            
            errorCell.className = 'lat-lon-error';
            errorCell.textContent = `${latSign}${latErrorMiles.toFixed(1)} mi, ${lonSign}${lonErrorMiles.toFixed(1)} mi`;
        } else {
            errorCell.className = 'prediction-location-pending';
            errorCell.textContent = '-';
        }
        row.appendChild(errorCell);
        
        // Minutes Ahead column
        const minutesAheadCell = document.createElement('td');
        minutesAheadCell.className = 'minutes-ahead';
        minutesAheadCell.textContent = `${minutesAhead.toFixed(0)} min`;
        row.appendChild(minutesAheadCell);
        
        tableBody.appendChild(row);
    });
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

// Store current path data for redrawing on map move
let currentPathData = null;
let currentSgp4PathData = null;

// Draw prediction paths on the map using API data
function drawPredictionPathsFromAPI(baseLocation, predictionsData) {
    if (!map || !baseLocation) return;
    
    // Only draw paths for the current ISS location, not historical locations
    const isCurrentLocation = currentISSLocation && 
        new Date(baseLocation.timestamp).getTime() === new Date(currentISSLocation.timestamp).getTime();
    
    if (!isCurrentLocation || !predictionsData) {
        // Clear paths if not current location or no predictions
        predictionPathPolylines.forEach(polyline => {
            if (polyline && map.hasLayer(polyline)) {
                map.removeLayer(polyline);
            }
        });
        predictionPathPolylines = [];
        return;
    }
    
    // Remove existing prediction paths
    predictionPathPolylines.forEach(polyline => {
        if (polyline && map.hasLayer(polyline)) {
            map.removeLayer(polyline);
        }
    });
    predictionPathPolylines = [];
    
    // Remove existing SGP4 paths
    sgp4PathPolylines.forEach(polyline => {
        if (polyline && map.hasLayer(polyline)) {
            map.removeLayer(polyline);
        }
    });
    sgp4PathPolylines = [];
    
    // Draw orbital mechanics predictions (18 predictions: 5, 10, ..., 90 minutes)
    const orbitalPredictions = predictionsData.orbital_mechanics || [];
    if (orbitalPredictions.length > 0) {
        const rawPoints = orbitalPredictions.map(pred => {
            let lat = parseFloat(pred.latitude);
            let lon = parseFloat(pred.longitude);
            
            // Normalize longitude to [-180, 180]
            while (lon > 180) lon -= 360;
            while (lon < -180) lon += 360;
            lat = Math.max(-90, Math.min(90, lat));
            
            return [lat, lon];
        });
        
        // Add current location as first point
        rawPoints.unshift([parseFloat(baseLocation.latitude), parseFloat(baseLocation.longitude)]);
        
        // Normalize longitudes to follow shortest path (unwrap)
        const pathPoints = normalizeLongitudePath(rawPoints);
        
        // Store path data for redrawing on map move
        currentPathData = { pathPoints };
        
        // Draw polylines for all visible world copies (only if visibility is enabled)
        if (pathVisibility.predicted && pathPoints.length > 0) {
            const bounds = map.getBounds();
            const west = bounds.getWest();
            const east = bounds.getEast();
            
            // Calculate base longitude offset
            const firstLon = pathPoints[0][1];
            let baseLon = firstLon;
            while (baseLon > west - 360) baseLon -= 360;
            
            // Create multiple copies of the path at different longitude offsets
            for (let offsetLon = baseLon; offsetLon <= east + 720; offsetLon += 360) {
                const offset = offsetLon - firstLon;
                const offsetPathPoints = pathPoints.map(point => [point[0], point[1] + offset]);
                
                const polyline = L.polyline(offsetPathPoints, {
                    color: '#FF6B6B',
                    weight: 3,
                    opacity: 0.8,
                    dashArray: '5, 5'
                }).addTo(map);
                
                // Add popup
                polyline.bindPopup('Predicted Path (Orbital Mechanics)');
                predictionPathPolylines.push(polyline);
            }
        }
    }
    
    // Draw SGP4 prediction (single point at 90 minutes)
    const sgp4Prediction = predictionsData.sgp4;
    if (sgp4Prediction) {
        const sgp4Lat = parseFloat(sgp4Prediction.latitude);
        let sgp4Lon = parseFloat(sgp4Prediction.longitude);
        
        // Normalize longitude
        while (sgp4Lon > 180) sgp4Lon -= 360;
        while (sgp4Lon < -180) sgp4Lon += 360;
        
        const currentPoint = [parseFloat(baseLocation.latitude), parseFloat(baseLocation.longitude)];
        const sgp4Point = [sgp4Lat, sgp4Lon];
        const sgp4PathPoints = normalizeLongitudePath([currentPoint, sgp4Point]);
        
        // Store SGP4 path data
        currentSgp4PathData = {
            pastPoints: [],
            futurePoints: sgp4PathPoints,
            baseTimestamp: baseLocation.timestamp
        };
        
        // Draw SGP4 path for all visible world copies (only if visibility is enabled)
        if (pathVisibility.sgp4 && sgp4PathPoints.length > 0) {
            const bounds = map.getBounds();
            const west = bounds.getWest();
            const east = bounds.getEast();
            
            const firstLon = sgp4PathPoints[0][1];
            let baseLon = firstLon;
            while (baseLon > west - 360) baseLon -= 360;
            
            for (let offsetLon = baseLon; offsetLon <= east + 720; offsetLon += 360) {
                const offset = offsetLon - firstLon;
                const offsetPathPoints = sgp4PathPoints.map(point => [point[0], point[1] + offset]);
                
                const polyline = L.polyline(offsetPathPoints, {
                    color: '#4ECDC4', // Teal/cyan for SGP4
                    weight: 5,
                    opacity: 1.0,
                    fillOpacity: 0,
                    dashArray: '15, 10',
                    lineCap: 'round',
                    lineJoin: 'round'
                }).addTo(map);
                
                polyline.bindPopup('True Path (SGP4/TLE) - 90 minutes');
                sgp4PathPolylines.push(polyline);
            }
            
            // Bring to front to ensure visibility
            sgp4PathPolylines.forEach(polyline => polyline.bringToFront());
        }
    }
}
