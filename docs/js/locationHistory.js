// Constants
const STORAGE_KEY = 'iss_location_history';
const MAX_ENTRIES = 288; // 24 hours worth of entries (1 entry every 5 minutes)
const PREDICTION_ENTRIES = 288; // 24 hours of predictions (1 entry every 5 minutes)

// Class to manage ISS location history
class LocationHistoryManager {
    constructor() {
        this.locations = this.loadFromStorage() || [];
        this.predictions = []; // Future predictions (now from API) - flat array for backward compatibility
        this.predictionsBySource = {}; // Predictions grouped by source_timestamp
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

    // Round timestamp to nearest 5-minute interval (ignoring seconds)
    // Uses UTC methods to ensure consistency with Firestore timestamps
    roundTimestampTo5Minutes(isoTimestamp) {
        const dt = new Date(isoTimestamp);
        const minutes = dt.getUTCMinutes();
        const roundedMinutes = Math.floor(minutes / 5) * 5;
        const rounded = new Date(dt);
        rounded.setUTCMinutes(roundedMinutes);
        rounded.setUTCSeconds(0);
        rounded.setUTCMilliseconds(0);
        return rounded.toISOString();
    }

    // Set predictions from API data, grouped by source timestamp (rounded to 5 minutes)
    setPredictionsFromAPI(predictionsData) {
        if (!predictionsData) {
            this.predictions = [];
            this.predictionsBySource = {};
            return;
        }

        // Group predictions by source_timestamp (rounded to 5-minute intervals)
        const predictionsBySource = {};
        
        // Add orbital mechanics predictions
        console.log('setPredictionsFromAPI: orbital_mechanics type:', typeof predictionsData.orbital_mechanics, 'isArray:', Array.isArray(predictionsData.orbital_mechanics));
        console.log('setPredictionsFromAPI: orbital_mechanics length:', predictionsData.orbital_mechanics?.length || 0);
        if (predictionsData.orbital_mechanics && Array.isArray(predictionsData.orbital_mechanics)) {
            predictionsData.orbital_mechanics.forEach(pred => {
                const rawSourceTs = pred.source_timestamp || pred.timestamp;
                // Round source timestamp to 5-minute interval to group predictions correctly
                const sourceTs = this.roundTimestampTo5Minutes(rawSourceTs);
                
                if (!predictionsBySource[sourceTs]) {
                    predictionsBySource[sourceTs] = [];
                }
                predictionsBySource[sourceTs].push({
                    timestamp: pred.timestamp,
                    latitude: pred.latitude.toString(),
                    longitude: pred.longitude.toString(),
                    isPredicted: true,
                    method: pred.method || 'orbital_mechanics',
                    minutes_ahead: pred.minutes_ahead,
                    source_timestamp: sourceTs
                });
            });
        }
        
        // Add SGP4 predictions if available
        console.log('setPredictionsFromAPI: sgp4 type:', typeof predictionsData.sgp4, 'isArray:', Array.isArray(predictionsData.sgp4));
        console.log('setPredictionsFromAPI: sgp4 length:', Array.isArray(predictionsData.sgp4) ? predictionsData.sgp4.length : (predictionsData.sgp4 ? 1 : 0));
        if (predictionsData.sgp4) {
            const sgp4Predictions = Array.isArray(predictionsData.sgp4) 
                ? predictionsData.sgp4 
                : [predictionsData.sgp4];
            
            sgp4Predictions.forEach(pred => {
                const rawSourceTs = pred.source_timestamp || pred.timestamp;
                // Round source timestamp to 5-minute interval to group predictions correctly
                const sourceTs = this.roundTimestampTo5Minutes(rawSourceTs);
                
                if (!predictionsBySource[sourceTs]) {
                    predictionsBySource[sourceTs] = [];
                }
                predictionsBySource[sourceTs].push({
                    timestamp: pred.timestamp,
                    latitude: pred.latitude.toString(),
                    longitude: pred.longitude.toString(),
                    isPredicted: true,
                    method: 'sgp4',
                    minutes_ahead: pred.minutes_ahead,
                    source_timestamp: sourceTs
                });
            });
        }
        
        // Remove the extra 95-minute endpoint: drop the earliest entry so the window
        // aligns to the most recent 90-minute span (keeps the latest timestamps).
        // Collect all predictions with their source group reference
        const allPredictionsWithSource = [];
        Object.keys(predictionsBySource).forEach(sourceTs => {
            predictionsBySource[sourceTs].forEach(pred => {
                allPredictionsWithSource.push({
                    prediction: pred,
                    sourceTimestamp: sourceTs
                });
            });
        });
        
        // Sort by timestamp to find the earliest entry
        allPredictionsWithSource.sort((a, b) => 
            new Date(a.prediction.timestamp) - new Date(b.prediction.timestamp)
        );
        
        // Remove the earliest entry (shifts range forward by 5 minutes)
        if (allPredictionsWithSource.length > 0) {
            const earliestPrediction = allPredictionsWithSource[0];
            const sourceTs = earliestPrediction.sourceTimestamp;
            const predToRemove = earliestPrediction.prediction;
            
            // Remove the prediction from its source group
            const sourceGroup = predictionsBySource[sourceTs];
            if (sourceGroup) {
                const index = sourceGroup.findIndex(p => 
                    p.timestamp === predToRemove.timestamp &&
                    p.latitude === predToRemove.latitude &&
                    p.longitude === predToRemove.longitude
                );
                if (index !== -1) {
                    sourceGroup.splice(index, 1);
                }
                // Remove empty source groups (shouldn't happen, but just in case)
                if (sourceGroup.length === 0) {
                    delete predictionsBySource[sourceTs];
                }
            }
        }
        
        // Store grouped predictions (now without the 95-minute entry)
        this.predictionsBySource = predictionsBySource;
        
        // Also keep flat array for backward compatibility
        const allPredictions = [];
        Object.values(predictionsBySource).forEach(preds => {
            allPredictions.push(...preds);
        });
        allPredictions.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
        this.predictions = allPredictions;
        
        const sourceCount = Object.keys(predictionsBySource).length;
        console.log('Set predictions from API:', sourceCount, 'source timestamps,', 
            allPredictions.length, 'total predictions');
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
        // Round newest time to nearest 5 minutes (using floor for consistency with roundTimestampTo5Minutes)
        // Use UTC methods to ensure consistency with Firestore timestamps
        const newestMinutes = Math.floor(newestTime.getUTCMinutes() / 5) * 5;
        const roundedNewestTime = new Date(newestTime);
        roundedNewestTime.setUTCMinutes(newestMinutes);
        roundedNewestTime.setUTCSeconds(0);
        roundedNewestTime.setUTCMilliseconds(0);
        
        // Calculate oldest time (24 hours before newest, rounded to 5-minute interval)
        const oldestTime = new Date(roundedNewestTime.getTime() - (24 * 60 * 60 * 1000));
        const oldestMinutes = Math.floor(oldestTime.getUTCMinutes() / 5) * 5;
        const roundedOldestTime = new Date(oldestTime);
        roundedOldestTime.setUTCMinutes(oldestMinutes);
        roundedOldestTime.setUTCSeconds(0);
        roundedOldestTime.setUTCMilliseconds(0);
        
        // Create a map of existing locations by rounded timestamp (5-minute intervals)
        // Use the same rounding method as roundTimestampTo5Minutes() for consistency
        // Use UTC methods to ensure consistency with Firestore timestamps
        const locationMap = new Map();
        this.locations.forEach(loc => {
            const locTime = new Date(loc.timestamp);
            // Round to nearest 5 minutes (using floor to match roundTimestampTo5Minutes)
            const roundedMinutes = Math.floor(locTime.getUTCMinutes() / 5) * 5;
            const roundedTime = new Date(locTime);
            roundedTime.setUTCMinutes(roundedMinutes);
            roundedTime.setUTCSeconds(0);
            roundedTime.setUTCMilliseconds(0);
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

    // Fill gaps in predictions with placeholder entries for missing time slots (90 minutes ahead)
    fillGapsInPredictions() {
        const filledHistory = this.fillGapsInHistory();
        if (filledHistory.length === 0) {
            return [];
        }
        
        // Get the current time (newest history entry, which is the last in filledHistory)
        const currentTimeEntry = filledHistory[filledHistory.length - 1];
        if (!currentTimeEntry || !currentTimeEntry.timestamp) {
            return [];
        }
        
        const currentTime = new Date(currentTimeEntry.timestamp);
        // Round current time to nearest 5 minutes (use UTC methods for consistency)
        const currentMinutes = Math.round(currentTime.getUTCMinutes() / 5) * 5;
        const roundedCurrentTime = new Date(currentTime);
        roundedCurrentTime.setUTCMinutes(currentMinutes);
        roundedCurrentTime.setUTCSeconds(0);
        roundedCurrentTime.setUTCMilliseconds(0);
        
        // Calculate end time (90 minutes after current, rounded to 5-minute interval)
        const endTime = new Date(roundedCurrentTime.getTime() + (90 * 60 * 1000));
        const endMinutes = Math.round(endTime.getUTCMinutes() / 5) * 5;
        const roundedEndTime = new Date(endTime);
        roundedEndTime.setUTCMinutes(endMinutes);
        roundedEndTime.setUTCSeconds(0);
        roundedEndTime.setUTCMilliseconds(0);
        
        // Create a map of predictions grouped by predicted timestamp (rounded to 5-minute intervals)
        // Each group contains all predictions (from any source) that predict the same future time
        const predictionMap = new Map();
        if (this.predictionsBySource) {
            Object.keys(this.predictionsBySource).forEach(sourceTs => {
                const predictions = this.predictionsBySource[sourceTs];
                if (predictions && predictions.length > 0) {
                    // Group predictions by their predicted timestamp (rounded to 5 minutes)
                    // Use UTC methods for consistency with Firestore timestamps
                    predictions.forEach(pred => {
                        const predTime = new Date(pred.timestamp);
                        const roundedMinutes = Math.round(predTime.getUTCMinutes() / 5) * 5;
                        const roundedTime = new Date(predTime);
                        roundedTime.setUTCMinutes(roundedMinutes);
                        roundedTime.setUTCSeconds(0);
                        roundedTime.setUTCMilliseconds(0);
                        const key = roundedTime.getTime();
                        
                        // Create or update prediction group for this predicted timestamp
                        if (!predictionMap.has(key)) {
                            // Create new group - use the rounded timestamp as the group timestamp
                            predictionMap.set(key, {
                                timestamp: roundedTime.toISOString(), // Use rounded timestamp for consistency
                                latitude: pred.latitude,
                                longitude: pred.longitude,
                                isPredicted: true,
                                isPredictionGroup: true,
                                predictions: [], // Will collect all predictions for this time
                                source_timestamp: sourceTs
                            });
                        }
                        
                        // Add this prediction to the group if it matches the rounded timestamp
                        const group = predictionMap.get(key);
                        const predRounded = new Date(pred.timestamp);
                        predRounded.setUTCMinutes(Math.round(predRounded.getUTCMinutes() / 5) * 5);
                        predRounded.setUTCSeconds(0);
                        predRounded.setUTCMilliseconds(0);
                        
                        // Only add if this prediction's rounded timestamp matches the group's key
                        if (predRounded.getTime() === key) {
                            group.predictions.push(pred);
                        }
                    });
                }
            });
        }
        
        // Return only actual predictions (no placeholders for future predictions)
        const filledPredictions = [];
        
        // Sort predictions by timestamp and add them directly
        const sortedPredictions = Array.from(predictionMap.values()).sort((a, b) => {
            return new Date(a.timestamp) - new Date(b.timestamp);
        });
        
        filledPredictions.push(...sortedPredictions);
        
        console.log('fillGapsInPredictions: Created', filledPredictions.length, 'prediction groups (no placeholders)');
        
        return filledPredictions;
    }

    // Get combined history and predictions for the full 48-hour range
    // Returns filled history + filled predictions (one entry per 5-minute interval)
    getAllLocations() {
        const filledHistory = this.fillGapsInHistory();
        const allLocations = [...filledHistory];
        
        // Add filled predictions (with placeholders for gaps)
        const filledPredictions = this.fillGapsInPredictions();
        allLocations.push(...filledPredictions);
        
        console.log('getAllLocations - History:', filledHistory.length, 
            'Prediction slots:', filledPredictions.length,
            'Total:', allLocations.length);
        
        return allLocations;
    }
    
    // Get predictions for a specific source timestamp
    getPredictionsForSource(sourceTimestamp) {
        if (!this.predictionsBySource) {
            return [];
        }
        return this.predictionsBySource[sourceTimestamp] || [];
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
