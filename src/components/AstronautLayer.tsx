// The astronaut on a zone map (ship and mission control): where the helmet says they are, which way
// they face, the path walked since this page opened, and a short status in the tooltip.
import { Marker, Polyline, Tooltip } from "react-leaflet";
import type { AstronautView } from "../lib/astronaut";
import { astronautPin } from "./mapPins";
import { fmtKm } from "../lib/geo";

export function AstronautLayer({ a, label = "Astronaut", permanent = true }: { a: AstronautView; label?: string; permanent?: boolean }) {
  if (!a.at) return null;
  const t = a.t, ago = t ? Math.max(0, Math.round((Date.now() - Date.parse(t.updated_at)) / 1000)) : null;
  return (
    <>
      {a.trail.length > 1 && <Polyline positions={a.trail} pathOptions={{ color: "#4fd1ff", weight: 2, opacity: 0.8, dashArray: "2 5" }} />}
      <Marker position={a.at} zIndexOffset={1000} icon={astronautPin(a.live ? t?.heading_deg : null, a.live, t?.mode === "return")}>
        <Tooltip direction="top" offset={[0, -12]} permanent={permanent}>
          <div className="text-xs leading-tight">
            <b>{label}</b>{t?.mode === "return" && <span className="text-sky-600"> · returning</span>}
            {a.live && t ? (
              <div>{t.speed_ms?.toFixed(1)} m/s · O₂ {t.o2_pct?.toFixed(0)}% · {ago}s ago{t.off_route_m != null && t.off_route_m > 40 ? ` · ${fmtKm(t.off_route_m)} off route` : ""}</div>
            ) : (
              <div className="text-neutral-500">{t ? `signal lost ${ago}s ago` : "from route progress"}</div>
            )}
          </div>
        </Tooltip>
      </Marker>
    </>
  );
}
