// Constants
const STORAGE_KEY = 'iss_location_history';
const MAX_ENTRIES = 288; // 24 hours worth of entries (1 entry every 5 minutes)
const PREDICTION_ENTRIES = 288; // 24 hours of predictions (1 entry every 5 minutes)

// Class to manage ISS location history
class LocationHistoryManager {
    constructor() {
        this.locations = this.loadFromStorage() || [];
        this.predictions = []; // Future predictions (now from API)
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

    // Set predictions from API data
    setPredictionsFromAPI(predictionsData) {
        if (!predictionsData) {
            this.predictions = [];
            return;
        }
        
        // Combine orbital mechanics and SGP4 predictions
        const allPredictions = [];
        
        // Add orbital mechanics predictions (18 predictions)
        if (predictionsData.orbital_mechanics && Array.isArray(predictionsData.orbital_mechanics)) {
            predictionsData.orbital_mechanics.forEach(pred => {
                allPredictions.push({
                    timestamp: pred.timestamp,
                    latitude: pred.latitude.toString(),
                    longitude: pred.longitude.toString(),
                    isPredicted: true,
                    method: pred.method || 'orbital_mechanics',
                    minutes_ahead: pred.minutes_ahead
                });
            });
        }
        
        // Add SGP4 predictions if available (can be multiple from different prediction cycles)
        if (predictionsData.sgp4) {
            // Handle both array and single object formats
            const sgp4Predictions = Array.isArray(predictionsData.sgp4) 
                ? predictionsData.sgp4 
                : [predictionsData.sgp4];
            
            sgp4Predictions.forEach(pred => {
                allPredictions.push({
                    timestamp: pred.timestamp,
                    latitude: pred.latitude.toString(),
                    longitude: pred.longitude.toString(),
                    isPredicted: true,
                    method: 'sgp4',
                    minutes_ahead: pred.minutes_ahead
                });
            });
        }
        
        // Sort by timestamp (earliest first)
        allPredictions.sort((a, b) => {
            return new Date(a.timestamp) - new Date(b.timestamp);
        });
        
        this.predictions = allPredictions;
        const sgp4Count = Array.isArray(predictionsData.sgp4) 
            ? predictionsData.sgp4.length 
            : (predictionsData.sgp4 ? 1 : 0);
        console.log('Set', this.predictions.length, 'predictions from API (', 
            predictionsData.orbital_mechanics?.length || 0, 'orbital mechanics +', 
            sgp4Count, 'SGP4)');
        
        // Log prediction distribution by timestamp for debugging
        const timestampGroups = {};
        allPredictions.forEach(pred => {
            const ts = pred.timestamp;
            if (!timestampGroups[ts]) {
                timestampGroups[ts] = [];
            }
            timestampGroups[ts].push(pred.method);
        });
        console.log('Prediction distribution by timestamp:', Object.keys(timestampGroups).length, 'unique timestamps');
        Object.entries(timestampGroups).forEach(([ts, methods]) => {
            if (methods.length > 1) {
                console.log(`  ${ts}: ${methods.length} predictions (${methods.join(', ')})`);
            }
        });
    }

    // Get all stored locations
    getLocations() {
        return this.locations;
    }

    // Get filled history count (always 288 for 24 hours with 5-minute intervals)
    getFilledHistoryCount() {
        const filledHistory = this.fillGapsInHistory();
        return filledHistory.length;
    }

    // Get all predictions
    getPredictions() {
        return this.predictions;
    }

    // Fill gaps in history with placeholder entries for missing time slots
    fillGapsInHistory() {
        if (this.locations.length === 0) {
            return [];
        }
        
        // Get the newest location timestamp (first in array since sorted newest first)
        const newestLocation = this.locations[0];
        if (!newestLocation || !newestLocation.timestamp) {
            return [...this.locations].reverse();
        }
        
        const newestTime = new Date(newestLocation.timestamp);
        // Round newest time to nearest 5 minutes
        const newestMinutes = Math.round(newestTime.getMinutes() / 5) * 5;
        const roundedNewestTime = new Date(newestTime);
        roundedNewestTime.setMinutes(newestMinutes);
        roundedNewestTime.setSeconds(0);
        roundedNewestTime.setMilliseconds(0);
        
        // Calculate oldest time (24 hours before newest, rounded to 5-minute interval)
        const oldestTime = new Date(roundedNewestTime.getTime() - (24 * 60 * 60 * 1000));
        const oldestMinutes = Math.round(oldestTime.getMinutes() / 5) * 5;
        const roundedOldestTime = new Date(oldestTime);
        roundedOldestTime.setMinutes(oldestMinutes);
        roundedOldestTime.setSeconds(0);
        roundedOldestTime.setMilliseconds(0);
        
        // Create a map of existing locations by rounded timestamp (5-minute intervals)
        const locationMap = new Map();
        this.locations.forEach(loc => {
            const locTime = new Date(loc.timestamp);
            // Round to nearest 5 minutes
            const roundedMinutes = Math.round(locTime.getMinutes() / 5) * 5;
            const roundedTime = new Date(locTime);
            roundedTime.setMinutes(roundedMinutes);
            roundedTime.setSeconds(0);
            roundedTime.setMilliseconds(0);
            const key = roundedTime.getTime();
            locationMap.set(key, loc);
        });
        
        // Generate filled array with placeholders for missing slots
        const filledHistory = [];
        const fiveMinutes = 5 * 60 * 1000; // 5 minutes in milliseconds
        
        // Start from oldest time and go forward to newest time (inclusive)
        for (let time = roundedOldestTime.getTime(); time <= roundedNewestTime.getTime(); time += fiveMinutes) {
            const roundedTime = new Date(time);
            const key = roundedTime.getTime();
            
            if (locationMap.has(key)) {
                // Use existing location
                filledHistory.push(locationMap.get(key));
            } else {
                // Create placeholder entry
                filledHistory.push({
                    timestamp: roundedTime.toISOString(),
                    isEmpty: true,
                    latitude: null,
                    longitude: null,
                    location: null
                });
            }
        }
        
        // Return oldest first (for consistency with previous behavior)
        return filledHistory;
    }

    // Get combined history and predictions for the full 48-hour range
    getAllLocations() {
        // Get filled history with placeholders (oldest first)
        const filledHistory = this.fillGapsInHistory();
        
        // Ensure predictions are sorted by timestamp (earliest first)
        const sortedPredictions = [...this.predictions].sort((a, b) => {
            return new Date(a.timestamp) - new Date(b.timestamp);
        });
        
        const allLocations = [...filledHistory, ...sortedPredictions];
        
        console.log('getAllLocations - Filled history count:', filledHistory.length, 'Predictions count:', sortedPredictions.length, 'Total:', allLocations.length);
        if (sortedPredictions.length > 0) {
            console.log('First prediction:', sortedPredictions[0].timestamp, 'Last prediction:', sortedPredictions[sortedPredictions.length - 1].timestamp);
        }
        
        return allLocations;
    }

    // Get location at specific index (from combined history + predictions)
    getLocationAt(index) {
        const allLocations = this.getAllLocations();
        const historyCount = this.locations.length;
        const location = allLocations[index];
        
        if (index >= historyCount && location) {
            console.log('Accessing prediction at index', index, 'timestamp:', location.timestamp, 'isPredicted:', location.isPredicted);
        }
        
        return location;
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
