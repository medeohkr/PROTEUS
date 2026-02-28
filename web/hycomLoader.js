// streamingHYCOMLoader_3D.js - 3D MULTI-DEPTH STREAMING with KD-TREE ACCELERATION
console.log('=== Streaming HYCOM Loader 3D (KD-Tree Accelerated) ===');

// ============================================================================
// KD-TREE FOR ULTRA-FAST NEAREST NEIGHBOR SEARCH
// ============================================================================
class KDTree {
    constructor(points, depth = 0) {
        if (points.length === 0) return;

        const axis = depth % 2;
        points.sort((a, b) => axis === 0 ? a.lon - b.lon : a.lat - b.lat);

        const medianIndex = Math.floor(points.length / 2);
        this.point = points[medianIndex];

        const leftPoints = points.slice(0, medianIndex);
        const rightPoints = points.slice(medianIndex + 1);

        if (leftPoints.length) this.left = new KDTree(leftPoints, depth + 1);
        if (rightPoints.length) this.right = new KDTree(rightPoints, depth + 1);
    }

    nearest(target, best = null, bestDist = Infinity, depth = 0) {
        if (!this.point) return { best, bestDist };

        const axis = depth % 2;
        const point = this.point;

        // Haversine distance in km
        const dlat = (point.lat - target.lat) * Math.PI / 180;
        const dlon = (point.lon - target.lon) * Math.PI / 180;
        const a = Math.sin(dlat/2) * Math.sin(dlat/2) +
                 Math.cos(target.lat * Math.PI/180) * Math.cos(point.lat * Math.PI/180) *
                 Math.sin(dlon/2) * Math.sin(dlon/2);
        const dist = 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));

        if (dist < bestDist) {
            best = point;
            bestDist = dist;
        }

        const [firstSide, secondSide] = axis === 0
            ? (target.lon < point.lon ? [this.left, this.right] : [this.right, this.left])
            : (target.lat < point.lat ? [this.left, this.right] : [this.right, this.left]);

        if (firstSide) {
            const result = firstSide.nearest(target, best, bestDist, depth + 1);
            best = result.best;
            bestDist = result.bestDist;
        }

        const planeDist = axis === 0
            ? Math.abs(target.lon - point.lon) * 111 * Math.cos(target.lat * Math.PI/180)
            : Math.abs(target.lat - point.lat) * 111;

        if (planeDist < bestDist && secondSide) {
            const result = secondSide.nearest(target, best, bestDist, depth + 1);
            best = result.best;
            bestDist = result.bestDist;
        }

        return { best, bestDist };
    }

    get size() {
        return 1 + (this.left?.size || 0) + (this.right?.size || 0);
    }

    get height() {
        return 1 + Math.max(this.left?.height || 0, this.right?.height || 0);
    }
}

// ============================================================================
// STREAMING HYCOM LOADER 3D
// ============================================================================

class StreamingHYCOMLoader_3D {
    constructor() {
        this.metadata = null;
        this.gridInfo = null;
        this.loadedDays = new Map();
        this.loadingPromises = new Map();
        this.activeDayKey = null;
        this.baseDate = new Date('2011-03-01T00:00:00Z');
        this.defaultDepth = 0;
        this.maxDaysInMemory = 2;

        // KD-Tree
        this.kdTree = null;
        this.kdTreeBuildTime = 0;

        // Debug
        this.debug = {
            enabled: true,
            counters: {
                findNearestCell: 0,
                isOcean: 0,
                getVelocityAt: 0,
                getVelocitiesAtMultiple: 0,
                loadDayByDate: 0,
                kdTreeLookups: 0
            },
            startTime: Date.now(),
            lastLogTime: Date.now()
        };

        if (this.debug.enabled) {
            setInterval(() => this.logDebugStats(), 10000);
        }

        console.log("🌊 3D HYCOM Loader initialized");
    }

    // ==================== DEBUG ====================

    logDebugStats() {

    }

    incrementCounter(name) {

    }

    // ==================== KD-TREE ====================

    buildKDTree() {
        console.log('🌳 Building KD-tree...');
        const start = performance.now();

        const firstDay = this.loadedDays.values().next().value;
        if (!firstDay) return false;

        const { nLat, nLon, lonArray, latArray } = firstDay;
        const points = [];

        for (let i = 0; i < nLat; i += 2) {
            for (let j = 0; j < nLon; j += 2) {
                const idx = i * nLon + j;
                const lon = lonArray[idx];
                const lat = latArray[idx];
                if (!isNaN(lon)) points.push({ i, j, idx, lon, lat });
            }
        }

        this.kdTree = new KDTree(points);
        this.kdTreeBuildTime = performance.now() - start;

        console.log(`  ✅ KD-tree built: ${points.length.toLocaleString()} points in ${this.kdTreeBuildTime.toFixed(0)}ms`);
        return true;
    }

    findNearestCell(lon, lat) {
        this.incrementCounter('findNearestCell');

        if (!this.kdTree) return null;

        this.incrementCounter('kdTreeLookups');
        const result = this.kdTree.nearest({ lon, lat });

        return result.best ? {
            i: result.best.i,
            j: result.best.j,
            idx: result.best.idx,
            distance: result.bestDist
        } : null;
    }

    // ==================== INIT ====================

    async init() {
        try {
            await this.loadMetadata();
            await this.loadDayByOffset(0);
            console.log('✅ 3D loader ready');
            return true;
        } catch (error) {
            console.error('❌ Init failed:', error);
            return false;
        }
    }

    async loadMetadata() {
        const response = await fetch('../data/currents_3d_bin/currents_3d_metadata.json');
        this.metadata = await response.json();

        this.daysByOffset = {};
        this.daysByDate = {};

        this.metadata.days.forEach(day => {
            this.daysByOffset[day.day_offset] = day;
            const key = `${day.year}-${String(day.month).padStart(2,'0')}-${String(day.day).padStart(2,'0')}`;
            this.daysByDate[key] = day;
        });

        console.log(`✅ Loaded ${this.metadata.days.length} days, depths: ${this.metadata.depths.join(', ')}m`);
    }

    // ==================== DAY LOADING ====================

    async loadDayByOffset(offset) {
        const day = this.daysByOffset[offset];
        return day ? this.loadDayByDate(day.year, day.month, day.day) : null;
    }

    async loadDayByDate(year, month, day) {
        this.incrementCounter('loadDayByDate');

        const dateKey = `${year}-${String(month).padStart(2,'0')}-${String(day).padStart(2,'0')}`;

        if (this.loadingPromises.has(dateKey)) return this.loadingPromises.get(dateKey);
        if (this.loadedDays.has(dateKey)) {
            this.activeDayKey = dateKey;
            return this.loadedDays.get(dateKey);
        }

        const promise = this._loadDay(dateKey, year, month, day);
        this.loadingPromises.set(dateKey, promise);

        try {
            const data = await promise;
            this.loadedDays.set(dateKey, data);
            this.activeDayKey = dateKey;

            if (!this.kdTree) this.buildKDTree();

            this._enforceMemoryLimit();
            return data;
        } finally {
            this.loadingPromises.delete(dateKey);
        }
    }

    async _loadDay(dateKey, year, month, day) {
        const path = `../data/currents_3d_bin/currents_${year}_${String(month).padStart(2,'0')}_${String(day).padStart(2,'0')}.bin`;

        const start = performance.now();
        const response = await fetch(path);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);

        const buffer = await response.arrayBuffer();
        const view = new DataView(buffer);
        const version = view.getInt32(0, true);

        if (version !== 4) throw new Error(`Unsupported version: ${version}`);

        const nLat = view.getInt32(4, true);
        const nLon = view.getInt32(8, true);
        const nDepth = view.getInt32(12, true);
        const fileYear = view.getInt32(16, true);
        const fileMonth = view.getInt32(20, true);
        const fileDay = view.getInt32(24, true);

        const totalCells = nLat * nLon;
        const totalPoints = totalCells * nDepth;
        const headerSize = 28;

        const lon = new Float32Array(totalCells);
        const lat = new Float32Array(totalCells);
        const u = new Float32Array(totalPoints);
        const v = new Float32Array(totalPoints);

        lon.set(new Float32Array(buffer, headerSize, totalCells));
        lat.set(new Float32Array(buffer, headerSize + totalCells*4, totalCells));
        u.set(new Float32Array(buffer, headerSize + 2*totalCells*4, totalPoints));
        v.set(new Float32Array(buffer, headerSize + 2*totalCells*4 + totalPoints*4, totalPoints));

        console.log(`  Loaded ${dateKey} in ${(performance.now()-start).toFixed(0)}ms`);

        return {
            lonArray: lon, latArray: lat, uArray: u, vArray: v,
            nLat, nLon, nDepth, totalCells, totalDataPoints: totalPoints,
            year: fileYear, month: fileMonth, day: fileDay,
            depths: this.metadata?.depths || [0,50,100,200,500,1000],
            fileSize: buffer.byteLength
        };
    }

    _enforceMemoryLimit() {
        if (this.loadedDays.size <= this.maxDaysInMemory) return;

        const keys = Array.from(this.loadedDays.keys()).sort();
        const toRemove = keys.slice(0, keys.length - this.maxDaysInMemory);

        toRemove.forEach(key => {
            if (key === this.activeDayKey) return;
            const data = this.loadedDays.get(key);
            if (data) {
                data.lonArray = null;
                data.latArray = null;
                data.uArray = null;
                data.vArray = null;
            }
            this.loadedDays.delete(key);
        });
    }

    // ==================== DEPTH ====================

    getDepthIndex(targetDepth) {
        const depths = this.metadata?.depths || [0,50,100,200,500,1000];
        let best = 0, bestDiff = Math.abs(targetDepth - depths[0]);

        for (let i = 1; i < depths.length; i++) {
            const diff = Math.abs(targetDepth - depths[i]);
            if (diff < bestDiff) {
                bestDiff = diff;
                best = i;
            }
        }
        return best;
    }

    getDepthValue(idx) {
        return this.metadata?.depths?.[idx] || 0;
    }

    // ==================== DATE ====================

    simulationDayToDate(day) {
        const d = new Date(this.baseDate.getTime() + day * 86400000);
        return {
            year: d.getUTCFullYear(),
            month: d.getUTCMonth() + 1,
            day: d.getUTCDate(),
            dateKey: d.toISOString().split('T')[0]
        };
    }

    // ==================== VELOCITY LOOKUPS ====================

    async getVelocityAt(lon, lat, depth = null, simDay = 0) {
        this.incrementCounter('getVelocityAt');

        const targetDepth = depth ?? this.defaultDepth;
        const depthIdx = this.getDepthIndex(targetDepth);
        const date = this.simulationDayToDate(simDay);
        const dayData = await this.loadDayByDate(date.year, date.month, date.day);
        const cell = this.findNearestCell(lon, lat);

        if (!cell) return { u:0, v:0, found:false, depth:targetDepth };

        const idx = depthIdx * dayData.totalCells + cell.idx;
        if (idx >= dayData.totalDataPoints) return { u:0, v:0, found:false };

        const u = dayData.uArray[idx];
        const v = dayData.vArray[idx];
        const isOcean = !isNaN(u) && Math.abs(u) < 1000;

        return {
            u: isOcean ? u : 0,
            v: isOcean ? v : 0,
            found: isOcean,
            depth: targetDepth,
            actualDepth: this.getDepthValue(depthIdx),
            distance: cell.distance
        };
    }

    async getVelocitiesAtMultiple(positions, depth = null, simDay = 0) {
        this.incrementCounter('getVelocitiesAtMultiple');

        const targetDepth = depth ?? this.defaultDepth;
        const depthIdx = this.getDepthIndex(targetDepth);
        const date = this.simulationDayToDate(simDay);
        const dayData = await this.loadDayByDate(date.year, date.month, date.day);
        const baseIdx = depthIdx * dayData.totalCells;
        const results = new Array(positions.length);

        for (let i = 0; i < positions.length; i++) {
            const { lon, lat } = positions[i];
            const cell = this.findNearestCell(lon, lat);

            if (!cell) {
                results[i] = { u:0, v:0, found:false };
                continue;
            }

            const idx = baseIdx + cell.idx;
            if (idx >= dayData.totalDataPoints) {
                results[i] = { u:0, v:0, found:false };
                continue;
            }

            const u = dayData.uArray[idx];
            const v = dayData.vArray[idx];
            const isOcean = !isNaN(u) && Math.abs(u) < 1000;

            results[i] = {
                u: isOcean ? u : 0,
                v: isOcean ? v : 0,
                found: isOcean,
                distance: cell.distance
            };
        }

        return results;
    }

    // ==================== OCEAN CHECKS ====================

    async isOcean(lon, lat, depth = 0, simDay = 0) {
        this.incrementCounter('isOcean');

        try {
            const vel = await this.getVelocityAt(lon, lat, depth, simDay);
            return vel.found;
        } catch {
            return false;
        }
    }

    // ==================== SETTINGS ====================

    setDefaultDepth(depth) {
        this.defaultDepth = depth;
    }

    getAvailableDepths() {
        return this.metadata?.depths || [];
    }
}

// ==================== GLOBAL ====================

window.StreamingHYCOMLoader_3D = StreamingHYCOMLoader_3D;
window.streamingHycomLoader3D = new StreamingHYCOMLoader_3D();

// Auto-start
window.addEventListener('DOMContentLoaded', () => {
    window.streamingHycomLoader3D.init().catch(console.error);
});

console.log('=== HYCOM Loader ready ===');