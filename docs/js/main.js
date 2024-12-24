import config from './config.js';

// Initialize map
let map = null;
let issMarker = null;
let isRefreshCooldown = false;
const COOLDOWN_DURATION = 15; // seconds

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
    return new Date(timestamp).toLocaleString();
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

// Check timestamp and update UI state
function checkTimestampState(timestamp) {
    const timestampCard = document.getElementById('timestamp');
    const currentTime = new Date();
    const dataTime = new Date(timestamp);
    const timeDiff = currentTime - dataTime;
    
    // If data is more than 5 minutes old
    if (timeDiff > 5 * 60 * 1000) {
        timestampCard.classList.add('stale');
        timestampCard.classList.remove('refresh-ready');
    } else {
        timestampCard.classList.remove('stale', 'refresh-ready');
    }
    
    // Set timer to check for refresh-ready state
    const timeUntilRefresh = 5 * 60 * 1000 - timeDiff;
    if (timeUntilRefresh > 0) {
        setTimeout(() => {
            timestampCard.classList.add('refresh-ready');
            timestampCard.classList.remove('stale');
        }, timeUntilRefresh);
    }
}

// Update the UI with ISS data
function updateUI(data) {
    const coordinates = document.getElementById('coordinates');
    const time = document.getElementById('time');
    const fact = document.getElementById('fact');
    
    if (data.latitude && data.longitude) {
        // Get flag emoji if location is over land
        const flag = data.location_details ? getCountryFlag(data.location_details) : '';
        
        // Update text displays with flag if available
        coordinates.textContent = `${formatCoordinates(parseFloat(data.latitude), parseFloat(data.longitude))}
            ${data.location_details ? `\n${data.location_details} ${flag}` : ''}`;
        time.textContent = formatTimestamp(data.timestamp);
        fact.textContent = data.fun_fact || 'No fun fact available for this location.';

        // Check timestamp state
        checkTimestampState(data.timestamp);

        // Update map marker and popup with flag
        if (data.location_details) {
            issMarker.bindPopup(`<b>Current ISS Location:</b><br>${data.location_details} ${flag}`).openPopup();
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

// Initialize map and fetch data
document.addEventListener('DOMContentLoaded', () => {
    initMap();
    fetchISSData();
    
    // Add refresh button handler
    const refreshButton = document.getElementById('refresh');
    refreshButton.addEventListener('click', fetchISSData);
});

// Convert country name to flag emoji
function getCountryFlag(location) {
    try {
        // Extract country name from location string
        const locationParts = location.replace('Over the ', '').split(/,|\snear\s/);
        const countryName = locationParts[0].trim();
        
        // Skip if it's an ocean or sea
        if (countryName.includes('Ocean') || countryName.includes('Sea')) {
            return '';
        }
        
        // Try to find the country code
        const country = CountryList.search(countryName);
        if (country && country.code) {
            // Convert country code to flag emoji (using regional indicator symbols)
            const codePoints = Array.from(country.code)
                .map(char => 127397 + char.charCodeAt());
            return String.fromCodePoint(...codePoints);
        }
        
        // If first part didn't work, try the second part (for "near" cases)
        if (locationParts.length > 1) {
            const nearCountry = CountryList.search(locationParts[1].trim());
            if (nearCountry && nearCountry.code) {
                const codePoints = Array.from(nearCountry.code)
                    .map(char => 127397 + char.charCodeAt());
                return String.fromCodePoint(...codePoints);
            }
        }
    } catch (e) {
        console.warn('Error getting country flag:', e);
    }
    return ''; // Return empty string if no match found or error occurred
}
