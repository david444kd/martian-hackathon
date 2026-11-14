# Mars Ops — hackathon

Three applications for Mars surface operations on one codebase, linked through Supabase (each page
polls every 3 s; no backend of our own):

| App | URL | What it does |
|---|---|---|
| **Mission Control** | `/dispatch` | Mars globe with every crew and anomaly; register crews; create, edit, delete their work plans; raise anomalies, forecasts and messages |
| **Ship Console** | `/ship/:crewId` | the crew's zone on a full-screen map; makes a safe walking route for a plan (A* in a Web Worker, around slopes and anomalies), checks the EVA safety window, sends the route to the helmet, starts / ends the EVA, reroutes it around a new hazard |
| **EVA Helmet** | `/helmet/:crewId` | Meta Quest 2 (WebXR): shows the active EVA's route on the surface hands-free, alerts at eye level and read out loud; the walk is simulated and reported back as telemetry |

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
supabase/schema.sql   the tables: crews (landing point), work_plans (route + EVA progress), events
supabase/events.sql   just the events table, for a database made before it existed
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

## Space weather, anomalies and alerts

Two kinds of conditions, synchronised in two ways:

- **Background conditions are computed, not stored** (`src/lib/mars.ts`): local Mars time and season
  (NASA's Mars24 algorithm), air temperature, pressure, wind, dust opacity τ and the radiation dose
  rate, from the zone and the clock, after the climate measured by Curiosity (REMS, RAD) and
  Perseverance (MEDA). Every app runs the same function on the same clock, so all three agree.
- **Events are rows in `events`**: a dust storm, dust devil or rockfall over an area of a zone, a
  planet-wide solar particle event, or a message to one crew or all. `starts_at` in the future makes
  a forecast. Active events change the conditions (a storm raises τ and wind, a solar event
  multiplies the dose rate).

Everything else is derived on each client (`src/lib/hazards.ts`), so nothing extra is written:

- each crew's alerts: messages, anomalies in its zone (critical when one lies across the active
  route), forecasts for the next 12 h;
- the route search avoids anomaly areas active now or within 6 h (critical ones are closed);
- the pre-EVA check: walk there, 1 h of work, walk back; anomalies over the route, daylight, the
  expected dose against a 1 mSv limit; and a 24-hour outlook bar with the next safe start;
- on the ship, "Reroute around it" makes a new route from where the astronaut is, and the helmet
  switches to it.

The ship confirms messages addressed to its crew ("Got it"); mission control sees which ones
were confirmed. In the helmet new warnings sound a tone and are read out (speech synthesis).

## Data

- Heightmaps: CTX (Jezero) and HiRISE (Gale) DTMs at 20 m, via `scripts/build_zones.py`.
- Imagery: HiRISE / CTX mosaics from NASA Mars Trek and Esri (Caltech Murray Lab), fetched live by the
  maps and the helmet's close-up; the helmet's zone-wide textures come from `scripts/build_zone_photos.py`.
- Routes: A* over the heightmap, each step costing its suited walking time (Tobler's hiking
  function); slopes over 15° cost 6× more, over 25° are impassable; then straightened. Stored as
  `work_plans.route = { start, target, points: [[lat, lon, elev], …], distance_m, duration_min, ascent_m, descent_m, max_slope_deg, generated_at }`.
  When mission control moves a plan's target, the stored route is cleared so the ship makes a new one.
