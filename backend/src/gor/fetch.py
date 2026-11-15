"""Надёжная выборка окна из несжатого TIFF с полосами по HTTP Range (с повторами).
GDAL /vsicurl/ на нашей сети обрывался; здесь каждая строка — отдельный короткий запрос."""
import struct
import time
from concurrent.futures import ThreadPoolExecutor

import numpy as np
import requests

TYPES = {3: ("H", 2), 4: ("I", 4), 16: ("Q", 8)}


def _get(url, a, b, tries=8):
    for k in range(tries):
        try:
            r = requests.get(url, headers={"Range": f"bytes={a}-{b}"}, timeout=60)
            if r.status_code == 206 and len(r.content) == b - a + 1:
                return r.content
        except requests.RequestException:
            pass
        time.sleep(1.5 * (k + 1))
    raise IOError(f"range {a}-{b} failed")


def strip_layout(url):
    hdr = _get(url, 0, 15)
    bo = "<" if hdr[:2] == b"II" else ">"
    magic = struct.unpack(bo + "H", hdr[2:4])[0]
    big = magic == 43
    ifd_off = struct.unpack(bo + "Q", hdr[8:16])[0] if big else struct.unpack(bo + "I", hdr[4:8])[0]
    n_sz, ent_sz = (8, 20) if big else (2, 12)
    nb = _get(url, ifd_off, ifd_off + n_sz - 1)
    n = struct.unpack(bo + ("Q" if big else "H"), nb)[0]
    ents = _get(url, ifd_off + n_sz, ifd_off + n_sz + n * ent_sz - 1)
    tags = {}
    for i in range(n):
        e = ents[i * ent_sz:(i + 1) * ent_sz]
        tag, typ = struct.unpack(bo + "HH", e[:4])
        cnt = struct.unpack(bo + ("Q" if big else "I"), e[4:12] if big else e[4:8])[0]
        val = e[12:20] if big else e[8:12]
        tags[tag] = (typ, cnt, val)

    def arr(tag):
        typ, cnt, val = tags[tag]
        f, s = TYPES[typ]
        if cnt * s <= len(val):
            return list(struct.unpack(bo + f * cnt, val[:cnt * s]))
        off = struct.unpack(bo + ("Q" if big else "I"), val)[0]
        raw = _get(url, off, off + cnt * s - 1)
        return list(struct.unpack(bo + f * cnt, raw))

    width = arr(256)[0]
    height = arr(257)[0]
    rps = arr(278)[0] if 278 in tags else height
    comp = arr(259)[0]
    bps = arr(258)[0]
    assert comp == 1, "только несжатые"
    return dict(width=width, height=height, rows_per_strip=rps, bps=bps, byteorder=bo,
                offsets=np.array(arr(273), dtype=np.int64))


def read_window_rows(url, lay, row0, nrows, col0, ncols, dtype, workers=12, row_step=1):
    assert lay["rows_per_strip"] == 1
    bpp = lay["bps"] // 8
    rows = list(range(row0, row0 + nrows, row_step))
    out = np.empty((len(rows), ncols), dtype=np.dtype(dtype).newbyteorder(lay["byteorder"]))

    def one(i):
        off = int(lay["offsets"][rows[i]]) + col0 * bpp
        out[i] = np.frombuffer(_get(url, off, off + ncols * bpp - 1), dtype=out.dtype)

    t0 = time.time()
    with ThreadPoolExecutor(workers) as ex:
        for k, _ in enumerate(ex.map(one, range(len(rows)))):
            if k % 500 == 0:
                print(f"  rows {k}/{len(rows)}  {time.time() - t0:.0f}s", flush=True)
    return out.astype(dtype)
