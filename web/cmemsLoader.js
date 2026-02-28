// StreamingEKELoader.js - Optimized for EKE data (version 1, float32)
console.log('=== Streaming EKE Loader ===');

class StreamingEKELoader {
    constructor() {
        this.metadata = null;
        this.coordsInfo = null;
        this.lonGrid = null;
        this.latGrid = null;
        this.loadedDays = new Map();
        this.activeDate = null;
        this.loadingPromises = new Map();
        this.spatialGrid = null;
        this.gridBounds = null;

        console.log("🌀 Streaming EKE Loader initialized");
    }

    // ==================== INITIALIZATION ====================

    async init() {
        console.log('🔄 Initializing EKE loader...');
        try {
            await this.loadMetadata();
            await this.loadCoordinates();
            await this.loadDay(this.metadata.dates[0]);
            console.log('✅ EKE loader ready');
            return true;
        } catch (error) {
            console.error('❌ EKE loader initialization failed:', error);
            return false;
        }
    }

    async loadMetadata() {
        const response = await fetch('../data/EKE_bin/eke_metadata.json');
        this.metadata = await response.json();
        console.log(`✅ Metadata: ${this.metadata.total_days} days`);
    }

    async loadCoordinates() {
        console.log('🗺️ Loading coordinates...');
        const response = await fetch('../data/EKE_bin/eke_coords.bin');
        const buffer = await response.arrayBuffer();
        const view = new DataView(buffer);

        const version = view.getInt32(0, true);
        const nLat = view.getInt32(4, true);
        const nLon = view.getInt32(8, true);
        const totalCells = nLat * nLon;

        console.log(`  Grid: ${nLat}×${nLon} (${totalCells.toLocaleString()} cells)`);

        const headerSize = 12;
        this.lonGrid = new Float32Array(buffer, headerSize, totalCells);
        this.latGrid = new Float32Array(buffer, headerSize + totalCells * 4, totalCells);

        this.coordsInfo = { nLat, nLon, totalCells };
        this.buildSpatialIndex();

        console.log(`  Coordinates: ${(buffer.byteLength / 1e6).toFixed(1)}MB`);
    }

    buildSpatialIndex() {
        const GRID_SIZE = 50;
        this.spatialGrid = Array(GRID_SIZE).fill().map(() =>
            Array(GRID_SIZE).fill().map(() => [])
        );

        // Find bounds
        let lonMin = Infinity, lonMax = -Infinity;
        let latMin = Infinity, latMax = -Infinity;

        for (let i = 0; i < this.lonGrid.length; i += 100) {
            lonMin = Math.min(lonMin, this.lonGrid[i]);
            lonMax = Math.max(lonMax, this.lonGrid[i]);
            latMin = Math.min(latMin, this.latGrid[i]);
            latMax = Math.max(latMax, this.latGrid[i]);
        }
        this.gridBounds = { lonMin, lonMax, latMin, latMax };

        // Populate grid
        for (let i = 0; i < this.coordsInfo.nLat; i += 5) {
            for (let j = 0; j < this.coordsInfo.nLon; j += 5) {
                const idx = i * this.coordsInfo.nLon + j;
                const lon = this.lonGrid[idx];
                const lat = this.latGrid[idx];

                if (isNaN(lon)) continue;

                const gx = Math.floor((lon - lonMin) / (lonMax - lonMin) * (GRID_SIZE - 1));
                const gy = Math.floor((lat - latMin) / (latMax - latMin) * (GRID_SIZE - 1));

                if (gx >= 0 && gx < GRID_SIZE && gy >= 0 && gy < GRID_SIZE) {
                    const cell = this.spatialGrid[gy][gx];
                    if (cell.length < 20) cell.push({ i, j, idx, lon, lat });
                }
            }
        }
    }

    // ==================== DAY LOADING ====================

    async loadDay(dateKey) {
        if (this.loadingPromises.has(dateKey)) return this.loadingPromises.get(dateKey);
        if (this.loadedDays.has(dateKey)) {
            this.activeDate = dateKey;
            return this.loadedDays.get(dateKey);
        }

        const promise = this._loadDayData(dateKey);
        this.loadingPromises.set(dateKey, promise);

        try {
            const data = await promise;
            this.loadedDays.set(dateKey, data);
            this.activeDate = dateKey;
            this._trimCache();
            return data;
        } finally {
            this.loadingPromises.delete(dateKey);
        }
    }

    async _loadDayData(dateKey) {
        const path = `../data/EKE_bin_1/daily/eke_${dateKey}.bin`;
        const start = performance.now();

        const response = await fetch(path);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);

        const buffer = await response.arrayBuffer();
        const view = new DataView(buffer);

        const version = view.getInt32(0, true);
        const year = view.getInt32(4, true);
        const month = view.getInt32(8, true);
        const day = view.getInt32(12, true);

        const K = new Float32Array(buffer, 16, this.coordsInfo.totalCells);

        return {
            year, month, day, dateKey,
            K, buffer,
            size: buffer.byteLength
        };
    }

    _trimCache(maxDays = 2) {
        if (this.loadedDays.size <= maxDays) return;

        const keys = Array.from(this.loadedDays.keys());
        const toRemove = keys.slice(0, keys.length - maxDays);

        toRemove.forEach(key => {
            if (key === this.activeDate) return;
            const data = this.loadedDays.get(key);
            if (data) {
                data.K = null;
                data.buffer = null;
            }
            this.loadedDays.delete(key);
            console.log(`🗑️ Unloaded ${key}`);
        });
    }

    // ==================== SPATIAL LOOKUP ====================

    findNearestCell(lon, lat) {
        const { lonMin, lonMax, latMin, latMax } = this.gridBounds;
        const GRID_SIZE = this.spatialGrid.length;

        let gx = Math.floor((lon - lonMin) / (lonMax - lonMin) * (GRID_SIZE - 1));
        let gy = Math.floor((lat - latMin) / (latMax - latMin) * (GRID_SIZE - 1));

        gx = Math.max(0, Math.min(GRID_SIZE - 1, gx));
        gy = Math.max(0, Math.min(GRID_SIZE - 1, gy));

        const candidates = [];
        for (let dy = -1; dy <= 1; dy++) {
            for (let dx = -1; dx <= 1; dx++) {
                const ny = gy + dy;
                const nx = gx + dx;
                if (ny >= 0 && ny < GRID_SIZE && nx >= 0 && nx < GRID_SIZE) {
                    candidates.push(...this.spatialGrid[ny][nx]);
                }
            }
        }

        if (!candidates.length) return null;

        let best = null;
        let bestDist = Infinity;

        for (const cell of candidates) {
            const dlon = (cell.lon - lon) * 111 * Math.cos(lat * Math.PI/180);
            const dlat = (cell.lat - lat) * 111;
            const dist = dlon*dlon + dlat*dlat;

            if (dist < bestDist) {
                bestDist = dist;
                best = cell;
            }
        }

        return best;
    }

    // ==================== DIFFUSIVITY LOOKUPS ====================

    async getDiffusivityAt(lon, lat, dateParam = null) {
        let dateKey = this._resolveDate(dateParam);
        const dayData = await this.loadDay(dateKey);
        const cell = this.findNearestCell(lon, lat);

        if (!cell) return { K: 20, found: false, date: dateKey };

        const K = dayData.K[cell.idx];
        return {
            K: isNaN(K) ? 20 : Math.min(Math.max(K, 20), 3000),
            found: true,
            date: dateKey
        };
    }

    async getDiffusivitiesAtMultiple(positions, dateParam = null) {
        let dateKey = this._resolveDate(dateParam);
        const dayData = await this.loadDay(dateKey);
        const results = new Array(positions.length);

        for (let i = 0; i < positions.length; i++) {
            const { lon, lat } = positions[i];
            const cell = this.findNearestCell(lon, lat);

            if (!cell) {
                results[i] = { K: 20, found: false };
                continue;
            }

            const K = dayData.K[cell.idx];
            results[i] = {
                K: isNaN(K) ? 20 : Math.min(Math.max(K, 20), 3000),
                found: true
            };
        }

        return results;
    }

    _resolveDate(dateParam) {
        if (!dateParam) return this.activeDate || this.metadata.dates[0];
        if (typeof dateParam === 'number') return this.getDateFromSimulationDay(dateParam);
        if (typeof dateParam === 'string') {
            if (dateParam.includes('.')) {
                return this.getDateFromSimulationDay(parseFloat(dateParam));
            }
            return dateParam;
        }
        return this.metadata.dates[0];
    }

    // ==================== DATE UTILS ====================

    getDateFromSimulationDay(simDay) {
        const d = new Date('2011-03-11T00:00:00Z');
        d.setUTCDate(d.getUTCDate() + Math.floor(simDay));

        const y = d.getUTCFullYear();
        const m = String(d.getUTCMonth() + 1).padStart(2, '0');
        const day = String(d.getUTCDate()).padStart(2, '0');

        return `${y}${m}${day}`;
    }

    async setSimulationDay(simDay) {
        const key = this.getDateFromSimulationDay(simDay);
        await this.loadDay(key);
        return key;
    }

    // ==================== STATS ====================

    getStats() {
        return {
            loadedDays: this.loadedDays.size,
            totalDays: this.metadata?.total_days || 0,
            activeDate: this.activeDate,
            memoryUsage: this._memoryUsage()
        };
    }

    _memoryUsage() {
        let bytes = 0;
        if (this.coordsInfo) bytes += this.coordsInfo.nLat * this.coordsInfo.nLon * 8;
        for (const d of this.loadedDays.values()) bytes += d.size;
        return `${(bytes / 1e6).toFixed(1)}MB`;
    }
}

// ==================== GLOBAL ====================

window.StreamingEKELoader = StreamingEKELoader;
window.streamingEkeLoader = new StreamingEKELoader();

window.addEventListener('DOMContentLoaded', async () => {
    await window.streamingEkeLoader.init().catch(console.error);
});

console.log('=== EKE Loader ready ===');