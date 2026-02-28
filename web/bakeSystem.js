// bakeSystem.js - Fixed Version with Smooth Fixed Steps
console.log('=== Bake System Loading ===');

class BakeSystem {
    constructor() {
        this.snapshots = [];
        this.currentSnapshotIndex = 0;
        this.interpolationFactor = 0;
        this.isPlaying = false;
        this.playbackSpeed = 1.0;
        this.animationFrame = null;
        this.bakeInProgress = false;
        this.currentBakeJob = null;
        this.callbacks = {
            onFrame: null,
            onBakeProgress: null,
            onBakeComplete: null
        };
    }
    async bake(config) {
        this.bakeInProgress = true;
        this.currentBakeJob = {
            config,
            startTime: Date.now(),
            snapshots: []
        };

        console.log('🔥 Starting bake with config:', config);

        try {
            // Step 1: Initialize engine
            this.updateProgress(0, 'Initializing simulation...');
            const engine = new ParticleEngine3D(
                config.numParticles,
                'cs137',
                config.location || { lat: 37.42, lon: 141.31 }
            );

            // Apply phases from config
            if (config.phases && config.phases.length > 0) {
                const phasesToCopy = config.phases.map(p =>
                    new ReleasePhase(p.start, p.end, p.total, p.unit)
                );
                engine.setReleasePhases(phasesToCopy);
            }

            engine.setParameter('diffusivityScale', config.ekeDiffusivity);
            if (config.rk4Enabled) engine.enableRK4(true);

            if (config.startDate) {
                engine.simulationStartTime = new Date(config.startDate);
                engine.currentSimulationTime = new Date(config.startDate);
            }

            engine.calculateParticleCalibration();
            engine.startSimulation();

            // ===== FIXED TIME STEP CONFIGURATION =====
            const STEP_SIZE = 0.1; // 0.1 days per step
            const STEPS_PER_DAY = 10;
            const TOTAL_STEPS = config.durationDays * STEPS_PER_DAY;

            // ===== SNAPSHOT FREQUENCY =====
            const snapshotFrequency = config.snapshotFrequency || 5; // Default to every 5 days
            const totalSnapshots = Math.ceil(config.durationDays / snapshotFrequency) + 1; // +1 for day 0

            console.log(`📅 Running ${TOTAL_STEPS} steps of ${STEP_SIZE} days`);
            console.log(`📸 Capturing snapshots every ${snapshotFrequency} days (${totalSnapshots} total)`);

            // Capture initial state at step 0
            let snapshot = this.captureSnapshot(engine, 0);
            this.currentBakeJob.snapshots.push(snapshot);
            this.updateProgress(0, `Step 0/${TOTAL_STEPS} (Day 0) - Snapshot 1/${totalSnapshots}`);

            // Run fixed steps
            for (let step = 1; step <= TOTAL_STEPS; step++) {
                // Calculate exact current day
                const exactDay = step * STEP_SIZE;

                // Update progress every 10 steps
                if (step % STEPS_PER_DAY === 0) {
                    const progress = Math.floor((step / TOTAL_STEPS) * 100);
                    this.updateProgress(progress,
                        `Step ${step}/${TOTAL_STEPS} (Day ${exactDay.toFixed(1)})`);
                }

                // Force fixed time step
                const simSpeed = engine.params.simulationSpeed || 1.0;
                const now = Date.now();
                engine.lastUpdateTime = now - (STEP_SIZE * 1000 / simSpeed);

                // Run one update
                await engine.update(STEP_SIZE);

                // Verify/correct day
                if (Math.abs(engine.stats.simulationDays - exactDay) > 0.001) {
                    engine.stats.simulationDays = exactDay;
                }

                // Capture at frequency boundaries
                if (step % STEPS_PER_DAY === 0) {
                    // Check if this day matches our snapshot frequency
                    if (exactDay % snapshotFrequency === 0) {
                        snapshot = this.captureSnapshot(engine, exactDay);
                        this.currentBakeJob.snapshots.push(snapshot);

                        const snapshotNum = this.currentBakeJob.snapshots.length;
                        console.log(`✅ Captured day ${exactDay.toFixed(0)} (snapshot ${snapshotNum}/${totalSnapshots}) with ${snapshot.particleCount} particles`);

                        // Auto-save every 30 days (regardless of snapshot frequency)
                        if (exactDay % 30 === 0 && exactDay > 0) {
                            this.autoSave(exactDay);
                        }
                    }
                }

                // Small delay to keep UI responsive
                await new Promise(resolve => setTimeout(resolve, 0));
            }

            // Finalize
            this.updateProgress(100, 'Bake complete! Processing results...');
            this.snapshots = this.currentBakeJob.snapshots;

            // Log final stats
            console.log(`✅ Bake complete! ${this.snapshots.length} snapshots captured`);
            console.log(`   Day range: ${this.snapshots[0].day} to ${this.snapshots[this.snapshots.length-1].day}`);

            if (this.callbacks.onBakeComplete) {
                this.callbacks.onBakeComplete({
                    snapshotCount: this.snapshots.length,
                    durationDays: config.durationDays,
                    particleCount: config.numParticles,
                    snapshotFrequency: snapshotFrequency,
                    phases: engine.releaseManager.phases
                });
            }

            this.bakeInProgress = false;
            return this.snapshots;

        } catch (error) {
            console.error('❌ Bake failed:', error);
            this.bakeInProgress = false;
            throw error;
        }
    }

    captureSnapshot(engine, day) {
        const particles = engine.getActiveParticles();
        const particleData = particles.map(p => ({
            x: p.x, y: p.y, depth: p.depth,
            concentration: p.concentration,
            mass: p.mass, age: p.age,
            history: p.history ? p.history.slice(-5) : [],
            active: true
        }));

        return {
            day: day,
            timestamp: Date.now(),
            particleCount: particles.length,
            stats: {...engine.stats},
            particles: particleData
        };
    }

    updateProgress(percent, message) {
        console.log(`📊 updateProgress called: ${percent}% - ${message}`);

        // Check multiple possible callback names
        const callback = this.callbacks.onBakeProgress || this.callbacks.bakeProgress;

        if (callback) {
            console.log('✅ Found progress callback, calling it...');
            callback({
                percent,
                message,
                timeRemaining: this.estimateTimeRemaining(percent)
            });
        } else {
            console.warn('⚠️ No progress callback registered! Available:', Object.keys(this.callbacks));
        }
    }

    estimateTimeRemaining(percent) {
        if (percent < 5 || !this.currentBakeJob) return null;

        const elapsed = (Date.now() - this.currentBakeJob.startTime) / 1000;
        const total = elapsed * (100 / percent);
        const remaining = total - elapsed;

        return Math.round(remaining);
    }

    // ==================== PLAYBACK ====================

    loadSnapshots(snapshots) {
        this.snapshots = snapshots;
        this.currentSnapshotIndex = 0;
        this.interpolationFactor = 0;
        console.log(`📀 Loaded ${snapshots.length} snapshots for playback`);

        // Trigger first frame
        if (this.callbacks.onFrame && snapshots.length > 0) {
            this.callbacks.onFrame({
                day: snapshots[0].day,
                particles: snapshots[0].particles,
                snapshot1: 0,
                snapshot2: 0,
                factor: 0
            });
        }

        return true;
    }

    play() {
        if (this.isPlaying || this.snapshots.length === 0) return;

        this.isPlaying = true;
        this.lastFrameTime = performance.now();
        this.animate();
    }

    pause() {
        this.isPlaying = false;
        if (this.animationFrame) {
            cancelAnimationFrame(this.animationFrame);
            this.animationFrame = null;
        }
    }

    seek(day) {
        if (this.snapshots.length === 0) return;

        // Find the two snapshots surrounding this day
        let index1 = 0;
        let index2 = 0;

        for (let i = 0; i < this.snapshots.length - 1; i++) {
            if (this.snapshots[i].day <= day && this.snapshots[i + 1].day >= day) {
                index1 = i;
                index2 = i + 1;
                break;
            }
        }

        // If day is outside range, clamp to ends
        if (day <= this.snapshots[0].day) {
            index1 = index2 = 0;
            this.interpolationFactor = 0;
        } else if (day >= this.snapshots[this.snapshots.length - 1].day) {
            index1 = index2 = this.snapshots.length - 1;
            this.interpolationFactor = 0;
        } else {
            // Calculate interpolation factor
            const day1 = this.snapshots[index1].day;
            const day2 = this.snapshots[index2].day;
            this.interpolationFactor = (day - day1) / (day2 - day1);
        }

        this.currentSnapshotIndex = index1;

        // Generate interpolated particles
        const particles = this.interpolateParticles();

        // Trigger frame callback
        if (this.callbacks.onFrame) {
            this.callbacks.onFrame({
                day: day,
                particles: particles,
                snapshot1: index1,
                snapshot2: index2,
                factor: this.interpolationFactor
            });
        }
    }

    animate() {
        if (!this.isPlaying) return;

        const now = performance.now();
        const deltaTime = (now - this.lastFrameTime) / 1000; // seconds

        // Calculate new day based on playback speed
        const currentDay = this.getCurrentDay();
        const newDay = currentDay + (deltaTime * this.playbackSpeed);

        // Check if we've reached the end
        const lastDay = this.snapshots[this.snapshots.length - 1].day;
        if (newDay >= lastDay) {
            this.seek(lastDay);
            this.pause();
            return;
        }

        // Seek to new day (this handles interpolation automatically)
        this.seek(newDay);

        this.lastFrameTime = now;
        this.animationFrame = requestAnimationFrame(() => this.animate());
    }

    interpolateParticles() {
        if (this.snapshots.length === 0) return [];

        const snapshot1 = this.snapshots[this.currentSnapshotIndex];

        // If we're at the last snapshot or interpolation factor is 0, return first snapshot
        if (this.currentSnapshotIndex >= this.snapshots.length - 1 ||
            this.interpolationFactor === 0) {
            return snapshot1.particles;
        }

        const snapshot2 = this.snapshots[this.currentSnapshotIndex + 1];
        const t = this.interpolationFactor;

        // Interpolate between snapshots
        const interpolated = [];
        const count = Math.min(snapshot1.particles.length, snapshot2.particles.length);

        for (let i = 0; i < count; i++) {
            const p1 = snapshot1.particles[i];
            const p2 = snapshot2.particles[i];

            if (!p1 || !p2) continue;

            // Linear interpolation for position
            const x = p1.x + t * (p2.x - p1.x);
            const y = p1.y + t * (p2.y - p1.y);

            // Log interpolation for concentration (better visual)
            let concentration;
            if (p1.concentration > 0 && p2.concentration > 0) {
                concentration = Math.pow(10,
                    Math.log10(p1.concentration) +
                    t * (Math.log10(p2.concentration) - Math.log10(p1.concentration))
                );
            } else {
                concentration = p1.concentration + t * (p2.concentration - p1.concentration);
            }

            // Combine history
            let history = [];
            if (t < 0.5 && p1.history) {
                history = p1.history;
            } else if (p2.history) {
                history = p2.history;
            }

            interpolated.push({
                x: x,
                y: y,
                depth: p1.depth + t * (p2.depth - p1.depth),
                concentration: concentration,
                mass: p1.mass + t * (p2.mass - p1.mass),
                age: p1.age + t * (p2.age - p1.age),
                history: history,
                active: true
            });
        }

        return interpolated;
    }

    getCurrentDay() {
        if (this.snapshots.length === 0) return 0;

        const snapshot = this.snapshots[this.currentSnapshotIndex];
        if (this.currentSnapshotIndex >= this.snapshots.length - 1) {
            return snapshot.day;
        }

        const nextSnapshot = this.snapshots[this.currentSnapshotIndex + 1];
        return snapshot.day + this.interpolationFactor * (nextSnapshot.day - snapshot.day);
    }

    // ==================== CALLBACKS ====================


    on(event, callback) {
        console.log(`📢 Registering callback for: ${event}`);

        // Store with both naming conventions to be safe
        this.callbacks[event] = callback;           // Store as-is (e.g., 'frame')
        this.callbacks['on' + event.charAt(0).toUpperCase() + event.slice(1)] = callback; // Store as onFrame

        console.log('Current callbacks:', Object.keys(this.callbacks));
        return this;
    }

    // ==================== UTILITY ====================

    getStats() {
        return {
            snapshotsLoaded: this.snapshots.length,
            currentDay: this.getCurrentDay(),
            isPlaying: this.isPlaying,
            playbackSpeed: this.playbackSpeed,
            snapshotIndex: this.currentSnapshotIndex,
            interpolationFactor: this.interpolationFactor
        };
    }
    // Add this method to BakeSystem class
    manualExport() {
        if (!this.currentBakeJob || !this.currentBakeJob.snapshots.length) {
            console.log('No partial results to save');
            return null;
        }

        const partialData = {
            version: '1.0',
            timestamp: Date.now(),
            metadata: {
                simulationStartDate: this.currentBakeJob.config.startDate.toISOString(),
                simulationEndDate: this.currentBakeJob.config.endDate.toISOString(),
                totalDays: this.currentBakeJob.config.durationDays,
                completedDays: this.currentBakeJob.snapshots.length - 1, // -1 for day 0
                particleCount: this.currentBakeJob.config.numParticles,
                phases: this.currentBakeJob.config.phases,
                partial: true
            },
            snapshots: this.currentBakeJob.snapshots
        };

        // Download
        const jsonStr = JSON.stringify(partialData, null, 2);
        const blob = new Blob([jsonStr], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `proteus_partial_${Date.now()}.json`;
        a.click();

        console.log(`💾 Saved ${partialData.snapshots.length} snapshots`);
        return partialData;
    }
    // ===== AUTO-SAVE METHOD =====
    autoSave(currentDay) {
        try {
            // Save only last 10 snapshots to localStorage
            const recentSnapshots = this.currentBakeJob.snapshots.slice(-10);

            const backup = {
                version: '1.0',
                timestamp: Date.now(),
                day: currentDay,
                metadata: {
                    completedDays: currentDay,
                    totalDays: this.currentBakeJob.config.durationDays,
                    particleCount: this.currentBakeJob.config.numParticles,
                    snapshotCount: this.currentBakeJob.snapshots.length
                },
                recentSnapshots: recentSnapshots
            };

            localStorage.setItem('proteus_autosave', JSON.stringify(backup));
            console.log(`💾 Auto-saved at day ${currentDay}`);

        } catch (e) {
            console.warn('⚠️ Auto-save failed:', e);
        }
    }

    // Add this method to recover from auto-save
    loadAutoSave() {
        const saved = localStorage.getItem('proteus_autosave');
        if (saved) {
            const backup = JSON.parse(saved);
            console.log(`📀 Found auto-save from day ${backup.day}`);
            return backup;
        }
        return null;
    }
}

// Export to global
window.BakeSystem = BakeSystem;