🌊 PROTEUS
Pacific Radionuclide Oceanic Transport Engine & Universal Simulator

A powerful, interactive 3D visualization tool for simulating the transport of radionuclides in the Pacific Ocean. Built with real ocean current data (HYCOM), eddy diffusivity (AVISO EKE), and validated against the 2011 Fukushima Daiichi release.

✨ Features
🌊 Core Physics

    Real ocean currents - HYCOM 2011-2013 data (1/12° resolution)

    Turbulent diffusion - AVISO EKE-based parameterization

    3D vertical mixing - Depth-dependent diffusivity with Ekman pumping

    RK4 integration - 4th order Runge-Kutta for accurate particle advection


🎮 Interactive Controls

    Depth slider - Explore the plume from surface to 1000m

    Location picker - Click anywhere in the Pacific or enter coordinates

    Date range selector - Configure simulation periods
    
    Custom release phases - Design multi-stage release schedules

    Multiple tracers - Cs-137, Cs-134, I-131, Sr-90, H-3

📊 Visualization

    Concentration heatmap - Dynamic scaling with real Bq/m³ values

    Particle view - Individual particles with age-based trails

    Depth filtering - See exactly which depths are affected

    Playback controls - Timeline scrubbing, speed adjustment

    Live statistics - Particle counts, release rates, max concentrations

⚡ Performance

    Streaming data loaders - Only 2 days in memory at once

    Optimized rendering - 30fps with 50,000 particles

    Memory efficient - 700MB memory usage + snapshots

    Pre-render mode - Bake long simulations overnight

Use the download_HYCOM.py script to subset data from HYCOM's NCSS Threadds subsetter.
This will take upwards of 50 hours and will require space for 150GB+ of HYCOM .nc files!
Convert to usable .bin files using the prepare_HYCOM.py script.

Use https://data.marine.copernicus.eu/product/SEALEVEL_GLO_PHY_L4_MY_008_047/download?dataset=cmems_obs-sl_glo_phy-ssh_my_allsat-l4-duacs-0.125deg_P1D_202411
to subset CMEMS geostrophic sea velocity. Select ugosa and vgosa with a bounding box of 65N, 0S, 260E, 100W, and subset at 4 month intervals from 03/01/2011 to 02/28/2013.
Derive EKE, calculate K values, and convert to usable .bin files using the prepare_CMEMS.py script.
