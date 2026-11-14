-- Martian Hackathon: crews and their work plans.
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

-- a first crew so the pages are not empty (skipped if any crew exists)
insert into public.crews (name, ship, zone, lat, lon)
select 'Ares-1', 'Hermes', 'jezero', 18.4447, 77.4508 where not exists (select 1 from public.crews);
