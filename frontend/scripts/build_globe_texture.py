"""Stitch the dispatcher's globe texture from NASA Mars Trek's Viking colour mosaic.

Zoom 3 of the equirectangular tile set is 16 x 8 tiles of 256 px: a 4096 x 2048 map, longitude
-180 at the left edge. Run once (needs Pillow + httpx):

    python3 scripts/build_globe_texture.py
"""
from concurrent.futures import ThreadPoolExecutor
from io import BytesIO
from pathlib import Path

import httpx
from PIL import Image

Z, COLS, ROWS, T = 3, 16, 8, 256
URL = "https://trek.nasa.gov/tiles/Mars/EQ/Mars_Viking_MDIM21_ClrMosaic_global_232m/1.0.0/default/default028mm/{z}/{y}/{x}.jpg"
OUT = Path(__file__).resolve().parents[1] / "public" / "textures" / "mars-4k.jpg"


def main():
    img = Image.new("RGB", (COLS * T, ROWS * T))
    with httpx.Client(timeout=60) as client:
        def get(xy):
            x, y = xy
            r = client.get(URL.format(z=Z, x=x, y=y))
            r.raise_for_status()
            return x, y, Image.open(BytesIO(r.content)).convert("RGB")
        with ThreadPoolExecutor(8) as pool:
            for x, y, tile in pool.map(get, [(x, y) for y in range(ROWS) for x in range(COLS)]):
                img.paste(tile, (x * T, y * T))
    OUT.parent.mkdir(parents=True, exist_ok=True)
    img.save(OUT, quality=82, optimize=True, progressive=True)
    print(OUT, img.size, f"{OUT.stat().st_size / 1e6:.1f} MB")


if __name__ == "__main__":
    main()
