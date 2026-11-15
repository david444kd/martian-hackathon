"""Copy the Martian Map science layers into Mars Ops, trimmed for the headset.

Reads the sibling Martian Map project's data folder (NASA Space Apps "Martian Map"):
  - science_features.json: CRISM/OMEGA hydrous minerals (Carter et al. 2013), aqueous minerals by
    class (Ehlmann & Edwards 2014), THEMIS chloride deposits (Osterloo et al. 2010) and HiRISE
    fresh craters / exposed ice / RSL / active gullies, compacted from NASA Mars Trek feature
    services. Copied as is (it is small) for the globe's point layers.
  - jezero_geology.json: USGS SIM 3464 (Sun & Stack 2020, 1:75,000) unit polygons. Only the
    polygons touching the Jezero operation zone are kept, clipped to the zone plus a margin, outlines simplified to
    ~6 m and coordinates rounded to ~1 m, so the zone map does not download 2.6 MB on a Quest.

    python scripts/build_map_layers.py ../../nasa/NASA_Space-Apps_Challenge_Martian_Map/data

Writes public/data/science_features.json and public/data/jezero_geology_zone.json.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "public" / "data"
MARGIN = 0.03  # degrees around the zone (~1.8 km)
TOL = 0.0001   # Douglas-Peucker tolerance in degrees (~6 m, finer than the zone's 20 m grid)


def simplify(pts: list[list[float]], tol: float = TOL) -> list[list[float]]:
    """Douglas-Peucker on a closed ring (keeps its first and last point)"""
    if len(pts) < 5:
        return pts
    keep = [False] * len(pts)
    keep[0] = keep[-1] = True
    stack = [(0, len(pts) - 1)]
    while stack:
        a, b = stack.pop()
        (ax, ay), (bx, by) = pts[a], pts[b]
        dx, dy = bx - ax, by - ay
        L2 = dx * dx + dy * dy
        best, idx = -1.0, -1
        for i in range(a + 1, b):
            px, py = pts[i]
            if L2 == 0:
                d = (px - ax) ** 2 + (py - ay) ** 2
            else:
                t = max(0.0, min(1.0, ((px - ax) * dx + (py - ay) * dy) / L2))
                d = (px - ax - t * dx) ** 2 + (py - ay - t * dy) ** 2
            if d > best:
                best, idx = d, i
        if idx >= 0 and best > tol * tol:
            keep[idx] = True
            stack += [(a, idx), (idx, b)]
    out = [p for p, k in zip(pts, keep) if k]
    return out if len(out) >= 4 else pts


def clip(ring: list[list[float]], s: float, w: float, n: float, e: float) -> list[list[float]]:
    """Sutherland-Hodgman: the part of a ring inside the box (holes stay holes under even-odd fill)"""
    def cut(pts, inside, cross):
        out = []
        for i, cur in enumerate(pts):
            prev = pts[i - 1]
            if inside(cur):
                if not inside(prev):
                    out.append(cross(prev, cur))
                out.append(cur)
            elif inside(prev):
                out.append(cross(prev, cur))
        return out

    def at_x(x):
        return lambda a, b: [x, a[1] + (b[1] - a[1]) * (x - a[0]) / (b[0] - a[0])]

    def at_y(y):
        return lambda a, b: [a[0] + (b[0] - a[0]) * (y - a[1]) / (b[1] - a[1]), y]

    pts = ring[:-1] if ring and ring[0] == ring[-1] else ring
    for inside, cross in ((lambda p: p[0] >= w, at_x(w)), (lambda p: p[0] <= e, at_x(e)),
                          (lambda p: p[1] >= s, at_y(s)), (lambda p: p[1] <= n, at_y(n))):
        pts = cut(pts, inside, cross)
        if not pts:
            return []
    return pts + [pts[0]]


def main(src: Path) -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    feats = json.loads((src / "science_features.json").read_text(encoding="utf-8"))
    (OUT / "science_features.json").write_text(json.dumps(feats, separators=(",", ":")), encoding="utf-8")

    zones = json.loads((ROOT / "public" / "zones" / "zones.json").read_text(encoding="utf-8"))
    zones = zones if isinstance(zones, list) else zones.get("zones", list(zones.values()))
    z = next(q for q in zones if q["id"] == "jezero")
    s, n, w, e = z["south"] - MARGIN, z["north"] + MARGIN, z["west"] - MARGIN, z["east"] + MARGIN

    geo = json.loads((src / "jezero_geology.json").read_text(encoding="utf-8"))
    shapes = []
    for code, rings in geo["shapes"]:
        xs = [p[0] for r in rings for p in r]
        ys = [p[1] for r in rings for p in r]
        if max(xs) < w or min(xs) > e or max(ys) < s or min(ys) > n:
            continue
        clipped = [c for c in (clip(r, s, w, n, e) for r in rings) if len(c) >= 4]
        if clipped:
            shapes.append([code, [[[round(x, 5), round(y, 5)] for x, y in simplify(r)] for r in clipped]])
    used = {c for c, _ in shapes}
    out = {
        "source": geo["source"],
        "url": geo["url"],
        "bbox": [s, w, n, e],
        "units": {k: {f: v.get(f, "") for f in ("symbol", "name", "colour", "interpretation")} for k, v in geo["units"].items() if k in used},
        "shapes": shapes,
    }
    (OUT / "jezero_geology_zone.json").write_text(json.dumps(out, separators=(",", ":"), ensure_ascii=False), encoding="utf-8")
    print(f"science_features.json: {sum(len(feats[k]) for k in ('hydrous', 'aqueous', 'chloride', 'active'))} points")
    print(f"jezero_geology_zone.json: {len(shapes)} of {len(geo['shapes'])} polygons, {len(used)} units")


if __name__ == "__main__":
    main(Path(sys.argv[1] if len(sys.argv) > 1 else "../../nasa/NASA_Space-Apps_Challenge_Martian_Map/data"))
