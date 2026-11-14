// A zone's shaded-relief map with markers and routes on an SVG layer in pixel coordinates.
// Click to pick a point when onPick is given (used by the dispatcher's dialogs).
import { useEffect, useRef, type MouseEvent } from "react";
import { cn } from "@/lib/utils";
import { toLL, toPx, type Heightmap } from "../lib/zones";
import type { RoutePoint } from "../lib/types";
import { reliefCanvas } from "../lib/relief";

export interface MapMarker { lat: number; lon: number; color: string; label: string }
export interface MapRoute { points: RoutePoint[]; color: string; dashed?: boolean }

interface Props {
  hm: Heightmap | undefined;
  markers?: MapMarker[];
  routes?: MapRoute[];
  onPick?: (lat: number, lon: number) => void;
  hint?: string;
  className?: string;
}

export function ZoneMap({ hm, markers = [], routes = [], onPick, hint, className }: Props) {
  const canvas = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const c = canvas.current;
    if (!c || !hm) return;
    const z = hm.zone, src = reliefCanvas(hm.h, z.width, z.height, z.dx, z.dy, z.min, z.max);
    c.width = z.width;
    c.height = z.height;
    c.getContext("2d")!.drawImage(src, 0, 0);
  }, [hm]);

  const box = cn("relative aspect-square w-full overflow-hidden rounded-xl border bg-black/40", className);
  if (!hm) return <div className={cn(box, "grid place-items-center text-sm text-muted-foreground")}>Loading terrain…</div>;
  const z = hm.zone;
  const click = (e: MouseEvent<SVGSVGElement>) => {
    if (!onPick) return;
    const r = e.currentTarget.getBoundingClientRect();
    const [lat, lon] = toLL(z, ((e.clientX - r.left) / r.width) * z.width, ((e.clientY - r.top) / r.height) * z.height);
    onPick(lat, lon);
  };
  const kmBar = 1000 / z.dx;
  const outline = { paintOrder: "stroke" as const, stroke: "#000", strokeWidth: 4 };

  return (
    <div className={box}>
      <canvas ref={canvas} className="absolute inset-0 size-full" />
      <svg viewBox={`0 0 ${z.width} ${z.height}`} onClick={click} className={cn("absolute inset-0 size-full", onPick && "cursor-crosshair")}>
        {routes.map((r, k) => (
          <polyline key={k} fill="none" stroke={r.color} strokeWidth={3} strokeDasharray={r.dashed ? "8 6" : undefined}
            strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke"
            points={r.points.map(([lat, lon]) => toPx(z, lat, lon).join(",")).join(" ")} />
        ))}
        {markers.map((m, k) => {
          const [x, y] = toPx(z, m.lat, m.lon);
          return (
            <g key={k} transform={`translate(${x} ${y})`}>
              <circle r={7} fill={m.color} stroke="#111" strokeWidth={2} />
              <text y={-13} textAnchor="middle" fill="#fff" fontSize={15} fontWeight={600} style={outline}>{m.label}</text>
            </g>
          );
        })}
        <g transform={`translate(16 ${z.height - 16})`}>
          <line x1={0} x2={kmBar} y1={0} y2={0} stroke="#fff" strokeWidth={3} />
          <text x={kmBar / 2} y={-6} textAnchor="middle" fill="#fff" fontSize={12} style={{ ...outline, strokeWidth: 3 }}>1 km</text>
        </g>
      </svg>
      {hint && <div className="pointer-events-none absolute inset-x-2 top-2 text-xs text-white [text-shadow:0_1px_2px_#000]">{hint}</div>}
    </div>
  );
}
