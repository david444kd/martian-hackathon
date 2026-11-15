# Mars Ops — hackathon

| папка | что | подробно |
|---|---|---|
| [`frontend/`](frontend/) | три веб-приложения: Mission Control, Ship Console, EVA Helmet (Vite + React + three.js, Supabase) | [`frontend/README.md`](frontend/README.md) |
| [`backend/`](backend/) | данные и алгоритмы на Python: рельеф Jezero из HiRISE/CTX, научные цели, маршруты, слои, локализация по горизонту (проверена на панорамах Perseverance) | [`backend/README.md`](backend/README.md), отчёт [`backend/out/REPORT.md`](backend/out/REPORT.md) |

## Фронт
```bash
cd frontend
npm install
npm run dev          # http://localhost:5173
```

## Деплой (Vercel)
Корневой `vercel.json` собирает из `frontend/` (`frontend/dist`), поэтому в настройках Vercel менять ничего не нужно.
Если в проекте Vercel поставить Root Directory = `frontend`, корневой `vercel.json` перестанет действовать:
тогда перенесите в `frontend/vercel.json` только блок `rewrites`.
