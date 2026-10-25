import { initMetricsTables } from './metricsTable.js';

const REFRESH_AFTER_MS = 5 * 60 * 1000; // data updates every 5 minutes

let lastLoadedAt = 0;
let loading = false;

async function ensureLoaded() {
    // Load on first view, and reload when the tab is shown again after the data went stale
    if (loading || (lastLoadedAt && Date.now() - lastLoadedAt < REFRESH_AFTER_MS)) {
        return;
    }
    loading = true;
    try {
        await initMetricsTables();
        lastLoadedAt = Date.now();
    } catch (error) {
        console.error('[metrics-table-init] init failed:', error);
    } finally {
        loading = false;
    }
}

window.addEventListener('metricsTablesViewShown', () => {
    ensureLoaded();
});
