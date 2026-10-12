-- Run in the Supabase SQL editor (or via `supabase db push`).
-- Stores building massing for the city viewer. Read access is public via the anon key.

create table if not exists public.buildings (
  id       text primary key,
  name     text not null,
  usage    text not null default 'unknown',
  x        double precision not null,           -- meters, east
  z        double precision not null,           -- meters, south
  width    double precision not null check (width > 0),
  depth    double precision not null check (depth > 0),
  height   double precision not null check (height > 0),
  color    text not null default '#b0b8c4' check (color ~ '^#[0-9a-fA-F]{6}$'),
  footprint jsonb,                              -- optional outer ring: [[x, z], ...] in meters
  basement_depth double precision not null default 0 check (basement_depth >= 0),  -- meters below ground
  created_at timestamptz not null default now()
);

-- For databases created before these columns existed.
alter table public.buildings add column if not exists footprint jsonb;
alter table public.buildings add column if not exists basement_depth double precision not null default 0;

alter table public.buildings enable row level security;

drop policy if exists "buildings are readable by anyone" on public.buildings;
create policy "buildings are readable by anyone"
  on public.buildings
  for select
  to anon, authenticated
  using (true);

-- Road centerlines (VWorld lt_l_n3a0020000). One row per road segment polyline.
create table if not exists public.roads (
  id        text primary key,
  name      text not null default '',
  width     double precision not null default 8 check (width > 0),  -- meters
  points    jsonb not null,                                          -- [[x, z], ...] in meters
  created_at timestamptz not null default now()
);

alter table public.roads enable row level security;

drop policy if exists "roads are readable by anyone" on public.roads;
create policy "roads are readable by anyone"
  on public.roads
  for select
  to anon, authenticated
  using (true);

-- Writes are intentionally not granted to anon/authenticated.
-- Load data with the service role key from a trusted environment (never expose it to the browser).

create index if not exists buildings_usage_idx on public.buildings (usage);
