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

        // Set max value based on available history and predictions
        this.updateSliderRange();
        
        // Don't set initial value here - wait for predictions to be generated
        // The slider will be positioned in updateUI() after predictions are available
        // Loading animation will be shown until then

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
        
        // Add click handlers for navigation buttons
        this.initializeNavigationButtons();
    }

    initializeNavigationButtons() {
        // -24h button
        const nav24hAgo = document.getElementById('nav-24h-ago');
        if (nav24hAgo) {
            nav24hAgo.addEventListener('click', () => {
                this.setSliderValue(0); // Oldest position
            });
        }

        // Now button
        const navNow = document.getElementById('nav-now');
        if (navNow) {
            navNow.addEventListener('click', () => {
                const historyCount = this.locationHistory.getLocations().length;
                this.setSliderValue(historyCount - 1); // Current time position
            });
        }

        // +24h button
        const nav24hFuture = document.getElementById('nav-24h-future');
        if (nav24hFuture) {
            nav24hFuture.addEventListener('click', () => {
                const allLocations = this.locationHistory.getAllLocations();
                this.setSliderValue(allLocations.length - 1); // Latest prediction
            });
        }
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
            // Still update the "Now" indicator
            this.updateNowIndicator();
        }
        
        this.isUpdating = false;
    }

    updateSliderRange() {
        const slider = document.getElementById('history-slider');
        const allLocations = this.locationHistory.getAllLocations();
        const historyCount = this.locationHistory.getLocations().length;
        const oldMax = slider.max;
        slider.max = allLocations.length - 1;
        
        console.log('Updated slider range - Old max:', oldMax, 'New max:', slider.max, 'Total locations count:', allLocations.length, 'History count:', historyCount);
        console.log('Slider range: 0 to', slider.max, '(Current time at position', historyCount - 1, ')');
        
        // Only set the value if it's not already set or is invalid
        if (!slider.value || slider.value > slider.max) {
            // Only set a value if we have predictions (full 48-hour range)
            // If no predictions yet, leave slider unpositioned until predictions are generated
            if (this.locationHistory.getPredictions().length > 0) {
                // Set to current time position (middle of full range)
                slider.value = historyCount - 1;
                this.currentIndex = this.getInvertedIndex(parseInt(slider.value));
            } else {
                // No predictions yet, don't set a value
                this.currentIndex = 0;
            }
        } else {
            this.currentIndex = this.getInvertedIndex(parseInt(slider.value));
        }
    }

    // Convert slider value to actual index
    // Slider: 0 (oldest history) -> max (latest prediction)
    // Array: 0 (oldest history) -> max (latest prediction)
    // No inversion needed now!
    getInvertedIndex(sliderValue) {
        return parseInt(sliderValue);
    }

    // Check if the slider has been positioned yet
    isPositioned() {
        const slider = document.getElementById('history-slider');
        return slider.value !== '' && slider.value !== null && slider.value !== undefined;
    }

    updateDisplay() {
        const location = this.locationHistory.getLocationAt(this.currentIndex);
        if (location) {
            const timeDisplay = document.getElementById('time-display');
            const date = new Date(location.timestamp);
            
            // Add prediction indicator if this is a predicted location
            let displayText = date.toLocaleString();
            if (location.isPredicted) {
                displayText += ' (Predicted)';
                if (location.confidence) {
                    displayText += ` - ${Math.round(location.confidence * 100)}% confidence`;
                }
            }
            
            timeDisplay.textContent = displayText;
            
            // Update "Now" indicator
            this.updateNowIndicator();
            
            // Update map and info through callback
            this.updateMapCallback(location);
        }
    }

    updateNowIndicator() {
        const slider = document.getElementById('history-slider');
        const historyCount = this.locationHistory.getLocations().length;
        const nowMarker = document.querySelector('.range-marker.center');
        
        if (nowMarker) {
            const isAtCurrentTime = parseInt(slider.value) === historyCount - 1;
            if (isAtCurrentTime) {
                nowMarker.classList.add('highlighted');
            } else {
                nowMarker.classList.remove('highlighted');
            }
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
        const allLocations = this.locationHistory.getAllLocations();
        const targetIndex = allLocations.findIndex(loc => 
            new Date(loc.timestamp).getTime() === new Date(targetTimestamp).getTime()
        );
        
        if (targetIndex !== -1) {
            const sliderValue = allLocations.length - 1 - targetIndex;
            this.setSliderValue(sliderValue);
            console.log('Set slider to timestamp:', targetTimestamp, 'at index:', targetIndex, 'slider value:', sliderValue);
            return true;
        }
        
        console.log('Could not find timestamp in history:', targetTimestamp);
        return false;
    }
}

export default HistorySlider;
