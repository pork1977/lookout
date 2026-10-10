-- Lookout: a way to read the usage numbers from inside the site.
--
-- The events table has no select policy and never will: the point of it is
-- that the public key can add a row and read nothing. So reading goes the
-- same way run links do in 0003, through a security-definer function with its
-- own check on who is calling, rather than by opening the table up.
--
-- Who counts as an admin lives in a table rather than being written into this
-- file, so no personal id ends up in a public repo and a clone of this project
-- starts with nobody.

create table if not exists public.admins (
  user_id uuid primary key references auth.users (id) on delete cascade,
  added_at timestamptz not null default now()
);

alter table public.admins enable row level security;

-- No policies and no grants on purpose. Nothing reaches this table except the
-- definer functions below and the SQL editor, which is where rows get added.
revoke all on public.admins from anon, authenticated;

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.admins where user_id = (select auth.uid()));
$$;

revoke all on function public.is_admin() from public, anon;
grant execute on function public.is_admin() to authenticated;

-- The aggregation itself, defined once. Not granted to anyone: the view below
-- and the admin function call it, and both run as their owner. Signed-in users
-- cannot reach it directly.
create or replace function public.funnel_since(p_days integer)
returns table (
  source text,
  visits bigint,
  opened_builder bigint,
  trained_one bigint,
  trained_and_saw_it_fire bigint
)
language sql
stable
set search_path = ''
as $$
  with per_visit as (
    select
      e.session_id,
      max(e.source) as source,
      bool_or(e.name = 'build_step_reached') as opened_builder,
      bool_or(e.name = 'detector_trained') as trained,
      bool_or(e.name = 'detector_fired') as fired
    from public.events e
    where e.created_at > now() - make_interval(days => p_days)
    group by e.session_id
  )
  select
    coalesce(v.source, 'direct') as source,
    count(*) as visits,
    count(*) filter (where v.opened_builder) as opened_builder,
    count(*) filter (where v.trained) as trained_one,
    -- Trained AND saw it fire. Firing alone would count someone reopening
    -- yesterday's detector, who is not a stranger who just got it working.
    count(*) filter (where v.trained and v.fired) as trained_and_saw_it_fire
  from per_visit v
  group by 1
  order by 2 desc;
$$;

revoke all on function public.funnel_since(integer) from public, anon, authenticated;

-- How often each event happens, which answers the smaller questions: is AI
-- labelling being used, is anyone exporting, is anyone sharing a link.
create or replace function public.event_counts_since(p_days integer)
returns table (name text, events bigint, sessions bigint)
language sql
stable
set search_path = ''
as $$
  select e.name, count(*) as events, count(distinct e.session_id) as sessions
  from public.events e
  where e.created_at > now() - make_interval(days => p_days)
  group by e.name
  order by 2 desc;
$$;

revoke all on function public.event_counts_since(integer) from public, anon, authenticated;

-- 0004's view, rewritten to use the shared definition rather than repeat it.
-- Still only readable in the SQL editor.
drop view if exists public.funnel_last_7_days;
create view public.funnel_last_7_days
with (security_invoker = true) as
  select * from public.funnel_since(7);

revoke all on public.funnel_last_7_days from anon, authenticated;

-- The two doors the admin page knocks on. Both refuse anyone who isn't in
-- public.admins, including a signed-in stranger who finds the endpoint.
create or replace function public.admin_funnel(p_days integer default 7)
returns table (
  source text,
  visits bigint,
  opened_builder bigint,
  trained_one bigint,
  trained_and_saw_it_fire bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'not authorised' using errcode = '42501';
  end if;
  -- Clamped rather than trusted: this argument arrives from a browser.
  return query select * from public.funnel_since(least(greatest(p_days, 1), 90));
end;
$$;

revoke all on function public.admin_funnel(integer) from public, anon;
grant execute on function public.admin_funnel(integer) to authenticated;

create or replace function public.admin_event_counts(p_days integer default 7)
returns table (name text, events bigint, sessions bigint)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'not authorised' using errcode = '42501';
  end if;
  return query select * from public.event_counts_since(least(greatest(p_days, 1), 90));
end;
$$;

revoke all on function public.admin_event_counts(integer) from public, anon;
grant execute on function public.admin_event_counts(integer) to authenticated;
