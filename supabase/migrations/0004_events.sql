-- Lookout: the smallest analytics that answers the only question being asked,
-- which is how many strangers in a week got from the homepage to a detector
-- they trained and watched fire, and which post sent them.
--
-- Rows are written by the browser with the anon key, the same public key the
-- rest of the site uses. Nothing a visitor typed or photographed is in here:
-- no descriptions, no group names, no photos, no camera labels, no IP
-- address, no account id. Counts arrive already banded ("5-9"), and every
-- other value is one of a fixed set of strings.

create table if not exists public.events (
  id bigint generated always as identity primary key,
  -- One id per page load, generated in the browser and never stored on the
  -- visitor's device. It stitches one visit's steps into a funnel and does
  -- nothing else: it cannot be joined to an account or to yesterday's visit.
  session_id uuid not null,
  -- Spelled out rather than left open, so a spammer holding the anon key can
  -- only add noise to rows that already exist, not invent new event types.
  -- Keep in step with LookoutEvent in src/lib/analytics.ts.
  name text not null check (name in (
    'page_viewed',
    'live_demo_started',
    'build_step_reached',
    'ai_labelling_used',
    'training_started',
    'detector_trained',
    'training_failed',
    'watch_started',
    'detector_fired',
    'share_link_created',
    'detector_exported',
    'account_created'
  )),
  props jsonb not null default '{}'::jsonb
    check (jsonb_typeof(props) = 'object' and length(props::text) <= 1000),
  -- utm_source off the landing URL, so the funnel can be split by post.
  source text check (char_length(source) <= 60),
  path text check (char_length(path) <= 200),
  created_at timestamptz not null default now()
);

create index if not exists events_created_at_idx on public.events (created_at desc);
create index if not exists events_session_idx on public.events (session_id);

alter table public.events enable row level security;

-- Insert and nothing else. Supabase grants anon and authenticated on anything
-- new in public by default, so the grants are spelled out rather than trusted:
-- without this, the anon key could read the whole table.
revoke all on public.events from anon, authenticated;
grant insert on public.events to anon, authenticated;

drop policy if exists "anyone may add an event" on public.events;
create policy "anyone may add an event" on public.events
  for insert
  to anon, authenticated
  with check (true);

-- A public write endpoint is a public write endpoint, so it gets a ceiling.
--
-- One counter row per hour, incremented in place, so the cost of the check is
-- a single indexed upsert rather than a count over the table. Counting rows
-- in the last hour on every insert is the obvious version and the wrong one:
-- under exactly the flood it is meant to stop, it turns cheap row writes into
-- expensive scans.
create table if not exists public.events_rate (
  hour timestamptz primary key,
  n integer not null default 0
);

alter table public.events_rate enable row level security;
revoke all on public.events_rate from anon, authenticated;

create or replace function public.cap_events_per_hour()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_count integer;
begin
  insert into public.events_rate (hour, n)
  values (date_trunc('hour', now()), 1)
  on conflict (hour) do update set n = events_rate.n + 1
  returning n into current_count;

  -- Roughly a thousand real visits an hour, which Lookout is nowhere near.
  -- Past this the hour is dropped on the floor: losing an hour of numbers is
  -- a nuisance, an unbounded table on the free tier is a bill.
  if current_count > 20000 then
    raise exception 'event rate limit reached' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

drop trigger if exists events_rate_cap on public.events;
create trigger events_rate_cap
  before insert on public.events
  for each row execute function public.cap_events_per_hour();

revoke all on function public.cap_events_per_hour() from public, anon, authenticated;

-- The whole reporting layer: select * from public.funnel_last_7_days.
--
-- security_invoker so the view obeys the caller's row-level security instead
-- of running as its owner. Without it a view over an RLS-protected table is a
-- hole straight through that protection.
drop view if exists public.funnel_last_7_days;
create view public.funnel_last_7_days
with (security_invoker = true) as
with visits as (
  select
    session_id,
    max(source) as source,
    bool_or(name = 'build_step_reached') as opened_builder,
    bool_or(name = 'detector_trained') as trained,
    bool_or(name = 'detector_fired') as fired
  from public.events
  where created_at > now() - interval '7 days'
  group by session_id
)
select
  coalesce(source, 'direct') as source,
  count(*) as visits,
  count(*) filter (where opened_builder) as opened_builder,
  count(*) filter (where trained) as trained_one,
  -- The number the plan actually asks for: trained a detector AND saw it
  -- trigger. Firing on its own would count someone reopening yesterday's
  -- detector, who is not a stranger who just got it working.
  count(*) filter (where trained and fired) as trained_and_saw_it_fire
from visits
group by 1
order by visits desc;

revoke all on public.funnel_last_7_days from anon, authenticated;
