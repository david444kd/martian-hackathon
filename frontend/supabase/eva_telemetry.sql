-- EVA telemetry: where each crew's astronaut is right now, written by the helmet every ~2.5 s.
-- One row per crew (upsert), so mission control and the ship always see the latest position.
-- Paste into Supabase → SQL Editor → Run. Safe to run again.
-- Without this table the helmet still streams its position live over a Realtime broadcast channel;
-- the table adds the last known position for pages opened later.

create table if not exists public.eva_telemetry (
  crew_id      uuid primary key references public.crews(id) on delete cascade,
  plan_id      uuid references public.work_plans(id) on delete set null,
  lat          double precision not null,
  lon          double precision not null,
  elev_m       double precision,              -- above the Mars areoid (from the zone DTM)
  heading_deg  double precision,              -- compass, 0 = north
  speed_ms     double precision,
  progress_m   double precision,              -- along the active route
  off_route_m  double precision,
  mode         text not null default 'standby'
               check (mode in ('standby', 'out', 'return', 'complete')),
  o2_pct       double precision,              -- simulated suit values (not real biometrics)
  pulse_bpm    double precision,
  co2_mmhg     double precision,
  suit_kpa     double precision,
  dose_usv     double precision,
  updated_at   timestamptz not null default now()
);

alter table public.eva_telemetry enable row level security;
drop policy if exists "open eva_telemetry" on public.eva_telemetry;
create policy "open eva_telemetry" on public.eva_telemetry for all to anon, authenticated using (true) with check (true);
grant select, insert, update, delete on public.eva_telemetry to anon, authenticated;

do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'eva_telemetry') then
    alter publication supabase_realtime add table public.eva_telemetry;
  end if;
end $$;
