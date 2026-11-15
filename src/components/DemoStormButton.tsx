// A small demo control on the ship console's map: raise a dust storm over the crew's walk
// (lib/demoStorm.ts), and end the storms again. The same thing as the phone page /demo.
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Loader2, RotateCcw, Tornado } from "lucide-react";
import { cn } from "@/lib/utils";
import { useDemoStorm, zoneStorms } from "../lib/demoStorm";
import type { Crew, MarsEvent, WorkPlan } from "../lib/types";
import type { Zone } from "../lib/zones";

interface Props { crew: Crew; zone: Zone; plan: WorkPlan | null | undefined; at: [number, number] | null; events: MarsEvent[]; now: number; className?: string }

export function DemoStormButton({ crew, zone, plan, at, events, now, className }: Props) {
  const { t } = useTranslation();
  const demo = useDemoStorm();
  const storms = zoneStorms(events, zone.id, now);
  const raise = () => demo.raise(crew, zone, plan, at, { onSuccess: () => toast.success(t("demo.raised_toast")) });
  return (
    <div className={cn("flex items-center gap-1 rounded-lg border bg-card/85 p-0.5 text-xs backdrop-blur", className)}>
      <button type="button" onClick={raise} disabled={demo.raising} title={t("demo.map_button_title")}
        className="flex items-center gap-1.5 rounded-md px-2.5 py-1 font-medium text-orange-300 transition-colors hover:bg-orange-500/15 hover:text-orange-200 disabled:opacity-60">
        {demo.raising ? <Loader2 className="size-3.5 animate-spin" /> : <Tornado className="size-3.5" />}
        {t("demo.map_button")}
      </button>
      {storms.length > 0 && (
        <button type="button" onClick={() => demo.clear(storms)} disabled={demo.clearing} title={t("demo.clear", { count: storms.length })}
          aria-label={t("demo.clear", { count: storms.length })}
          className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-60">
          {demo.clearing ? <Loader2 className="size-3.5 animate-spin" /> : <RotateCcw className="size-3.5" />}
        </button>
      )}
    </div>
  );
}
