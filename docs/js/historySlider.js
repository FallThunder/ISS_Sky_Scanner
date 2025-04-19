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

    setSliderValue(value) {
        if (this.isUpdating) return;
        this.isUpdating = true;
        
        const slider = document.getElementById('history-slider');
        const maxValue = parseInt(slider.max);
        value = Math.min(Math.max(parseInt(value), 0), maxValue);
        
        console.log('Setting slider value:', value, 'Max:', maxValue);
        slider.value = value;
        this.currentIndex = this.getInvertedIndex(value);
        this.updateDisplay();
        
        this.isUpdating = false;
    }

    updateSliderRange() {
        const slider = document.getElementById('history-slider');
        const locations = this.locationHistory.getLocations();
        slider.max = locations.length - 1;
        
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
}

export default HistorySlider;
