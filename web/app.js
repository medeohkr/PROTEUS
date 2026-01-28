// web/app.js - HYBRID LEAFLET + DECK.GL VERSION
console.log('=== app.js STARTING HYBRID VERSION ===');

// Global variables
let engine = null;
let animationId = null;

// Leaflet globals
let simMap = null;
let particleCanvas = null;

// Deck.gl globals
let deckgl = null;
let heatmapLayer = null;
let showHeatmap = true;

let heatmapParams = {
    intensity: 10.0,     // Much higher!
    radiusPixels: 150,   // Larger radius
    opacity: 0.9,
    threshold: 0.001,    // Lower threshold
    useLogScale: true,   // Enable log scaling
    gridSize: 0.5        // Grid resolution in degrees
};

// Time globals
let simulationStartDate = new Date('2011-03-11T00:00:00Z');
let currentSimulationDate = new Date(simulationStartDate);
let simulationDay = 0;
let timeSliderDragging = false;

// Heatmap data cache
let heatmapData = [];
let lastHeatmapUpdate = 0;
const HEATMAP_UPDATE_INTERVAL = 500; // Update every second

async function init() {
    console.log('=== INITIALIZATION HYBRID VERSION ===');

    // Initialize date/time
    simulationStartDate = new Date('2011-03-11T00:00:00Z');
    currentSimulationDate = new Date(simulationStartDate);
    simulationDay = 0;

    // 1. CREATE LEAFLET MAP (as before)
    console.log('Creating Leaflet map...');
    simMap = L.map('map', {
        center: [25.0, 165.0],
        zoom: 3,
        minZoom: 2,
        maxZoom: 8,
        worldCopyJump: false,
        attributionControl: true,
        zoomControl: true,
        maxBounds: [[-90, -180], [90, 360]]
    });

    // 2. ADD BASEMAP (Dark theme)
    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
        attribution: '© OpenStreetMap, © CARTO',
        maxZoom: 8
    }).addTo(simMap);

    // 3. CREATE PARTICLE OVERLAY (Leaflet circles)
    console.log('Creating particle overlay...');
    particleCanvas = createCanvasOverlay();
    simMap.addLayer(particleCanvas);

    // 4. INITIALIZE DECK.GL OVERLAY
    console.log('Initializing deck.gl overlay...');
    await initDeckGL();

    // 5. INITIALIZE ENGINE
    if (typeof ParticleEngine === 'function') {
        engine = new ParticleEngine(20000);

        console.log('Loading ocean data...');
        try {
            const success = await engine.init();
            if (!success) {
                console.warn('Using fallback data');
                showDataWarning('Using fallback data');
            }
        } catch (error) {
            console.error('Engine init failed:', error);
            showErrorMessage('Failed to load data. Using fallback.');
        }
    } else {
        console.error('ParticleEngine not found!');
        return false;
    }

    // 6. ADD MAP CONTROLS
    addMapControls(simMap);


    // 8. SET UP YOUR EXISTING SIMULATION CONTROLS
    setupControls();
    setupHeatmapControls();
    updateUIForEngine();
    updateDateTimeDisplay();

    // 9. ADD MAP EVENT LISTENERS
    simMap.on('moveend resize zoomend', function() {
        updateCanvasOverlay();
        updateDeckGLView();
    });

    // 10. START ANIMATION
    animate();

    console.log('✅ Hybrid Leaflet + deck.gl initialized');
    return true;
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
        const width = window.innerWidth - 360; // Account for controls panel
        const height = window.innerHeight;
        canvas.width = width;
        canvas.height = height;

        // Initial view state (centered on Pacific)
        const initialViewState = {
            longitude: 165.0,
            latitude: 25.0,
            zoom: 3,
            pitch: 0,
            bearing: 0
        };

        // Create deck.gl instance with v8 API
        deckgl = new deck.Deck({
            canvas: canvas,
            initialViewState: initialViewState,
            controller: false, // Let Leaflet handle interaction
            layers: [],
            // For v8, we can use this simpler approach
            parameters: {
                blend: true,
                blendFunc: [0x0302, 0x0303] // SRC_ALPHA, ONE_MINUS_SRC_ALPHA as hex values
            }
        });

        // Sync deck.gl with Leaflet view
        updateDeckGLView();

        // Handle window resize
        window.addEventListener('resize', handleResize);

        console.log('✅ deck.gl v8.9.35 initialized successfully');

        // Show heatmap control panel
        document.getElementById('heatmap-control').style.display = 'block';

    } catch (error) {
        console.error('Failed to initialize deck.gl:', error);
        console.warn('Running in Leaflet-only mode');
        // Optional: show a subtle warning but don't break the app
        showDataWarning('WebGL heatmap not available. Using Leaflet visualization only.');
    }
}
function updateDeckGLView() {
    if (!deckgl || !simMap) return;

    const center = simMap.getCenter();
    const zoom = simMap.getZoom();
    const bounds = simMap.getBounds();

    // Convert Leaflet zoom to deck.gl zoom (different scales)
    // deck.gl zoom is approximately Leaflet zoom - 1
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
function createDensityGrid(particles, gridSize = 0.5) {
    const grid = {};
    const totalMass = particles.reduce((sum, p) => sum + p.mass, 0);

    particles.forEach(p => {
        const lon = engine.FUKUSHIMA_LON + (p.x / engine.LON_SCALE);
        const lat = engine.FUKUSHIMA_LAT + (p.y / engine.LAT_SCALE);

        // Round to grid cell
        const gridX = Math.floor(lon / gridSize);
        const gridY = Math.floor(lat / gridSize);
        const key = `${gridX},${gridY}`;

        if (!grid[key]) {
            grid[key] = {
                position: [gridX * gridSize + gridSize/2, gridY * gridSize + gridSize/2],
                mass: 0,
                count: 0
            };
        }

        grid[key].mass += p.mass;
        grid[key].count++;
    });

    // Convert to array and calculate DENSITY (mass/area)
    const data = Object.values(grid);

    if (data.length === 0) return [];

    // Calculate densities
    const cellArea = gridSize * 111 * gridSize * 111 * Math.cos(37.4 * Math.PI/180); // km²
    data.forEach(cell => {
        // Concentration in "mass per 1000 km²"
        cell.density = (cell.mass / cellArea) * 1000;
    });

    // Normalize for visualization (0-1 range)
    const maxDensity = Math.max(...data.map(d => d.density));
    data.forEach(cell => {
        cell.normalizedDensity = cell.density / maxDensity;
    });

    console.log(`📍 Density grid: ${data.length} cells, Max density=${maxDensity.toExponential(2)}`);

    return data;
}
function updateDeckGLHeatmap(particles) {
    if (!deckgl || !showHeatmap || particles.length === 0) return;

    const now = Date.now();
    if (now - lastHeatmapUpdate < HEATMAP_UPDATE_INTERVAL) return;
    lastHeatmapUpdate = now;

    // CRITICAL: Create a density grid first
    const gridData = createDensityGrid(particles, 0.5); // 0.5° grid

    // Convert to heatmap points
    const heatmapData = gridData.map(cell => {
        return {
            position: cell.position,
            weight: cell.density // Use normalized density
        };
    });

    if (heatmapData.length === 0) return;

    // Calculate stats for debugging
    const weights = heatmapData.map(d => d.weight);
    const maxWeight = Math.max(...weights);
    const avgWeight = weights.reduce((a, b) => a + b) / weights.length;

    console.log(`📊 Heatmap stats: Max=${maxWeight.toFixed(4)}, Avg=${avgWeight.toFixed(4)}, Cells=${heatmapData.length}`);

    heatmapLayer = new deck.HeatmapLayer({
        id: 'fukushima-heatmap',
        data: heatmapData,
        getPosition: d => d.position,
        getWeight: d => {
            // LOG SCALE: Emphasize concentration differences
            let weight = d.weight;

            if (heatmapParams.useLogScale) {
                // log10(1 + weight) compresses high values
                weight = Math.log10(1 + weight * 100);
            }

            return weight * heatmapParams.intensity * 10; // Multiply more!
        },

        // NOAA-like color scheme (from their paper)
        colorRange: [
            [13, 8, 135, 0],     // Dark blue (transparent)
            [40, 60, 190, 50],   // Blue
            [23, 154, 176, 100], // Cyan-blue
            [13, 188, 121, 150], // Blue-green
            [62, 218, 79, 200],  // Green
            [130, 226, 74, 220], // Yellow-green
            [192, 226, 70, 235], // Yellow
            [243, 210, 65, 245], // Orange-yellow
            [251, 164, 57, 250], // Orange
            [241, 99, 55, 255],  // Red-orange
            [231, 29, 43, 255],  // Red
            [190, 0, 38, 255]    // Dark red
        ],

        // Larger radius for smoother gradient
        radiusPixels: heatmapParams.radiusPixels,

        // CRITICAL: Manual intensity scaling
        intensity: 5.0, // Fixed high value

        // Lower threshold to show more
        threshold: 0.01,

        // Manual color domain (min, max) - prevents auto-scaling to uniform
        colorDomain: [0, 10], // Adjust based on your data

        // Aggregation mode
        aggregation: 'SUM'
    });

    deckgl.setProps({
        layers: [heatmapLayer]
    });
}
function clearDeckGLHeatmap() {
    if (!deckgl) return;

    deckgl.setProps({
        layers: []
    });
}

// ==================== HEATMAP CONTROLS ====================

function setupHeatmapControls() {
    // Main toggle (in controls panel)
    const heatmapToggleMain = document.getElementById('heatmapToggleMain');
    if (heatmapToggleMain) {
        heatmapToggleMain.checked = showHeatmap;
        heatmapToggleMain.addEventListener('change', (e) => {
            showHeatmap = e.target.checked;
            toggleHeatmap();
        });
    }

    // Heatmap panel toggle
    const heatmapToggle = document.getElementById('heatmapToggle');
    if (heatmapToggle) {
        heatmapToggle.checked = showHeatmap;
        heatmapToggle.addEventListener('change', (e) => {
            showHeatmap = e.target.checked;
            toggleHeatmap();
            if (heatmapToggleMain) heatmapToggleMain.checked = showHeatmap;
        });
    }

    // Intensity slider
    const intensitySlider = document.getElementById('intensitySlider');
    const intensityValue = document.getElementById('intensityValue');
    if (intensitySlider && intensityValue) {
        intensitySlider.value = heatmapParams.intensity;
        intensityValue.textContent = heatmapParams.intensity.toFixed(1);
        intensitySlider.addEventListener('input', (e) => {
            heatmapParams.intensity = parseFloat(e.target.value);
            intensityValue.textContent = heatmapParams.intensity.toFixed(1);
        });
    }

    // Radius slider
    const radiusSlider = document.getElementById('radiusSlider');
    const radiusValue = document.getElementById('radiusValue');
    if (radiusSlider && radiusValue) {
        radiusSlider.value = heatmapParams.radiusPixels;
        radiusValue.textContent = heatmapParams.radiusPixels;
        radiusSlider.addEventListener('input', (e) => {
            heatmapParams.radiusPixels = parseInt(e.target.value);
            radiusValue.textContent = heatmapParams.radiusPixels;
        });
    }

    // Add a log scale toggle
    const heatmapSection = document.querySelector('.parameter-section');
    if (heatmapSection) {
        const logScaleHTML = `
            <div class="toggle-container" style="margin-top: 10px;">
                <label>Logarithmic Scale</label>
                <label class="toggle-switch">
                    <input type="checkbox" id="logScaleToggle" checked>
                    <span class="toggle-slider"></span>
                </label>
            </div>
        `;

        // Insert after radius slider
        const radiusSlider = document.getElementById('radiusSlider');
        if (radiusSlider) {
            radiusSlider.closest('.heatmap-slider').insertAdjacentHTML('afterend', logScaleHTML);

            // Add event listener
            setTimeout(() => {
                const logToggle = document.getElementById('logScaleToggle');
                if (logToggle) {
                    logToggle.addEventListener('change', (e) => {
                        heatmapParams.useLogScale = e.target.checked;
                    });
                }
            }, 100);
        }
    }
}

function toggleHeatmap() {
    if (showHeatmap) {
        // Heatmap ON: Hide deck.gl canvas, clear heatmap
        document.getElementById('deckgl-overlay').style.opacity = 1;

        // Force particle layer to redraw (which will draw nothing)
        if (particleCanvas && engine) {
            const particles = engine.getActiveParticles();
            particleCanvas.updateParticles(particles); // This now respects showHeatmap
        }

        console.log('🔥 Heatmap ON - Particles hidden');
    } else {
        // Heatmap OFF: Show particles, hide heatmap
        document.getElementById('deckgl-overlay').style.opacity = 0;
        clearDeckGLHeatmap();

        // Force particle layer to redraw (which will draw particles)
        if (particleCanvas && engine) {
            const particles = engine.getActiveParticles();
            particleCanvas.updateParticles(particles);
        }

        console.log('🌀 Heatmap OFF - Particles visible');
    }
}
// ==================== LEAFLET FUNCTIONS (mostly unchanged) ====================

function createCanvasOverlay() {
    const particleLayer = L.layerGroup();
    window.particleMarkers = [];

    particleLayer.updateParticles = function(particles) {
        // CRITICAL: Clear ALL markers first
        this.clearLayers();
        window.particleMarkers = [];

        // If heatmap is ON, don't draw ANY particles
        if (showHeatmap) {
            console.log('Heatmap on: No particles drawn');
            return; // Exit early - no particles!
        }

        if (!engine) {
            console.error('❌ Engine not initialized');
            return;
        }

        // Only draw particles when heatmap is OFF
        const limit = Math.min(particles.length, 2000);

        for (let i = 0; i < limit; i++) {
            const p = particles[i];
            const lon = engine.FUKUSHIMA_LON + (p.x / engine.LON_SCALE);
            const lat = engine.FUKUSHIMA_LAT + (p.y / engine.LAT_SCALE);

            // SIMPLE: All particles are blue for Cs137
            const color = '#4fc3f7'; // Blue color

            const marker = L.circleMarker([lat, lon], {
                radius: Math.max(1, Math.sqrt(p.mass) * 2),
                color: color,
                fillColor: color,
                fillOpacity: 0.6 + p.mass * 0.3,
                weight: 0.5,
                opacity: 0.8
            });

            // FIX: Update popup content for Cs-137 only
            marker.bindPopup(`
                <div style="font-family: 'Segoe UI', sans-serif; font-size: 12px;">
                    <strong>Cesium-137 Particle</strong><br>
                    Location: ${lat.toFixed(2)}°N, ${lon.toFixed(2)}°E<br>
                    Age: ${p.age.toFixed(1)} days<br>
                    Mass: ${p.mass.toFixed(3)}<br>
                    Distance: ${Math.sqrt(p.x*p.x + p.y*p.y).toFixed(0)} km
                </div>
            `);

            marker.addTo(this);
            window.particleMarkers.push(marker);
        } // <-- THIS WAS MISSING!

        console.log(`✅ Drew ${limit} particles (heatmap: ${showHeatmap})`);
    };

    particleLayer.clearAllParticles = function() {
        this.clearLayers();
        window.particleMarkers = [];

        // Also clear deck.gl heatmap
        clearDeckGLHeatmap();

        console.log('🧹 Cleared ALL visualization layers');
    };

    return particleLayer;
}
// ==================== ANIMATION LOOP ====================

function animate() {
    if (engine && engine.isRunning) {
        engine.update();

        // Get current particles
        const particles = engine.getActiveParticles();

        // Always update heatmap if it's enabled
        if (showHeatmap) {
            updateDeckGLHeatmap(particles);
        }

        // Update particles on map (respects showHeatmap flag)
        if (particleCanvas && particleCanvas.updateParticles) {
            particleCanvas.updateParticles(particles);
        }

        // Update date/time and stats
        updateDateTimeDisplay();
        updateStatsDisplay();
        updateUIForEngine();
        updateDataSourceDisplay();
    }

    animationId = requestAnimationFrame(animate);
}

function updateDateTimeDisplay() {
    if (!engine) return;

    // Update from engine if available
    if (engine.getFormattedTime) {
        const time = engine.getFormattedTime();
        currentSimulationDate = new Date(
            time.year, time.month - 1, time.day,
            time.hour, time.minute, time.second
        );
        simulationDay = engine.stats.simulationDays || 0;
    } else {
        // Manual calculation
        simulationDay = engine.stats.simulationDays || 0;
        currentSimulationDate = new Date(
            simulationStartDate.getTime() + (simulationDay * 86400000)
        );
    }

    // Update display
    const dateDisplay = document.getElementById('dateDisplay');
    const timeLabel = document.getElementById('timeLabel');
    const simDayDisplay = document.getElementById('simDay');

    if (dateDisplay) {
        const dateStr = currentSimulationDate.toLocaleDateString('en-US', {
            year: 'numeric',
            month: 'long',
            day: 'numeric'
        });
        dateDisplay.querySelector('.date-label').textContent = dateStr;
    }

    if (timeLabel) {
        const timeStr = currentSimulationDate.toLocaleTimeString('en-US', {
            hour12: false,
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit'
        });
        timeLabel.textContent = timeStr + ' UTC';
    }

    if (simDayDisplay) {
        simDayDisplay.textContent = Math.floor(simulationDay);
    }
}

function updateStatsDisplay() {
    if (!engine) return;

    const particleCount = document.getElementById('particleCount');
    const totalReleased = document.getElementById('totalReleased');
    const decayedCount = document.getElementById('decayedCount');

    if (particleCount) {
        particleCount.textContent = engine.getActiveParticles().length.toLocaleString();
    }

    if (totalReleased) {
        totalReleased.textContent = (engine.stats.totalReleased || 0).toLocaleString();
    }

    if (decayedCount) {
        decayedCount.textContent = (engine.stats.totalDecayed || 0).toLocaleString();
    }
}

function addMapControls(map) {
    // Scale control
    L.control.scale({ imperial: false, position: 'bottomleft' }).addTo(map);
}

function updateCanvasOverlay() {
    if (particleCanvas && particleCanvas.redraw) {
        particleCanvas.redraw();
    }
}

function setupControls() {
    console.log('Setting up controls...');

    // Get controls
    const kuroshioSlider = document.getElementById('kuroshioSlider');
    const diffusionSlider = document.getElementById('diffusionSlider');
    const speedSlider = document.getElementById('speedSlider');
    const startBtn = document.getElementById('startBtn');
    const resetBtn = document.getElementById('resetBtn');

    // Remove references to deleted controls
    // const interpolationToggle = document.getElementById('interpolationToggle'); // REMOVED
    // const decayToggle = document.getElementById('decayToggle'); // REMOVED
    // const ekeToggle = document.getElementById('ekeToggle'); // REMOVED
    // const timescaleSlider = document.getElementById('timescaleSlider'); // REMOVED

    // Helper function to update engine parameter
    function updateEngineParam(paramName, value, displayId = null) {
        if (!engine || !engine.params) {
            console.error('Engine not initialized');
            return;
        }

        if (engine.params[paramName] !== undefined) {
            engine.params[paramName] = value;

            if (displayId) {
                const display = document.getElementById(displayId);
                if (display) {
                    display.textContent = value.toFixed(1);
                }
            }

            console.log(`Updated ${paramName} = ${value}`);
        }
    }

    // Add event listeners
    if (kuroshioSlider) {
        kuroshioSlider.addEventListener('input', (e) => {
            updateEngineParam('kuroshioMultiplier', parseFloat(e.target.value), 'kuroshioValue');
        });
    }

    if (diffusionSlider) {
        diffusionSlider.addEventListener('input', (e) => {
            updateEngineParam('diffusivityScale', parseFloat(e.target.value), 'diffusionValue');
        });
    }

    if (speedSlider) {
        speedSlider.addEventListener('input', (e) => {
            updateEngineParam('simulationSpeed', parseFloat(e.target.value), 'speedValue');
        });
    }

    // Start/Stop button - TOGGLE functionality
    if (startBtn) {
        startBtn.addEventListener('click', () => {
            if (!engine) return;

            if (!engine.isRunning) {
                // Start simulation
                engine.startSimulation();
                startBtn.textContent = '⏹️ Stop Simulation';
                startBtn.style.background = 'linear-gradient(135deg, #ff6b6b, #ff4757)';
                console.log('🚀 Simulation started');
            } else {
                // Stop simulation
                engine.stopSimulation();
                startBtn.textContent = '▶ Start Simulation';
                startBtn.style.background = 'linear-gradient(135deg, #4fc3f7, #2979ff)';
                console.log('⏸️ Simulation stopped');
            }
        });
    }

    // Reset button
    if (resetBtn) {
        resetBtn.addEventListener('click', () => {
            if (engine) {
                // Reset everything
                if (particleCanvas && particleCanvas.clearAllParticles) {
                    particleCanvas.clearAllParticles();
                }
                engine.resetSimulation();

                // Reset button to "Start"
                if (startBtn) {
                    startBtn.textContent = '▶ Start Simulation';
                    startBtn.style.background = 'linear-gradient(135deg, #4fc3f7, #2979ff)';
                }

                updateUIForEngine();
                console.log('✅ Simulation reset');
            }
        });
    }

    console.log('✅ Controls setup complete');
}

function updateUIForEngine() {
    if (!engine) return;


    const params = engine.params;

    // Update sliders
    const kuroshioSlider = document.getElementById('kuroshioSlider');
    const diffusionSlider = document.getElementById('diffusionSlider');
    const speedSlider = document.getElementById('speedSlider');

    if (kuroshioSlider) {
        kuroshioSlider.value = params.kuroshioMultiplier;
        document.getElementById('kuroshioValue').textContent = params.kuroshioMultiplier.toFixed(1);
    }

    if (diffusionSlider) {
        diffusionSlider.value = params.diffusivityScale;
        document.getElementById('diffusionValue').textContent = params.diffusivityScale.toFixed(1);
    }

    if (speedSlider) {
        // CRITICAL FIX: Always sync slider with actual speed
        speedSlider.value = params.simulationSpeed;
        document.getElementById('speedValue').textContent = params.simulationSpeed.toFixed(1);
    }
    // Update data source display
    const dataSourceElement = document.getElementById('dataSource');
    if (dataSourceElement) {
        dataSourceElement.textContent = `OSCAR 2011 + AVISO EKE ×${params.diffusivityScale.toFixed(1)}`;
        dataSourceElement.style.color = '#4fc3f7';
    }

    // Update start/stop button based on engine state
    const startBtn = document.getElementById('startBtn');
    if (startBtn) {
        if (engine.isRunning) {
            startBtn.textContent = '⏹️ Stop Simulation';
            startBtn.style.background = 'linear-gradient(135deg, #ff6b6b, #ff4757)';
        } else {
            startBtn.textContent = '▶ Start Simulation';
            startBtn.style.background = 'linear-gradient(135deg, #4fc3f7, #2979ff)';
        }
    }

    updateStatsDisplay();
}
function updateDataSourceDisplay() {  // FIXED: Was "unction" instead of "function"
    if (!engine) return;

    const sourceElem = document.getElementById('dataSource');
    const particleElem = document.getElementById('particleCount');

    if (sourceElem) {
        if (engine.params.useEKEData) {
            sourceElem.textContent = `AVISO EKE ×${engine.params.diffusivityScale.toFixed(1)}`;
            sourceElem.style.color = '#4fc3f7';
        } else {
            sourceElem.textContent = 'Parameterized Diffusion';
            sourceElem.style.color = '#ff6b6b';
        }
    }

    if (particleElem && engine.isRunning) {
        const active = engine.getActiveParticles().length;
        particleElem.textContent = active.toLocaleString();
        particleElem.style.color = active > 0 ? '#4fc3f7' : '#ff6b6b';
    }
}

function showDataWarning(message) {
    const warningElement = document.getElementById('dataWarning') || createWarningElement();
    warningElement.innerHTML = `⚠️ ${message} <br><small>Simulation will still work with parameterized values</small>`;
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
            Using OSCAR 2011 current data and AVISO EKE
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

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    setTimeout(init, 100);
}