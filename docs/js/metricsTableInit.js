import { initMetricsTables } from './metricsTable.js';

let initialized = false;
let loading = false;

async function ensureInitialized() {
    if (initialized || loading) {
        return;
    }
    loading = true;
    try {
        await initMetricsTables();
        initialized = true;
    } catch (error) {
        console.error('[metrics-table-init] init failed:', error);
    } finally {
        loading = false;
    }
}

window.addEventListener('metricsTablesViewShown', () => {
    ensureInitialized();
});
