import config from './config.js';
import LocationHistoryManager from './locationHistory.js';
import HistorySlider from './historySlider.js';

// Initialize map
let map = null;
let issMarkers = []; // Array to hold multiple ISS markers
let isRefreshCooldown = false;
const COOLDOWN_DURATION = 15; // seconds

// Initialize location history manager and slider
const locationHistory = new LocationHistoryManager();
let historySlider = null;

// Initialize the application
async function init() {
    initMap();
    await locationHistory.initializeHistory();
    historySlider = new HistorySlider(locationHistory, map, issMarkers);
    await fetchISSData();
    
    // Add refresh button handler
    const refreshButton = document.getElementById('refresh');
    refreshButton.addEventListener('click', fetchISSData);
}

function initMap() {
    // Initialize map with dark mode and world wrap
    map = L.map('map', {
        worldCopyJump: true,  // Makes panning across the dateline smoother
        maxBoundsViscosity: 1.0  // Ensures smooth scrolling at edges
    }).setView([0, 0], 2);

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
            if (issMarkers.length > 0) {
                map.panTo(issMarkers[1].getLatLng());
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

// Start cooldown timer
function startCooldown() {
    const refreshButton = document.getElementById('refresh');
    const countdownBar = document.getElementById('countdown-bar');
    const countdownText = document.getElementById('countdown-text');
    let timeLeft = COOLDOWN_DURATION;
    let startTime = Date.now();
    isRefreshCooldown = true;
    refreshButton.disabled = true;
    
    // Show countdown elements
    countdownText.style.display = 'block';
    
    // Start countdown animation
    countdownBar.style.transform = 'scaleX(1)';
    countdownBar.style.transition = `transform ${COOLDOWN_DURATION}s linear`;
    countdownBar.style.transform = 'scaleX(0)';
    
    // Update countdown text every 100ms for smooth decimal display
    const textTimer = setInterval(() => {
        const elapsed = (Date.now() - startTime) / 1000;
        const remaining = Math.max(COOLDOWN_DURATION - elapsed, 0);
        countdownText.textContent = `${remaining.toFixed(1)}s`;
    }, 100);
    
    // Main countdown timer
    const timer = setInterval(() => {
        timeLeft--;
        if (timeLeft <= 0) {
            clearInterval(timer);
            clearInterval(textTimer);
            isRefreshCooldown = false;
            refreshButton.disabled = false;
            countdownBar.style.transition = 'none';
            countdownBar.style.transform = 'scaleX(1)';
            // Hide countdown text instead of showing 0.0s
            countdownText.style.display = 'none';
        }
    }, 1000);
}

function createWrappedISSMarkers(lat, lon) {
    // Create a custom icon for the ISS using the SVG file
    const issIcon = L.icon({
        iconUrl: './assets/iss-icon.svg',
        iconSize: [32, 32],
        iconAnchor: [16, 16],
        popupAnchor: [0, -16]
    });

    // Remove existing markers
    issMarkers.forEach(marker => {
        if (marker) {
            map.removeLayer(marker);
        }
    });
    issMarkers = [];

    // Get the current map bounds
    const bounds = map.getBounds();
    const center = bounds.getCenter();

    // Calculate the base longitude relative to the center
    let baseLon = lon;
    while (baseLon < center.lng - 180) baseLon += 360;
    while (baseLon > center.lng + 180) baseLon -= 360;

    // Create markers with offsets relative to the adjusted base longitude
    [-1, 0, 1].forEach(offset => {
        const wrappedLon = baseLon + (offset * 360);
        const marker = L.marker([lat, wrappedLon], {
            icon: issIcon
        }).addTo(map);
        issMarkers.push(marker);
    });

    return issMarkers;
}

// Update the UI with ISS data
function updateUI(data) {
    const coordinates = document.getElementById('coordinates');
    const time = document.getElementById('time');
    const fact = document.getElementById('fact');
    
    if (data.latitude && data.longitude) {
        // Add the new location to history
        locationHistory.addLocation({
            timestamp: data.timestamp,
            latitude: data.latitude,
            longitude: data.longitude,
            location: data.location,
            country_code: data.country_code
        });

        // Update text displays
        coordinates.textContent = `${formatCoordinates(parseFloat(data.latitude), parseFloat(data.longitude))}
            ${data.location ? `\n${data.location}` : ''}`;
        time.textContent = formatTimestamp(data.timestamp);
        fact.textContent = data.fun_fact || 'No fun fact available for this location.';

        // Update map
        const lat = parseFloat(data.latitude);
        const lon = parseFloat(data.longitude);
        
        // Create wrapped ISS markers
        const markers = createWrappedISSMarkers(lat, lon);
        
        // Update the history slider with the new ISS markers
        if (historySlider) {
            historySlider.updateISSMarker(markers[1]); // Use the center marker (index 1) as the main marker
            historySlider.updateSliderRange();
        }
        
        // When centering on the ISS, ensure we use the closest instance of the marker
        const bounds = map.getBounds();
        const center = bounds.getCenter();
        let targetLng = lon;
        
        // Adjust longitude to use the closest wrapped position
        while (targetLng < center.lng - 180) targetLng += 360;
        while (targetLng > center.lng + 180) targetLng -= 360;
        
        map.panTo([lat, targetLng]);
        
        // Add popup with header and location name to all markers
        if (data.location) {
            const popupContent = `<b>Current ISS Location:</b><br>${data.location}`;
            markers.forEach(marker => {
                marker.bindPopup(popupContent);
            });
            // Open popup on the marker closest to the center
            const centerMarker = markers.find(m => {
                const mLng = m.getLatLng().lng;
                return Math.abs(mLng - center.lng) <= 180;
            }) || markers[1];
            centerMarker.openPopup();
        }
    } else {
        console.error('Unexpected data structure:', data);
        showError('Received invalid data structure from API');
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

// Fetch ISS data
async function fetchISSData() {
    if (isRefreshCooldown) return;
    
    const refreshButton = document.getElementById('refresh');
    refreshButton.disabled = true;
    
    try {
        console.log('Fetching data from:', config.API_URL);
        const response = await fetch(`${config.API_URL}?api_key=${config.API_KEY}`);
        console.log('Response status:', response.status);
        
        if (!response.ok) {
            const errorText = await response.text();
            console.error('API Error:', errorText);
            throw new Error(`API returned ${response.status}: ${errorText}`);
        }
        
        const data = await response.json();
        console.log('Received data:', data);
        updateUI(data);
        // Hide any previous error messages
        document.getElementById('error').style.display = 'none';
        
        // Start cooldown after successful fetch
        if (!isRefreshCooldown) {
            startCooldown();
        }
    } catch (error) {
        console.error('Error details:', error);
        showError(
            'Failed to fetch ISS data. Please try again later.',
            `Error: ${error.message}`
        );
        refreshButton.disabled = false;
    }
}

// Initialize the application when the page loads
window.addEventListener('load', init);
