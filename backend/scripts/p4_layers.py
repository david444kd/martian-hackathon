"""P4: слои карты (RGBA PNG, охват = near_texture) → export/layers/*, проверка out/check/p4_layers.png"""
import sys
sys.path.insert(0, "src")
import numpy as np
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib import cm
from PIL import Image

from gor.io import *  # noqa
from gor.layers import SLOPE_MAX_DEG, ROUGH_MAX_M
from gor.route import EVA_LIMIT_S, RETURN_MARGIN, DOSE_MSV_PER_DAY
from gor.viz import extent

OUT = EXPORT / "layers"
OUT.mkdir(parents=True, exist_ok=True)
CAUTION_SLOPE_DEG = 10.0
ROUGH_CAUTION_M = 0.15


def rgba(rgb, alpha):
    a = np.dstack([np.clip(rgb, 0, 255), np.clip(alpha, 0, 1) * 255]).astype(np.uint8)
    return a


def main():
    L = np.load(PROC / "layers_5m.npz")
    sl, rg, fb = L["slope_deg"], L["rough_m"], L["forbidden"]
    dose = np.load(PROC / "dose_mSv_h_5m.npy")
    ttb = np.load(PROC / "time_to_base_s.npy")
    routes = read_json(EXPORT / "routes.json")
    targets = {t["id"]: t for t in read_json(EXPORT / "targets.json")}

    # --- hazard
    n = sl.shape[0]
    rgb = np.zeros((n, n, 3)); al = np.zeros((n, n))
    pen = np.clip(np.maximum((sl - CAUTION_SLOPE_DEG) / (SLOPE_MAX_DEG - CAUTION_SLOPE_DEG),
                             (rg - ROUGH_CAUTION_M) / (ROUGH_MAX_M - ROUGH_CAUTION_M)), 0, 1)
    m = pen > 0
    rgb[m] = np.array([255, 220, 0]) * (1 - pen[m, None]) + np.array([255, 120, 0]) * pen[m, None]
    al[m] = 0.25 + 0.4 * pen[m]
    rgb[fb] = [230, 30, 30]; al[fb] = 0.75
    Image.fromarray(rgba(rgb, al)).save(OUT / "hazard.png", optimize=True)

    # --- dose
    dmin, dmax = float(dose.min()), float(dose.max())
    dn = (dose - dmin) / (dmax - dmin)
    rgb = cm.plasma(dn)[..., :3] * 255
    Image.fromarray(rgba(rgb, 0.25 + 0.35 * (1 - dn))).save(OUT / "dose.png", optimize=True)

    # --- зоны возврата
    zones = {}
    for ms in routes["missions"]:
        stop_s = sum(targets[t]["stop_min"] * 60 for t in ms["target_ids"])
        budget = EVA_LIMIT_S * (1 - RETURN_MARGIN) - stop_s
        margin = (budget - 2 * ttb) / budget       # 1 у базы, 0 на границе зоны
        inside = np.isfinite(margin) & (margin >= 0)
        rgb = np.zeros((n, n, 3)); al = np.zeros((n, n))
        rgb[inside] = [40, 220, 120]
        al[inside] = 0.15 + 0.3 * margin[inside]
        edge = inside & (margin < 0.1)
        rgb[edge] = [255, 200, 0]; al[edge] = 0.6
        Image.fromarray(rgba(rgb, al)).save(OUT / f"zone_{ms['id']}.png", optimize=True)
        zones[ms["id"]] = {"file": f"zone_{ms['id']}.png", "stops_min": stop_s / 60,
                           "max_one_way_min": round(budget / 2 / 60, 1),
                           "area_km2": round(float(inside.sum()) * 25 / 1e6, 2)}

    write_json(OUT / "meta.json", {
        "extent_m": {"x_min": -2000, "x_max": 2000, "y_min": -2000, "y_max": 2000},
        "px": n, "cell_m": 5.0,
        "note": "same footprint as terrain/near_texture_*.jpg; row 0 = north. Drape as a second texture or a plane 0.3 m above terrain.",
        "hazard": {"file": "hazard.png",
                   "legend": [{"color": "#e61e1e", "label": f"запрет: уклон > {SLOPE_MAX_DEG}° или камни > {ROUGH_MAX_M} м"},
                              {"color": "#ffdc00→#ff7800", "label": f"штраф: уклон {CAUTION_SLOPE_DEG}–{SLOPE_MAX_DEG}° / неровности {ROUGH_CAUTION_M}–{ROUGH_MAX_M} м"}]},
        "dose": {"file": "dose.png", "units": "mSv/h", "min": round(dmin, 6), "max": round(dmax, 6),
                 "colormap": "plasma (min → dark purple, max → yellow)",
                 "model": f"{DOSE_MSV_PER_DAY} mSv/day (Curiosity RAD) × sky-view fraction from horizon silhouettes"},
        "zones": zones,
        "zone_legend": [{"color": "#28dc78", "label": "можно дойти и вернуться в лимит (ярче — больше запас)"},
                        {"color": "#ffc800", "label": "край зоны (запас < 10%)"}],
    })

    # --- проверка
    tex_p = EXPORT / "terrain" / "near_texture_2048.jpg"
    base = np.array(Image.open(tex_p)) if tex_p.exists() else np.load(PROC / "layers_5m.npz")["h5"]
    fig, ax = plt.subplots(1, 3, figsize=(24, 8.5))
    for a, f, ttl in zip(ax, ["hazard.png", "dose.png", "zone_m4.png"],
                         ["hazard", f"dose {dmin:.4f}–{dmax:.4f} мЗв/ч", "zone_m4"]):
        a.imshow(base, cmap="gray", extent=extent(2000))
        a.imshow(np.array(Image.open(OUT / f)), extent=extent(2000))
        a.set_title(ttl)
    for ms in routes["missions"]:
        ax[2].plot([p["x"] for p in ms["path"]], [p["y"] for p in ms["path"]], lw=1, label=ms["id"])
    ax[2].legend()
    plt.tight_layout(); plt.savefig(CHECK / "p4_layers.png", dpi=70); plt.close()
    print(zones)


if __name__ == "__main__":
    main()
