// Map pins as Leaflet div icons styled with Tailwind classes.
import L from "leaflet";

export const DOT = "grid place-items-center rounded-full border-2 border-black/70 text-[10px] font-bold text-black shadow";

export const pin = (cls: string, html = "", size = 14) => L.divIcon({
  className: "map-pin",
  html: `<div class="${cls}" style="width:${size}px;height:${size}px">${html}</div>`,
  iconSize: [size, size],
  iconAnchor: [size / 2, size / 2],
});

/** the astronaut, live: a pulsing dot with an arrow where they are facing (stale: grey, no pulse) */
export const astronautPin = (heading: number | null | undefined, live: boolean, returning = false) => {
  const c = !live ? "#9aa4b2" : returning ? "#5fd8ff" : "#4fd1ff";
  const arrow = heading == null ? "" : `<div style="position:absolute;left:50%;top:50%;width:0;height:0;transform:translate(-50%,-50%) rotate(${heading}deg) translateY(-15px);border-left:6px solid transparent;border-right:6px solid transparent;border-bottom:10px solid ${c};filter:drop-shadow(0 0 2px #000)"></div>`;
  const ping = live ? `<div style="position:absolute;inset:0;border-radius:999px;background:${c}99;animation:ping 1.2s cubic-bezier(0,0,.2,1) infinite"></div>` : "";
  return L.divIcon({
    className: "map-pin",
    html: `<div style="position:relative;width:18px;height:18px">${ping}<div style="position:absolute;inset:0;border-radius:999px;background:${c};border:2px solid #04131b;box-shadow:0 0 14px ${c}"></div>${arrow}</div>`,
    iconSize: [18, 18],
    iconAnchor: [9, 9],
  });
};

export const LIVE_PIN ="relative rounded-full bg-live ring-4 ring-live/30 shadow-[0_0_16px_#4fd1ff] after:absolute after:inset-0 after:animate-ping after:rounded-full after:bg-live/60";
