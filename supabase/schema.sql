-- Martian Hackathon: crews, their work plans, and events (anomalies, forecasts, messages).
-- Paste this whole file into Supabase → SQL Editor → New query → Run. Safe to run again.
-- No auth: the anon key may read and write everything (hackathon demo).

create table if not exists public.crews (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  ship        text not null default '',
  zone        text not null default 'jezero',               -- operation zone it landed in
  lat         double precision,                              -- landing point
  lon         double precision,
  created_at  timestamptz not null default now()
);

create table if not exists public.work_plans (
  id            uuid primary key default gen_random_uuid(),
  crew_id       uuid not null references public.crews(id) on delete cascade,
  title         text not null,
  description   text not null default '',
  zone          text not null default 'jezero',          -- operation zone id (frontend/public/zones)
  target_lat    double precision not null,
  target_lon    double precision not null,
  status        text not null default 'assigned'
                check (status in ('draft', 'assigned', 'in_progress', 'done')),
  scheduled_at  timestamptz,
  route         jsonb,                                   -- set by the ship: points, distance, time, slopes
  started_at    timestamptz,                             -- when the ship started the EVA (status in_progress)
  progress_m    double precision,                        -- helmet telemetry: metres walked along the route
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists work_plans_crew_idx on public.work_plans (crew_id);

-- keep updated_at current on every edit
create or replace function public.touch_updated_at() returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

drop trigger if exists work_plans_touch on public.work_plans;
create trigger work_plans_touch before update on public.work_plans
  for each row execute function public.touch_updated_at();

-- open access for the demo: RLS on, with "everyone may do everything" policies
alter table public.crews enable row level security;
alter table public.work_plans enable row level security;

drop policy if exists "open crews" on public.crews;
create policy "open crews" on public.crews for all to anon, authenticated using (true) with check (true);

drop policy if exists "open work_plans" on public.work_plans;
create policy "open work_plans" on public.work_plans for all to anon, authenticated using (true) with check (true);

grant select, insert, update, delete on public.crews, public.work_plans to anon, authenticated;

-- ---------------------------------------------------------------------------------------------
-- events: anomalies over an area or the whole planet, forecasts (starts_at in the future), messages
create table if not exists public.events (
  id          uuid primary key default gen_random_uuid(),
  kind        text not null
              check (kind in ('dust_storm', 'dust_devil', 'rockfall', 'solar_storm', 'message')),
  level       text not null default 'warning'
              check (level in ('info', 'warning', 'critical')),
  zone        text,                                             -- operation zone; null = all of Mars
  crew_id     uuid references public.crews(id) on delete cascade, -- a message's addressee; null = everyone
  lat         double precision,                                 -- an anomaly's area: centre…
  lon         double precision,
  radius_m    double precision check (radius_m is null or radius_m > 0), -- …and radius
  starts_at   timestamptz not null default now(),               -- in the future = a forecast
  ends_at     timestamptz,                                      -- null = until someone ends it
  title       text not null default '',
  text        text not null default '',
  source      text not null default 'dispatch'
              check (source in ('dispatch', 'ship', 'system')),
  acked_at    timestamptz,                                      -- a message to a crew: confirmed by its ship
  created_at  timestamptz not null default now()
);

create index if not exists events_time_idx on public.events (starts_at, ends_at);
create index if not exists events_crew_idx on public.events (crew_id);

-- open access for the demo, like the other two tables
alter table public.events enable row level security;
drop policy if exists "open events" on public.events;
create policy "open events" on public.events for all to anon, authenticated using (true) with check (true);
grant select, insert, update, delete on public.events to anon, authenticated;

-- a first crew so the pages are not empty (skipped if any crew exists)
insert into public.crews (name, ship, zone, lat, lon)
select 'Ares-1', 'Hermes', 'jezero', 18.4447, 77.4508 where not exists (select 1 from public.crews);

-- live updates: every page subscribes to changes in these tables (Supabase Realtime)
do $$
declare t text;
begin
  foreach t in array array['crews', 'work_plans', 'events'] loop
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;

-- ---------------------------------------------------------------------------------------------
-- eva_telemetry: the live astronaut position from the helmet (same as supabase/eva_telemetry.sql)
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
