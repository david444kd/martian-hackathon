# export/ — данные для фронта (ГОРИЗОНТ, кратер Jezero)

Все данные настоящие: USGS/NASA (HiRISE DTM 1 м, ортоснимок HiRISE 25 см, CTX DEM 20 м, путевые точки Perseverance).
Каждый файл ≤ 5 МБ.

## Система координат (важно)
- Все точки даны в **локальных метрах** от центра ближнего участка: `x` — на восток, `y` — на север,
  `h` — высота в метрах относительно `terrain/meta.json → near.h_ref`. Поля `lon`/`lat` — для справки.
- В three.js ось вверх — Y, поэтому **`position = (x, h, -y)`**: север = −Z, восток = +X.
- Ближний участок: x, y ∈ [−2000, 2000]. Дальний: [−20000, 20000], центр тот же.
- База (лендер) находится в (1400, 50).

## terrain/
| файл | что |
|---|---|
| `near_height.png` / `.u16` | 1025×1025, 16 бит. h = h_min + v/65535·(h_max−h_min); строка 0 = север, столбец 0 = запад. Узлы ровно от −2000 до +2000 м (шаг 3.906 м) |
| `near_height_513.png` / `.u16` | то же, 513×513 (для Quest), свои h_min/h_max в `meta.near.px_513` |
| `near_texture_4096.jpg`, `near_texture_2048.jpg` | ортоснимок HiRISE того же охвата (края текстуры = края меша) |
| `far_height.png` / `.u16` | 513×513, 40×40 км (CTX 20 м + MOLA на западном краю). Внутри ближнего квадрата опущен на 3 м |
| `far_texture_2048.jpg` | ортоснимок CTX 5 м |
| `meta.json` | h_min/h_max/h_ref, центр (lon/lat), проекция, источники |
| `loader_example.js` | готовая функция `addJezero(scene, './terrain/', quest)` |

`.u16` — те же значения, что в PNG, но в виде сырого uint16 little-endian. Браузерный canvas читает PNG только
в 8 битах, и тогда на перепаде 150 м получаются ступеньки по 0.6 м. Поэтому используйте `.u16`
(`new Uint16Array(await r.arrayBuffer())`), как в `loader_example.js`.

## targets.json
Массив объектов `{id, name, x, y, h, lon, lat, type, science, priority, stop_min, coords_source, samples, source_note}`.
`type`: `base` (лендер) или `sample_site` (места, где Perseverance взял образцы). `coords_source: "nasa"` — координаты
из путевых точек ровера NASA, точность ±50 м.

## routes.json
```
{generated, source, preset: "safe", limits: {...},
 missions: [{id, name, target_ids, path: [{x,y,h,lon,lat,t_s,o2_l,dose_msv}], stops_index, no_return_index,
             summary: {distance_m, time_min, walk_min, o2_l, o2_pct_of_supply, dose_msv, max_slope_deg, min_return_margin_pct},
             dropped: [{target_id, reason}],
             shelters: [{from_index, path: [{x,y,h}], time_min, sky_fraction_from, sky_fraction_to, dose_reduction_pct}]}]}
```
- `path` — точки через каждые ~10 м. Значения `t_s`, `o2_l`, `dose_msv` накопительные, остановки на целях уже включены.
- `stops_index` — индексы точек `path`, где стоят цели (в порядке `target_ids`).
- `no_return_index` — первая точка, где запас времени на возврат < 10%, или `null`.
- `shelters` — пути к укрытию от точек на 25/50/75% маршрута (для события «вспышка»).
- Миссии: m1 — короткая (1 цель), m2 — две цели в Séítah, m3 — заведомо слишком длинная (видно, какие цели выброшены и почему), m4 — длинная к дельте.

## layers/
RGBA PNG 800×800 (клетка 5 м), охват совпадает с `near_texture`. Их можно накладывать второй текстурой
или класть плоскостью на 0.3 м выше рельефа.
- `hazard.png` — красное: запрет; жёлто-оранжевое: штраф.
- `dose.png` — мощность дозы (plasma), минимум и максимум в `layers/meta.json` (мЗв/ч).
- `zone_<mission_id>.png` — где можно дойти и вернуться в лимит с учётом остановок миссии; жёлтое — край зоны.
- `meta.json` — охват и легенды.
