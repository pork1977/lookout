-- Lookout: detectors, their example photos, and the row-level security that
-- makes a shared database safe to talk to directly from a browser.
--
-- The anon key is public by design — it ships in the JS bundle. Everything that
-- stops one account reading another's photos is RLS, so every policy here is
-- load-bearing, not decoration.

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------- detectors --

create table if not exists public.detectors (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  -- The id this detector has in the browser's IndexedDB. Backing up twice from
  -- the same machine updates the row rather than creating a duplicate.
  local_id text not null,
  name text not null default '',
  preset_id text,
  -- Group names only. The photos are rows in public.examples.
  classes jsonb not null default '[]'::jsonb,
  example_count integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, local_id)
);

create index if not exists detectors_user_idx on public.detectors (user_id, updated_at desc);

-- ----------------------------------------------------------------- examples --

create table if not exists public.examples (
  id uuid primary key default gen_random_uuid(),
  detector_id uuid not null references public.detectors (id) on delete cascade,
  -- Denormalised from the parent so a policy can check ownership without a
  -- join on every row read.
  user_id uuid not null references auth.users (id) on delete cascade,
  local_id text not null,
  class_id text not null,
  storage_path text not null,
  source text not null default 'camera',
  created_at timestamptz not null default now(),
  unique (detector_id, local_id)
);

create index if not exists examples_detector_idx on public.examples (detector_id);

-- --------------------------------------------------------------------- RLS --

alter table public.detectors enable row level security;
alter table public.examples enable row level security;

drop policy if exists "own detectors" on public.detectors;
create policy "own detectors" on public.detectors
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "own examples" on public.examples;
create policy "own examples" on public.examples
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- ----------------------------------------------------------------- storage --

-- Private bucket: photos are of people's desks and homes, so no public URLs.
-- Reads go through short-lived signed URLs instead.
insert into storage.buckets (id, name, public)
values ('examples', 'examples', false)
on conflict (id) do nothing;

-- Objects are stored as {user_id}/{detector_local_id}/{example_local_id}.jpg,
-- so the first path segment is the owner and can be checked directly.
drop policy if exists "own example objects" on storage.objects;
create policy "own example objects" on storage.objects
  for all
  to authenticated
  using (
    bucket_id = 'examples'
    and (storage.foldername(name))[1] = auth.uid()::text
  )
  with check (
    bucket_id = 'examples'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
