// The operation zone as a pannable, zoomable map, locked to the zone: at the lowest zoom the zone
// fills the view, and you can't scroll past its edges (there's no terrain data, so no routes, outside).
// "Photo": orbital imagery, the sharpest available (CTX ~6 m, then HiRISE 25 cm when zoomed in).
// Both are greyscale cameras: one colour layer above them (blend mode "color") gives back Mars'
// butterscotch while keeping all their detail. "Relief": our 20 m shaded relief. The other base maps
// and the science layers (lib/marsLayers.ts, chosen in the LayerSwitcher) are NASA Mars Trek tiles;
// on the Jezero zone also the USGS 1:75,000 geologic map. They are pictures only: routes, hazards
// and the terrain still come from our DTM.
import { useEffect, useMemo, useState, type ReactNode } from "react";
import L from "leaflet";
import { ImageOverlay, MapContainer, Polygon, Popup, Rectangle, TileLayer, useMap, useMapEvents } from "react-leaflet";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { reliefCanvas } from "../lib/relief";
import type { Heightmap, Zone } from "../lib/zones";
import {
  BASE_RASTERS, OVERLAY_RASTERS, ZONE_BASES, ZONE_OVERLAYS, loadChoice, loadJezeroGeology, saveChoice,
  type JezeroGeology, type LayerChoice,
} from "../lib/marsLayers";
import { Keys, LayerSwitcher } from "./LayerSwitcher";

const TREK = (layer: string, ext = "png") => `https://trek.nasa.gov/tiles/Mars/EQ/${layer}/1.0.0/default/default028mm/{z}/{y}/{x}.${ext}`;
const CTX = "https://astro.arcgis.com/arcgis/rest/services/OnMars/CTX/MapServer/tile/{z}/{y}/{x}";
// the sharpest mosaic over each zone (the CTX tiles are 512 px, shown at 256: sharper on any screen)
const CLOSE_UP: Record<string, { url: string; maxNativeZoom: number }> = {
  jezero: { url: TREK("JEZ_hirise_soc_006_orthoMosaic_25cm_Eqc_latTs0_lon0_first_dd"), maxNativeZoom: 17 },
  gale: { url: TREK("curiosity_hirise_mosaic"), maxNativeZoom: 16 },
};

interface Props {
  zone: Zone;
  hm: Heightmap | undefined;
  onPick?: (lat: number, lon: number) => void;
  children?: ReactNode;
  className?: string;
}

export function ZoneLeafletMap({ zone, hm, onPick, children, className }: Props) {
  const { t } = useTranslation();
  const overlayIds = useMemo(() => ZONE_OVERLAYS.filter((o) => o !== "geology_jezero" || zone.id === "jezero"), [zone.id]);
  const [choice, setChoice] = useState<LayerChoice>(() => loadChoice("zone", { base: "photo", overlays: [] }, ZONE_BASES, ZONE_OVERLAYS));
  const choose = (c: LayerChoice) => { setChoice(c); saveChoice("zone", c); };
  const on = (o: LayerChoice["overlays"][number]) => choice.overlays.includes(o) && overlayIds.includes(o);
  const jez = useJezero(on("geology_jezero"));
  const raster = BASE_RASTERS[choice.base];
  const bounds = useMemo(() => L.latLngBounds([zone.south, zone.west], [zone.north, zone.east]), [zone]);
  const relief = useMemo(
    () => (hm ? reliefCanvas(hm.h, zone.width, zone.height, zone.dx, zone.dy, zone.min, zone.max).toDataURL() : null),
    [hm, zone],
  );
  const close = CLOSE_UP[zone.id];

  return (
    <div className={cn("relative isolate overflow-hidden bg-[#0d0907] [&_.leaflet-container]:bg-[#7b7671]", onPick && "[&_.leaflet-container]:cursor-crosshair", className)}>
      <MapContainer key={zone.id} crs={L.CRS.EPSG4326} center={bounds.getCenter()} zoom={12} maxZoom={18}
        maxBounds={bounds} maxBoundsViscosity={1} zoomSnap={0.25} zoomDelta={0.5} zoomControl={false} className="size-full">
        <Cover bounds={bounds} />
        <SciencePane />
        {choice.base === "photo" && (
          <>
            <TileLayer url={CTX} tileSize={256} maxNativeZoom={12} maxZoom={18} noWrap attribution="CTX (Caltech Murray Lab/Esri) · HiRISE (NASA/JPL/UArizona) · Mars Trek" />
            {close && <TileLayer url={close.url} tileSize={256} minZoom={13} maxNativeZoom={close.maxNativeZoom} maxZoom={18} noWrap bounds={bounds} />}
            <Tint bounds={bounds} />
          </>
        )}
        {raster && <TileLayer key={choice.base} url={raster.url} tileSize={256} maxNativeZoom={raster.maxNativeZoom} maxZoom={18} noWrap attribution={raster.attribution} />}
        {relief && <ImageOverlay url={relief} bounds={bounds} opacity={choice.base === "relief" ? 1 : 0.18} className={choice.base === "relief" ? "" : "mix-blend-multiply"} />}
        {overlayIds.map((o) => {
          const r = OVERLAY_RASTERS[o];
          return r && on(o) && <TileLayer key={o} pane="science" url={r.url} tileSize={256} maxNativeZoom={r.maxNativeZoom} maxZoom={18} noWrap opacity={r.opacity} attribution={r.attribution} />;
        })}
        {jez.data && <JezeroUnits geo={jez.data} interactive={!onPick} />}
        {onPick && <Clicks onPick={onPick} />}
        {children}
      </MapContainer>

      <LayerSwitcher className="absolute top-3 left-3 z-[600]" bases={ZONE_BASES} overlays={overlayIds} value={choice} onChange={choose}
        busy={jez.loading} error={jez.error}
        extraLegend={{
          geology_jezero: jez.data ? (
            <div className="space-y-1">
              <Keys items={Object.values(jez.data.units).map((u) => [u.colour, `${u.symbol} · ${u.name.replace(/ unit$/, "")}`] as [string, string])} />
              {!onPick && <p className="text-[10px] text-muted-foreground">{t("layers.geology_jezero_hint")}</p>}
            </div>
          ) : <p className="text-[10px] text-muted-foreground">{t("layers.geology_jezero_loading")}</p>,
        }} />
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

/** Mars' colour over the greyscale imagery, in its own pane between the tiles and the markers */
function Tint({ bounds }: { bounds: L.LatLngBounds }) {
  const map = useMap();
  const pane = useMemo(() => {
    const p = map.getPane("tint") ?? map.createPane("tint");
    p.style.zIndex = "250";
    p.style.mixBlendMode = "color";
    p.style.pointerEvents = "none";
    return "tint";
  }, [map]);
  return <Rectangle pane={pane} bounds={bounds.pad(0.05)} interactive={false} pathOptions={{ stroke: false, fillColor: "#c27a46", fillOpacity: 1 }} />;
}

/** science layers sit above the photo's colour tint (so it doesn't wash them out) and below markers */
function SciencePane() {
  const map = useMap();
  // created once during the first render, so the layers after it find the pane when they are added
  useState(() => {
    const p = map.getPane("science") ?? map.createPane("science");
    p.style.zIndex = "300";
    p.style.pointerEvents = "none";
    return p;
  });
  return null;
}

/** the Jezero 1:75,000 geologic map, fetched the first time it is switched on */
function useJezero(enabled: boolean) {
  const [state, setState] = useState<{ data: JezeroGeology | null; error: boolean }>({ data: null, error: false });
  useEffect(() => {
    if (!enabled || state.data) return;
    let live = true;
    loadJezeroGeology().then((data) => live && setState({ data, error: false }), () => live && setState({ data: null, error: true }));
    return () => { live = false; };
  }, [enabled, state.data]);
  return { data: enabled ? state.data : null, loading: enabled && !state.data && !state.error, error: enabled && state.error };
}

function JezeroUnits({ geo, interactive }: { geo: JezeroGeology; interactive: boolean }) {
  const map = useMap();
  const renderer = useMemo(() => L.canvas({ pane: "science", padding: 0.3 }), []);
  // the pane passes clicks through; a clickable map needs this pane to take them
  useEffect(() => {
    const p = map.getPane("science");
    if (p && interactive) p.style.pointerEvents = "auto";
    return () => { if (p) p.style.pointerEvents = "none"; };
  }, [map, interactive]);
  return (
    <>
      {geo.shapes.map(([code, rings], i) => {
        const u = geo.units[code];
        if (!u) return null;
        return (
          <Polygon key={i} positions={rings.map((r) => r.map(([x, y]) => [y, x] as [number, number]))} interactive={interactive}
            pathOptions={{ renderer, pane: "science", color: u.colour, weight: 0.8, opacity: 0.9, fillColor: u.colour, fillOpacity: 0.38, fillRule: "evenodd" }}>
            {interactive && (
              <Popup maxWidth={300}>
                <div className="text-xs">
                  <div className="mb-1 flex items-center gap-1.5 font-semibold"><i className="size-2.5 rounded-sm" style={{ background: u.colour }} />{u.name} ({u.symbol})</div>
                  <p className="leading-snug">{u.interpretation}</p>
                  <p className="mt-1 text-[10px] opacity-70">USGS SIM 3464 · Sun & Stack 2020 · 1:75,000</p>
                </div>
              </Popup>
            )}
          </Polygon>
        );
      })}
    </>
  );
}

function Clicks({ onPick }: { onPick: (lat: number, lon: number) => void }) {
  useMapEvents({ click: (e) => onPick(e.latlng.lat, e.latlng.lng) });
  return null;
}
