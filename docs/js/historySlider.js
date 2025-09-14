class HistorySlider {
    constructor(locationHistory, updateMapCallback) {
        this.locationHistory = locationHistory;
        this.updateMapCallback = updateMapCallback;
        this.currentIndex = 0;
        this.isUpdating = false;
    }

    initialize() {
        const slider = document.getElementById('history-slider');
        const timeDisplay = document.getElementById('time-display');

        // Set max value based on available history
        this.updateSliderRange();

        // Set initial value to max (newest/current time)
        this.setSliderValue(slider.max);

        // Prevent scrolling when interacting with the slider
        slider.addEventListener('wheel', (e) => {
            e.preventDefault();
            // Optional: Manually handle the scroll to change slider value
            const delta = Math.sign(e.deltaY) * -1;
            const newValue = Math.min(Math.max(parseInt(slider.value) + delta, slider.min), slider.max);
            this.setSliderValue(newValue);
        }, { passive: false });

        // Update display when slider moves
        slider.addEventListener('input', () => {
            this.setSliderValue(parseInt(slider.value));
        });

        // Initial display
        this.updateDisplay();
    }

    setSliderValue(value, skipMapUpdate = false) {
        if (this.isUpdating) return;
        this.isUpdating = true;
        
        const slider = document.getElementById('history-slider');
        const maxValue = parseInt(slider.max);
        value = Math.min(Math.max(parseInt(value), 0), maxValue);
        
        console.log('Setting slider value:', value, 'Max:', maxValue, 'Skip map update:', skipMapUpdate);
        slider.value = value;
        this.currentIndex = this.getInvertedIndex(value);
        
        if (!skipMapUpdate) {
            this.updateDisplay();
        } else {
            // Just update the time display without updating the map
            const location = this.locationHistory.getLocationAt(this.currentIndex);
            if (location) {
                const timeDisplay = document.getElementById('time-display');
                const date = new Date(location.timestamp);
                timeDisplay.textContent = date.toLocaleString();
            }
        }
        
        this.isUpdating = false;
    }

    updateSliderRange() {
        const slider = document.getElementById('history-slider');
        const locations = this.locationHistory.getLocations();
        const oldMax = slider.max;
        slider.max = locations.length - 1;
        
        console.log('Updated slider range - Old max:', oldMax, 'New max:', slider.max, 'Locations count:', locations.length);
        
        // Only set the value if it's not already set or is invalid
        if (!slider.value || slider.value > slider.max) {
            slider.value = slider.max;
            this.currentIndex = 0;
        } else {
            this.currentIndex = this.getInvertedIndex(parseInt(slider.value));
        }
    }

    // Convert slider value to actual index (inverted)
    getInvertedIndex(sliderValue) {
        const locations = this.locationHistory.getLocations();
        return locations.length - 1 - sliderValue;
    }

    updateDisplay() {
        const location = this.locationHistory.getLocationAt(this.currentIndex);
        if (location) {
            const timeDisplay = document.getElementById('time-display');
            const date = new Date(location.timestamp);
            timeDisplay.textContent = date.toLocaleString();
            
            // Update map and info through callback
            this.updateMapCallback(location);
        }
    }

    // Get current slider position info for data management
    getCurrentSliderInfo() {
        const slider = document.getElementById('history-slider');
        const location = this.locationHistory.getLocationAt(this.currentIndex);
        const isAtOldest = parseInt(slider.value) === 0; // 0 is oldest position (leftmost), max is newest (rightmost)
        
        console.log('getCurrentSliderInfo - slider.value:', slider.value, 'slider.max:', slider.max, 'isAtOldest:', isAtOldest);
        console.log('Current location timestamp:', location ? location.timestamp : 'null');
        
        return {
            timestamp: location ? location.timestamp : null,
            isAtOldest: isAtOldest,
            currentIndex: this.currentIndex,
            sliderValue: parseInt(slider.value),
            sliderMax: parseInt(slider.max)
        };
    }

    // Find and set slider to a specific timestamp
    setSliderToTimestamp(targetTimestamp) {
        const locations = this.locationHistory.getLocations();
        const targetIndex = locations.findIndex(loc => 
            new Date(loc.timestamp).getTime() === new Date(targetTimestamp).getTime()
        );
        
        if (targetIndex !== -1) {
            const sliderValue = locations.length - 1 - targetIndex;
            this.setSliderValue(sliderValue);
            console.log('Set slider to timestamp:', targetTimestamp, 'at index:', targetIndex, 'slider value:', sliderValue);
            return true;
        }
        
        console.log('Could not find timestamp in history:', targetTimestamp);
        return false;
    }
}

export default HistorySlider;
