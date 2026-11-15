"""P6: схемы для слайдов (SVG + PNG 1920×1080, тёмный фон) → out/slides/"""
import re
import sys
sys.path.insert(0, "src")
import numpy as np
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib.patches import FancyBboxPatch, FancyArrowPatch
from PIL import Image

from gor.io import *  # noqa

OUT = ROOT / "out" / "slides"
OUT.mkdir(parents=True, exist_ok=True)
BG, FG, ACC, ACC2, MUTED = "#0d1117", "#e6edf3", "#ff7b39", "#39c5ff", "#8b949e"
plt.rcParams.update({"font.size": 20, "text.color": FG, "svg.fonttype": "none"})


def canvas(title):
    fig = plt.figure(figsize=(19.2, 10.8), dpi=100, facecolor=BG)
    ax = fig.add_axes([0, 0, 1, 1]); ax.set_xlim(0, 1920); ax.set_ylim(1080, 0); ax.axis("off")
    ax.text(80, 90, title, fontsize=44, fontweight="bold", color=FG, va="center")
    return fig, ax


def box(ax, x, y, w, h, text, color=ACC, fs=21, sub=None, sub_fs=None):
    ax.add_patch(FancyBboxPatch((x, y), w, h, boxstyle="round,pad=0,rounding_size=18",
                                fc="#161b22", ec=color, lw=3))
    ax.text(x + w / 2, y + h / 2 - (14 if sub else 0), text, ha="center", va="center", fontsize=fs,
            color=FG, fontweight="bold", wrap=True)
    if sub:
        ax.text(x + w / 2, y + h / 2 + 26, sub, ha="center", va="center", fontsize=sub_fs or fs - 7, color=MUTED)


def arrow(ax, p0, p1, color=MUTED, text=None, both=False):
    ax.add_patch(FancyArrowPatch(p0, p1, arrowstyle="<|-|>" if both else "-|>", mutation_scale=28,
                                 color=color, lw=3))
    if text:
        ax.text((p0[0] + p1[0]) / 2, (p0[1] + p1[1]) / 2 - 18, text, ha="center", fontsize=16, color=MUTED)


def image(ax, path, x, y, w, h):
    img = Image.open(path).convert("RGB")
    bb = Image.eval(img, lambda v: 255 - v).getbbox()  # обрезать белые поля
    if bb:
        img = img.crop(bb)
    im = np.array(img)
    sc = min(w / im.shape[1], h / im.shape[0])
    w2, h2 = im.shape[1] * sc, im.shape[0] * sc
    x, y, w, h = x + (w - w2) / 2, y + (h - h2) / 2, w2, h2
    ax.imshow(im, extent=[x, x + w, y + h, y], zorder=2)
    ax.add_patch(FancyBboxPatch((x, y), w, h, boxstyle="square,pad=0", fc="none", ec=MUTED, lw=1.5, zorder=3))


def save(fig, name):
    fig.savefig(OUT / f"{name}.png", facecolor=BG)
    fig.savefig(OUT / f"{name}.svg", facecolor=BG)
    plt.close(fig)


def slide_route():
    r = read_json(EXPORT / "routes.json")
    m4 = next(m for m in r["missions"] if m["id"] == "m4")
    fig, ax = canvas("Маршрут астронавта — посчитан по данным NASA")
    steps = [("Высоты NASA", "HiRISE DTM 1 м"),
             ("Слои", "уклон · камни · доза"),
             ("Цена клетки", "сек/м × (1 + штрафы)"),
             ("Поиск пути", "все порядки целей"),
             ("Проверки", "O₂ · 4 ч · возврат"),
             ("Маршрут", "+ карточка + зона")]
    w, h, gap, y = 266, 130, 33, 170
    for i, (t, s) in enumerate(steps):
        x = 80 + i * (w + gap)
        box(ax, x, y, w, h, t, color=ACC if i < 5 else ACC2, sub=s, fs=22, sub_fs=15)
        if i:
            arrow(ax, (x - gap + 2, y + h / 2), (x - 2, y + h / 2))
    image(ax, CHECK / "p3_m4.png", 80, 340, 660, 700)
    image(ax, CHECK / "p4_layers.png", 780, 340, 1060, 380)
    s = m4["summary"]
    card = (f"Миссия «{m4['name']}»\n"
            f"{s['distance_m'] / 1000:.1f} км · {s['time_min']:.0f} мин из 240\n"
            f"O₂ {s['o2_l']:.0f} л ({s['o2_pct_of_supply']:.0f}% запаса) · доза {s['dose_msv'] * 1000:.0f} мкЗв\n"
            f"макс. уклон {s['max_slope_deg']}° (запрет > 15°)\n"
            f"точка невозврата отмечена · 3 пути к укрытию")
    ax.text(780, 770, card, fontsize=24, va="top", color=FG, linespacing=1.5)
    save(fig, "route")


def slide_horizon():
    st = (ROOT / "out" / "horizon" / "stats.md").read_text(encoding="utf-8")
    med = re.search(r"Медиана ошибки: (\d+) м", st).group(1)
    p90 = re.search(r"90-й перцентиль: (\d+) м", st).group(1)
    share = re.search(r"Доля < 100 м: (\d+)%", st).group(1)
    tr = (ROOT / "out" / "horizon" / "real" / "stats_tracking.md").read_text(encoding="utf-8")
    t3 = re.search(r"3 панорамы подряд: медиана \*\*(\d+) м\*\*, < 100 м: (\d+)%", tr)
    t1 = re.search(r"1 панорама: медиана \*\*(\d+) м\*\*, < 100 м: (\d+)%", tr)
    fig, ax = canvas("Где я? Локализация по линии горизонта — без GPS")
    ax.text(80, 170, "Заранее (до выхода)", fontsize=26, color=ACC2, fontweight="bold")
    pre = [("Карта высот NASA", "HiRISE 1 м + CTX 20 м"), ("Силуэты из каждой точки", "сетка 20 м · 360° · до 40 км")]
    for i, (t, s) in enumerate(pre):
        box(ax, 80 + i * 400, 200, 360 + 40 * i, 120, t, ACC2, sub=s, fs=18, sub_fs=15)
    arrow(ax, (442, 260), (478, 260))
    ax.text(80, 400, "На Марсе (в шлеме)", fontsize=26, color=ACC, fontweight="bold")
    on = [("Оглядеться 360°", "+ акселерометр"), ("Линия горизонта", "небо / грунт"),
          ("Сравнение + шаги", "2–3 остановки"), (f"Вы здесь ± {t3.group(1)} м", f"{t3.group(2)}% точнее 100 м")]
    for i, (t, s) in enumerate(on):
        box(ax, 80 + i * 240, 430, 215, 120, t, ACC if i < 3 else "#3fb950", fs=15, sub=s, sub_fs=13)
        if i:
            arrow(ax, (80 + i * 240 - 24, 490), (80 + i * 240 - 2, 490))
    arrow(ax, (700, 322), (660, 428), color=ACC2)
    ax.text(715, 385, "база силуэтов", fontsize=15, color=ACC2)
    ax.text(80, 610, "Проверено на настоящих панорамах Perseverance", fontsize=22, color=FG, va="top")
    ax.text(80, 660, "10 стоянок ровера (NASA PDS, Navcam), место известно NASA:\n"
                     "• карта предсказывает реальный горизонт с точностью 0.1–0.5°\n"
                     f"• 1 панорама: медиана {t1.group(1)} м — на ровном дне есть «двойники»\n"
                     f"• 3 остановки + шагомер (±5%): медиана {t3.group(1)} м, {t3.group(2)}% < 100 м\n"
                     "Бонус: силуэт → открытость неба → доза и укрытия.\n"
                     "Похожий подход исследуют в NASA/JPL для роверов —\nмы применяем к астронавту.",
            fontsize=18, color=MUTED, va="top", linespacing=1.5)
    image(ax, ROOT / "out" / "horizon" / "real" / "sol0413.png", 1080, 170, 780, 420)
    image(ax, ROOT / "out" / "horizon" / "real" / "v2_sol0157.png", 1080, 640, 780, 260)
    save(fig, "horizon")


def slide_ecosystem():
    fig, ax = canvas("Экосистема ГОРИЗОНТ")
    box(ax, 740, 420, 440, 200, "Supabase", "#3fb950", fs=30, sub="astronauts · missions · events", sub_fs=18)
    box(ax, 100, 200, 460, 170, "Диспетчер", ACC, fs=28, sub="миссии · маршруты · вспышка", sub_fs=18)
    box(ax, 100, 680, 460, 170, "Корабль", ACC2, fs=28, sub="карта Марса и миссий", sub_fs=18)
    box(ax, 1360, 420, 480, 200, "VR-шлем (Quest)", ACC, fs=28, sub="путь под ногами · HUD · мини-карта", sub_fs=16)
    box(ax, 700, 760, 520, 150, "Данные NASA → export/", MUTED, fs=22, sub="рельеф · цели · маршруты · слои", sub_fs=17)
    arrow(ax, (562, 300), (738, 450), both=True)
    ax.text(680, 340, "missions, events", fontsize=17, color=MUTED)
    arrow(ax, (562, 760), (738, 600))
    ax.text(680, 700, "чтение", fontsize=17, color=MUTED)
    arrow(ax, (1182, 520), (1358, 520), both=True)
    ax.text(1270, 490, "x, y, курс, O₂", fontsize=17, color=MUTED, ha="center")
    arrow(ax, (960, 760), (960, 622), color=MUTED)
    ax.text(960, 1000, "Положение астронавта — из локализации по горизонту, без GPS",
            ha="center", fontsize=28, color=ACC, fontweight="bold")
    save(fig, "ecosystem")


if __name__ == "__main__":
    slide_route(); slide_horizon(); slide_ecosystem()
    print(sorted(p.name for p in OUT.iterdir()))
