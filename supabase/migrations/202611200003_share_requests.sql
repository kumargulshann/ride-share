begin;

create schema if not exists private;

create table if not exists public.share_requests (
  id uuid primary key default gen_random_uuid(),
  sender_trip_id uuid not null references public.trips (id) on delete cascade,
  recipient_trip_id uuid not null references public.trips (id) on delete cascade,
  sender_id uuid not null references auth.users (id) on delete cascade,
  recipient_id uuid not null references auth.users (id) on delete cascade,
  shared_start timestamptz not null,
  shared_end timestamptz not null,
  status text not null default 'pending' check (status in ('pending', 'accepted', 'declined', 'expired')),
  created_at timestamptz not null default now(),
  decided_at timestamptz,
  check (sender_trip_id <> recipient_trip_id and sender_id <> recipient_id),
  check (shared_start <= shared_end)
);

-- An A-to-B request and a B-to-A request for the same two trips share one key.
create unique index if not exists share_requests_trip_pair_idx on public.share_requests (
  least(sender_trip_id, recipient_trip_id), greatest(sender_trip_id, recipient_trip_id)
);
create index if not exists share_requests_sender_idx on public.share_requests (sender_id, created_at desc);
create index if not exists share_requests_recipient_idx on public.share_requests (recipient_id, created_at desc);

alter table public.share_requests enable row level security;
revoke all on public.share_requests from public, anon, authenticated;
drop policy if exists "Participants can read their sharing requests" on public.share_requests;
create policy "Participants can read their sharing requests" on public.share_requests
  for select to authenticated
  using ((select auth.uid()) in (sender_id, recipient_id));

create table if not exists private.trip_match_skips (
  trip_id uuid not null references public.trips (id) on delete cascade,
  skipped_trip_id uuid not null references public.trips (id) on delete cascade,
  primary key (trip_id, skipped_trip_id)
);
alter table private.trip_match_skips enable row level security;
revoke all on private.trip_match_skips from public, anon, authenticated;

create or replace function private.trip_shared_window(mine public.trips, other public.trips, as_of timestamptz)
returns table (starts_at timestamptz, ends_at timestamptz)
language sql
stable
set search_path = ''
as $$
  select greatest(mine.departure_starts_at, other.departure_starts_at, as_of),
    least(mine.departure_ends_at, other.departure_ends_at)
  where mine.owner_id <> other.owner_id
    and greatest(mine.departure_starts_at, other.departure_starts_at, as_of)
      <= least(mine.departure_ends_at, other.departure_ends_at)
    and extensions.st_dwithin(
      extensions.st_point(mine.pickup_longitude, mine.pickup_latitude, 4326)::extensions.geography,
      extensions.st_point(other.pickup_longitude, other.pickup_latitude, 4326)::extensions.geography,
      1000
    )
    and extensions.st_dwithin(
      extensions.st_point(mine.dropoff_longitude, mine.dropoff_latitude, 4326)::extensions.geography,
      extensions.st_point(other.dropoff_longitude, other.dropoff_latitude, 4326)::extensions.geography,
      1000
    );
$$;

create or replace function private.share_display_name(meta jsonb)
returns text
language sql
immutable
set search_path = ''
as $$
  select coalesce(
    case when jsonb_typeof(meta -> 'display_name') = 'string'
      then left(nullif(btrim(meta ->> 'display_name'), ''), 40)
    end,
    'Traveler'
  );
$$;

create or replace function private.share_area(latitude double precision, longitude double precision)
returns text
language sql
immutable
set search_path = ''
as $$
  select format('Around %s°, %s°', round(latitude::numeric, 2), round(longitude::numeric, 2));
$$;

revoke all on function private.trip_shared_window(public.trips, public.trips, timestamptz),
  private.share_display_name(jsonb), private.share_area(double precision, double precision)
  from public, anon, authenticated;

drop function if exists public.find_trip_matches(uuid);
create function public.find_trip_matches(p_trip_id uuid)
returns table (
  display_name text, pickup_area text, dropoff_area text, shared_start timestamptz,
  shared_end timestamptz, services text[], match_trip_id uuid,
  request_status text, request_direction text
)
language sql
stable
security definer
set search_path = ''
as $$
  select private.share_display_name(traveler.raw_user_meta_data),
    private.share_area(other.pickup_latitude, other.pickup_longitude),
    private.share_area(other.dropoff_latitude, other.dropoff_longitude),
    shared.starts_at, shared.ends_at, other.services, other.id, request.status,
    case when request.sender_id = mine.owner_id then 'sent'
      when request.recipient_id = mine.owner_id then 'incoming' end
  from public.trips as mine
  join public.trips as other
    on other.owner_id <> mine.owner_id
    and other.departure_ends_at >= greatest(mine.departure_starts_at, statement_timestamp())
    and other.departure_starts_at <= mine.departure_ends_at
  join auth.users as traveler on traveler.id = other.owner_id
  cross join lateral private.trip_shared_window(mine, other, statement_timestamp()) as shared
  left join public.share_requests as request
    on least(request.sender_trip_id, request.recipient_trip_id) = least(mine.id, other.id)
    and greatest(request.sender_trip_id, request.recipient_trip_id) = greatest(mine.id, other.id)
  where mine.id = p_trip_id
    and mine.owner_id = (select auth.uid())
    and not exists (
      select 1 from private.trip_match_skips as skip
      where skip.trip_id = mine.id and skip.skipped_trip_id = other.id
    )
  order by shared.starts_at, shared.ends_at, other.id;
$$;

create or replace function public.skip_trip_match(p_trip_id uuid, p_match_trip_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.trips as mine
    join public.trips as other on other.id = p_match_trip_id
    cross join lateral private.trip_shared_window(mine, other, clock_timestamp())
    where mine.id = p_trip_id and mine.owner_id = (select auth.uid())
  ) then
    raise exception using message = 'match_unavailable';
  end if;

  insert into private.trip_match_skips (trip_id, skipped_trip_id)
  values (p_trip_id, p_match_trip_id)
  on conflict do nothing;
end;
$$;

create or replace function public.send_share_request(p_trip_id uuid, p_match_trip_id uuid)
returns table (request_id uuid, request_status text, request_direction text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := auth.uid();
  mine public.trips%rowtype;
  other public.trips%rowtype;
  request public.share_requests%rowtype;
  shared record;
begin
  -- Lock the trip rows in the same order regardless of which traveler sends first.
  perform trip.id from public.trips as trip
    where trip.id in (p_trip_id, p_match_trip_id)
    order by trip.id for share;

  select trip.* into mine from public.trips as trip where trip.id = p_trip_id and trip.owner_id = actor;
  select trip.* into other from public.trips as trip where trip.id = p_match_trip_id and trip.owner_id <> actor;
  if mine.id is null or other.id is null then
    raise exception using message = 'match_unavailable';
  end if;

  select existing.* into request from public.share_requests as existing
    where least(existing.sender_trip_id, existing.recipient_trip_id) = least(mine.id, other.id)
      and greatest(existing.sender_trip_id, existing.recipient_trip_id) = greatest(mine.id, other.id);

  if request.id is null then
    select * into shared from private.trip_shared_window(mine, other, clock_timestamp());
    if not found then
      raise exception using message = 'match_unavailable';
    end if;

    insert into public.share_requests (sender_trip_id, recipient_trip_id, sender_id, recipient_id, shared_start, shared_end)
    values (mine.id, other.id, actor, other.owner_id, shared.starts_at, shared.ends_at)
    on conflict do nothing;

    -- A concurrent sender may have won the unique constraint. Use that direction.
    select existing.* into strict request from public.share_requests as existing
      where least(existing.sender_trip_id, existing.recipient_trip_id) = least(mine.id, other.id)
        and greatest(existing.sender_trip_id, existing.recipient_trip_id) = greatest(mine.id, other.id);
  end if;

  return query select request.id, request.status,
    case when request.sender_id = actor then 'sent' else 'incoming' end;
end;
$$;

create or replace function public.list_share_requests()
returns table (
  request_id uuid, request_direction text, request_status text, display_name text,
  pickup_area text, dropoff_area text, shared_start timestamptz, shared_end timestamptz,
  services text[], time_zone text
)
language sql
stable
security definer
set search_path = ''
as $$
  with actor as (select auth.uid() as id)
  select request.id, case when request.sender_id = actor.id then 'sent' else 'incoming' end,
    case when request.status = 'pending'
      and not exists (select 1 from private.trip_shared_window(mine, other, statement_timestamp()))
      then 'expired' else request.status end,
    private.share_display_name(traveler.raw_user_meta_data),
    private.share_area(other.pickup_latitude, other.pickup_longitude),
    private.share_area(other.dropoff_latitude, other.dropoff_longitude),
    request.shared_start, request.shared_end, other.services, mine.time_zone
  from actor
  join public.share_requests as request on actor.id in (request.sender_id, request.recipient_id)
  join public.trips as mine
    on mine.id = case when request.sender_id = actor.id then request.sender_trip_id else request.recipient_trip_id end
  join public.trips as other
    on other.id = case when request.sender_id = actor.id then request.recipient_trip_id else request.sender_trip_id end
  join auth.users as traveler on traveler.id = other.owner_id
  order by request.created_at desc, request.id;
$$;

create or replace function public.respond_to_share_request(p_request_id uuid, p_accept boolean)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := auth.uid();
  request public.share_requests%rowtype;
  mine public.trips%rowtype;
  other public.trips%rowtype;
  shared record;
  decision text;
begin
  select existing.* into request from public.share_requests as existing
    where existing.id = p_request_id and existing.recipient_id = actor;
  if not found or p_accept is null then
    raise exception using message = 'request_unavailable';
  end if;

  perform trip.id from public.trips as trip
    where trip.id in (request.sender_trip_id, request.recipient_trip_id)
    order by trip.id for share;

  select existing.* into request from public.share_requests as existing
    where existing.id = p_request_id and existing.recipient_id = actor for update;
  if not found then
    raise exception using message = 'request_unavailable';
  end if;

  if request.status <> 'pending' then
    return request.status;
  end if;

  if p_accept then
    select trip.* into mine from public.trips as trip where trip.id = request.recipient_trip_id;
    select trip.* into other from public.trips as trip where trip.id = request.sender_trip_id;
    select * into shared from private.trip_shared_window(mine, other, clock_timestamp());
    if found then
      decision := 'accepted';
      request.shared_start := shared.starts_at;
      request.shared_end := shared.ends_at;
    else
      decision := 'expired';
    end if;
  else
    decision := 'declined';
  end if;

  update public.share_requests as existing
    set status = decision, decided_at = clock_timestamp(),
      shared_start = request.shared_start, shared_end = request.shared_end
    where existing.id = request.id;

  return decision;
end;
$$;

revoke execute on function public.find_trip_matches(uuid), public.skip_trip_match(uuid, uuid),
  public.send_share_request(uuid, uuid), public.list_share_requests(),
  public.respond_to_share_request(uuid, boolean) from public, anon;
grant execute on function public.find_trip_matches(uuid), public.skip_trip_match(uuid, uuid),
  public.send_share_request(uuid, uuid), public.list_share_requests(),
  public.respond_to_share_request(uuid, boolean) to authenticated;

notify pgrst, 'reload schema';

commit;
