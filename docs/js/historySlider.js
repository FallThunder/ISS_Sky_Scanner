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

        // Don't call updateDisplay() during initialization - wait for current ISS location to be loaded
        // The map will be updated after fetchISSData() completes in main.js
        
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
                const filledHistoryCount = this.locationHistory.getFilledHistoryCount();
                this.setSliderValue(filledHistoryCount - 1); // Current time position
            });
        }

        // +90m button (latest prediction)
        const nav90mFuture = document.getElementById('nav-90m-future');
        if (nav90mFuture) {
            nav90mFuture.addEventListener('click', () => {
                const allLocations = this.locationHistory.getAllLocations();
                this.setSliderValue(allLocations.length - 1); // Latest prediction (90 minutes ahead)
            });
        }

        // Step navigation buttons (single step = 5 minutes)
        const navStepBack = document.getElementById('nav-step-back');
        if (navStepBack) {
            navStepBack.addEventListener('click', () => {
                this.navigateBySteps(-1);
            });
        }

        const navStepForward = document.getElementById('nav-step-forward');
        if (navStepForward) {
            navStepForward.addEventListener('click', () => {
                this.navigateBySteps(1);
            });
        }

        // Time skip buttons
        const navBack15min = document.getElementById('nav-back-15min');
        if (navBack15min) {
            navBack15min.addEventListener('click', () => {
                this.navigateBySteps(-3); // 15 minutes = 3 steps
            });
        }

        const navBack30min = document.getElementById('nav-back-30min');
        if (navBack30min) {
            navBack30min.addEventListener('click', () => {
                this.navigateBySteps(-6); // 30 minutes = 6 steps
            });
        }

        const navBack1h = document.getElementById('nav-back-1h');
        if (navBack1h) {
            navBack1h.addEventListener('click', () => {
                this.navigateBySteps(-12); // 1 hour = 12 steps
            });
        }

        const navForward15min = document.getElementById('nav-forward-15min');
        if (navForward15min) {
            navForward15min.addEventListener('click', () => {
                this.navigateBySteps(3); // 15 minutes = 3 steps
            });
        }

        const navForward30min = document.getElementById('nav-forward-30min');
        if (navForward30min) {
            navForward30min.addEventListener('click', () => {
                this.navigateBySteps(6); // 30 minutes = 6 steps
            });
        }

        const navForward1h = document.getElementById('nav-forward-1h');
        if (navForward1h) {
            navForward1h.addEventListener('click', () => {
                this.navigateBySteps(12); // 1 hour = 12 steps
            });
        }

        // Update button states when slider changes
        const slider = document.getElementById('history-slider');
        if (slider) {
            slider.addEventListener('input', () => {
                this.updateNavigationButtonStates();
            });
        }
    }

    navigateBySteps(steps) {
        const slider = document.getElementById('history-slider');
        if (!slider) return;

        const currentValue = parseInt(slider.value);
        const maxValue = parseInt(slider.max);
        const newValue = Math.min(Math.max(currentValue + steps, 0), maxValue);
        
        this.setSliderValue(newValue);
    }

    updateNavigationButtonStates() {
        const slider = document.getElementById('history-slider');
        if (!slider) return;

        const currentValue = parseInt(slider.value);
        const maxValue = parseInt(slider.max);

        // Disable back buttons if at the beginning
        const backButtons = [
            'nav-step-back',
            'nav-back-15min',
            'nav-back-30min',
            'nav-back-1h'
        ];
        backButtons.forEach(id => {
            const button = document.getElementById(id);
            if (button) {
                button.disabled = currentValue <= 0;
            }
        });

        // Disable forward buttons if at the end
        const forwardButtons = [
            'nav-step-forward',
            'nav-forward-15min',
            'nav-forward-30min',
            'nav-forward-1h'
        ];
        forwardButtons.forEach(id => {
            const button = document.getElementById(id);
            if (button) {
                button.disabled = currentValue >= maxValue;
            }
        });
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
        
        // Update navigation button states
        this.updateNavigationButtonStates();
        
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
        // Get filled history count (should be 288 entries for 24 hours)
        const filledHistoryCount = this.locationHistory.getFilledHistoryCount();
        const predictionsCount = this.locationHistory.getPredictions().length;
        const oldMax = parseInt(slider.max) || 0;
        const newMax = allLocations.length - 1;
        
        slider.max = newMax;
        
        console.log('Updated slider range - Old max:', oldMax, 'New max:', newMax, 'Total locations count:', allLocations.length, 'Filled history count:', filledHistoryCount, 'Predictions count:', predictionsCount);
        console.log('Slider range: 0 to', newMax, '(Current time at position', filledHistoryCount - 1, ')');
        
        // Verify predictions are accessible
        if (predictionsCount > 0 && allLocations.length > filledHistoryCount) {
            const firstPredictionIndex = filledHistoryCount;
            const firstPrediction = allLocations[firstPredictionIndex];
            console.log('First prediction accessible at index', firstPredictionIndex, 'timestamp:', firstPrediction ? firstPrediction.timestamp : 'null');
        }
        
        // Only set the value if it's not already set or is invalid
        if (!slider.value || slider.value === '' || parseInt(slider.value) > newMax) {
            // Only set a value if we have predictions (full 48-hour range)
            // If no predictions yet, leave slider unpositioned until predictions are generated
            if (predictionsCount > 0 && filledHistoryCount > 0) {
                // Set to current time position (last history entry before predictions)
                slider.value = filledHistoryCount - 1;
                this.currentIndex = this.getInvertedIndex(parseInt(slider.value));
                console.log('Set slider to current time position:', filledHistoryCount - 1);
            } else {
                // No predictions yet, don't set a value
                this.currentIndex = 0;
                console.log('No predictions yet, slider not positioned');
            }
        } else {
            // Slider already has a valid value, just update the index
            this.currentIndex = this.getInvertedIndex(parseInt(slider.value));
            console.log('Slider already positioned at:', slider.value, 'index:', this.currentIndex);
        }
        
        // Update navigation button states after range update
        this.updateNavigationButtonStates();
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
        console.log('updateDisplay - currentIndex:', this.currentIndex, 'location:', location ? 'found' : 'not found');
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
            console.log('updateDisplay - Updated time display to:', displayText);
            
            // Update "Now" indicator
            this.updateNowIndicator();
            
            // Always call updateMapCallback - it will handle placeholder entries
            this.updateMapCallback(location);
        } else {
            console.warn('updateDisplay - No location found at index:', this.currentIndex);
        }
    }

    updateNowIndicator() {
        const slider = document.getElementById('history-slider');
        const filledHistoryCount = this.locationHistory.getFilledHistoryCount();
        const nowMarker = document.querySelector('.range-marker.center');
        
        if (nowMarker) {
            const isAtCurrentTime = parseInt(slider.value) === filledHistoryCount - 1;
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
