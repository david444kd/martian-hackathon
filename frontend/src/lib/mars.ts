// Surface conditions in an operation zone at a given moment. Nothing here is stored: every app calls
// the same functions with the same clock, so mission control, the ship and the helmet always show the
// same numbers. The background follows real Mars time and season (NASA's Mars24 algorithm) and the
// climate measured by Curiosity (REMS, RAD) and Perseverance (MEDA); active events (the `events` table)
// push it around: a dust storm thickens the air, a solar particle event multiplies the radiation.
import { useEffect, useState } from "react";
import i18n from "../i18n";
import { EVENT_KINDS, type MarsEvent } from "./types";
import type { Zone } from "./zones";

const deg = Math.PI / 180;
const mod = (a: number, n: number) => ((a % n) + n) % n;

export interface MarsTime {
  msd: number;   // Mars Sol Date (sols since 29 Dec 1873)
  lmst: number;  // local mean solar time at the longitude, hours 0-24
  ls: number;    // solar longitude, degrees: the season (0 = northern spring equinox)
}

/** Mars24 (Allison & McEwen 2000), without the small planetary perturbation terms */
export function marsTime(t: number, lonEast: number): MarsTime {
  const jdTT = t / 86_400_000 + 2_440_587.5 + 69.184 / 86_400;
  const d = jdTT - 2_451_545.0;
  const M = (19.3871 + 0.52402073 * d) * deg;
  const alpha = 270.3871 + 0.524038496 * d;
  const eoc = (10.691 + 3e-7 * d) * Math.sin(M) + 0.623 * Math.sin(2 * M) + 0.05 * Math.sin(3 * M) + 0.005 * Math.sin(4 * M);
  const msd = (d - 4.5) / 1.0274912517 + 44_796.0 - 0.0009626;
  return { msd, lmst: mod(24 * msd + lonEast / 15, 24), ls: mod(alpha + eoc, 360) };
}

export const fmtLmst = (h: number) => `${String(Math.floor(h)).padStart(2, "0")}:${String(Math.floor((h % 1) * 60)).padStart(2, "0")}`;

export function season(ls: number, lat: number) {
  const north = ["spring", "summer", "autumn", "winter"][Math.floor(ls / 90) % 4];
  const flip: Record<string, string> = { spring: "autumn", summer: "winter", autumn: "spring", winter: "summer" };
  const s = lat >= 0 ? north : flip[north];
  return i18n.t(`seasons.${s}`, { defaultValue: s });
}

export interface Conditions {
  time: MarsTime;
  daylight: boolean;
  tempC: number;      // air temperature at 1.5 m
  pressurePa: number;
  windMs: number;
  tau: number;        // dust optical depth (0.5 clear-ish, > 2 storm)
  doseUSvH: number;   // radiation dose-equivalent rate, µSv/h
}

/** has the event started and not yet ended at time t */
export const isActive = (e: MarsEvent, t: number) => Date.parse(e.starts_at) <= t && (!e.ends_at || Date.parse(e.ends_at) > t);

/** is the event an anomaly that changes the weather in this zone (the whole planet for a null zone) */
export const touchesZone = (e: MarsEvent, zoneId: string) => e.kind !== "message" && (e.zone == null || e.zone === zoneId);

/** RAD on Curiosity: ~0.67 mSv a sol at Gale (-4.5 km); thinner air above means a little more */
const BASE_DOSE = 28;
const SOLAR_X = { info: 2, warning: 6, critical: 40 } as const;
const STORM_TAU = { info: 0.8, warning: 2.2, critical: 4.5 } as const;

export function conditions(zone: Zone, t: number, events: MarsEvent[] = []): Conditions {
  const time = marsTime(t, zone.base.lon);
  const { lmst, ls } = time;
  const elev = (zone.min + zone.max) / 2;

  // dust: the dusty season is southern spring and summer (Ls 180-360), plus storms in the zone
  let tau = 0.45 + 0.45 * Math.max(0, Math.sin((ls - 180) * deg));
  let wind = 0, dose = 1;
  for (const e of events) {
    if (!isActive(e, t) || !touchesZone(e, zone.id)) continue;
    if (e.kind === "dust_storm") { tau += STORM_TAU[e.level]; wind += e.level === "critical" ? 24 : 15; }
    if (e.kind === "dust_devil") wind += 6;
    if (e.kind === "solar_storm") dose *= SOLAR_X[e.level];
  }

  // pressure: the CO2 cycle (lowest around Ls 150, highest around Ls 250) and the zone's elevation
  const pressure = (800 + 95 * Math.cos((ls - 250) * deg)) * Math.exp(-(elev + 4500) / 11_000) * (1 + 0.03 * Math.cos(((lmst - 7) / 24) * 2 * Math.PI));

  // temperature: coldest just before dawn, warmest early afternoon; dust flattens the swing
  const warm = lmst >= 5.5 && lmst < 14;
  const f = warm ? -Math.cos(((lmst - 5.5) / 8.5) * Math.PI) : Math.cos(((mod(lmst - 14, 24)) / 15.5) * Math.PI);
  const mean = -52 + 7 * Math.cos((ls - 250) * deg) - 0.3 * Math.abs(zone.base.lat);
  const swing = 36 / (1 + 0.45 * Math.max(0, tau - 0.5));
  const temp = mean + swing * f + (tau > 1.5 ? 6 : 0); // a dusty night is warmer

  const daylight = lmst >= 6 && lmst < 18;
  wind += 3 + (daylight ? 5 * Math.sin(((lmst - 6) / 12) * Math.PI) : 1);
  dose *= BASE_DOSE * Math.pow(800 / pressure, 0.35);

  return {
    time, daylight,
    tempC: Math.round(temp),
    pressurePa: Math.round(pressure),
    windMs: Math.round(wind),
    tau: Math.round(tau * 100) / 100,
    doseUSvH: Math.round(dose),
  };
}

/** the dose over [t0, t1] in mSv (10-minute steps) */
export function doseOver(zone: Zone, t0: number, t1: number, events: MarsEvent[]) {
  let uSv = 0;
  const step = 10 * 60_000;
  for (let t = t0; t < t1; t += step) uSv += conditions(zone, t, events).doseUSvH * (Math.min(step, t1 - t) / 3_600_000);
  return uSv / 1000;
}

/** re-render every `ms` (the clock all the conditions are computed from) */
export function useNow(ms = 15_000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(id);
  }, [ms]);
  return now;
}

export const eventLabel = (e: MarsEvent) => e.title || i18n.t(`event_kinds.${e.kind}.label`, { defaultValue: EVENT_KINDS[e.kind]?.label || e.kind });
