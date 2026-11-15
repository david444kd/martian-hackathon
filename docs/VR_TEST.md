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
## Consumables, guidance and alert tones — 2026-11-15

| Check | Action | Result |
| --- | --- | --- |
| Guidance | Start an EVA from the ship (or `?simroute=900`, this browser only): chevrons and dashes lead round the outpost, the autopilot (X) does not stick on the solar farm, the target beacon and "target reached" appear | NOT TESTED ON DEVICE |
| Consumables | Walk the route: O₂ / PWR / H₂O fall as you go, faster uphill; `MARGIN` shows the percentage expected at the airlock | NOT TESTED ON DEVICE |
| Low reserve | A long route or a suit already low: CAUTION below 25 %, WARNING below 10 %, each with its quiet tone | NOT TESTED ON DEVICE |
| Top-up | Return to the airlock on standby: the notice appears and the three values climb back to 100 % | NOT TESTED ON DEVICE |
| Alert tones | Raise an advisory, a caution and a critical alert: the chimes are clearly quieter than the voice and not startling in the headset | NOT TESTED ON DEVICE |
## Presence — 2026-11-15

| Check | Action | Result |
| --- | --- | --- |
| Boot prints | Walk 10 m, turn round and look down: a line of prints leads to your feet; a little dust rises at each step | NOT TESTED ON DEVICE |
| Haptics | Walk: a light tick per step in the hand on that side; in a storm (`?simstorm=-80`) a thump as a squall arrives; a buzz at a refused step and at an alert. Note if any of it is annoying or too weak | NOT TESTED ON DEVICE |
| Gloves | Squeeze the grip and the trigger: fingers and thumb close and open smoothly, nothing detaches from the hand | NOT TESTED ON DEVICE |
| Visor | Look towards the Sun: a soft glare with faint scratches, not a pattern that draws the eye; look down while breathing hard after a climb: a light mist at the lower edge | NOT TESTED ON DEVICE |
## Lamps, shade, placed sound, suit dust — 2026-11-15

| Check | Action | Result |
| --- | --- | --- |
| Helmet lamps | `?simstorm=-80`: within a few seconds a pool of light appears ahead and follows the head; gloves and nearby rocks are lit, not burnt out; frame rate holds with the extra light | NOT TESTED ON DEVICE |
| Drifting shade | Clear day, stand still and watch the plain for a minute: soft patches of shade move slowly; they must not read as flicker | NOT TESTED ON DEVICE |
| Beacon tone | With a route (`?simroute=600`): close your eyes and turn — the pip moves between the ears and doubles when you face the target; is it audible but not tiresome over a long walk? | NOT TESTED ON DEVICE |
| Base hum | Walk to and away from the habitat: the hum grows, shifts to its side, and is gone by ~40 m | NOT TESTED ON DEVICE |
| Suit dust | Stand a minute in the storm, then leave it: sleeves and gloves have browned and stay so for several minutes | NOT TESTED ON DEVICE |
## Route-finding cue and recalibrated consumables — 2026-11-15

| Check | Action | Result |
| --- | --- | --- |
| Finding the route | On an EVA turn away from the route: chevrons appear below centre on the side to turn to and vanish when you face it; walk 20 m off the line: they point back with the distance | NOT TESTED ON DEVICE |
| Cue size | The chevrons and the angle are readable at a glance without looking down at them | NOT TESTED ON DEVICE |
| Consumables | Walk a route with a climb: oxygen and water fall about twice as fast on a 10 % slope as on the level; pulse and breathing rise on the climb and stay up for a while after | NOT TESTED ON DEVICE |

A second browser opened to watch a running EVA must use `?dry` (it otherwise reports as the same astronaut).
## Tiredness and no voice — 2026-11-15

| Check | Action | Result |
| --- | --- | --- |
| Tiredness | Walk a kilometre: the `FTG` gauge reaches about a third on the level, far more on a climb; the pace visibly drops as it fills | NOT TESTED ON DEVICE |
| Rest | At the 70 % notice stop and stand: the gauge empties in a few minutes and the pace returns | NOT TESTED ON DEVICE |
| Spent | Keep climbing until the WARNING: the autopilot stops; the stick still moves you, slowly | NOT TESTED ON DEVICE |
| No voice | Raise an alert and send a call from the ship: tones and text only, nothing is spoken | NOT TESTED ON DEVICE |
