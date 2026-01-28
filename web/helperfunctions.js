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

    // Update time slider if not being dragged
    const timeSlider = document.getElementById('timeSlider');
    const timePosition = document.getElementById('timePosition');

    if (timeSlider && !timeSliderDragging) {
        const maxDays = 365; // One year simulation
        const sliderValue = Math.min(maxDays, Math.floor(simulationDay));
        timeSlider.value = sliderValue;

        if (timePosition) {
            timePosition.textContent = `Day ${sliderValue}`;
        }
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
    // Custom button to center on Fukushima
    const fukushimaButton = L.control({ position: 'topleft' });
    fukushimaButton.onAdd = function() {
        const div = L.DomUtil.create('div', 'leaflet-bar leaflet-control leaflet-control-custom');
        div.innerHTML = `
            <button style="
                width: 80px;
                height: 30px;
                background: rgba(20, 30, 48, 0.95);
                color: white;
                border: 1px solid #4fc3f7;
                border-radius: 4px;
                cursor: pointer;
                font-size: 16px;
                display: flex;
                align-items: center;
                justify-content: center;
            " title="Center on Fukushima">Center</button>
        `;
        div.onclick = () => {
            map.setView([37.4, 141.6], 5);
        };
        return div;
    };
    fukushimaButton.addTo(map);

    // Scale control
    L.control.scale({ imperial: false, position: 'bottomleft' }).addTo(map);
}
function updateCanvasOverlay() {
    if (particleCanvas && particleCanvas.redraw) {
        particleCanvas.redraw();
    }
}

function setupTimeControls() {
    const timeSlider = document.getElementById('timeSlider');

    if (!timeSlider) return;

    // Time slider events
    timeSlider.addEventListener('input', function(e) {
        timeSliderDragging = true;
        const day = parseInt(e.target.value);

        // Update position label
        const timePosition = document.getElementById('timePosition');
        if (timePosition) {
            timePosition.textContent = `Day ${day}`;
        }

        // Calculate date
        const newDate = new Date(simulationStartDate.getTime() + (day * 86400000));
        const dateStr = newDate.toLocaleDateString('en-US', {
            year: 'numeric',
            month: 'long',
            day: 'numeric'
        });

        // Update display temporarily
        const dateDisplay = document.getElementById('dateDisplay');
        if (dateDisplay) {
            dateDisplay.querySelector('.date-label').textContent = dateStr;
        }
    });

    timeSlider.addEventListener('change', function(e) {
        const day = parseInt(e.target.value);
        timeSliderDragging = false;

        // TODO: Implement time jumping functionality
        console.log(`Time jump requested to day ${day}`);
        // This would require saving/loading simulation state
    });
}

function setupControls() {
    console.log('Setting up controls...');

    // Get only the controls that actually exist in your HTML
    const kuroshioSlider = document.getElementById('kuroshioSlider');
    const diffusionSlider = document.getElementById('diffusionSlider');
    const speedSlider = document.getElementById('speedSlider');
    const timescaleSlider = document.getElementById('timescaleSlider');
    const startBtn = document.getElementById('startBtn');
    const resetBtn = document.getElementById('resetBtn');
    const interpolationToggle = document.getElementById('interpolationToggle');
    const decayToggle = document.getElementById('decayToggle');
    const ekeToggle = document.getElementById('ekeToggle');

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

            // Update data source display if needed
            if (paramName === 'useEKEData') {
                updateDataSourceDisplay();
            }
        }
    }

    // Add event listeners ONLY if elements exist
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

    if (timescaleSlider) {
        timescaleSlider.addEventListener('input', (e) => {
            updateEngineParam('lagrangianTimescale', parseInt(e.target.value), 'timescaleValue');
        });
    }

    if (interpolationToggle) {
        interpolationToggle.addEventListener('change', (e) => {
            updateEngineParam('useBilinearInterpolation', e.target.checked);
        });
    }

    if (decayToggle) {
        decayToggle.addEventListener('change', (e) => {
            updateEngineParam('decayEnabled', e.target.checked);
        });
    }

    if (ekeToggle) {
        ekeToggle.addEventListener('change', (e) => {
            updateEngineParam('useEKEData', e.target.checked);
        });
    }

    // Start button
    if (startBtn) {
        startBtn.addEventListener('click', () => {
            if (engine && !engine.isRunning) {
                engine.startSimulation();
                startBtn.disabled = true;
                startBtn.textContent = 'Simulation Running';
                startBtn.style.opacity = '0.7';
                console.log('🚀 Simulation started');
            }
        });
    }

        // Reset button - NO confirmation
    if (resetBtn) {
        resetBtn.addEventListener('click', () => {
            // Just reset immediately, no popup
            if (engine) {
                // Clear particles
                if (particleCanvas && particleCanvas.clearAllParticles) {
                    particleCanvas.clearAllParticles();
                }

                // Reset engine
                engine.resetSimulation();

                // Reset UI
                if (startBtn) {
                    startBtn.disabled = false;
                    startBtn.textContent = 'Start Simulation';
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

    // Update control values to match engine parameters
    const params = engine.params;

    // Update sliders
    const kuroshioSlider = document.getElementById('kuroshioSlider');
    const diffusionSlider = document.getElementById('diffusionSlider');
    const speedSlider = document.getElementById('speedSlider');
    const ekeScaleSlider = document.getElementById('ekeScaleSlider');
    const timescaleSlider = document.getElementById('timescaleSlider');

    if (kuroshioSlider) {
        kuroshioSlider.value = params.kuroshioMultiplier;
        document.getElementById('kuroshioValue').textContent = params.kuroshioMultiplier.toFixed(1);
    }

    if (diffusionSlider) {
        // Note: diffusionSlider now controls diffusivityScale
        diffusionSlider.value = params.diffusivityScale;
        document.getElementById('diffusionValue').textContent = params.diffusivityScale.toFixed(1);
        // Update label
        const label = diffusionSlider.parentElement.querySelector('label');
        if (label) {
            label.innerHTML = `Diffusivity Scale: <span id="diffusionValue">${params.diffusivityScale.toFixed(1)}</span>x`;
        }
    }

    if (speedSlider) {
        speedSlider.value = params.simulationSpeed;
        document.getElementById('speedValue').textContent = params.simulationSpeed.toFixed(1);
    }

    if (ekeScaleSlider) {
        ekeScaleSlider.value = params.diffusivityScale;
        document.getElementById('ekeScaleValue').textContent = params.diffusivityScale.toFixed(1);
    }

    if (timescaleSlider) {
        timescaleSlider.value = params.lagrangianTimescale;
        document.getElementById('timescaleValue').textContent = params.lagrangianTimescale;
    }

    // Update toggles
    const interpolationToggle = document.getElementById('interpolationToggle');
    const decayToggle = document.getElementById('decayToggle');
    const ekeToggle = document.getElementById('ekeToggle');

    if (interpolationToggle) interpolationToggle.checked = params.useBilinearInterpolation;
    if (decayToggle) decayToggle.checked = params.decayEnabled;
    if (ekeToggle) ekeToggle.checked = params.useEKEData;

    // Update data source display
    const dataSourceElement = document.getElementById('dataSource');
    if (dataSourceElement) {
        if (params.useEKEData) {
            dataSourceElement.textContent = `AVISO EKE ×${params.diffusivityScale.toFixed(1)}`;
            dataSourceElement.style.color = '#4fc3f7';
        } else {
            dataSourceElement.textContent = 'Parameterized Diffusion';
            dataSourceElement.style.color = '#ff6b6b';
        }
    }

    // Update warning note
    const noteElement = document.querySelector('#controls .button-section small');
    if (noteElement) {
        if (engine.isRunning) {
            noteElement.textContent = "✅ Real-time controls enabled! Adjust while simulating.";
            noteElement.style.color = '#4fc3f7';
        } else {
            noteElement.textContent = "Parameters can be adjusted at any time";
            noteElement.style.color = '#888';
        }
    }
    updateStatsDisplay();
}
unction updateDataSourceDisplay() {
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
    // Create or update warning element
    const warningElement = document.getElementById('dataWarning') || createWarningElement();
    warningElement.innerHTML = `⚠️ ${message} <br><small>Simulation will still work with parameterized values</small>`;
    warningElement.style.display = 'block';

    // Auto-hide after 5 seconds
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

    // Auto-hide when progress is 100%
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