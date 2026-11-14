# Источники VR-поверхности и интеграции

Проверено для текущей реализации 2026-11-14. Эта итерация не скачивала дополнительные изображения или геометрию: используются уже присутствующие `public/zones/` и исходный код построения зон.

## Поверхность

- Подготовленные зоны Gale и Jezero: 512×512 высотные сетки CTX/HiRISE с шагом 20 м. Параметры и границы описаны в `public/zones/zones.json`; построение репродуцируется существующим `scripts/build_zones.py`.
- Текстуры регионов подготовлены существующим `scripts/build_zone_photos.py`. Дополнительные источники/атрибуция находятся в исходных скриптах проекта и подписях локальной зоны. Фототекстура не используется как источник геометрии.
- Маршруты создаёт существующий A* по высотной сетке и активным зонам событий (`src/lib/pathfind.ts`). VR сохраняет маршрутный масштаб; новые координаты Jezero для сцены Gale не добавляются.

## XR и live синхронизация

- Three.js WebXR renderer (уже установлен в проекте), API `XRSession`, контроллеры WebXR Gamepad и поддержка Meta Quest Browser. Вход доступен лишь после успешной проверки `immersive-vr`.
- Supabase Realtime Postgres Changes: [официальное описание](https://supabase.com/docs/guides/realtime/subscribing-to-database-changes). Телеметрия использует существующую таблицу `work_plans`, а не новый канал/сервер.
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
