begin;

alter table public.share_requests add column if not exists chat_closed_at timestamptz;

create table if not exists private.chat_messages (
  message_order bigint generated always as identity primary key,
  request_id uuid not null references public.share_requests (id) on delete cascade,
  author_id uuid not null references auth.users (id) on delete cascade,
  client_message_id uuid not null,
  body text not null check (char_length(body) between 1 and 2000 and body ~ '[^[:space:]]'),
  created_at timestamptz not null default clock_timestamp(),
  unique (request_id, author_id, client_message_id)
);

create index if not exists chat_messages_request_order_idx
  on private.chat_messages (request_id, message_order);

alter table private.chat_messages enable row level security;
revoke all on private.chat_messages from public, anon, authenticated;

create or replace function public.read_share_conversation(p_request_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  actor uuid := auth.uid();
  conversation jsonb;
begin
  select jsonb_build_object(
    'display_name', private.share_display_name(traveler.raw_user_meta_data),
    'pickup_area', private.share_area(other.pickup_latitude, other.pickup_longitude),
    'dropoff_area', private.share_area(other.dropoff_latitude, other.dropoff_longitude),
    'shared_start', request.shared_start,
    'shared_end', request.shared_end,
    'time_zone', mine.time_zone,
    'closed_at', request.chat_closed_at,
    'messages', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', message.message_order::text,
          'body', message.body,
          'created_at', message.created_at,
          'mine', message.author_id = actor
        ) order by message.message_order
      )
      from private.chat_messages as message
      where message.request_id = request.id
    ), '[]'::jsonb)
  ) into conversation
  from public.share_requests as request
  join public.trips as mine on mine.id = case when request.sender_id = actor
    then request.sender_trip_id else request.recipient_trip_id end
  join public.trips as other on other.id = case when request.sender_id = actor
    then request.recipient_trip_id else request.sender_trip_id end
  join auth.users as traveler on traveler.id = other.owner_id
  where request.id = p_request_id
    and request.status = 'accepted'
    and actor in (request.sender_id, request.recipient_id);

  if conversation is null then
    raise exception using message = 'chat_unavailable';
  end if;
  return conversation;
end;
$$;

create or replace function public.send_share_message(p_request_id uuid, p_client_message_id uuid, p_body text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := auth.uid();
  request public.share_requests%rowtype;
  message private.chat_messages%rowtype;
  normalized_body text := regexp_replace(p_body, '^[[:space:]]+|[[:space:]]+$', '', 'g');
begin
  -- Serialize message writes and closure on the same accepted request row.
  select existing.* into request from public.share_requests as existing
    where existing.id = p_request_id and existing.status = 'accepted'
      and actor in (existing.sender_id, existing.recipient_id)
    for update;
  if not found then
    raise exception using message = 'chat_unavailable';
  end if;

  if p_client_message_id is null or normalized_body is null
    or char_length(normalized_body) not between 1 and 2000 then
    raise exception using message = 'invalid_message';
  end if;

  select existing.* into message from private.chat_messages as existing
    where existing.request_id = request.id and existing.author_id = actor
      and existing.client_message_id = p_client_message_id;
  if found then
    if message.body <> normalized_body then
      raise exception using message = 'message_key_in_use';
    end if;
    -- A previous write can be acknowledged even after closure.
    return message.message_order::text;
  end if;

  if request.chat_closed_at is not null then
    raise exception using message = 'chat_closed';
  end if;

  insert into private.chat_messages (request_id, author_id, client_message_id, body)
    values (request.id, actor, p_client_message_id, normalized_body)
    returning * into message;

  return message.message_order::text;
end;
$$;

create or replace function public.close_share_conversation(p_request_id uuid)
returns timestamptz
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := auth.uid();
  closed timestamptz;
begin
  update public.share_requests as request
    set chat_closed_at = coalesce(request.chat_closed_at, clock_timestamp())
    where request.id = p_request_id and request.status = 'accepted'
      and actor in (request.sender_id, request.recipient_id)
    returning request.chat_closed_at into closed;
  if not found then
    raise exception using message = 'chat_unavailable';
  end if;
  return closed;
end;
$$;

revoke execute on function public.read_share_conversation(uuid),
  public.send_share_message(uuid, uuid, text), public.close_share_conversation(uuid)
  from public, anon;
grant execute on function public.read_share_conversation(uuid),
  public.send_share_message(uuid, uuid, text), public.close_share_conversation(uuid)
  to authenticated;

notify pgrst, 'reload schema';

commit;
