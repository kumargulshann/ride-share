begin;

create table public.trips (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  pickup_label text not null check (char_length(btrim(pickup_label)) between 1 and 100),
  pickup_latitude double precision not null check (pickup_latitude between -90 and 90),
  pickup_longitude double precision not null check (pickup_longitude between -180 and 180),
  dropoff_label text not null check (char_length(btrim(dropoff_label)) between 1 and 100),
  dropoff_latitude double precision not null check (dropoff_latitude between -90 and 90),
  dropoff_longitude double precision not null check (dropoff_longitude between -180 and 180),
  travel_date date not null,
  departure_start time(0) without time zone not null,
  departure_end time(0) without time zone not null,
  time_zone text not null check (char_length(btrim(time_zone)) between 1 and 64),
  services text[] not null,
  created_at timestamptz not null default now(),
  constraint valid_departure_window check (
    departure_start < departure_end and departure_end < time '24:00'
  ),
  constraint valid_cab_services check (
    cardinality(services) between 1 and 3
    and services <@ array['Ola', 'Uber', 'Rapido']
  )
);

create index trips_owner_created_at_idx on public.trips (owner_id, created_at desc);

alter table public.trips enable row level security;
revoke all on table public.trips from public, anon, authenticated;
grant select, insert, update, delete on table public.trips to authenticated;

create policy "Travelers can read their own trips"
  on public.trips for select to authenticated
  using ((select auth.uid()) = owner_id);

create policy "Travelers can create their own trips"
  on public.trips for insert to authenticated
  with check ((select auth.uid()) = owner_id);

create policy "Travelers can update their own trips"
  on public.trips for update to authenticated
  using ((select auth.uid()) = owner_id)
  with check ((select auth.uid()) = owner_id);

create policy "Travelers can delete their own trips"
  on public.trips for delete to authenticated
  using ((select auth.uid()) = owner_id);

commit;
