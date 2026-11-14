-- Mars Ops: the `events` table (anomalies, forecasts, messages) for a database that already has
-- crews and work_plans. Supabase → SQL Editor → New query → paste → Run. Safe to run again.

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
