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
                
                // Sort locations by timestamp to ensure correct order (newest first)
                this.locations = this.sortLocations(data.locations);
                
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
    addLocation(location) {
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
            
            // Remove oldest entries if we exceed MAX_ENTRIES
            if (this.locations.length > MAX_ENTRIES) {
                this.locations = this.locations.slice(0, MAX_ENTRIES);
            }
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
