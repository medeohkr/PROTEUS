# 🌊 PROTEUS
### Pacific Radionuclide Oceanic Transport Engine & Universal Simulator

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Python 3.8+](https://img.shields.io/badge/python-3.8+-blue.svg)](https://www.python.org/downloads/)
[![Rust](https://img.shields.io/badge/rust-2021-orange.svg)](https://www.rust-lang.org/)

A powerful, interactive 3D visualization tool for simulating the transport of radionuclides in the Pacific Ocean. Built with real ocean current data (GLORYS), eddy diffusivity fields, and validated against the 2011 Fukushima Daiichi release.

---

## ✨ Features

### 🌊 Core Physics
- **Real ocean currents** – GLORYS 2011-2013 reanalysis (1/12° resolution)
- **Turbulent diffusion** – Klocker et al. (2012) eddy diffusivity parameterization
- **3D vertical mixing** – Depth-dependent diffusivity with Ekman pumping
- **RK4 integration** – 4th order Runge-Kutta for accurate particle advection
- **Multiple tracers** – Cs-137, Cs-134, I-131, Sr-90, H-3, Light/Heavy Oil

### 🎮 Interactive Controls
- **Depth slider** – Explore the plume from surface to 1000m
- **Location picker** – Click anywhere in the Pacific or enter coordinates
- **Date range selector** – Configure simulation periods (2011-2013)
- **Custom release phases** – Design multi-stage release schedules with variable units (PBq, TBq, GBq, tons)
- **Snapshot frequency** – Control temporal resolution of saved simulations

### 📊 Visualization
- **Concentration heatmap** – Dynamic scaling with real Bq/m³ values
- **Particle view** – Individual particles with age-based trails
- **Depth filtering** – See exactly which depths are affected
- **Playback controls** – Timeline scrubbing, speed adjustment (0.1× to 10×)
- **Live statistics** – Particle counts, release rates, max concentrations
- **Export/Import** – Save and load simulation snapshots

### ⚡ Performance
- **Streaming data loaders** – Only 2 days in memory at once
- **Optimized rendering** – 30+ FPS with 50,000 particles
- **Memory efficient** – 700MB memory usage + snapshot storage
- **Pre-render mode** – Bake long simulations overnight for smooth playback

---

## 🚀 Quick Start

### Prerequisites
- Python 3.8+ with `xarray`, `numpy`, `matplotlib`
- Modern web browser with WebGL support
- ~400GB free space for full GLORYS dataset (optional)

### Installation

1. **Clone the repository**
   ```bash
   git clone https://github.com/medeohkr/PROTEUS.git
   cd PROTEUS

    Install Python dependencies
    bash

    pip install xarray numpy matplotlib netCDF4 scipy

    Launch the application
    bash

    # Simply open the HTML file in your browser
    open web/index.html

    Or serve locally:
    bash

    python -m http.server 8000
    # Navigate to http://localhost:8000/web/

📦 Data Preparation
Option A: Use Pre-processed Data (Recommended)

Download pre-processed binary files from Releases (coming soon).
Option B: Process from Source
GLORYS Ocean Currents

    Download data from CMEMS

        Variables: ugos, vgos (total velocities) and ugosa, vgosa (anomalies)

        Region: 0°N–65°N, 100°E–260°E

        Period: 2011-03-01 to 2013-02-28

        Download in 4-month intervals

    Convert to binary format
    bash

    python scripts/prepare_GLORYS.py

Eddy Diffusivity (K-fields)

    Download META3.2 eddy atlas (from AVISO)

    Prepare eddy radius and phase speed grids
    bash

    python scripts/prepare_atlas_glorys.py

    Compute K-fields following Klocker et al. 2012
    bash

    python scripts/prepare_GLORYS_K.py

Generate Visualizations
bash

python scripts/visualize_GLORYS.py
python scripts/visualize_GLORYS_K.py

🗂️ Project Structure
text

PROTEUS/
├── web/                      # Frontend application
│   ├── index.html            # Main UI
│   ├── app.js                 # Core application logic
│   ├── glorysLoader.js        # GLORYS data loader
│   ├── cmemsLoader.js         # K-field loader
│   ├── particleEngine.js       # Particle simulation engine
│   └── bakeSystem.js          # Pre-render system
│
├── scripts/                   # Data processing scripts
│   ├── prepare_GLORYS.py       # NetCDF → binary converter
│   ├── prepare_GLORYS_K.py     # K-field calculator
│   ├── prepare_atlas_glorys.py # Eddy atlas processor
│   └── visualize_*.py          # Visualization generators
│
├── data/                      # Data directory (not in repo)
│   ├── glorys_3yr_bin/         # GLORYS binary files
│   ├── k_fields_daily/         # K-field binary files
│   └── eddy_radii_grid_glorys/ # Eddy atlas grids
│
└── docs/                       # Documentation


Contributions are welcome! Areas for development:

    🌀 Ekman pumping implementation

    🧪 Sediment binding models

    🌱 Biological uptake coupling

    ⚡ Rust/WASM performance optimization

    📦 Atmospheric transport module

See CONTRIBUTING.md for guidelines.
📄 License

This project is licensed under the MIT License – see LICENSE for details.
🙏 Acknowledgments

    GLORYS – Global ocean reanalysis data

    META3.2 – Eddy tracking atlas

    Klocker et al. 2012 – Theoretical framework

    HYCOM – Original data infrastructure

    deck.gl – WebGL visualization framework

    CMEMS – Copernicus Marine Service

📫 Contact

Leo – @medeohkr

Project Link: https://github.com/medeohkr/PROTEUS

Built with ❤️ for ocean science and accessibility