"""P5c: улучшенная локализация на настоящих панорамах Perseverance.

Отличия от p5b:
- база силуэтов по карте 1 м (ближние гребни и камни видны), шаг сетки 20 м (40 000 точек);
- сравнение АБСОЛЮТНЫХ углов: панорамы в локальной горизонтальной системе (акселерометр ровера),
  у шлема тоже есть акселерометр → наклон известен, среднее не вычитаем;
- устойчивая ошибка: невязка обрезается на CLIP_DEG (выбросы детектора не тянут результат).
Варианты сравниваются честно на одних и тех же 10 панорамах; все результаты пишутся.
"""
import sys
import time
sys.path.insert(0, "src"); sys.path.insert(0, "scripts")
import numpy as np
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from numba import njit, prange
from PIL import Image

from gor.io import *  # noqa
from gor.horizon import horizons, ray_distances
import p5b_real_panos as B

OUT = ROOT / "out" / "horizon" / "real"
EYE_M = 2.0
GRID_M = 20.0
CLIP_DEG = 1.0


@njit(parallel=True, cache=True)
def score_all(db, q, mask, shifts, absolute, clip):
    """Для каждой точки базы: лучшая (минимальная) устойчивая RMS по поворотам.
    absolute=True — без вычитания среднего (наклон известен)."""
    M = db.shape[0]
    idx = np.where(mask)[0]; F = idx.shape[0]
    best = np.full(M, 1e9); bs = np.zeros(M, np.int32)
    c2 = clip * clip
    for i in prange(M):
        for s in shifts:
            m = 0.0
            if not absolute:
                for k in range(F):
                    m += db[i, (idx[k] + s) % 360] - q[idx[k]]
                m /= F
            e = 0.0
            for k in range(F):
                d = db[i, (idx[k] + s) % 360] - q[idx[k]] - m
                d2 = d * d
                e += d2 if d2 < c2 else c2
            e = np.sqrt(e / F)
            if e < best[i]:
                best[i] = e; bs[i] = s
    return best, bs


def build_db():
    p = PROC / f"horizons_1m_{int(GRID_M)}m_eye{EYE_M}.npy"
    c = -2000 + GRID_M * (np.arange(int(4000 / GRID_M)) + 0.5)
    X, Y = np.meshgrid(c, c[::-1]); xy = np.stack([X.ravel(), Y.ravel()], 1)
    if p.exists():
        return np.load(p), xy
    h1, H1, R1 = load_local_tif(PROC / "near_dtm_1m.tif")
    hc, HC, RC = load_local_tif(PROC / "ctx_dem_20m.tif")
    t0 = time.time()
    db = np.degrees(horizons(xy[:, 0].copy(), xy[:, 1].copy(), h1, H1, R1, hc, HC, RC,
                             ray_distances(5.0, 40000.0, 500), 360, EYE_M)).astype(np.float32)
    print(f"база {len(xy)} точек по карте 1 м: {time.time() - t0:.0f} с")
    np.save(p, db)
    return db, xy


SCORES = {}


def main():
    wps = [f["properties"] for f in read_json(RAW / "nasa" / "M20_waypoints.json")["features"]]
    db, xy = build_db()
    db64 = db.astype(np.float64)
    h1, H1, R1 = load_local_tif(PROC / "near_dtm_1m.tif")
    hc, HC, RC = load_local_tif(PROC / "ctx_dem_20m.tif")
    d = ray_distances(5.0, 40000.0, 500)
    rng = np.random.default_rng(0)
    variants = {"смещение (как раньше), обрезка": (False, CLIP_DEG),
                "абсолютные углы, без обрезки": (True, 1e6),
                "абсолютные углы + обрезка": (True, CLIP_DEG)}
    rows = []
    for sol in B.SOLS:
        pk = B.pick_mosaic(sol)
        if pk is None:
            continue
        name, cov, g = pk
        pos = B.waypoint_xy(name, wps)
        if pos is None or not (abs(pos[0]) < 1950 and abs(pos[1]) < 1950):
            continue
        img = Image.open(B.DIR / f"{name}.png")
        if img.size != (g["samples"], g["lines"]):
            g = dict(g, zero_line=g["zero_line"] * img.size[1] / g["lines"], lines=img.size[1], samples=img.size[0])
        hz = B.extract_horizon(img, g)
        if hz is None:
            continue
        q, rowline, okcol = hz
        mask = np.isfinite(q); qf = np.nan_to_num(q)
        x, y = pos[0], pos[1]
        pred = np.degrees(horizons(np.array([x]), np.array([y]), h1, H1, R1, hc, HC, RC, d, 360, EYE_M))[0]
        off = float(np.median((q - pred)[mask]))
        r = dict(sol=sol, n=int(mask.sum()), offset=off,
                 rms_abs_true=float(np.sqrt(np.mean((q - pred)[mask] ** 2))))
        ang = rng.uniform(0, 2 * np.pi); prior = np.array([x, y]) + 250 * np.array([np.cos(ang), np.sin(ang)])
        near_prior = np.hypot(*(xy - prior).T) <= 500
        for vname, (absolute, clip) in variants.items():
            sc, sh = score_all(db64, qf, mask, np.arange(360), absolute, clip)
            j = int(np.argmin(sc)); err = float(np.hypot(*(xy[j] - [x, y])))
            jp = int(np.argmin(np.where(near_prior, sc, 1e9))); errp = float(np.hypot(*(xy[jp] - [x, y])))
            # окна 90° без курса
            e90 = []
            for s0 in range(0, 360, 30):
                w = (np.arange(90) + s0) % 360
                if mask[w].sum() < 80:
                    continue
                m2 = np.zeros(360, bool); m2[w] = True; m2 &= mask
                sc2, _ = score_all(db64, qf, m2, np.arange(360), absolute, clip)
                e90.append(float(np.hypot(*(xy[int(np.argmin(sc2))] - [x, y]))))
            # зона неуверенности: все точки с невязкой ≤ лучшая + 0.05° (порядок шума карты)
            zone = sc <= sc[j] + 0.05
            zr = float(np.max(np.hypot(*(xy[zone] - xy[j]).T)))
            inside = bool(np.min(np.hypot(*(xy[zone] - [x, y]).T)) <= GRID_M)
            r[vname] = dict(err=err, err_prior=errp, e90=e90, j=j, shift=int(sh[j]), zone_r=zr, zone_ok=inside)
            if vname == "абсолютные углы + обрезка":
                SCORES[sol] = dict(score=sc.astype(np.float32), x=x, y=y)
        rows.append(r)
        v = r["абсолютные углы + обрезка"]
        print(f"sol {sol:4d}: {r['n']:3d}°, сдвиг уровня реал−карта {off:+.2f}°, "
              + " | ".join(f"{k.split(',')[0][:12]}: {r[k]['err']:.0f} м" for k in variants)
              + f" | 90°: {np.median(v['e90']) if v['e90'] else float('nan'):.0f} м | догадка: {v['err_prior']:.0f} м"
              + f" | зона ±{v['zone_r']:.0f} м, истина внутри: {'да' if v['zone_ok'] else 'НЕТ'}")

        # картинка
        fig, ax = plt.subplots(figsize=(14, 4.5))
        az = np.arange(360)
        ax.plot(az, q, "c-", lw=2, label="настоящая панорама")
        ax.plot(az, pred, "--", color="orange", lw=1.5, label="по карте 1 м в точке ровера")
        ax.plot(az, np.roll(db[v["j"]], -v["shift"]), ":", color="lime", lw=1.5, label=f"найдено (ошибка {v['err']:.0f} м)")
        ax.set_xlim(0, 360); ax.set_xlabel("азимут, ° (0 = север)"); ax.set_ylabel("угол горизонта, °")
        ax.set_title(f"sol {sol}: абсолютные углы (уровень по акселерометру)"); ax.legend()
        plt.tight_layout(); plt.savefig(OUT / f"v2_sol{sol:04d}.png", dpi=70); plt.close()

    # итог
    L = ["# «Где я» на настоящих панорамах Perseverance — версия 2\n",
         f"База: карта HiRISE 1 м, сетка {GRID_M:.0f} м ({len(xy)} точек), высота камеры {EYE_M} м. "
         f"Обрезка невязки {CLIP_DEG}°. Курс неизвестен во всех режимах.\n",
         "| вариант | весь круг: медиана | < 100 м | окна 90°: медиана | < 100 м | с догадкой ±250 м: медиана | < 100 м |",
         "|---|---|---|---|---|---|---|"]
    for vname in variants:
        e = np.array([r[vname]["err"] for r in rows]); ep = np.array([r[vname]["err_prior"] for r in rows])
        e9 = np.concatenate([r[vname]["e90"] for r in rows])
        L.append(f"| {vname} | {np.median(e):.0f} м | {np.mean(e < 100) * 100:.0f}% | {np.median(e9):.0f} м | "
                 f"{np.mean(e9 < 100) * 100:.0f}% ({len(e9)}) | {np.median(ep):.0f} м | {np.mean(ep < 100) * 100:.0f}% |")
    L += ["", "| сол | годных ° | уровень реал−карта, ° | RMS абс. в истинной точке, ° | ошибка (абс.+обрезка), м | зона неуверенности, ± м | истина в зоне | 90° медиана, м | с догадкой, м |",
          "|---|---|---|---|---|---|---|---|---|"]
    for r in rows:
        v = r["абсолютные углы + обрезка"]
        L.append(f"| {r['sol']} | {r['n']} | {r['offset']:+.2f} | {r['rms_abs_true']:.2f} | {v['err']:.0f} | {v['zone_r']:.0f} | {'да' if v['zone_ok'] else 'нет'} | "
                 f"{np.median(v['e90']) if v['e90'] else float('nan'):.0f} | {v['err_prior']:.0f} |")
    (OUT / "stats_real_v2.md").write_text("\n".join(L), encoding="utf-8")
    np.savez_compressed(PROC / "real_scores_v2.npz", **{f"s{k}": v["score"] for k, v in SCORES.items()},
                        **{f"p{k}": np.array([v["x"], v["y"]]) for k, v in SCORES.items()})
    print("\n".join(L[:8]))


if __name__ == "__main__":
    main()
