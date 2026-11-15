"""Слои на сетке 5 м: уклон, неровности, скорость, кислород, запреты.
Все числа-пороги — допущения (см. ASSUMPTIONS.md)."""
import numpy as np
from scipy.ndimage import uniform_filter

CELL_M = 5.0
SLOPE_MAX_DEG = 15.0
ROUGH_MAX_M = 0.5
SUIT_FACTOR = 0.6
WALK_POWER_W = 350.0
O2_J_PER_L = 20100.0


def slope_deg(h5, cell_m=CELL_M):
    gy, gx = np.gradient(h5, cell_m)
    return np.degrees(np.arctan(np.hypot(gx, gy)))


def roughness_m(h1, smooth_m=5, cell_m=CELL_M):
    """Максимальный |остаток| (1 м минус сглаженная 5×5 м) в каждой клетке 5 м."""
    resid = np.abs(h1 - uniform_filter(h1, size=int(smooth_m), mode="nearest"))
    k = int(cell_m)
    n = h1.shape[0] // k
    return resid[:n * k, :n * k].reshape(n, k, n, k).max(axis=(1, 3))


def tobler_kmh(tan_s):
    return 6.0 * np.exp(-3.5 * np.abs(tan_s + 0.05))


def speed_mps(slope_d):
    """Симметричный Тоблер × поправка скафандра. Подъём и спуск стоят одинаково."""
    s = np.tan(np.radians(slope_d))
    v_kmh = 0.5 * (tobler_kmh(s) + tobler_kmh(-s)) * SUIT_FACTOR
    return v_kmh / 3.6


def power_w(slope_d):
    return WALK_POWER_W * (1 + 0.05 * slope_d)


def o2_l(power_w_, time_s):
    return power_w_ * time_s / O2_J_PER_L


def forbidden(slope_d, rough_m, nodata=None):
    f = (slope_d > SLOPE_MAX_DEG) | (rough_m > ROUGH_MAX_M)
    if nodata is not None:
        f |= nodata
    return f
