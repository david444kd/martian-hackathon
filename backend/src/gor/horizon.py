"""Силуэты горизонта (numba, parallel) и доля открытого неба.

Луч из точки P по азимуту az (0 = север, по часовой), шаги логарифмические до 40 км.
Угол точки на луче: atan((h − h_P − eye − d²/(2R)) / d). Силуэт — максимум по лучу.
Рельеф: ближний (сетка near, мелкий шаг) внутри своего квадрата, иначе дальний (CTX 20 м).
"""
import numpy as np
from numba import njit, prange

R_MARS_M = 3389500.0
EYE_M = 1.7


def ray_distances(d_min_m=2.0, d_max_m=40000.0, n=400):
    return np.geomspace(d_min_m, d_max_m, n)


@njit(cache=True, fastmath=True)
def _bilinear(g, half, res, x, y):
    n = g.shape[0]
    c = (x + half) / res - 0.5
    r = (half - y) / res - 0.5
    if c < 0.0:
        c = 0.0
    if r < 0.0:
        r = 0.0
    if c > n - 1.001:
        c = n - 1.001
    if r > n - 1.001:
        r = n - 1.001
    c0 = int(c); r0 = int(r)
    fc = c - c0; fr = r - r0
    return (g[r0, c0] * (1 - fc) * (1 - fr) + g[r0, c0 + 1] * fc * (1 - fr)
            + g[r0 + 1, c0] * (1 - fc) * fr + g[r0 + 1, c0 + 1] * fc * fr)


@njit(cache=True, fastmath=True)
def _height(near, near_half, near_res, far, far_half, far_res, x, y):
    lim = near_half - near_res
    if -lim < x < lim and -lim < y < lim:
        return _bilinear(near, near_half, near_res, x, y)
    return _bilinear(far, far_half, far_res, x, y)


@njit(parallel=True, cache=True, fastmath=True)
def horizons(px, py, near, near_half, near_res, far, far_half, far_res, dists, n_az, eye_m):
    """Возвращает массив (len(px), n_az) углов горизонта в радианах."""
    out = np.empty((px.shape[0], n_az), dtype=np.float32)
    for i in prange(px.shape[0]):
        h0 = _height(near, near_half, near_res, far, far_half, far_res, px[i], py[i]) + eye_m
        for a in range(n_az):
            az = 2.0 * np.pi * a / n_az
            sx = np.sin(az); sy = np.cos(az)
            best = -1.5707
            for k in range(dists.shape[0]):
                d = dists[k]
                h = _height(near, near_half, near_res, far, far_half, far_res, px[i] + sx * d, py[i] + sy * d)
                ang = np.arctan((h - h0 - d * d / (2.0 * R_MARS_M)) / d)
                if ang > best:
                    best = ang
            out[i, a] = best
    return out


def sky_fraction(hz_rad):
    """Доля открытого неба: среднее по азимутам (1 − sin(угол горизонта)), отрицательные углы → 0."""
    return np.mean(1.0 - np.sin(np.clip(hz_rad, 0, None)), axis=-1)
