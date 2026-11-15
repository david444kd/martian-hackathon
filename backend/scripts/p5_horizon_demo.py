"""P5: демо локализации по горизонту на синтетике → out/horizon/*

«Фото» = силуэт по детальной карте 1 м в случайной точке + шум + наклон камеры + случайный
поворот (компаса нет), видно только 90°. Поиск — по базе силуэтов 50 м (карта 5 м):
скольжение окна 90° по 360°, нормированная корреляция (NCC), максимум.
"""
import sys, time
sys.path.insert(0, "src")
import numpy as np
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import imageio.v2 as imageio
from numba import njit, prange
from PIL import Image

from gor.io import *  # noqa
from gor.horizon import horizons, ray_distances, EYE_M
from gor.viz import extent

OUT = ROOT / "out" / "horizon"
OUT.mkdir(parents=True, exist_ok=True)
rng = np.random.default_rng(42)
N_TEST = 50
FOV_DEG = 90
NOISE_DEG = 0.15        # шум выделения линии горизонта на фото
TILT_MAX_DEG = 2.0      # неизвестный наклон камеры (снимается нормировкой)
D_MIN_M = 5.0           # ближе 5 м — грунт под ногами, не горизонт


@njit(parallel=True, cache=True)
def match(db, q):
    """db (M,360), q (FOV,) нормированный → лучший NCC и сдвиг для каждой точки базы."""
    M = db.shape[0]; F = q.shape[0]
    best = np.full(M, -2.0); best_s = np.zeros(M, np.int32)
    for i in prange(M):
        for s in range(360):
            m = 0.0
            for k in range(F):
                m += db[i, (s + k) % 360]
            m /= F
            v = 0.0; cov = 0.0
            for k in range(F):
                d = db[i, (s + k) % 360] - m
                v += d * d; cov += d * q[k]
            c = cov / (np.sqrt(v * F) + 1e-12)
            if c > best[i]:
                best[i] = c; best_s[i] = s
    return best, best_s


@njit(parallel=True, cache=True)
def match_rms(db, q):
    """Вариант: RMS разности после вычитания среднего (наклон камеры = сдвиг), масштаб углов известен.
    Возвращает score = −RMS (больше — лучше) и сдвиг."""
    M = db.shape[0]; F = q.shape[0]
    best = np.full(M, -1e9); best_s = np.zeros(M, np.int32)
    for i in prange(M):
        for s in range(360):
            m = 0.0
            for k in range(F):
                m += db[i, (s + k) % 360] - q[k]
            m /= F
            e = 0.0
            for k in range(F):
                d = db[i, (s + k) % 360] - q[k] - m
                e += d * d
            sc = -np.sqrt(e / F)
            if sc > best[i]:
                best[i] = sc; best_s[i] = s
    return best, best_s


@njit(parallel=True, cache=True)
def nearest_lookalike(db, xy, min_dist):
    """Для каждой точки: максимальный NCC (360°, без поворота) с точкой дальше min_dist."""
    M = db.shape[0]
    out = np.full(M, -2.0); arg = np.zeros(M, np.int64)
    for i in prange(M):
        for j in range(M):
            dx = xy[i, 0] - xy[j, 0]; dy = xy[i, 1] - xy[j, 1]
            if dx * dx + dy * dy < min_dist * min_dist:
                continue
            c = 0.0
            for k in range(db.shape[1]):
                c += db[i, k] * db[j, k]
            c /= db.shape[1]
            if c > out[i]:
                out[i] = c; arg[i] = j
    return out, arg


def znorm(a, axis=-1):
    a = a - a.mean(axis=axis, keepdims=True)
    return a / (a.std(axis=axis, keepdims=True) + 1e-12)


METHOD = sys.argv[1] if len(sys.argv) > 1 else "ncc"


def main():
    h1, H1, R1 = load_local_tif(PROC / "near_dtm_1m.tif")
    h5, H5, R5 = load_local_tif(PROC / "near_dtm_5m.tif")
    hc, HC, RC = load_local_tif(PROC / "ctx_dem_20m.tif")
    d = ray_distances(D_MIN_M, 40000.0, 400)
    xy = np.load(PROC / "horizons_xy.npy").reshape(-1, 2)
    # база с тем же минимальным расстоянием луча, что и фото
    db_rad = horizons(xy[:, 0].copy(), xy[:, 1].copy(), h5, H5, R5, hc, HC, RC, d, 360, EYE_M)
    db = np.degrees(db_rad).astype(np.float64)
    np.save(PROC / "horizons.npy", db_rad.reshape(80, 80, 360))

    # тестовые точки: случайная клетка базы (не у края) + случайный сдвиг внутри клетки 50 м
    cand = np.where((np.abs(xy[:, 0]) < 1800) & (np.abs(xy[:, 1]) < 1800))[0]
    cells = rng.choice(cand, N_TEST, replace=False)
    true_xy = xy[cells] + rng.uniform(-25, 25, (N_TEST, 2))
    photo_full = np.degrees(horizons(true_xy[:, 0].copy(), true_xy[:, 1].copy(), h1, H1, R1, hc, HC, RC,
                                     d, 360, EYE_M))
    res = []
    t0 = time.time()
    for i in range(N_TEST):
        heading = int(rng.integers(0, 360))
        q = np.roll(photo_full[i], -heading)[:FOV_DEG]
        q = q + rng.normal(0, NOISE_DEG, FOV_DEG) + rng.uniform(-TILT_MAX_DEG, TILT_MAX_DEG)
        if METHOD == "ncc":
            best, best_s = match(db, znorm(q))
        else:
            best, best_s = match_rms(db, q - q.mean())
        j = int(np.argmax(best))
        err = float(np.hypot(*(xy[j] - true_xy[i])))
        cell_err = float(np.hypot(*(xy[cells[i]] - true_xy[i])))
        res.append(dict(i=i, true=true_xy[i], found=xy[j], err_m=err, ncc=float(best[j]),
                        heading=heading, heading_found=int(best_s[j]), ncc_map=best.reshape(80, 80),
                        q=q, db_best=np.roll(db[j], -best_s[j])[:FOV_DEG], cell_floor_m=cell_err))
    print(f"поиск: {(time.time() - t0) / N_TEST:.2f} с на фото")

    err = np.array([r["err_m"] for r in res])
    floor = np.array([r["cell_floor_m"] for r in res])
    hd = np.array([abs((r["heading"] - r["heading_found"] + 180) % 360 - 180) for r in res])
    ok = err < 100
    stats = (f"# Локализация по горизонту — синтетический тест\n\n"
             f"- Тестов: {N_TEST}; обзор {FOV_DEG}°, шум линии {NOISE_DEG}°, наклон камеры до ±{TILT_MAX_DEG}°, курс неизвестен\n"
             f"- «Фото»: силуэт по HiRISE 1 м (+CTX 20 м даль), высота глаз {EYE_M} м; база: сетка 50 м по карте 5 м\n"
             f"- **Медиана ошибки: {np.median(err):.0f} м**, 90-й перцентиль: {np.percentile(err, 90):.0f} м\n"
             f"- **Доля < 100 м: {ok.mean() * 100:.0f}%** ({ok.sum()}/{N_TEST})\n"
             f"- Нижняя граница из-за шага базы 50 м (расстояние до ближайшего узла): медиана {np.median(floor):.0f} м\n"
             f"- Ошибка курса (где позиция < 100 м): медиана {np.median(hd[ok]) if ok.any() else float('nan'):.0f}°\n\n"
             f"Это синтетика: «фото» построено из той же карты высот (детальнее, чем база). "
             f"Реальное фото Perseverance (Navcam/Mastcam-Z) — следующий шаг.\n\n"
             f"| # | x, м | y, м | ошибка, м | NCC |\n|---|---|---|---|---|\n" +
             "\n".join(f"| {r['i']} | {r['true'][0]:.0f} | {r['true'][1]:.0f} | {r['err_m']:.0f} | {r['ncc']:.3f} |" for r in res))
    (OUT / "stats.md").write_text(stats, encoding="utf-8")
    print(stats.split("| #")[0])

    # 5 картинок: 3 удачных + 2 худших (честно)
    order = np.argsort(err)
    show = list(order[[5, 15, 25]]) + list(order[-2:])
    tex = np.array(Image.open(EXPORT / "terrain" / "near_texture_2048.jpg"))
    frames = []
    for k, ii in enumerate(show):
        r = res[ii]
        fig = plt.figure(figsize=(14, 7), facecolor="#111")
        ax = fig.add_axes([0.03, 0.08, 0.45, 0.85])
        ax.imshow(tex, extent=extent(2000))
        im = ax.imshow(r["ncc_map"], extent=extent(2000), cmap="inferno", alpha=0.6, vmin=0, vmax=1)
        ax.plot(*r["true"], "o", ms=14, mfc="none", mec="cyan", mew=3, label="истинная точка")
        ax.plot(*r["found"], "x", ms=14, color="lime", mew=3, label="найдено")
        ax.legend(loc="lower left", fontsize=11)
        ax.set_title(f"Совпадение силуэтов (NCC). Ошибка {r['err_m']:.0f} м", color="w", fontsize=14)
        ax.tick_params(colors="w")
        a2 = fig.add_axes([0.55, 0.55, 0.42, 0.35], facecolor="#222")
        az = np.arange(FOV_DEG)
        a2.plot(az, r["q"] - r["q"].mean(), "c-", lw=2, label="«фото» (90°, шум)")
        a2.plot(az, r["db_best"] - r["db_best"].mean(), "--", color="lime", lw=2, label="лучший из базы")
        a2.set_xlabel("азимут в кадре, °", color="w"); a2.set_ylabel("угол горизонта, °", color="w")
        a2.tick_params(colors="w"); a2.legend(fontsize=10)
        a2.set_title(f"курс: истинный {r['heading']}°, найден {r['heading_found']}°", color="w")
        fig.text(0.55, 0.3, f"Случай {k + 1}/5\nМедиана ошибки по {N_TEST} тестам: {np.median(err):.0f} м\n"
                            f"< 100 м: {ok.mean() * 100:.0f}%\nСинтетика (карта HiRISE), не реальное фото",
                 color="w", fontsize=15, va="top")
        p = OUT / f"heatmap_{k + 1}.png"
        fig.savefig(p, dpi=100, facecolor=fig.get_facecolor()); plt.close(fig)
        frames.append(imageio.imread(p))
    imageio.mimsave(OUT / "horizon_demo.gif", frames, duration=2000, loop=0)

    # уникальность горизонта
    dbn = znorm(db)
    sim, arg = nearest_lookalike(dbn, xy, 100.0)
    dist = np.hypot(*(xy[arg] - xy).T)
    fig, ax = plt.subplots(1, 2, figsize=(16, 8))
    ax[0].imshow(tex, extent=extent(2000))
    im = ax[0].imshow(sim.reshape(80, 80), extent=extent(2000), cmap="RdYlGn_r", alpha=0.65, vmin=0.8, vmax=1)
    plt.colorbar(im, ax=ax[0], shrink=0.8, label="макс. сходство с точкой дальше 100 м (NCC, 360°)")
    ax[0].set_title("Где горизонт неуникален (красное — есть двойник)")
    ax[1].imshow(tex, extent=extent(2000))
    im = ax[1].imshow(dist.reshape(80, 80), extent=extent(2000), cmap="viridis", alpha=0.65)
    plt.colorbar(im, ax=ax[1], shrink=0.8, label="расстояние до самого похожего двойника, м")
    ax[1].set_title("Как далеко двойник")
    plt.tight_layout(); plt.savefig(OUT / "uniqueness.png", dpi=80); plt.close()
    print("уникальность: NCC двойника медиана", np.median(sim).round(3), " доля >0.98:", (sim > 0.98).mean().round(3))


if __name__ == "__main__":
    main()
