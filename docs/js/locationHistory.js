// Constants
const STORAGE_KEY = 'iss_location_history';
const MAX_ENTRIES = 288; // 24 hours worth of entries (1 entry every 5 minutes)
const PREDICTION_ENTRIES = 288; // 24 hours of predictions (1 entry every 5 minutes)

// Class to manage ISS location history
class LocationHistoryManager {
    constructor() {
        this.locations = this.loadFromStorage() || [];
        this.predictions = []; // Future predictions
        this.predictor = null; // Will be set when ISSPredictor is imported
    }

    // Load history from session storage
    loadFromStorage() {
        const stored = sessionStorage.getItem(STORAGE_KEY);
        return stored ? JSON.parse(stored) : null;
    }

    // Save history to session storage
    saveToStorage() {
        sessionStorage.setItem(STORAGE_KEY, JSON.stringify(this.locations));
    }

    // Initialize with 24 hours of history
    async initializeHistory() {
        if (this.locations.length === 0) {
            try {
                const response = await fetch('https://us-east1-iss-sky-scanner-20241222.cloudfunctions.net/iss_api_query_time_range?minutes=1440');
                if (!response.ok) {
                    throw new Error(`HTTP error! status: ${response.status}`);
                }
                const data = await response.json();
                
                if (!data.locations || !Array.isArray(data.locations)) {
                    throw new Error('Invalid data format from API');
                }
                
                // Sort locations by timestamp to ensure correct order (newest first)
                this.locations = this.sortLocations(data.locations);
                
                // Trim to exactly 24 hours if we have more data
                if (this.locations.length > MAX_ENTRIES) {
                    this.locations = this.locations.slice(0, MAX_ENTRIES);
                }
                
                console.log('Initialized with', this.locations.length, 'locations');
                console.log('Newest:', this.locations[0]?.timestamp);
                console.log('Oldest:', this.locations[this.locations.length - 1]?.timestamp);
                
                this.saveToStorage();
                return true;
            } catch (error) {
                return false;
            }
        }
        return true;
    }

    // Sort locations by timestamp (newest first)
    sortLocations(locations) {
        return locations.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
    }

    // Add a new location and remove the oldest if we exceed MAX_ENTRIES
    addLocation(location, sliderCallback = null) {
        // Get current slider position info before making changes
        let currentTimestamp = null;
        let wasAtOldestPosition = false;
        
        if (sliderCallback) {
            const sliderInfo = sliderCallback();
            if (sliderInfo) {
                currentTimestamp = sliderInfo.timestamp;
                wasAtOldestPosition = sliderInfo.isAtOldest;
            }
        }

        // Check if we already have this timestamp
        const existingIndex = this.locations.findIndex(loc => 
            new Date(loc.timestamp).getTime() === new Date(location.timestamp).getTime()
        );

        if (existingIndex !== -1) {
            // Update existing location
            this.locations[existingIndex] = location;
        } else {
            // Add new location
            this.locations.push(location);
            // Re-sort to ensure newest first
            this.locations = this.sortLocations(this.locations);
        }
        
        // Clean up old entries based on time (24 hours ago)
        this.cleanupOldEntries(location.timestamp);
        
        this.saveToStorage();
        
        // Return info for slider positioning
        return {
            currentTimestamp,
            wasAtOldestPosition,
            newLocationsCount: this.locations.length
        };
    }

    // Set the predictor instance
    setPredictor(predictor) {
        this.predictor = predictor;
    }

    // Generate predictions based on current location
    generatePredictions(currentLocation) {
        if (!this.predictor || !currentLocation) {
            return [];
        }

        try {
            // Get recent history for velocity estimation (last 2-3 points)
            const recentHistory = this.locations.slice(0, Math.min(3, this.locations.length));
            
            // Generate predictions for the next 24 hours (every 5 minutes)
            this.predictions = this.predictor.generatePredictionPath(
                currentLocation, 
                5, // Start 5 minutes from now
                1440, // End 24 hours from now
                5, // Every 5 minutes
                recentHistory // Pass recent history for velocity estimation
            );
            
            console.log('Generated', this.predictions.length, 'predictions with velocity estimation');
            return this.predictions;
        } catch (error) {
            console.error('Error generating predictions:', error);
            return [];
        }
    }

    // Get all stored locations
    getLocations() {
        return this.locations;
    }

    // Get all predictions
    getPredictions() {
        return this.predictions;
    }

    // Get combined history and predictions for the full 48-hour range
    getAllLocations() {
        // Combine historical data (oldest first) with predictions (oldest first)
        // So: [oldest_history, ..., newest_history, earliest_prediction, ..., latest_prediction]
        const reversedHistory = [...this.locations].reverse(); // Reverse to get oldest first
        const allLocations = [...reversedHistory, ...this.predictions];
        return allLocations;
    }

    // Get location at specific index (from combined history + predictions)
    getLocationAt(index) {
        const allLocations = this.getAllLocations();
        return allLocations[index];
    }

    // Get location at specific index from history only
    getHistoryLocationAt(index) {
        return this.locations[index];
    }

    // Get prediction at specific index
    getPredictionAt(index) {
        return this.predictions[index];
    }

    // Clean up entries older than 24 hours
    cleanupOldEntries(currentTimestamp) {
        const currentTime = new Date(currentTimestamp);
        const cutoffTime = new Date(currentTime.getTime() - (24 * 60 * 60 * 1000)); // 24 hours ago
        
        // Filter out entries older than 24 hours
        const originalLength = this.locations.length;
        this.locations = this.locations.filter(loc => {
            const locTime = new Date(loc.timestamp);
            return locTime >= cutoffTime;
        });
        
        const removedCount = originalLength - this.locations.length;
        if (removedCount > 0) {
            console.log(`Cleaned up ${removedCount} old entries (older than 24 hours)`);
        }
    }

    // Clear all stored locations
    clear() {
        this.locations = [];
        sessionStorage.removeItem(STORAGE_KEY);
    }
}

export default LocationHistoryManager; 
