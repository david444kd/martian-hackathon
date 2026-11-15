// The astronaut on a zone map (ship and mission control): where the helmet says they are, which way
// they face, the path walked since this page opened, and a short status in the tooltip.
import { Marker, Polyline, Tooltip } from "react-leaflet";
import { useTranslation } from "react-i18next";
import type { AstronautView } from "../lib/astronaut";
import { astronautPin } from "./mapPins";
import { fmtKm } from "../lib/geo";

export function AstronautLayer({ a, label, permanent = true }: { a: AstronautView; label?: string; permanent?: boolean }) {
  const { t } = useTranslation();
  if (!a.at) return null;
  const tm = a.t, ago = tm ? Math.max(0, Math.round((Date.now() - Date.parse(tm.updated_at)) / 1000)) : null;
  return (
    <>
      {a.trail.length > 1 && <Polyline positions={a.trail} pathOptions={{ color: "#4fd1ff", weight: 2, opacity: 0.8, dashArray: "2 5" }} />}
      <Marker position={a.at} zIndexOffset={1000} icon={astronautPin(a.live ? tm?.heading_deg : null, a.live, tm?.mode === "return")}>
        <Tooltip direction="top" offset={[0, -12]} permanent={permanent}>
          <div className="text-xs leading-tight">
            <b>{label ?? t("common.astronaut")}</b>{tm?.mode === "return" && <span className="text-sky-600"> · {t("astro_layer.returning")}</span>}
            {a.live && tm ? (
              <div>{tm.speed_ms?.toFixed(1)} m/s · O₂ {tm.o2_pct?.toFixed(0)}% · {t("astro_layer.ago", { ago })}{tm.off_route_m != null && tm.off_route_m > 40 ? ` · ${t("astro_layer.off_route", { dist: fmtKm(tm.off_route_m) })}` : ""}</div>
            ) : (
              <div className="text-neutral-500">{tm ? t("astro_layer.signal_lost", { ago }) : t("astro_layer.from_route")}</div>
            )}
          </div>
        </Tooltip>
      </Marker>
    </>
  );
}
