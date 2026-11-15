"""P3: маршруты по данным HiRISE → export/routes.json, проверки out/check/p3_<id>.png"""
import sys
from datetime import datetime, timezone
sys.path.insert(0, "src")

import numpy as np
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from PIL import Image
from scipy.ndimage import zoom

from gor.io import *  # noqa
from gor.layers import speed_mps, SLOPE_MAX_DEG
from gor.route import *  # noqa
from gor.viz import extent

MISSIONS = [
    ("m1", "Короткий выход: Artuby Ridge", ["t2"]),
    ("m2", "Séítah: два оливиновых обнажения", ["t3", "t4"]),
    ("m3", "Амбициозный: Séítah + фронт дельты (проверка лимитов)", ["t3", "t2", "t5", "t6"]),
    ("m4", "Длинный выход к фронту дельты", ["t5", "t6", "t7"]),
]
PRESET = "safe"
SHELTER_SEARCH_S = 15 * 60


def load_layers():
    L = np.load(PROC / "layers_5m.npz")
    sky10 = np.load(PROC / "sky_10m.npy")
    sky5 = np.repeat(np.repeat(sky10, 2, 0), 2, 1)  # 10 м → 5 м
    dose_h = DOSE_MSV_PER_DAY / 24.0 * sky5
    np.save(PROC / "dose_mSv_h_5m.npy", dose_h.astype("f4"))
    v = speed_mps(L["slope_deg"])
    return L, sky5, dose_h, v


def to_pts(cells, h1, h_ref, extra=None, idx=None):
    idx = np.arange(len(cells)) if idx is None else idx
    x, y = rc_to_xy(cells[idx, 0], cells[idx, 1])
    h = sample_bilinear(h1, HALF_M, 1.0, x, y) - h_ref
    lon, lat = local_to_lonlat(x, y)
    pts = []
    for k, i in enumerate(idx):
        p = {"x": round(float(x[k]), 1), "y": round(float(y[k]), 1), "h": round(float(h[k]), 2)}
        if extra is not None:
            p.update({"lon": round(float(lon[k]), 7), "lat": round(float(lat[k]), 7),
                      "t_s": round(float(extra["t_s"][i]), 1), "o2_l": round(float(extra["o2_l"][i]), 2),
                      "dose_msv": round(float(extra["dose_msv"][i]), 5)})
        pts.append(p)
    return pts


def plan_mission(router, base_rc, tgt, ids, layers, ttb_s):
    L, sky5, dose_h, v = layers
    dropped = []
    ids = list(ids)
    while ids:
        _, order = router.best_order(base_rc, [tgt[i]["rc"] for i in ids])
        order_ids = [next(i for i in ids if tgt[i]["rc"] == rc) for rc in order]
        seq = [base_rc] + [tgt[i]["rc"] for i in order_ids] + [base_rc]
        cells, stops = [np.array([base_rc])], []
        for a, b in zip(seq[:-1], seq[1:]):
            p, _ = router.path(a, b)
            if p is None:
                raise RuntimeError(f"нет пути {a}->{b}")
            cells.append(p[1:])
            stops.append(sum(len(c) for c in cells) - 1)
        cells = np.concatenate(cells)
        stop_idx = stops[:-1]
        ev = evaluate(cells, L["h5"], L["slope_deg"], v, dose_h, stop_idx,
                      [tgt[i]["stop_min"] * 60 for i in order_ids])
        t_total, o2_total = ev["t_s"][-1], ev["o2_l"][-1]
        o2_usable = O2_SUPPLY_L * (1 - O2_RESERVE)
        reasons = []
        if t_total > EVA_LIMIT_S:
            reasons.append(f"время {t_total / 60:.0f} мин > лимита {EVA_LIMIT_S / 60:.0f} мин")
        if o2_total > o2_usable:
            reasons.append(f"O₂ {o2_total:.0f} л > доступно {o2_usable:.0f} л (резерв 20%)")
        if not reasons:
            return order_ids, cells, stop_idx, ev, dropped
        worst = max(ids, key=lambda i: (tgt[i]["priority"], -ids.index(i)))
        dropped.append({"target_id": worst, "reason": "; ".join(reasons) + f" → убрана цель с худшим приоритетом ({tgt[worst]['priority']})"})
        ids.remove(worst)
    raise RuntimeError("все цели выброшены")


def shelters_for(cells, layers, h1, h_ref, frac_list=(0.25, 0.5, 0.75)):
    L, sky5, dose_h, v = layers
    out = []
    for f in frac_list:
        i = int(f * (len(cells) - 1))
        rc = tuple(cells[i])
        tmap, m = time_map_s(v, L["forbidden"], rc, max_s=SHELTER_SEARCH_S)
        ok = np.isfinite(tmap) & (tmap <= SHELTER_SEARCH_S)
        # минимальная доля неба; при равенстве (±0.005) — ближайшая по времени
        s = np.where(ok, sky5, np.inf)
        smin = s.min()
        cand = ok & (sky5 <= smin + 0.005)
        tt = np.where(cand, tmap, np.inf)
        best = np.unravel_index(np.argmin(tt), tt.shape)
        path = np.array(m.traceback(best))
        out.append({"from_index_full": i, "path_cells": path, "time_min": float(tmap[best] / 60),
                    "sky_from": float(sky5[rc]), "sky_to": float(sky5[best]),
                    "dose_reduction_pct": float((1 - sky5[best] / sky5[rc]) * 100)})
    return out


def main():
    layers = load_layers()
    L, sky5, dose_h, v = layers
    h1, _, _ = load_local_tif(PROC / "near_dtm_1m.tif")
    h_ref = read_json(EXPORT / "terrain" / "meta.json")["near"]["h_ref"]
    targets = read_json(EXPORT / "targets.json")
    tgt = {t["id"]: dict(t, rc=xy_to_rc(t["x"], t["y"])) for t in targets}
    base_rc = tgt["base"]["rc"]
    cost = cost_per_m(v, L["rough_m"], dose_h, L["forbidden"], **PRESETS[PRESET])
    router = Router(cost)
    ttb_s, _ = time_map_s(v, L["forbidden"], base_rc)   # время до базы (симметрично)
    np.save(PROC / "time_to_base_s.npy", ttb_s.astype("f4"))
    print("недостижимо от базы:", (~np.isfinite(ttb_s) & ~L["forbidden"]).mean().round(4))

    tex_p = EXPORT / "terrain" / "near_texture_2048.jpg"
    tex = np.array(Image.open(tex_p)) if tex_p.exists() else None
    missions = []
    for mid, name, ids in MISSIONS:
        order_ids, cells, stop_idx, ev, dropped = plan_mission(router, base_rc, tgt, ids, layers, ttb_s)
        t = ev["t_s"]
        ttb_path = ttb_s[cells[:, 0], cells[:, 1]]
        margin = (EVA_LIMIT_S - t - ttb_path) / EVA_LIMIT_S
        bad = np.where(margin < RETURN_MARGIN)[0]
        nri_full = int(bad[0]) if len(bad) else None
        keep = set(stop_idx) | ({nri_full} if nri_full is not None else set())
        idx = thin_indices(ev["dist_m"], keep, 10.0)
        pos = {int(i): k for k, i in enumerate(idx)}
        sh = shelters_for(cells, layers, h1, h_ref)
        sl_path = L["slope_deg"][cells[:, 0], cells[:, 1]]
        m = {
            "id": mid, "name": name, "target_ids": order_ids,
            "path": to_pts(cells, h1, h_ref, ev, idx),
            "stops_index": [pos[i] for i in stop_idx],
            "no_return_index": pos[nri_full] if nri_full is not None else None,
            "summary": {"distance_m": round(float(ev["dist_m"][-1]), 0),
                        "time_min": round(float(t[-1] / 60), 1),
                        "walk_min": round(float((t[-1] - sum(tgt[i]["stop_min"] * 60 for i in order_ids)) / 60), 1),
                        "o2_l": round(float(ev["o2_l"][-1]), 1),
                        "o2_pct_of_supply": round(float(ev["o2_l"][-1] / O2_SUPPLY_L * 100), 1),
                        "dose_msv": round(float(ev["dose_msv"][-1]), 4),
                        "max_slope_deg": round(float(sl_path.max()), 1),
                        "min_return_margin_pct": round(float(margin.min() * 100), 1)},
            "dropped": dropped,
            "shelters": [{"from_index": int(np.searchsorted(idx, s["from_index_full"])),
                          "path": to_pts(s["path_cells"], h1, h_ref,
                                         idx=thin_indices(np.arange(len(s["path_cells"])) * 5.0, set(), 10.0)),
                          "time_min": round(s["time_min"], 1),
                          "sky_fraction_from": round(s["sky_from"], 3), "sky_fraction_to": round(s["sky_to"], 3),
                          "dose_reduction_pct": round(s["dose_reduction_pct"], 1)} for s in sh],
        }
        missions.append(m)
        print(mid, order_ids, m["summary"], "dropped:", [d["target_id"] for d in dropped],
              "NRI:", m["no_return_index"], "/", len(m["path"]),
              "shelters:", [(s["time_min"], s["dose_reduction_pct"]) for s in m["shelters"]])
        plot_check(m, cells, sh, L, tex, tgt)

    write_json(EXPORT / "routes.json", {
        "generated": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "source": "USGS HiRISE DTM Jezero 1 m (Mars 2020 TRN), grid 5 m", "preset": PRESET,
        "limits": {"eva_limit_min": EVA_LIMIT_S / 60, "o2_supply_l": round(O2_SUPPLY_L, 1),
                   "o2_reserve_pct": O2_RESERVE * 100, "return_margin_pct": RETURN_MARGIN * 100,
                   "slope_max_deg": SLOPE_MAX_DEG, "dose_msv_per_day_open_sky": DOSE_MSV_PER_DAY},
        "missions": missions})


def plot_check(m, cells, sh, L, tex, tgt):
    fig, ax = plt.subplots(figsize=(11, 11))
    if tex is not None:
        ax.imshow(tex, extent=extent(HALF_M))
    else:
        ax.imshow(L["h5"], cmap="gray", extent=extent(HALF_M))
    ax.imshow(np.where(L["forbidden"], 1.0, np.nan), cmap="autumn", alpha=0.55, extent=extent(HALF_M))
    x, y = rc_to_xy(cells[:, 0], cells[:, 1])
    ax.plot(x, y, "c-", lw=2, label="маршрут (safe)")
    if m["no_return_index"] is not None:
        p = m["path"][m["no_return_index"]]
        ax.plot(p["x"], p["y"], "rX", ms=14, label="точка невозврата (запас <10%)")
    for s in sh:
        sx, sy = rc_to_xy(s["path_cells"][:, 0], s["path_cells"][:, 1])
        ax.plot(sx, sy, "m-", lw=1.5)
        ax.plot(sx[-1], sy[-1], "m^", ms=9)
    for t in tgt.values():
        ax.plot(t["x"], t["y"], "w*" if t["type"] == "base" else "wo", ms=12, mec="k")
        ax.annotate(t["id"], (t["x"], t["y"]), xytext=(5, 5), textcoords="offset points", color="w")
    xs = [p["x"] for p in m["path"]]; ys = [p["y"] for p in m["path"]]
    pad = 250
    ax.set_xlim(min(xs) - pad, max(xs) + pad); ax.set_ylim(min(ys) - pad, max(ys) + pad)
    s = m["summary"]
    ax.set_title(f'{m["id"]} {m["name"]}\n{s["distance_m"]:.0f} м, {s["time_min"]:.0f} мин, O₂ {s["o2_l"]:.0f} л, '
                 f'доза {s["dose_msv"]:.3f} мЗв, макс. уклон {s["max_slope_deg"]}°; пурпурное — пути к укрытию')
    ax.legend(loc="lower left")
    plt.tight_layout(); plt.savefig(CHECK / f"p3_{m['id']}.png", dpi=80); plt.close()


if __name__ == "__main__":
    main()
