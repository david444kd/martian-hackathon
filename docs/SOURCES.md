# Источники VR-поверхности и интеграции

Проверено для текущей реализации 2026-11-14. Эта итерация не скачивала дополнительные изображения или геометрию: используются уже присутствующие `public/zones/` и исходный код построения зон.

## Поверхность

- Подготовленные зоны Gale и Jezero: 512×512 высотные сетки CTX/HiRISE с шагом 20 м. Параметры и границы описаны в `public/zones/zones.json`; построение репродуцируется существующим `scripts/build_zones.py`.
- Текстуры регионов подготовлены существующим `scripts/build_zone_photos.py`. Дополнительные источники/атрибуция находятся в исходных скриптах проекта и подписях локальной зоны. Фототекстура не используется как источник геометрии.
- Маршруты создаёт существующий A* по высотной сетке и активным зонам событий (`src/lib/pathfind.ts`). VR сохраняет маршрутный масштаб; новые координаты Jezero для сцены Gale не добавляются.

## XR и live синхронизация

- Three.js WebXR renderer (уже установлен в проекте), API `XRSession`, контроллеры WebXR Gamepad и поддержка Meta Quest Browser. Вход доступен лишь после успешной проверки `immersive-vr`.
- Supabase Realtime Postgres Changes: [официальное описание](https://supabase.com/docs/guides/realtime/subscribing-to-database-changes). Прогресс маршрута идёт через `work_plans.progress_m`; позиция шлема — через Realtime broadcast (канал `eva-live`) и таблицу `eva_telemetry` (`supabase/eva_telemetry.sql`). Отдельного сервера нет: [Realtime Broadcast](https://supabase.com/docs/guides/realtime/broadcast).
- WebXR работает только в secure context и с пользовательским действием; браузер проверяет разрешение immersive-сессии: [WebXR permissions and security](https://developer.mozilla.org/en-US/docs/Web/API/WebXR_Device_API/Permissions_and_security).

## Применение и ограничения

Никакого NASA-одобрения, живой телеметрии, медицинских измерений или гарантии безопасного маршрута нет. Реальная земная позиция/движение тела не передаётся; карта показывает виртуальный прогресс по маршруту. Показатели пульса, кислородного резерва и нагрузки синтетические.
## ARES VR Lab transferred into Mars Ops — 2026-11-14

The `/vr-lab` route reuses the existing ARES VR Lab implementation from the sibling `Nasa_Hackaton` project: `src/vr/`, its VR-specific styles, the native Three.js/WebXR experience, Dingo detail mesh and baked texture atlases, Jezero elevation patches, Mars location catalogue imagery, and the isolated Butler Landing photo asset. Credits, source URLs, checksums, limitations, and per-asset sizes are retained in the copied manifests and credit files under `public/data/`.

The copied Dingo detail files total 34,638,378 bytes; the supporting selected local terrain and catalogue assets keep the transfer far below the earlier 300 MB ceiling. No complete NASA-AMMOS sample-data repository, streaming tileset, or new third-party VR framework was copied or installed. Dingo Gap remains distinct from Jezero; the photograph remains a separate non-walkable mode. ARES-authored regional scenes remain labelled as reconstructions by their source metadata.

NASA/JPL and instrument-team credits and use limitations are recorded in `public/data/vr-lab/dingo-detail/manifest.json`, `public/data/vr-lab/panorama/CREDIT.txt`, and `public/data/mars-locations/assets-manifest.json`. This transfer does not imply NASA endorsement or physical Quest validation.
## Correction: ARES Helmet integration — 2026-11-14

The prior entry stating that the NASA-AMMOS ARES VR Lab dataset was transferred into this project was mistaken and superseded. Its copied data files and route were removed. No new third-party terrain, photography, dependency, or texture was added in this integration.

The current helmet visual change reuses only the original standalone ARES Helmet project's authored visor design direction (`mars-helmet/src/features/hud/Visor.tsx` and `mars-helmet/src/refinement.css`) as a small adapted CSS/XR frame. It does not copy or alter that project's generated regolith PNG. Storm particles are deterministic procedural display effects; they are activated by the existing Mars Ops dust-storm event and conditions opacity. They are not scientific observations. Existing zone topography and photographs remain the Mars Ops source geometry/material inputs, and existing event/route data remain the mission source.
## EVA helmet visual refinement — 2026-11-15

The `/helmet/:crewId` scene now includes deterministic, low-poly visual stones. Their X/Z placement is authored relative to the existing Mars Ops route; vertical placement samples the already prepared Jezero/Gale heightmap through `elevationAt`. They are excluded from an 8.5 m corridor around the route polyline. The output is explicitly visual dressing and must not be treated as surveyed boulders or new scientific geology. No photo brightness is used to infer terrain or object height. No source image or new runtime texture was downloaded for this change.

The more compact left-side mini-map is the existing map of the assigned Mars Ops work plan. It is not a new route or a registered terrain. The existing visor and storm particle effects are authored UI/presentation elements, not NASA assets or measured atmospheric data.
## Mission Control globe anomaly models — 2026-11-15

No new asset was downloaded. Storm, dust devil, rockfall and solar-storm visuals on the globe are procedural shaders (`src/dispatch/Anomaly.tsx`, `src/dispatch/SolarStorm.tsx`) using a noise texture generated in code. The look is authored after public descriptions of orbital imagery — regional storms as pale tan clouds with arced, towering dust fronts (MARCI/Mars Express VMC, e.g. the 2007 Utopia front, ~65 km high: https://www.esa.int/ESA_Multimedia/Images/2017/10/Dust_clouds_over_Mars; MARCI storm tracking: https://www.jpl.nasa.gov/news/nasa-mars-orbiter-tracks-back-to-back-regional-storms/; HRSC storm front near the north polar cap, 2018: https://www.esa.int/spaceinimages/Images/2018/07/Mars_dust_storm), dust-devil tracks and shadows in HiRISE images, and MAVEN's reports of diffuse night-side aurora during solar particle events. It is illustration, not data; motion speeds and sizes are chosen for readability. Event position, level and active state still come from the existing `events` rows.
## Map layers from Martian Map — 2026-11-15

Taken over from the team's NASA Space Apps 2026 project "Martian Map" (`NASA_Space-Apps_Challenge_Martian_Map`, README and `frontend/app.js`, `frontend/datalayers.js`). No new imagery is stored in this repository; rasters stream from NASA Mars Trek WMTS (https://trek.nasa.gov):
- Viking MDIM 2.1 colour mosaic (`Mars_Viking_MDIM21_ClrMosaic_global_232m`), THEMIS day/night IR controlled mosaics 100 m (`THEMIS_DayIR_…`, `THEMIS_NightIR_ControlledMosaics_100m_v2_oct2018`), MGS MOLA colour shaded relief 463 m (`Mars_MGS_MOLA_ClrShade_merge_global_463m`), MGS TES thermal inertia (`TES_Thermal_Inertia`) and dust cover index (`tes_ruffdust`), USGS SIM 3292 global geologic map (Tanaka et al. 2014) via Trek's ArcGIS WMTS.
- `public/data/science_features.json` — copied unchanged from Martian Map (its `source` field: NASA Mars Trek feature services, compacted by its `scripts/build_science_layers.py`): CRISM/OMEGA hydrous minerals (Carter et al. 2013), aqueous minerals by class (Ehlmann & Edwards 2014), THEMIS chloride deposits (Osterloo et al. 2010), HiRISE new craters (Daubar et al. 2013), icy impact sites, RSL and active gullies.
- `public/data/jezero_geology_zone.json` — USGS SIM 3464, Geologic map of Jezero crater and the Nili Planum region (Sun & Stack 2020, 1:75,000, https://doi.org/10.3133/sim3464), from Martian Map's `data/jezero_geology.json`, clipped to the Jezero zone and simplified by `scripts/build_map_layers.py`. Unit names/interpretations are USGS text in English.
These are US-government public data; no NASA/USGS endorsement is implied. Layers are display only and do not feed routing or hazard logic.
## In-visor HUD design references — 2026-11-15

Layout and content of `src/eva/xrHud.ts` are authored after public descriptions, not copied from any NASA interface: the xEMU informatics display content (consumables, location, EVA elapsed/remaining time, range from supplies — Tech Briefs, Nov 2021, https://www.nxtbook.com/smg/techbriefs/21TB11/index.php?startid=24), NASA SUITS HMD requirements (telemetry, vitals, 2D mini-map, warning module — https://www.nasa.gov/stem-content/spacesuits-heads-up-display-activity/, FY24 mission description https://nasa.gov/wp-content/uploads/2023/09/fy24-suits-mission-description.pdf), the EMU Display and Control Module's caution & warning role (https://ntrs.nasa.gov/api/citations/20150009506/downloads/20150009506.pdf) and UMD SSL's EVA HUD work (https://drum.lib.umd.edu/handle/1903/26000). No NASA endorsement implied; values remain the simulated suit model.
## EVA scene atmosphere, ground detail and storm — 2026-11-15

No dataset, image or model was downloaded or added. The sky, haze, storm front, dust devil, wind-blown sand, regolith relief, rocks and structures in `src/eva/` are authored in code: two noise textures and the material textures are generated at load (`src/eva/atmo.tsx`, `src/eva/textures.ts`). The zone DTMs and photos, and the HiRISE close-up tiles streamed from NASA Mars Trek, are used exactly as before; the fine relief near the astronaut is an authored tiling texture laid over the photograph, not imagery, and the DTM geometry is not altered by it.

The look follows general public descriptions of the Martian surface and sky rather than any specific image: a butterscotch daytime sky brightest near the horizon, a small solar disc with a bluish forward-scattering glow, dust-storm fronts as walls of billowing dust, dust devils as pale narrow columns, and wind-driven sand near the ground. Sizes, colours and speeds are chosen for the demonstration. They are illustrations of where an `events` row says an anomaly is and of dusty air, not measurements; no NASA endorsement is implied.
## Storm sound and static discharges — 2026-11-15

No recording was added: every sound in `src/eva/audio.ts` is synthesised in the browser. The crackle of static in thick dust, the brief display flicker and the radio interference are authored after the first detection of electrical discharges on Mars — 55 small triboelectric discharges recorded by the SuperCam microphone on Perseverance over about two Martian years, associated with dust devils and dust-storm fronts (Chide et al., "Detection of triboelectric discharges during dust events on Mars", Nature, November 2025; CNRS summary: https://www.cnrs.fr/en/press/electric-discharges-detected-mars-first-time). Those discharges are centimetre-scale and were heard, not seen, so none is drawn; how often they occur here is chosen for effect. The rumble, howl, sand patter, squall rhythm and loudness are dramatised: Mars' thin air carries little sound and its wind has little force. Illustration, not data; no NASA or CNRS endorsement is implied.
## Suit consumables model — 2026-11-15

The slope factor in `src/lib/consumables.ts` is the fifth-order polynomial for the energy cost of walking on gradients from Minetti, Moia, Roi, Susta and Ferretti, "Energy cost of walking and running at extreme uphill and downhill slopes", Journal of Applied Physiology 93 (2002), divided by its value on level ground. It was measured on Earth without a suit and is used here only for the shape of the curve (uphill costs more, a gentle descent less). Suit endurance figures (8 / 9 / 8.5 hours of level walking) are chosen for the demonstration. No dataset was added. The model is a simulation for display and planning practice — not suit hardware data, not a medical or safety calculation, and no NASA endorsement is implied.
## Real EVA figures behind the consumables model — 2026-11-15

Read for `src/lib/consumables.ts` (text extracted from the NASA PDFs; no file added to the repository):
- M. A. Carson, "Apollo Portable Life Support System Performance Report" (NASA NTRS 19730008098): design point of 4 h at an average 1200 Btu/h; mission-average metabolic rates 750–1118 Btu/h (Apollo 12, 14); consumables remaining after each EVA.
- "Apollo 16 Time and Motion Study, Final Mission Report" (NASA MSC M72-6, NTRS 19720019460): riding the rover 442–633 Btu/h; a 297 ft traverse at 3.0 ft/s at 1112 and 1185 Btu/h; carrying the ALSEP package 180 ft in ~60 s up a ~5 % incline at 2300 Btu/h; longer traverses above 1100 Btu/h.
- Gernhardt, Norcross, Vos, "Integrated Suit Test 1" (ICES 2008, NTRS 20080013604): Mark III suit at 121 kg and 29.6 kPa; suit weight from 63 to 308 kg did not change metabolic rate below 4.0 km/h, suit pressure had minimal influence on it.
- Norcross and Gernhardt, "Selecting Tasks for Evaluating Human Performance as a Function of Gravity" (2011, NTRS 20110008554): incline walking differs significantly between 1/6 g, 3/8 g and 1 g.
- The Pandolf load-carriage equation and its terrain factors (as summarised at https://en.wikipedia.org/wiki/Pandolf_equation; reported to under-predict by 12–33 % for modern loads) and Minetti et al. 2002 for descents.
Not obtained: the EVA Walkback Test final report (NASA/TP-2009-214796). The model is a simulation shaped by these figures, with Mars gravity and assumed suit parameters; it is not validated, not suit hardware data and not a safety calculation. No NASA endorsement is implied.
