"""Чтение окон, проекции, перевод координат.

Локальная система: ортографическая проекция Марса (сфера R=3396190 м) с центром
в центре ближнего участка. x — на восток, y — на север, метры. В окрестности ±40 км
искажение масштаба < 0.01 %.
"""
import json
import os
from pathlib import Path

import numpy as np
import rasterio
from rasterio.crs import CRS
from rasterio.transform import from_origin
from rasterio.warp import reproject, Resampling, transform_bounds
from rasterio.windows import from_bounds
from pyproj import Transformer

os.environ.setdefault("GDAL_DISABLE_READDIR_ON_OPEN", "EMPTY_DIR")
os.environ.setdefault("GDAL_HTTP_MULTIRANGE", "YES")
os.environ.setdefault("GDAL_HTTP_MERGE_CONSECUTIVE_RANGES", "YES")
os.environ.setdefault("CPL_VSIL_CURL_CHUNK_SIZE", "1048576")

ROOT = Path(__file__).resolve().parents[2]
RAW = ROOT / "data" / "raw"
PROC = ROOT / "data" / "proc"
EXPORT = ROOT / "export"
CHECK = ROOT / "out" / "check"
for _p in (RAW, PROC, EXPORT, CHECK):
    _p.mkdir(parents=True, exist_ok=True)

R_MARS_M = 3396190.0
S3 = "https://asc-pds-services.s3.us-west-2.amazonaws.com/mosaic/mars2020_trn"
URL_HIRISE_DTM = f"{S3}/HiRISE/JEZ_hirise_soc_006_DTM_MOLAtopography_DeltaGeoid_1m_Eqc_latTs0_lon0_blend40.tif"
URL_HIRISE_ORTHO = f"{S3}/HiRISE/JEZ_hirise_soc_007_orthoMosaic_25cm_Ortho_blend120.tif"
URL_HIRISE_ORTHO_STRIPS = f"{S3}/HiRISE/JEZ_hirise_soc_006_orthoMosaic_25cm_Eqc_latTs0_lon0_first.tif"
URL_CTX_DEM = f"{S3}/CTX/ScienceInvestigationMaps_JPL/M20_JezeroCrater_CTXDEM_20m.tif"
URL_CTX_ORTHO = f"{S3}/CTX/ScienceInvestigationMaps_JPL/M20_JezeroCrater_CTXortho_mosaic_5m.tif"

# Место посадки Perseverance (Octavia E. Butler), первая точка M20_waypoints.json (sol 13)
LANDER_LON, LANDER_LAT = 77.45088572, 18.44462715
# Центр ближнего участка сдвинут от лендера на 1400 м к западу и 50 м к югу, чтобы в 4×4 км
# попали лендер, образцы Séítah / Artuby и фронт дельты (образцы Swift Run … Kukaklek).
CENTER_SHIFT_E_M, CENTER_SHIFT_N_M = -1400.0, -50.0
CENTER_LAT = LANDER_LAT + np.degrees(CENTER_SHIFT_N_M / R_MARS_M)
CENTER_LON = LANDER_LON + np.degrees(CENTER_SHIFT_E_M / (R_MARS_M * np.cos(np.radians(LANDER_LAT))))

NEAR_SIZE_M = 4000.0
FAR_SIZE_M = 40000.0

LOCAL_CRS = CRS.from_proj4(
    f"+proj=ortho +lat_0={CENTER_LAT:.9f} +lon_0={CENTER_LON:.9f} +R={R_MARS_M} +units=m +no_defs"
)
GEO_CRS = CRS.from_proj4(f"+proj=longlat +R={R_MARS_M} +no_defs")
_to_geo = Transformer.from_crs(LOCAL_CRS, GEO_CRS, always_xy=True)
_to_local = Transformer.from_crs(GEO_CRS, LOCAL_CRS, always_xy=True)


def local_to_lonlat(x_m, y_m):
    return _to_geo.transform(x_m, y_m)


def lonlat_to_local(lon, lat):
    return _to_local.transform(lon, lat)


def grid_transform(half_m, res_m):
    """Сетка «пиксель-площадь» от -half до +half, северная строка первая."""
    return from_origin(-half_m, half_m, res_m, res_m)


def cell_centers(half_m, res_m):
    n = int(round(2 * half_m / res_m))
    c = -half_m + res_m * (np.arange(n) + 0.5)
    return c, c[::-1]  # x (восток), y (сверху вниз = с севера)


def read_to_local(src_path, half_m, res_m, resampling=Resampling.bilinear, cache=None,
                  margin_m=200.0, dtype="float32", src_nodata=None):
    """Читает окно источника (локальный файл или /vsicurl/) и перепроецирует в локальную сетку.
    cache — путь к GeoTIFF в data/raw/ с окном источника в исходной проекции (повторно не качать)."""
    n = int(round(2 * half_m / res_m))
    dst = np.full((n, n), np.nan, dtype=dtype)
    dst_tr = grid_transform(half_m, res_m)
    if cache is not None and Path(cache).exists():
        src_open = Path(cache)
    else:
        src_open = src_path
    with rasterio.open(src_open) as src:
        nod = src.nodata if src_nodata is None else src_nodata
        if cache is not None and not Path(cache).exists():
            b = transform_bounds(LOCAL_CRS, src.crs, -half_m - margin_m, -half_m - margin_m,
                                 half_m + margin_m, half_m + margin_m, densify_pts=41)
            win = from_bounds(*b, transform=src.transform).round_offsets().round_lengths()
            win = win.intersection(rasterio.windows.Window(0, 0, src.width, src.height))
            data = src.read(1, window=win)
            prof = src.profile.copy()
            prof.update(width=data.shape[1], height=data.shape[0],
                        transform=src.window_transform(win), tiled=True, blockxsize=512,
                        blockysize=512, compress="deflate", driver="GTiff", BIGTIFF="IF_SAFER")
            with rasterio.open(cache, "w", **prof) as out:
                out.write(data, 1)
            return read_to_local(src_path, half_m, res_m, resampling, cache, margin_m, dtype, src_nodata)
        reproject(rasterio.band(src, 1), dst, src_nodata=nod, dst_transform=dst_tr,
                  dst_crs=LOCAL_CRS, dst_nodata=np.nan, resampling=resampling)
    if nod is not None and np.issubdtype(np.dtype(dtype), np.floating):
        dst[dst < -1e30] = np.nan
    return dst


def save_local_tif(path, arr, half_m, res_m):
    prof = dict(driver="GTiff", width=arr.shape[1], height=arr.shape[0], count=1,
                dtype=str(arr.dtype), crs=LOCAL_CRS, transform=grid_transform(half_m, res_m),
                compress="deflate", tiled=True, blockxsize=256, blockysize=256,
                nodata=np.nan if np.issubdtype(arr.dtype, np.floating) else None)
    with rasterio.open(path, "w", **prof) as d:
        d.write(arr, 1)


def load_local_tif(path):
    with rasterio.open(path) as d:
        a = d.read(1)
        res_m = d.transform.a
        half_m = -d.transform.c
    return a, half_m, res_m


def sample_bilinear(arr, half_m, res_m, x_m, y_m):
    """Высота в произвольной точке локальной сетки (пиксель-площадь, север сверху)."""
    from scipy.ndimage import map_coordinates
    col = (np.asarray(x_m) + half_m) / res_m - 0.5
    row = (half_m - np.asarray(y_m)) / res_m - 0.5
    return map_coordinates(arr, [np.atleast_1d(row), np.atleast_1d(col)], order=1, mode="nearest")


def write_json(path, obj):
    Path(path).parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(obj, f, ensure_ascii=False, indent=1)


def read_json(path):
    with open(path, encoding="utf-8") as f:
        return json.load(f)
