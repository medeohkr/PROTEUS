#!/usr/bin/env python3
"""
PROTEUS Daily K-Value Calculator + Metadata Generator
Following Klocker et al. 2012:
- Pass 1: Compute 3-year means (u_mean, v_mean)
- Pass 2: For each day, compute daily anomalies → daily EKE → daily K
- Generates metadata file alongside K-fields
"""

import numpy as np
import struct
import json
from pathlib import Path
from datetime import datetime
import gc

# ===== CONFIGURATION =====
GLORYS_DIR = Path("D:/PROTEUS/data/glorys_3yr_bin")
EDDY_DIR = Path("D:/PROTEUS/data/eddy_radii_grid_glorys/daily")
OUTPUT_DIR = Path("D:/PROTEUS/data/k_fields_daily")
OUTPUT_DIR.mkdir(exist_ok=True)

# Klocker parameters
MIXING_EFFICIENCY = 0.35
G_OVER_K = 0.03

BASE_DATE = datetime(2011, 1, 1)


# ===== FILE READING FUNCTIONS =====

def read_glorys_daily(filepath):
    """Read u, v from GLORYS daily binary (auto-detects version)."""
    with open(filepath, 'rb') as f:
        header = struct.unpack('7i', f.read(28))
        version, n_lat, n_lon, n_depth, year, month, day = header
        
        # Read coordinates (float32)
        lon = np.frombuffer(f.read(n_lat * n_lon * 4), dtype=np.float32)
        lat = np.frombuffer(f.read(n_lat * n_lon * 4), dtype=np.float32)
        
        # Read u and v based on version
        if version == 1:
            u = np.frombuffer(f.read(n_depth * n_lat * n_lon * 4), dtype=np.float32)
            v = np.frombuffer(f.read(n_depth * n_lat * n_lon * 4), dtype=np.float32)
        else:
            u = np.frombuffer(f.read(n_depth * n_lat * n_lon * 2), dtype=np.float16)
            v = np.frombuffer(f.read(n_depth * n_lat * n_lon * 2), dtype=np.float16)
            u = u.astype(np.float32)
            v = v.astype(np.float32)
        
        # Reshape
        u = u.reshape((n_depth, n_lat, n_lon))
        v = v.reshape((n_depth, n_lat, n_lon))
        
        return u, v, n_depth, n_lat, n_lon, (year, month, day)


def read_eddy_daily(filepath):
    """Read radius (L) and phase speed (c_w) from eddy binary."""
    with open(filepath, 'rb') as f:
        header = struct.unpack('4i', f.read(16))
        version, year, month, day = header
        
        data = np.frombuffer(f.read(), dtype=np.float32)
        
        if version == 1:
            radius = data
            speed = np.zeros_like(radius)
        else:
            half = len(data) // 2
            radius = data[:half]
            speed = data[half:]
        
        return radius, speed, (year, month, day)


# ===== PASS 1: Compute 3-year means =====
print("\n" + "="*70)
print("📊 PASS 1: Computing 3-year means (2011-2013)...")
print("="*70)

glorys_files = sorted(GLORYS_DIR.glob("glorys_*.bin"))
print(f"Found {len(glorys_files)} daily files")

# Initialize accumulators for means
u_sum = None
v_sum = None
count = 0
n_depth, n_lat, n_lon = None, None, None

for i, f in enumerate(glorys_files):
    if i % 100 == 0:
        print(f"  Processing file {i}/{len(glorys_files)}...")
    
    u, v, n_d, n_la, n_lo, _ = read_glorys_daily(f)
    n_depth, n_lat, n_lon = n_d, n_la, n_lo
    
    if u_sum is None:
        u_sum = np.zeros((n_depth, n_lat, n_lon), dtype=np.float64)
        v_sum = np.zeros((n_depth, n_lat, n_lon), dtype=np.float64)
    
    u_sum += u
    v_sum += v
    count += 1

# Compute 3-year means
print(f"\n📊 Computing final means from {count} days...")
u_mean = (u_sum / count).astype(np.float32)
v_mean = (v_sum / count).astype(np.float32)

# Compute mean flow speed U
U_mean = np.sqrt(u_mean**2 + v_mean**2)

# Free the large sum arrays
del u_sum, v_sum
gc.collect()

print(f"  ✓ U range: {U_mean.min():.3f} - {U_mean.max():.3f} m/s")

# Save means for potential reuse
np.savez("D:/PROTEUS/data/3yr_means.npz",
         u_mean=u_mean,
         v_mean=v_mean,
         n_lat=n_lat,
         n_lon=n_lon,
         n_depth=n_depth)

# ===== PASS 2: Compute daily K using daily EKE =====
print("\n" + "="*70)
print("⚙️  PASS 2: Computing daily K values with DAILY EKE...")
print("="*70)

# Create lookup for eddy files
eddy_files = sorted(EDDY_DIR.glob("eddy_*.bin"))
eddy_by_date = {f.stem.split('_')[1]: f for f in eddy_files}
print(f"Found {len(eddy_files)} eddy files")

days_processed = 0
total_size = 0
all_days = []

for glorys_file in glorys_files:
    date_str = glorys_file.stem.split('_')[1]
    date_obj = datetime.strptime(date_str, "%Y%m%d")
    
    print(f"\n📅 {date_str}...")
    
    if date_str not in eddy_by_date:
        print(f"  ⚠️ No eddy file, skipping")
        continue
    
    # Read today's velocities
    u_daily, v_daily, n_depth, n_lat, n_lon, _ = read_glorys_daily(glorys_file)
    
    # ===== DAILY ANOMALIES =====
    u_prime = u_daily - u_mean
    v_prime = v_daily - v_mean
    
    # ===== DAILY EKE =====
    eke_daily = 0.5 * (u_prime**2 + v_prime**2)
    
    # Read eddy data for today
    L_flat, c_w_flat, _ = read_eddy_daily(eddy_by_date[date_str])
    L = L_flat.reshape((n_lat, n_lon))
    c_w = c_w_flat.reshape((n_lat, n_lon))
    
    # Convert L to meters
    L_m = L * 1000
    
    # Precompute grid-scale quantities
    k = 2 * np.pi / L_m
    g = G_OVER_K * k
    
    # Initialize K array
    K_daily = np.zeros((n_depth, n_lat, n_lon), dtype=np.float32)
    
    # Compute K for each depth
    for depth_idx in range(n_depth):
        # Get U at this depth (3-year mean)
        U_depth = U_mean[depth_idx]
        
        # ===== DAILY EKE at this depth =====
        eke_depth = eke_daily[depth_idx]
        
        # Unsuppressed diffusivity: K0 = C * sqrt(2*EKE) * L
        K0 = MIXING_EFFICIENCY * np.sqrt(2 * eke_depth) * L_m
        
        # Suppression factor
        rel_speed = np.abs(c_w - U_depth)
        suppression = 1.0 / (1.0 + (k**2 * rel_speed**2) / (g**2))
        
        K_daily[depth_idx] = K0 * suppression
    
    # Save as float16
    output_file = OUTPUT_DIR / f"k_{date_str}.bin"
    with open(output_file, 'wb') as f:
        header = struct.pack('7i', 2, n_lat, n_lon, n_depth,
                            date_obj.year, date_obj.month, date_obj.day)
        f.write(header)
        f.write(K_daily.astype(np.float16).tobytes())
    
    file_size = output_file.stat().st_size / (1024**2)
    print(f"  ✅ Saved ({file_size:.1f} MB)")
    print(f"     EKE daily range: {eke_daily.min():.6f} - {eke_daily.max():.6f} m²/s²")
    print(f"     K range: {K_daily.min():.1f} - {K_daily.max():.1f} m²/s")
    
    # Add to metadata
    day_offset = (date_obj - BASE_DATE).days
    all_days.append({
        'year': date_obj.year,
        'month': date_obj.month,
        'day': date_obj.day,
        'date_str': date_obj.strftime("%Y-%m-%d"),
        'day_offset': day_offset,
        'file': output_file.name
    })
    
    days_processed += 1
    total_size += output_file.stat().st_size
    
    if days_processed % 10 == 0:
        gc.collect()


# ===== SAVE METADATA =====
print("\n" + "="*70)
print("📝 Saving metadata...")
print("="*70)

# Get depths from first K-file (or use defaults)
# Since K-files don't store depths, we'll use the depth array from means
# (you'll need to have depths available — you might want to save them from earlier)

# For now, use a placeholder or load from a saved depths file
# You could also read from the original GLORYS NetCDF if available
depths = np.linspace(0, 1000, n_depth)  # Placeholder — adjust as needed

metadata = {
    'description': 'Daily eddy diffusivity (K) fields for PROTEUS',
    'method': 'Following Klocker et al. 2012: 3-year mean for U, daily anomalies for EKE',
    'version': 2,
    'format': 'float16',
    'parameters': {
        'mixing_efficiency': MIXING_EFFICIENCY,
        'g_over_k': G_OVER_K,
        'mean_period': '2011-2013 (3 years)'
    },
    'grid': {
        'n_lat': n_lat,
        'n_lon': n_lon,
        'n_depth': n_depth,
        'lon_range': [100, 260],
        'lat_range': [0, 65]
    },
    'depths': depths.tolist(),
    'depth_count': n_depth,
    'base_date': BASE_DATE.isoformat(),
    'date_range': {
        'start': all_days[0]['date_str'] if all_days else None,
        'end': all_days[-1]['date_str'] if all_days else None,
        'days': days_processed
    },
    'days': all_days,
    'total_size_gb': total_size / (1024**3)
}

metadata_path = OUTPUT_DIR / 'k_field_metadata.json'
with open(metadata_path, 'w') as f:
    json.dump(metadata, f, indent=2)

print(f"\n🎉 COMPLETE! Processed {days_processed} days")
print(f"📁 Output: {OUTPUT_DIR}")
print(f"📊 Total size: {metadata['total_size_gb']:.1f} GB")
print(f"📁 Metadata: {metadata_path}")
print("="*70)