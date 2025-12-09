import { API_CONFIG } from './metricsTableConfig.js';

const TIMESTAMP_TOLERANCE_MS = 3 * 60 * 1000; // absorb second-level drift

function setStatus(elementId, message, isError = false) {
    const el = document.getElementById(elementId);
    if (!el) return;
    el.textContent = message;
    if (isError) {
        el.classList.add('status-error');
    } else {
        el.classList.remove('status-error');
    }
}

function formatCoord(value) {
    if (value === null || value === undefined || Number.isNaN(value)) {
        return '—';
    }
    return Number(value).toFixed(4);
}

function formatTimestamp(ts) {
    if (!ts) return '—';
    const date = new Date(ts);
    if (Number.isNaN(date.getTime())) return '—';
    return date.toLocaleString();
}

function isValidCoord(value) {
    return value !== null && value !== undefined && !Number.isNaN(Number(value));
}

async function fetchHistory() {
    const url = `${API_CONFIG.HISTORY_RANGE_URL}?minutes=90`;
    const response = await fetch(url);
    if (!response.ok) {
        throw new Error(`History API returned ${response.status}`);
    }
    const data = await response.json();
    return Array.isArray(data?.locations) ? data.locations : [];
}

async function fetchHistoricalPredictions() {
    const url = `${API_CONFIG.PREDICTIONS_URL}?api_key=${API_CONFIG.API_KEY}&historical=true`;
    const response = await fetch(url);
    if (!response.ok) {
        throw new Error(`Predictions API returned ${response.status}`);
    }
    const data = await response.json();
    return data?.historical_predictions || data?.predictions || {};
}

function normalizeHistory(history) {
    const filtered = (history || []).filter((loc) =>
        loc && isValidCoord(loc.latitude) && isValidCoord(loc.longitude) && loc.timestamp
    );

    if (filtered.length === 0) {
        return { locations: [], newest: null };
    }

    const sorted = [...filtered].sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
    const newestTime = new Date(sorted[0].timestamp);

    return { locations: sorted, newest: newestTime };
}

function findPrediction(predictions, targetTime) {
    if (!Array.isArray(predictions) || predictions.length === 0 || !targetTime) {
        return null;
    }

    let best = null;
    let bestDiff = Infinity;

    predictions.forEach((pred) => {
        if (!pred || pred.timestamp === undefined || pred.timestamp === null) return;
        const predTime = new Date(pred.timestamp);
        if (Number.isNaN(predTime.getTime())) return;
        const diff = Math.abs(predTime - targetTime);
        if (diff <= TIMESTAMP_TOLERANCE_MS && diff < bestDiff) {
            best = pred;
            bestDiff = diff;
        }
    });

    return best;
}

function buildRows(locations, predictionsByAge) {
    const pred30 = predictionsByAge.predictions_30min_ago || [];
    const pred60 = predictionsByAge.predictions_60min_ago || [];
    const pred90 = predictionsByAge.predictions_90min_ago || [];

    return locations.map((loc) => {
        const ts = new Date(loc.timestamp);
        const p30 = findPrediction(pred30, ts);
        const p60 = findPrediction(pred60, ts);
        const p90 = findPrediction(pred90, ts);

        return {
            timestamp: loc.timestamp,
            actualLat: Number(loc.latitude),
            actualLon: Number(loc.longitude),
            pred30Lat: isValidCoord(p30?.latitude) ? Number(p30.latitude) : null,
            pred30Lon: isValidCoord(p30?.longitude) ? Number(p30.longitude) : null,
            pred60Lat: isValidCoord(p60?.latitude) ? Number(p60.latitude) : null,
            pred60Lon: isValidCoord(p60?.longitude) ? Number(p60.longitude) : null,
            pred90Lat: isValidCoord(p90?.latitude) ? Number(p90.latitude) : null,
            pred90Lon: isValidCoord(p90?.longitude) ? Number(p90.longitude) : null
        };
    });
}

function renderTable(tableId, rows, coordKey) {
    const table = document.getElementById(tableId);
    if (!table) return;
    const tbody = table.querySelector('tbody');
    if (!tbody) return;

    const html = rows
        .map((row) => {
            const actual = coordKey === 'latitude' ? row.actualLat : row.actualLon;
            const pred30 = coordKey === 'latitude' ? row.pred30Lat : row.pred30Lon;
            const pred60 = coordKey === 'latitude' ? row.pred60Lat : row.pred60Lon;
            const pred90 = coordKey === 'latitude' ? row.pred90Lat : row.pred90Lon;

            return `
                <tr>
                    <td>${formatTimestamp(row.timestamp)}</td>
                    <td>${formatCoord(actual)}</td>
                    <td>${formatCoord(pred30)}</td>
                    <td>${formatCoord(pred60)}</td>
                    <td>${formatCoord(pred90)}</td>
                </tr>
            `;
        })
        .join('');

    tbody.innerHTML = html;
}

export async function initMetricsTables() {
    setStatus('metrics-table-lat-status', 'Loading...');
    setStatus('metrics-table-lon-status', 'Loading...');

    try {
        const [historyLocations, predictionsByAge] = await Promise.all([
            fetchHistory(),
            fetchHistoricalPredictions()
        ]);

        const { locations, newest } = normalizeHistory(historyLocations);

        if (locations.length === 0) {
            setStatus('metrics-table-lat-status', 'No data in last 90 minutes', true);
            setStatus('metrics-table-lon-status', 'No data in last 90 minutes', true);
            renderTable('metrics-table-lat', [], 'latitude');
            renderTable('metrics-table-lon', [], 'longitude');
            return;
        }

        const rows = buildRows(locations, predictionsByAge || {});

        renderTable('metrics-table-lat', rows, 'latitude');
        renderTable('metrics-table-lon', rows, 'longitude');

        const statusText = `Rows: ${rows.length} · Updated ${formatTimestamp(newest)}`;
        setStatus('metrics-table-lat-status', statusText);
        setStatus('metrics-table-lon-status', statusText);
    } catch (error) {
        console.error('[metrics-table] Failed to load tables:', error);
        setStatus('metrics-table-lat-status', 'Unable to load data', true);
        setStatus('metrics-table-lon-status', 'Unable to load data', true);
    }
}
