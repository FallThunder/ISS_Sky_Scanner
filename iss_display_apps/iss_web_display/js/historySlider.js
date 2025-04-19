class HistorySlider {
    constructor(locationHistory, map, issMarker) {
        this.locationHistory = locationHistory;
        this.map = map;
        this.issMarker = issMarker;
        this.slider = document.getElementById('history-slider');
        this.timestampDisplay = document.getElementById('slider-timestamp');
        this.historyMarkers = []; // Array to hold multiple wrapped markers
        this.initializeSlider();
    }

    initializeSlider() {
        this.slider.addEventListener('input', () => this.handleSliderChange());
        this.slider.addEventListener('change', () => this.handleSliderChange());
    }

    createWrappedMarkers(lat, lon) {
        const historyIcon = L.divIcon({
            className: 'history-marker',
            html: '<div class="marker-dot"></div>',
            iconSize: [12, 12],
            iconAnchor: [6, 6]
        });

        // Clear existing history markers
        this.clearHistoryMarkers();

        // Get the current map bounds
        const bounds = this.map.getBounds();
        const center = bounds.getCenter();

        // Calculate the base longitude relative to the center
        let baseLon = lon;
        while (baseLon < center.lng - 180) baseLon += 360;
        while (baseLon > center.lng + 180) baseLon -= 360;

        // Create markers with offsets relative to the adjusted base longitude
        const markers = [];
        [-1, 0, 1].forEach(offset => {
            const wrappedLon = baseLon + (offset * 360);
            const wrappedMarker = L.marker([lat, wrappedLon], {
                icon: historyIcon
            }).addTo(this.map);
            markers.push(wrappedMarker);
        });

        return markers;
    }

    handleSliderChange() {
        const index = this.slider.max - this.slider.value;
        const location = this.locationHistory.getLocationAt(index);
        
        if (location) {
            // Update timestamp display
            const timestamp = new Date(location.timestamp);
            const localTimeStr = timestamp.toLocaleString('en-US', {
                year: 'numeric',
                month: 'numeric',
                day: 'numeric',
                hour: 'numeric',
                minute: '2-digit',
                second: '2-digit',
                hour12: true,
                timeZoneName: 'short'
            });

            const utcStr = timestamp.toLocaleString('en-US', {
                year: 'numeric',
                month: 'numeric',
                day: 'numeric',
                hour: 'numeric',
                minute: '2-digit',
                second: '2-digit',
                hour12: true,
                timeZone: 'UTC'
            }) + ' UTC';

            this.timestampDisplay.textContent = `${localTimeStr}\n${utcStr}`;

            // Update marker position
            const lat = parseFloat(location.latitude);
            const lon = parseFloat(location.longitude);

            // Create popup content with location and country info
            const locationInfo = location.location ? `<br>Location: ${location.location}` : '';
            const countryInfo = location.country_code ? 
                `<br>Country: ${location.country_code} ${location.country_code !== 'N/A' ? 
                    `<img src="https://flagcdn.com/16x12/${location.country_code.toLowerCase()}.png" 
                    style="margin-left: 5px; vertical-align: middle;" 
                    alt="${location.country_code}" />` : 
                    ''}` : 
                '';

            const popupContent = `
                <strong>Historical Position</strong><br>
                Time: ${timestamp.toLocaleString()}<br>
                Coordinates: ${this.formatCoordinates(lat, lon)}
                ${locationInfo}
                ${countryInfo}
            `;

            if (index === 0) {
                // At current position, show ISS marker and hide history markers
                this.clearHistoryMarkers();
                if (this.issMarker) {
                    this.issMarker.addTo(this.map);
                }
            } else {
                // At historical position, show wrapped history markers and hide ISS marker
                if (this.issMarker) {
                    this.issMarker.remove();
                }
                
                // Create wrapped markers for the historical position
                this.historyMarkers = this.createWrappedMarkers(lat, lon);
                
                // Add popup to all wrapped markers
                this.historyMarkers.forEach(marker => {
                    marker.bindPopup(popupContent);
                });
            }
        }
    }

    formatCoordinates(lat, lon) {
        const latDir = lat >= 0 ? 'N' : 'S';
        const lonDir = lon >= 0 ? 'E' : 'W';
        return `${Math.abs(lat).toFixed(4)}° ${latDir}, ${Math.abs(lon).toFixed(4)}° ${lonDir}`;
    }

    updateSliderRange() {
        const totalLocations = this.locationHistory.getLocations().length;
        this.slider.max = totalLocations - 1;
        this.slider.value = this.slider.max; // Set to most recent position
        
        // Ensure we're showing the current ISS marker
        this.clearHistoryMarkers();
        if (this.issMarker) {
            this.issMarker.addTo(this.map);
        }
    }

    updateISSMarker(marker) {
        this.issMarker = marker;
    }

    clearHistoryMarkers() {
        this.historyMarkers.forEach(marker => {
            if (marker) {
                this.map.removeLayer(marker);
            }
        });
        this.historyMarkers = [];
    }
}

export default HistorySlider;
