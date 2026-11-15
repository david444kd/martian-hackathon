"""База силуэтов (50 м, 360°) → data/proc/horizons.npy и доля неба 10 м (72 азимута) → data/proc/sky_10m.npy"""
import sys, time; sys.path.insert(0, "src")
import numpy as np
from gor.io import *
from gor.horizon import horizons, ray_distances, sky_fraction, EYE_M

h5, H5, R5 = load_local_tif(PROC / "near_dtm_5m.tif")
hc, HC, RC = load_local_tif(PROC / "ctx_dem_20m.tif")
d = ray_distances(2.0, 40000.0, 400)

# прогрев numba
horizons(np.zeros(1), np.zeros(1), h5, H5, R5, hc, HC, RC, d, 8, EYE_M)

c50 = -2000 + 50 * (np.arange(80) + 0.5)
X, Y = np.meshgrid(c50, c50[::-1])
t0 = time.time()
hz = horizons(X.ravel(), Y.ravel(), h5, H5, R5, hc, HC, RC, d, 360, EYE_M)
print(f"база 50 м: {hz.shape}, {time.time()-t0:.1f} с")
np.save(PROC / "horizons.npy", hz.reshape(80, 80, 360))
np.save(PROC / "horizons_xy.npy", np.stack([X, Y], -1))

c10 = -2000 + 10 * (np.arange(400) + 0.5)
X, Y = np.meshgrid(c10, c10[::-1])
t0 = time.time()
hz10 = horizons(X.ravel(), Y.ravel(), h5, H5, R5, hc, HC, RC, ray_distances(2.0, 40000.0, 250), 72, EYE_M)
sky = sky_fraction(hz10).reshape(400, 400)
print(f"небо 10 м: {time.time()-t0:.1f} с, доля неба min/med/max {sky.min():.3f} {np.median(sky):.3f} {sky.max():.3f}")
np.save(PROC / "sky_10m.npy", sky.astype("f4"))
