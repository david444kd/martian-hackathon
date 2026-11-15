"""P5b: проверка «где я» на НАСТОЯЩИХ панорамах Perseverance (Navcam, PDS Imaging Node).

1. Для выбранных солов берём из PDS цилиндрическую мозаику Navcam (CYL, локальная горизонтальная
   система: азимут от севера по часовой, угол вверх) + XML с геометрией.
2. Место ровера — по номеру site/drive из имени продукта → M20_waypoints.json (NASA).
3. Выделяем линию «небо/земля» в каждом столбце → угол горизонта по азимутам.
4. Сравниваем с силуэтом, посчитанным по карте высот в той же точке (проверка модели).
5. Ищем место по базе силуэтов 50 м: (а) курс известен, (б) курс неизвестен, (в) окна 90° без курса.
"""
import re
import sys
import time
sys.path.insert(0, "src")
import numpy as np
import requests
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from numba import njit, prange
from PIL import Image
from scipy.ndimage import median_filter, uniform_filter1d

from gor.io import *  # noqa
from gor.horizon import horizons, ray_distances

import os
MASK_TOP = os.environ.get("MASK_TOP", "1") == "1"
MASK_GLARE = os.environ.get("MASK_GLARE", "0") == "1"
PDS = "https://planetarydata.jpl.nasa.gov/img/data/mars2020/mars2020_navcam_ops_mosaic"
DIR = RAW / "pano"; DIR.mkdir(exist_ok=True)
OUT = ROOT / "out" / "horizon" / "real"; OUT.mkdir(parents=True, exist_ok=True)
EYE_M = 2.0     # высота камер Navcam на мачте ровера ~2 м
SOLS = [116, 157, 180, 204, 286, 360, 389, 399, 405, 413, 420, 437, 557, 606, 709, 716]
Image.MAX_IMAGE_PIXELS = None


def get(url, path=None, tries=6):
    for k in range(tries):
        try:
            r = requests.get(url, timeout=120)
            if r.status_code == 200:
                if path:
                    path.write_bytes(r.content)
                return r
            if r.status_code == 404:
                return None
        except requests.RequestException:
            pass
        time.sleep(2 * (k + 1))
    return None


def pick_mosaic(sol):
    """Самая широкая по азимуту CYL-мозаика Navcam за сол (по XML)."""
    base = f"{PDS}/data/sol/{sol:05d}/ids/rdr/mosaic/"
    r = get(base)
    if r is None:
        return None
    names = sorted(set(re.findall(r'href="(N_[A-Z]{4}_\d{4}_(?:RAS|RZS|RAD|RAF|IOF)_\d{7}_CYL_[^"]+?)\.xml"', r.text)))
    best = None
    for n in names:
        xp = DIR / f"{n}.xml"
        if not xp.exists() and get(base + n + ".xml", xp) is None:
            continue
        g = parse_xml(xp.read_text())
        if g is None:
            continue
        cov = (g["az1"] - g["az0"]) % 360 or 360
        if best is None or cov > best[1]:
            best = (n, cov, g)
    return best


def parse_xml(t):
    f = lambda tag: float(re.search(rf"<cart:{tag}[^>]*>([-\d.eE+]+)<", t).group(1))
    try:
        g = dict(el_max=f("maximum_elevation"), el_min=f("minimum_elevation"), az0=f("start_azimuth"),
                 az1=f("stop_azimuth"), zero_line=f("zero_elevation_line"))
    except AttributeError:
        return None
    ax = [int(v) for v in re.findall(r"<elements>(\d+)</elements>", t)]
    g["lines"], g["samples"] = ax[-2], ax[-1]
    return g


def waypoint_xy(name, wps):
    m = re.search(r"_(\d{3})(\d{4})_CYL", name)
    site, drive = int(m.group(1)), int(m.group(2))
    c = [p for p in wps if p["site"] == site and p["drive"] <= drive]
    if not c:
        c = [p for p in wps if p["site"] == site]
    if not c:
        return None
    p = max(c, key=lambda p: p["drive"]) if any(p["drive"] <= drive for p in c) else min(c, key=lambda p: p["drive"])
    x, y = lonlat_to_local(p["lon"], p["lat"])
    return x, y, p["sol"], site, drive, p["drive"]


def extract_horizon(img, g):
    """Линия небо/земля: непрерывный путь через все столбцы с максимальным перепадом
    «светлое и гладкое сверху → темнее снизу» (динамическое программирование, шаг ±2 px).
    Поиск только в полосе углов [-6°, верх кадра] — без знания места."""
    a = np.asarray(img.convert("L"), dtype=np.float32)
    H, W = a.shape
    px_per_deg = H / (g["el_max"] - g["el_min"])
    r_lo = int(max(0, g["zero_line"] - g["el_max"] * px_per_deg))            # верх кадра
    r_hi = int(min(H - 2, g["zero_line"] + 6 * px_per_deg))                  # −6°
    band = a[r_lo:r_hi + 6]
    sm = uniform_filter1d(uniform_filter1d(band, 3, axis=0), 9, axis=1)
    k = 3
    above = sm[:-2 * k]; below = sm[2 * k:]
    sky_mean = uniform_filter1d(band, 11, axis=0, origin=5)[:-2 * k]   # средняя яркость 11 px над краем
    edge = above - below                                   # светлее сверху → положительно
    # небо над краем должно быть гладким и не чёрным (нет данных)
    loc = np.abs(np.diff(sm, axis=0))
    smooth_above = uniform_filter1d(loc, 2 * k + 1, axis=0)[:edge.shape[0]]
    valid = (above > 8) & (below > 3) & (sky_mean > 0.6 * above) & (sky_mean > 25)
    score = np.where(valid, edge - 0.5 * smooth_above, -5.0)
    score = np.clip(score, -5, 60)
    n, Wc = score.shape
    # ДП: acc[r, c] = score + max(acc[r±2, c-1])
    acc = score[:, 0].copy(); back = np.zeros((n, Wc), np.int8)
    for c in range(1, Wc):
        cand = np.stack([np.roll(acc, sh) for sh in (-2, -1, 0, 1, 2)])
        cand[0, -2:] = cand[1, -1:] = -1e9; cand[3, :1] = cand[4, :2] = -1e9
        j = np.argmax(cand, axis=0)
        acc = score[:, c] + cand[j, np.arange(n)]
        back[:, c] = j - 2
    path = np.zeros(Wc, int); path[-1] = int(np.argmax(acc))
    for c in range(Wc - 1, 0, -1):
        path[c - 1] = path[c] - back[path[c], c]
    path = np.clip(path, 0, n - 1)
    strength = score[path, np.arange(Wc)]
    ok = strength > 10                                      # уверенный перепад яркости
    # над линией должно быть ≥ 0.5° настоящего неба (иначе горизонт выше кадра и линия ложная)
    cols = np.arange(Wc)
    validb = band > 8
    top_valid = np.argmax(validb, axis=0)
    if MASK_TOP:
        ok &= (path - top_valid) >= 0.5 * px_per_deg
    # засветка солнцем: небо над линией почти белое → столбец не годен
    sky_above = np.array([np.median(band[max(top_valid[c], path[c] - int(px_per_deg)):max(path[c], 1), c]) if path[c] > top_valid[c] else 0 for c in cols])
    if MASK_GLARE:
        ok &= sky_above < 225
    rows = r_lo + path + k
    el_deg = (g["zero_line"] - rows) / px_per_deg
    ok &= el_deg < g["el_max"] - 0.3                       # не упирается в верх кадра
    cov = (g["az1"] - g["az0"]) % 360 or 360
    az = (g["az0"] + np.arange(W) / W * cov) % 360
    az_i = np.floor(az).astype(int)
    out = np.full(360, np.nan)
    for d in range(360):
        m = (az_i == d) & ok
        if m.sum() >= max(2, 0.5 * W / cov):
            out[d] = np.median(el_deg[m])
    if np.isfinite(out).sum() < 20:
        return None
    return out, rows.astype(float), ok


@njit(parallel=True, cache=True)
def match_masked(db, q, mask, shifts):
    """NCC по годным азимутам. db (M,360), q (360,) в рамке камеры, mask (360,) bool.
    shifts — какие повороты пробовать. Возвращает лучший NCC и поворот для каждой точки."""
    M = db.shape[0]
    idx = np.where(mask)[0]; F = idx.shape[0]
    qm = 0.0
    for k in range(F):
        qm += q[idx[k]]
    qm /= F
    qs = 0.0
    for k in range(F):
        qs += (q[idx[k]] - qm) ** 2
    qs = np.sqrt(qs)
    best = np.full(M, -2.0); bs = np.zeros(M, np.int32)
    for i in prange(M):
        for s in shifts:
            m = 0.0
            for k in range(F):
                m += db[i, (idx[k] + s) % 360]
            m /= F
            v = 0.0; cv = 0.0
            for k in range(F):
                d = db[i, (idx[k] + s) % 360] - m
                v += d * d; cv += d * (q[idx[k]] - qm)
            c = cv / (np.sqrt(v) * qs + 1e-12)
            if c > best[i]:
                best[i] = c; bs[i] = s
    return best, bs


@njit(parallel=True, cache=True)
def match_masked_rms(db, q, mask, shifts):
    """−RMS разности углов после вычитания среднего (наклон камеры = сдвиг; масштаб углов известен)."""
    M = db.shape[0]
    idx = np.where(mask)[0]; F = idx.shape[0]
    best = np.full(M, -1e9); bs = np.zeros(M, np.int32)
    for i in prange(M):
        for s in shifts:
            m = 0.0
            for k in range(F):
                m += db[i, (idx[k] + s) % 360] - q[idx[k]]
            m /= F
            e = 0.0
            for k in range(F):
                d = db[i, (idx[k] + s) % 360] - q[idx[k]] - m
                e += d * d
            sc = -np.sqrt(e / F)
            if sc > best[i]:
                best[i] = sc; bs[i] = s
    return best, bs


MATCH = match_masked_rms if (len(sys.argv) < 2 or sys.argv[1] == "rms") else match_masked


def main():
    wps = [f["properties"] for f in read_json(RAW / "nasa" / "M20_waypoints.json")["features"]]
    h1, H1, R1 = load_local_tif(PROC / "near_dtm_1m.tif")
    h5, H5, R5 = load_local_tif(PROC / "near_dtm_5m.tif")
    hc, HC, RC = load_local_tif(PROC / "ctx_dem_20m.tif")
    d = ray_distances(5.0, 40000.0, 400)
    xy = np.load(PROC / "horizons_xy.npy").reshape(-1, 2)
    db = np.degrees(horizons(xy[:, 0].copy(), xy[:, 1].copy(), h5, H5, R5, hc, HC, RC, d, 360, EYE_M)).astype(np.float64)

    res = []
    rng = np.random.default_rng(0)
    for sol in SOLS:
        pk = pick_mosaic(sol)
        if pk is None:
            print(f"sol {sol}: мозаики нет"); continue
        name, cov, g = pk
        pos = waypoint_xy(name, wps)
        if pos is None or not (abs(pos[0]) < 1950 and abs(pos[1]) < 1950):
            print(f"sol {sol}: {name} — нет точки ровера в участке"); continue
        pp = DIR / f"{name}.png"
        if not pp.exists():
            if get(f"{PDS}/browse/sol/{sol:05d}/ids/rdr/mosaic/{name}.png", pp) is None:
                print(f"sol {sol}: нет PNG"); continue
        img = Image.open(pp)
        if img.size != (g["samples"], g["lines"]):
            g = dict(g, zero_line=g["zero_line"] * img.size[1] / g["lines"], lines=img.size[1], samples=img.size[0])
        hz = extract_horizon(img, g)
        if hz is None:
            print(f"sol {sol}: горизонт не выделился"); continue
        q, rowline, okcol = hz
        mask = np.isfinite(q)
        x, y = pos[0], pos[1]
        pred = np.degrees(horizons(np.array([x]), np.array([y]), h1, H1, R1, hc, HC, RC, d, 360, EYE_M))[0]
        both = mask & np.isfinite(pred)
        rms = float(np.sqrt(np.mean(((q - q[both].mean()) - (pred - pred[both].mean()))[both] ** 2)))
        ncc_true = float(np.corrcoef(q[both], pred[both])[0, 1])
        qf = np.nan_to_num(q)
        r_known = MATCH(db, qf, mask, np.array([0]))
        r_unk = MATCH(db, qf, mask, np.arange(360))
        def summarize(r):
            j = int(np.argmax(r[0])); return j, float(np.hypot(*(xy[j] - [x, y]))), int(r[1][j])
        # режим «примерно знаю, где я»: грубая догадка = истина + 250 м в случайную сторону, поиск в радиусе 500 м
        ang = rng.uniform(0, 2 * np.pi); prior = np.array([x, y]) + 250 * np.array([np.cos(ang), np.sin(ang)])
        near_prior = np.hypot(*(xy - prior).T) <= 500
        sc = np.where(near_prior, r_unk[0], -1e9); jp = int(np.argmax(sc))
        e_prior = float(np.hypot(*(xy[jp] - [x, y])))
        jk, ek, _ = summarize(r_known)
        ju, eu, su = summarize(r_unk)
        # окна 90° без курса (как шлем): все окна с ≥ 80 годными градусами
        e90 = []
        starts = [s for s in range(0, 360, 30) if mask[(np.arange(90) + s) % 360].sum() >= 80]
        for s in starts:
            m2 = np.zeros(360, bool); m2[(np.arange(90) + s) % 360] = True; m2 &= mask
            r = MATCH(db, qf, m2, np.arange(360))
            e90.append(summarize(r)[1])
        res.append(dict(sol=sol, name=name, x=x, y=y, cov=int(mask.sum()), rms=rms, ncc_true=ncc_true,
                        err_known=ek, err_unknown=eu, err_prior=e_prior, head_err=min(su, 360 - su), e90=e90))
        print(f"sol {sol:4d} {name}: годных азимутов {mask.sum():3d}, реальный vs карта: RMS {rms:.2f}°, "
              f"NCC {ncc_true:.2f} | ошибка: курс известен {ek:.0f} м, неизвестен {eu:.0f} м (курс ±{min(su, 360 - su)}°), "
              f"с догадкой ±250 м: {e_prior:.0f} м | окна 90°: {('медиана %.0f м по %d' % (np.median(e90), len(e90))) if e90 else '—'}")

        # картинка проверки
        fig, ax = plt.subplots(2, 1, figsize=(16, 8.5), gridspec_kw=dict(height_ratios=[1.3, 1]))
        im = np.asarray(img.convert("RGB"))
        ax[0].imshow(im, aspect="auto")
        cols = np.arange(len(rowline))
        ax[0].plot(cols[okcol], rowline[okcol], "c.", ms=1)
        ax[0].set_title(f"sol {sol} · {name} · голубое — найденная линия горизонта")
        ax[0].axis("off")
        az = np.arange(360)
        ax[1].plot(az, q - np.nanmean(q[both]), "c-", lw=2, label="настоящая панорама")
        ax[1].plot(az, pred - pred[both].mean(), "--", color="orange", lw=1.5, label="посчитано по карте высот в точке ровера")
        ax[1].plot(az, db[ju] - np.mean(db[ju][both]), ":", color="lime", lw=1.5,
                   label=f"лучшее совпадение из базы (ошибка {eu:.0f} м)")
        ax[1].set_xlabel("азимут, ° (0 = север)"); ax[1].set_ylabel("угол горизонта, ° (без среднего)")
        ax[1].legend(); ax[1].set_xlim(0, 360)
        ax[1].set_title(f"реальный vs карта: RMS {rms:.2f}°, корреляция {ncc_true:.2f}")
        plt.tight_layout(); plt.savefig(OUT / f"sol{sol:04d}.png", dpi=70); plt.close()

    if not res:
        print("нет результатов"); return
    ek = np.array([r["err_known"] for r in res]); eu = np.array([r["err_unknown"] for r in res])
    e90 = np.concatenate([r["e90"] for r in res if r["e90"]]) if any(r["e90"] for r in res) else np.array([])
    lines = ["# «Где я» на настоящих панорамах Perseverance (Navcam, PDS)\n",
             f"Панорам: {len(res)}. Высота камеры {EYE_M} м. Истинное место — путевая точка NASA по site/drive.\n",
             "| сол | годных ° | реал. vs карта RMS, ° | корр. | ошибка (курс известен), м | ошибка (курс неизвестен), м | ошибка курса, ° | окна 90° (медиана), м |",
             "|---|---|---|---|---|---|---|---|"]
    for r in res:
        lines.append(f"| {r['sol']} | {r['cov']} | {r['rms']:.2f} | {r['ncc_true']:.2f} | {r['err_known']:.0f} | "
                     f"{r['err_unknown']:.0f} | {r['head_err']} | {np.median(r['e90']):.0f} ({len(r['e90'])})|" if r["e90"] else
                     f"| {r['sol']} | {r['cov']} | {r['rms']:.2f} | {r['ncc_true']:.2f} | {r['err_known']:.0f} | "
                     f"{r['err_unknown']:.0f} | {r['head_err']} | — |")
    ep = np.array([r["err_prior"] for r in res])
    lines += ["", f"- С грубой догадкой (±250 м, поиск в радиусе 500 м, курс неизвестен): медиана **{np.median(ep):.0f} м** "
                  f"(сама догадка ошибалась на 250 м), < 100 м: {np.mean(ep < 100) * 100:.0f}%"]
    lines += [f"- Курс известен: медиана ошибки **{np.median(ek):.0f} м**, < 100 м: {np.mean(ek < 100) * 100:.0f}%",
              f"- Курс неизвестен (весь видимый круг): медиана **{np.median(eu):.0f} м**, < 100 м: {np.mean(eu < 100) * 100:.0f}%"]
    if len(e90):
        lines.append(f"- Окна 90° без курса (как шлем), {len(e90)} шт.: медиана **{np.median(e90):.0f} м**, < 100 м: {np.mean(e90 < 100) * 100:.0f}%")
    lines.insert(1, f"Сравнение силуэтов: {'RMS углов после вычитания среднего' if MATCH is match_masked_rms else 'NCC (нормированная корреляция)'}.\n")
    (OUT / ("stats_real.md" if MATCH is match_masked_rms else "stats_real_ncc.md")).write_text("\n".join(lines), encoding="utf-8")
    print("\n".join(lines[-3:]))


if __name__ == "__main__":
    main()
