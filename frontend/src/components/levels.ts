// How alert levels look everywhere: Tailwind classes for cards, hex colours for maps and 3D.
import type { Level } from "../lib/types";

export const LEVEL_CLASS: Record<Level, string> = {
  info: "border-sky-400/30 bg-sky-400/10 text-sky-200",
  warning: "border-amber-400/40 bg-amber-400/10 text-amber-200",
  critical: "border-red-500/50 bg-red-500/15 text-red-200",
};
export const LEVEL_COLOR: Record<Level, string> = { info: "#38bdf8", warning: "#fbbf24", critical: "#ef4444" };
