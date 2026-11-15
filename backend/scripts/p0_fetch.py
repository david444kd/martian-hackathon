"""P0: скачать окно HiRISE DTM 1 м (Eqc) вокруг ближнего участка в data/raw/hirise_dtm_window.tif."""
import sys; sys.path.insert(0, "src")
import numpy as np, rasterio
from rasterio.warp import transform_bounds
from rasterio.windows import from_bounds, Window
from gor.io import *
from gor.fetch import strip_layout, read_window_rows

def fetch_window(url, out_path, half_m, margin_m, dtype, row_step=1):
    if out_path.exists():
        print("cached", out_path); return
    with rasterio.open("/vsicurl/" + url) as src:
        b = transform_bounds(LOCAL_CRS, src.crs, -half_m - margin_m, -half_m - margin_m,
                             half_m + margin_m, half_m + margin_m, densify_pts=41)
        win = from_bounds(*b, transform=src.transform).round_offsets().round_lengths()
        win = win.intersection(Window(0, 0, src.width, src.height))
        prof = src.profile.copy(); tr = src.window_transform(win)
    print("window", win)
    lay = strip_layout(url)
    data = read_window_rows(url, lay, int(win.row_off), int(win.height), int(win.col_off), int(win.width), dtype, row_step=row_step)
    if row_step > 1:
        from affine import Affine
        tr = tr * Affine.scale(1, row_step)
    prof.update(width=data.shape[1], height=data.shape[0], transform=tr, tiled=True,
                blockxsize=512, blockysize=512, compress="deflate")
    with rasterio.open(out_path, "w", **prof) as d:
        d.write(data, 1)
    print("saved", out_path, data.shape)

if __name__ == "__main__":
    fetch_window(URL_HIRISE_DTM, RAW / "hirise_dtm_window.tif", 2000, 120, "float32")
    fetch_window(URL_HIRISE_ORTHO_STRIPS, RAW / "hirise_ortho_window_rowstep2.tif", 2000, 60, "uint8", row_step=2)
