"""Cut the operation zones (512 x 512 heightmaps at 20 m/px) out of the 20 m Jezero and Gale DTMs.

The browser routes walks and builds the VR terrain from these files, so no server is needed.
Run once (needs numpy + tifffile; the DTMs come from martian-map/backend/scripts/fetch_data.py):

    python3 scripts/build_zones.py ../martian-map/backend/data

Writes public/zones/<id>.bin (float32 little-endian, row 0 = north) and zones.json.
"""
from __future__ import annotations

import json
import math
import sys
from pathlib import Path

import numpy as np
import tifffile

SIZE = 512
OUT = Path(__file__).resolve().parents[1] / "public" / "zones"

# id, name, file, centre (lat, lon), base (habitat / lander), description
ZONES = [
    ("jezero", "Jezero Crater", "jezero_ctx_dtm_20m.tif", (18.47, 77.42),
     ("Perseverance landing", 18.4447, 77.4508), "Ancient river delta and lake bed, CTX DTM 20 m"),
    ("gale", "Gale Crater", "gale_hirise_dtm_20m.tif", (-4.64, 137.40),
     ("Bradbury Landing", -4.5895, 137.4417), "Foot of Mount Sharp, HiRISE DTM 20 m"),
]


def load(path: Path):
    with tifffile.TiffFile(path) as t:
        page = t.pages[0]
        a = page.asarray().astype(np.float32)
        sx, sy, _ = page.tags["ModelPixelScaleTag"].value
        _, _, _, x0, y0, _ = page.tags["ModelTiepointTag"].value
        geo = t.geotiff_metadata
        radius = geo["GeogSemiMajorAxisGeoKey"]
    if int(geo.get("GTModelTypeGeoKey", 1)) == 2:  # geographic: pixel size in degrees
        k = 1.0
    else:                                          # equirectangular metres
        k = 180 / (math.pi * radius)
    a[a < -1e20] = np.nan
    # degrees of each pixel edge: lon = (x0 + col * sx) * k, lat = (y0 - row * sy) * k
    return a, x0 * k, y0 * k, sx * k, sy * k


def main(src: Path):
    OUT.mkdir(parents=True, exist_ok=True)
    meta = []
    for zid, name, file, (clat, clon), base, desc in ZONES:
        a, lon0, lat0, dlon, dlat = load(src / file)
        r = int(round((lat0 - clat) / dlat)) - SIZE // 2
        c = int(round((clon - lon0) / dlon)) - SIZE // 2
        r = max(0, min(a.shape[0] - SIZE, r))
        c = max(0, min(a.shape[1] - SIZE, c))
        crop = a[r:r + SIZE, c:c + SIZE].copy()
        if np.isnan(crop).any():
            crop[np.isnan(crop)] = np.nanmean(crop)
        north, west = lat0 - r * dlat, lon0 + c * dlon
        south, east = north - SIZE * dlat, west + SIZE * dlon
        mid = math.radians((north + south) / 2)
        m_per_deg = math.pi / 180 * 3_389_500
        crop.astype("<f4").tofile(OUT / f"{zid}.bin")
        meta.append({
            "id": zid, "name": name, "description": desc, "file": f"/zones/{zid}.bin",
            "width": SIZE, "height": SIZE,
            "north": north, "south": south, "west": west, "east": east,
            "dx": dlon * m_per_deg * math.cos(mid), "dy": dlat * m_per_deg,
            "min": float(crop.min()), "max": float(crop.max()),
            "base": {"name": base[0], "lat": base[1], "lon": base[2]},
        })
        print(f"{zid}: rows {r}..{r + SIZE}, cols {c}..{c + SIZE}, "
              f"{crop.min():.0f}..{crop.max():.0f} m, {meta[-1]['dx']:.1f} x {meta[-1]['dy']:.1f} m/px")
    (OUT / "zones.json").write_text(json.dumps(meta, indent=2))


if __name__ == "__main__":
    main(Path(sys.argv[1] if len(sys.argv) > 1 else "../martian-map/backend/data").resolve())
