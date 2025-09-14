import config from './config.js';
import LocationHistoryManager from './locationHistory.js';
import HistorySlider from './historySlider.js';

// Initialize the application when the page loads
window.addEventListener('load', init);

// Initialize map
let map = null;
let issMarker = null;

// Auto-refresh configuration
const AUTO_REFRESH_INTERVAL = 5 * 60 * 1000; // 5 minutes in milliseconds
const RETRY_INTERVAL = 7 * 1000; // 7 seconds for retry attempts
let autoRefreshTimer = null;
let retryTimer = null;
let lastDataTimestamp = null;

// Initialize location history manager
const locationHistory = new LocationHistoryManager();
let historySlider = null;

// Initialize the application
async function init() {
    initMap();
    await locationHistory.initializeHistory();
    
    // Initialize history slider with callback to update map
    historySlider = new HistorySlider(locationHistory, updateMapFromHistory);
    historySlider.initialize();
    
    await fetchISSData();
    
    // Start automatic refresh
    startAutoRefresh();
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
    
    // Calculate next 5-minute mark
    const nextMinuteMark = Math.ceil(currentMinutes / 5) * 5;
    
    if (nextMinuteMark >= 60) {
        // If we're past 55 minutes, go to next hour
        nextUpdate.setHours(nextUpdate.getHours() + 1);
        nextUpdate.setMinutes(0);
    } else {
        nextUpdate.setMinutes(nextMinuteMark);
    }
    
    // Reset seconds to 0
    nextUpdate.setSeconds(0);
    nextUpdate.setMilliseconds(0);
    
    return nextUpdate;
}

// Fetch ISS data with retry logic for new data
async function fetchISSDataWithRetry() {
    try {
        const response = await fetch(`${config.API_URL}?api_key=${config.API_KEY}`);
        
        if (!response.ok) {
            throw new Error(`API returned ${response.status}`);
        }
        
        const data = await response.json();
        
        // Check if we have new data
        if (lastDataTimestamp && data.timestamp === lastDataTimestamp) {
            console.log('No new data available, retrying in 7 seconds...');
            
            // Schedule retry
            retryTimer = setTimeout(() => {
                fetchISSDataWithRetry();
            }, RETRY_INTERVAL);
            
            return;
        }
        
        // We have new data, update the UI
        lastDataTimestamp = data.timestamp;
        const addResult = updateUI(data);
        
        // Update slider range and handle smart positioning
        historySlider.updateSliderRange();
        
        // Smart slider positioning based on previous position
        console.log('Smart positioning - addResult:', addResult);
        if (addResult && addResult.currentTimestamp) {
            console.log('Was at oldest position:', addResult.wasAtOldestPosition);
            console.log('Current timestamp was:', addResult.currentTimestamp);
            
            if (addResult.wasAtOldestPosition) {
                // Was at oldest position, move to new oldest position (position 0)
                const slider = document.getElementById('history-slider');
                historySlider.setSliderValue(0, true);
                console.log('Was at oldest position, moved to new oldest position (0)');
            } else {
                // Was at a specific timestamp, try to maintain that timestamp
                const found = historySlider.setSliderToTimestamp(addResult.currentTimestamp);
                if (!found) {
                    // Timestamp no longer exists, move to most recent
                    const slider = document.getElementById('history-slider');
                    historySlider.setSliderValue(slider.max, true);
                    console.log('Previous timestamp not found, moved to most recent');
                } else {
                    console.log('Maintained position at timestamp:', addResult.currentTimestamp);
                }
            }
        } else {
            // Default behavior - move to most recent
            const slider = document.getElementById('history-slider');
            historySlider.setSliderValue(slider.max, true);
            console.log('No addResult, moved to most recent');
        }
        
        // Hide any previous error messages
        document.getElementById('error').style.display = 'none';
        
        // Schedule next auto-refresh
        startAutoRefresh();
        
    } catch (error) {
        console.error('Error in auto-refresh:', error);
        
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
    if (!location) return;
    
    // Only update the time display in the slider
    const timeDisplay = document.getElementById('time-display');
    const date = new Date(location.timestamp);
    timeDisplay.textContent = date.toLocaleString();
    
    // Update map marker
    const lat = parseFloat(location.latitude);
    const lon = parseFloat(location.longitude);
    
    // Remove existing markers if they exist
    if (issMarker) {
        if (Array.isArray(issMarker)) {
            issMarker.forEach(marker => map.removeLayer(marker));
        } else {
            map.removeLayer(issMarker);
        }
    }

    // Create icon
    const issIcon = L.icon({
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
    const isCurrentLocation = parseInt(slider.value) === parseInt(slider.max);
    console.log('Slider value:', slider.value, 'Max:', slider.max, 'Is current:', isCurrentLocation);
    const popupPrefix = isCurrentLocation ? 'ISS Location' : 'Historical Location';

    // Add markers for all visible longitudes with extra buffer
    for (let currLon = baseLon; currLon <= east + 720; currLon += 360) {  // Add two world widths to the east
        const marker = L.marker([lat, currLon], { icon: issIcon }).addTo(map);
        if (location.location) {
            const flag = getCountryFlag(location.location, location.country_code);
            const flagText = flag ? ` ${flag}` : '';
            marker.bindPopup(`<b>${popupPrefix}:</b><br>${location.location}${flagText}`);
        }
        issMarker.push(marker);
    }

    // Find the closest marker to center for panning
    let targetLng = lon;
    while (targetLng < center.lng - 180) targetLng += 360;
    while (targetLng > center.lng + 180) targetLng -= 360;
    
    map.panTo([lat, targetLng]);
    
    // Open popup on the marker closest to center
    if (location.location && issMarker.length > 0) {
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
                issMarker.forEach(marker => map.removeLayer(marker));
            } else {
                map.removeLayer(issMarker);
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
        
        // Store the timestamp for comparison
        lastDataTimestamp = data.timestamp;
        
        const addResult = updateUI(data);
        
        // Update slider range and reset to most recent position
        historySlider.updateSliderRange();
        const slider = document.getElementById('history-slider');
        console.log('Resetting slider - Current max:', slider.max);
        historySlider.setSliderValue(slider.max, true); // Skip map update since map already shows current data
        
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
