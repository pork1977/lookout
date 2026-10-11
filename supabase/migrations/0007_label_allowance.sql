-- Lookout: put AI labelling behind an account and a monthly allowance.
--
-- The hole this closes: /api/label spends the site owner's Anthropic key and
-- was open to anyone, guarded only by a per-IP counter held in a serverless
-- instance's memory. That counter resets whenever a new instance starts and
-- is not shared between instances, so it slowed abuse rather than capping it.
--
-- The count has to live somewhere durable and has to be the server's to
-- decide, so it lives here. The route calls this function as the signed-in
-- user, which also makes "are they signed in" and "have they got any left"
-- the same question, answered in one round trip.

create table if not exists public.label_usage (
  user_id uuid not null references auth.users (id) on delete cascade,
  -- First of the month, UTC. A month is a coarse enough window that the
  -- boundary being UTC rather than local never matters to anyone.
  month date not null,
  images integer not null default 0,
  primary key (user_id, month)
);

alter table public.label_usage enable row level security;

-- No policies, and the grants removed: nobody reads or writes this except the
-- definer function below. A user who could update their own row could grant
-- themselves an unlimited allowance.
revoke all on public.label_usage from anon, authenticated;

/**
 * Takes p_images off this month's allowance, or refuses.
 *
 * Returns how many are left afterwards. Raises 42501 when nobody is signed in
 * and P0001 when the allowance is spent, which the route turns into 401 and
 * 429 respectively.
 */
create or replace function public.consume_label_quota(p_images integer)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  -- 600 a month is five full runs at the 120-photo ceiling, which is far more
  -- than anyone training a detector or two actually needs, and bounded enough
  -- that a determined account cannot run up a bill worth noticing.
  allowance constant integer := 600;
  uid uuid := (select auth.uid());
  used integer;
begin
  if uid is null then
    raise exception 'sign in required' using errcode = '42501';
  end if;
  -- This argument comes from a request body by way of the route, so it is
  -- checked here too rather than trusted to have been checked already.
  if p_images is null or p_images < 1 or p_images > 120 then
    raise exception 'bad image count' using errcode = '22023';
  end if;

  -- Check and increment in one statement. Reading the total and then writing
  -- it back would let two requests in flight at once both pass the check.
  insert into public.label_usage as u (user_id, month, images)
  values (uid, date_trunc('month', now() at time zone 'utc')::date, p_images)
  on conflict (user_id, month) do update
    set images = u.images + p_images
    where u.images + p_images <= allowance
  returning u.images into used;

  -- No row came back, so the WHERE above refused the update.
  if used is null then
    raise exception 'monthly labelling allowance reached' using errcode = 'P0001';
  end if;

  return allowance - used;
end;
$$;

revoke all on function public.consume_label_quota(integer) from public, anon;
-- Callable by signed-in users, which is how the route calls it on their
-- behalf. Calling it directly only spends your own allowance faster, and the
-- lower bound on p_images means it cannot be used to hand yourself a refund.
grant execute on function public.consume_label_quota(integer) to authenticated;
