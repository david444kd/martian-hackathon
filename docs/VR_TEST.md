# Проверка в Meta Quest

Все пункты ниже требуют физического Quest 2 и до проверки отмечены **NOT TESTED ON DEVICE**. Desktop build не заменяет тест в шлеме.

| Проверка | Действия | Результат |
| --- | --- | --- |
| Подготовка | Открыть доверенный HTTPS-домен в Meta Quest Browser; выбрать экипаж с активным маршрутом | NOT TESTED ON DEVICE |
| Вход в VR | Нажать Enter VR, подтвердить системные запросы, проверить обе линзы и стерео-изображение | NOT TESTED ON DEVICE |
| Масштаб | Сравнить высоту камеры/горизонт и 1:1 метры; проверить, что местность не выглядит уменьшенной моделью | NOT TESTED ON DEVICE |
| Движение головы | Осмотреться вверх/вниз и в стороны; взгляд должен следовать только за головой | NOT TESTED ON DEVICE |
| Контроллеры | Левый стик вперёд/назад, правый стик влево/вправо, A, B; подтвердить подсказку кнопок и реальный mapping Quest Browser | NOT TESTED ON DEVICE |
| Перемещение | Пройти по выданному маршруту, телепортироваться на 8 м, остановиться перед активной опасностью | NOT TESTED ON DEVICE |
| Положение на карте | Держать EVA активной; сверить обновление маркера в ship/dispatch через 2–3 с и остановочный heartbeat | NOT TESTED ON DEVICE |
| Тревога | Создать в Mission Control активную пыльную бурю на оставшейся части маршрута; проверить сигнал, речь, предупреждение и маршрут к базе | NOT TESTED ON DEVICE |
| Подсказка / HUD | Прочитать предупреждение, дистанцию, демонстрационные показатели и условия, не теряя видимость земли | NOT TESTED ON DEVICE |
| Выход | Нажать B или системную кнопку Quest; убедиться, что desktop-страница остаётся работоспособной | NOT TESTED ON DEVICE |
| Повторный вход | Войти/выйти трижды; проверить сохранность маршрута, звука и контекста WebGL | NOT TESTED ON DEVICE |
| Устойчивость | Провести минимум 5 минут; записать рывки, задержку синхронизации, FPS/пропуски кадров, потери WebGL и дискомфорт | NOT TESTED ON DEVICE |

При потере плавности прекратить сессию и записать модель Quest, версию OS/Browser, маршрут, активные события и наблюдаемые симптомы. Не объявлять стабильный FPS без измерения в шлеме.
## Helmet visor / storm additions

| Check | Action | Result |
| --- | --- | --- |
| Suit framing | Open `/helmet/:crewId` on desktop; check the narrow brow/jaw and readable HUD | NOT TESTED ON DEVICE |
| XR framing | Enter immersive VR; check visor stays at the eye edges while head tracking remains independent | NOT TESTED ON DEVICE |
| Storm response | Raise an active dust storm over the crew zone; confirm haze/particles and the same warning/return route appear together | NOT TESTED ON DEVICE |
| Recovery | End/clear the storm and confirm the extra particle field disappears and movement remains guarded | NOT TESTED ON DEVICE |
## Visual field review

| Check | Action | Result |
| --- | --- | --- |
| Minimap placement | Confirm the map sits left/below the centre view and does not cover the route | NOT TESTED ON DEVICE |
| Surface dressing | Check stones sit on the measured zone surface and the assigned route remains visually clear | NOT TESTED ON DEVICE |
| Route confinement | Walk/teleport to route limits and hazard boundaries; confirm movement stays within existing checks | NOT TESTED ON DEVICE |
## Mission Control globe anomalies (Quest Browser)

| Check | Action | Result |
| --- | --- | --- |
| Frame rate | Open `/` (Mission Control) in Quest Browser with ≥3 active anomalies and a solar storm; rotate/zoom the globe for 1 min; watch for stutter | NOT TESTED ON DEVICE |
| Readability | Storm/devil/rockfall distinguishable at default zoom; labels and rings readable | NOT TESTED ON DEVICE |
| Globe layers | In Quest Browser, switch the globe to THEMIS/MOLA, add geology + minerals; note load time, texture sharpness and frame rate while rotating | NOT TESTED ON DEVICE |
| Zone layers | On a Jezero crew's map toggle the Jezero geologic map and THEMIS night IR; panel readable and scrollable with the controller | NOT TESTED ON DEVICE |
| Visor HUD | In VR: read MET, O₂/PWR/H₂O, LIMIT, NAV block, heading tape and the map without moving the eyes far; check the centre stays clear, text is sharp at Quest 2 resolution, and the caution/master-alarm box appears on a demo storm | NOT TESTED ON DEVICE |
| HUD text size | The HUD now uses 15–20 px text (≈0.7–1°): confirm it is readable through Quest 2 lenses without leaning in; if not, raise sizes slightly in `src/eva/xrHud.ts` | NOT TESTED ON DEVICE |

### Desktop preview of the headset view (not a device test)

Open `/helmet/<crewId>?xrview=1` in a browser window shaped like one Quest 2 eye (e.g. 916 × 960, or 1832 × 1920 for full eye resolution). The camera uses a Quest 2-like per-eye FOV (~93° vertical), the VR layer (visor rim, HUD plane 2 m ahead) is shown, the screen HUD is hidden and the VR gloves sit at a typical controller pose. Angular sizes match; lens blur/distortion, stereo, real hand poses and frame rate do not. Code: `src/eva/xrPreview.ts`.
## EVA scene budget, atmosphere and storm — 2026-11-15

Start the HTTPS dev server with `npm run dev:vr` (same as `dev:quest`) and open `/helmet` in Quest Browser.

| Check | Action | Result |
| --- | --- | --- |
| Frame rate, clear day | Enter VR at the base, look round, walk 200 m out and back; note judder or reprojection, and the browser's frame rate if shown | NOT TESTED ON DEVICE |
| Frame rate at the base | Stand at the foot of the airlock ladder facing the habitat (the heaviest view); turn the head slowly | NOT TESTED ON DEVICE |
| Level-of-detail seams | Walk 600 m in a straight line watching the middle distance; note popping hills or gaps in the ground | NOT TESTED ON DEVICE |
| Storm from outside | Raise a dust storm ahead (`/demo`, or the visual-only `?simstorm=400`); check the wall reads as dust in stereo, its foot meets the ground, and the frame rate holds while it fills the view | NOT TESTED ON DEVICE |
| Storm from inside | `?simstorm=-80` (visual only) or walk to the edge of a warning-level storm: haze, flying sand, drifting billows, dimmed Sun; note frame rate and any discomfort from the moving dust | NOT TESTED ON DEVICE |
| Dust devil | `?simdevil=200` (visual only) or a `dust_devil` event: the column is visible from the base and does not flicker | NOT TESTED ON DEVICE |
| Shadows | Walk with the Sun behind you: your own shadow follows (refreshed ~24 times a second on the headset); rocks and the base cast shadows near you | NOT TESTED ON DEVICE |
| HUD against foveation | Read the suit and navigation blocks at the visor's edge with the default settings; if blurred try `?fov=0.2`, if frames drop try `?fov=0.8` or `?lite` | NOT TESTED ON DEVICE |
| Sharpness | Compare the default with `?scale=1.2` (sharper, slower) | NOT TESTED ON DEVICE |
| Load time | Time from opening `/helmet/:crewId` to the enabled Begin / Enter VR buttons (textures are generated in code on load) | NOT TESTED ON DEVICE |

Address parameters for these checks (combine with `&`): `?lite` cheapest settings, `?quest` headset tier on a desktop, `?scale=`, `?fov=`, `?simstorm=<m>`, `?simdevil=<m>`, `?xrview=1` desktop preview of the headset view. In a dev build the console gives scene complexity: `__evaGl.info.render` (draw calls, triangles of the last frame) and `__evaFps`.
## Inside the storm: squalls and sound — 2026-11-15

| Check | Action | Result |
| --- | --- | --- |
| Squall | `?simstorm=-80` (visual and sound only), wait up to 30 s for a squall: the base fades into the dust and comes back; note frame rate and discomfort | NOT TESTED ON DEVICE |
| Sand on the visor | In the same storm: short scratches flash on the glass; they must not be painful to look at or pull the eyes' focus | NOT TESTED ON DEVICE |
| Dust on the visor | Stay a minute in thick dust: haze gathers at the rim; the suit and navigation blocks stay readable; it clears after leaving | NOT TESTED ON DEVICE |
| Storm sound | Sound on: rumble, howl and whistle follow the gusts; sand patter; a thud as a squall arrives; occasional crackle with a display flicker; nothing distorts when an alarm and a call sound in the storm | NOT TESTED ON DEVICE |
| Pulse and breathing | Deep in the dust the breathing quickens and a pulse is heard; both stop after leaving | NOT TESTED ON DEVICE |
| Loudness | Storm against clear air on the headset's speakers and on headphones: uncomfortable or too quiet? (levels are set in `src/eva/audio.ts` `weather()`) | NOT TESTED ON DEVICE |
## Alerts and calls on the visor — 2026-11-15

| Check | Action | Result |
| --- | --- | --- |
| Call from the ship | Send a message to the crew from the ship console (or `?simhud=message`, display only): sender, subject and the text in three lines are readable without tilting the head; it folds to one line after ~25 s | NOT TESTED ON DEVICE |
| Hazard alert | A dust storm across the route (`/demo`, or `?simhud=hazard`): framed WARNING with distance along the route and direction; the tape shows a red diamond towards it; turning the head moves the diamond and the arrow | NOT TESTED ON DEVICE |
| Several at once | `?simhud=many`: the list stays inside the upper-centre of the view, does not reach the centre, and the less important lines are readable | NOT TESTED ON DEVICE |
| Recall | `?simhud=recall`, or a real recall: reason and "preparing the return route", then the distance to the airlock | NOT TESTED ON DEVICE |
| Against bright ground | Read the alert lines over the white habitat and the sunlit ground | NOT TESTED ON DEVICE |
