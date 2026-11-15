"""Цена, поиск пути, порядок целей, проверки, зона возврата, укрытие."""
import itertools

import numpy as np
from skimage.graph import MCP_Geometric

from .layers import speed_mps, power_w, o2_l, CELL_M, ROUGH_MAX_M

HALF_M = 2000.0
N = 800

DOSE_MSV_PER_DAY = 0.64        # Hassler et al. 2014, Curiosity RAD, Gale, поверхность
EVA_LIMIT_S = 4 * 3600
O2_SUPPLY_L = 350.0 * 8 * 3600 / 20100.0   # запас = 8 ч ходьбы по ровному
O2_RESERVE = 0.20
RETURN_MARGIN = 0.10
STOP_POWER_W = 350.0           # работа на точке (бурение, осмотр) — как ходьба по ровному

PRESETS = {"fast": dict(w_rough=0.0, w_dose=0.0), "safe": dict(w_rough=1.0, w_dose=0.5)}


def xy_to_rc(x, y):
    return int((HALF_M - y) // CELL_M), int((x + HALF_M) // CELL_M)


def rc_to_xy(r, c):
    return -HALF_M + (np.asarray(c) + 0.5) * CELL_M, HALF_M - (np.asarray(r) + 0.5) * CELL_M


def cost_per_m(v_mps, rough_m, dose_rate, forbidden, w_rough, w_dose):
    rough_norm = np.clip(rough_m / ROUGH_MAX_M, 0, 1)
    dose_norm = (dose_rate - dose_rate.min()) / (np.ptp(dose_rate) + 1e-12)
    cost = (CELL_M / v_mps) * (1 + w_rough * rough_norm + w_dose * dose_norm)
    cost = cost.astype(np.float64)
    cost[forbidden] = np.inf
    return cost


class Router:
    def __init__(self, cost):
        self.cost = cost
        self._cache = {}

    def from_point(self, rc):
        if rc not in self._cache:
            m = MCP_Geometric(self.cost, fully_connected=True)
            cum, _ = m.find_costs([rc])
            self._cache[rc] = (m, cum)
        return self._cache[rc]

    def path(self, a, b):
        m, cum = self.from_point(a)
        if not np.isfinite(cum[b]):
            return None, np.inf
        return np.array(m.traceback(b)), float(cum[b])

    def best_order(self, base, targets):
        """Перебор перестановок: база → цели → база, минимум суммарной цены."""
        best = (np.inf, None)
        for perm in itertools.permutations(targets):
            seq = [base, *perm, base]
            total = sum(self.from_point(seq[i])[1][seq[i + 1]] for i in range(len(seq) - 1))
            if total < best[0]:
                best = (total, perm)
        return best


def time_map_s(v_mps, forbidden, start_rc, max_s=None):
    c = (CELL_M / v_mps).astype(np.float64)   # MCP умножает на длину шага в клетках (1 или √2)
    c[forbidden] = np.inf
    m = MCP_Geometric(c, fully_connected=True)
    cum, _ = m.find_costs([start_rc])
    return cum, m


def evaluate(cells, h_m, slope_d, v_mps, dose_mSv_h, stop_cells_idx, stop_s):
    """Накопительные величины по клеткам пути. stop_cells_idx — индексы клеток-целей."""
    n = len(cells)
    r, c = cells[:, 0], cells[:, 1]
    t = np.zeros(n); o2 = np.zeros(n); dose = np.zeros(n); dist = np.zeros(n)
    stop_at = dict(zip(stop_cells_idx, stop_s))
    for i in range(1, n):
        dxy = CELL_M * np.hypot(r[i] - r[i - 1], c[i] - c[i - 1])
        dz = h_m[r[i], c[i]] - h_m[r[i - 1], c[i - 1]]
        d3 = np.hypot(dxy, dz)
        v = 0.5 * (v_mps[r[i], c[i]] + v_mps[r[i - 1], c[i - 1]])
        dt = d3 / v if d3 > 0 else 0.0
        sl = 0.5 * (slope_d[r[i], c[i]] + slope_d[r[i - 1], c[i - 1]])
        dr = 0.5 * (dose_mSv_h[r[i], c[i]] + dose_mSv_h[r[i - 1], c[i - 1]])
        t[i] = t[i - 1] + dt
        o2[i] = o2[i - 1] + o2_l(power_w(sl), dt)
        dose[i] = dose[i - 1] + dr * dt / 3600
        dist[i] = dist[i - 1] + d3
        if i in stop_at:
            ts = stop_at[i]
            t[i] += ts
            o2[i] += o2_l(STOP_POWER_W, ts)
            dose[i] += dose_mSv_h[r[i], c[i]] * ts / 3600
    return dict(t_s=t, o2_l=o2, dose_msv=dose, dist_m=dist)


def thin_indices(dist_m, keep, step_m=10.0):
    idx = [0]
    for i in range(1, len(dist_m)):
        if dist_m[i] - dist_m[idx[-1]] >= step_m or i in keep:
            idx.append(i)
    if idx[-1] != len(dist_m) - 1:
        idx.append(len(dist_m) - 1)
    return np.array(idx)
