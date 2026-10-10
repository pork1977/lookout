-- Lookout: bring the hourly event ceiling down from 20,000 to 2,000.
--
-- 20,000 was set as "far above anything real", but the events table shares a
-- database with accounts, backups and run links. Sustained spam at that
-- ceiling could fill a free-tier database and take those down with it, which
-- is a worse outcome than losing an hour of numbers. 2,000 an hour is still
-- an order of magnitude above anything Lookout sees.

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

  if current_count > 2000 then
    raise exception 'event rate limit reached' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

revoke all on function public.cap_events_per_hour() from public, anon, authenticated;
