# Mars Ops — hackathon

Three interfaces for Mars surface operations, linked through Supabase (polling, no backend):

| Page | URL | Does |
|---|---|---|
| Dispatch | `/dispatch` | create / delete crews; create, edit, delete each crew's work plans (target picked on the map) |
| Ship | `/ship/:crewId` | the crew's plans; makes a safe walking route (A* in a Web Worker) and sends it to the astronaut |
| Astronaut | `/astronaut/:crewId/:planId` | follows the route in 3D: surface view (1:1) or relief model on a table; **Enter VR** on Meta Quest |

```
martian-hackathon/
├── src/lib/                  db (Supabase), queries (TanStack), zones, pathfind (A*), geo
├── src/pages/                Dispatch, Ship, Astronaut
├── src/astro/                the 3D / WebXR scene
├── public/zones/             512×512 heightmaps (20 m/px) of Jezero and Gale + zones.json
├── supabase/schema.sql       the two tables: crews, work_plans (route is a jsonb column)
└── scripts/build_zones.py    cuts the heightmaps from the 20 m DTMs (already done; output is committed)
```

## Run

Vite + React 19 + TypeScript, TanStack Query, react-router, three / react-three-fiber.

```bash
npm install
npm run dev          # http://localhost:5173
```

## Connect Supabase

1. Create a project on supabase.com.
2. SQL Editor → New query → paste `supabase/schema.sql` → Run.
3. Project Settings → API Keys: put the Project URL and the publishable key into `.env.local`
   (`VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`; see `.env.example`), restart `npm run dev`.

## Meta Quest 2

WebXR needs HTTPS. On the same Wi-Fi:
```bash
npm run dev:quest    # HTTPS on the local network, prints https://192.168.x.x:5173
```
Open that address in the Quest browser, accept the self-signed certificate, open a plan on the
Astronaut page → **Enter VR**. Right trigger: next checkpoint, left trigger: back, grip: map / surface.
A deployed copy (Vercel, Netlify, Cloudflare Pages) is HTTPS already.

## Routes

The ship's route search is a TypeScript port of martian-map's `pathfind.py`: A* over the zone's
heightmap; each step costs its suited walking time (Tobler's hiking function), slopes over 15° cost
6× more, over 25° are impassable; the grid path is then straightened. Saved as `work_plans.route`:
`{ start, target, points: [[lat, lon, elev], …] (~40 m apart), distance_m, duration_min, ascent_m, descent_m, max_slope_deg, generated_at }`.

When mission control moves a plan's target, the stored route is cleared so the crew makes a new one.
