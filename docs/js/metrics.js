/**
 * Metrics page functionality for ISS Sky Scanner.
 * 
 * This module handles the initialization of charts and map for the metrics page.
 * Data display logic has been removed - charts and map are ready but empty.
 */

// Global variables for metrics page components
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

// Store data for redrawing metrics map paths
let metricsMapPathData = {
    historicalLocations: null,
    historicalPredictions: null,
    newestTimestamp: null
};

/**
 * Initialize the metrics page components (graphs and map)
 */
function initMetricsPage() {
    initMetricsMap();
    initMetricsGraphs();
    initGraphSelector();
    initMetricsLegendToggle();
    // Add a small delay to ensure locationHistory is available
    setTimeout(() => {
        updateGraphsWithHistoricalData();
    }, 300);
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
                animation: {
                    duration: 0  // Disable animations to prevent conflicts when toggling multiple legend items
                },
                plugins: {
                    legend: {
                        display: true,
                        labels: {
                            color: '#ffffff'
                        },
                        onClick: function(e, legendItem, legend) {
                            // Get the index of the dataset
                            const index = legendItem.datasetIndex;
                            const chart = legend.chart;
                            const meta = chart.getDatasetMeta(index);
                            
                            // Toggle visibility immediately without animation
                            meta.hidden = meta.hidden === null ? !chart.data.datasets[index].hidden : null;
                            chart.update('none'); // 'none' mode skips animations
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
                            title: function(context) {
                                // Show timestamp in tooltip title
                                const dataPoint = context[0].raw;
                                if (dataPoint && typeof dataPoint === 'object' && dataPoint.timestamp) {
                                    const timestamp = new Date(dataPoint.timestamp);
                                    return timestamp.toLocaleString();
                                }
                                return 'Time: ' + context[0].label + ' min';
                            },
                            label: function(context) {
                                // Handle both object format {y: value} and direct number format
                                let value;
                                if (typeof context.raw === 'object' && context.raw !== null && 'y' in context.raw) {
                                    value = context.raw.y;
                                } else {
                                    value = context.parsed.y;
                                }
                                
                                if (typeof value === 'number') {
                                    return context.dataset.label + ': ' + value.toFixed(4) + '°';
                                }
                                return context.dataset.label + ': ' + value + '°';
                            },
                            afterBody: function(context) {
                                // Show local time and UTC timestamp below the value
                                const dataPoint = context[0].raw;
                                if (dataPoint && typeof dataPoint === 'object' && dataPoint.timestamp) {
                                    const timestamp = new Date(dataPoint.timestamp);
                                    const localTime = timestamp.toLocaleString('en-US', {
                                        year: 'numeric',
                                        month: 'short',
                                        day: 'numeric',
                                        hour: 'numeric',
                                        minute: '2-digit',
                                        second: '2-digit',
                                        hour12: true,
                                        timeZoneName: 'short'
                                    });
                                    const utcTime = timestamp.toLocaleString('en-US', {
                                        year: 'numeric',
                                        month: 'short',
                                        day: 'numeric',
                                        hour: 'numeric',
                                        minute: '2-digit',
                                        second: '2-digit',
                                        hour12: true,
                                        timeZone: 'UTC'
                                    }) + ' UTC';
                                    return `Local time: ${localTime}\nUTC: ${utcTime}`;
                                }
                                return '';
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
                animation: {
                    duration: 0  // Disable animations to prevent conflicts when toggling multiple legend items
                },
                plugins: {
                    legend: {
                        display: true,
                        labels: {
                            color: '#ffffff'
                        },
                        onClick: function(e, legendItem, legend) {
                            // Get the index of the dataset
                            const index = legendItem.datasetIndex;
                            const chart = legend.chart;
                            const meta = chart.getDatasetMeta(index);
                            
                            // Toggle visibility immediately without animation
                            meta.hidden = meta.hidden === null ? !chart.data.datasets[index].hidden : null;
                            chart.update('none'); // 'none' mode skips animations
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
                            title: function(context) {
                                // Show timestamp in tooltip title
                                const dataPoint = context[0].raw;
                                if (dataPoint && typeof dataPoint === 'object' && dataPoint.timestamp) {
                                    const timestamp = new Date(dataPoint.timestamp);
                                    return timestamp.toLocaleString();
                                }
                                return 'Time: ' + context[0].label + ' min';
                            },
                            label: function(context) {
                                // Handle both object format {y: value} and direct number format
                                let value;
                                if (typeof context.raw === 'object' && context.raw !== null && 'y' in context.raw) {
                                    value = context.raw.y;
                                } else {
                                    value = context.parsed.y;
                                }
                                
                                if (typeof value === 'number') {
                                    return context.dataset.label + ': ' + value.toFixed(4) + '°';
                                }
                                return context.dataset.label + ': ' + value + '°';
                            },
                            afterBody: function(context) {
                                // Show local time and UTC timestamp below the value
                                const dataPoint = context[0].raw;
                                if (dataPoint && typeof dataPoint === 'object' && dataPoint.timestamp) {
                                    const timestamp = new Date(dataPoint.timestamp);
                                    const localTime = timestamp.toLocaleString('en-US', {
                                        year: 'numeric',
                                        month: 'short',
                                        day: 'numeric',
                                        hour: 'numeric',
                                        minute: '2-digit',
                                        second: '2-digit',
                                        hour12: true,
                                        timeZoneName: 'short'
                                    });
                                    const utcTime = timestamp.toLocaleString('en-US', {
                                        year: 'numeric',
                                        month: 'short',
                                        day: 'numeric',
                                        hour: 'numeric',
                                        minute: '2-digit',
                                        second: '2-digit',
                                        hour12: true,
                                        timeZone: 'UTC'
                                    }) + ' UTC';
                                    return `Local time: ${localTime}\nUTC: ${utcTime}`;
                                }
                                return '';
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

/**
 * Update graphs with historical data (last 90 minutes of true ISS path)
 */
function updateGraphsWithHistoricalData() {
    try {
        // Get historical locations from locationHistory
        let historicalLocations = [];
        console.log('[metrics] updateGraphsWithHistoricalData: starting refresh');
        
        // Try to get data from window.locationHistory first
        if (typeof window !== 'undefined' && window.locationHistory) {
            try {
                const locations = window.locationHistory.getLocations();
                if (locations && Array.isArray(locations) && locations.length > 0) {
                    historicalLocations = locations;
                    console.log('[metrics] updateGraphsWithHistoricalData: Retrieved', historicalLocations.length, 'locations from window.locationHistory');
                } else {
                    console.warn('[metrics] updateGraphsWithHistoricalData: getLocations() returned empty or invalid data:', locations);
                    // Fall through to sessionStorage fallback
                }
            } catch (error) {
                console.error('[metrics] updateGraphsWithHistoricalData: Error accessing window.locationHistory:', error);
                // Fall through to sessionStorage fallback
            }
        }
        
        // Fallback: load directly from sessionStorage if locationHistory didn't work
        if (historicalLocations.length === 0) {
            console.log('[metrics] updateGraphsWithHistoricalData: Trying sessionStorage fallback');
            const stored = sessionStorage.getItem('iss_location_history');
            if (stored) {
                try {
                    const allData = JSON.parse(stored);
                    historicalLocations = allData.filter(loc => !loc.isPredicted && !loc.isEmpty);
                    console.log('[metrics] updateGraphsWithHistoricalData: Retrieved', historicalLocations.length, 'locations from sessionStorage');
                } catch (error) {
                    console.error('[metrics] updateGraphsWithHistoricalData: Error parsing sessionStorage data:', error);
                }
            } else {
                console.warn('[metrics] updateGraphsWithHistoricalData: No data in sessionStorage either');
            }
        }
        
        // Filter out predictions and empty entries
        const validLocations = historicalLocations.filter(loc => {
            if (!loc || loc.isPredicted || loc.isEmpty) return false;
            if (loc.latitude === null || loc.latitude === undefined) return false;
            if (loc.longitude === null || loc.longitude === undefined) return false;
            return true;
        });
        
        if (validLocations.length === 0) {
            console.log('[metrics] No valid historical location data available for metrics');
            // Clear graphs and map
            clearMetricsDisplay();
            return;
        }
        console.log('[metrics] validLocations count:', validLocations.length);
        
        // Sort by timestamp (newest first) to find the most recent data point
        const sortedByNewest = [...validLocations].sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
        const newestRawTimestamp = new Date(sortedByNewest[0].timestamp);
        
        // Round newest timestamp down to the nearest 5-minute interval (floor)
        // This gives us the rightmost point of the graph (0 minutes)
        // Use UTC methods for consistency with Firestore timestamps
        const newestMinutes = Math.floor(newestRawTimestamp.getUTCMinutes() / 5) * 5;
        const newestTimestamp = new Date(newestRawTimestamp);
        newestTimestamp.setUTCMinutes(newestMinutes);
        newestTimestamp.setUTCSeconds(0);
        newestTimestamp.setUTCMilliseconds(0);
        
        // Calculate the leftmost timestamp (90 minutes before the rounded newest)
        // Ensure it's also on a 5-minute boundary
        const leftmostTimestamp = new Date(newestTimestamp.getTime() - 90 * 60 * 1000);
        const leftmostMinutes = Math.floor(leftmostTimestamp.getUTCMinutes() / 5) * 5;
        leftmostTimestamp.setUTCMinutes(leftmostMinutes);
        leftmostTimestamp.setUTCSeconds(0);
        leftmostTimestamp.setUTCMilliseconds(0);
        
        // Create array of 5-minute interval timestamps from leftmost to newest
        // Should create exactly 19 intervals (from -90 to 0 minutes, inclusive)
        const intervalTimestamps = [];
        for (let ts = new Date(leftmostTimestamp); ts <= newestTimestamp; ts = new Date(ts.getTime() + 5 * 60 * 1000)) {
            intervalTimestamps.push(new Date(ts));
        }
        
        // Verify we have the expected number of intervals
        if (intervalTimestamps.length !== 19) {
            console.warn(`Expected 19 intervals but got ${intervalTimestamps.length}`);
        }
        
        // Calculate cutoff time (90 minutes before newest, with small buffer)
        const cutoffTime = new Date(newestTimestamp.getTime() - 90 * 60 * 1000 - 1000);
        
        // Filter to last 90 minutes and sort by timestamp (oldest first) for display
        const filteredLocations = validLocations
            .filter(loc => {
                const locTime = new Date(loc.timestamp);
                return locTime >= cutoffTime && locTime <= newestRawTimestamp;
            })
            .sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
        
        if (filteredLocations.length === 0) {
            console.warn('[metrics] No valid historical data in the last 90 minutes; charts will stay empty.');
            clearMetricsDisplay();
            return;
        }
        console.log('[metrics] filteredLocations (<=90 min) count:', filteredLocations.length);
        console.log('[metrics] newestTimestamp rounded:', newestTimestamp.toISOString(), 'leftmostTimestamp:', leftmostTimestamp.toISOString());
        
        // Create labels for the graph (minutes from newest, e.g., -90, -85, ..., -5, 0)
        const labels = intervalTimestamps.map((ts) => {
            const minutesFromNewest = (ts - newestTimestamp) / (1000 * 60);
            return minutesFromNewest.toString();
        });
        
        // Create a map of historical locations by their timestamp interval
        const locationByInterval = new Map();
        filteredLocations.forEach(loc => {
            const locTime = new Date(loc.timestamp);
            // Find the closest interval timestamp
            let closestInterval = null;
            let closestDiff = Infinity;
            intervalTimestamps.forEach(intervalTs => {
                const diff = Math.abs(locTime - intervalTs);
                if (diff < closestDiff) {
                    closestDiff = diff;
                    closestInterval = intervalTs;
                }
            });
            // Only match if within 2.5 minutes (half of 5-minute interval)
            if (closestInterval && closestDiff < 2.5 * 60 * 1000 && !locationByInterval.has(closestInterval.getTime())) {
                locationByInterval.set(closestInterval.getTime(), loc);
            }
        });
        
        // Build data arrays using interval timestamps (store timestamps with data)
        const longitudeData = intervalTimestamps.map(intervalTs => {
            const loc = locationByInterval.get(intervalTs.getTime());
            if (loc) {
                return {
                    y: parseFloat(loc.longitude),
                    timestamp: intervalTs.toISOString()
                };
            }
            return {
                y: null,
                timestamp: intervalTs.toISOString()
            };
        });
        
        const latitudeData = intervalTimestamps.map(intervalTs => {
            const loc = locationByInterval.get(intervalTs.getTime());
            if (loc) {
                return {
                    y: parseFloat(loc.latitude),
                    timestamp: intervalTs.toISOString()
                };
            }
            return {
                y: null,
                timestamp: intervalTs.toISOString()
            };
        });
        
        // Get historical predictions if available
        const historicalPredictions = (typeof window !== 'undefined' && window.historicalPredictions) || null;
        
        // Filter predictions to only include those within the last 90 minutes time range
        // (from leftmostTimestamp to newestTimestamp)
        const filterPredictionsInRange = (predictions) => {
            if (!predictions || predictions.length === 0) return [];
            return predictions.filter(pred => {
                const predTime = new Date(pred.timestamp);
                return predTime >= leftmostTimestamp && predTime <= newestTimestamp;
            });
        };
        
        // Process all three prediction sets (90, 60, 30 minutes ago)
        const predictions90min = filterPredictionsInRange(historicalPredictions?.predictions_90min_ago || []);
        const predictions60min = filterPredictionsInRange(historicalPredictions?.predictions_60min_ago || []);
        const predictions30min = filterPredictionsInRange(historicalPredictions?.predictions_30min_ago || []);
        
        console.log(`[metrics] Processing predictions for graphs: 90min=${predictions90min.length}, 60min=${predictions60min.length}, 30min=${predictions30min.length}`);
        
        // Process each prediction set for both latitude and longitude
        const pred90LatData = processPredictionsForGraph(predictions90min, intervalTimestamps, newestTimestamp, false);
        const pred90LonData = processPredictionsForGraph(predictions90min, intervalTimestamps, newestTimestamp, true);
        const pred60LatData = processPredictionsForGraph(predictions60min, intervalTimestamps, newestTimestamp, false);
        const pred60LonData = processPredictionsForGraph(predictions60min, intervalTimestamps, newestTimestamp, true);
        const pred30LatData = processPredictionsForGraph(predictions30min, intervalTimestamps, newestTimestamp, false);
        const pred30LonData = processPredictionsForGraph(predictions30min, intervalTimestamps, newestTimestamp, true);
        
        const logPredictionData = (label, latData, lonData) => {
            const latCount = latData ? latData.filter(v => v && v.y !== null).length : 0;
            const lonCount = lonData ? lonData.filter(v => v && v.y !== null).length : 0;
            console.log(`[metrics] ${label} prediction points -> lat:${latCount} lon:${lonCount}`);
        };
        logPredictionData('90min', pred90LatData, pred90LonData);
        logPredictionData('60min', pred60LatData, pred60LonData);
        logPredictionData('30min', pred30LatData, pred30LonData);
        
        // Update graphs with data (including all predictions)
        updateGraphsWithData(labels, latitudeData, longitudeData, 
            pred90LatData, pred90LonData, 
            pred60LatData, pred60LonData,
            pred30LatData, pred30LonData);
        
        // Update map with path (including all predictions)
        updateMetricsMapWithPaths(filteredLocations, newestTimestamp, historicalPredictions);
        
        console.log(`Updated metrics display with ${filteredLocations.length} historical data points`);
        if (predictions90min.length > 0) {
            console.log(`Added ${predictions90min.length} predictions from 90 minutes ago`);
        }
        if (predictions60min.length > 0) {
            console.log(`Added ${predictions60min.length} predictions from 60 minutes ago`);
        }
        if (predictions30min.length > 0) {
            console.log(`Added ${predictions30min.length} predictions from 30 minutes ago`);
        }
        
    } catch (error) {
        console.error('Error updating graphs with historical data:', error);
        clearMetricsDisplay();
    }
}

/**
 * Process predictions to match graph intervals
 * 
 * @param {Array} predictions - Array of prediction objects with timestamp, latitude, longitude
 * @param {Array} intervalTimestamps - Array of Date objects representing 5-minute intervals
 * @param {Date} newestTimestamp - The newest timestamp (0 minutes reference point)
 * @param {boolean} isLongitude - Whether to extract longitude (true) or latitude (false)
 * @returns {Array} Array of values matching intervalTimestamps, or null if no data
 */
function processPredictionsForGraph(predictions, intervalTimestamps, newestTimestamp, isLongitude) {
            if (!predictions || predictions.length === 0) {
                return intervalTimestamps.map(intervalTs => ({
                    y: null,
                    timestamp: intervalTs.toISOString()
                }));
            }
            
    // Create a map of predictions by their timestamp (rounded to 5 minutes for matching)
    // Both predictions and intervals are on 5-minute boundaries, so we can match exactly
    // Use UTC methods to ensure consistency with Firestore timestamps
    const predictionsByRoundedTime = new Map();
    predictions.forEach(pred => {
        const predTime = new Date(pred.timestamp);
        // Round prediction timestamp to 5-minute interval for matching (using UTC)
        const predMinutes = predTime.getUTCMinutes();
        const roundedMinutes = Math.floor(predMinutes / 5) * 5;
        const roundedPredTime = new Date(predTime);
        roundedPredTime.setUTCMinutes(roundedMinutes);
        roundedPredTime.setUTCSeconds(0);
        roundedPredTime.setUTCMilliseconds(0);
        const roundedTimeKey = roundedPredTime.getTime();
        
        // Store prediction with its rounded timestamp as key
        // If multiple predictions round to same time, keep the one closest to the interval
        if (!predictionsByRoundedTime.has(roundedTimeKey)) {
            predictionsByRoundedTime.set(roundedTimeKey, pred);
        } else {
            // If there's already a prediction for this rounded time, keep the one with smaller difference
            const existingPred = predictionsByRoundedTime.get(roundedTimeKey);
            const existingPredTime = new Date(existingPred.timestamp);
            const existingDiff = Math.abs(existingPredTime - roundedPredTime);
            const currentDiff = Math.abs(predTime - roundedPredTime);
            if (currentDiff < existingDiff) {
                predictionsByRoundedTime.set(roundedTimeKey, pred);
            }
        }
    });
    
    // Match predictions to interval timestamps using exact timestamp matching
    const predictionData = intervalTimestamps.map((intervalTs) => {
        const intervalTimeKey = intervalTs.getTime();
        
        // Try exact match first
        let matchingPred = predictionsByRoundedTime.get(intervalTimeKey);
        
        // If no exact match, try with a small tolerance (up to 2.5 minutes) for edge cases
        if (!matchingPred) {
            const tolerance = 2.5 * 60 * 1000; // 2.5 minutes in milliseconds
            let closestPred = null;
                let closestDiff = Infinity;
                
                predictions.forEach(pred => {
                    const predTime = new Date(pred.timestamp);
                        const diff = Math.abs(predTime - intervalTs);
                if (diff <= tolerance && diff < closestDiff) {
                            closestDiff = diff;
                    closestPred = pred;
                    }
                });
                
            matchingPred = closestPred;
                }
                
        if (matchingPred) {
            const coordValue = isLongitude ? parseFloat(matchingPred.longitude) : parseFloat(matchingPred.latitude);
            if (!isNaN(coordValue)) {
                return {
                    y: coordValue,
                    timestamp: matchingPred.timestamp
                };
            }
        }
        return {
            y: null,
            timestamp: intervalTs.toISOString()
        };
    });
    
    return predictionData;
}

/**
 * Update graphs with latitude and longitude data (including predictions)
 */
function updateGraphsWithData(labels, latitudeData, longitudeData, 
    pred90LatData = null, pred90LonData = null,
    pred60LatData = null, pred60LonData = null,
    pred30LatData = null, pred30LonData = null) {
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
            
        // Add 90-minute-ago predictions if available
        if (pred90LatData) {
            const validPoints = pred90LatData.filter(v => v !== null).length;
            console.log('Adding 90min predictions to latitude graph:', validPoints, 'data points');
            if (validPoints > 0) {
                datasets.push({
                    label: 'Predicted (90 min ago)',
                    data: pred90LatData,
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
        }
        
        // Add 60-minute-ago predictions if available
        if (pred60LatData) {
            const validPoints = pred60LatData.filter(v => v !== null).length;
            console.log('Adding 60min predictions to latitude graph:', validPoints, 'data points');
            if (validPoints > 0) {
                datasets.push({
                    label: 'Predicted (60 min ago)',
                    data: pred60LatData,
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
        }
        
        // Add 30-minute-ago predictions if available
        if (pred30LatData) {
            const validPoints = pred30LatData.filter(v => v !== null).length;
            console.log('Adding 30min predictions to latitude graph:', validPoints, 'data points');
            if (validPoints > 0) {
                datasets.push({
                    label: 'Predicted (30 min ago)',
                    data: pred30LatData,
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
            
        // Add 90-minute-ago predictions if available
        if (pred90LonData) {
            const validPoints = pred90LonData.filter(v => v !== null).length;
            console.log('Adding 90min predictions to longitude graph:', validPoints, 'data points');
            if (validPoints > 0) {
                datasets.push({
                    label: 'Predicted (90 min ago)',
                    data: pred90LonData,
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
        }
        
        // Add 60-minute-ago predictions if available
        if (pred60LonData) {
            const validPoints = pred60LonData.filter(v => v !== null).length;
            console.log('Adding 60min predictions to longitude graph:', validPoints, 'data points');
            if (validPoints > 0) {
                datasets.push({
                    label: 'Predicted (60 min ago)',
                    data: pred60LonData,
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
        }
        
        // Add 30-minute-ago predictions if available
        if (pred30LonData) {
            const validPoints = pred30LonData.filter(v => v !== null).length;
            console.log('Adding 30min predictions to longitude graph:', validPoints, 'data points');
            if (validPoints > 0) {
                datasets.push({
                    label: 'Predicted (30 min ago)',
                    data: pred30LonData,
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
        }
            
            metricsGraph2.data.labels = labels;
            metricsGraph2.data.datasets = datasets;
            metricsGraph2.update();
    }
}

/**
 * Clear metrics display (graphs and map)
 */
function clearMetricsDisplay() {
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
}

/**
 * Update the metrics map with historical path and predictions
 */
function updateMetricsMapWithPaths(historicalLocations, newestTimestamp, historicalPredictions = null) {
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
    
    const { historicalLocations, historicalPredictions } = metricsMapPathData;
    
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
    
    // Draw 90-minute-ago predictions if available
    if (metricsPathVisibility.predicted90min && historicalPredictions?.predictions_90min_ago) {
        const predictions90 = historicalPredictions.predictions_90min_ago;
        // Filter to only show predictions within the last 90 minutes
        const newestTimestamp = metricsMapPathData.newestTimestamp;
        const leftmostTimestamp = newestTimestamp ? new Date(newestTimestamp.getTime() - 90 * 60 * 1000) : null;
        const filtered90 = leftmostTimestamp ? predictions90.filter(pred => {
            const predTime = new Date(pred.timestamp);
            return predTime >= leftmostTimestamp && predTime <= newestTimestamp;
        }) : predictions90;
        
        if (filtered90.length > 0) {
            const predictionPoints = filtered90.map(pred => [
                parseFloat(pred.latitude),
                parseFloat(pred.longitude)
            ]);
            
            const normalizedPredPath = normalizeLongitudePathForMetrics(predictionPoints);
            
            // Draw path with multiple offsets to handle longitude wrapping
            for (let offset = -720; offset <= 720; offset += 360) {
                const offsetPathPoints = normalizedPredPath.map(point => [point[0], point[1] + offset]);
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
    
    // Draw 60-minute-ago predictions if available
    if (metricsPathVisibility.predicted60min && historicalPredictions?.predictions_60min_ago) {
        const predictions60 = historicalPredictions.predictions_60min_ago;
        // Filter to only show predictions within the last 90 minutes
        const newestTimestamp = metricsMapPathData.newestTimestamp;
        const leftmostTimestamp = newestTimestamp ? new Date(newestTimestamp.getTime() - 90 * 60 * 1000) : null;
        const filtered60 = leftmostTimestamp ? predictions60.filter(pred => {
            const predTime = new Date(pred.timestamp);
            return predTime >= leftmostTimestamp && predTime <= newestTimestamp;
        }) : predictions60;
        
        if (filtered60.length > 0) {
            const predictionPoints = filtered60.map(pred => [
                parseFloat(pred.latitude),
                parseFloat(pred.longitude)
            ]);
            
            const normalizedPredPath = normalizeLongitudePathForMetrics(predictionPoints);
            
            // Draw path with multiple offsets to handle longitude wrapping
            for (let offset = -720; offset <= 720; offset += 360) {
                const offsetPathPoints = normalizedPredPath.map(point => [point[0], point[1] + offset]);
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
    
    // Draw 30-minute-ago predictions if available
    if (metricsPathVisibility.predicted30min && historicalPredictions?.predictions_30min_ago) {
        const predictions30 = historicalPredictions.predictions_30min_ago;
        // Filter to only show predictions within the last 90 minutes
        const newestTimestamp = metricsMapPathData.newestTimestamp;
        const leftmostTimestamp = newestTimestamp ? new Date(newestTimestamp.getTime() - 90 * 60 * 1000) : null;
        const filtered30 = leftmostTimestamp ? predictions30.filter(pred => {
            const predTime = new Date(pred.timestamp);
            return predTime >= leftmostTimestamp && predTime <= newestTimestamp;
        }) : predictions30;
        
        if (filtered30.length > 0) {
            const predictionPoints = filtered30.map(pred => [
                parseFloat(pred.latitude),
                parseFloat(pred.longitude)
            ]);
            
            const normalizedPredPath = normalizeLongitudePathForMetrics(predictionPoints);
            
            // Draw path with multiple offsets to handle longitude wrapping
            for (let offset = -720; offset <= 720; offset += 360) {
                const offsetPathPoints = normalizedPredPath.map(point => [point[0], point[1] + offset]);
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
    
    // Fit map bounds to show all paths
    if (metricsMapPolylines.length > 0) {
        const group = new L.featureGroup(metricsMapPolylines);
        metricsMap.fitBounds(group.getBounds().pad(0.1));
    }
}

/**
 * Normalize longitude path for metrics map (handles wrapping).
 * This utility function is kept for future use when drawing paths.
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
    // Add a small delay to ensure locationHistory is available
    setTimeout(() => {
        updateGraphsWithHistoricalData();
    }, 200);
}

// Make updateGraphsWithHistoricalData available globally so main.js can trigger it
if (typeof window !== 'undefined') {
    window.updateMetricsGraphs = updateGraphsWithHistoricalData;
}

// Export functions
export { initMetricsPage, handleMetricsViewShown };
