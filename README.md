# Mars Ops — hackathon

Three applications for Mars surface operations on one codebase, linked through Supabase (each page
polls every 3 s; no backend of our own):

| App | URL | What it does |
|---|---|---|
| **Mission Control** | `/dispatch` | Mars globe with every crew on the surface; register crews; create, edit, delete their work plans |
| **Ship Console** | `/ship/:crewId` | the crew's zone on a full-screen map; makes a safe walking route for a plan (A* in a Web Worker), sends it to the helmet, starts / ends the EVA |
| **EVA Helmet** | `/helmet/:crewId` | Meta Quest 2 (WebXR): shows the active EVA's route on the surface hands-free; the walk is simulated and reported back as telemetry |

Stack: Vite, React 19, TypeScript, TanStack Query, react-router, Tailwind v4 + shadcn/ui,
react-leaflet (2D maps), three.js / react-three-fiber (globe and helmet).

```
src/
├── pages/            Dispatch, Ship, Helmet (one per app)
├── dispatch/         the globe and the dispatcher's dialogs
├── astro/            the helmet's 3D scene: terrain, close-up imagery, route, HUD, mini-map
├── components/       shared: zone map (Leaflet), map pins, status / route / EVA cards; ui/ = shadcn
└── lib/              Supabase access (db), TanStack Query hooks, zones, A* route search, geo helpers
public/
├── zones/            512×512 heightmaps (20 m/px) of Jezero and Gale, zones.json, 4096² photo textures
└── textures/         the globe's Mars map (Viking colour, 4096×2048)
supabase/schema.sql   the two tables: crews (with landing point), work_plans (route + EVA progress)
scripts/              one-off data builders (already run; their output is committed)
```

## Run

```bash
npm install
npm run dev          # http://localhost:5173
```

`.env.local` (see `.env.example`) holds `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY`.
A new Supabase project: SQL Editor → paste `supabase/schema.sql` → Run.

## Meta Quest 2

Open the deployed site (HTTPS) in the Quest browser → EVA Helmet → **Enter VR**. Everything after that
runs by itself: the helmet follows whichever plan the ship has started.

- `?speed=30` (default): how much faster than real walking the simulated EVA goes; `?speed=1` is real time
- `?lite`: cheaper rendering if the headset drops frames

To try the dev server in the headset instead: `npm run dev:quest` (HTTPS on the local network with a
self-signed certificate; accept the warning once).

## Data

- Heightmaps: CTX (Jezero) and HiRISE (Gale) DTMs at 20 m, via `scripts/build_zones.py`.
- Imagery: HiRISE / CTX mosaics from NASA Mars Trek and Esri (Caltech Murray Lab), fetched live by the
  maps and the helmet's close-up; the helmet's zone-wide textures come from `scripts/build_zone_photos.py`.
- Routes: A* over the heightmap, each step costing its suited walking time (Tobler's hiking
  function); slopes over 15° cost 6× more, over 25° are impassable; then straightened. Stored as
  `work_plans.route = { start, target, points: [[lat, lon, elev], …], distance_m, duration_min, ascent_m, descent_m, max_slope_deg, generated_at }`.
  When mission control moves a plan's target, the stored route is cleared so the ship makes a new one.
