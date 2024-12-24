import config from './config.js';

// Initialize map
let map = null;
let issMarker = null;
let isRefreshCooldown = false;
const COOLDOWN_DURATION = 15; // seconds

function initMap() {
    map = L.map('map', {
        center: [0, 0],
        zoom: 3,
        zoomControl: true,
        attributionControl: true
    });

    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
        maxZoom: 19
    }).addTo(map);

    // Initialize the ISS marker
    issMarker = L.marker([0, 0], {
        icon: L.icon({
            iconUrl: 'iss-icon.svg',
            iconSize: [32, 32],
            iconAnchor: [16, 16]
        })
    }).addTo(map);
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
function checkTimestampState(timestamp, isInitialLoad = false) {
    const timestampCard = document.getElementById('timestamp');
    const currentTime = new Date();
    const dataTime = new Date(timestamp);
    const timeDiff = currentTime - dataTime;
    const fiveMinutes = 5 * 60 * 1000;
    
    // Only show red on initial load if data is stale
    if (isInitialLoad && timeDiff > fiveMinutes) {
        timestampCard.classList.add('stale');
        timestampCard.classList.remove('refresh-ready');
    } 
    // After initial load, show blue exactly at 5 minutes
    else if (timeDiff >= fiveMinutes) {
        timestampCard.classList.add('refresh-ready');
        timestampCard.classList.remove('stale');
    } else {
        timestampCard.classList.remove('stale', 'refresh-ready');
    }
}

// Update the UI with ISS data
function updateUI(data, isInitialLoad = false) {
    const coordinates = document.getElementById('coordinates');
    const time = document.getElementById('time');
    const fact = document.getElementById('fact');
    
    if (data.latitude && data.longitude) {
        // Get flag emoji if location is over land
        const flag = data.location_details ? getCountryFlag(data.location_details) : '';
        
        // Update text displays with flag if available
        coordinates.textContent = `${formatCoordinates(parseFloat(data.latitude), parseFloat(data.longitude))}
            ${data.location_details ? `\n${data.location_details} ${flag}` : ''}`;
        
        // Update timestamp with warning message for stale data
        const timestampCard = document.getElementById('timestamp');
        if (!timestampCard.querySelector('.stale-warning')) {
            const warningDiv = document.createElement('div');
            warningDiv.className = 'stale-warning';
            warningDiv.textContent = 'Warning: Location data is outdated';
            timestampCard.appendChild(warningDiv);
        }
        time.textContent = formatTimestamp(data.timestamp);
        fact.innerHTML = `<b style="color: #4a9eff; font-size: 0.9em;">Powered by Gemini</b><br>${data.fun_fact || 'No fun fact available for this location.'}`;

        // Initial timestamp state check
        checkTimestampState(data.timestamp, isInitialLoad);
        
        // Set up continuous timestamp checking
        const timestampInterval = setInterval(() => {
            checkTimestampState(data.timestamp, false);
        }, 1000);
        
        // Store the interval ID to clear it on next update
        if (window.previousTimestampInterval) {
            clearInterval(window.previousTimestampInterval);
        }
        window.previousTimestampInterval = timestampInterval;

        // Update map marker and popup with flag
        if (data.location_details && issMarker) {
            issMarker.setLatLng([parseFloat(data.latitude), parseFloat(data.longitude)]);
            issMarker.bindPopup(`<b>Current ISS Location:</b><br>${data.location_details} ${flag}`).openPopup();
            map.panTo([parseFloat(data.latitude), parseFloat(data.longitude)]);
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
async function fetchISSData(isInitialLoad = false) {
    if (isRefreshCooldown && !isInitialLoad) return;
    
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
        
        // Check if data is stale on manual refresh
        if (!isInitialLoad) {
            const currentTime = new Date();
            const dataTime = new Date(data.timestamp);
            const timeDiff = currentTime - dataTime;
            
            if (timeDiff > 5 * 60 * 1000) {
                const timestampCard = document.getElementById('timestamp');
                timestampCard.classList.add('stale');
                timestampCard.classList.remove('refresh-ready');
            }
        }
        
        updateUI(data, isInitialLoad);
        // Hide any previous error messages
        document.getElementById('error').style.display = 'none';
        
        // Start cooldown after successful fetch
        if (!isRefreshCooldown && !isInitialLoad) {
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
    fetchISSData(true);  // true indicates initial load
    
    // Add refresh button handler
    const refreshButton = document.getElementById('refresh');
    refreshButton.addEventListener('click', () => fetchISSData(false));  // false indicates manual refresh
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
