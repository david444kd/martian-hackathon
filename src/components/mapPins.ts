// Map pins as Leaflet div icons styled with Tailwind classes.
import L from "leaflet";

export const DOT = "grid place-items-center rounded-full border-2 border-black/70 text-[10px] font-bold text-black shadow";

export const pin = (cls: string, html = "", size = 14) => L.divIcon({
  className: "map-pin",
  html: `<div class="${cls}" style="width:${size}px;height:${size}px">${html}</div>`,
  iconSize: [size, size],
  iconAnchor: [size / 2, size / 2],
});

export const LIVE_PIN = "relative rounded-full bg-live ring-4 ring-live/30 shadow-[0_0_16px_#4fd1ff] after:absolute after:inset-0 after:animate-ping after:rounded-full after:bg-live/60";
