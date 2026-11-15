"""P2: научные точки → export/targets.json, проверка out/check/p2_targets.png

Координаты: путевые точки ровера NASA (M20_waypoints.json, MMGIS) — последняя точка
остановки на сол ≤ сола запечатывания образца (список образцов: science.nasa.gov, Mars Rock Samples).
Точность — десятки метров (ровер мог подъехать к камню после последней локализации).
"""
import sys
sys.path.insert(0, "src")
import numpy as np
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from PIL import Image
from scipy.ndimage import distance_transform_edt

from gor.io import *  # noqa
from gor.viz import extent

WAYPOINTS = read_json(RAW / "nasa" / "M20_waypoints.json")["features"]
HALF = NEAR_SIZE_M / 2
SNAP_MAX_M = 20.0

# (id, имя, образцы, сол запечатывания, тип, научная строка, приоритет, остановка мин)
SITES = [
    ("t1", "Sid (Ch'ał)", "Ha'ahóni, Atsá", 371, "sample_site",
     "Лава дна кратера (формация Máaz) с солями — следы воды после извержения, рядом с базой", 3, 20),
    ("t2", "Rochette (Artuby Ridge)", "Montdenier, Montagnac", 194, "sample_site",
     "Первые керны: базальт дна кратера — абсолютный возраст Jezero и следы изменения водой", 2, 30),
    ("t3", "Brac (Séítah)", "Salette, Coulettes", 262, "sample_site",
     "Оливиновый кумулят Séítah — глубинная магма, изменённая водой (карбонаты)", 1, 30),
    ("t4", "Issole (Séítah)", "Robine, Malay", 298, "sample_site",
     "Séítah: сульфаты и карбонаты в оливиновой породе — химия древней воды", 2, 25),
    ("t5", "Hawksbill Gap: Skinner + Wildcat Ridge (фронт дельты)", "Swift Run, Skyland, Hazeltop, Bearwallow", 509, "sample_site",
     "Песчаник и озёрный аргиллит с органикой и сульфатами — лучший кандидат для поиска биосигнатур", 1, 40),
    ("t6", "Amalik (фронт дельты)", "Shuyak, Mageik", 575, "sample_site",
     "Аргиллит с сульфатами — испарение озера, консервация органики", 2, 30),
    ("t7", "Hidden Harbor (фронт дельты)", "Kukaklek", 631, "sample_site",
     "Песчаник/аргиллит верхней части фронта дельты — смена условий осадконакопления", 3, 25),
]


def waypoint_before(sol):
    c = [f["properties"] for f in WAYPOINTS if f["properties"]["sol"] <= sol]
    return max(c, key=lambda p: (p["sol"], p["dist_total_m"]))


def snap(x, y, forb, res=5.0):
    """Сдвиг к ближайшей разрешённой клетке (≤ 20 м)."""
    r = int((HALF - y) // res); c = int((x + HALF) // res)
    if not forb[r, c]:
        return x, y, 0.0
    d, (ri, ci) = distance_transform_edt(forb, return_indices=True)
    r2, c2 = ri[r, c], ci[r, c]
    nx, ny = -HALF + (c2 + 0.5) * res, HALF - (r2 + 0.5) * res
    dist = float(np.hypot(nx - x, ny - y))
    if dist > SNAP_MAX_M:
        return None
    return nx, ny, dist


def main():
    L = np.load(PROC / "layers_5m.npz")
    forb = L["forbidden"]
    h1, _, _ = load_local_tif(PROC / "near_dtm_1m.tif")
    h_ref = read_json(EXPORT / "terrain" / "meta.json")["near"]["h_ref"]

    def H(x, y):
        return float(sample_bilinear(h1, HALF, 1.0, x, y)[0]) - h_ref

    out = []
    bx, by = lonlat_to_local(LANDER_LON, LANDER_LAT)
    out.append({"id": "base", "name": "База — лендер (Octavia E. Butler Landing)", "x": round(bx, 1),
                "y": round(by, 1), "h": round(H(bx, by), 2), "lon": LANDER_LON, "lat": LANDER_LAT,
                "type": "base", "science": "Точка посадки Perseverance; база и укрытие экипажа",
                "priority": 0, "stop_min": 0, "coords_source": "nasa",
                "source_note": "M20_waypoints.json, sol 13 (первая локализация)"})
    log = []
    for tid, name, samples, sol, typ, sci, prio, stop in SITES:
        p = waypoint_before(sol)
        x, y = lonlat_to_local(p["lon"], p["lat"])
        if not (-HALF < x < HALF and -HALF < y < HALF):
            log.append(f"{tid} {name}: вне участка, пропущен"); continue
        s = snap(x, y, forb)
        if s is None:
            log.append(f"{tid} {name}: на запретной клетке, нет доступной в 20 м — пропущен"); continue
        x2, y2, moved = s
        lon, lat = local_to_lonlat(x2, y2)
        out.append({"id": tid, "name": name, "x": round(x2, 1), "y": round(y2, 1), "h": round(H(x2, y2), 2),
                    "lon": round(lon, 7), "lat": round(lat, 7), "type": typ, "science": sci,
                    "samples": samples, "priority": prio, "stop_min": stop, "coords_source": "nasa",
                    "source_note": f"M20_waypoints.json: остановка ровера sol {p['sol']} (образец запечатан sol {sol}); точность ~±50 м",
                    "snapped_m": round(moved, 1)})
        log.append(f"{tid} {name}: sol {p['sol']} → x={x2:.0f} y={y2:.0f}, сдвиг {moved:.1f} м")
    write_json(EXPORT / "targets.json", out)
    print("\n".join(log))

    # проверка
    tex = np.array(Image.open(EXPORT / "terrain" / "near_texture_2048.jpg")) if (EXPORT / "terrain" / "near_texture_2048.jpg").exists() else None
    fig, ax = plt.subplots(figsize=(11, 11))
    if tex is not None:
        ax.imshow(tex, extent=extent(HALF))
    ax.imshow(np.where(forb, 1.0, np.nan), cmap="autumn", alpha=0.6, extent=extent(HALF))
    tr = [f["properties"] for f in WAYPOINTS if f["properties"]["sol"] <= 700]
    txy = np.array([lonlat_to_local(p["lon"], p["lat"]) for p in tr])
    ax.plot(txy[:, 0], txy[:, 1], "w-", lw=0.8, alpha=0.7, label="траверс Perseverance (до sol 700)")
    for t in out:
        ax.plot(t["x"], t["y"], "c*" if t["type"] == "base" else "co", ms=14 if t["type"] == "base" else 9, mec="k")
        ax.annotate(f'{t["id"]} {t["name"]}', (t["x"], t["y"]), xytext=(6, 6), textcoords="offset points",
                    color="w", fontsize=9, bbox=dict(fc="k", alpha=0.5, lw=0))
    ax.set_xlim(-HALF, HALF); ax.set_ylim(-HALF, HALF); ax.legend(loc="lower left")
    ax.set_title("P2: цели (NASA waypoints) поверх ортоснимка; красное — запрет (уклон>15° / камни>0.5 м)")
    plt.tight_layout(); plt.savefig(CHECK / "p2_targets.png", dpi=80); plt.close()


if __name__ == "__main__":
    main()
