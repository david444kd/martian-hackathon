// Mission control's "Recall to base": during an EVA a route back to base from where the astronaut is
// (as the ship's button does; the helmet raises the alarm and follows it); with no EVA running, an
// urgent call to that crew to come back. Not shown while the astronaut is already returning or at base.
import { useState } from "react";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";
import { House, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useCreateEvent, useReplaceRoute } from "../lib/queries";
import { isReturn, type Crew, type MarsEvent, type WorkPlan } from "../lib/types";
import { crewHome, useHeightmap, useZone } from "../lib/zones";
import { distanceM } from "../lib/geo";
import type { AstronautView } from "../lib/astronaut";
import { areaHazards, avoidList } from "../lib/hazards";
import { returnRoute } from "../lib/recall";
import { toastError } from "../lib/errors";

export function RecallButton({ crew, plan, astro, evs, now, className }: {
  crew: Crew; plan: WorkPlan | null; astro: AstronautView; evs: MarsEvent[]; now: number; className?: string;
}) {
  const { t } = useTranslation();
  const zone = useZone(crew.zone), home = crewHome(crew, zone);
  const eva = !!plan?.route && plan.status === "in_progress";
  const hm = useHeightmap(eva ? zone : undefined);
  const replace = useReplaceRoute(), call = useCreateEvent();
  const [busy, setBusy] = useState(false);
  const back = isReturn(plan?.route);
  const away = astro.at && home ? distanceM(astro.at[0], astro.at[1], home[0], home[1]) > 40 : false;
  if (back || (!eva && !away)) return null;

  async function recall() {
    if (!zone || !home) return;
    setBusy(true);
    try {
      if (eva && plan) {
        const here = astro.at, seen = plan.route?.generated_at ?? null;
        if (!hm.data || !here) throw new Error(t("expeditions.no_position"));
        const avoid = avoidList(areaHazards(evs, zone.id, now, now + 6 * 3600_000));
        const route = await returnRoute(hm.data, here, home, avoid, t("expeditions.recall_reason"));
        await replace.mutateAsync({ id: plan.id, seen, route, active: true });
        toast.success(t("expeditions.recall_sent", { name: crew.name }));
      } else {
        await call.mutateAsync({
          kind: "message", level: "critical", zone: crew.zone, crew_id: crew.id, lat: null, lon: null, radius_m: null,
          starts_at: new Date().toISOString(), ends_at: null, title: t("expeditions.call_title"), text: t("expeditions.call_text"), source: "dispatch",
        });
        toast.success(t("expeditions.call_sent", { name: crew.name }));
      }
    } catch (e) {
      toastError(e); // a failed write is also reported by the mutation cache: same text, one toast
    } finally { setBusy(false); }
  }

  return (
    <Button size="sm" variant="destructive" className={cn("w-full", className)} disabled={busy || (eva && (!hm.data || !astro.at))} onClick={recall}>
      {busy ? <Loader2 className="animate-spin" /> : <House />} {t("expeditions.recall_btn")}
    </Button>
  );
}
