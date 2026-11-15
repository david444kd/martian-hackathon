"""P5d: отслеживание на ходу — совместная локализация по 2–3 настоящим панорамам подряд.
Смещение между стоянками известно «по шагам» с ошибкой ODO_ERR от пройденного (случайная сторона).
Карты невязок каждой панорамы — из p5c (абсолютные углы + обрезка, курс неизвестен)."""
import sys; sys.path.insert(0, "src")
import numpy as np
from gor.io import *

ODO_ERR = 0.05; GRID_M = 20.0; N = 200; CLIP = 1.0; TRIALS = 50
z = np.load(PROC / "real_scores_v2.npz")
sols = sorted(int(k[1:]) for k in z.files if k.startswith("s"))
S = {s: z[f"s{s}"].reshape(N, N) for s in sols}; P = {s: z[f"p{s}"] for s in sols}
c = -2000 + GRID_M * (np.arange(N) + 0.5)
X, Y = np.meshgrid(c, c[::-1])
rng = np.random.default_rng(1)


def shifted(score, dx, dy):
    """score(P + d) на той же сетке; вне участка — штраф CLIP."""
    di, dj = -int(round(dy / GRID_M)), int(round(dx / GRID_M))
    out = np.full_like(score, CLIP)
    src = score[max(0, di):N + min(0, di), max(0, dj):N + min(0, dj)]
    out[max(0, -di):N + min(0, -di), max(0, -dj):N + min(0, -dj)] = src
    return out


def locate(chain, noisy=True):
    last = chain[-1]; J = S[last].copy()
    for s in chain[:-1]:
        d = P[s] - P[last]
        if noisy:
            L = np.hypot(*d); a = rng.uniform(0, 2 * np.pi)
            d = d + ODO_ERR * L * np.array([np.cos(a), np.sin(a)]) * abs(rng.normal())
        J += shifted(S[s], *d)
    i = np.unravel_index(np.argmin(J), J.shape)
    return float(np.hypot(X[i] - P[last][0], Y[i] - P[last][1]))


lines = ["# Отслеживание на ходу: несколько настоящих панорам + смещение по шагам\n",
         f"Ошибка «шагомера» {ODO_ERR * 100:.0f}% от пройденного, {TRIALS} случайных прогонов на цепочку. "
         "Курс неизвестен. Ошибка — для последней стоянки цепочки.\n",
         "| цепочка (солы) | пройдено, м | 1 панорама, м | цепочка, медиана м | цепочка, < 100 м |", "|---|---|---|---|---|"]
allk = {1: [], 2: [], 3: []}
for k in (2, 3):
    for i in range(len(sols) - k + 1):
        ch = sols[i:i + k]
        dist = sum(np.hypot(*(P[ch[j + 1]] - P[ch[j]])) for j in range(k - 1))
        e1 = locate([ch[-1]], noisy=False)
        ek = np.array([locate(ch) for _ in range(TRIALS)])
        allk[k].append(ek)
        lines.append(f"| {' → '.join(map(str, ch))} | {dist:.0f} | {e1:.0f} | {np.median(ek):.0f} | {np.mean(ek < 100) * 100:.0f}% |")
e1 = np.array([locate([s], noisy=False) for s in sols])
lines += ["", f"- 1 панорама: медиана **{np.median(e1):.0f} м**, < 100 м: {np.mean(e1 < 100) * 100:.0f}%"]
for k in (2, 3):
    a = np.concatenate(allk[k]); lines.append(f"- {k} панорамы подряд: медиана **{np.median(a):.0f} м**, < 100 м: {np.mean(a < 100) * 100:.0f}%")
(ROOT / "out" / "horizon" / "real" / "stats_tracking.md").write_text("\n".join(lines), encoding="utf-8")
print("\n".join(lines))
