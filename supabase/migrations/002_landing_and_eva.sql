-- Run once in Supabase → SQL Editor if you created the tables from the first schema.sql.
-- Adds where each crew landed (dots on the dispatcher's globe) and the live EVA state the helmet
-- reports (the astronaut's distance along the route).

alter table public.crews add column if not exists zone text not null default 'jezero';
alter table public.crews add column if not exists lat double precision;
alter table public.crews add column if not exists lon double precision;

alter table public.work_plans add column if not exists started_at timestamptz;
alter table public.work_plans add column if not exists progress_m double precision;

-- the crew made before this migration landed at Perseverance's site in Jezero
update public.crews set lat = 18.4447, lon = 77.4508 where lat is null and zone = 'jezero';
