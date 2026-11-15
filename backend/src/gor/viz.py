"""Общие функции для картинок проверки."""
import numpy as np


def hillshade(h, res_m, az_deg=315.0, alt_deg=35.0, z=1.0):
    gy, gx = np.gradient(h, res_m)
    # строки идут с севера на юг → d/dy(north) = -gy
    dzdx, dzdy = gx * z, -gy * z
    slope = np.arctan(np.hypot(dzdx, dzdy))
    aspect = np.arctan2(-dzdx, -dzdy)  # направление ската (откуда свет падает)
    az = np.radians(az_deg)
    alt = np.radians(alt_deg)
    hs = np.sin(alt) * np.cos(slope) + np.cos(alt) * np.sin(slope) * np.cos(az - aspect)
    return np.clip(hs, 0, 1)


def stretch(a, lo=1, hi=99):
    v = a[np.isfinite(a)]
    p0, p1 = np.percentile(v, [lo, hi])
    return np.clip((a - p0) / (p1 - p0 + 1e-9), 0, 1)


def extent(half_m):
    return [-half_m, half_m, -half_m, half_m]
