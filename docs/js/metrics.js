let metricsMap = null;
let metricsGraph1 = null;
let metricsGraph2 = null;
let metricsMapPolylines = []; // Store polylines for the metrics map

let metricsPathVisibility = {
    trueHistorical: true,
    predicted90min: true,
    predicted60min: true,
    predicted30min: true
};

/**
 * Initialize the metrics page components (graphs and map)
 */
function initMetricsPage() {
    initMetricsMap();
    initMetricsGraphs();
    initGraphSelector();
    initMetricsLegendToggle();
    updateGraphsWithHistoricalData();
}

/**
 * Initialize the graph selector dropdown
 */
function initGraphSelector() {
    const dropdown = document.getElementById('graph-selector');
    const selectedText = document.getElementById('dropdown-selected');
    const options = document.getElementById('dropdown-options');
    const optionElements = options.querySelectorAll('.dropdown-option');
    
    if (!dropdown || !selectedText || !options) return;
    
    // Set initial state - show latitude graph by default (graph 1)
    const wrapper1 = document.getElementById('graph-wrapper-1');
    const wrapper2 = document.getElementById('graph-wrapper-2');
    if (wrapper1 && wrapper2) {
        wrapper1.classList.add('active');
        wrapper2.classList.remove('active');
        // Set initial selected option to latitude (which shows graph 1)
        optionElements.forEach(opt => {
            if (opt.dataset.value === 'latitude') {
                opt.classList.add('selected');
                // Update selected text to show latitude
                const selectedText = document.getElementById('dropdown-selected');
                if (selectedText) {
                    const icon = opt.querySelector('.graph-icon');
                    const text = opt.textContent.trim();
                    selectedText.querySelector('.dropdown-text').innerHTML = icon ? icon.outerHTML + ' ' + text : text;
                }
            } else {
                opt.classList.remove('selected');
            }
        });
    }
    
    // Toggle dropdown on click
    selectedText.addEventListener('click', (e) => {
        e.stopPropagation();
        dropdown.classList.toggle('active');
    });
    
    // Close dropdown when clicking outside
    document.addEventListener('click', (e) => {
        if (!dropdown.contains(e.target)) {
            dropdown.classList.remove('active');
        }
    });
    
    // Handle option selection
    optionElements.forEach(option => {
        option.addEventListener('click', (e) => {
            e.stopPropagation();
            const selectedValue = option.dataset.value;
            
            // Update selected text
            const icon = option.querySelector('.graph-icon');
            const text = option.textContent.trim();
            selectedText.querySelector('.dropdown-text').innerHTML = icon ? icon.outerHTML + ' ' + text : text;
            
            // Update selected state
            optionElements.forEach(opt => {
                opt.classList.remove('selected');
            });
            option.classList.add('selected');
            
            // Close dropdown
            dropdown.classList.remove('active');
            
            // Update graph visibility
            const wrapper1 = document.getElementById('graph-wrapper-1');
            const wrapper2 = document.getElementById('graph-wrapper-2');
            
            if (!wrapper1 || !wrapper2) return;
            
            if (selectedValue === 'latitude') {
                wrapper1.classList.add('active');
                wrapper2.classList.remove('active');
                // Resize and update the visible chart
                setTimeout(() => {
                    if (metricsGraph1) {
                        metricsGraph1.resize();
                        metricsGraph1.update();
                    }
                }, 50);
            } else if (selectedValue === 'longitude') {
                wrapper1.classList.remove('active');
                wrapper2.classList.add('active');
                // Resize and update the visible chart
                setTimeout(() => {
                    if (metricsGraph2) {
                        metricsGraph2.resize();
                        metricsGraph2.update();
                    }
                }, 50);
            }
        });
    });
}

/**
 * Initialize the map for the metrics page
 */
function initMetricsMap() {
    const mapElement = document.getElementById('metrics-map');
    if (!mapElement) return;
    
    // Initialize Leaflet map
    metricsMap = L.map('metrics-map', {
        center: [20, 0],
        zoom: 2,
        worldCopyJump: true,
        renderer: L.canvas({ antimeridian: true })
    });
    
    // Add tile layer (using dark theme to match main page)
    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
        attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors, © <a href="https://carto.com/attributions">CARTO</a>',
        maxZoom: 19,
        className: 'dark-map',
        backgroundColor: '#1a1a1a'
    }).addTo(metricsMap);
}

/**
 * Initialize the graphs for the metrics page
 */
function initMetricsGraphs() {
    const graph1Canvas = document.getElementById('metrics-graph-1');
    const graph2Canvas = document.getElementById('metrics-graph-2');
    
    if (graph1Canvas) {
        const ctx1 = graph1Canvas.getContext('2d');
        metricsGraph1 = new Chart(ctx1, {
            type: 'line',
            data: {
                labels: [],
                datasets: []
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: {
                        display: true,
                        labels: {
                            color: '#ffffff'
                        }
                    },
                    tooltip: {
                        enabled: true,
                        backgroundColor: 'rgba(45, 45, 45, 0.9)',
                        titleColor: '#ffffff',
                        bodyColor: '#ffffff',
                        borderColor: '#4a9eff',
                        borderWidth: 1,
                        callbacks: {
                            label: function(context) {
                                return context.dataset.label + ': ' + context.parsed.y.toFixed(4) + '°';
                            }
                        }
                    }
                },
                interaction: {
                    intersect: false,
                    mode: 'index'
                },
                scales: {
                    x: {
                        display: true,
                        title: {
                            display: true,
                            text: 'Time (minutes from now)',
                            color: '#ffffff',
                            font: {
                                size: 12
                            }
                        },
                        ticks: {
                            color: '#ffffff'
                        },
                        grid: {
                            color: '#3d3d3d'
                        }
                    },
                    y: {
                        display: true,
                        min: -90,
                        max: 90,
                        title: {
                            display: true,
                            text: 'Latitude (°)',
                            color: '#ffffff',
                            font: {
                                size: 12
                            }
                        },
                        ticks: {
                            color: '#ffffff',
                            stepSize: 30,
                            callback: function(value) {
                                return value + '°';
                            }
                        },
                        grid: {
                            color: '#3d3d3d'
                        }
                    }
                }
            }
        });
    }
    
    if (graph2Canvas) {
        const ctx2 = graph2Canvas.getContext('2d');
        metricsGraph2 = new Chart(ctx2, {
            type: 'line',
            data: {
                labels: [],
                datasets: []
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: {
                        display: true,
                        labels: {
                            color: '#ffffff'
                        }
                    },
                    tooltip: {
                        enabled: true,
                        backgroundColor: 'rgba(45, 45, 45, 0.9)',
                        titleColor: '#ffffff',
                        bodyColor: '#ffffff',
                        borderColor: '#4a9eff',
                        borderWidth: 1,
                        callbacks: {
                            label: function(context) {
                                return context.dataset.label + ': ' + context.parsed.y.toFixed(4) + '°';
                            }
                        }
                    }
                },
                interaction: {
                    intersect: false,
                    mode: 'index'
                },
                scales: {
                    x: {
                        display: true,
                        title: {
                            display: true,
                            text: 'Time (minutes from now)',
                            color: '#ffffff',
                            font: {
                                size: 12
                            }
                        },
                        ticks: {
                            color: '#ffffff'
                        },
                        grid: {
                            color: '#3d3d3d'
                        }
                    },
                    y: {
                        display: true,
                        min: -180,
                        max: 180,
                        title: {
                            display: true,
                            text: 'Longitude (°)',
                            color: '#ffffff',
                            font: {
                                size: 12
                            }
                        },
                        ticks: {
                            color: '#ffffff',
                            stepSize: 60,
                            callback: function(value) {
                                return value + '°';
                            }
                        },
                        grid: {
                            color: '#3d3d3d'
                        }
                    }
                }
            }
        });
    }
}

/**
 * Update graphs with historical longitude and latitude data
 */
function updateGraphsWithHistoricalData() {
    // Only show data if we have received API response (indicated by historicalPredictions being set)
    // This prevents showing stale data from previous sessions or before API response
    const hasApiData = typeof window !== 'undefined' && window.historicalPredictions !== undefined;
    
    if (!hasApiData) {
        console.log('Metrics: Waiting for API response before displaying data');
        // Clear graphs and map if no API data yet
        if (metricsGraph1) {
            metricsGraph1.data.labels = [];
            metricsGraph1.data.datasets = [];
            metricsGraph1.update();
        }
        if (metricsGraph2) {
            metricsGraph2.data.labels = [];
            metricsGraph2.data.datasets = [];
            metricsGraph2.update();
        }
        // Clear map paths
        metricsMapPolylines.forEach(polyline => {
            if (polyline && metricsMap && metricsMap.hasLayer(polyline)) {
                metricsMap.removeLayer(polyline);
            }
        });
        metricsMapPolylines = [];
        return;
    }
    
    // Access locationHistory from the global scope (created in main.js)
    // Since locationHistory is created in main.js, we'll access it via window
    // or create our own instance that loads from sessionStorage
    let historicalLocations = [];
    
    try {
        // Try to access the global locationHistory if available
        if (typeof window !== 'undefined' && window.locationHistory) {
            historicalLocations = window.locationHistory.getLocations();
        } else {
            // Fallback: load directly from sessionStorage
            const stored = sessionStorage.getItem('iss_location_history');
            if (stored) {
                historicalLocations = JSON.parse(stored);
            }
        }
        
        // Filter out predictions and empty entries first, sort by timestamp (newest first)
        const validLocationsUnsorted = historicalLocations.filter(loc => {
            if (!loc || loc.isPredicted || loc.isEmpty) return false;
            if (loc.latitude === null || loc.latitude === undefined) return false;
            if (loc.longitude === null || loc.longitude === undefined) return false;
            return true;
        });
        
        if (validLocationsUnsorted.length === 0) {
            console.log('No valid historical location data available for metrics');
            return;
        }
        
        // Sort by timestamp (newest first) to find the most recent data point
        const sortedByNewest = [...validLocationsUnsorted].sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
        const newestTimestamp = new Date(sortedByNewest[0].timestamp);
        
        // Calculate cutoff time (90 minutes before the newest data point)
        // Use a small buffer (1 second) to ensure we include points exactly at the boundary
        const cutoffTime = new Date(newestTimestamp.getTime() - 90 * 60 * 1000 - 1000);
        
        // Filter to last 90 minutes and sort by timestamp (oldest first) for display
        const validLocations = validLocationsUnsorted
            .filter(loc => {
                const locTime = new Date(loc.timestamp);
                return locTime >= cutoffTime && locTime <= newestTimestamp;
            })
            .sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
        
        if (validLocations.length === 0) {
            console.log('No valid historical location data available for metrics');
            return;
        }
        
        // Extract data for graphs
        // Calculate relative time offsets in minutes from the newest data point (0 = most recent)
        // Use actual minute differences, then round labels for display only
        const labels = validLocations.map(loc => {
            const locTime = new Date(loc.timestamp);
            const minutesDiff = (locTime - newestTimestamp) / (1000 * 60);
            // Round to nearest 5-minute interval for display labels (e.g., -86 -> -85, -81 -> -80)
            const roundedMinutes = Math.round(minutesDiff / 5) * 5;
            return roundedMinutes.toString();
        });
        
        // Store actual minute differences for matching predictions
        const actualMinutesDiff = validLocations.map(loc => {
            const locTime = new Date(loc.timestamp);
            return (locTime - newestTimestamp) / (1000 * 60);
        });
        
        // Debug: log the time range
        if (validLocations.length > 0) {
            const oldestTime = new Date(validLocations[0].timestamp);
            const oldestMinutes = Math.floor((oldestTime - newestTimestamp) / (1000 * 60));
            console.log(`Metrics graph time range: ${oldestMinutes} to 0 minutes (${validLocations.length} data points)`);
        }
        
        const longitudeData = validLocations.map(loc => parseFloat(loc.longitude));
        const latitudeData = validLocations.map(loc => parseFloat(loc.latitude));
        
        // Process historical predictions if available
        const historicalPredictions = (typeof window !== 'undefined' && window.historicalPredictions) || null;
        
        // Helper function to process prediction data for a graph
        const processPredictionsForGraph = (predictions, isLongitude) => {
            if (!predictions || predictions.length === 0) return null;
            
            // Create a map of predicted timestamp to coordinate value
            // Match predictions to actual historical timestamps, not rounded labels
            const predictionData = actualMinutesDiff.map(actualMinDiff => {
                // Find the prediction closest to this actual timestamp
                let closestPred = null;
                let closestDiff = Infinity;
                
                predictions.forEach(pred => {
                    const predTime = new Date(pred.timestamp);
                    const predMinutesDiff = (predTime - newestTimestamp) / (1000 * 60);
                    const diff = Math.abs(predMinutesDiff - actualMinDiff);
                    
                    // Only consider predictions within 2.5 minutes (half of 5-minute interval)
                    if (diff < 2.5 && diff < closestDiff) {
                        closestDiff = diff;
                        closestPred = pred;
                    }
                });
                
                if (closestPred) {
                    const coordValue = isLongitude ? parseFloat(closestPred.longitude) : parseFloat(closestPred.latitude);
                    return !isNaN(coordValue) ? coordValue : null;
                }
                return null;
            });
            
            // Check if we have any valid data points
            const hasData = predictionData.some(val => val !== null);
            return hasData ? predictionData : null;
        };
        
        // Process predictions for each time period
        const pred90Lat = historicalPredictions ? processPredictionsForGraph(historicalPredictions.predictions_90min_ago, false) : null;
        const pred60Lat = historicalPredictions ? processPredictionsForGraph(historicalPredictions.predictions_60min_ago, false) : null;
        const pred30Lat = historicalPredictions ? processPredictionsForGraph(historicalPredictions.predictions_30min_ago, false) : null;
        
        const pred90Lon = historicalPredictions ? processPredictionsForGraph(historicalPredictions.predictions_90min_ago, true) : null;
        const pred60Lon = historicalPredictions ? processPredictionsForGraph(historicalPredictions.predictions_60min_ago, true) : null;
        const pred30Lon = historicalPredictions ? processPredictionsForGraph(historicalPredictions.predictions_30min_ago, true) : null;
        
        // Update Graph 1 (Latitude)
        if (metricsGraph1) {
            const datasets = [{
                label: 'Historical Latitude',
                data: latitudeData,
                borderColor: '#FF6B6B',
                backgroundColor: 'rgba(255, 107, 107, 0.1)',
                tension: 0.4,
                fill: false,
                pointRadius: 0,
                pointHoverRadius: 4
            }];
            
            // Add prediction datasets
            if (pred90Lat) {
                datasets.push({
                    label: 'Predicted (90 min ago)',
                    data: pred90Lat,
                    borderColor: '#FFA500',
                    backgroundColor: 'transparent',
                    borderDash: [5, 5],
                    tension: 0.4,
                    fill: false,
                    pointRadius: 0,
                    pointHoverRadius: 3,
                    spanGaps: false
                });
            }
            if (pred60Lat) {
                datasets.push({
                    label: 'Predicted (60 min ago)',
                    data: pred60Lat,
                    borderColor: '#FFD700',
                    backgroundColor: 'transparent',
                    borderDash: [5, 5],
                    tension: 0.4,
                    fill: false,
                    pointRadius: 0,
                    pointHoverRadius: 3,
                    spanGaps: false
                });
            }
            if (pred30Lat) {
                datasets.push({
                    label: 'Predicted (30 min ago)',
                    data: pred30Lat,
                    borderColor: '#FFFF00',
                    backgroundColor: 'transparent',
                    borderDash: [5, 5],
                    tension: 0.4,
                    fill: false,
                    pointRadius: 0,
                    pointHoverRadius: 3,
                    spanGaps: false
                });
            }
            
            metricsGraph1.data.labels = labels;
            metricsGraph1.data.datasets = datasets;
            metricsGraph1.update();
        }
        
        // Update Graph 2 (Longitude)
        if (metricsGraph2) {
            const datasets = [{
                label: 'Historical Longitude',
                data: longitudeData,
                borderColor: '#4a9eff',
                backgroundColor: 'rgba(74, 158, 255, 0.1)',
                tension: 0.4,
                fill: false,
                pointRadius: 0,
                pointHoverRadius: 4
            }];
            
            // Add prediction datasets
            if (pred90Lon) {
                datasets.push({
                    label: 'Predicted (90 min ago)',
                    data: pred90Lon,
                    borderColor: '#FFA500',
                    backgroundColor: 'transparent',
                    borderDash: [5, 5],
                    tension: 0.4,
                    fill: false,
                    pointRadius: 0,
                    pointHoverRadius: 3,
                    spanGaps: false
                });
            }
            if (pred60Lon) {
                datasets.push({
                    label: 'Predicted (60 min ago)',
                    data: pred60Lon,
                    borderColor: '#FFD700',
                    backgroundColor: 'transparent',
                    borderDash: [5, 5],
                    tension: 0.4,
                    fill: false,
                    pointRadius: 0,
                    pointHoverRadius: 3,
                    spanGaps: false
                });
            }
            if (pred30Lon) {
                datasets.push({
                    label: 'Predicted (30 min ago)',
                    data: pred30Lon,
                    borderColor: '#FFFF00',
                    backgroundColor: 'transparent',
                    borderDash: [5, 5],
                    tension: 0.4,
                    fill: false,
                    pointRadius: 0,
                    pointHoverRadius: 3,
                    spanGaps: false
                });
            }
            
            metricsGraph2.data.labels = labels;
            metricsGraph2.data.datasets = datasets;
            metricsGraph2.update();
        }
        
        // Update map with historical paths
        updateMetricsMapWithPaths(validLocations, historicalPredictions, newestTimestamp);
        
        console.log(`Updated metrics graphs with ${validLocations.length} historical data points`);
    } catch (error) {
        console.error('Error updating graphs with historical data:', error);
    }
}

/**
 * Initialize legend toggle functionality for metrics map
 */
function initMetricsLegendToggle() {
    const legendTrueHistorical = document.getElementById('metrics-legend-true-historical');
    const legendPredicted90min = document.getElementById('metrics-legend-predicted-90min');
    const legendPredicted60min = document.getElementById('metrics-legend-predicted-60min');
    const legendPredicted30min = document.getElementById('metrics-legend-predicted-30min');
    
    if (legendTrueHistorical) {
        legendTrueHistorical.addEventListener('click', () => {
            metricsPathVisibility.trueHistorical = !metricsPathVisibility.trueHistorical;
            updateMetricsLegendVisualState();
            redrawMetricsMapPaths();
        });
    }
    
    if (legendPredicted90min) {
        legendPredicted90min.addEventListener('click', () => {
            metricsPathVisibility.predicted90min = !metricsPathVisibility.predicted90min;
            updateMetricsLegendVisualState();
            redrawMetricsMapPaths();
        });
    }
    
    if (legendPredicted60min) {
        legendPredicted60min.addEventListener('click', () => {
            metricsPathVisibility.predicted60min = !metricsPathVisibility.predicted60min;
            updateMetricsLegendVisualState();
            redrawMetricsMapPaths();
        });
    }
    
    if (legendPredicted30min) {
        legendPredicted30min.addEventListener('click', () => {
            metricsPathVisibility.predicted30min = !metricsPathVisibility.predicted30min;
            updateMetricsLegendVisualState();
            redrawMetricsMapPaths();
        });
    }
    
    updateMetricsLegendVisualState();
}

/**
 * Update legend visual state for metrics map
 */
function updateMetricsLegendVisualState() {
    const legendTrueHistorical = document.getElementById('metrics-legend-true-historical');
    const legendPredicted90min = document.getElementById('metrics-legend-predicted-90min');
    const legendPredicted60min = document.getElementById('metrics-legend-predicted-60min');
    const legendPredicted30min = document.getElementById('metrics-legend-predicted-30min');
    
    if (legendTrueHistorical) {
        if (metricsPathVisibility.trueHistorical) {
            legendTrueHistorical.classList.remove('disabled');
        } else {
            legendTrueHistorical.classList.add('disabled');
        }
    }
    
    if (legendPredicted90min) {
        if (metricsPathVisibility.predicted90min) {
            legendPredicted90min.classList.remove('disabled');
        } else {
            legendPredicted90min.classList.add('disabled');
        }
    }
    
    if (legendPredicted60min) {
        if (metricsPathVisibility.predicted60min) {
            legendPredicted60min.classList.remove('disabled');
        } else {
            legendPredicted60min.classList.add('disabled');
        }
    }
    
    if (legendPredicted30min) {
        if (metricsPathVisibility.predicted30min) {
            legendPredicted30min.classList.remove('disabled');
        } else {
            legendPredicted30min.classList.add('disabled');
        }
    }
}

// Store data for redrawing metrics map paths
let metricsMapPathData = {
    historicalLocations: null,
    historicalPredictions: null,
    newestTimestamp: null
};

/**
 * Update the metrics map with historical paths and predictions
 */
function updateMetricsMapWithPaths(historicalLocations, historicalPredictions, newestTimestamp) {
    if (!metricsMap) return;
    
    // Store data for redrawing
    metricsMapPathData.historicalLocations = historicalLocations;
    metricsMapPathData.historicalPredictions = historicalPredictions;
    metricsMapPathData.newestTimestamp = newestTimestamp;
    
    redrawMetricsMapPaths();
}

/**
 * Redraw metrics map paths based on visibility settings
 */
function redrawMetricsMapPaths() {
    if (!metricsMap) return;
    
    // Clear existing polylines
    metricsMapPolylines.forEach(polyline => {
        if (polyline && metricsMap.hasLayer(polyline)) {
            metricsMap.removeLayer(polyline);
        }
    });
    metricsMapPolylines = [];
    
    const { historicalLocations, historicalPredictions, newestTimestamp } = metricsMapPathData;
    
    // Draw true historical path
    if (metricsPathVisibility.trueHistorical && historicalLocations && historicalLocations.length > 0) {
        const truePathPoints = historicalLocations.map(loc => [
            parseFloat(loc.latitude),
            parseFloat(loc.longitude)
        ]);
        
        // Normalize longitude for path drawing
        const normalizedTruePath = normalizeLongitudePathForMetrics(truePathPoints);
        
        // Draw path with multiple offsets to handle longitude wrapping
        for (let offset = -720; offset <= 720; offset += 360) {
            const offsetPathPoints = normalizedTruePath.map(point => [point[0], point[1] + offset]);
            const polyline = L.polyline(offsetPathPoints, {
                color: '#FF6B6B',
                weight: 3,
                opacity: 0.8,
                smoothFactor: 1.0
            }).addTo(metricsMap);
            polyline.bindPopup('True Historical Path');
            metricsMapPolylines.push(polyline);
        }
    }
    
    // Draw prediction paths if available
    if (historicalPredictions) {
        // Helper function to convert predictions to map points
        const predictionsToPoints = (predictions) => {
            if (!predictions || predictions.length === 0) return null;
            
            // Group by predicted timestamp (rounded to 5 minutes) and calculate centroids
            const predictionsByTimestamp = {};
            predictions.forEach(pred => {
                const predTime = new Date(pred.timestamp);
                const minutesDiff = (predTime - newestTimestamp) / (1000 * 60);
                const roundedMinutes = Math.round(minutesDiff / 5) * 5;
                const timestampKey = roundedMinutes.toString();
                
                if (!predictionsByTimestamp[timestampKey]) {
                    predictionsByTimestamp[timestampKey] = [];
                }
                predictionsByTimestamp[timestampKey].push([
                    parseFloat(pred.latitude),
                    parseFloat(pred.longitude)
                ]);
            });
            
            // Calculate centroids for each timestamp group
            const centroidPoints = [];
            const sortedTimestamps = Object.keys(predictionsByTimestamp).sort((a, b) => parseFloat(a) - parseFloat(b));
            
            sortedTimestamps.forEach(timestampKey => {
                const points = predictionsByTimestamp[timestampKey];
                if (points.length === 0) return;
                
                // Calculate centroid (average of all points for this timestamp)
                let sumLat = 0;
                const lonValues = [];
                
                points.forEach(([lat, lon]) => {
                    sumLat += lat;
                    lonValues.push(lon);
                });
                
                // For longitude, calculate centroid handling wrapping
                const refLon = lonValues[0];
                let sumOffset = 0;
                
                lonValues.forEach(lon => {
                    let offset = lon - refLon;
                    if (offset > 180) offset -= 360;
                    if (offset < -180) offset += 360;
                    sumOffset += offset;
                });
                
                const avgOffset = sumOffset / lonValues.length;
                let centroidLon = refLon + avgOffset;
                
                // Normalize back to [-180, 180]
                while (centroidLon > 180) centroidLon -= 360;
                while (centroidLon < -180) centroidLon += 360;
                
                const centroidLat = sumLat / points.length;
                centroidPoints.push([centroidLat, centroidLon]);
            });
            
            return centroidPoints.length > 0 ? centroidPoints : null;
        };
        
        // Draw 90-minute predictions (orange)
        if (metricsPathVisibility.predicted90min && historicalPredictions.predictions_90min_ago) {
            const points90 = predictionsToPoints(historicalPredictions.predictions_90min_ago);
            if (points90 && points90.length > 0) {
                const normalized90 = normalizeLongitudePathForMetrics(points90);
                for (let offset = -720; offset <= 720; offset += 360) {
                    const offsetPathPoints = normalized90.map(point => [point[0], point[1] + offset]);
                    const polyline = L.polyline(offsetPathPoints, {
                        color: '#FFA500',
                        weight: 2.5,
                        opacity: 0.7,
                        dashArray: '5, 5',
                        smoothFactor: 1.0
                    }).addTo(metricsMap);
                    polyline.bindPopup('Predicted Path (90 min ago)');
                    metricsMapPolylines.push(polyline);
                }
            }
        }
        
        // Draw 60-minute predictions (gold)
        if (metricsPathVisibility.predicted60min && historicalPredictions.predictions_60min_ago) {
            const points60 = predictionsToPoints(historicalPredictions.predictions_60min_ago);
            if (points60 && points60.length > 0) {
                const normalized60 = normalizeLongitudePathForMetrics(points60);
                for (let offset = -720; offset <= 720; offset += 360) {
                    const offsetPathPoints = normalized60.map(point => [point[0], point[1] + offset]);
                    const polyline = L.polyline(offsetPathPoints, {
                        color: '#FFD700',
                        weight: 2.5,
                        opacity: 0.7,
                        dashArray: '5, 5',
                        smoothFactor: 1.0
                    }).addTo(metricsMap);
                    polyline.bindPopup('Predicted Path (60 min ago)');
                    metricsMapPolylines.push(polyline);
                }
            }
        }
        
        // Draw 30-minute predictions (yellow)
        if (metricsPathVisibility.predicted30min && historicalPredictions.predictions_30min_ago) {
            const points30 = predictionsToPoints(historicalPredictions.predictions_30min_ago);
            if (points30 && points30.length > 0) {
                const normalized30 = normalizeLongitudePathForMetrics(points30);
                for (let offset = -720; offset <= 720; offset += 360) {
                    const offsetPathPoints = normalized30.map(point => [point[0], point[1] + offset]);
                    const polyline = L.polyline(offsetPathPoints, {
                        color: '#FFFF00',
                        weight: 2.5,
                        opacity: 0.7,
                        dashArray: '5, 5',
                        smoothFactor: 1.0
                    }).addTo(metricsMap);
                    polyline.bindPopup('Predicted Path (30 min ago)');
                    metricsMapPolylines.push(polyline);
                }
            }
        }
    }
    
    // Fit map bounds to show all paths
    if (metricsMapPolylines.length > 0) {
        const group = new L.featureGroup(metricsMapPolylines);
        metricsMap.fitBounds(group.getBounds().pad(0.1));
    }
}

/**
 * Normalize longitude path for metrics map (handles wrapping)
 */
function normalizeLongitudePathForMetrics(points) {
    if (!points || points.length === 0) return [];
    
    const normalized = [];
    let lastLon = null;
    
    points.forEach((point, index) => {
        const [lat, lon] = point;
        
        if (lastLon === null) {
            normalized.push([lat, lon]);
            lastLon = lon;
        } else {
            // Calculate shortest path
            let normalizedLon = lon;
            const diff = lon - lastLon;
            
            if (Math.abs(diff) > 180) {
                // Need to wrap
                if (diff > 0) {
                    normalizedLon = lon - 360;
                } else {
                    normalizedLon = lon + 360;
                }
            }
            
            normalized.push([lat, normalizedLon]);
            lastLon = normalizedLon;
        }
    });
    
    return normalized;
}

/**
 * Handle metrics view being shown (for tab navigation)
 */
function handleMetricsViewShown() {
    if (metricsMap) {
        // Invalidate map size to fix rendering after being hidden
        setTimeout(() => {
            metricsMap.invalidateSize();
        }, 100);
    }
    
    // Refresh graphs with latest data when view is shown
    updateGraphsWithHistoricalData();
}

// Make updateGraphsWithHistoricalData available globally so main.js can trigger it
if (typeof window !== 'undefined') {
    window.updateMetricsGraphs = updateGraphsWithHistoricalData;
}

// Export functions
export { initMetricsPage, handleMetricsViewShown };

