# Живой голос для шлема

Шлем говорит на языке интерфейса, по умолчанию на **английском**. Записи лежат по папкам языков:
`public/voice/en/`, `public/voice/ru/`, `public/voice/kk/`. Положите mp3 с именем из таблицы в
папку нужного языка, и шлем проиграет запись (с радиоэффектом) вместо синтезатора речи. Если файла
нет, фразу читает лучший голос системы на этом языке. Для казахского, если в системе нет казахского
голоса, используется русский, затем английский. Записывайте спокойно, как в эфире, без пауз в начале
и в конце; 1–3 секунды на фразу.

Сейчас записей нет ни в одной папке: всё озвучивает синтезатор. Тексты фраз для всех трёх языков лежат
в `src/i18n/locales/*.ts`, раздел `voice`.

## Английский (`en/`, основной)

| Файл | Текст |
|---|---|
| `abort-dust_storm.mp3` | Dust storm ahead. Abort, head back to base. |
| `abort-dust_devil.mp3` | Dust devil ahead. Abort, head back to base. |
| `abort-rockfall.mp3` | Rockfall ahead. Abort, head back to base. |
| `abort-solar_storm.mp3` | Solar flare ahead. Abort, head back to base. |
| `route-home.mp3` | Route home is up. Follow the blue. *(синтезатор ещё называет расстояние)* |
| `route-home-updated.mp3` | Route home updated. |
| `no-way.mp3` | No clear way back. Hold position, stand by. |
| `recall-ship.mp3` | Ship here. Head back, the route is on your display. |
| `new-route.mp3` | New route is up. |
| `off-route.mp3` | Off the route. Rerouting. |
| `no-reroute.mp3` | Can't route from here. Get back to the line. |
| `on-target.mp3` | You're on target. |
| `airlock.mp3` | Airlock. Welcome back. |
| `alert-dust_storm-route.mp3` | Dust storm on the route. |
| `alert-dust_storm-route-critical.mp3` | Dust storm on the route! |
| `alert-dust_storm-zone.mp3` | Dust storm nearby. |
| `alert-dust_storm-forecast.mp3` | Heads up, dust storm soon. |
| `alert-dust_devil-route.mp3` / `-zone` / `-forecast` | Dust devil on the route. / …nearby. / Heads up, dust devil soon. |
| `alert-rockfall-route-critical.mp3` / `-zone` | Rockfall on the route! / Rockfall nearby. |
| `alert-solar_storm-planet-critical.mp3` | Solar flare. Take shelter now. |
| `alert-solar_storm-planet.mp3` | Solar flare. Stay alert. |

## Русский (`ru/`) и казахский (`kk/`)

Те же имена файлов, тексты в разделе `voice` файлов `src/i18n/locales/ru.ts` и `kk.ts`.

Сообщения диспетчера и корабля (свободный текст) всегда читает синтезатор.
