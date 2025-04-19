// Constants
const STORAGE_KEY = 'iss_location_history';
const MAX_ENTRIES = 288; // 24 hours worth of entries (1 entry every 5 minutes)

// Class to manage ISS location history
class LocationHistoryManager {
    constructor() {
        this.locations = this.loadFromStorage() || [];
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
                
                // Sort locations by timestamp to ensure correct order
                this.locations = data.locations.sort((a, b) => 
                    new Date(b.timestamp) - new Date(a.timestamp)
                );
                
                this.saveToStorage();
                return true;
            } catch (error) {
                return false;
            }
        }
        return true;
    }

    // Add a new location and remove the oldest if we exceed MAX_ENTRIES
    addLocation(location) {
        // Add new location at the start (newest first)
        this.locations.unshift(location);
        
        // Remove oldest entry if we exceed MAX_ENTRIES
        if (this.locations.length > MAX_ENTRIES) {
            this.locations.pop();
        }
        
        this.saveToStorage();
    }

    // Get all stored locations
    getLocations() {
        return this.locations;
    }

    // Get location at specific index
    getLocationAt(index) {
        return this.locations[index];
    }

    // Clear all stored locations
    clear() {
        this.locations = [];
        sessionStorage.removeItem(STORAGE_KEY);
    }
}

export default LocationHistoryManager; 
