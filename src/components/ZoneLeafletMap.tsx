// The operation zone as a pannable, zoomable map, locked to the zone: at the lowest zoom the zone
// fills the view, and you can't scroll past its edges (there's no terrain data, so no routes, outside).
// "Photo": orbital imagery, sharpest available (Viking colour → CTX ~6 m → HiRISE 25 cm), tinted
// to Mars' colour since CTX and HiRISE are greyscale cameras. "Relief": our 20 m shaded relief.
import { useEffect, useMemo, useState, type ReactNode } from "react";
import L from "leaflet";
import { ImageOverlay, MapContainer, TileLayer, useMap, useMapEvents } from "react-leaflet";
import { Image as ImageIcon, Mountain } from "lucide-react";
import { cn } from "@/lib/utils";
import { reliefCanvas } from "../lib/relief";
import type { Heightmap, Zone } from "../lib/zones";

const TREK = (layer: string, ext = "png") => `https://trek.nasa.gov/tiles/Mars/EQ/${layer}/1.0.0/default/default028mm/{z}/{y}/{x}.${ext}`;
const VIKING = TREK("Mars_Viking_MDIM21_ClrMosaic_global_232m", "jpg");
const CTX = "https://astro.arcgis.com/arcgis/rest/services/OnMars/CTX/MapServer/tile/{z}/{y}/{x}";
// the sharpest mosaic over each zone
const CLOSE_UP: Record<string, { url: string; maxNativeZoom: number }> = {
  jezero: { url: TREK("JEZ_hirise_soc_006_orthoMosaic_25cm_Eqc_latTs0_lon0_first_dd"), maxNativeZoom: 17 },
  gale: { url: TREK("curiosity_hirise_mosaic"), maxNativeZoom: 16 },
};

type Mode = "photo" | "relief";

interface Props {
  zone: Zone;
  hm: Heightmap | undefined;
  onPick?: (lat: number, lon: number) => void;
  children?: ReactNode;
  className?: string;
}

export function ZoneLeafletMap({ zone, hm, onPick, children, className }: Props) {
  const [mode, setMode] = useState<Mode>("photo");
  const bounds = useMemo(() => L.latLngBounds([zone.south, zone.west], [zone.north, zone.east]), [zone]);
  const relief = useMemo(
    () => (hm ? reliefCanvas(hm.h, zone.width, zone.height, zone.dx, zone.dy, zone.min, zone.max).toDataURL() : null),
    [hm, zone],
  );
  const close = CLOSE_UP[zone.id];

  return (
    <div className={cn("relative overflow-hidden bg-[#0d0907]", onPick && "[&_.leaflet-container]:cursor-crosshair", className)}>
      <MapContainer key={zone.id} crs={L.CRS.EPSG4326} center={bounds.getCenter()} zoom={12} maxZoom={18}
        maxBounds={bounds} maxBoundsViscosity={1} zoomSnap={0.25} zoomDelta={0.5} zoomControl={false} className="size-full">
        <Cover bounds={bounds} />
        {mode === "photo" ? (
          <>
            <TileLayer url={VIKING} tileSize={256} maxNativeZoom={7} maxZoom={18} noWrap attribution="Viking · CTX (Caltech Murray Lab/Esri) · HiRISE (NASA/JPL/UArizona) · Mars Trek" />
            <TileLayer url={CTX} tileSize={256} maxNativeZoom={12} maxZoom={18} noWrap className="mars-tint" />
            {close && <TileLayer url={close.url} tileSize={256} minZoom={13} maxNativeZoom={close.maxNativeZoom} maxZoom={18} noWrap bounds={bounds} className="mars-tint" />}
            {relief && <ImageOverlay url={relief} bounds={bounds} opacity={0.18} className="mix-blend-multiply" />}
          </>
        ) : (
          relief && <ImageOverlay url={relief} bounds={bounds} opacity={1} />
        )}
        {onPick && <Clicks onPick={onPick} />}
        {children}
      </MapContainer>

      <div className="absolute top-3 right-3 z-[500] flex rounded-lg border bg-card/85 p-0.5 text-xs backdrop-blur">
        {([["photo", "Photo", ImageIcon], ["relief", "Relief", Mountain]] as const).map(([m, label, Icon]) => (
          <button key={m} type="button" onClick={() => setMode(m)}
            className={cn("flex items-center gap-1.5 rounded-md px-2.5 py-1 transition-colors", mode === m ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground")}>
            <Icon className="size-3.5" />{label}
          </button>
        ))}
      </div>
    </div>
  );
}

/** keep the zone covering the whole view: the lowest zoom is the one where it just fills the map */
function Cover({ bounds }: { bounds: L.LatLngBounds }) {
  const map = useMap();
  useEffect(() => {
    let first = true;
    const fit = () => {
      map.invalidateSize();
      const z = map.getBoundsZoom(bounds, true);
      map.setMinZoom(z);
      if (first || map.getZoom() < z) map.setView(bounds.getCenter(), z, { animate: false });
      first = false;
    };
    fit();
    // the container may still be growing (a dialog opening): refit as it settles
    const ro = new ResizeObserver(fit);
    ro.observe(map.getContainer());
    return () => ro.disconnect();
  }, [map, bounds]);
  return null;
}

function Clicks({ onPick }: { onPick: (lat: number, lon: number) => void }) {
  useMapEvents({ click: (e) => onPick(e.latlng.lat, e.latlng.lng) });
  return null;
}
