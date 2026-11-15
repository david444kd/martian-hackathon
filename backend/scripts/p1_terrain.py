"""P1: рельеф и текстуры для three.js → export/terrain/*, проверки out/check/p1_*.png

Запуск: PYTHONPATH=src .venv/bin/python scripts/p1_terrain.py [dem|tex|all]
"""
import sys, json
from datetime import datetime, timezone

import numpy as np
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from PIL import Image
from rasterio.fill import fillnodata
from rasterio.warp import Resampling
from scipy.ndimage import gaussian_filter, map_coordinates

sys.path.insert(0, "src")
from gor.io import *  # noqa
from gor.viz import hillshade, stretch, extent

NEAR_HALF_M = NEAR_SIZE_M / 2
FAR_HALF_M = FAR_SIZE_M / 2
CTX_HALF_M = 42000.0  # для силуэтов горизонта нужен рельеф до ~40 км от любой точки участка
OUT = EXPORT / "terrain"
OUT.mkdir(parents=True, exist_ok=True)


def nodes(half_m, n):
    return np.linspace(-half_m, half_m, n)


def sample_nodes(grid, grid_half_m, grid_res_m, node_half_m, n, sigma_px):
    """Высоты в узлах сетки three.js (узлы ровно от -half до +half), север — первая строка."""
    g = gaussian_filter(grid, sigma_px) if sigma_px > 0 else grid
    xs = nodes(node_half_m, n)
    ys = xs[::-1]
    X, Y = np.meshgrid(xs, ys)
    col = (X + grid_half_m) / grid_res_m - 0.5
    row = (grid_half_m - Y) / grid_res_m - 0.5
    return map_coordinates(g, [row, col], order=1, mode="nearest").astype(np.float64)


def save_height_png(path, h, h_min, h_max):
    v = np.round((h - h_min) / (h_max - h_min) * 65535).clip(0, 65535).astype(np.uint16)
    Image.fromarray(v).save(path)  # PIL сохраняет uint16 как 16-битный grayscale PNG
    v.astype("<u2").tofile(str(path).replace(".png", ".u16"))  # те же значения, сырой little-endian


def fill_holes(a, name):
    mask = np.isfinite(a)
    frac = 1 - mask.mean()
    if frac > 0:
        a = fillnodata(np.where(mask, a, 0).astype("float32"), mask=mask.astype("uint8"),
                       max_search_distance=400, smoothing_iterations=0)
    left = np.isnan(a).mean() if np.isnan(a).any() else 0
    print(f"{name}: дыр {frac * 100:.3f}%  (после заполнения {left * 100:.3f}%)")
    return a, mask, frac


def stage_dem():
    # --- ближний 1 м
    h1 = read_to_local(RAW / "hirise_dtm_window.tif", NEAR_HALF_M, 1.0, Resampling.bilinear)
    h1, m1, frac1 = fill_holes(h1, "HiRISE 1 м")
    save_local_tif(PROC / "near_dtm_1m.tif", h1.astype("float32"), NEAR_HALF_M, 1.0)
    save_local_tif(PROC / "near_nodata_1m.tif", (~m1).astype("uint8"), NEAR_HALF_M, 1.0)
    h5 = h1.reshape(800, 5, 800, 5).mean(axis=(1, 3))
    save_local_tif(PROC / "near_dtm_5m.tif", h5.astype("float32"), NEAR_HALF_M, 5.0)
    nod5 = (~m1).reshape(800, 5, 800, 5).mean(axis=(1, 3)) > 0.5
    save_local_tif(PROC / "near_nodata_5m.tif", nod5.astype("uint8"), NEAR_HALF_M, 5.0)

    # --- дальний CTX 20 м (JPL, весь кратер)
    hc = read_to_local(RAW / "M20_JezeroCrater_CTXDEM_20m.tif", CTX_HALF_M, 20.0, Resampling.bilinear)
    # дыры CTX (запад дальше ~24 км) — из MOLA 463 м, с поправкой на средний сдвиг в зоне перекрытия
    hm = read_to_local(RAW / "mola_463m_window.tif", CTX_HALF_M, 20.0, Resampling.cubic, src_nodata=-32768)
    mc = np.isfinite(hc)
    fracc = 1 - mc.mean()
    mola_off = float(np.nanmedian((hc - hm)[mc]))
    hm = hm + mola_off
    # плавный шов 1 км: вес CTX растёт от края дыры
    from scipy.ndimage import distance_transform_edt
    w = np.clip(distance_transform_edt(mc) * 20.0 / 1000.0, 0, 1)
    hc = np.where(mc, w * hc + (1 - w) * hm, hm)
    print(f"CTX 20 м: дыр {fracc * 100:.2f}% → MOLA (сдвиг MOLA→CTX {mola_off:+.1f} м)")
    hc, _, _ = fill_holes(hc, "CTX+MOLA")
    save_local_tif(PROC / "ctx_dem_20m.tif", hc.astype("float32"), CTX_HALF_M, 20.0)

    # --- узлы для three.js
    near = sample_nodes(h1, NEAR_HALF_M, 1.0, NEAR_HALF_M, 1025, sigma_px=1.5)
    near513 = sample_nodes(h1, NEAR_HALF_M, 1.0, NEAR_HALF_M, 513, sigma_px=3.0)
    far = sample_nodes(hc, CTX_HALF_M, 20.0, FAR_HALF_M, 513, sigma_px=1.5)

    # Сдвиг CTX относительно HiRISE на ближнем участке (разные DEM)
    ctx_on_near = sample_nodes(hc, CTX_HALF_M, 20.0, NEAR_HALF_M, 201, 0)
    hir_on_near = sample_nodes(h1, NEAR_HALF_M, 1.0, NEAR_HALF_M, 201, 10)
    d = ctx_on_near - hir_on_near
    print(f"CTX − HiRISE на ближнем участке: медиана {np.median(d):.2f} м, |d| p95 {np.percentile(np.abs(d), 95):.2f} м")

    # Внутри ближнего квадрата опускаем дальний рельеф под ближний, чтобы не протыкал
    xs = nodes(FAR_HALF_M, 513)
    X, Y = np.meshgrid(xs, xs[::-1])
    inner = (np.abs(X) <= NEAR_HALF_M + 80) & (np.abs(Y) <= NEAR_HALF_M + 80)
    near_on_far = sample_nodes(h1, NEAR_HALF_M, 1.0, FAR_HALF_M, 513, 0)  # nearest-краевые вне — не используем
    far_drop_m = 3.0
    far_adj = far.copy()
    far_adj[inner] = np.minimum(far[inner], near_on_far[inner]) - far_drop_m

    h_ref = float(np.floor(near.min()))
    nmin, nmax = float(near.min()), float(near.max())
    n5min, n5max = float(near513.min()), float(near513.max())
    fmin, fmax = float(far_adj.min()), float(far_adj.max())
    save_height_png(OUT / "near_height.png", near, nmin, nmax)
    save_height_png(OUT / "near_height_513.png", near513, n5min, n5max)
    save_height_png(OUT / "far_height.png", far_adj, fmin, fmax)

    meta = {
        "near": {"size_m": NEAR_SIZE_M, "px": 1025, "h_min": round(nmin, 3), "h_max": round(nmax, 3),
                 "h_ref": h_ref, "center_lon": round(float(CENTER_LON), 7),
                 "center_lat": round(float(CENTER_LAT), 7),
                 "px_513": {"file": "near_height_513.png", "h_min": round(n5min, 3), "h_max": round(n5max, 3)},
                 "texture": ["near_texture_4096.jpg", "near_texture_2048.jpg"]},
        "far": {"size_m": FAR_SIZE_M, "px": 513, "h_min": round(fmin, 3), "h_max": round(fmax, 3),
                "texture": "far_texture_2048.jpg",
                "inner_drop_note": f"inside near square (+80 m) far heights = min(far, near) − {far_drop_m} m so the far mesh never pokes through"},
        "h_note": "pixel → height: h_abs = h_min + v/65535·(h_max − h_min);  h (local) = h_abs − near.h_ref. "
                  "Heights are metres above Mars areoid (MOLA geoid), same datum for near & far.",
        "crs_note": "x=east, y=north, metres from near-center; three.js: (x, h, -y). PNG row 0 = north edge, col 0 = west edge.",
        "projection": LOCAL_CRS.to_proj4(),
        "lander": dict(zip(("x", "y"), [round(float(v), 2) for v in lonlat_to_local(LANDER_LON, LANDER_LAT)])),
        "sources": {"near": URL_HIRISE_DTM, "far": URL_CTX_DEM},
        "nodata_filled_pct": {"near": round(frac1 * 100, 3), "far_ctx": round(fracc * 100, 3)},
        "ctx_minus_hirise_median_m": round(float(np.median(d)), 2),
        "generated": datetime.now(timezone.utc).isoformat(timespec="seconds"),
    }
    write_json(OUT / "meta.json", meta)

    # --- проверка: отмывка
    fig, ax = plt.subplots(1, 2, figsize=(16, 8))
    ax[0].imshow(hillshade(h1[::2, ::2], 2.0), cmap="gray", extent=extent(NEAR_HALF_M))
    ax[0].imshow(np.where(m1[::2, ::2], np.nan, 1), cmap="autumn", alpha=0.8, extent=extent(NEAR_HALF_M))
    lx, ly = lonlat_to_local(LANDER_LON, LANDER_LAT)
    ax[0].plot(lx, ly, "c*", ms=14)
    ax[0].set_title(f"Ближний HiRISE 1 м, отмывка. Дыры (красн.) {frac1 * 100:.2f}% — заполнены")
    ax[1].imshow(hillshade(far_adj, FAR_SIZE_M / 512, z=2), cmap="gray", extent=extent(FAR_HALF_M))
    ax[1].plot([-2000, 2000, 2000, -2000, -2000], [-2000, -2000, 2000, 2000, -2000], "y-")
    ax[1].set_title("Дальний CTX 20 м → 513 узлов (жёлтый — ближний участок)")
    for a in ax:
        a.set_xlabel("x, м (восток)"); a.set_ylabel("y, м (север)")
    plt.tight_layout(); plt.savefig(CHECK / "p1_hillshade.png", dpi=90); plt.close()

    # проверка декодирования PNG
    v = np.array(Image.open(OUT / "near_height.png")).astype(float)
    back = nmin + v / 65535 * (nmax - nmin)
    print("near PNG roundtrip max err, м:", np.abs(back - near).max(), " dtype", Image.open(OUT / "near_height.png").mode)
    print(json.dumps({k: meta[k] for k in ("near", "far", "lander")}, ensure_ascii=False))


def stage_tex():
    import rasterio
    # --- ближняя текстура: HiRISE орто 25 см (окно, каждая 2-я строка) → 4096
    for n in (4096, 2048):
        res = NEAR_SIZE_M / n
        t = read_to_local(RAW / "hirise_ortho_window_rowstep2.tif", NEAR_HALF_M, res,
                          Resampling.average, dtype="float32", src_nodata=0)
        t[t == 0] = np.nan
        miss = np.isnan(t).mean()
        if n == 4096:
            np.save(PROC / "near_ortho_4096.npy", t.astype("float32"))
        g = stretch(t, 0.5, 99.5)
        g = np.nan_to_num(g, nan=0.0)
        rgb = mars_tint(g)
        Image.fromarray(rgb).save(OUT / f"near_texture_{n}.jpg", quality=88, optimize=True)
        print(f"near_texture_{n}: пусто {miss * 100:.3f}%")

    # --- проверка совпадения текстуры и рельефа
    h1, _, _ = load_local_tif(PROC / "near_dtm_1m.tif")
    hs = hillshade(h1[::2, ::2], 2.0)
    tex = np.array(Image.open(OUT / "near_texture_4096.jpg").convert("L")).astype(float) / 255
    fig, ax = plt.subplots(1, 2, figsize=(18, 9))
    ax[0].imshow(hs, cmap="gray", extent=extent(NEAR_HALF_M))
    ax[0].imshow(tex, cmap="gray", alpha=0.5, extent=extent(NEAR_HALF_M))
    ax[0].set_title("Текстура 50% поверх отмывки — весь участок")
    # крупный план 400×400 м: шахматка отмывка/снимок
    c0, c1 = 1600, 2000  # пиксели 1 м: x от -400 до 0, y от 400 до 0
    hs_z = hillshade(h1[c0:c1, c0:c1], 1.0)
    tz = tex[int(c0 * 1.024):int(c1 * 1.024), int(c0 * 1.024):int(c1 * 1.024)]
    tz = np.array(Image.fromarray((tz * 255).astype(np.uint8)).resize(hs_z.shape[::-1]))/255
    chk = (np.add.outer(np.arange(400) // 50, np.arange(400) // 50) % 2).astype(bool)
    ax[1].imshow(np.where(chk, hs_z, tz), cmap="gray", extent=[-400, 0, 0, 400])
    ax[1].set_title("Крупно 400 м: шахматка отмывка/снимок — края кратеров должны продолжаться")
    plt.tight_layout(); plt.savefig(CHECK / "p1_overlay.png", dpi=90); plt.close()

    # --- дальняя текстура: CTX орто 5 м (JPL) → 2048
    src = RAW / "M20_JezeroCrater_CTXortho_mosaic_5m.tif"
    if src.stat().st_size != 359599280:
        print("CTX орто ещё не докачан — дальняя текстура пропущена")
        return
    t = read_to_local(src, FAR_HALF_M, FAR_SIZE_M / 2048, Resampling.average, dtype="float32", src_nodata=0)
    t[t == 0] = np.nan
    print(f"far_texture: пусто {np.isnan(t).mean() * 100:.3f}%")
    g = np.nan_to_num(stretch(t, 0.5, 99.5), nan=0.5)
    Image.fromarray(mars_tint(g)).save(OUT / "far_texture_2048.jpg", quality=88, optimize=True)

    far = np.array(Image.open(OUT / "far_texture_2048.jpg"))
    fh = np.array(Image.open(OUT / "far_height.png")).astype(float)
    fig, ax = plt.subplots(1, 2, figsize=(16, 8))
    ax[0].imshow(far, extent=extent(FAR_HALF_M)); ax[0].set_title("far_texture_2048")
    ax[1].imshow(hillshade(fh, 78.125, z=0.05), cmap="gray", extent=extent(FAR_HALF_M))
    ax[1].imshow(far, alpha=0.45, extent=extent(FAR_HALF_M)); ax[1].set_title("far: текстура поверх отмывки")
    plt.tight_layout(); plt.savefig(CHECK / "p1_far_overlay.png", dpi=80); plt.close()


def mars_tint(g):
    """Серый панхром → «марсианская» палитра (только косметика, яркость сохраняется)."""
    dark = np.array([45, 28, 20], float)
    mid = np.array([170, 110, 70], float)
    light = np.array([240, 205, 165], float)
    g = g[..., None]
    rgb = np.where(g < 0.5, dark + (mid - dark) * (g / 0.5), mid + (light - mid) * ((g - 0.5) / 0.5))
    return rgb.clip(0, 255).astype(np.uint8)


if __name__ == "__main__":
    pass
    what = sys.argv[1] if len(sys.argv) > 1 else "all"
    if what in ("dem", "all"):
        stage_dem()
    if what in ("tex", "all"):
        stage_tex()
