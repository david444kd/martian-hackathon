// DEMO REMOTE (/demo): a phone page with one big button that raises a dust storm over a crew's walk
// (lib/demoStorm.ts), for showing the storm → alarm → return-to-base chain live. Pick the crew if
// there are several; "clear" ends the storms to run the demo again.
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Check, Loader2, RotateCcw, Tornado } from "lucide-react";
import { cn } from "@/lib/utils";
import { activePlan, useCrews, useEvents, usePlans } from "../lib/queries";
import { useZones } from "../lib/zones";
import { useAstronaut } from "../lib/astronaut";
import { useNow } from "../lib/mars";
import { fmtKm } from "../lib/geo";
import { useDemoStorm, zoneStorms } from "../lib/demoStorm";
import { Brand, ErrorNote } from "../components/common";
import { LanguageSwitcher } from "../components/LanguageSwitcher";

export function Demo() {
  const { t } = useTranslation();
  const crews = useCrews(), plans = usePlans(), zones = useZones(), events = useEvents(), now = useNow();
  const list = useMemo(() => crews.data ?? [], [crews.data]);
  // the crew out on an EVA first: that's the one the demo is about
  const busyCrew = list.find((c) => activePlan(plans.data?.filter((p) => p.crew_id === c.id)));
  const [pick, setPick] = useState<string | null>(null);
  const crew = list.find((c) => c.id === pick) ?? busyCrew ?? list[0];
  const zone = zones.data?.find((z) => z.id === crew?.zone);
  const crewPlans = plans.data?.filter((p) => p.crew_id === crew?.id);
  const active = activePlan(crewPlans);
  const plan = active ?? crewPlans?.find((p) => p.route && p.status !== "done");
  const astro = useAstronaut(crew?.id, active);
  const storms = zone ? zoneStorms(events.data ?? [], zone.id, now) : [];
  const demo = useDemoStorm();
  const [done, setDone] = useState(false);
  useEffect(() => { if (!done) return; const id = setTimeout(() => setDone(false), 3500); return () => clearTimeout(id); }, [done]);

  const ready = !!crew && !!zone && !demo.raising;
  const fire = () => {
    if (!crew || !zone || demo.raising) return;
    navigator.vibrate?.(60);
    demo.raise(crew, zone, plan, astro.at, { onSuccess: () => { setDone(true); navigator.vibrate?.([40, 60, 120]); } });
  };

  const where = !crew ? "" : active?.route
    ? t("demo.where_eva", { done: fmtKm(active.progress_m ?? 0), total: fmtKm(active.route.distance_m) })
    : plan?.route ? t("demo.where_route", { title: plan.title }) : t("demo.where_base");

  return (
    <div className="relative flex h-dvh touch-manipulation flex-col overflow-hidden bg-[#07060a] px-5 pt-[max(1rem,env(safe-area-inset-top))] pb-[max(1.25rem,env(safe-area-inset-bottom))] select-none">
      {/* a dusty glow behind the button */}
      <div className={cn("pointer-events-none absolute inset-0 transition-opacity duration-700", done ? "opacity-100" : "opacity-60")}
        style={{ background: "radial-gradient(60% 45% at 50% 55%, oklch(0.55 0.15 50 / 35%), transparent 70%)" }} />

      <header className="relative flex items-center justify-between gap-3">
        <Brand product={t("demo.brand")} icon={<Tornado />} />
        <LanguageSwitcher />
      </header>

      {list.length > 1 && (
        <div className="relative mt-5 -mx-5 flex gap-2 overflow-x-auto px-5 pb-1">
          {list.map((c) => {
            const on = c.id === crew?.id, eva = !!activePlan(plans.data?.filter((p) => p.crew_id === c.id));
            return (
              <button key={c.id} type="button" onClick={() => setPick(c.id)}
                className={cn("flex shrink-0 items-center gap-2 rounded-full border px-3.5 py-2 text-sm transition-colors",
                  on ? "border-primary bg-primary/15 text-foreground" : "bg-card/60 text-muted-foreground")}>
                <span className={cn("size-2 rounded-full", eva ? "animate-pulse bg-live" : "bg-muted-foreground/50")} />
                <span className="font-medium">{c.name}</span>
                <span className="text-xs opacity-70">{c.zone}</span>
              </button>
            );
          })}
        </div>
      )}

      <main className="relative flex flex-1 flex-col items-center justify-center gap-7 text-center">
        <div className="min-h-12">
          {crew ? (
            <>
              <div className="text-lg font-semibold">{crew.name} · {zone?.name ?? crew.zone}</div>
              <div className="mt-0.5 text-sm text-muted-foreground">{where}</div>
            </>
          ) : (
            <div className="text-sm text-muted-foreground">{crews.isLoading ? t("common.loading") : t("demo.no_crews")}</div>
          )}
        </div>

        <button type="button" onClick={fire} disabled={!ready} aria-label={t("demo.raise")}
          className={cn("group relative grid size-60 place-items-center rounded-full transition-transform duration-150 active:scale-95 disabled:opacity-50",
            "focus-visible:outline-4 focus-visible:outline-primary/60")}>
          {/* pulsing rings while armed */}
          {ready && !done && <>
            <span className="absolute inset-0 animate-ping rounded-full bg-orange-500/25 [animation-duration:2.4s]" />
            <span className="absolute -inset-3 rounded-full border border-orange-400/25" />
          </>}
          <span className={cn("absolute inset-0 rounded-full shadow-[0_0_60px_-5px] transition-colors duration-500",
            done ? "bg-gradient-to-b from-emerald-400 to-emerald-700 shadow-emerald-500/60" : "bg-gradient-to-b from-amber-400 via-orange-500 to-red-700 shadow-orange-500/60")} />
          <span className="absolute inset-2 rounded-full border border-white/25" />
          <span className="relative flex flex-col items-center gap-2 text-white drop-shadow">
            {demo.raising ? <Loader2 className="size-16 animate-spin" /> : done ? <Check className="size-16" strokeWidth={2.5} /> : <Tornado className="size-16" strokeWidth={1.8} />}
            <span className="max-w-40 text-lg leading-tight font-bold">{done ? t("demo.raised") : t("demo.raise")}</span>
          </span>
        </button>

        <div className="min-h-10 text-sm">
          {done
            ? <span className="text-emerald-300">{t("demo.raised_hint")}</span>
            : storms.length > 0
            ? <span className="text-orange-300">{t("demo.storms_active", { count: storms.length })}</span>
            : <span className="text-muted-foreground">{t("demo.hint")}</span>}
        </div>
      </main>

      <footer className="relative flex flex-col items-center gap-3">
        <ErrorNote error={demo.error} />
        {storms.length > 0 && (
          <button type="button" onClick={() => void demo.clear(storms)} disabled={demo.clearing}
            className="flex items-center gap-2 rounded-full border bg-card/60 px-4 py-2 text-sm text-muted-foreground transition-colors active:bg-muted">
            {demo.clearing ? <Loader2 className="size-4 animate-spin" /> : <RotateCcw className="size-4" />}
            {t("demo.clear", { count: storms.length })}
          </button>
        )}
        <p className="text-[11px] text-muted-foreground/70">{t("demo.footnote")}</p>
      </footer>
    </div>
  );
}
