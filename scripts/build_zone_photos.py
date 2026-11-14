"""Orbital photo textures for the 3D terrain: each zone's area from the HiRISE mosaic (zoom 14,
~2.5 m/px), gaps filled from the global CTX mosaic, cut to the zone's exact bounds, resized to
4096 x 4096 and coloured (HiRISE and CTX are greyscale: brightness, shadows lifted a little,
× Martian dust colour).

    python3 scripts/build_zone_photos.py        (needs Pillow + httpx + numpy)

Writes public/zones/<id>-photo.jpg, matching the bounds in public/zones/zones.json.
"""
import json
from concurrent.futures import ThreadPoolExecutor
from io import BytesIO
from pathlib import Path

import httpx
import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
ZONES = ROOT / "public" / "zones"
SIZE = 4096
Z = 14
TREK = "https://trek.nasa.gov/tiles/Mars/EQ/{layer}/1.0.0/default/default028mm/{z}/{y}/{x}.png"
HIRISE = {
    "jezero": "JEZ_hirise_soc_006_orthoMosaic_25cm_Eqc_latTs0_lon0_first_dd",
    "gale": "curiosity_hirise_mosaic",
}
CTX = "https://astro.arcgis.com/arcgis/rest/services/OnMars/CTX/MapServer/tile/{z}/{y}/{x}"  # 512 px tiles
DUST = np.array([1.36, 0.94, 0.66], dtype=np.float32)  # Martian dust colour per unit brightness

client = httpx.Client(timeout=60)


def fetch(url):
    for _ in range(3):
        try:
            r = client.get(url)
            if r.status_code == 404:
                return None
            r.raise_for_status()
            return Image.open(BytesIO(r.content)).convert("LA")
        except (httpx.HTTPError, OSError):
            continue
    return None


def mosaic(url_for, z, tile_px, n, s, w, e):
    """grey + alpha mosaic of tiles covering the bounds, cropped to them exactly"""
    fx0, fx1 = (w + 180) / 360 * 2 ** (z + 1), (e + 180) / 360 * 2 ** (z + 1)
    fy0, fy1 = (90 - n) / 180 * 2 ** z, (90 - s) / 180 * 2 ** z
    xs, ys = range(int(fx0), int(fx1) + 1), range(int(fy0), int(fy1) + 1)
    out = Image.new("LA", (len(xs) * tile_px, len(ys) * tile_px), (0, 0))
    jobs = [(x, y) for y in ys for x in xs]
    with ThreadPoolExecutor(16) as pool:
        for (x, y), tile in zip(jobs, pool.map(lambda xy: fetch(url_for(z, *xy)), jobs)):
            if tile is not None:
                out.paste(tile.resize((tile_px, tile_px)), ((x - xs[0]) * tile_px, (y - ys[0]) * tile_px))
    box = ((fx0 - xs[0]) * tile_px, (fy0 - ys[0]) * tile_px, (fx1 - xs[0]) * tile_px, (fy1 - ys[0]) * tile_px)
    return out.resize((SIZE, SIZE), Image.LANCZOS, box=box)


def main():
    for zone in json.loads((ZONES / "zones.json").read_text()):
        b = zone["north"], zone["south"], zone["west"], zone["east"]
        print(zone["id"], "HiRISE…", flush=True)
        hi = mosaic(lambda z, x, y: TREK.format(layer=HIRISE[zone["id"]], z=z, x=x, y=y), Z, 256, *b)
        print(zone["id"], "CTX…", flush=True)
        ctx = mosaic(lambda z, x, y: CTX.format(z=z, x=x, y=y), 12, 512, *b)
        h, c = np.asarray(hi, np.float32), np.asarray(ctx, np.float32)
        a = h[..., 1:2] / 255
        grey = h[..., :1] * a + c[..., :1] * (1 - a)              # HiRISE where it has data, else CTX
        grey = 255 * (grey / 255) ** 0.8                          # lift the shadows: seen from the side they'd be black
        rgb = np.clip(grey * DUST, 0, 255).astype(np.uint8)
        out = ZONES / f"{zone['id']}-photo.jpg"
        Image.fromarray(rgb).save(out, quality=86, optimize=True, progressive=True)
        print(out, f"{out.stat().st_size / 1e6:.1f} MB, HiRISE covers {a.mean() * 100:.0f}%")


if __name__ == "__main__":
    main()
