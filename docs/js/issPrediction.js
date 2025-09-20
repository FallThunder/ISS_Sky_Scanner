/**
 * ISS Prediction Module
 * Uses simplified orbital mechanics to predict ISS future positions
 * Based on known orbital parameters and current position
 */

class ISSPredictor {
    constructor() {
        // ISS orbital parameters (approximate)
        this.ORBITAL_PERIOD = 92.65; // minutes
        this.ORBITAL_RADIUS = 6790; // km (Earth radius + altitude)
        this.EARTH_RADIUS = 6371; // km
        this.INCLINATION = 51.6; // degrees
        this.ANGULAR_VELOCITY = 2 * Math.PI / (this.ORBITAL_PERIOD * 60); // radians per second
        
        // Cache for predictions
        this.predictionCache = new Map();
        this.cacheExpiry = 5 * 60 * 1000; // 5 minutes
    }

    /**
     * Predict ISS position at a future time
     * @param {Object} currentLocation - Current ISS location with timestamp, latitude, longitude
     * @param {number} minutesAhead - Minutes into the future to predict
     * @param {Object} velocityVector - Optional velocity vector for more accurate prediction
     * @returns {Object} Predicted location with timestamp, latitude, longitude
     */
    predictLocation(currentLocation, minutesAhead, velocityVector = null) {
        const cacheKey = `${currentLocation.timestamp}_${minutesAhead}`;
        const cached = this.predictionCache.get(cacheKey);
        
        if (cached && Date.now() - cached.timestamp < this.cacheExpiry) {
            return cached.prediction;
        }

        try {
            const currentTime = new Date(currentLocation.timestamp);
            const futureTime = new Date(currentTime.getTime() + minutesAhead * 60 * 1000);
            
            const currentLat = parseFloat(currentLocation.latitude);
            const currentLon = parseFloat(currentLocation.longitude);
            
            // Calculate orbital parameters based on current position
            const orbitalParams = this.calculateOrbitalParameters(currentLat, currentLon);
            
            let newLongitude, newLatitude;
            
            if (velocityVector) {
                // Use velocity vector for more accurate short-term prediction
                newLongitude = currentLon + (velocityVector.lonVelocity * minutesAhead);
                newLatitude = currentLat + (velocityVector.latVelocity * minutesAhead);
                
                // Apply gradual blending with orbital mechanics for all time periods
                const orbitalWeight = Math.min(1, minutesAhead / 90); // Blend over 0-90 minutes
                
                if (orbitalWeight > 0) {
                    // Calculate orbital prediction
                    const orbitalSpeed = 360 / this.ORBITAL_PERIOD;
                    const longitudeChange = orbitalSpeed * minutesAhead;
                    const earthRotationSpeed = 360 / (24 * 60);
                    const earthRotationChange = earthRotationSpeed * minutesAhead;
                    const netLongitudeChange = longitudeChange - earthRotationChange;
                    const orbitalLongitude = currentLon + netLongitudeChange;
                    
                    const orbitalPhase = (minutesAhead / this.ORBITAL_PERIOD) * 2 * Math.PI;
                    const orbitalLatitude = orbitalParams.baseLatitude + orbitalParams.latitudeAmplitude * Math.sin(orbitalPhase + orbitalParams.latitudePhase);
                    
                    // Blend velocity-based and orbital predictions
                    newLongitude = newLongitude * (1 - orbitalWeight) + orbitalLongitude * orbitalWeight;
                    newLatitude = newLatitude * (1 - orbitalWeight) + orbitalLatitude * orbitalWeight;
                }
            } else {
                // Use pure orbital mechanics
                const orbitalSpeed = 360 / this.ORBITAL_PERIOD; // degrees per minute
                const longitudeChange = orbitalSpeed * minutesAhead;
                
                // Earth's rotation (counter-rotation)
                const earthRotationSpeed = 360 / (24 * 60); // degrees per minute
                const earthRotationChange = earthRotationSpeed * minutesAhead;
                
                // Net longitude change (orbital motion - Earth rotation)
                const netLongitudeChange = longitudeChange - earthRotationChange;
                
                // Calculate new longitude (with proper wrapping)
                newLongitude = currentLon + netLongitudeChange;
                
                // Calculate latitude based on orbital phase and current position
                const orbitalPhase = (minutesAhead / this.ORBITAL_PERIOD) * 2 * Math.PI;
                
                // Use a more gradual approach for latitude changes
                // Start with current latitude and gradually transition to orbital prediction
                const orbitalLatitude = orbitalParams.baseLatitude + orbitalParams.latitudeAmplitude * Math.sin(orbitalPhase + orbitalParams.latitudePhase);
                
                // Blend current latitude with orbital prediction for smoother transition
                const blendFactor = Math.min(1, minutesAhead / 60); // Full blend after 1 hour
                newLatitude = orbitalParams.currentLatitude * (1 - blendFactor) + orbitalLatitude * blendFactor;
            }
            
            // Handle longitude wrapping
            while (newLongitude > 180) newLongitude -= 360;
            while (newLongitude < -180) newLongitude += 360;
            
            // Clamp latitude to valid range
            const clampedLatitude = Math.max(-90, Math.min(90, newLatitude));
            
            const prediction = {
                timestamp: futureTime.toISOString(),
                latitude: clampedLatitude,
                longitude: newLongitude,
                isPredicted: true,
                confidence: this.calculateConfidence(minutesAhead)
            };
            
            // Cache the result
            this.predictionCache.set(cacheKey, {
                prediction: prediction,
                timestamp: Date.now()
            });
            
            return prediction;
            
        } catch (error) {
            console.error('Error predicting ISS location:', error);
            return null;
        }
    }

    /**
     * Generate multiple predictions for a time range
     * @param {Object} currentLocation - Current ISS location
     * @param {number} startMinutes - Start time in minutes from now
     * @param {number} endMinutes - End time in minutes from now
     * @param {number} intervalMinutes - Interval between predictions
     * @param {Array} recentHistory - Recent historical locations for velocity estimation
     * @returns {Array} Array of predicted locations
     */
    generatePredictionPath(currentLocation, startMinutes = 0, endMinutes = 1440, intervalMinutes = 5, recentHistory = []) {
        const predictions = [];
        
        // Estimate velocity vector from recent history if available
        let velocityVector = null;
        if (recentHistory && recentHistory.length >= 2) {
            velocityVector = this.estimateVelocityVector(recentHistory);
        }
        
        for (let minutes = startMinutes; minutes <= endMinutes; minutes += intervalMinutes) {
            const prediction = this.predictLocation(currentLocation, minutes, velocityVector);
            if (prediction) {
                predictions.push(prediction);
            }
        }
        
        return predictions;
    }

    /**
     * Estimate velocity vector from recent historical data
     * @param {Array} recentHistory - Array of recent location data
     * @returns {Object} Estimated velocity vector
     */
    estimateVelocityVector(recentHistory) {
        if (recentHistory.length < 2) return null;
        
        // Use the two most recent points to estimate velocity
        const point1 = recentHistory[0]; // Most recent
        const point2 = recentHistory[1]; // Second most recent
        
        const timeDiff = (new Date(point1.timestamp) - new Date(point2.timestamp)) / (1000 * 60); // minutes
        if (timeDiff <= 0) return null;
        
        const latDiff = parseFloat(point1.latitude) - parseFloat(point2.latitude);
        const lonDiff = parseFloat(point1.longitude) - parseFloat(point2.longitude);
        
        // Handle longitude wrapping
        if (lonDiff > 180) lonDiff -= 360;
        if (lonDiff < -180) lonDiff += 360;
        
        return {
            latVelocity: latDiff / timeDiff, // degrees per minute
            lonVelocity: lonDiff / timeDiff, // degrees per minute
            timeDiff: timeDiff
        };
    }

    /**
     * Calculate orbital parameters based on current ISS position
     * @param {number} currentLat - Current latitude in degrees
     * @param {number} currentLon - Current longitude in degrees
     * @returns {Object} Orbital parameters for prediction
     */
    calculateOrbitalParameters(currentLat, currentLon) {
        // Determine orbital phase based on current position
        // ISS orbit is inclined at 51.6 degrees, so latitude oscillates between ±51.6°
        
        const maxLatitude = this.INCLINATION;
        
        // Calculate the orbital phase offset based on current latitude
        // We need to be more careful about the phase calculation to avoid jumps
        let orbitalPhaseOffset = 0;
        
        if (Math.abs(currentLat) <= maxLatitude) {
            // Calculate phase offset based on current latitude
            // Use a more gradual approach to avoid sudden jumps
            const normalizedLat = currentLat / maxLatitude;
            
            // Calculate the phase that would produce this latitude
            // We need to consider both possible phases (ascending and descending)
            const phase1 = Math.asin(normalizedLat);
            const phase2 = Math.PI - phase1;
            
            // Choose the phase that's closer to 0 (more likely to be current)
            orbitalPhaseOffset = Math.abs(phase1) < Math.abs(phase2) ? phase1 : phase2;
            
            // Add some smoothing to prevent sudden phase jumps
            orbitalPhaseOffset = orbitalPhaseOffset * 0.8; // Reduce the phase offset
        }
        
        return {
            baseLatitude: 0, // Center of oscillation
            latitudeAmplitude: maxLatitude, // ±51.6 degrees
            latitudePhase: orbitalPhaseOffset, // Phase offset based on current position
            currentLatitude: currentLat // Store current latitude for reference
        };
    }

    /**
     * Convert latitude/longitude to cartesian coordinates
     * @param {number} lat - Latitude in degrees
     * @param {number} lon - Longitude in degrees
     * @returns {Object} Cartesian coordinates {x, y, z}
     */
    latLonToCartesian(lat, lon) {
        const latRad = lat * Math.PI / 180;
        const lonRad = lon * Math.PI / 180;
        
        return {
            x: this.ORBITAL_RADIUS * Math.cos(latRad) * Math.cos(lonRad),
            y: this.ORBITAL_RADIUS * Math.cos(latRad) * Math.sin(lonRad),
            z: this.ORBITAL_RADIUS * Math.sin(latRad)
        };
    }

    /**
     * Convert cartesian coordinates to latitude/longitude
     * @param {Object} pos - Cartesian coordinates {x, y, z}
     * @returns {Object} Latitude and longitude in degrees
     */
    cartesianToLatLon(pos) {
        const lat = Math.asin(pos.z / this.ORBITAL_RADIUS) * 180 / Math.PI;
        const lon = Math.atan2(pos.y, pos.x) * 180 / Math.PI;
        
        return {
            latitude: lat,
            longitude: lon
        };
    }

    /**
     * Calculate orbital motion for given time ahead
     * @param {number} minutesAhead - Minutes into the future
     * @returns {Object} Orbital motion parameters
     */
    calculateOrbitalMotion(minutesAhead) {
        // Calculate orbital motion considering Earth's rotation and ISS orbit
        const timeFraction = minutesAhead / this.ORBITAL_PERIOD;
        const orbitalAngle = 2 * Math.PI * timeFraction;
        
        // Earth's rotation (counter-rotation to ISS orbital motion)
        const earthRotationAngle = (minutesAhead / (24 * 60)) * 2 * Math.PI;
        
        // Add some orbital inclination variation (ISS orbit is inclined)
        const inclinationVariation = Math.sin(orbitalAngle) * (this.INCLINATION * Math.PI / 180);
        
        return {
            orbitalAngle: orbitalAngle,
            earthRotationAngle: earthRotationAngle,
            inclinationVariation: inclinationVariation
        };
    }

    /**
     * Apply orbital motion to position
     * @param {Object} pos - Cartesian position
     * @param {Object} motion - Orbital motion parameters
     * @returns {Object} New position after orbital motion
     */
    applyOrbitalMotion(pos, motion) {
        // Apply orbital motion (ISS moves in its orbit)
        const cosOrb = Math.cos(motion.orbitalAngle);
        const sinOrb = Math.sin(motion.orbitalAngle);
        
        // Apply Earth's rotation (counter-rotation)
        const cosEarth = Math.cos(-motion.earthRotationAngle);
        const sinEarth = Math.sin(-motion.earthRotationAngle);
        
        // First apply orbital motion
        let newPos = {
            x: pos.x * cosOrb - pos.y * sinOrb,
            y: pos.x * sinOrb + pos.y * cosOrb,
            z: pos.z + motion.inclinationVariation * 100 // Add some vertical variation
        };
        
        // Then apply Earth's rotation
        return {
            x: newPos.x * cosEarth - newPos.y * sinEarth,
            y: newPos.x * sinEarth + newPos.y * cosEarth,
            z: newPos.z
        };
    }

    /**
     * Calculate prediction confidence based on time ahead
     * @param {number} minutesAhead - Minutes into the future
     * @returns {number} Confidence score (0-1)
     */
    calculateConfidence(minutesAhead) {
        // Confidence decreases with time due to orbital perturbations
        if (minutesAhead <= 30) return 0.95;
        if (minutesAhead <= 60) return 0.90;
        if (minutesAhead <= 120) return 0.80;
        if (minutesAhead <= 240) return 0.70;
        if (minutesAhead <= 480) return 0.60;
        if (minutesAhead <= 720) return 0.50;
        if (minutesAhead <= 1440) return 0.40;
        return 0.30;
    }

    /**
     * Get prediction accuracy information
     * @param {number} minutesAhead - Minutes into the future
     * @returns {Object} Accuracy information
     */
    getAccuracyInfo(minutesAhead) {
        const confidence = this.calculateConfidence(minutesAhead);
        let accuracyKm = 0;
        let description = '';
        
        if (minutesAhead <= 30) {
            accuracyKm = 1;
            description = 'Very High';
        } else if (minutesAhead <= 60) {
            accuracyKm = 3;
            description = 'High';
        } else if (minutesAhead <= 120) {
            accuracyKm = 10;
            description = 'Good';
        } else if (minutesAhead <= 240) {
            accuracyKm = 25;
            description = 'Moderate';
        } else if (minutesAhead <= 480) {
            accuracyKm = 50;
            description = 'Fair';
        } else if (minutesAhead <= 720) {
            accuracyKm = 100;
            description = 'Low';
        } else {
            accuracyKm = 200;
            description = 'Very Low';
        }
        
        return {
            confidence: confidence,
            accuracyKm: accuracyKm,
            description: description
        };
    }

    /**
     * Clear prediction cache
     */
    clearCache() {
        this.predictionCache.clear();
    }
}

export default ISSPredictor;
