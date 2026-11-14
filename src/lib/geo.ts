import i18n from "../i18n";

const R = 3_389_500; // Mars mean radius, m

export function distanceM(lat1: number, lon1: number, lat2: number, lon2: number) {
  const r = Math.PI / 180, dLat = (lat2 - lat1) * r, dLon = (lon2 - lon1) * r;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

/** compass bearing in degrees, 0 = north, 90 = east */
export function bearingDeg(lat1: number, lon1: number, lat2: number, lon2: number) {
  const r = Math.PI / 180;
  const y = Math.sin((lon2 - lon1) * r) * Math.cos(lat2 * r);
  const x = Math.cos(lat1 * r) * Math.sin(lat2 * r) - Math.sin(lat1 * r) * Math.cos(lat2 * r) * Math.cos((lon2 - lon1) * r);
  return ((Math.atan2(y, x) / r) + 360) % 360;
}

const DEFAULT_POINTS = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
export const compass = (deg: number) => {
  const points = (i18n.t("units.compass_points", { returnObjects: true }) as string[]) || DEFAULT_POINTS;
  return points[Math.round(deg / 45) % 8];
};

export const fmtKm = (m: number) => {
  if (m < 1000) {
    return `${Math.round(m)} ${i18n.t("units.m", { defaultValue: "m" })}`;
  }
  const val = (m / 1000).toFixed(m < 10_000 ? 2 : 1);
  return `${val} ${i18n.t("units.km", { defaultValue: "km" })}`;
};

export const fmtDur = (min: number) => {
  const h = Math.floor(min / 60), m = Math.round(min % 60);
  if (h) {
    return i18n.t("units.hours_mins", { h, m: m.toString().padStart(2, "0"), defaultValue: `${h} h ${m.toString().padStart(2, "0")} min` });
  }
  return i18n.t("units.mins", { m, defaultValue: `${m} min` });
};

export const fmtLL = (lat: number, lon: number) =>
  `${Math.abs(lat).toFixed(4)}°${lat >= 0 ? "N" : "S"} ${Math.abs(lon).toFixed(4)}°${lon >= 0 ? "E" : "W"}`;

export const fmtDate = (iso: string | null) => {
  if (!iso) return "—";
  const loc = i18n.language === "kk" ? "kk-KZ" : i18n.language === "ru" ? "ru-RU" : "en-US";
  return new Date(iso).toLocaleString(loc, { dateStyle: "medium", timeStyle: "short" });
};
