const summaryColumns = "id,owner_id,pickup_label,dropoff_label,travel_date,departure_start,departure_end,time_zone,services";

function fetchWithTimeout(resource, options = {}) {
  const timeout = AbortSignal.timeout(12000);
  const signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout;
  return fetch(resource, { ...options, signal });
}

export async function connectBackend() {
  const response = await fetchWithTimeout("./config.json");
  if (!response.ok) throw new Error("The preview couldn’t load its Supabase configuration.");

  const config = await response.json();
  if (config.state === "missing") {
    throw new Error("Add SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY to .env, then retry.");
  }
  if (config.state === "invalid") {
    throw new Error("Check that .env contains your Supabase project URL and its sb_publishable_ key.");
  }
  if (!window.supabase) {
    throw new Error("The Supabase library couldn’t load. Run npm install and reload the preview.");
  }

  return window.supabase.createClient(config.url, config.publishableKey, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
    global: { fetch: fetchWithTimeout },
  });
}

export async function fetchTrips(client, ownerId) {
  const query = (columns) => client.from("trips")
    .select(columns)
    .eq("owner_id", ownerId)
    .order("created_at", { ascending: false });
  let { data, error } = await query(`${summaryColumns},departure_ends_at`);
  // Keep Saved trips available while the matching migration is being applied.
  if (error?.code === "42703") ({ data, error } = await query(summaryColumns));
  if (error) throw error;
  return data;
}

async function runRpc(client, name, params) {
  const { data, error } = await client.rpc(name, params);
  if (error) throw error;
  return data;
}

export function fetchMatches(client, tripId) {
  return runRpc(client, "find_trip_matches", { p_trip_id: tripId });
}

export async function sendShareRequest(client, tripId, matchTripId) {
  const rows = await runRpc(client, "send_share_request", { p_trip_id: tripId, p_match_trip_id: matchTripId });
  if (!rows?.[0]) throw new Error("Request confirmation missing");
  return rows[0];
}

export function skipTripMatch(client, tripId, matchTripId) {
  return runRpc(client, "skip_trip_match", { p_trip_id: tripId, p_match_trip_id: matchTripId });
}

export function fetchShareRequests(client) {
  return runRpc(client, "list_share_requests");
}

export function respondToShareRequest(client, requestId, accept) {
  return runRpc(client, "respond_to_share_request", { p_request_id: requestId, p_accept: accept });
}

export function readShareConversation(client, requestId) {
  return runRpc(client, "read_share_conversation", { p_request_id: requestId });
}

export function sendShareMessage(client, requestId, messageId, body) {
  return runRpc(client, "send_share_message", {
    p_request_id: requestId, p_client_message_id: messageId, p_body: body,
  });
}

export function closeShareConversation(client, requestId) {
  return runRpc(client, "close_share_conversation", { p_request_id: requestId });
}

export async function saveTrip(client, trip) {
  const inserted = await client.from("trips").insert(trip).select(summaryColumns).single();
  if (!inserted.error) return inserted.data;
  if (inserted.error.code !== "23505") throw inserted.error;

  // A timed-out request may already have committed. Confirm the original row on retry.
  const existing = await client.from("trips").select(summaryColumns)
    .eq("id", trip.id).eq("owner_id", trip.owner_id).single();
  if (existing.error) throw existing.error;
  return existing.data;
}
