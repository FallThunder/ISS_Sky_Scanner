/**
 * ISS Prediction Module
 * Uses orbital mechanics to predict ISS future positions
 * Based on known orbital parameters and current position with velocity estimation
 */

class ISSPredictor {
    constructor() {
        // Default ISS orbital parameters (fallback values)
        // These will be updated from TLE data when available
        this.ORBITAL_PERIOD = 92.9; // minutes
        this.ORBITAL_ALTITUDE = 408; // km above Earth surface
        this.EARTH_RADIUS = 6371; // km
        this.ORBITAL_RADIUS = this.EARTH_RADIUS + this.ORBITAL_ALTITUDE; // km
        this.INCLINATION = 51.6; // degrees
        this.ORBITAL_SPEED = 7.66; // km/s (average orbital velocity)
        
        // Angular velocities (will be recalculated when TLE is loaded)
        this.ORBITAL_ANGULAR_VELOCITY = 360 / this.ORBITAL_PERIOD; // degrees per minute
        this.EARTH_ROTATION_RATE = 360 / (24 * 60); // degrees per minute
        
        // Net longitude rate (orbital motion - Earth rotation)
        this.NET_LONGITUDE_RATE = this.ORBITAL_ANGULAR_VELOCITY - this.EARTH_ROTATION_RATE;
        
        // Calibration data for orbital period
        this.periodCalibrationData = [];
        
        // Cache for predictions
        this.predictionCache = new Map();
        this.cacheExpiry = 5 * 60 * 1000; // 5 minutes
        
        // Track prediction accuracy for confidence calculation
        this.predictionAccuracyHistory = [];
        
        // TLE data
        this.tleData = null;
        this.tleLastUpdated = null;
        this.tleUpdateInterval = 60 * 60 * 1000; // Update TLE every hour
        
        // Polynomial equation data for predictions
        this.latitudeEquation = null;
        this.longitudeEquation = null;
        this.equationsLoaded = false;
        
        // Load TLE data and equations on initialization
        this.loadTLE();
        this.loadEquations();
    }
    
    /**
     * Set experimental parameter for tuning
     * @param {string} paramName - Name of parameter to set
     * @param {*} value - Value to set
     */
    setExperimentalParam(paramName, value) {
        if (this.experimentalParams.hasOwnProperty(paramName)) {
            this.experimentalParams[paramName] = value;
            this.clearCache(); // Clear cache when parameters change
            console.log(`Experimental parameter ${paramName} set to:`, value);
        } else {
            console.warn(`Unknown experimental parameter: ${paramName}`);
        }
    }
    
    /**
     * Get experimental parameter value
     * @param {string} paramName - Name of parameter to get
     * @returns {*} Parameter value or null if not found
     */
    getExperimentalParam(paramName) {
        return this.experimentalParams.hasOwnProperty(paramName) ? this.experimentalParams[paramName] : null;
    }
    
    /**
     * Fetch and parse ISS TLE data from ARISS
     * TLE format: https://live.ariss.org/iss.txt
     */
    async loadTLE() {
        try {
            const response = await fetch('https://live.ariss.org/iss.txt');
            if (!response.ok) {
                throw new Error(`Failed to fetch TLE: ${response.status}`);
            }
            
            const text = await response.text();
            const lines = text.trim().split('\n');
            
            if (lines.length < 3) {
                throw new Error('Invalid TLE format');
            }
            
            // Parse TLE lines
            // Line 0: Name (e.g., "ISS (ZARYA)")
            // Line 1: First line of TLE
            // Line 2: Second line of TLE (contains inclination and mean motion)
            
            const line2 = lines[2].trim();
            
            // Parse line 2: TLE uses fixed-width fields, but we'll parse space-separated for simplicity
            // Format: 2 25544  INCLINATION  RAAN  ECCENTRICITY  ARG_PERIGEE  MEAN_ANOMALY  MEAN_MOTION
            // Handle multiple spaces between fields
            const fields = line2.split(/\s+/).filter(f => f.length > 0);
            
            if (fields.length < 8) {
                throw new Error(`Invalid TLE line 2 format: expected 8+ fields, got ${fields.length}`);
            }
            
            // Extract TLE parameters
            // Field indices: 0=line number, 1=satellite number, 2=inclination, 3=RAAN, 
            // 4=eccentricity, 5=argument of perigee, 6=mean anomaly, 7=mean motion
            const inclination = parseFloat(fields[2]);
            const raan = parseFloat(fields[3]); // Right Ascension of Ascending Node (degrees)
            // Eccentricity is stored as integer with implied decimal (e.g., "0003908" = 0.0003908)
            const eccentricityStr = fields[4].trim();
            const eccentricity = parseFloat('0.' + eccentricityStr);
            const argPerigee = parseFloat(fields[5]); // Argument of perigee (degrees)
            const meanAnomaly = parseFloat(fields[6]); // Mean anomaly (degrees)
            const meanMotionStr = fields[7].trim();
            const meanMotion = parseFloat(meanMotionStr);
            
            if (isNaN(inclination) || isNaN(meanMotion) || meanMotion <= 0) {
                throw new Error('Invalid TLE values');
            }
            
            // Calculate orbital period from mean motion
            // Mean motion = revolutions per day
            // Period (minutes) = minutes per day / revolutions per day
            const orbitalPeriodMinutes = (24 * 60) / meanMotion;
            
            // Update orbital parameters
            this.INCLINATION = inclination;
            this.ORBITAL_PERIOD = orbitalPeriodMinutes;
            this.ORBITAL_ANGULAR_VELOCITY = 360 / this.ORBITAL_PERIOD;
            this.NET_LONGITUDE_RATE = this.ORBITAL_ANGULAR_VELOCITY - this.EARTH_ROTATION_RATE;
            
            // Store TLE data (including additional parameters for potential future use)
            this.tleData = {
                name: lines[0].trim(),
                line1: lines[1].trim(),
                line2: lines[2].trim(),
                inclination: inclination,
                raan: raan,
                eccentricity: eccentricity,
                argumentOfPerigee: argPerigee,
                meanAnomaly: meanAnomaly,
                meanMotion: meanMotion,
                orbitalPeriod: orbitalPeriodMinutes,
                timestamp: Date.now()
            };
            
            // Log additional TLE parameters for reference
            console.log('Additional TLE parameters:', {
                eccentricity: eccentricity.toFixed(6),
                raan: raan.toFixed(2),
                argPerigee: argPerigee.toFixed(2),
                meanAnomaly: meanAnomaly.toFixed(2)
            });
            
            this.tleLastUpdated = Date.now();
            
            // Clear prediction cache since parameters changed
            this.clearCache();
            
            console.log('TLE data loaded successfully:', {
                inclination: this.INCLINATION.toFixed(4),
                orbitalPeriod: this.ORBITAL_PERIOD.toFixed(2),
                meanMotion: meanMotion.toFixed(8)
            });
            
        } catch (error) {
            console.warn('Failed to load TLE data, using defaults:', error.message);
            // Continue with default values
        }
    }
    
    /**
     * Check if TLE data needs to be refreshed
     */
    checkAndUpdateTLE() {
        if (!this.tleLastUpdated || (Date.now() - this.tleLastUpdated) > this.tleUpdateInterval) {
            this.loadTLE();
        }
    }
    
    /**
     * Load polynomial equations from JSON files
     */
    async loadEquations() {
        try {
            const [latResponse, lonResponse] = await Promise.all([
                fetch('./iss_latitude_equation.json'),
                fetch('./iss_longitude_equation.json')
            ]);
            
            if (!latResponse.ok || !lonResponse.ok) {
                throw new Error(`Failed to fetch equations: ${latResponse.status}, ${lonResponse.status}`);
            }
            
            this.latitudeEquation = await latResponse.json();
            this.longitudeEquation = await lonResponse.json();
            this.equationsLoaded = true;
            
            console.log('Polynomial equations loaded successfully:', {
                latitude: {
                    t0: this.latitudeEquation.t0,
                    duration_minutes: this.latitudeEquation.duration_minutes,
                    max_error: this.latitudeEquation.max_error_degrees
                },
                longitude: {
                    t0: this.longitudeEquation.t0,
                    duration_minutes: this.longitudeEquation.duration_minutes,
                    max_error: this.longitudeEquation.max_error_degrees
                }
            });
            
            // Clear cache when equations are loaded
            this.clearCache();
        } catch (error) {
            console.warn('Failed to load polynomial equations, predictions will fall back to SGP4 only:', error.message);
            this.equationsLoaded = false;
        }
    }
    
    /**
     * Evaluate a polynomial at a given normalized time
     * @param {Array} coefficients - Polynomial coefficients [a0, a1, ..., an] for a0*t^n + a1*t^(n-1) + ... + an
     * @param {number} tNormalized - Normalized time in [0, 1]
     * @returns {number} Evaluated polynomial value
     */
    evaluatePolynomial(coefficients, tNormalized) {
        if (!coefficients || coefficients.length === 0) {
            return 0;
        }
        
        let result = 0;
        const degree = coefficients.length - 1;
        
        for (let i = 0; i < coefficients.length; i++) {
            const power = degree - i;
            result += coefficients[i] * Math.pow(tNormalized, power);
        }
        
        return result;
    }
    
    /**
     * Predict position using polynomial equations
     * @param {Object} currentLocation - Current ISS location with timestamp
     * @param {number} minutesAhead - Minutes into the future to predict
     * @returns {Object|null} Predicted location with timestamp, latitude, longitude, or null if equations not available
     */
    predictFromEquations(currentLocation, minutesAhead) {
        if (!this.equationsLoaded || !this.latitudeEquation || !this.longitudeEquation) {
            return null;
        }
        
        try {
            const currentTime = new Date(currentLocation.timestamp);
            const futureTime = new Date(currentTime.getTime() + minutesAhead * 60 * 1000);
            
            // Get reference time from equations (use latitude equation as reference)
            // t0_timestamp is in seconds (Unix timestamp), convert to milliseconds
            const t0Timestamp = this.latitudeEquation.t0_timestamp * 1000;
            
            // Calculate time difference in minutes from t0
            const timeDiffMinutes = (futureTime.getTime() - t0Timestamp) / (1000 * 60);
            
            // Debug: Log time calculations for first prediction
            if (minutesAhead === 5) {
                console.log('Polynomial time calculation:', {
                    currentTime: currentTime.toISOString(),
                    futureTime: futureTime.toISOString(),
                    t0: this.latitudeEquation.t0,
                    t0Timestamp: t0Timestamp,
                    currentTimeMs: currentTime.getTime(),
                    futureTimeMs: futureTime.getTime(),
                    timeDiffMinutes: timeDiffMinutes.toFixed(2),
                    durationMinutes: this.latitudeEquation.duration_minutes
                });
            }
            
            // Check if prediction is within valid range
            const durationMinutes = this.latitudeEquation.duration_minutes;
            if (timeDiffMinutes < 0 || timeDiffMinutes > durationMinutes) {
                // Outside valid range, return null to fall back to other methods
                if (minutesAhead === 5) { // Only log for first prediction to avoid spam
                    console.log('Polynomial prediction outside valid range:', {
                        timeDiffMinutes: timeDiffMinutes.toFixed(2),
                        durationMinutes: durationMinutes,
                        t0: this.latitudeEquation.t0,
                        currentTime: currentTime.toISOString(),
                        futureTime: futureTime.toISOString()
                    });
                }
                return null;
            }
            
            // Normalize time to [0, 1]
            const tNormalized = timeDiffMinutes / durationMinutes;
            
            // Calculate what the polynomial predicts at the current time (for offset correction)
            const currentTimeDiffMinutes = (currentTime.getTime() - t0Timestamp) / (1000 * 60);
            let currentOffsetLat = 0;
            let currentOffsetLon = 0;
            
            if (currentTimeDiffMinutes >= 0 && currentTimeDiffMinutes <= durationMinutes) {
                const currentTNormalized = currentTimeDiffMinutes / durationMinutes;
                const polynomialCurrentLat = this.evaluatePolynomial(this.latitudeEquation.coefficients, currentTNormalized);
                const polynomialCurrentLon = this.evaluatePolynomial(this.longitudeEquation.coefficients, currentTNormalized);
                
                // Calculate offset: difference between actual current location and polynomial prediction
                currentOffsetLat = parseFloat(currentLocation.latitude) - polynomialCurrentLat;
                
                // For longitude, handle wrapping
                let polynomialCurrentLonWrapped = polynomialCurrentLon;
                if (this.longitudeEquation.longitude_unwrapped) {
                    polynomialCurrentLonWrapped = ((polynomialCurrentLon + 180) % 360) - 180;
                }
                let lonDiff = parseFloat(currentLocation.longitude) - polynomialCurrentLonWrapped;
                // Handle wrapping - find shortest path
                if (lonDiff > 180) lonDiff -= 360;
                if (lonDiff < -180) lonDiff += 360;
                currentOffsetLon = lonDiff;
            }
            
            // Evaluate polynomials for future time
            const predictedLat = this.evaluatePolynomial(this.latitudeEquation.coefficients, tNormalized);
            let predictedLon = this.evaluatePolynomial(this.longitudeEquation.coefficients, tNormalized);
            
            // Apply offset to align with current location
            const correctedLat = predictedLat + currentOffsetLat;
            let correctedLon = predictedLon + currentOffsetLon;
            
            // Debug logging for first prediction
            if (minutesAhead === 5) {
                console.log('Polynomial prediction:', {
                    minutesAhead: minutesAhead,
                    timeDiffMinutes: timeDiffMinutes.toFixed(2),
                    tNormalized: tNormalized.toFixed(6),
                    predictedLat: predictedLat.toFixed(4),
                    predictedLon: predictedLon.toFixed(4),
                    currentOffsetLat: currentOffsetLat.toFixed(4),
                    currentOffsetLon: currentOffsetLon.toFixed(4),
                    correctedLat: correctedLat.toFixed(4),
                    correctedLon: correctedLon.toFixed(4),
                    currentLat: currentLocation.latitude,
                    currentLon: currentLocation.longitude
                });
            }
            
            // Use corrected values
            let finalLat = correctedLat;
            let finalLon = correctedLon;
            
            // Wrap longitude back to [-180, 180] if needed
            // The longitude equation uses unwrapped longitude, so we need to wrap it
            if (this.longitudeEquation.longitude_unwrapped) {
                // Wrap to [-180, 180]
                finalLon = ((finalLon + 180) % 360) - 180;
            } else {
                // Already wrapped, just ensure it's in range
                while (finalLon > 180) finalLon -= 360;
                while (finalLon < -180) finalLon += 360;
            }
            
            // Clamp latitude to valid range
            const clampedLatitude = Math.max(-90, Math.min(90, finalLat));
            
            // Calculate confidence based on how far into the future we're predicting
            // Confidence decreases as we approach the end of the valid range
            const confidence = 1 - (timeDiffMinutes / durationMinutes) * 0.3; // Up to 30% reduction
            
            return {
                timestamp: futureTime.toISOString(),
                latitude: clampedLatitude,
                longitude: finalLon,
                isPredicted: true,
                confidence: Math.max(0.5, Math.min(0.99, confidence)),
                minutesAhead: minutesAhead,
                method: 'polynomial'
            };
        } catch (error) {
            console.error('Error predicting from equations:', error);
            return null;
        }
    }

    /**
     * Predict ISS position at a future time using polynomial equations
     * Falls back to SGP4 if equations are not available or outside valid range
     * @param {Object} currentLocation - Current ISS location with timestamp, latitude, longitude
     * @param {number} minutesAhead - Minutes into the future to predict
     * @param {Object} velocityVector - Optional velocity vector (not used with polynomial method)
     * @param {Array} recentHistory - Optional recent history (not used with polynomial method)
     * @returns {Object} Predicted location with timestamp, latitude, longitude
     */
    predictLocation(currentLocation, minutesAhead, velocityVector = null, recentHistory = null) {
        const cacheKey = `${currentLocation.timestamp}_${minutesAhead}`;
        const cached = this.predictionCache.get(cacheKey);
        
        if (cached && Date.now() - cached.timestamp < this.cacheExpiry) {
            return cached.prediction;
        }

        try {
            // Try polynomial equations first
            const polynomialPrediction = this.predictFromEquations(currentLocation, minutesAhead);
            
            if (polynomialPrediction) {
                // Cache the result
                this.predictionCache.set(cacheKey, {
                    prediction: polynomialPrediction,
                    timestamp: Date.now()
                });
                
                return polynomialPrediction;
            }
            
            // If polynomial prediction is not available (outside range or not loaded),
            // fall back to SGP4 if TLE data is available
            // Note: We don't fall back to orbital mechanics methods as requested
            // Only SGP4 path generation is kept
            
            console.warn(`Polynomial prediction not available for ${minutesAhead} minutes ahead, falling back to SGP4`);
            
            // For fallback, we could use SGP4, but since predictLocation is called
            // for individual points, we'll return null and let generateSGP4Path handle it
            // Or we could generate a single SGP4 point here
            if (this.tleData && typeof satellite !== 'undefined') {
                try {
                    const futureTime = new Date(new Date(currentLocation.timestamp).getTime() + minutesAhead * 60 * 1000);
                    const satrec = satellite.twoline2satrec(this.tleData.line1, this.tleData.line2);
                    const positionAndVelocity = satellite.propagate(satrec, futureTime);
                    
                    if (positionAndVelocity && positionAndVelocity.position) {
                        const gmst = satellite.gstime(futureTime);
                        const position = satellite.eciToGeodetic(positionAndVelocity.position, gmst);
                        
                        const latitudeDeg = typeof satellite.degreesLat === 'function' 
                            ? satellite.degreesLat(position.latitude)
                            : position.latitude * 180 / Math.PI;
                        const longitudeDeg = typeof satellite.degreesLong === 'function'
                            ? satellite.degreesLong(position.longitude)
                            : position.longitude * 180 / Math.PI;
                        
                        let normalizedLongitude = longitudeDeg;
                        while (normalizedLongitude > 180) normalizedLongitude -= 360;
                        while (normalizedLongitude < -180) normalizedLongitude += 360;
                        
                        const prediction = {
                            timestamp: futureTime.toISOString(),
                            latitude: Math.max(-90, Math.min(90, latitudeDeg)),
                            longitude: normalizedLongitude,
                            isPredicted: true,
                            confidence: 0.95,
                            minutesAhead: minutesAhead,
                            method: 'sgp4_fallback'
                        };
                        
                        // Cache the result
                        this.predictionCache.set(cacheKey, {
                            prediction: prediction,
                            timestamp: Date.now()
                        });
                        
                        return prediction;
                    }
                } catch (sgp4Error) {
                    console.error('SGP4 fallback failed:', sgp4Error);
                }
            }
            
            // If all methods fail, return null
            return null;
            
        } catch (error) {
            console.error('Error predicting ISS location:', error);
            return null;
        }
    }

    /**
     * Calculate orbital position using proper orbital mechanics
     * Uses spherical geometry and orbital mechanics principles
     * @param {number} currentLatRad - Current latitude in radians
     * @param {number} currentLonRad - Current longitude in radians
     * @param {number} minutesAhead - Minutes into the future
     * @param {Array} recentHistory - Optional recent history for determining orbital direction
     * @returns {Object} Predicted latitude and longitude in radians
     */
    calculateOrbitalPosition(currentLatRad, currentLonRad, minutesAhead, recentHistory = null) {
        // If we have recent history, use velocity-based prediction primarily
        // and blend with orbital mechanics for longer-term accuracy
        if (recentHistory && recentHistory.length >= 2) {
            // Calculate velocity from recent history
            const velocity = this.calculateVelocityFromHistory(recentHistory);
            
            if (velocity) {
                // Velocity blending with configurable transition
                const blendStart = this.experimentalParams.velocityBlendStartMinutes;
                const blendEnd = this.experimentalParams.velocityBlendEndMinutes;
                const blendCurve = this.experimentalParams.velocityBlendCurve;
                
                let velocityWeight = 1.0;
                if (minutesAhead >= blendEnd) {
                    velocityWeight = 0.0;
                } else if (minutesAhead > blendStart) {
                    const progress = (minutesAhead - blendStart) / (blendEnd - blendStart);
                    
                    if (blendCurve === 'exponential') {
                        // Exponential decay: faster transition
                        velocityWeight = Math.exp(-progress * 3);
                    } else if (blendCurve === 'sigmoid') {
                        // Sigmoid curve: smooth S-shaped transition
                        velocityWeight = 1 / (1 + Math.exp(10 * (progress - 0.5)));
                    } else {
                        // Linear (default)
                        velocityWeight = 1 - progress;
                    }
                }
                
                const orbitalWeight = 1 - velocityWeight;
                
                if (orbitalWeight > 0.01) {
                    // Blend velocity-based and orbital mechanics predictions
                    const velocityPrediction = this.predictFromVelocity(
                        currentLatRad,
                        currentLonRad,
                        minutesAhead,
                        velocity
                    );
                    
                    const orbitalPrediction = this.calculatePureOrbitalMechanics(
                        currentLatRad,
                        currentLonRad,
                        minutesAhead,
                        recentHistory
                    );
                    
                    return {
                        latitude: velocityPrediction.latitude * velocityWeight + orbitalPrediction.latitude * orbitalWeight,
                        longitude: velocityPrediction.longitude * velocityWeight + orbitalPrediction.longitude * orbitalWeight,
                        method: 'blended',
                        velocityWeight: velocityWeight
                    };
                } else {
                    // Very short-term: use velocity only
                    const result = this.predictFromVelocity(
                        currentLatRad,
                        currentLonRad,
                        minutesAhead,
                        velocity
                    );
                    result.method = 'velocity';
                    result.velocityWeight = 1.0;
                    return result;
                }
            }
        }
        
        // Fallback to pure orbital mechanics if no history
        const result = this.calculatePureOrbitalMechanics(
            currentLatRad,
            currentLonRad,
            minutesAhead,
            recentHistory
        );
        result.method = 'orbital';
        result.velocityWeight = 0;
        return result;
    }
    
    /**
     * Calculate velocity from recent history
     * @param {Array} recentHistory - Recent position history (newest first)
     * @returns {Object} Velocity in radians per minute or null
     */
    calculateVelocityFromHistory(recentHistory) {
        if (recentHistory.length < 2) return null;
        
        // Use the two most recent points for velocity
        const p1 = recentHistory[0];
        const p2 = recentHistory[1];
        
        const t1 = new Date(p1.timestamp).getTime() / (1000 * 60); // minutes
        const t2 = new Date(p2.timestamp).getTime() / (1000 * 60);
        const dt = t1 - t2;
        
        if (dt <= 0 || dt > 30) return null; // Reject if time difference is invalid or too large
        
        const lat1 = parseFloat(p1.latitude);
        const lat2 = parseFloat(p2.latitude);
        const lon1 = parseFloat(p1.longitude);
        const lon2 = parseFloat(p2.longitude);
        
        // Calculate velocity in degrees per minute first (easier to validate)
        const latVelDegPerMin = (lat1 - lat2) / dt;
        let lonVelDegPerMin = (lon1 - lon2) / dt;
        
        // Handle longitude wrapping - find shortest path
        if (lonVelDegPerMin > 180) {
            lonVelDegPerMin -= 360;
        } else if (lonVelDegPerMin < -180) {
            lonVelDegPerMin += 360;
        }
        
        // Validate velocities are reasonable (ISS moves at ~4 deg/min max for lat, ~4.5 for lon)
        if (Math.abs(latVelDegPerMin) > 5 || Math.abs(lonVelDegPerMin) > 6) {
            // Velocity seems unreasonable, might be due to wrapping or data error
            // Try alternative wrapping
            const altLonVel = (lon1 - lon2 + 360) / dt;
            const altLonVel2 = (lon1 - lon2 - 360) / dt;
            
            if (Math.abs(altLonVel) < Math.abs(lonVelDegPerMin)) {
                lonVelDegPerMin = altLonVel;
            } else if (Math.abs(altLonVel2) < Math.abs(lonVelDegPerMin)) {
                lonVelDegPerMin = altLonVel2;
            }
            
            // If still unreasonable, reject
            if (Math.abs(latVelDegPerMin) > 5 || Math.abs(lonVelDegPerMin) > 6) {
                return null;
            }
        }
        
        // Convert to radians per minute
        return {
            latVelocity: latVelDegPerMin * Math.PI / 180,
            lonVelocity: lonVelDegPerMin * Math.PI / 180
        };
    }
    
    /**
     * Predict position from velocity vector
     * @param {number} currentLatRad - Current latitude in radians
     * @param {number} currentLonRad - Current longitude in radians
     * @param {number} minutesAhead - Minutes ahead
     * @param {Object} velocity - Velocity vector in radians per minute
     * @returns {Object} Predicted position in radians
     */
    predictFromVelocity(currentLatRad, currentLonRad, minutesAhead, velocity) {
        // Simple linear integration
        const predictedLatRad = currentLatRad + (velocity.latVelocity * minutesAhead);
        const predictedLonRad = currentLonRad + (velocity.lonVelocity * minutesAhead);
        
        return {
            latitude: predictedLatRad,
            longitude: predictedLonRad
        };
    }
    
    /**
     * Calculate pure orbital mechanics prediction
     * @param {number} currentLatRad - Current latitude in radians
     * @param {number} currentLonRad - Current longitude in radians
     * @param {number} minutesAhead - Minutes ahead
     * @param {Array} recentHistory - Optional history for phase determination
     * @returns {Object} Predicted position in radians
     */
    calculatePureOrbitalMechanics(currentLatRad, currentLonRad, minutesAhead, recentHistory = null) {
        // Calculate longitude change
        // ISS orbital period: ~92.9 minutes (one full orbit) - adjusted based on error analysis
        // Earth rotation: 24 hours (one full rotation)
        // Net longitude change per minute
        // Note: ISS moves eastward faster than Earth rotates, so net motion is eastward
        // Apply correction factor to reduce systematic eastward drift error
        const longitudeChangePerMinute = this.NET_LONGITUDE_RATE * Math.PI / 180; // radians per minute
        
        // Use constant correction factor from experimental params
        // This will be overridden when testing different constants
        const correctionFactor = this.experimentalParams.longitudeCorrectionFactor;
        
        let newLongitudeRad = currentLonRad + (longitudeChangePerMinute * minutesAhead * correctionFactor);
        
        // Calculate latitude using orbital phase
        const currentLatDeg = currentLatRad * 180 / Math.PI;
        const orbitalPhase = this.calculateOrbitalPhase(currentLatDeg, minutesAhead, recentHistory);
        
        // Latitude follows: lat = inclination * sin(phase)
        const inclinationRad = this.INCLINATION * Math.PI / 180;
        const newLatitudeRad = inclinationRad * Math.sin(orbitalPhase);
        
        return {
            latitude: newLatitudeRad,
            longitude: newLongitudeRad,
            method: 'orbital',
            velocityWeight: 0
        };
    }
    
    /**
     * Predict position using velocity vector integration
     * Accounts for velocity changes and uses proper spherical geometry
     * @param {number} currentLatRad - Current latitude in radians
     * @param {number} currentLonRad - Current longitude in radians
     * @param {number} minutesAhead - Minutes into the future
     * @param {Object} velocityVector - Velocity vector with lat/lon velocities (degrees per minute)
     * @param {Array} recentHistory - Recent position history
     * @returns {Object} Predicted latitude and longitude in radians
     */
    predictWithVelocity(currentLatRad, currentLonRad, minutesAhead, velocityVector, recentHistory) {
        // Convert velocity from degrees per minute to radians per minute
        const latVelocityRadPerMin = velocityVector.latVelocity * Math.PI / 180;
        const lonVelocityRadPerMin = velocityVector.lonVelocity * Math.PI / 180;
        
        // Simple linear integration
        let predictedLatRad = currentLatRad + (latVelocityRadPerMin * minutesAhead);
        let predictedLonRad = currentLonRad + (lonVelocityRadPerMin * minutesAhead);
        
        // For longer-term predictions, blend with orbital mechanics
        // Weight increases with time ahead
        const orbitalWeight = Math.min(0.3, minutesAhead / 180); // Max 30% orbital at 3+ hours
        
        if (orbitalWeight > 0.01) {
            const orbitalPrediction = this.calculatePureOrbitalMechanics(
                currentLatRad,
                currentLonRad,
                minutesAhead,
                recentHistory
            );
            
            predictedLatRad = predictedLatRad * (1 - orbitalWeight) + orbitalPrediction.latitude * orbitalWeight;
            predictedLonRad = predictedLonRad * (1 - orbitalWeight) + orbitalPrediction.longitude * orbitalWeight;
        }
        
        return {
            latitude: predictedLatRad,
            longitude: predictedLonRad
        };
    }
    
    /**
     * Calculate acceleration from recent history
     * @param {Array} recentHistory - Recent position history (newest first)
     * @returns {Object} Acceleration vector or null
     */
    calculateAcceleration(recentHistory) {
        if (recentHistory.length < 3) return null;
        
        // Get three consecutive points
        const p0 = recentHistory[0];
        const p1 = recentHistory[1];
        const p2 = recentHistory[2];
        
        const t0 = new Date(p0.timestamp).getTime() / 1000; // seconds
        const t1 = new Date(p1.timestamp).getTime() / 1000;
        const t2 = new Date(p2.timestamp).getTime() / 1000;
        
        const dt1 = t0 - t1; // time between p0 and p1
        const dt2 = t1 - t2; // time between p1 and p2
        
        if (dt1 <= 0 || dt2 <= 0) return null;
        
        // Calculate velocities
        const lat0 = parseFloat(p0.latitude);
        const lat1 = parseFloat(p1.latitude);
        const lat2 = parseFloat(p2.latitude);
        
        const lon0 = parseFloat(p0.longitude);
        const lon1 = parseFloat(p1.longitude);
        const lon2 = parseFloat(p2.longitude);
        
        // Handle longitude wrapping
        let lonDiff1 = lon0 - lon1;
        if (lonDiff1 > 180) lonDiff1 -= 360;
        if (lonDiff1 < -180) lonDiff1 += 360;
        
        let lonDiff2 = lon1 - lon2;
        if (lonDiff2 > 180) lonDiff2 -= 360;
        if (lonDiff2 < -180) lonDiff2 += 360;
        
        const v1Lat = (lat0 - lat1) / dt1; // degrees per second
        const v2Lat = (lat1 - lat2) / dt2;
        
        const v1Lon = lonDiff1 / dt1;
        const v2Lon = lonDiff2 / dt2;
        
        // Calculate acceleration (change in velocity)
        const avgDt = (dt1 + dt2) / 2;
        const latAccel = (v1Lat - v2Lat) / avgDt; // degrees per second^2
        const lonAccel = (v1Lon - v2Lon) / avgDt;
        
        return {
            latAccel: latAccel,
            lonAccel: lonAccel
        };
    }
    

    /**
     * Calculate orbital phase for latitude prediction
     * Uses trajectory from recent history to determine current phase accurately
     * @param {number} currentLat - Current latitude in degrees
     * @param {number} minutesAhead - Minutes into the future
     * @param {Array} recentHistory - Optional recent history to determine trajectory
     * @returns {number} Orbital phase in radians
     */
    calculateOrbitalPhase(currentLat, minutesAhead, recentHistory = null) {
        // If we have history, use it to determine phase more accurately
        if (recentHistory && recentHistory.length >= 2) {
            // Use the trajectory to determine phase
            // Calculate how many minutes it takes to go from min to max latitude
            // This helps us determine where we are in the orbit
            
            const recentLat = parseFloat(recentHistory[0].latitude);
            const olderLat = parseFloat(recentHistory[1].latitude);
            const timeDiff = (new Date(recentHistory[0].timestamp) - new Date(recentHistory[1].timestamp)) / (1000 * 60);
            
            if (timeDiff > 0 && Math.abs(recentLat - olderLat) > 0.001) {
                // We have velocity information - use it to determine phase
                const latVelocity = (recentLat - olderLat) / timeDiff; // degrees per minute
                
                // Calculate phase from current latitude and velocity direction
                // lat = inclination * sin(phase)
                // d(lat)/dt = inclination * cos(phase) * d(phase)/dt
                // We know d(lat)/dt (latVelocity) and can estimate d(phase)/dt from orbital period
                
                const normalizedLat = Math.max(-1, Math.min(1, currentLat / this.INCLINATION));
                const principalPhase = Math.asin(normalizedLat);
                
                // Determine quadrant based on velocity
                // If velocity > 0 and lat > 0: ascending north [0, π/2]
                // If velocity < 0 and lat > 0: descending north [π/2, π]
                // If velocity < 0 and lat < 0: descending south [π, 3π/2]
                // If velocity > 0 and lat < 0: ascending south [3π/2, 2π]
                
                let currentPhase;
                if (latVelocity > 0 && currentLat >= 0) {
                    currentPhase = principalPhase; // [0, π/2]
                } else if (latVelocity < 0 && currentLat >= 0) {
                    currentPhase = Math.PI - principalPhase; // [π/2, π]
                } else if (latVelocity < 0 && currentLat < 0) {
                    currentPhase = Math.PI - principalPhase; // [π, 3π/2] - principalPhase is negative
                } else {
                    // latVelocity > 0 && currentLat < 0
                    currentPhase = principalPhase < 0 ? 2 * Math.PI + principalPhase : principalPhase; // [3π/2, 2π]
                }
                
                // Normalize to [0, 2π]
                while (currentPhase < 0) currentPhase += 2 * Math.PI;
                while (currentPhase >= 2 * Math.PI) currentPhase -= 2 * Math.PI;
                
                // Advance phase
                const orbitalAngularVelocity = (2 * Math.PI) / this.ORBITAL_PERIOD; // radians per minute
                let futurePhase = currentPhase + (orbitalAngularVelocity * minutesAhead);
                
                // Normalize
                while (futurePhase < 0) futurePhase += 2 * Math.PI;
                while (futurePhase >= 2 * Math.PI) futurePhase -= 2 * Math.PI;
                
                return futurePhase;
            }
        }
        
        // Fallback: use simple phase calculation
        // This is less accurate but better than nothing
        const normalizedLat = Math.max(-1, Math.min(1, currentLat / this.INCLINATION));
        const principalPhase = Math.asin(normalizedLat);
        
        // Assume we're ascending if positive latitude, descending if negative
        // This is a rough approximation
        let currentPhase;
        if (currentLat >= 0) {
            // Assume ascending (phase in [0, π/2])
            currentPhase = principalPhase;
        } else {
            // Assume descending (phase in [π, 3π/2])
            currentPhase = Math.PI - principalPhase;
        }
        
        // Normalize
        while (currentPhase < 0) currentPhase += 2 * Math.PI;
        while (currentPhase >= 2 * Math.PI) currentPhase -= 2 * Math.PI;
        
        // Advance phase
        const orbitalAngularVelocity = (2 * Math.PI) / this.ORBITAL_PERIOD;
        let futurePhase = currentPhase + (orbitalAngularVelocity * minutesAhead);
        
        // Normalize
        while (futurePhase < 0) futurePhase += 2 * Math.PI;
        while (futurePhase >= 2 * Math.PI) futurePhase -= 2 * Math.PI;
        
        return futurePhase;
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
            const prediction = this.predictLocation(currentLocation, minutes, velocityVector, recentHistory);
            if (prediction) {
                predictions.push(prediction);
            }
        }
        
        return predictions;
    }
    
    /**
     * Generate predictions with different constant correction factors for comparison
     * Note: With polynomial equations, correction factors don't apply, so this returns a single prediction
     * @param {Object} currentLocation - Current ISS location
     * @param {number} minutesAhead - Minutes into the future
     * @param {Array} recentHistory - Recent historical locations (not used with polynomial method)
     * @returns {Object} Predictions (single prediction using polynomial equations)
     */
    generatePredictionsWithDifferentCorrectionFactors(currentLocation, minutesAhead, recentHistory = []) {
        // Use polynomial equations for prediction (correction factors don't apply)
        const prediction = this.predictFromEquations(currentLocation, minutesAhead);
        
        const results = {
            minutesAhead: minutesAhead,
            predictions: {}
        };
        
        if (prediction) {
            // Return single prediction with key '1.0000' for compatibility with existing code
            results.predictions['1.0000'] = {
                latitude: prediction.latitude,
                longitude: prediction.longitude,
                correctionFactor: 1.0
            };
        }
        
        return results;
    }
    
    /**
     * Generate SGP4 path using TLE data - Simple implementation
     * @param {Object} baseLocation - Starting location with timestamp
     * @param {number} startMinutes - Start time in minutes from base
     * @param {number} endMinutes - End time in minutes from base
     * @param {number} intervalMinutes - Interval between points
     * @returns {Array} Array of {latitude, longitude, timestamp} objects
     */
    generateSGP4Path(baseLocation, startMinutes = 5, endMinutes = 60, intervalMinutes = 5) {
        // Check if satellite.js is available
        if (typeof satellite === 'undefined') {
            console.warn('satellite.js not loaded, cannot generate SGP4 path');
            return [];
        }
        
        // Check if TLE data is available
        if (!this.tleData || !this.tleData.line1 || !this.tleData.line2) {
            console.warn('TLE data not available, cannot generate SGP4 path');
            return [];
        }
        
        try {
            // Get TLE lines from loaded data
            const TLE_LINE1 = this.tleData.line1;
            const TLE_LINE2 = this.tleData.line2;
            
            // Initialize a satellite record
            const satrec = satellite.twoline2satrec(TLE_LINE1, TLE_LINE2);
            
            if (!satrec) {
                console.error('Failed to parse TLE into satrec');
                return [];
            }
            
            // Base time from location timestamp
            const baseTime = new Date(baseLocation.timestamp);
            const pathPoints = [];
            
            // Generate points at specified intervals
            // Handle both positive (future) and negative (past) minutes
            const step = Math.abs(intervalMinutes);
            const start = Math.min(startMinutes, endMinutes);
            const end = Math.max(startMinutes, endMinutes);
            
            for (let minutes = start; minutes <= end; minutes += step) {
                // Calculate time for this point (subtract for past, add for future)
                const date = new Date(baseTime.getTime() + minutes * 60 * 1000);
                
                // Propagate the satellite position for the given time
                const positionAndVelocity = satellite.propagate(satrec, date);
                
                // Check if propagation was successful
                if (!positionAndVelocity || !positionAndVelocity.position) {
                    continue;
                }
                
                // Get the Greenwich Mean Sidereal Time (GMST) for the conversion
                const gmst = satellite.gstime(date);
                
                // Convert ECI position to geodetic coordinates
                const position = satellite.eciToGeodetic(positionAndVelocity.position, gmst);
                
                // Extract latitude, longitude, and height
                // Convert from radians to degrees
                const latitudeDeg = typeof satellite.degreesLat === 'function' 
                    ? satellite.degreesLat(position.latitude)
                    : position.latitude * 180 / Math.PI;
                const longitudeDeg = typeof satellite.degreesLong === 'function'
                    ? satellite.degreesLong(position.longitude)
                    : position.longitude * 180 / Math.PI;
                
                // Normalize longitude to [-180, 180]
                let normalizedLongitude = longitudeDeg;
                while (normalizedLongitude > 180) normalizedLongitude -= 360;
                while (normalizedLongitude < -180) normalizedLongitude += 360;
                
                pathPoints.push({
                    latitude: latitudeDeg,
                    longitude: normalizedLongitude,
                    timestamp: date.toISOString()
                });
            }
            
            return pathPoints;
        } catch (error) {
            console.error('Error generating SGP4 path:', error);
            return [];
        }
    }
    
    /**
     * Estimate velocity vector from recent historical data with quality assessment
     * Uses multiple regression and weighted averaging for better accuracy
     * @param {Array} recentHistory - Array of recent location data (newest first)
     * @returns {Object} Estimated velocity vector with quality score
     */
    estimateVelocityVector(recentHistory) {
        if (recentHistory.length < 2) return null;
        
        // Use multiple points for better accuracy (up to 5 most recent)
        const points = recentHistory.slice(0, Math.min(5, recentHistory.length));
        
        // Calculate velocities between consecutive points
        const velocities = [];
        const timeIntervals = [];
        
        for (let i = 0; i < points.length - 1; i++) {
            const point1 = points[i];
            const point2 = points[i + 1];
            
            const timeDiff = (new Date(point1.timestamp) - new Date(point2.timestamp)) / (1000 * 60); // minutes
            if (timeDiff <= 0) continue;
            
            const lat1 = parseFloat(point1.latitude);
            const lat2 = parseFloat(point2.latitude);
            const lon1 = parseFloat(point1.longitude);
            const lon2 = parseFloat(point2.longitude);
            
            const latDiff = lat1 - lat2;
            let lonDiff = lon1 - lon2;
            
            // Handle longitude wrapping
            if (lonDiff > 180) lonDiff -= 360;
            if (lonDiff < -180) lonDiff += 360;
            
            // Account for latitude-dependent longitude velocity scaling
            // Velocity magnitude in degrees depends on latitude (smaller at poles)
            const avgLat = (lat1 + lat2) / 2;
            const cosLat = Math.cos(avgLat * Math.PI / 180);
            const scaledLonDiff = lonDiff / Math.max(0.1, cosLat);
            
            velocities.push({
                latVelocity: latDiff / timeDiff, // degrees per minute
                lonVelocity: scaledLonDiff / timeDiff,
                rawLonVelocity: lonDiff / timeDiff, // for quality calculation
                timeDiff: timeDiff,
                avgLat: avgLat
            });
            
            timeIntervals.push(timeDiff);
        }
        
        if (velocities.length === 0) return null;
        
        // Use exponential weighting: more recent data points have higher weight
        // Also weight by time interval length (longer intervals more reliable)
        let totalWeight = 0;
        let weightedLatVel = 0;
        let weightedLonVel = 0;
        
        velocities.forEach((v, index) => {
            // Exponential decay for recency (most recent = highest weight)
            const recencyWeight = Math.exp(-index * 0.5);
            // Time interval weight (longer intervals more reliable, but not too long)
            const intervalWeight = Math.min(1, v.timeDiff / 10); // Cap at 10 minutes
            // Combined weight
            const weight = recencyWeight * intervalWeight;
            
            totalWeight += weight;
            weightedLatVel += v.latVelocity * weight;
            weightedLonVel += v.lonVelocity * weight;
        });
        
        const avgLatVelocity = weightedLatVel / totalWeight;
        const avgLonVelocity = weightedLonVel / totalWeight;
        
        // Calculate quality metrics
        let varianceLat = 0;
        let varianceLon = 0;
        let totalVarianceWeight = 0;
        
        velocities.forEach((v, index) => {
            const recencyWeight = Math.exp(-index * 0.5);
            const intervalWeight = Math.min(1, v.timeDiff / 10);
            const weight = recencyWeight * intervalWeight;
            
            varianceLat += Math.pow(v.latVelocity - avgLatVelocity, 2) * weight;
            varianceLon += Math.pow(v.rawLonVelocity - avgLonVelocity, 2) * weight;
            totalVarianceWeight += weight;
        });
        
        const stdDevLat = Math.sqrt(varianceLat / totalVarianceWeight);
        const stdDevLon = Math.sqrt(varianceLon / totalVarianceWeight);
        
        // Calculate expected velocity magnitudes for validation
        // ISS moves at ~7.66 km/s, which translates to different angular velocities
        // depending on altitude and latitude
        const expectedLatVelocityMax = 4.0; // degrees per minute (approximate max)
        const expectedLonVelocityMax = 4.5; // degrees per minute (approximate max)
        
        // Check if velocities are reasonable
        const latVelocityReasonable = Math.abs(avgLatVelocity) <= expectedLatVelocityMax * 1.5;
        const lonVelocityReasonable = Math.abs(avgLonVelocity) <= expectedLonVelocityMax * 1.5;
        
        // Quality score components
        const consistencyScore = 1 / (1 + (stdDevLat + stdDevLon) * 10);
        const dataPointsScore = Math.min(1, points.length / 3); // Max quality with 3+ points
        const reasonablenessScore = (latVelocityReasonable && lonVelocityReasonable) ? 1.0 : 0.5;
        
        // Combined quality score
        const quality = (consistencyScore * 0.5 + dataPointsScore * 0.3 + reasonablenessScore * 0.2);
        
        return {
            latVelocity: avgLatVelocity,
            lonVelocity: avgLonVelocity,
            quality: Math.max(0, Math.min(1, quality)),
            dataPoints: points.length,
            consistency: consistencyScore,
            stdDevLat: stdDevLat,
            stdDevLon: stdDevLon
        };
    }

    /**
     * Calculate prediction confidence based on multiple factors
     * @param {number} minutesAhead - Minutes into the future
     * @param {Object} velocityVector - Velocity vector with quality information
     * @returns {number} Confidence score (0-1)
     */
    calculateConfidence(minutesAhead, velocityVector = null) {
        // Base confidence decreases with time due to orbital perturbations
        // Short-term predictions are more accurate
        let baseConfidence;
        if (minutesAhead <= 5) {
            baseConfidence = 0.98;
        } else if (minutesAhead <= 15) {
            baseConfidence = 0.95;
        } else if (minutesAhead <= 30) {
            baseConfidence = 0.90;
        } else if (minutesAhead <= 60) {
            baseConfidence = 0.85;
        } else if (minutesAhead <= 120) {
            baseConfidence = 0.75;
        } else if (minutesAhead <= 240) {
            baseConfidence = 0.65;
        } else if (minutesAhead <= 480) {
            baseConfidence = 0.50;
        } else if (minutesAhead <= 720) {
            baseConfidence = 0.40;
        } else {
            baseConfidence = 0.30;
        }
        
        // Adjust based on velocity vector quality
        if (velocityVector && velocityVector.quality > 0.5) {
            // Good velocity data improves confidence for short-term predictions
            const velocityBoost = velocityVector.quality * 0.1 * Math.max(0, 1 - minutesAhead / 60);
            baseConfidence = Math.min(0.99, baseConfidence + velocityBoost);
        } else if (minutesAhead <= 30) {
            // Without good velocity data, short-term predictions are less confident
            baseConfidence *= 0.85;
        }
        
        // Account for orbital perturbations (atmospheric drag, etc.)
        // These accumulate over time
        const perturbationFactor = 1 - (minutesAhead / 1440) * 0.2; // Up to 20% reduction over 24h
        baseConfidence *= perturbationFactor;
        
        return Math.max(0.1, Math.min(0.99, baseConfidence));
    }

    /**
     * Record prediction accuracy for future confidence calculations
     * @param {Object} prediction - The prediction that was made
     * @param {Object} actual - The actual location
     * @param {number} distanceKm - Distance error in kilometers
     */
    recordPredictionAccuracy(prediction, actual, distanceKm) {
        const minutesAhead = (new Date(actual.timestamp) - new Date(prediction.timestamp)) / (1000 * 60);
        this.predictionAccuracyHistory.push({
            minutesAhead: Math.abs(minutesAhead),
            distanceKm: distanceKm,
            timestamp: Date.now()
        });
        
        // Keep only recent accuracy data (last 100 predictions)
        if (this.predictionAccuracyHistory.length > 100) {
            this.predictionAccuracyHistory.shift();
        }
        
        // Calibrate orbital period based on actual velocity data if available
        this.calibrateOrbitalPeriod(prediction, actual);
    }

    /**
     * Calibrate orbital period based on actual vs predicted positions
     * @param {Object} prediction - The prediction
     * @param {Object} actual - The actual location
     */
    calibrateOrbitalPeriod(prediction, actual) {
        const minutesAhead = (new Date(actual.timestamp) - new Date(prediction.timestamp)) / (1000 * 60);
        if (minutesAhead < 5 || minutesAhead > 60) return; // Only calibrate for reasonable time ranges
        
        // Calculate longitude error (this is most affected by orbital period)
        const predLon = parseFloat(prediction.longitude);
        const actualLon = parseFloat(actual.longitude);
        let lonError = actualLon - predLon;
        
        // Handle longitude wrapping
        if (lonError > 180) lonError -= 360;
        if (lonError < -180) lonError += 360;
        
        // Store calibration data
        this.periodCalibrationData.push({
            minutesAhead: minutesAhead,
            lonError: lonError,
            timestamp: Date.now()
        });
        
        // Keep only recent calibration data (last 50 points)
        if (this.periodCalibrationData.length > 50) {
            this.periodCalibrationData.shift();
        }
        
        // Calculate average longitude error per minute
        if (this.periodCalibrationData.length >= 10) {
            let totalLonErrorPerMinute = 0;
            let count = 0;
            
            this.periodCalibrationData.forEach(data => {
                if (data.minutesAhead > 0) {
                    totalLonErrorPerMinute += data.lonError / data.minutesAhead;
                    count++;
                }
            });
            
            if (count > 0) {
                const avgLonErrorPerMinute = totalLonErrorPerMinute / count;
                
                // If we're consistently predicting ahead (positive error means actual is ahead of prediction),
                // our period is too short - need to increase it
                // If we're consistently predicting behind (negative error), our period is too long - need to decrease it
                // Adjust period slightly based on error (small adjustments to avoid overcorrection)
                const adjustmentFactor = avgLonErrorPerMinute * 0.1; // Small adjustment
                const newPeriod = this.ORBITAL_PERIOD + adjustmentFactor;
                
                // Clamp to reasonable range (92.5 - 93.5 minutes)
                const calibratedPeriod = Math.max(92.5, Math.min(93.5, newPeriod));
                
                // Only update if change is significant (more than 0.01 minutes)
                if (Math.abs(calibratedPeriod - this.ORBITAL_PERIOD) > 0.01) {
                    const oldPeriod = this.ORBITAL_PERIOD;
                    this.ORBITAL_PERIOD = calibratedPeriod;
                    this.ORBITAL_ANGULAR_VELOCITY = 360 / this.ORBITAL_PERIOD;
                    this.NET_LONGITUDE_RATE = this.ORBITAL_ANGULAR_VELOCITY - this.EARTH_ROTATION_RATE;
                    console.log(`Calibrated orbital period: ${oldPeriod.toFixed(2)} -> ${this.ORBITAL_PERIOD.toFixed(2)} minutes (avg lon error: ${avgLonErrorPerMinute.toFixed(4)} deg/min)`);
                }
            }
        }
    }

    /**
     * Get average prediction accuracy for a given time horizon
     * @param {number} minutesAhead - Time horizon in minutes
     * @returns {number} Average distance error in kilometers, or null if no data
     */
    getAverageAccuracy(minutesAhead) {
        const relevantData = this.predictionAccuracyHistory.filter(
            d => Math.abs(d.minutesAhead - minutesAhead) <= 10
        );
        
        if (relevantData.length === 0) return null;
        
        const avgDistance = relevantData.reduce((sum, d) => sum + d.distanceKm, 0) / relevantData.length;
        return avgDistance;
    }

    /**
     * Clear prediction cache
     */
    clearCache() {
        this.predictionCache.clear();
    }
    
    /**
     * Test multiple parameter combinations and return results
     * Useful for finding optimal parameter values
     * @param {Array} testCases - Array of parameter sets to test
     * @param {Object} currentLocation - Current ISS location
     * @param {Array} recentHistory - Recent history for predictions
     * @param {Array} actualLocations - Array of actual locations to compare against
     * @returns {Array} Results for each test case
     */
    testParameterCombinations(testCases, currentLocation, recentHistory, actualLocations) {
        const results = [];
        const originalParams = JSON.parse(JSON.stringify(this.experimentalParams));
        
        testCases.forEach((testCase, index) => {
            // Set experimental parameters for this test case
            Object.keys(testCase.params).forEach(paramName => {
                this.setExperimentalParam(paramName, testCase.params[paramName]);
            });
            
            // Generate predictions and compare with actual locations
            const errors = [];
            actualLocations.forEach(actual => {
                const minutesAhead = (new Date(actual.timestamp) - new Date(currentLocation.timestamp)) / (1000 * 60);
                if (minutesAhead > 0 && minutesAhead <= 60) {
                    const prediction = this.predictLocation(currentLocation, minutesAhead, null, recentHistory);
                    if (prediction) {
                        const distance = this.calculateDistanceKm(
                            prediction.latitude,
                            prediction.longitude,
                            actual.latitude,
                            actual.longitude
                        );
                        errors.push({
                            minutesAhead: minutesAhead,
                            distance: distance,
                            latError: prediction.latitude - actual.latitude,
                            lonError: prediction.longitude - actual.longitude
                        });
                    }
                }
            });
            
            // Calculate statistics
            if (errors.length > 0) {
                const distances = errors.map(e => e.distance);
                const avgDistance = distances.reduce((a, b) => a + b, 0) / distances.length;
                const maxDistance = Math.max(...distances);
                const minDistance = Math.min(...distances);
                
                results.push({
                    testCase: testCase.name || `Test ${index + 1}`,
                    params: testCase.params,
                    avgError: avgDistance,
                    maxError: maxDistance,
                    minError: minDistance,
                    errorCount: errors.length,
                    errors: errors
                });
            }
        });
        
        // Restore original parameters
        this.experimentalParams = originalParams;
        this.clearCache();
        
        return results;
    }
    
    /**
     * Calculate distance between two lat/lon points in km
     * @param {number} lat1 - Latitude 1
     * @param {number} lon1 - Longitude 1
     * @param {number} lat2 - Latitude 2
     * @param {number} lon2 - Longitude 2
     * @returns {number} Distance in kilometers
     */
    calculateDistanceKm(lat1, lon1, lat2, lon2) {
        const R = 6371; // Earth's radius in kilometers
        const dLat = (lat2 - lat1) * Math.PI / 180;
        const dLon = (lon2 - lon1) * Math.PI / 180;
        const a = 
            Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
            Math.sin(dLon / 2) * Math.sin(dLon / 2);
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
        return R * c;
    }
}

export default ISSPredictor;
