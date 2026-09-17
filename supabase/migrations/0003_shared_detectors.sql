-- Lookout: shareable run links.
--
-- A share is a snapshot of one trained detector: the small classifier head
-- (8-bit weights, roughly 170KB as base64), its group names, and the trigger
-- settings to run it with. No photos, ever. Anyone holding the link can run
-- it; only the signed-in owner can create, update or remove it.

create table if not exists public.shared_detectors (
  id uuid primary key default gen_random_uuid(),
  -- The public identifier in /run/{slug}. Random, 96 bits, so links can't be
  -- guessed or walked. The local detector id is time-based and would be.
  slug text not null unique default encode(extensions.gen_random_bytes(12), 'hex'),
  -- on delete cascade: deleting an account must take its public links with it.
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  -- Sharing the same detector again updates its link rather than minting a new one.
  local_id text not null,
  name text not null default '' check (char_length(name) <= 300),
  classes jsonb not null check (jsonb_typeof(classes) = 'array'),
  settings jsonb not null default '{}'::jsonb,
  model_topology jsonb not null,
  weight_specs jsonb not null,
  quantization jsonb not null,
  weights text not null check (char_length(weights) <= 2000000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, local_id)
);

alter table public.shared_detectors enable row level security;

-- Owners only, for every direct read and write. Deliberately no policy for
-- anon: a public select policy would let anyone list every share at once.
-- Public reads go through get_shared_detector below, one slug at a time.
drop policy if exists "own shares" on public.shared_detectors;
create policy "own shares" on public.shared_detectors
  for all
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- A ceiling on shares per account, so a signed-in account can't be used as
-- free bulk storage.
create or replace function public.limit_shares_per_user()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  -- An upsert fires this even when it ends up updating, so re-sharing an
  -- existing detector must not count as a new share.
  if exists (select 1 from public.shared_detectors
             where user_id = new.user_id and local_id = new.local_id) then
    return new;
  end if;
  if (select count(*) from public.shared_detectors where user_id = new.user_id) >= 25 then
    raise exception 'share limit reached' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

drop trigger if exists shared_detectors_limit on public.shared_detectors;
create trigger shared_detectors_limit
  before insert on public.shared_detectors
  for each row execute function public.limit_shares_per_user();

-- The one public door: fetch a single share by its slug.
create or replace function public.get_shared_detector(p_slug text)
returns table (
  slug text,
  name text,
  classes jsonb,
  settings jsonb,
  model_topology jsonb,
  weight_specs jsonb,
  quantization jsonb,
  weights text,
  updated_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select s.slug, s.name, s.classes, s.settings, s.model_topology, s.weight_specs,
         s.quantization, s.weights, s.updated_at
  from public.shared_detectors s
  where s.slug = p_slug;
$$;

revoke all on function public.get_shared_detector(text) from public;
grant execute on function public.get_shared_detector(text) to anon, authenticated;
revoke all on function public.limit_shares_per_user() from public, anon, authenticated;
