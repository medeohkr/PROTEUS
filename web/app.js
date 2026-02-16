// web/app.js - COMPLETE WORKING VERSION WITH NEW FEATURES
console.log('=== app.js STARTING WITH HYBRID VISUALIZATION ===');

// Global variables
let engine = null;
let animationId = null;
let simulationMode = 'baked'; // 'realtime' or 'baked'
// Leaflet globals
let simMap = null;
let particleCanvas = null;
// Add with other global variables
let showParticleTrails = true;
// Deck.gl globals
let deckgl = null;
let showHeatmap = true;

let bakeSystem = null;
let currentBakedParticles = [];

// Add with other global variables
let currentDepth = 0; // 0 = surface
const depthLevels = [0, 50, 100, 200, 500, 1000]; // Match your HYCOM depths
// Visualization mode
let visualizationMode = 'concentration'; // 'concentration' or 'particles'

// Heatmap parameters
let heatmapParams = {
    intensity: 1.0,
    radiusPixels: 75,
    opacity: 0.9,
    threshold: 0.001,
    useLogScale: true,
    gridSize: 0.5
};

// Time globals
let simulationStartDate = new Date('2011-03-11T00:00:00Z');
let currentSimulationDate = new Date(simulationStartDate);
let simulationDay = 0;

// Heatmap data cache
let lastHeatmapUpdate = 0;
const HEATMAP_UPDATE_INTERVAL = 500; // ms between updates
// Add these with other global variables at the top
const CONCENTRATION_RANGE = {
    min: 1e-6,      // 1 μBq/m³
    max: 1e6        // 1 MBq/m³
};

async function init() {
    console.log('=== INITIALIZATION WITH IMPROVED VISUALIZATION ===');

    // Create loading screen
    const loadingStatus = createStatusElement();
    updateLoadingStatus('Initializing...', 10);

    try {
        // 1. CREATE LEAFLET MAP
        updateLoadingStatus('Creating map...', 20);
        console.log('Creating Leaflet map...');
        simMap = L.map('map', {
            center: [35.0, 180.0],
            zoom: 4, // Fixed zoom level (adjust as needed)
            minZoom: 4, // Same as zoom = locked
            maxZoom: 4, // Same as zoom = locked
            zoomControl: false, // Remove zoom controls
            scrollWheelZoom: false, // Disable mouse wheel zoom
            doubleClickZoom: false, // Disable double-click zoom
            boxZoom: false, // Disable shift-drag zoom
            keyboard: false, // Disable keyboard zoom
            touchZoom: false, // Disable pinch zoom on mobile
            dragging: false, // Also disable panning if you want
            worldCopyJump: true,
            attributionControl: true,
            maxBounds: [[-90, -180], [90, 360]]
        });

        // 2. ADD BASEMAP
        L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
            attribution: '© OpenStreetMap, © CARTO',
            maxZoom: 8
        }).addTo(simMap);

        // 3. CREATE PARTICLE OVERLAY
        updateLoadingStatus('Creating visualization...', 30);
        console.log('Creating particle overlay...');
        particleCanvas = createCanvasOverlay();
        simMap.addLayer(particleCanvas);

        // 4. INITIALIZE DECK.GL
        updateLoadingStatus('Initializing WebGL...', 40);
        console.log('Initializing deck.gl overlay...');
        await initDeckGL();

        // 5. INITIALIZE PARTICLE ENGINE WITH 3D PHYSICS
        updateLoadingStatus('Loading ocean data...', 50);
        if (typeof ParticleEngine === 'function') {
            engine = new ParticleEngine(10000);

            // DEBUG: Check what class we're using
            console.log(`🔍 Engine constructor: ${engine.constructor.name}`);
            console.log(`🔍 Has enableRK4 method: ${typeof engine.enableRK4 === 'function'}`);

            // ENABLE RK4 IF AVAILABLE
            if (typeof engine.enableRK4 === 'function') {
                engine.enableRK4(false);
                console.log('✅ RK4 integration enabled');
            } else {
                console.warn('⚠️ RK4 not available in this ParticleEngine version');
            }

            console.log('Loading HYCOM ocean currents...');
            try {
                const success = await engine.init();
                if (!success) {
                    console.warn('Using fallback data');
                    showDataWarning('Using fallback diffusion data');
                }
            } catch (error) {
                console.error('Engine init failed:', error);
                showErrorMessage('Failed to load data. Using fallback.');
            }
        } else {
            console.error('ParticleEngine not found!');
            showErrorMessage('ParticleEngine class not loaded');
            return false;
        }
        // In your init() function, where you create bakeSystem
        bakeSystem = new BakeSystem();

        // In app.js, when setting up bakeSystem, make sure the event names match
        bakeSystem.on('frame', (frameData) => {
            console.log('🎬 Frame received at day:', frameData.day);
            currentBakedParticles = frameData.particles;

            if (visualizationMode === 'concentration') {
                updateDeckGLHeatmap(currentBakedParticles);
            } else {
                updateDeckGLParticles(currentBakedParticles);
            }

            if (particleCanvas && particleCanvas.updateParticles) {
                particleCanvas.updateParticles(currentBakedParticles);
            }

            updateDateTimeDisplay();
        });

        if (bakeSystem) {
            bakeSystem.on('bakeProgress', (progress) => {
                updatePreRenderProgress(progress.percent, progress.message);
            });

            bakeSystem.on('bakeComplete', (info) => {
                console.log('✅ Pre-render complete!', info);
                hidePreRenderProgress();
            });
        }

        // 6. ADD MAP CONTROLS
        updateLoadingStatus('Adding controls...', 70);
        addMapControls(simMap);

        // 7. SET UP CONTROLS
        updateLoadingStatus('Finalizing...', 90);
        setupVisualizationMode();
        updateUIForEngine();
        updateDateTimeDisplay();
        createHeatmapColorLegend();
        setupTrailToggle();
        setupUIModeSwitching();
        setupSliderValueDisplays();
        setupPreRenderButton();
        setupRealtimeControls();
        setupPlaybackControls();

        // 8. ADD MAP EVENT LISTENERS
        simMap.on('move resize zoom', function() {
            updateDeckGLView();
            updateCanvasOverlay();
        });

        // 9. START ANIMATION
        updateLoadingStatus('Ready!', 100);
        setTimeout(() => {
            hideLoadingStatus();
            animate();
        }, 500);

        console.log('✅ Particle Engine with improved visualization initialized');
        return true;

    } catch (error) {
        console.error('Initialization failed:', error);
        showErrorMessage(`Initialization failed: ${error.message}`);
        hideLoadingStatus();
        return false;
    }
}


async function initDeckGL() {
    // Check if deck.gl is loaded
    if (typeof deck === 'undefined') {
        console.error('deck.gl not loaded! Check script tags.');
        return;
    }

    try {
        // Get the canvas element
        const canvas = document.getElementById('deckgl-overlay');
        if (!canvas) {
            throw new Error('deckgl-overlay canvas not found');
        }

        // Set canvas size
        const width = window.innerWidth - 360;
        const height = window.innerHeight;
        canvas.width = width;
        canvas.height = height;

        // Initial view state
        const initialViewState = {
            longitude: 165.0,
            latitude: 25.0,
            zoom: 3,
            pitch: 0,
            bearing: 0
        };

        // Create deck.gl instance
        deckgl = new deck.Deck({
            canvas: canvas,
            initialViewState: initialViewState,
            controller: false,
            layers: [],
            parameters: {
                blend: true,
                blendFunc: [0x0302, 0x0303],
                clearColor: [0, 0, 0, 0]
            }
        });

        // Sync deck.gl with Leaflet view
        updateDeckGLView();

        // Handle window resize
        window.addEventListener('resize', handleResize);

        console.log('✅ deck.gl initialized successfully');

    } catch (error) {
        console.error('Failed to initialize deck.gl:', error);
        console.warn('Running in Leaflet-only mode');
        showDataWarning('WebGL heatmap not available. Using particles only.');
    }
}

function handleResize() {
    if (!deckgl) return;

    const canvas = document.getElementById('deckgl-overlay');
    if (!canvas) return;

    const width = window.innerWidth - 360;
    const height = window.innerHeight;

    canvas.width = width;
    canvas.height = height;

    updateDeckGLView();
}

function updateDeckGLView() {
    if (!deckgl || !simMap) return;

    const center = simMap.getCenter();
    const zoom = simMap.getZoom();

    // Convert Leaflet zoom to deck.gl zoom
    const deckZoom = Math.max(0, zoom - 1);

    // Update deck.gl view state
    deckgl.setProps({
        viewState: {
            longitude: center.lng,
            latitude: center.lat,
            zoom: deckZoom,
            pitch: 0,
            bearing: 0,
            width: window.innerWidth - 360,
            height: window.innerHeight
        }
    });

    // Force redraw
    deckgl.redraw();
}

// ==================== CONCENTRATION HEATMAP ====================

function createConcentrationGrid(particles, gridSize = 0.5) {
    if (!engine || !particles || particles.length === 0) return [];

    const grid = new Map();

    particles.forEach(p => {
        if (!p.active || !p.concentration) return;

        // SIMPLE: Just calculate raw coordinates - no normalization!
        const lon = engine.FUKUSHIMA_LON + (p.x / engine.LON_SCALE);
        const lat = engine.FUKUSHIMA_LAT + (p.y / engine.LAT_SCALE);

        // Simple grid cell calculation
        const lonIdx = Math.floor(lon / gridSize);
        const latIdx = Math.floor(lat / gridSize);
        const key = `${lonIdx},${latIdx}`;

        if (!grid.has(key)) {
            // Cell center coordinates - let Leaflet/deck.gl handle wrapping
            const cellLon = (lonIdx + 0.5) * gridSize;
            const cellLat = (latIdx + 0.5) * gridSize;

            grid.set(key, {
                position: [cellLon, cellLat],
                concentration: 0
            });
        }

        grid.get(key).concentration += p.concentration;
    });

    return Array.from(grid.values());
}

function updateDeckGLHeatmap(particles) {
    if (!deckgl || particles.length === 0 || visualizationMode !== 'concentration') return;

    // Filter particles by depth for heatmap
    const depthRange = 100; // Wider range for heatmap smoothness
    const depthFilteredParticles = particles.filter(p => {
        const particleDepthM = p.depth !== undefined ? p.depth * 1000 : 0;
        return Math.abs(particleDepthM - currentDepth) <= depthRange;
    });

    console.log(`🌡️ Depth ${currentDepth}m: Heatmap using ${depthFilteredParticles.length}/${particles.length} particles`);

    const now = Date.now();
    if (now - lastHeatmapUpdate < HEATMAP_UPDATE_INTERVAL) return;
    lastHeatmapUpdate = now;

    // Use depthFilteredParticles for grid creation
    const gridData = createConcentrationGrid(depthFilteredParticles, heatmapParams.gridSize);

    const heatmapData = gridData.map(cell => ({
        position: cell.position,
        weight: cell.concentration
    }));

    try {
        const heatmapLayer = new deck.HeatmapLayer({
            id: 'concentration-heatmap',
            data: heatmapData,
            getPosition: d => d.position,
            getWeight: d => {
                let concentration = Math.max(d.weight, CONCENTRATION_RANGE.min);
                concentration = Math.min(concentration, CONCENTRATION_RANGE.max);

                // Log scale normalization
                const logConc = Math.log10(concentration);
                const logMin = Math.log10(CONCENTRATION_RANGE.min);
                const logMax = Math.log10(CONCENTRATION_RANGE.max);
                const normalized = (logConc - logMin) / (logMax - logMin);

                return Math.max(0, Math.min(normalized, 1)) * heatmapParams.intensity;
            },
            colorRange: [ // Your existing color range
                [13, 8, 135, 0], [40, 60, 190, 100], [23, 154, 176, 150],
                [13, 188, 121, 200], [62, 218, 79, 220], [130, 226, 74, 230],
                [192, 226, 70, 240], [243, 210, 65, 245], [251, 164, 57, 250],
                [241, 99, 55, 255], [231, 29, 43, 255], [190, 0, 38, 255]
            ],
            radiusPixels: heatmapParams.radiusPixels,
            intensity: 1.0,
            threshold: 0.01,
            aggregation: 'SUM'
        });

        deckgl.setProps({ layers: [heatmapLayer] });
    } catch (error) {
        console.error('Failed to create heatmap layer:', error);
    }
}
// ==================== PARTICLE TRAIL VISUALIZATION ====================

function updateDeckGLParticles(particles) {
    if (!deckgl || particles.length === 0 || visualizationMode !== 'particles') {
        deckgl.setProps({ layers: [] });
        return;
    }

    try {
        // Filter particles by current depth (±50m)
        const depthRange = 50; // Show particles within 50m of selected depth
        const filteredParticles = particles.filter(p => {
            // Handle both realtime and baked particles
            const particleDepthM = p.depth !== undefined ? p.depth * 1000 : 0;
            return Math.abs(particleDepthM - currentDepth) <= depthRange;
        });

        console.log(`🎯 Depth ${currentDepth}m: Showing ${filteredParticles.length}/${particles.length} particles`);

        const particleData = [];
        const trailData = [];

        // Get reference coordinates (with fallbacks)
        const fukushimaLon = engine ? engine.FUKUSHIMA_LON : 141.31;
        const fukushimaLat = engine ? engine.FUKUSHIMA_LAT : 37.42;
        const lonScale = engine ? engine.LON_SCALE : 88.8;
        const latScale = engine ? engine.LAT_SCALE : 111.0;

        for (const p of filteredParticles) {
            // Check if particle is valid - handle BOTH realtime AND baked formats
            const isValid = p.active === undefined ? true : p.active; // Baked particles don't have 'active'
            if (!isValid) continue;

            // Calculate coordinates using our fallback values
            const lon = fukushimaLon + (p.x / lonScale);
            const lat = fukushimaLat + (p.y / latScale);

            // Skip obviously invalid positions
            if (Math.abs(lat) > 90) continue;

            // Add current position
            particleData.push({
                position: [lon, lat],
                color: getParticleColor(p),
                radius: getParticleRadius(p)
            });

            // Add trail if enabled - handle both history formats
            if (showParticleTrails) {
                // Check for both possible history formats
                let history = p.history;

                // If no history array but we have historyX/Y arrays (from bake system)
                if (!history && p.historyX && p.historyLength > 0) {
                    history = [];
                    for (let i = 0; i < p.historyLength; i++) {
                        history.push({
                            x: p.historyX[i],
                            y: p.historyY[i]
                        });
                    }
                }

                if (history && history.length > 1) {
                    const positions = history.map(h => {
                        const histLon = fukushimaLon + (h.x / lonScale);
                        const histLat = fukushimaLat + (h.y / latScale);
                        return [histLon, histLat];
                    }).filter(pos => Math.abs(pos[1]) <= 90);

                    if (positions.length >= 2) {
                        trailData.push({
                            path: positions,
                            color: getTrailColor(p),
                            width: 1.5
                        });
                    }
                }
            }
        }

        console.log(`🎯 Rendering ${particleData.length} particles, ${trailData.length} trails`);

        const layers = [];

        if (showParticleTrails && trailData.length > 0) {
            layers.push(new deck.PathLayer({
                id: 'particle-trails',
                data: trailData,
                getPath: d => d.path,
                getColor: d => d.color,
                getWidth: d => d.width,
                widthUnits: 'pixels',
                widthMinPixels: 1,
                capRounded: true,
                jointRounded: true
            }));
        }

        if (particleData.length > 0) {
            layers.push(new deck.ScatterplotLayer({
                id: 'particle-points',
                data: particleData,
                getPosition: d => d.position,
                getColor: d => d.color,
                getRadius: d => d.radius,
                radiusUnits: 'pixels',
                radiusMinPixels: 1,
                radiusMaxPixels: 6,
                filled: true,
                opacity: 0.8
            }));
        }

        deckgl.setProps({ layers });
    } catch (error) {
        console.error('Failed to create particle layers:', error);
    }
}

function getParticleColor(p) {
    if (!p.concentration) return [255, 255, 255, 200];

    const concentration = Math.max(p.concentration, CONCENTRATION_RANGE.min);
    const clampedConc = Math.min(concentration, CONCENTRATION_RANGE.max);

    // Use the same log normalization
    const logConc = Math.log10(clampedConc);
    const logMin = Math.log10(CONCENTRATION_RANGE.min);
    const logMax = Math.log10(CONCENTRATION_RANGE.max);
    const normalized = (logConc - logMin) / (logMax - logMin);

    // Map normalized value (0-1) to color gradient
    const colorIndex = Math.floor(normalized * 10);

    const colorStops = [
        [33, 102, 172, 150],   // 0.0: Blue: 1 μBq/m³
        [103, 169, 207, 180],  // 0.1: Light blue: 10 μBq/m³
        [103, 169, 207, 180],  // 0.2: Light blue: 100 μBq/m³
        [209, 229, 240, 200],  // 0.3: Very light blue: 1 mBq/m³
        [209, 229, 240, 200],  // 0.4: Very light blue: 10 mBq/m³
        [253, 219, 199, 220],  // 0.5: Light orange: 100 mBq/m³
        [253, 219, 199, 220],  // 0.6: Light orange: 1 Bq/m³
        [239, 138, 98, 230],   // 0.7: Orange: 10 Bq/m³
        [239, 138, 98, 230],   // 0.8: Orange: 100 Bq/m³
        [203, 24, 29, 255],    // 0.9: Red: 1 kBq/m³
        [203, 24, 29, 255]     // 1.0: Red: 10 kBq/m³+
    ];

    return colorIndex < colorStops.length ? colorStops[colorIndex] : [203, 24, 29, 255];
}

function getTrailColor(p) {
    // Fade trail color based on particle age
    const age = p.age || 0;
    const alpha = Math.max(50, 255 - age * 2); // Fade with age

    if (age < 100) return [255, 107, 107, alpha];    // Red for new particles
    if (age < 300) return [255, 193, 7, alpha];      // Yellow for medium age
    return [79, 195, 247, alpha];                    // Blue for old particles
}

function getParticleRadius(p) {
    // Scale radius based on concentration
    if (!p.concentration) return 2;

    const concentration = Math.max(p.concentration, 1e-9);
    const logConc = Math.log10(concentration);

    // Base radius + scaled by log concentration
    return Math.min(Math.max(1 + logConc * 0.3, 1), 6);
}

// ==================== VISUALIZATION MODE CONTROLS ====================

// ==================== VISUALIZATION MODE CONTROLS ====================

function setupVisualizationMode() {
    // Get mode toggle buttons - UPDATED IDs
    const btnRealtime = document.getElementById('btn-realtime');
    const btnPreRender = document.getElementById('btn-pre-render'); // Changed from btn-bake
    const btnConcentration = document.getElementById('btn-concentration');
    const btnParticles = document.getElementById('btn-particles');

    // Get UI panels - UPDATED IDs
    const prenderControls = document.getElementById('prender-controls'); // Changed from bake-panel
    const playbackControls = document.getElementById('playback-controls');

    // ===== SIMULATION MODE TOGGLES (Realtime vs Pre-render) =====

    // Realtime mode
    if (btnRealtime) {
        btnRealtime.addEventListener('click', () => {
            // Update mode
            simulationMode = 'realtime';

            // Update button states
            btnRealtime.classList.add('active');
            if (btnPreRender) btnPreRender.classList.remove('active');

            // Hide pre-render UI
            if (prenderControls) prenderControls.style.display = 'none';
            if (playbackControls) playbackControls.style.display = 'none';

            // Ensure realtime simulation is running
            if (engine) {
                if (!engine.isRunning && engine.stats.totalReleased > 0) {
                    engine.resumeSimulation();
                }
            }

            // Force visualization update with realtime particles
            if (engine) {
                const particles = engine.getActiveParticles();
                if (visualizationMode === 'concentration') {
                    updateDeckGLHeatmap(particles);
                } else {
                    updateDeckGLParticles(particles);
                }
                if (particleCanvas && particleCanvas.updateParticles) {
                    particleCanvas.updateParticles(particles);
                }
            }

            console.log('🎮 Switched to REALTIME mode');
        });
    }

    // Pre-render mode (formerly Bake mode)
    if (btnPreRender) {
        btnPreRender.addEventListener('click', () => {
            // Update mode
            simulationMode = 'baked';

            // Update button states
            btnPreRender.classList.add('active');
            if (btnRealtime) btnRealtime.classList.remove('active');

            // Show pre-render UI
            if (prenderControls) prenderControls.style.display = 'block';
            if (playbackControls) playbackControls.style.display = 'none'; // Hidden until pre-render completes

            // Pause realtime simulation if running
            if (engine && engine.isRunning) {
                engine.pauseSimulation();
            }

            // If we already have baked data loaded, use it
            if (bakeSystem && bakeSystem.snapshots.length > 0) {
                const particles = bakeSystem.interpolateParticles();
                if (visualizationMode === 'concentration') {
                    updateDeckGLHeatmap(particles);
                } else {
                    updateDeckGLParticles(particles);
                }
                if (particleCanvas && particleCanvas.updateParticles) {
                    particleCanvas.updateParticles(particles);
                }
            }

            console.log('🎬 Switched to PRE-RENDER mode');
        });
    }

    // ===== VISUALIZATION TYPE TOGGLES (Concentration vs Particles) =====
    // (This part remains the same)

    // Concentration mode
    if (btnConcentration) {
        btnConcentration.addEventListener('click', () => {
            visualizationMode = 'concentration';

            // Update button states
            btnConcentration.classList.add('active');
            if (btnParticles) btnParticles.classList.remove('active');

            // Update visualization based on current simulation mode
            if (simulationMode === 'realtime' && engine) {
                const particles = engine.getActiveParticles();
                updateDeckGLHeatmap(particles);

                // Clear particle canvas
                if (particleCanvas && particleCanvas.clearAllParticles) {
                    particleCanvas.clearAllParticles();
                }

            } else if (simulationMode === 'baked' && bakeSystem && bakeSystem.snapshots.length > 0) {
                const particles = bakeSystem.interpolateParticles();
                updateDeckGLHeatmap(particles);

                // Clear particle canvas
                if (particleCanvas && particleCanvas.clearAllParticles) {
                    particleCanvas.clearAllParticles();
                }
            }

            console.log('🔵 Switched to Concentration mode');
        });
    }

    // Particles mode
    if (btnParticles) {
        btnParticles.addEventListener('click', () => {
            visualizationMode = 'particles';

            // Update button states
            btnParticles.classList.add('active');
            if (btnConcentration) btnConcentration.classList.remove('active');

            // Update visualization based on current simulation mode
            if (simulationMode === 'realtime' && engine) {
                const particles = engine.getActiveParticles();
                updateDeckGLParticles(particles);

                // Update canvas particles
                if (particleCanvas && particleCanvas.updateParticles) {
                    particleCanvas.updateParticles(particles);
                }

            } else if (simulationMode === 'baked' && bakeSystem && bakeSystem.snapshots.length > 0) {
                const particles = bakeSystem.interpolateParticles();
                updateDeckGLParticles(particles);

                // Update canvas particles
                if (particleCanvas && particleCanvas.updateParticles) {
                    particleCanvas.updateParticles(particles);
                }
            }

            console.log('🔴 Switched to Particle mode');
        });
    }

    // Set initial state (default to pre-render + concentration)
    if (btnPreRender) btnPreRender.click();
    if (btnConcentration) btnConcentration.click();
}

// ==================== LEAFLET PARTICLE CANVAS ====================

function createCanvasOverlay() {
    const particleLayer = L.layerGroup();
    window.particleMarkers = [];

    particleLayer.updateParticles = function(particles) {
        this.clearLayers();
        window.particleMarkers = [];

        if (visualizationMode !== 'particles' || !engine) return;

        const limit = Math.min(particles.length, 2000);

        for (let i = 0; i < limit; i++) {
            const p = particles[i];

            // SIMPLE: Raw coordinates!
            const lon = engine.FUKUSHIMA_LON + (p.x / engine.LON_SCALE);
            const lat = engine.FUKUSHIMA_LAT + (p.y / engine.LAT_SCALE);

            // Skip invalid latitudes
            if (Math.abs(lat) > 90) continue;

            const color = getCanvasParticleColor(p);
            const marker = L.circleMarker([lat, lon], {
                radius: Math.max(1, Math.sqrt(p.mass) * 2),
                color: color,
                fillColor: color,
                fillOpacity: 0.6 + p.mass * 0.3,
                weight: 0.5,
                opacity: 0.8
            });

            // Add trails if enabled
            if (showParticleTrails && p.history && p.history.length > 1) {
                const trailPoints = p.history.map(h => [
                    engine.FUKUSHIMA_LAT + (h.y / engine.LAT_SCALE),
                    engine.FUKUSHIMA_LON + (h.x / engine.LON_SCALE)
                ]).filter(point => Math.abs(point[0]) <= 90);

                if (trailPoints.length >= 2) {
                    L.polyline(trailPoints, {
                        color: color,
                        weight: 1,
                        opacity: 0.4
                    }).addTo(this);
                }
            }

            marker.bindPopup(/* ... popup content ... */);
            marker.addTo(this);
        }
    };

    // Rest of the function remains the same...
    particleLayer.clearTrails = function() {
        this.eachLayer((layer) => {
            if (layer instanceof L.Polyline) {
                this.removeLayer(layer);
            }
        });
    };

    particleLayer.clearAllParticles = function() {
        this.clearLayers();
        window.particleMarkers = [];
        console.log('🧹 Cleared canvas particles');
    };

    return particleLayer;
}

function getCanvasParticleColor(p) {
    if (!p.concentration) return '#4fc3f7';

    const concentration = Math.max(p.concentration, 1e-9);
    const logConc = Math.log10(concentration);

    if (logConc < -3) return '#2166ac';   // Blue: < 1 mBq/m³
    if (logConc < 0) return '#67a9cf';    // Light blue: 1 mBq/m³ - 1 Bq/m³
    if (logConc < 3) return '#d1e5f0';    // Very light blue: 1 Bq/m³ - 1 kBq/m³
    if (logConc < 6) return '#fddbc7';    // Light orange: 1 kBq/m³ - 1 MBq/m³
    return '#cb181d';                     // Red: > 1 MBq/m³
}

function formatConcentration(value) {
    if (value >= 1e6) return `${(value/1e6).toFixed(2)} MBq/m³`;
    if (value >= 1e3) return `${(value/1e3).toFixed(2)} kBq/m³`;
    if (value >= 1) return `${value.toFixed(2)} Bq/m³`;
    if (value >= 1e-3) return `${(value*1e3).toFixed(2)} mBq/m³`;
    return `${(value*1e6).toFixed(2)} μBq/m³`;
}

// ==================== ANIMATION LOOP ====================

function animate() {
    if (simulationMode === 'realtime' && engine && engine.isRunning) {
        engine.update();
        const particles = engine.getActiveParticles();

        if (visualizationMode === 'concentration') {
            updateDeckGLHeatmap(particles);
        } else {
            updateDeckGLParticles(particles);
        }

        if (particleCanvas && particleCanvas.updateParticles) {
            particleCanvas.updateParticles(particles);
        }

        updateDateTimeDisplay();
        updateStatsDisplay(); // <-- ADD THIS LINE
        updateUIForEngine();  // <-- ADD THIS LINE (updates sliders)

    } else if (simulationMode === 'baked' && bakeSystem) {
        // Baked mode - just update stats
        updateDateTimeDisplay();
        updateStatsDisplay(); // <-- ADD THIS LINE
    }

    animationId = requestAnimationFrame(animate);
}

// ==================== UI UPDATES ====================

function updateDateTimeDisplay() {
    const dayElement = document.getElementById('simulation-day');
    const dateElement = document.getElementById('simulation-date');

    if (!dayElement || !dateElement) return;

    if (simulationMode === 'realtime' && engine) {
        // ===== REALTIME MODE =====
        // Get time from engine
        let day = 0;
        let date = new Date(simulationStartDate);

        if (engine.getFormattedTime) {
            const time = engine.getFormattedTime();
            date = new Date(Date.UTC(time.year, time.month - 1, time.day));
            day = engine.stats.simulationDays || 0;
        } else {
            // Fallback to our tracking variables
            day = simulationDay;
            date = currentSimulationDate;
        }

        // Update displays
        dayElement.textContent = `Day ${day.toFixed(1)}`;
        dateElement.textContent = date.toLocaleDateString('en-US', {
            year: 'numeric',
            month: 'short',
            day: 'numeric',
            timeZone: 'UTC'
        });

        // Update simulation day global (for other UI elements)
        simulationDay = day;
        currentSimulationDate = date;

    } else if (simulationMode === 'baked' && bakeSystem && bakeSystem.snapshots.length > 0) {
        // ===== BAKED MODE =====
        const currentDay = bakeSystem.getCurrentDay();

        // Calculate date from day offset
        const date = new Date(simulationStartDate);
        date.setUTCDate(simulationStartDate.getUTCDate() + Math.floor(currentDay));

        // Handle fractional days for smooth time display
        const hours = Math.floor((currentDay % 1) * 24);
        const minutes = Math.floor(((currentDay % 1) * 24 * 60) % 60);

        // Update displays
        dayElement.textContent = `Day ${currentDay.toFixed(2)}`;

        // Show time if we have fractional days
        if (hours > 0 || minutes > 0) {
            dateElement.textContent = date.toLocaleDateString('en-US', {
                year: 'numeric',
                month: 'short',
                day: 'numeric',
                timeZone: 'UTC'
            }) + ` ${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')} UTC`;
        } else {
            dateElement.textContent = date.toLocaleDateString('en-US', {
                year: 'numeric',
                month: 'short',
                day: 'numeric',
                timeZone: 'UTC'
            });
        }

        // ===== UPDATED TIMELINE SLIDER CODE =====
        const timeline = document.getElementById('playback-timeline');
        if (timeline && bakeSystem.snapshots.length > 0) {
            const maxDay = bakeSystem.snapshots[bakeSystem.snapshots.length - 1].day;

            // Ensure the slider's max is set correctly (in case it hasn't been)
            if (timeline.max != maxDay) {
                timeline.max = maxDay;
                console.log(`📏 Timeline max set to ${maxDay} days`);
            }

            // Set the current value directly (no percentage conversion!)
            timeline.value = currentDay;

            // Update the date display near timeline
            const currentDateElement = document.getElementById('playback-date-current');
            if (currentDateElement) {
                currentDateElement.textContent = `Day ${currentDay.toFixed(1)}`;
            }

            // Optional: Add a visual indicator of progress (for debugging)
            const percent = (currentDay / maxDay * 100).toFixed(0);
            timeline.setAttribute('data-progress', `${percent}%`);
        }

    } else {
        // ===== NO ACTIVE SIMULATION =====
        dayElement.textContent = 'Day 0.0';
        dateElement.textContent = new Date(simulationStartDate).toLocaleDateString('en-US', {
            year: 'numeric',
            month: 'short',
            day: 'numeric',
            timeZone: 'UTC'
        });
    }
}

function updateStatsDisplay() {
    const activeSpan = document.getElementById('stats-active');
    const releasedSpan = document.getElementById('stats-released');
    const decayedSpan = document.getElementById('stats-decayed');
    const depthSpan = document.getElementById('stats-depth');
    const concSpan = document.getElementById('stats-conc');

    if (!activeSpan) return; // Stats panel not found

    if (simulationMode === 'realtime' && engine) {
        // REALTIME MODE STATS
        const activeParticles = engine.getActiveParticles();
        const stats = engine.stats || {};

        activeSpan.textContent = activeParticles.length.toLocaleString();
        releasedSpan.textContent = (stats.totalReleased || 0).toLocaleString();
        decayedSpan.textContent = (stats.totalDecayed || 0).toLocaleString();
        depthSpan.textContent = (stats.maxDepthReached || 0).toFixed(0) + 'm';
        concSpan.textContent = formatConcentration(stats.maxConcentration || 0);

    } else if (simulationMode === 'baked' && bakeSystem?.snapshots?.length > 0) {
        // PLAYBACK MODE STATS
        const currentSnapshot = bakeSystem.snapshots[bakeSystem.currentSnapshotIndex || 0];
        const particles = currentSnapshot?.particles || [];
        const stats = currentSnapshot?.stats || {};

        let maxConc = 0;
        if (particles.length > 0) {
            maxConc = Math.max(...particles.map(p => p.concentration || 0));
        }

        activeSpan.textContent = particles.length.toLocaleString();
        releasedSpan.textContent = (stats.totalReleased || particles.length).toLocaleString();
        decayedSpan.textContent = (stats.totalDecayed || 0).toLocaleString();
        depthSpan.textContent = (stats.maxDepthReached || 0).toFixed(0) + 'm';
        concSpan.textContent = formatConcentration(maxConc || stats.maxConcentration || 0);

    } else {
        // NO SIMULATION
        activeSpan.textContent = '0';
        releasedSpan.textContent = '0';
        decayedSpan.textContent = '0';
        depthSpan.textContent = '0m';
        concSpan.textContent = '0 Bq/m³';
    }
}


function createHeatmapColorLegend() {
    console.log('🎨 Creating legend from HeatmapLayer colorRange...');

    // Remove old legend
    const oldLegend = document.getElementById('concentration-legend');
    if (oldLegend) oldLegend.remove();

    // These are YOUR exact colors from app.js - HeatmapLayer colorRange
    const heatmapColors = [
        [13, 8, 135, 0],      // Deep blue (low) - 1 μBq/m³
        [40, 60, 190, 100],   // Blue
        [23, 154, 176, 150],  // Cyan
        [13, 188, 121, 200],  // Green
        [62, 218, 79, 220],   // Light green
        [130, 226, 74, 230],  // Yellow-green
        [192, 226, 70, 240],  // Yellow
        [243, 210, 65, 245],  // Orange
        [251, 164, 57, 250],  // Red-orange
        [241, 99, 55, 255],   // Red
        [231, 29, 43, 255],   // Dark red
        [190, 0, 38, 255]     // Very dark red (high) - 1 MBq/m³
    ];

    // Create concentration levels that match the 12 color stops
    const concentrationLevels = [
        1e-6,   // 1 μBq/m³ - Deep blue
        1e-5,   // 10 μBq/m³
        1e-4,   // 100 μBq/m³
        1e-3,   // 1 mBq/m³
        1e-2,   // 10 mBq/m³
        1e-1,   // 100 mBq/m³
        1e0,    // 1 Bq/m³
        1e1,    // 10 Bq/m³
        1e2,    // 100 Bq/m³
        1e3,    // 1 kBq/m³
        1e4,    // 10 kBq/m³
        1e5,    // 100 kBq/m³
        1e6     // 1 MBq/m³ - Very dark red
    ];

    // Convert RGBA arrays to CSS colors (ignore alpha for the legend)
    const cssColors = heatmapColors.map(rgba =>
        `rgb(${rgba[0]}, ${rgba[1]}, ${rgba[2]})`
    );

    // Build the gradient (using all colors)
    const gradientColors = cssColors.join(', ');

    // Create the legend
    const legendDiv = document.createElement('div');
    legendDiv.id = 'concentration-legend';
    legendDiv.className = 'map-legend';

    // HTML structure
    legendDiv.innerHTML = `
        <div class="legend-header">
            <i class="fas fa-fire"></i>
            <h4>Cs-137 Concentration</h4>
            <div class="legend-subtitle">Bq/m³ (Log Scale)</div>
        </div>

        <div class="legend-main">
            <div class="gradient-bar" style="background: linear-gradient(to top, ${gradientColors})"></div>

            <div class="value-labels">
                <div class="value-label top">1 MBq/m³</div>
                <div class="value-label middle">1 Bq/m³</div>
                <div class="value-label bottom">1 μBq/m³</div>
            </div>
        </div>

        <div class="legend-colors">
            <div class="color-row">
                <div class="color-box" style="background: rgb(190, 0, 38)"></div>
                <div class="color-label">High (100 kBq/m³+)</div>
            </div>
            <div class="color-row">
                <div class="color-box" style="background: rgb(243, 210, 65)"></div>
                <div class="color-label">Medium (1-10 kBq/m³)</div>
            </div>
            <div class="color-row">
                <div class="color-box" style="background: rgb(13, 188, 121)"></div>
                <div class="color-label">Low (10-100 Bq/m³)</div>
            </div>
            <div class="color-row">
                <div class="color-box" style="background: rgb(23, 154, 176)"></div>
                <div class="color-label">Very Low (1-10 Bq/m³)</div>
            </div>
            <div class="color-row">
                <div class="color-box" style="background: rgb(13, 8, 135)"></div>
                <div class="color-label">Background (<1 Bq/m³)</div>
            </div>
        </div>

        <div class="legend-note">Heatmap shows Cs-137 in seawater</div>
    `;

    // Add to page
    const mapContainer = document.getElementById('map-container');
    if (mapContainer) {
        mapContainer.appendChild(legendDiv);

        // Add CSS
        const style = document.createElement('style');
        style.textContent = `
            #concentration-legend {
                position: absolute;
                bottom: 25px;
                right: 25px;
                background: rgba(15, 30, 45, 0.95);
                border: 1px solid rgba(79, 195, 247, 0.3);
                border-radius: 10px;
                padding: 18px;
                width: 220px;
                color: white;
                font-family: 'Segoe UI', sans-serif;
                box-shadow: 0 6px 20px rgba(0, 0, 0, 0.4);
                backdrop-filter: blur(8px);
                z-index: 1000;
            }

            .legend-header {
                margin-bottom: 15px;
                text-align: center;
            }

            .legend-header h4 {
                margin: 5px 0 3px 0;
                color: #4fc3f7;
                font-size: 16px;
            }

            .legend-subtitle {
                font-size: 11px;
                color: #b0bec5;
            }

            .legend-main {
                display: flex;
                margin: 15px 0;
                height: 180px;
            }

            .gradient-bar {
                width: 24px;
                border-radius: 4px;
                border: 1px solid rgba(255, 255, 255, 0.2);
                margin-right: 15px;
            }

            .value-labels {
                flex: 1;
                display: flex;
                flex-direction: column;
                justify-content: space-between;
                padding: 5px 0;
            }

            .value-label {
                font-size: 11px;
                color: #e0e0e0;
                font-family: 'Courier New', monospace;
                background: rgba(0, 0, 0, 0.3);
                padding: 6px 10px;
                border-radius: 4px;
                border-left: 3px solid rgba(79, 195, 247, 0.5);
            }

            .value-label.top {
                border-left-color: rgba(241, 99, 55, 0.7);
            }

            .value-label.middle {
                border-left-color: rgba(62, 218, 79, 0.7);
            }

            .value-label.bottom {
                border-left-color: rgba(23, 154, 176, 0.7);
            }

            .legend-colors {
                margin: 15px 0;
                padding: 12px;
                background: rgba(10, 25, 41, 0.6);
                border-radius: 6px;
            }

            .color-row {
                display: flex;
                align-items: center;
                margin-bottom: 8px;
            }

            .color-box {
                width: 20px;
                height: 20px;
                border-radius: 3px;
                margin-right: 12px;
                border: 1px solid rgba(255, 255, 255, 0.3);
                flex-shrink: 0;
            }

            .color-label {
                font-size: 12px;
                color: #b0bec5;
            }

            .legend-note {
                font-size: 10px;
                color: #78909c;
                text-align: center;
                font-style: italic;
                margin-top: 10px;
                padding-top: 10px;
                border-top: 1px solid rgba(255, 255, 255, 0.1);
            }
        `;
        document.head.appendChild(style);

        console.log('✅ Heatmap color legend created!');
        console.log('Using colors:', cssColors);
    }
}


// ==================== CONTROLS ====================

// ==================== UI MODE SWITCHING ====================

function setupUIModeSwitching() {
    console.log('🎛️ Setting up UI mode switching');

    const btnPreRender = document.getElementById('btn-pre-render');
    const btnRealtime = document.getElementById('btn-realtime');
    const prenderControls = document.getElementById('prender-controls');
    const realtimeControls = document.getElementById('realtime-controls');
    const playbackControls = document.getElementById('playback-controls');

    if (!btnPreRender || !btnRealtime) {
        console.warn('⚠️ Mode buttons not found');
        return;
    }

    // Pre-render mode
    btnPreRender.addEventListener('click', () => {
        console.log('🎬 Switching to PRE-RENDER mode');

        // Update buttons
        btnPreRender.classList.add('active');
        btnRealtime.classList.remove('active');

        // Update global mode
        simulationMode = 'baked';

        // Show/hide controls
        prenderControls.style.display = 'block';
        realtimeControls.style.display = 'none';
        playbackControls.style.display = 'none'; // Hide playback when configuring

        // Pause realtime if running
        if (engine && engine.isRunning) {
            engine.pauseSimulation();
        }
    });

    // Realtime mode
    btnRealtime.addEventListener('click', () => {
        console.log('⚡ Switching to REALTIME mode');

        // Update buttons
        btnRealtime.classList.add('active');
        btnPreRender.classList.remove('active');

        // Update global mode
        simulationMode = 'realtime';

        // Show/hide controls
        prenderControls.style.display = 'none';
        realtimeControls.style.display = 'block';
        playbackControls.style.display = 'none';

        syncRealtimeControls();
        // Ensure engine is ready
        if (engine && !engine.isRunning) {
            // Update UI with current engine state
            updateUIForEngine();

        }
    });


    // Default to pre-render mode
    btnPreRender.click();
}
// Add this function
function refreshVisualization() {
    if (simulationMode === 'realtime' && engine) {
        const particles = engine.getActiveParticles();
        if (visualizationMode === 'concentration') {
            updateDeckGLHeatmap(particles);
        } else {
            updateDeckGLParticles(particles);
        }
        if (particleCanvas && particleCanvas.updateParticles) {
            particleCanvas.updateParticles(particles);
        }
    } else if (simulationMode === 'baked' && bakeSystem && bakeSystem.snapshots.length > 0) {
        const particles = bakeSystem.interpolateParticles();
        if (visualizationMode === 'concentration') {
            updateDeckGLHeatmap(particles);
        } else {
            updateDeckGLParticles(particles);
        }
        if (particleCanvas && particleCanvas.updateParticles) {
            particleCanvas.updateParticles(particles);
        }
    }
}
// ==================== SLIDER VALUE UPDATES ====================

function setupSliderValueDisplays() {
    console.log('🎚️ Setting up slider value displays');

    // PRE-RENDER SLIDERS
    const prParticles = document.getElementById('pr-particles');
    if (prParticles) {
        const display = document.getElementById('pr-particles-value');
        display.textContent = parseInt(prParticles.value).toLocaleString();
        prParticles.addEventListener('input', (e) => {
            display.textContent = parseInt(e.target.value).toLocaleString();
        });
    }

    const prDuration = document.getElementById('pr-duration');
    if (prDuration) {
        const display = document.getElementById('pr-duration-value');
        const updateDurationDisplay = (val) => {
            const days = parseInt(val);
            const years = (days / 365).toFixed(1);
            display.textContent = days < 365 ? `${days} days` : `${days} days (${years} yr)`;
        };
        updateDurationDisplay(prDuration.value);
        prDuration.addEventListener('input', (e) => updateDurationDisplay(e.target.value));
    }

    const prInterval = document.getElementById('pr-interval');
    if (prInterval) {
        const display = document.getElementById('pr-interval-value');
        const updateIntervalDisplay = (val) => {
            const days = parseInt(val);
            if (days === 1) display.textContent = 'Daily';
            else if (days === 7) display.textContent = 'Weekly';
            else if (days === 30) display.textContent = 'Monthly';
            else display.textContent = `Every ${days} days`;
        };
        updateIntervalDisplay(prInterval.value);
        prInterval.addEventListener('input', (e) => updateIntervalDisplay(e.target.value));
    }

    const prEke = document.getElementById('pr-eke');
    if (prEke) {
        const display = document.getElementById('pr-eke-value');
        display.textContent = parseFloat(prEke.value).toFixed(1) + 'x';
        prEke.addEventListener('input', (e) => {
            display.textContent = parseFloat(e.target.value).toFixed(1) + 'x';
        });
    }

    // REALTIME SLIDERS
    const rtParticles = document.getElementById('rt-particles');
    if (rtParticles) {
        const display = document.getElementById('rt-particles-value');
        display.textContent = parseInt(rtParticles.value).toLocaleString();
        rtParticles.addEventListener('input', (e) => {
            display.textContent = parseInt(e.target.value).toLocaleString();

            // Update engine if exists
            if (engine && engine.setParameter) {
                // You might need to adjust particle count - this is complex
                console.log('Particle count changed to:', e.target.value);
            }
        });
    }

    const rtSpeed = document.getElementById('rt-speed');
    if (rtSpeed) {
        const display = document.getElementById('rt-speed-value');
        display.textContent = parseFloat(rtSpeed.value).toFixed(1) + 'x';
        rtSpeed.addEventListener('input', (e) => {
            const val = parseFloat(e.target.value).toFixed(1);
            display.textContent = val + 'x';

            // Update engine
            if (engine && engine.setParameter) {
                engine.setParameter('simulationSpeed', parseFloat(val));
            }
        });
    }

    const rtEke = document.getElementById('rt-eke');
    if (rtEke) {
        const display = document.getElementById('rt-eke-value');
        display.textContent = parseFloat(rtEke.value).toFixed(1) + 'x';
        rtEke.addEventListener('input', (e) => {
            const val = parseFloat(e.target.value).toFixed(1);
            display.textContent = val + 'x';

            // Update engine
            if (engine && engine.setParameter) {
                engine.setParameter('diffusivityScale', parseFloat(val));
            }
        });
    }

    // PLAYBACK SLIDERS
    const playbackSpeed = document.getElementById('playback-speed');
    if (playbackSpeed) {
        const display = document.getElementById('playback-speed-value');
        display.textContent = parseFloat(playbackSpeed.value).toFixed(1) + 'x';
        playbackSpeed.addEventListener('input', (e) => {
            const val = parseFloat(e.target.value).toFixed(1);
            display.textContent = val + 'x';
            if (bakeSystem) bakeSystem.playbackSpeed = parseFloat(val);
        });
    }

// Depth slider
    const depthSlider = document.getElementById('depth-slider');
    if (depthSlider) {
        console.log('✅ Depth slider found'); // Debug

        const display = document.getElementById('depth-value');
        const depthLevels = [0, 50, 100, 200, 500, 1000];

        const updateDepthDisplay = (idx) => {
            const depth = depthLevels[idx];
            currentDepth = depth; // Make sure this global is being updated!
            console.log(`📏 Depth slider moved to index ${idx}, depth ${depth}m`); // Debug

            if (depth === 0) display.textContent = 'Surface (0m)';
            else if (depth === 50) display.textContent = 'Near-surface (50m)';
            else if (depth === 100) display.textContent = 'Upper thermocline (100m)';
            else if (depth === 200) display.textContent = 'Lower thermocline (200m)';
            else if (depth === 500) display.textContent = 'Intermediate (500m)';
            else display.textContent = 'Deep ocean (1000m)';

            // Update HYCOM loader
            if (window.streamingHycomLoader3D) {
                window.streamingHycomLoader3D.setDefaultDepth(depth);
                console.log(`🌊 HYCOM default depth set to ${depth}m`);
            }

            // Refresh visualization
            console.log('🔄 Calling refreshVisualization()');
            refreshVisualization();
        };

        // Set initial value
        updateDepthDisplay(depthSlider.value);

        // Add event listener
        depthSlider.addEventListener('input', (e) => {
            console.log('🎯 Depth slider input event fired!', e.target.value); // Debug
            updateDepthDisplay(e.target.value);
        });

        console.log('✅ Depth slider event listener attached');
    }
}
// ==================== PRE-RENDER BUTTON ====================
function syncRealtimeControls() {
    if (!engine) return;

    console.log('🔄 Syncing realtime controls with engine');

    // Get values from UI
    const rtSpeed = document.getElementById('rt-speed');
    const rtEke = document.getElementById('rt-eke');
    const rtRk4 = document.getElementById('rt-rk4');

    // Apply to engine
    if (rtSpeed && engine.setParameter) {
        engine.setParameter('simulationSpeed', parseFloat(rtSpeed.value));
    }

    if (rtEke && engine.setParameter) {
        engine.setParameter('diffusivityScale', parseFloat(rtEke.value));
    }

    if (rtRk4 && engine.enableRK4) {
        engine.enableRK4(rtRk4.checked);
    }

    // Update UI to match
    updateUIForEngine();
}
// ==================== PLAYBACK CONTROLS SETUP ====================

function setupPlaybackControls() {
    console.log('🎮 Setting up playback controls');

    const playBtn = document.getElementById('playback-play');
    const pauseBtn = document.getElementById('playback-pause');
    const speedSlider = document.getElementById('playback-speed');
    const timelineSlider = document.getElementById('playback-timeline');

    // Play button
    if (playBtn) {
        // Remove any existing listeners
        const newPlayBtn = playBtn.cloneNode(true);
        playBtn.parentNode.replaceChild(newPlayBtn, playBtn);

        newPlayBtn.addEventListener('click', () => {
            console.log('▶️ Play clicked');
            if (bakeSystem) {
                bakeSystem.play();
                // Update button states if needed
            } else {
                console.warn('⚠️ No bakeSystem available');
            }
        });
    }

    // Pause button
    if (pauseBtn) {
        const newPauseBtn = pauseBtn.cloneNode(true);
        pauseBtn.parentNode.replaceChild(newPauseBtn, pauseBtn);

        newPauseBtn.addEventListener('click', () => {
            console.log('⏸️ Pause clicked');
            if (bakeSystem) {
                bakeSystem.pause();
            }
        });
    }

    // Speed slider
    if (speedSlider) {
        const speedValue = document.getElementById('playback-speed-value');
        if (speedValue) {
            speedValue.textContent = speedSlider.value + 'x';
        }

        speedSlider.addEventListener('input', (e) => {
            const speed = parseFloat(e.target.value);
            if (speedValue) {
                speedValue.textContent = speed.toFixed(1) + 'x';
            }
            if (bakeSystem) {
                bakeSystem.playbackSpeed = speed;
                console.log(`⚡ Playback speed set to ${speed}x`);
            }
        });
    }

    // Timeline slider
    if (timelineSlider) {
        timelineSlider.addEventListener('input', (e) => {
            if (!bakeSystem || bakeSystem.snapshots.length === 0) {
                console.warn('⚠️ No snapshots loaded');
                return;
            }

            const val = parseFloat(e.target.value);
            const maxDay = bakeSystem.snapshots[bakeSystem.snapshots.length - 1].day;
            const targetDay = val; // Since max is now in days, not percentage

            console.log(`📅 Seeking to day ${targetDay.toFixed(1)}`);
            bakeSystem.seek(targetDay);
        });
    }
}
function setupPreRenderButton() {
    const btn = document.getElementById('btn-start-prerender');
    if (!btn) return;

    btn.addEventListener('click', async () => {
        console.log('🎬 Starting pre-render...');

        // Get values from sliders
        const config = {
            numParticles: parseInt(document.getElementById('pr-particles').value),
            ekeDiffusivity: parseFloat(document.getElementById('pr-eke').value),
            rk4Enabled: document.getElementById('pr-rk4').checked,
            snapshotInterval: parseInt(document.getElementById('pr-interval').value),
            durationDays: parseInt(document.getElementById('pr-duration').value)
        };

        console.log('📋 Pre-render config:', config);

        // Show progress
        showPreRenderProgress();

        try {
            // Ensure we're in bake mode
            if (simulationMode !== 'baked') {
                document.getElementById('btn-pre-render').click();
            }

            // Start baking
            const snapshots = await bakeSystem.bake(config);

            // Load into playback
            bakeSystem.loadSnapshots(snapshots);

            // Hide pre-render controls, show playback
            document.getElementById('prender-controls').style.display = 'none';
            document.getElementById('playback-controls').style.display = 'block';

            // In setupPreRenderButton(), after getting snapshots
            if (snapshots.length > 0) {
                const maxDay = snapshots[snapshots.length - 1].day;

                // Update timeline slider - THIS IS CRITICAL
                const timeline = document.getElementById('playback-timeline');
                if (timeline) {
                    timeline.max = maxDay;  // Set the max to actual duration
                    timeline.value = 0;      // Reset to start
                }

                // Update labels
                document.getElementById('playback-date-end').textContent = `Day ${maxDay}`;
                document.getElementById('playback-date-start').textContent = 'Day 0';

                // Show first frame
                bakeSystem.seek(0);
            }

            hidePreRenderProgress();

        } catch (error) {
            console.error('❌ Pre-render failed:', error);
            alert('Pre-render failed: ' + error.message);
            hidePreRenderProgress();
        }
    });
}

function showPreRenderProgress() {
    const progress = document.getElementById('pr-progress');
    if (progress) progress.style.display = 'block';

    const btn = document.getElementById('btn-start-prerender');
    if (btn) btn.disabled = true;
}

function hidePreRenderProgress() {
    const progress = document.getElementById('pr-progress');
    if (progress) progress.style.display = 'none';

    const btn = document.getElementById('btn-start-prerender');
    if (btn) btn.disabled = false;
}

function updatePreRenderProgress(percent, message) {
    const bar = document.getElementById('pr-progress-bar');
    const msg = document.getElementById('pr-progress-message');
    const pct = document.getElementById('pr-progress-percent');

    if (bar) bar.style.width = percent + '%';
    if (msg) msg.textContent = message || 'Processing...';
    if (pct) pct.textContent = Math.round(percent) + '%';
}
// ==================== REALTIME CONTROLS ====================

function setupRealtimeControls() {
    const startBtn = document.getElementById('rt-start');
    const resetBtn = document.getElementById('rt-reset');

    if (startBtn) {
        startBtn.addEventListener('click', () => {
            if (!engine) return;

            if (!engine.isRunning) {
                if (engine.stats.totalReleased === 0) {
                    engine.startSimulation();
                } else {
                    engine.resumeSimulation();
                }
                startBtn.innerHTML = '<i class="fas fa-pause"></i> PAUSE';
                startBtn.classList.remove('btn-primary');
                startBtn.classList.add('btn-secondary');
            } else {
                engine.pauseSimulation();
                startBtn.innerHTML = '<i class="fas fa-play"></i> START';
                startBtn.classList.remove('btn-secondary');
                startBtn.classList.add('btn-primary');
            }
        });
    }

    if (resetBtn) {
        resetBtn.addEventListener('click', () => {
            if (engine) {
                engine.resetSimulation();

                // Reset UI
                startBtn.innerHTML = '<i class="fas fa-play"></i> START';
                startBtn.classList.remove('btn-secondary');
                startBtn.classList.add('btn-primary');

                // Clear visualizations
                if (deckgl) deckgl.setProps({ layers: [] });
                if (particleCanvas && particleCanvas.clearAllParticles) {
                    particleCanvas.clearAllParticles();
                }
            }
        });
    }

}

function updateUIForEngine() {
    if (!engine) return;

    console.log('🔄 Updating UI for engine state');

    // ===== REALTIME CONTROLS =====

    // Update particle count slider
    const rtParticles = document.getElementById('rt-particles');
    const rtParticlesValue = document.getElementById('rt-particles-value');
    if (rtParticles && rtParticlesValue) {
        // You might want to sync this with actual particle count
        // But particle count is usually fixed at startup
        const activeCount = engine.getActiveParticles().length;
        rtParticlesValue.textContent = activeCount.toLocaleString();
    }

    // Update simulation speed slider
    const rtSpeed = document.getElementById('rt-speed');
    const rtSpeedValue = document.getElementById('rt-speed-value');
    if (rtSpeed && rtSpeedValue) {
        const speed = engine.params?.simulationSpeed || 1.0;
        rtSpeed.value = speed;
        rtSpeedValue.textContent = speed.toFixed(1) + 'x';
    }

    // Update EKE diffusivity slider
    const rtEke = document.getElementById('rt-eke');
    const rtEkeValue = document.getElementById('rt-eke-value');
    if (rtEke && rtEkeValue) {
        const eke = engine.params?.diffusivityScale || 1.0;
        rtEke.value = eke;
        rtEkeValue.textContent = eke.toFixed(1) + 'x';
    }

    // Update RK4 toggle
    const rtRk4 = document.getElementById('rt-rk4');
    if (rtRk4) {
        rtRk4.checked = engine.rk4Enabled || false;
    }

    // Update start/pause button
    const startBtn = document.getElementById('rt-start');
    if (startBtn) {
        if (engine.isRunning) {
            startBtn.innerHTML = '<i class="fas fa-pause"></i> PAUSE';
            startBtn.classList.remove('btn-primary');
            startBtn.classList.add('btn-secondary');
        } else {
            if (engine.stats.totalReleased === 0 && engine.stats.simulationDays === 0) {
                startBtn.innerHTML = '<i class="fas fa-play"></i> START';
            } else {
                startBtn.innerHTML = '<i class="fas fa-play"></i> RESUME';
            }
            startBtn.classList.remove('btn-secondary');
            startBtn.classList.add('btn-primary');
        }
    }

    // ===== PRE-RENDER CONTROLS (initial values only) =====
    // These don't need frequent updates, but set initial state

    const prRk4 = document.getElementById('pr-rk4');
    if (prRk4) {
        prRk4.checked = engine.rk4Enabled || false;
    }

    const prEke = document.getElementById('pr-eke');
    const prEkeValue = document.getElementById('pr-eke-value');
    if (prEke && prEkeValue) {
        const eke = engine.params?.diffusivityScale || 1.0;
        prEke.value = eke;
        prEkeValue.textContent = eke.toFixed(1) + 'x';
    }

    // ===== STATS DISPLAY =====
    // Update the stats panel with current data
    updateStatsDisplay();

    console.log('✅ UI updated for engine');
}

function updateCanvasOverlay() {
    if (particleCanvas && particleCanvas.updateParticles && engine) {
        const particles = engine.getActiveParticles();
        particleCanvas.updateParticles(particles);
    }
}

// ==================== UTILITY FUNCTIONS ====================

function addMapControls(map) {
    L.control.scale({ imperial: false, position: 'bottomleft' }).addTo(map);
}

function showDataWarning(message) {
    const warningElement = document.getElementById('dataWarning') || createWarningElement();
    warningElement.innerHTML = `⚠️ ${message}`;
    warningElement.style.display = 'block';

    setTimeout(() => {
        warningElement.style.opacity = '0';
        setTimeout(() => {
            warningElement.style.display = 'none';
            warningElement.style.opacity = '1';
        }, 500);
    }, 5000);
}

function createWarningElement() {
    const warning = document.createElement('div');
    warning.id = 'dataWarning';
    warning.style.cssText = `
        position: fixed;
        top: 100px;
        left: 50%;
        transform: translateX(-50%);
        background: rgba(255, 193, 7, 0.9);
        color: #333;
        padding: 15px 25px;
        border-radius: 8px;
        font-family: 'Segoe UI', sans-serif;
        font-size: 14px;
        z-index: 9999;
        text-align: center;
        box-shadow: 0 4px 12px rgba(0,0,0,0.2);
        transition: opacity 0.5s;
    `;
    document.body.appendChild(warning);
    return warning;
}

function showErrorMessage(message) {
    const errorElement = document.createElement('div');
    errorElement.style.cssText = `
        position: fixed;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
        background: rgba(220, 53, 69, 0.95);
        color: white;
        padding: 25px 35px;
        border-radius: 10px;
        font-family: 'Segoe UI', sans-serif;
        font-size: 16px;
        z-index: 10000;
        text-align: center;
        max-width: 80%;
        box-shadow: 0 8px 25px rgba(0,0,0,0.3);
    `;
    errorElement.innerHTML = `
        <div style="font-size: 24px; margin-bottom: 10px;">❌ Error</div>
        <div>${message}</div>
        <button onclick="this.parentElement.remove()" style="
            margin-top: 15px;
            background: white;
            color: #dc3545;
            border: none;
            padding: 8px 20px;
            border-radius: 5px;
            cursor: pointer;
            font-weight: bold;
        ">Dismiss</button>
    `;
    document.body.appendChild(errorElement);
}

function createStatusElement() {
    const status = document.createElement('div');
    status.id = 'loadingStatus';
    status.style.cssText = `
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        background: rgba(10, 25, 41, 0.95);
        display: flex;
        flex-direction: column;
        justify-content: center;
        align-items: center;
        color: white;
        font-family: 'Segoe UI', sans-serif;
        text-align: center;
        z-index: 9999;
        transition: opacity 0.5s ease;
    `;

    status.innerHTML = `
        <div style="font-size: 24px; color: #4fc3f7; margin-bottom: 20px;">
            🌊 Loading Fukushima Plume Simulator
        </div>
        <div id="loadingMessage" style="font-size: 18px; margin-bottom: 30px;">
            Initializing...
        </div>
        <div style="width: 200px; height: 4px; background: rgba(255,255,255,0.1); border-radius: 2px;">
            <div id="loadingBar" style="width: 0%; height: 100%; background: #4fc3f7; border-radius: 2px; transition: width 0.3s;"></div>
        </div>
        <div style="margin-top: 30px; font-size: 14px; color: #b0bec5;">
            Using HYCOM 2011-2013 currents and AVISO EKE
        </div>
    `;

    document.body.appendChild(status);
    return status;
}

function updateLoadingStatus(message, progress = 0) {
    const statusElement = document.getElementById('loadingStatus');
    if (!statusElement) return;

    const messageElement = document.getElementById('loadingMessage');
    const barElement = document.getElementById('loadingBar');

    if (messageElement) {
        messageElement.textContent = `⚙️ ${message}`;
    }

    if (barElement) {
        barElement.style.width = `${Math.min(100, progress)}%`;
    }

    if (progress >= 100) {
        setTimeout(hideLoadingStatus, 500);
    }
}

function hideLoadingStatus() {
    const statusElement = document.getElementById('loadingStatus');
    if (statusElement) {
        statusElement.style.opacity = '0';
        setTimeout(() => {
            if (statusElement.parentNode) {
                statusElement.parentNode.removeChild(statusElement);
            }
        }, 500);
    }
}
function setupTrailToggle() {
    const trailsToggle = document.getElementById('trailsToggle');

    if (trailsToggle) {
        trailsToggle.checked = showParticleTrails;
        // Update the toggle event listener to clear trails:
        trailsToggle.addEventListener('change', (e) => {
            showParticleTrails = e.target.checked;
            console.log(`Particle trails: ${showParticleTrails ? 'ON' : 'OFF'}`);

            // Clear existing trails if turning off
            if (!showParticleTrails && particleCanvas && particleCanvas.clearTrails) {
                particleCanvas.clearTrails();
            }

            // Update visualization
            if (engine && visualizationMode === 'particles') {
                const particles = engine.getActiveParticles();
                updateDeckGLParticles(particles);
                if (particleCanvas && particleCanvas.updateParticles) {
                    particleCanvas.updateParticles(particles);
                }
            }
        });
    }
}
// ==================== START APPLICATION ====================

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    setTimeout(init, 100);
}