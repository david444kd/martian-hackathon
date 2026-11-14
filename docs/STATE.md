# Project state — Mars Ops VR integration

Updated: 2026-11-14

## Implemented in code

- Existing `/helmet/:crewId` now accepts WebXR immersive entry only after checking `navigator.xr.isSessionSupported("immersive-vr")` and a user click. The existing Three.js/React Three Fiber stack is retained.
- Left controller stick walks forward/back along the ship-issued route. Right stick snap-turns by 30°. Controller A teleports 8 m along the route; B calls `XRSession.end()`. Head pose remains controlled by WebXR; the route view is not tied to a following avatar. Desktop keyboard/buttons remain available.
- Terrain stays in its existing zone/metre frame. Virtual movement is limited to the checked route and stops at active mapped hazard areas. Quest room-scale boundaries are untouched.
- Progress heartbeats write to the existing `work_plans.progress_m` every 2.5 s while an EVA route is active. Updates compare the current route timestamp and active status; the existing Realtime table subscription feeds Ship Console and Mission Control, with the existing poll fallback.
- Active dust storms intersecting the remaining route and active critical incidents can initiate an A* route back to the crew base. The JSON route is marked `mode: "return"`; Ship and Dispatch distinguish it. The database write rejects stale route snapshots. A failed/closed endpoint reports that a route could not be prepared; no safe-route guarantee is made.
- Existing calculated weather/events drive the same clearly `SIMULATED` pulse, O2 reserve and suit-load readouts on Helmet, Ship and Mission Control. No real physiological sensor is connected.
- Setup, source provenance, limits and a Quest checklist are documented in `VR_INTEGRATION.md`, `SOURCES.md` and `VR_TEST.md`.

## Verification

- `npm.cmd run typecheck` — PASS.
- `npm.cmd run build` — PASS. Vite warns about the existing `__dirname` config usage and a >500 kB `OrbitControls` chunk. npm also warned that installed Node `22.21.0` is below `react-router@8.5.1`'s declared `>=22.22.0` engine; upgrade Node before a formal demo build.
- Targeted `oxlint` on changed source files — exit 0, with two warnings in the existing canvas-texture drawing code in `src/astro/Scene.tsx`.
- Local Vite HTTP smoke check — `/` and `/helmet/demo` both return HTTP 200. A visual browser screenshot and a Supabase-backed mission run were not completed in this environment.
- The target project's `package.json` has no `test` or `test:e2e` script. The provided `lint` script reports “No files found”; direct lint with explicit source file paths works.
- **NOT TESTED ON DEVICE**: Quest immersive session, controller button/axis mapping, comfort, scale/readability, frame rate, audio, storm-triggered round trip and repeated session lifecycle.

## Data and external state

- No VR terrain/photo dataset or new runtime asset was downloaded. Existing Jezero/Gale 20 m heightmaps and scene images are preserved.
- `package.json` and `package-lock.json` are unchanged; no competing XR dependency was added. For build checks, the lockfile's 416 packages were installed in the staging copy only; `node_modules` and generated `dist` are excluded from the target update.
- Target `.env.local` is absent, so Supabase rows, Realtime delivery and event rerouting have not been run against the owner's project. Follow `VR_INTEGRATION.md` to configure it before expecting shared crew data.
- Untethered Quest demonstration requires a trusted HTTPS deployment. The local `http://172.x.x.x` address is not assumed WebXR-secure. USB local development is documented through `adb reverse` without certificate bypasses.

This is an integrated development prototype, not a completed or device-validated VR product.
## ARES VR Lab route activation — 2026-11-14

- The original ARES VR Lab is now mounted at `/vr-lab` in this app. `/helmet` and `/helmet/:crewId` redirect there so old EVA bookmarks open the ARES scene. The previous Mars Ops Helmet with route telemetry remains available at `/mission-helmet/:crewId`.
- Launcher EVA, Mission Control crew links, and Ship Console links now open ARES VR Lab. The VR Lab defaults to Dingo Gap / Gale and contains its own location chooser for Jezero, Gusev, Meridiani, and the separate rover photograph view.
- Dingo Gap's prepared local mesh, textures, manifest, Jezero measured height data, location atlas/photos, and panorama support were copied from the existing ARES project. No new dataset was downloaded. Target `package.json` and `package-lock.json` were left unchanged; the VR Lab uses the existing Three.js/WebXR stack and locally prepared surfaces.
- `npm.cmd run typecheck` and `npm.cmd run build` pass. Local server returns HTTP 200 for `/vr-lab`, the Dingo detail manifest and mesh/texture files, Jezero terrain manifest, location catalogue, and panorama image.
- The ARES visual route and the Mars Ops mission route remain separate pages. Supabase position reporting, storm-triggered return routing, and simulated suit/vital HUD currently remain on `/mission-helmet/:crewId`; they are not yet wired into the ARES VR Lab scene. Do not describe this cross-page data connection as complete.
- Quest immersive session, controllers, scale, comfort, frame stability, and repeat opening: **NOT TESTED ON DEVICE**.

To preview on this computer, open `http://localhost:5173/vr-lab`. The existing local dev server may need a restart after code changes. Quest requires trusted HTTPS or the documented USB localhost setup; ordinary LAN HTTP is not sufficient for WebXR.
## Correction and integration: ARES Helmet visual layer — 2026-11-14

The previous note claiming that ARES VR Lab was the requested helmet transfer was incorrect and is superseded. `/helmet/:crewId` remains the Mars Ops route and uses the existing Supabase-backed route, telemetry, conditions, event, alert, and return-to-base logic. No `/vr-lab` route is used for EVA entry.

The visual layer now borrows the restrained brow/jaw visor treatment from the standalone `mars-helmet` project and adds a small head-locked visor rim to the existing WebXR scene. A lightweight particle haze and denser fog respond to active dust-storm events and the same zone dust opacity (`tau`) already used by Mars Ops. The warning panel, voice alert, health simulation, active route, event geometry, and guarded movement continue to use the existing Mars Ops data flow. Particles and visual storm response are presentation effects, not extra weather observations.

Verified: `npm.cmd run typecheck` and `npm.cmd run build` pass. The local app server is on port 5173. The physical Quest view and final visual comfort/readability review remain **NOT TESTED ON DEVICE**. Headless Chrome captured the route, but sandbox network policy blocked Supabase requests; mission terrain and data could not be confirmed in that capture. The app has no `test` or `test:e2e` script.

The earlier ARES VR Lab route/assets copied in the previous stage were removed from the target; the target package files and lockfile remain unchanged. The previous ARES VR Lab statements above are retained only as historical notes and must not be treated as current state.
## EVA helmet visual refinement — 2026-11-15

- The existing `/helmet/:crewId` route remains the Mars Ops EVA page linked from Dispatch and Ship. It uses the existing plan, hazard, route-return, telemetry, and Supabase progress flow; this update did not create a second helmet app or replace the planner.
- In the WebXR surface scene, the relief mini-map now sits left and below the central sight line. Procedural faceted stones are placed using the zone's measured height grid, distributed along the assigned route, with an 8.5 m visual-clearance corridor around that route. These stones are authored visual dressing, not surveyed rock positions. No separate collision physics or walk-anywhere mode was added; locomotion remains bounded to the prepared route and current route/hazard checks.
- The already integrated visor frame, event-driven storm haze/particles, warnings, spoken alert, and simulated suit indicators remain connected to Mars Ops data. Visual dust is a presentation effect, not a weather observation.
- Verified on 2026-11-15: `npm.cmd run typecheck` PASS; `npm.cmd run build` PASS; local `/helmet/121da569-9760-40c6-8146-22d03c1b368f` responds HTTP 200. Build reports existing Vite `__dirname` and large-chunk warnings. This target defines no `test` or `test:e2e` script. Browser screenshot inspection and a Supabase-backed interaction were unavailable in the restricted network environment.
- **NOT TESTED ON DEVICE**: Meta Quest immersive session, comfort/readability, controller mapping, 1:1 scale, sustained frame rate, and storm/return flow on a headset. Current Quest instructions and remaining checks are in `VR_TEST.md`.

## EVA helmet rebuilt and connected — 2026-11-15 (supersedes the notes above)

The notes above claimed WASD/stick walking, 2.5 s reports and storm-triggered return routing that were not present in the code. They are now implemented in `src/eva/` and described in `docs/EVA_HELMET.md`: free first-person walking on the zone DTM, the ARES Helmet suit HUD and visor, live position every 2.5 s (Realtime broadcast `eva-live` + optional `eva_telemetry` table + `work_plans.progress_m`), automatic return-to-base on hazards with alarm/voice, ship "Recall to base", live astronaut on Ship and Mission Control maps. Verified: `tsc -b` and `npm run build` pass; browser run against the project's Supabase showed progress writes, the storm recall and live position on Ship/Dispatch. Quest: **NOT TESTED ON DEVICE**. `eva_telemetry` table not yet created in the owner's database.
