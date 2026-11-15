"""Базовые слои 5 м (уклон, неровности, запреты) → data/proc/layers_5m.npz"""
import sys; sys.path.insert(0, "src")
import numpy as np
from gor.io import *
from gor.layers import *

h1, half, _ = load_local_tif(PROC / "near_dtm_1m.tif")
h5, _, _ = load_local_tif(PROC / "near_dtm_5m.tif")
nod5, _, _ = load_local_tif(PROC / "near_nodata_5m.tif")
sl = slope_deg(h5)
rg = roughness_m(h1)
fb = forbidden(sl, rg, nod5.astype(bool))
np.savez_compressed(PROC / "layers_5m.npz", slope_deg=sl.astype("f4"), rough_m=rg.astype("f4"),
                    forbidden=fb, h5=h5.astype("f4"))
print("slope p50/p90/p99", np.percentile(sl, [50, 90, 99]).round(2), " >15°:", (sl > 15).mean().round(4))
print("rough p50/p90/p99/p99.9", np.percentile(rg, [50, 90, 99, 99.9]).round(3), " >0.5:", (rg > 0.5).mean().round(4))
print("forbidden", fb.mean().round(4))
