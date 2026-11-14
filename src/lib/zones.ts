// Operation zones: 512 x 512 heightmaps (20 m/px) cut from the Jezero and Gale DTMs by
// scripts/build_zones.py. Grid cell (col, row) has its centre at x = col + 0.5, y = row + 0.5;
// row 0 is the northern edge.
import { useQuery } from "@tanstack/react-query";

export interface Zone {
  id: string;
  name: string;
  description: string;
  file: string;
  width: number;
  height: number;
  north: number;
  south: number;
  west: number;
  east: number;
  dx: number; // metres per pixel east-west
  dy: number; // metres per pixel north-south
  min: number;
  max: number;
  base: { name: string; lat: number; lon: number };
}

export interface Heightmap {
  zone: Zone;
  h: Float32Array;
}

export const useZones = () =>
  useQuery({
    queryKey: ["zones"],
    queryFn: async () => (await (await fetch("/zones/zones.json")).json()) as Zone[],
    staleTime: Infinity,
  });

export function useZone(id: string | undefined) {
  const zones = useZones();
  return zones.data?.find((z) => z.id === id);
}

export function useHeightmap(zone: Zone | undefined) {
  return useQuery({
    queryKey: ["heightmap", zone?.id],
    queryFn: async (): Promise<Heightmap> => {
      const buf = await (await fetch(zone!.file)).arrayBuffer();
      return { zone: zone!, h: new Float32Array(buf) };
    },
    enabled: !!zone,
    staleTime: Infinity,
  });
}

/** lat/lon → pixel coordinates (continuous; cell centres at .5) */
export function toPx(z: Zone, lat: number, lon: number): [number, number] {
  return [((lon - z.west) / (z.east - z.west)) * z.width, ((z.north - lat) / (z.north - z.south)) * z.height];
}

export function toLL(z: Zone, x: number, y: number): [number, number] {
  return [z.north - (y / z.height) * (z.north - z.south), z.west + (x / z.width) * (z.east - z.west)];
}

export function inZone(z: Zone, lat: number, lon: number) {
  return lat <= z.north && lat >= z.south && lon >= z.west && lon <= z.east;
}

/** bilinear height at pixel coordinates */
export function heightAt(h: Float32Array, w: number, ht: number, x: number, y: number): number {
  const fx = Math.min(Math.max(x - 0.5, 0), w - 1.001), fy = Math.min(Math.max(y - 0.5, 0), ht - 1.001);
  const x0 = Math.floor(fx), y0 = Math.floor(fy), tx = fx - x0, ty = fy - y0;
  const i = y0 * w + x0;
  const top = h[i] * (1 - tx) + h[i + 1] * tx;
  const bot = h[i + w] * (1 - tx) + h[i + w + 1] * tx;
  return top * (1 - ty) + bot * ty;
}

export const elevationAt = (hm: Heightmap, lat: number, lon: number) => {
  const [x, y] = toPx(hm.zone, lat, lon);
  return heightAt(hm.h, hm.zone.width, hm.zone.height, x, y);
};

/** where a crew landed: its own point, or its zone's base */
export function crewHome(crew: { lat: number | null; lon: number | null }, zone: Zone | undefined): [number, number] | null {
  if (crew.lat != null && crew.lon != null) return [crew.lat, crew.lon];
  return zone ? [zone.base.lat, zone.base.lon] : null;
}
