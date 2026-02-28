#!/usr/bin/env python3
"""
Safe merger for PROTEUS batch files with validation
"""

import json
import glob
import os
from pathlib import Path


def validate_snapshot(snap):
    """Check if a snapshot has all required fields"""
    required = ['day', 'particleCount', 'particles']
    for field in required:
        if field not in snap:
            return False, f"Missing {field}"

    # Check if particles array exists
    if not isinstance(snap['particles'], list):
        return False, "particles not a list"

    return True, "OK"


def safe_merge():
    """Merge with validation at every step"""

    # Find all batch files
    batch_files = sorted(glob.glob("proteus_emergency_chunk_*.json"))

    if not batch_files:
        print("❌ No batch files found!")
        return

    print(f"📁 Found {len(batch_files)} batch files")

    all_snapshots = []
    corrupted_files = []
    snapshot_count = 0

    # Process each file
    for i, file in enumerate(batch_files):
        print(f"\n📥 Processing file {i + 1}/{len(batch_files)}: {file}")

        try:
            with open(file, 'r', encoding='utf-8') as f:
                data = json.load(f)

            # Validate structure
            if 'snapshots' not in data:
                print(f"⚠️  No 'snapshots' in {file}, skipping")
                corrupted_files.append(file)
                continue

            file_snapshots = data['snapshots']
            valid_count = 0

            # Validate each snapshot
            for snap in file_snapshots:
                valid, msg = validate_snapshot(snap)
                if valid:
                    all_snapshots.append(snap)
                    valid_count += 1
                else:
                    print(f"  ⚠️  Invalid snapshot day {snap.get('day', 'unknown')}: {msg}")

            snapshot_count += valid_count
            print(f"  ✅ Added {valid_count}/{len(file_snapshots)} valid snapshots")

        except json.JSONDecodeError as e:
            print(f"❌ JSON error in {file}: {e}")
            corrupted_files.append(file)
        except Exception as e:
            print(f"❌ Error reading {file}: {e}")
            corrupted_files.append(file)

    print(f"\n📊 Total valid snapshots: {snapshot_count}")
    print(f"📅 Day range: {all_snapshots[0]['day']} to {all_snapshots[-1]['day']}")

    # Sort by day
    all_snapshots.sort(key=lambda x: x['day'])

    # Save in smaller chunks
    chunk_size = 50
    for i in range(0, len(all_snapshots), chunk_size):
        chunk = all_snapshots[i:i + chunk_size]
        output = {
            'version': '1.0',
            'timestamp': Date.now().isoformat() if 'Date' in globals() else str(datetime.now()),
            'metadata': {
                'total_snapshots': len(all_snapshots),
                'chunk': i // chunk_size,
                'days': [s['day'] for s in chunk]
            },
            'snapshots': chunk
        }

        out_file = f"proteus_merged_chunk_{i // chunk_size:03d}.json"
        with open(out_file, 'w') as f:
            json.dump(output, f, indent=2)
        print(f"💾 Saved chunk {i // chunk_size}: {out_file}")

    # Save list of corrupted files
    if corrupted_files:
        with open('corrupted_files.txt', 'w') as f:
            for cf in corrupted_files:
                f.write(cf + '\n')
        print(f"\n⚠️  {len(corrupted_files)} corrupted files listed in corrupted_files.txt")

    print(f"\n✅ Safe merge complete! {snapshot_count} snapshots in {len(all_snapshots) // chunk_size + 1} chunks")


if __name__ == "__main__":
    from datetime import datetime

    safe_merge()