begin;

create extension if not exists postgis with schema extensions;

alter table public.trips
  add column if not exists departure_starts_at timestamptz generated always as
    ((travel_date + departure_start) at time zone time_zone) stored,
  add column if not exists departure_ends_at timestamptz generated always as
    ((travel_date + departure_end) at time zone time_zone) stored;

create index if not exists trips_departure_ends_at_idx on public.trips (departure_ends_at);

create or replace function public.find_trip_matches(p_trip_id uuid)
returns table (
  display_name text,
  pickup_area text,
  dropoff_area text,
  shared_start timestamptz,
  shared_end timestamptz,
  services text[]
)
language sql
stable
security definer
set search_path = ''
as $$
  with requested as (
    select trip.*
    from public.trips as trip
    where trip.id = p_trip_id
      and trip.owner_id = (select auth.uid())
      and trip.departure_ends_at >= statement_timestamp()
  )
  select
    coalesce(
      case when jsonb_typeof(traveler.raw_user_meta_data -> 'display_name') = 'string'
        then left(nullif(btrim(traveler.raw_user_meta_data ->> 'display_name'), ''), 40)
      end,
      'Traveler'
    ),
    format('Around %s°, %s°', round(other.pickup_latitude::numeric, 2), round(other.pickup_longitude::numeric, 2)),
    format('Around %s°, %s°', round(other.dropoff_latitude::numeric, 2), round(other.dropoff_longitude::numeric, 2)),
    overlap.starts_at,
    overlap.ends_at,
    other.services
  from requested as mine
  join public.trips as other
    on other.owner_id <> mine.owner_id
    and other.departure_ends_at >= greatest(mine.departure_starts_at, statement_timestamp())
    and other.departure_starts_at <= mine.departure_ends_at
  join auth.users as traveler on traveler.id = other.owner_id
  cross join lateral (
    select greatest(mine.departure_starts_at, other.departure_starts_at, statement_timestamp()) as starts_at,
      least(mine.departure_ends_at, other.departure_ends_at) as ends_at
  ) as overlap
  where overlap.starts_at <= overlap.ends_at
    -- PostGIS compares the original points in metres on the WGS 84 spheroid.
    and extensions.st_dwithin(
      extensions.st_point(mine.pickup_longitude, mine.pickup_latitude, 4326)::extensions.geography,
      extensions.st_point(other.pickup_longitude, other.pickup_latitude, 4326)::extensions.geography,
      1000
    )
    and extensions.st_dwithin(
      extensions.st_point(mine.dropoff_longitude, mine.dropoff_latitude, 4326)::extensions.geography,
      extensions.st_point(other.dropoff_longitude, other.dropoff_latitude, 4326)::extensions.geography,
      1000
    )
  order by overlap.starts_at, overlap.ends_at, other.id;
$$;

revoke execute on function public.find_trip_matches(uuid) from public, anon;
grant execute on function public.find_trip_matches(uuid) to authenticated;

notify pgrst, 'reload schema';

commit;
