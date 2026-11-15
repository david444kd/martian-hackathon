# ГОРИЗОНТ — данные и алгоритмы (бэк)

Офлайн-пайплайн на Python. Он берёт открытые данные NASA/USGS по кратеру Jezero и делает из них
статические файлы для фронта: рельеф, текстуры, научные цели, маршруты, слои. Здесь же — локализация по горизонту.
Сервер не нужен: результат — файлы в `export/`.

| папка | что |
|---|---|
| `export/` | **готовые данные для фронта** — формат и система координат в `export/README.md` |
| `out/` | отчёт (`out/REPORT.md`), картинки проверки, слайды, результаты «где я» |
| `scripts/` | шаги пайплайна `p0…p6` |
| `src/gor/` | библиотека: чтение данных, слои, маршрутизация, силуэты горизонта |
| `viewer/` | простой 3D-просмотрщик данных (three.js) |
| `ASSUMPTIONS.md` | все допущения и источники чисел |
| `CLAUDE.md` | исходное ТЗ |

## Запуск
```bash
python3.12 -m venv .venv && .venv/bin/pip install -r requirements.txt
export PYTHONPATH=src
.venv/bin/python scripts/p0_fetch.py        # окна DTM и ортоснимка HiRISE (~160 МБ) → data/raw/
# CTX DEM/орто и MOLA см. в out/REPORT.md → «Источники» (кладутся в data/raw/)
.venv/bin/python scripts/p1_terrain.py      # рельеф и текстуры
.venv/bin/python scripts/p2a_layers_base.py && .venv/bin/python scripts/p2_targets.py
.venv/bin/python scripts/p5a_horizon_db.py && .venv/bin/python scripts/p3_routes.py && .venv/bin/python scripts/p4_layers.py
.venv/bin/python scripts/p5_horizon_demo.py # синтетический тест «где я»
.venv/bin/python scripts/p5b_real_panos.py && .venv/bin/python scripts/p5c_real_v2.py && .venv/bin/python scripts/p5d_tracking.py  # настоящие панорамы
.venv/bin/python scripts/p6_slides.py
```
Просмотрщик: `python3 -m http.server 8000` в этой папке → http://localhost:8000/viewer/
