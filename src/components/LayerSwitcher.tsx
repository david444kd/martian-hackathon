// The map-layer chooser shared by the zone maps and the mission-control globe: one button showing
// the current base map, opening a panel with the base maps (one at a time) and the science layers
// (any number), each with its source and, when on, what its colours mean.
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Check, Layers, Loader2, TriangleAlert, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { ACTIVE_COLORS, MINERAL_COLORS, RAMPS, type BaseId, type LayerChoice, type OverlayId } from "../lib/marsLayers";

interface Props {
  bases: BaseId[];
  overlays: OverlayId[];
  value: LayerChoice;
  onChange: (c: LayerChoice) => void;
  /** a layer is still loading (the globe stitches its texture) */
  busy?: boolean;
  /** some tiles or data failed */
  error?: boolean;
  /** open the panel upwards (the button sits at the bottom of its view) */
  up?: boolean;
  /** align the panel to the button's right edge */
  alignRight?: boolean;
  /** legends that depend on loaded data (the Jezero units) */
  extraLegend?: Partial<Record<OverlayId, ReactNode>>;
  className?: string;
}

export function LayerSwitcher({ bases, overlays, value, onChange, busy, error, up, alignRight, extraLegend, className }: Props) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const down = (e: PointerEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false); };
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("pointerdown", down);
    document.addEventListener("keydown", key);
    return () => { document.removeEventListener("pointerdown", down); document.removeEventListener("keydown", key); };
  }, [open]);

  const toggle = (o: OverlayId) =>
    onChange({ ...value, overlays: value.overlays.includes(o) ? value.overlays.filter((x) => x !== o) : [...value.overlays, o] });
  const count = value.overlays.length;

  return (
    <div ref={box} className={cn("relative text-xs", className)}
      // keep map gestures (drag, wheel, click-to-pick) out of the panel
      onPointerDown={(e) => e.stopPropagation()} onWheel={(e) => e.stopPropagation()} onClick={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()}>
      <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} title={t("layers.title")}
        className={cn("flex items-center gap-1.5 rounded-lg border bg-card/85 px-2.5 py-1.5 backdrop-blur transition-colors hover:text-foreground",
          open ? "text-foreground" : "text-muted-foreground")}>
        {busy ? <Loader2 className="size-3.5 animate-spin" /> : error ? <TriangleAlert className="size-3.5 text-amber-400" /> : <Layers className="size-3.5" />}
        <span className="font-medium text-foreground">{t(`layers.${value.base}`)}</span>
        {count > 0 && <span className="rounded-full bg-primary px-1.5 text-[10px] leading-4 font-semibold text-primary-foreground">+{count}</span>}
      </button>

      {open && (
        <div role="dialog" aria-label={t("layers.title")}
          className={cn("absolute z-[1000] flex max-h-[min(70vh,520px)] w-72 flex-col overflow-hidden rounded-xl border bg-card/95 shadow-xl backdrop-blur-md",
            up ? "bottom-full mb-2" : "top-full mt-2", alignRight ? "right-0" : "left-0")}>
          <div className="flex items-center justify-between border-b px-3 py-2">
            <span className="text-sm font-semibold">{t("layers.title")}</span>
            <button type="button" onClick={() => setOpen(false)} className="rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground" aria-label={t("layers.close")}>
              <X className="size-3.5" />
            </button>
          </div>
          <div className="overflow-y-auto p-1.5">
            <Group title={t("layers.group_base")}>
              {bases.map((b) => (
                <Row key={b} id={b} on={value.base === b} radio onClick={() => onChange({ ...value, base: b })}>
                  {value.base === b && <Legend id={b} />}
                </Row>
              ))}
            </Group>
            <Group title={t("layers.group_science")}>
              {overlays.map((o) => (
                <Row key={o} id={o} on={value.overlays.includes(o)} onClick={() => toggle(o)}>
                  {value.overlays.includes(o) && (extraLegend?.[o] ?? <Legend id={o} />)}
                </Row>
              ))}
            </Group>
            {error && <p className="flex items-start gap-1.5 px-2 py-1.5 text-amber-300"><TriangleAlert className="mt-px size-3.5 shrink-0" />{t("layers.failed")}</p>}
            <p className="px-2 pt-1 pb-1.5 text-[10px] leading-snug text-muted-foreground">{t("layers.credit")}</p>
          </div>
        </div>
      )}
    </div>
  );
}

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="mb-1">
      <div className="px-2 pt-1.5 pb-1 text-[10px] font-medium tracking-wider text-muted-foreground uppercase">{title}</div>
      {children}
    </div>
  );
}

function Row({ id, on, radio, onClick, children }: { id: BaseId | OverlayId; on: boolean; radio?: boolean; onClick: () => void; children?: ReactNode }) {
  const { t } = useTranslation();
  return (
    <div className={cn("rounded-lg transition-colors", on ? "bg-primary/12" : "hover:bg-muted")}>
      <button type="button" onClick={onClick} role={radio ? "radio" : "checkbox"} aria-checked={on}
        className="flex w-full items-start gap-2 px-2 py-1.5 text-left">
        <span className={cn("mt-0.5 grid size-3.5 shrink-0 place-items-center border transition-colors",
          radio ? "rounded-full" : "rounded-[4px]", on ? "border-primary bg-primary text-primary-foreground" : "border-muted-foreground/50")}>
          {on && (radio ? <span className="size-1.5 rounded-full bg-primary-foreground" /> : <Check className="size-2.5" strokeWidth={3} />)}
        </span>
        <span className="min-w-0">
          <span className={cn("block font-medium", on ? "text-foreground" : "text-foreground/90")}>{t(`layers.${id}`)}</span>
          <span className="block text-[10px] leading-snug text-muted-foreground">{t(`layers.${id}_note`)}</span>
        </span>
      </button>
      {children && <div className="px-2 pb-2 pl-7.5">{children}</div>}
    </div>
  );
}

/** what the colours of a layer mean */
function Legend({ id }: { id: BaseId | OverlayId }) {
  const { t } = useTranslation();
  const ramp = RAMPS[id];
  if (ramp) return (
    <div className="text-[10px] text-muted-foreground">
      <div className="h-1.5 rounded-full" style={{ background: ramp }} />
      <div className="mt-0.5 flex justify-between gap-2"><span>{t(`layers.${id}_low`)}</span><span className="text-right">{t(`layers.${id}_high`)}</span></div>
    </div>
  );
  if (id === "minerals") return (
    <Keys items={[
      [MINERAL_COLORS.phyllosilicate, t("layers.min_clay")], [MINERAL_COLORS.silica, t("layers.min_silica")],
      [MINERAL_COLORS.sulfate, t("layers.min_sulfate")], [MINERAL_COLORS.chloride, t("layers.min_chloride")],
      [MINERAL_COLORS.carbonate, t("layers.min_carbonate")], [MINERAL_COLORS.hydrous, t("layers.min_hydrous")],
    ]} />
  );
  if (id === "ice") return (
    <Keys items={[
      [ACTIVE_COLORS.ice, t("layers.act_ice")], [ACTIVE_COLORS.rsl, t("layers.act_rsl")],
      [ACTIVE_COLORS.gully, t("layers.act_gully")], [ACTIVE_COLORS.fresh, t("layers.act_fresh")],
    ]} />
  );
  if (id === "geology") return <p className="text-[10px] leading-snug text-muted-foreground">{t("layers.geology_legend")}</p>;
  return null;
}

export function Keys({ items }: { items: [string, string][] }) {
  return (
    <div className="grid grid-cols-2 gap-x-2 gap-y-0.5 text-[10px] text-muted-foreground">
      {items.map(([c, label]) => (
        <span key={label} className="flex min-w-0 items-center gap-1"><i className="size-2 shrink-0 rounded-full" style={{ background: c }} /><span className="truncate" title={label}>{label}</span></span>
      ))}
    </div>
  );
}
