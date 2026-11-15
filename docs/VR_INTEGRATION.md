# Интеграция VR EVA Helmet

Дата: 14 ноября 2026. Это прототип, встроенный в существующее приложение Mars Ops. Планировщик, страницы диспетчера и корабля, Supabase и файлы марсианских зон сохранены; новый VR-проект и отдельный сервер не создавались.

> Управление и сцена шлема с тех пор переделаны: актуальное описание — `docs/EVA_HELMET.md`, история — `docs/STATE.md`. Раздел о данных ниже обновлён 15 ноября 2026.

## Что работает в коде

- Страница шлема: `/helmet/:crewId`. Она использует существующий Three.js / React Three Fiber и WebXR, без второго VR-фреймворка.
- Обычный экранный режим: мышь для взгляда, `W` / `S` или кнопки для движения, `Q` / `E` для поворота на 30°, `Space` или кнопка для перехода на 8 м по маршруту.
- Meta Quest Browser: API `immersive-vr` проверяется до входа. Повороты головы управляют направлением взгляда. Левый стик перемещает по текущему подготовленному маршруту; правый стик поворачивает фиксированными шагами по 30°; кнопка A переносит на 8 м по маршруту; B завершает WebXR-сессию. Системное меню Quest остаётся резервным способом выхода.
- Используется текущая измеренная высотная сетка и текстура выбранной зоны в метрах. Перемещение ограничено линией рассчитанного маршрута. При активной опасной области впереди движение останавливается до неё. Границы безопасности Quest не отключаются.
- Сцена оставляет реальное положение головы за WebXR. Маршрутная рамка сцены двигается вслед за пройденным расстоянием, а обзор не доворачивается за виртуальным персонажем.
- Каждые 2,5 секунды шлем отправляет позицию: Realtime broadcast `eva-live` (сразу), upsert в `eva_telemetry` (последняя позиция для страниц, открытых позже) и `work_plans.progress_m`. Прогресс пишется только пока у задания тот же маршрут (`route.generated_at`) и статус `in_progress`, чтобы старая вкладка не затёрла маршрут, только что заменённый диспетчером или кораблём.
- Новый маршрут (отзыв, обход, отправка с корабля) записывается условно: только если в базе всё ещё маршрут, который видел автор. Если кто-то успел раньше, запись не выполняется, пользователь видит сообщение, а остаётся маршрут, записанный первым.
- Страница корабля и выбранный экипаж в диспетчерской получают обновления через уже существующую подписку Supabase Realtime. Если Realtime недоступен, текущий адаптер переключается на опрос базы.
- Активная пыльная буря, пересекающая оставшуюся часть маршрута, или критическое событие запускает расчёт обратного маршрута к базе тем же A* и по доступной высотной сетке. Новый маршрут сохраняется в том же задании с `mode: "return"`; диспетчер и корабль получают обновление. Если маршрут посчитать нельзя, шлем показывает ошибку и предлагает остановиться и связаться с кораблём.
- Предупреждения видны в сцене и на странице. После явного нажатия **Enter VR** Web Audio и синтез речи могут звучать без последующего нажатия.
- Показатели `pulse`, `O2 reserve` и `suit load` — только демонстрационная модель на основе расчётных условий зоны и активной бури. Одинаковые значения показываются в шлеме, на корабле и у диспетчера. Это не телеметрия человека, датчики скафандра или медицинские значения.

## Как данные идут между страницами

```text
Quest / desktop helmet, every 2.5 s
  ├─ Realtime broadcast "eva-live" (pose) ──→ Ship Console / Mission Control / /demo markers
  ├─ upsert eva_telemetry (one row per crew) → last known position for pages opened later (polled every 10 s)
  └─ work_plans.progress_m (same route + in_progress only) → Realtime postgres_changes → route progress
```

Если свежего отчёта (за 20 с) нет, координаты на карте вычисляются из `progress_m` и точек маршрута. Поэтому это виртуальная позиция на Марсе, созданная управлением стиком/клавишами/телепортом, а не GPS или измерение фактического положения человека в комнате. Высота маршрута и географические координаты принадлежат выбранной подготовленной зоне.

## Запуск с Supabase

1. В папке проекта выполните `npm install`.
2. Скопируйте `.env.example` в `.env.local` и добавьте URL Supabase и publishable key своего проекта. Не публикуйте секретный service-role key в браузере.
3. Для нового проекта откройте Supabase → SQL Editor и один раз запустите `supabase/schema.sql`. В нём уже объявлены таблицы (включая `eva_telemetry`), демо-политики и публикация Realtime. Для существующей базы запустите `supabase/eva_telemetry.sql` и проверьте, что `crews`, `work_plans`, `events` и `eva_telemetry` есть в `supabase_realtime`.
4. Перезапустите `npm run dev`. Скопируйте ID экипажа из диспетчерской и откройте в браузере ПК `/helmet/ЭТОТ-ID`.
5. В Mission Control создайте задание, в Ship Console рассчитайте маршрут и нажмите запуск EVA. Шлем откроет активный маршрут. Включите desktop-просмотр и удерживайте `W` или кнопку движения: на корабле и карте диспетчера положение должно обновляться примерно раз в 2,5 секунды.
6. В диспетчерской создайте событие **Dust storm** с центром/радиусом, пересекающим оставшуюся часть маршрута. В активном EVA должны появиться предупреждение и новая линия **Return to base**. Это проверка алгоритма планирования, не гарантия безопасности.

## Открытие в Quest

### Беспроводной показ

Разверните сайт на домене с доверенным HTTPS-сертификатом (например, на настроенном Vercel-проекте) и задайте там те же две публичные переменные окружения. Включите Quest и компьютер в Wi-Fi, откройте Meta Quest Browser и перейдите на `https://ВАШ-ДОМЕН/helmet/ID-ЭКИПАЖА`. Выберите **Enter VR**. Обычный IP компьютера с `http://` не считается автоматически безопасным WebXR-адресом.

### Локальная проверка с USB

При установленном Android Platform Tools подключите Quest кабелем, подтвердите USB debugging в шлеме, выполните `adb devices`, затем `adb reverse tcp:5173 tcp:5173`. Запустите Vite командой `npm run dev` и откройте в Quest Browser `http://localhost:5173/helmet/ID-ЭКИПАЖА`. Это проводная разработка; для показа без кабеля нужен доверенный HTTPS-хост.

Не соглашайтесь на self-signed/недоверенный сертификат и не отключайте проверки браузера. Текущий `npm run dev:quest` оставлен в исходном проекте, но его self-signed сертификат не является инструкцией для обхода защиты Quest.

## Сценарий буревой тревоги

- Шлем получает активный `dust_storm` по подписке событий.
- Триггер срабатывает, если буря пересекает маршрут впереди или уже окружает текущую виртуальную точку; повторное создание для того же маршрута и события подавляется.
- Текущая виртуальная позиция становится началом расчёта до базы экипажа. Буревые/критические области передаются поиску маршрута как закрытые; геометрия остаётся ограниченной загруженным DTM.
- При успешной записи меняется JSON маршрута, и Realtime обновляет все открытые страницы. Старые записи прогресса маршрута отбрасываются сравнением `generated_at`.
- Если база находится в закрытой области, слой местности отсутствует, база вне него или путь не найден, это не называется безопасным маршрутом: приложение сообщает об ошибке/ограничении. Решение остаётся за оператором.

## Не входит в эту итерацию

Нет серверной или аппаратной геолокации, записи аудио с Марса, реального биометрического датчика, нескольких пользователей с разными XR-сессиями, автономного offline-backend, новых VR-активов или нового Supabase проекта. Условия и показатели скафандра вычисляются клиентом для демонстрации.

См. [`STATE.md`](STATE.md) для итоговых проверок и [`VR_TEST.md`](VR_TEST.md) для обязательного теста на физическом Quest.
## Helmet visual bridge — 2026-11-14

EVA continues to open `/helmet/:crewId`, using Mars Ops' existing adapters and tables. The suit-style visor is an adapted visual component from the standalone ARES Helmet. Desktop uses a subtle transparent HTML frame; immersive WebXR adds a thin head-locked upper/lower rim inside the existing R3F scene. It does not capture or constrain real head tracking.

When the existing event adapter reports an active `dust_storm` in the crew's zone, the existing ambient sky/fog response intensifies and a low-cost procedural dust-particle field appears. A priority warning remains sourced from the same event/return-route logic and existing alert audio. Clearing/ending the event removes the added dust field as the event leaves the active set. This visual effect is a simulation. It does not model atmospheric fluid dynamics or claim measured storm opacity/speed.

Movement continues through Mars Ops' checked route progress and existing terrain/hazard guards. The visor is decorative framing; the transparent centre preserves view and controls. No extra backend or dependency was added.

## Scene budget and storm rendering — 2026-11-15

`npm run dev:vr` (alias of `dev:quest`) serves the app over HTTPS for the headset; open `/helmet`. The EVA scene now selects a rendering tier from the browser (`src/eva/quality.ts`): Quest / Pico get lower level-of-detail distances, a 1024² shadow map refreshed every third frame, fewer rocks and dust particles, framebuffer scale 1.0 and fixed foveation 0.45; a desktop gets the fuller settings. `?lite`, `?quest`, `?scale=`, `?fov=` override this. Geometry is drawn as chunked terrain with levels of detail and as welded meshes; dust, storm fronts and dust devils are GPU shaders driven by the same `events` rows and zone dust opacity as before. Route, hazard, recall and telemetry logic is unchanged. Details and measured scene complexity: `STATE.md`; device checks still to do: `VR_TEST.md`. Headset frame rate: **NOT TESTED ON DEVICE**.
