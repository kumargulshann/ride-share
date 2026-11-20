import {
  connectBackend, fetchMatches, fetchShareRequests, fetchTrips, respondToShareRequest,
  saveTrip, sendShareRequest, skipTripMatch,
} from "./backend.js";
import { createChatView } from "./chat.js";

const STARTING_VIEW = [26.464, 80.331];
const pointNames = { pickup: "pickup", dropoff: "drop-off" };
const points = { pickup: null, dropoff: null };
const markers = {};
const byId = (id) => document.getElementById(id);
const form = byId("trip-form");
const mapElement = byId("trip-map");
const dateField = byId("travel-date");
const departureStart = byId("depart-from");
const departureEnd = byId("depart-to");
const formError = byId("form-error");
const useCenter = byId("use-center");
const locateButton = byId("locate");
const mapNotice = byId("map-notice");
const pickButtons = Array.from(form.querySelectorAll("[data-pick]"));
const travelerForm = byId("traveler-form");
const displayName = byId("display-name");
const signInButton = byId("sign-in");
const retryConnection = byId("retry-connection");
const authStatus = byId("auth-status");
const authError = byId("auth-error");
const postButton = byId("post-trip");
const tripList = byId("trip-list");
const tripStatus = byId("empty-state");
const retryTrips = byId("retry-trips");
const saveMessage = byId("save-message");
const plannerView = byId("planner-view");
const matchesView = byId("matches-view");
const matchesList = byId("matches-list");
const refreshMatchesButton = byId("refresh-matches");
const requestsView = byId("requests-view");
const requestsLink = byId("requests-link");
const requestCount = byId("request-count");
const requestsLoadStatus = byId("requests-load-status");
const requestsActionError = byId("requests-action-error");
const REQUEST_POLL_MS = 4000;
const chatView = createChatView(REQUEST_POLL_MS);
const dateFormat = new Intl.DateTimeFormat("en-IN", { dateStyle: "long", timeZone: "UTC" });
const timeFormat = new Intl.DateTimeFormat("en-IN", {
  hour: "numeric",
  minute: "2-digit",
  timeZone: "UTC",
});
let activePoint = "pickup";
let map;
let client;
let currentUser;
let displayedTrips = [];
let listRequest = 0;
let draftRevision = 0;
let retryDraft;
let saving = false;
let tripExpiryTimer;
let selectedTrip;
let matchesRequest = 0;
let requestRows = null;
let requestPollSequence = 0;
let requestPollTimer;
let requestsLoading = false;
const pendingMatchActions = new Set();
const pendingDecisions = new Set();

function localToday() {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return [now.getFullYear(), month, day].join("-");
}

function showMapNotice(message) {
  mapNotice.textContent = message;
  mapNotice.hidden = !message;
}

function choosePoint(kind) {
  activePoint = kind;
  for (const button of pickButtons) {
    button.setAttribute("aria-pressed", String(button.dataset.pick === kind));
  }
  mapElement.dataset.picking = String(Boolean(kind));
  useCenter.disabled = !kind || !map;
  byId("map-guide").textContent = kind
    ? `Tap the map to set ${pointNames[kind]}.`
    : "Both points are set. Use Set on map to move a point.";
}

function setMapPoint(latLng) {
  if (!activePoint) return;

  const kind = activePoint;
  const { lat, lng } = latLng.wrap();
  points[kind] = { latitude: lat, longitude: lng };
  if (markers[kind]) {
    markers[kind].setLatLng(latLng);
  } else {
    markers[kind] = L.marker(latLng, {
      icon: L.divIcon({ className: `map-marker ${kind}`, iconSize: [22, 22] }),
      interactive: false,
      keyboard: false,
    }).addTo(map);
  }

  const status = byId(`${kind}-status`);
  status.dataset.selected = "true";
  status.textContent = `Point set · ${lat.toFixed(4)}, ${lng.toFixed(4)}`;
  onDraftChange();
  const other = kind === "pickup" ? "dropoff" : "pickup";
  choosePoint(points[other] ? null : other);
}

function initializeMap() {
  if (!window.L) {
    showMapNotice("The map couldn’t open. Refresh the page to try again.");
    byId("map-guide").textContent = "A working map is required to select your stops.";
    useCenter.disabled = true;
    locateButton.disabled = true;
    return;
  }

  map = L.map(mapElement, { scrollWheelZoom: false, worldCopyJump: true })
    .setView(STARTING_VIEW, 13);
  map.attributionControl.setPrefix(false);
  const tiles = L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
  });
  tiles.on("load", () => {
    const hasTiles = Boolean(mapElement.querySelector(".leaflet-tile-loaded"));
    showMapNotice(hasTiles ? "" : "Map imagery couldn’t load. Check your connection and refresh to try again.");
  });
  tiles.addTo(map);
  map.on("click", ({ latlng }) => setMapPoint(latlng));
  choosePoint("pickup");

  for (const button of pickButtons) {
    button.addEventListener("click", () => {
      const kind = button.dataset.pick;
      choosePoint(kind);
      if (markers[kind]) map.panTo(markers[kind].getLatLng());
      if (window.matchMedia("(max-width: 760px)").matches) {
        byId("map-panel").scrollIntoView({ block: "start" });
      }
      mapElement.focus({ preventScroll: true });
    });
  }
  useCenter.addEventListener("click", () => setMapPoint(map.getCenter()));
  locateButton.addEventListener("click", () => {
    locateButton.disabled = true;
    showMapNotice("");
    map.locate({ setView: true, maxZoom: 16, timeout: 10000 });
  });
  map.on("locationfound", () => {
    locateButton.disabled = false;
  });
  map.on("locationerror", () => {
    locateButton.disabled = false;
    showMapNotice("Your location is unavailable. You can still pan the map to find your stops.");
  });
}

function isActiveTrip(trip) {
  return Date.parse(trip.departure_ends_at) >= Date.now();
}

function addServiceLabels(container, services) {
  for (const service of services) {
    const pill = document.createElement("span");
    pill.textContent = service;
    container.append(pill);
  }
}

function makeTripCard(trip, showMatchAction = true) {
  const card = byId("saved-trip-template").content.cloneNode(true);
  const article = card.querySelector("article");
  article.dataset.tripId = trip.id;
  article.dataset.ownerId = trip.owner_id;
  const value = (name) => card.querySelector(`[data-value="${name}"]`);
  value("pickup").textContent = trip.pickup_label;
  value("dropoff").textContent = trip.dropoff_label;
  value("date").textContent = dateFormat.format(new Date(trip.travel_date));
  const start = timeFormat.format(new Date(`2000-01-01T${trip.departure_start.slice(0, 5)}:00Z`));
  const end = timeFormat.format(new Date(`2000-01-01T${trip.departure_end.slice(0, 5)}:00Z`));
  value("time").textContent = `${start} – ${end} · ${trip.time_zone}`;
  addServiceLabels(value("services"), trip.services);
  if (showMatchAction && isActiveTrip(trip)) {
    const action = card.querySelector(".find-matches");
    action.hidden = false;
    action.addEventListener("click", () => openMatches(trip));
  }
  return card;
}

function renderTrips(trips) {
  displayedTrips = trips;
  tripList.replaceChildren(...trips.map((trip) => makeTripCard(trip)));
  const count = byId("trip-count");
  count.hidden = trips.length === 0;
  count.textContent = trips.length;

  clearTimeout(tripExpiryTimer);
  const now = Date.now();
  const expiry = Math.min(...trips.map((trip) => Date.parse(trip.departure_ends_at)).filter((end) => end >= now));
  if (Number.isFinite(expiry)) {
    tripExpiryTimer = setTimeout(() => {
      renderTrips(displayedTrips);
      if (selectedTrip && !isActiveTrip(selectedTrip)) void refreshMatches();
    }, Math.min(expiry - now + 1, 2147483647));
  }
}

function cardField(card, name) {
  return card.querySelector(`[data-value="${name}"]`);
}

function makeTravelerCard(match, timeZone) {
  const card = byId("match-card-template").content.firstElementChild.cloneNode(true);
  const value = (name) => card.querySelector(`[data-value="${name}"]`);
  value("name").textContent = match.display_name;
  value("pickup").textContent = match.pickup_area;
  value("dropoff").textContent = match.dropoff_area;
  const start = new Date(match.shared_start);
  const end = new Date(match.shared_end);
  const date = new Intl.DateTimeFormat("en-IN", { dateStyle: "long", timeZone });
  const time = new Intl.DateTimeFormat("en-IN", { hour: "numeric", minute: "2-digit", timeZone });
  value("window").textContent = time.formatRange(start, end);
  value("date").textContent = `${date.format(start)} · ${timeZone}`;
  addServiceLabels(value("services"), match.services);
  return card;
}

function setNotice(element, message = "") {
  element.textContent = message;
  element.hidden = !message;
}

function actionButton(label, className, action) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = className;
  button.textContent = label;
  button.addEventListener("click", action);
  return button;
}

function requestStatusText({ request_status: status, request_direction: direction, display_name: name }) {
  const sent = direction === "sent";
  switch (status) {
    case "pending": return sent ? "Request sent" : "Incoming request";
    case "accepted": return sent ? `${name} accepted your request to chat.` : `You accepted ${name}’s request to chat.`;
    case "declined": return sent ? `${name} declined your request.` : `You declined ${name}’s request.`;
    case "expired": return "Request expired";
    default: return "";
  }
}

function renderMatchActions(card, trip, match) {
  const controls = cardField(card, "actions");
  controls.replaceChildren();
  setNotice(cardField(card, "status"), requestStatusText(match));
  if (!match.match_trip_id) return;

  if (match.request_status) {
    const link = document.createElement("a");
    link.href = "#requests";
    link.className = "secondary-button";
    link.textContent = match.request_direction === "incoming" && match.request_status === "pending"
      ? "Review request"
      : "View requests";
    controls.append(link);
    return;
  }

  const send = actionButton("Request to share", "submit-button", () => actOnMatch(card, trip, match, true));
  const skip = actionButton("Skip", "secondary-button", () => actOnMatch(card, trip, match, false));
  send.disabled = skip.disabled = pendingMatchActions.has(matchActionKey(trip, match));
  controls.append(send, skip);
}

function matchActionKey(trip, match) {
  return `${trip.id}/${match.match_trip_id}`;
}

async function actOnMatch(card, trip, match, send) {
  const key = matchActionKey(trip, match);
  if (selectedTrip?.id !== trip.id || pendingMatchActions.has(key)) return;

  pendingMatchActions.add(key);
  renderMatchActions(card, trip, match);
  setNotice(cardField(card, "error"));
  try {
    if (send) {
      const confirmation = await sendShareRequest(client, trip.id, match.match_trip_id);
      Object.assign(match, confirmation);
      void loadShareRequests(true);
    } else {
      await skipTripMatch(client, trip.id, match.match_trip_id);
      if (selectedTrip?.id !== trip.id) return;
      if (!card.isConnected) {
        void refreshMatches();
        return;
      }
      card.remove();
      if (!matchesList.childElementCount) showMatchesStatus("No matches yet", "Check again while your trip is active.");
    }
  } catch (error) {
    const message = error.message === "match_unavailable"
      ? "This match is no longer available. Refresh matches."
      : send ? "Couldn’t confirm the request. Try Request to share again." : "Couldn’t skip the match. Try again.";
    setNotice(cardField(card, "error"), message);
  } finally {
    pendingMatchActions.delete(key);
    if (card.isConnected) renderMatchActions(card, trip, match);
  }
}

function showMatchesStatus(title, detail = "") {
  byId("matches-status-title").textContent = title;
  byId("matches-status-detail").textContent = detail;
  byId("matches-status-detail").hidden = !detail;
  byId("matches-status").hidden = !title;
}

async function refreshMatches() {
  const trip = selectedTrip;
  if (!trip) return;

  const request = ++matchesRequest;
  matchesList.replaceChildren();
  refreshMatchesButton.disabled = true;
  if (!isActiveTrip(trip)) {
    showMatchesStatus("Departure window ended", "Choose another active trip from Saved trips.");
    return;
  }

  showMatchesStatus("Looking for matches…");
  try {
    const matches = await fetchMatches(client, trip.id);
    if (request !== matchesRequest) return;
    if (!matches.length) {
      showMatchesStatus("No matches yet", "Check again while your trip is active.");
      return;
    }

    matchesList.replaceChildren(...matches.map((match) => {
      const card = makeTravelerCard(match, trip.time_zone);
      renderMatchActions(card, trip, match);
      return card;
    }));
    showMatchesStatus("");
  } catch {
    if (request === matchesRequest) {
      showMatchesStatus("Couldn’t load matches", "Check your connection and choose Refresh matches to try again.");
    }
  } finally {
    if (request === matchesRequest) refreshMatchesButton.disabled = false;
  }
}

function openMatches(trip) {
  if (!isActiveTrip(trip)) {
    renderTrips(displayedTrips);
    return;
  }

  selectedTrip = trip;
  byId("selected-trip-card").replaceChildren(makeTripCard(trip, false));
  plannerView.hidden = true;
  matchesView.hidden = false;
  window.scrollTo(0, 0);
  byId("matches-title").focus();
  void refreshMatches();
}

function closeMatches(event) {
  if (!selectedTrip) return;

  event?.preventDefault();
  matchesRequest += 1;
  selectedTrip = null;
  matchesView.hidden = true;
  plannerView.hidden = false;
  matchesList.replaceChildren();
  byId("selected-trip-card").replaceChildren();
  map?.invalidateSize({ pan: false });
  if (event) byId("saved-title").focus();
}

function renderSharingRequests() {
  const rows = requestRows ?? [];
  const pending = rows.filter((row) => row.request_direction === "incoming" && row.request_status === "pending").length;
  requestCount.hidden = pending === 0;
  requestCount.textContent = pending;
  requestCount.setAttribute("aria-label", `${pending} pending incoming ${pending === 1 ? "request" : "requests"}`);

  for (const direction of ["incoming", "sent"]) {
    const items = rows.filter((row) => row.request_direction === direction);
    byId(`${direction}-empty`).hidden = requestRows === null || items.length !== 0;
    byId(`${direction}-list`).replaceChildren(...items.map((row) => {
      const card = makeTravelerCard(row, row.time_zone);
      card.dataset.requestId = row.request_id;
      if (direction === "incoming" && row.request_status === "pending") {
        const accept = actionButton("Accept", "submit-button", () => answerRequest(row, true));
        const decline = actionButton("Decline", "secondary-button", () => answerRequest(row, false));
        accept.disabled = decline.disabled = pendingDecisions.has(row.request_id);
        cardField(card, "actions").append(accept, decline);
      }
      if (row.request_status === "accepted") {
        const chatLink = document.createElement("a");
        chatLink.className = "secondary-button";
        chatLink.href = `#chat/${row.request_id}`;
        chatLink.textContent = "Open chat";
        cardField(card, "actions").append(chatLink);
      }
      setNotice(cardField(card, "status"), requestStatusText(row));
      return card;
    }));
  }
}

async function loadShareRequests(force = false) {
  if (!currentUser || (requestsLoading && !force)) return;

  clearTimeout(requestPollTimer);
  const sequence = ++requestPollSequence;
  requestsLoading = true;
  if (requestRows === null) setNotice(requestsLoadStatus, "Loading requests…");
  try {
    const rows = await fetchShareRequests(client);
    if (sequence !== requestPollSequence) return;
    const changed = JSON.stringify(requestRows) !== JSON.stringify(rows);
    requestRows = rows;
    setNotice(requestsLoadStatus);
    if (changed) {
      renderSharingRequests();
      if (selectedTrip && pendingMatchActions.size === 0) void refreshMatches();
    }
  } catch {
    if (sequence === requestPollSequence) {
      setNotice(requestsLoadStatus, "Couldn’t update requests. Use Refresh requests to try again.");
    }
  } finally {
    if (sequence === requestPollSequence) {
      requestsLoading = false;
      requestPollTimer = setTimeout(loadShareRequests, REQUEST_POLL_MS);
    }
  }
}

async function answerRequest(row, accept) {
  const id = row.request_id;
  if (pendingDecisions.has(id)) return;
  const owner = currentUser?.id;
  pendingDecisions.add(id);
  setNotice(requestsActionError);
  renderSharingRequests();
  try {
    const status = await respondToShareRequest(client, id, accept);
    if (currentUser?.id !== owner) return;
    requestRows = requestRows.map((request) => request.request_id === id
      ? { ...request, request_status: status }
      : request);
    void loadShareRequests(true);
  } catch {
    if (currentUser?.id === owner) {
      setNotice(requestsActionError, "Couldn’t confirm your decision. Try again or refresh requests.");
    }
  } finally {
    pendingDecisions.delete(id);
    if (currentUser?.id === owner) renderSharingRequests();
  }
}

function syncRequestsView() {
  const show = Boolean(currentUser && location.hash === "#requests");
  const chatId = currentUser && /^#chat\/([0-9a-f-]{36})$/i.exec(location.hash)?.[1];
  const wasShowingRequests = !requestsView.hidden;
  const wasShowingChat = chatView.isOpen();
  if (show || chatId) {
    closeMatches();
    plannerView.hidden = true;
    requestsLink.setAttribute("aria-current", "page");
  }
  requestsView.hidden = !show;
  if (chatId) chatView.open(client, currentUser.id, chatId);
  else chatView.hide();
  if (show && !wasShowingRequests) {
    window.scrollTo(0, 0);
    byId("requests-title").focus();
    void loadShareRequests();
  } else if (!show && !chatId && (wasShowingRequests || wasShowingChat)) {
    plannerView.hidden = false;
    requestsLink.removeAttribute("aria-current");
    map?.invalidateSize({ pan: false });
    if (location.hash === "#saved-trips") byId("saved-title").focus();
  }
}

function resetSharingRequests() {
  requestPollSequence += 1;
  clearTimeout(requestPollTimer);
  requestsLoading = false;
  requestRows = null;
  setNotice(requestsLoadStatus);
  setNotice(requestsActionError);
  renderSharingRequests();
}

function showTripStatus(message, canRetry = false) {
  tripStatus.textContent = message;
  tripStatus.hidden = !message;
  retryTrips.hidden = !canRetry;
}

async function loadTrips() {
  const ownerId = currentUser?.id;
  if (!ownerId) return;

  const request = ++listRequest;
  showTripStatus(displayedTrips.length ? "" : "Loading your trips…");
  try {
    const trips = await fetchTrips(client, ownerId);
    if (request !== listRequest) return;
    renderTrips(trips);
    showTripStatus(trips.length ? "" : "Your posted trips will appear here.");
  } catch {
    if (request === listRequest) showTripStatus("Your trips couldn’t be loaded.", true);
  }
}

function updatePostButton() {
  postButton.disabled = !currentUser || saving;
  postButton.textContent = saving ? "Saving…" : "Post trip";
}

function showAuthError(message) {
  authError.textContent = message;
  authError.hidden = !message;
}

function applySession(session) {
  const previousOwner = currentUser?.id;
  currentUser = session?.user ?? null;
  travelerForm.hidden = Boolean(currentUser);
  const name = currentUser?.user_metadata?.display_name;
  authStatus.textContent = currentUser
    ? `Signed in as ${typeof name === "string" && name ? name : "Traveler"}.`
    : "Enter a display name to start.";
  updatePostButton();

  if (previousOwner !== currentUser?.id) {
    closeMatches();
    resetSharingRequests();
    requestsLink.hidden = !currentUser;
    listRequest += 1;
    saveMessage.hidden = true;
    renderTrips([]);
    if (currentUser) {
      showTripStatus("Loading your trips…");
      // Run database calls after Supabase releases the auth event lock.
      setTimeout(() => {
        void loadTrips();
        syncRequestsView();
        void loadShareRequests();
      }, 0);
    } else {
      showTripStatus("Sign in to see your trips.");
      syncRequestsView();
    }
  }
}

async function initializeBackend() {
  retryConnection.hidden = true;
  showAuthError("");
  authStatus.textContent = "Connecting to Supabase…";
  try {
    client ??= await connectBackend();
    const { data, error } = await client.auth.getSession();
    if (error) throw new Error("Your session couldn’t be checked. Try connecting again.");
    applySession(data.session);
    client.auth.onAuthStateChange((_event, session) => applySession(session));
  } catch (error) {
    authStatus.textContent = "Supabase connection unavailable.";
    showAuthError(error.message);
    retryConnection.hidden = false;
  }
}

travelerForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!client || currentUser || signInButton.disabled) return;

  const name = displayName.value.trim();
  if (!name) {
    showAuthError("Enter a display name.");
    displayName.focus();
    return;
  }

  showAuthError("");
  signInButton.disabled = true;
  signInButton.textContent = "Signing in…";
  try {
    const { data, error } = await client.auth.signInAnonymously({ options: { data: { display_name: name } } });
    if (error || !data.session) throw error ?? new Error("Session missing");
    applySession(data.session);
  } catch (error) {
    const message = error.code === "anonymous_provider_disabled"
      ? "Enable anonymous sign-ins in Supabase Authentication, then try again."
      : "Couldn’t sign in. Check the Supabase connection and try again.";
    showAuthError(message);
  } finally {
    signInButton.disabled = false;
    signInButton.textContent = "Continue";
  }
});

displayName.addEventListener("input", () => showAuthError(""));
retryConnection.addEventListener("click", initializeBackend);
retryTrips.addEventListener("click", loadTrips);
refreshMatchesButton.addEventListener("click", refreshMatches);
byId("back-to-trips").addEventListener("click", closeMatches);
byId("saved-trips-link").addEventListener("click", closeMatches);
byId("refresh-requests").addEventListener("click", () => loadShareRequests(true));
window.addEventListener("hashchange", syncRequestsView);

function rejectTrip(message, field) {
  formError.textContent = message;
  formError.hidden = false;
  field?.setAttribute("aria-invalid", "true");
  field?.setAttribute("aria-errormessage", "form-error");
  (field ?? formError).focus();
}

function clearError() {
  formError.hidden = true;
  for (const field of form.querySelectorAll('[aria-invalid="true"]')) {
    field.removeAttribute("aria-invalid");
    field.removeAttribute("aria-errormessage");
  }
}

function onDraftChange() {
  draftRevision += 1;
  clearError();
}

function resetForm() {
  form.reset();
  for (const kind of Object.keys(points)) {
    points[kind] = null;
    markers[kind]?.remove();
    delete markers[kind];
    const status = byId(`${kind}-status`);
    delete status.dataset.selected;
    status.textContent = "Pick a point on the map";
  }
  choosePoint("pickup");
}

form.addEventListener("input", onDraftChange);
form.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!currentUser || saving) return;

  clearError();
  saveMessage.hidden = true;
  dateField.min = localToday();

  const locations = {};
  for (const kind of Object.keys(points)) {
    const field = byId(`${kind}-label`);
    const label = field.value.trim();
    if (!label) return rejectTrip(`Enter a label for your ${pointNames[kind]} point.`, field);
    if (!points[kind]) {
      return rejectTrip(`Set your ${pointNames[kind]} point on the map.`, byId(`pick-${kind}`));
    }
    locations[kind] = { label, ...points[kind] };
  }

  if (!dateField.value) return rejectTrip("Choose a travel date.", dateField);
  if (dateField.validity.rangeUnderflow) return rejectTrip("Choose today or a future travel date.", dateField);
  if (!departureStart.value) return rejectTrip("Choose the earliest departure time.", departureStart);
  if (!departureEnd.value) return rejectTrip("Choose the latest departure time.", departureEnd);
  if (departureEnd.value <= departureStart.value) {
    return rejectTrip("Latest departure must be later than earliest departure.", departureEnd);
  }

  const services = new FormData(form).getAll("service");
  if (!services.length) {
    return rejectTrip("Select at least one preferred cab service.", form.querySelector('input[name="service"]'));
  }

  const ownerId = currentUser.id;
  const draft = {
    owner_id: ownerId,
    pickup_label: locations.pickup.label,
    pickup_latitude: locations.pickup.latitude,
    pickup_longitude: locations.pickup.longitude,
    dropoff_label: locations.dropoff.label,
    dropoff_latitude: locations.dropoff.latitude,
    dropoff_longitude: locations.dropoff.longitude,
    travel_date: dateField.value,
    departure_start: departureStart.value,
    departure_end: departureEnd.value,
    time_zone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
    services,
  };

  const fingerprint = JSON.stringify(draft);
  if (retryDraft?.fingerprint !== fingerprint) {
    retryDraft = { fingerprint, id: crypto.randomUUID() };
  }

  const revision = draftRevision;
  let savedTrip;
  saving = true;
  updatePostButton();
  try {
    savedTrip = await saveTrip(client, { id: retryDraft.id, ...draft });
  } catch {
    if (currentUser?.id === ownerId) {
      rejectTrip("Couldn’t confirm the save. Your details are still here. Try Post trip again.");
    }
    return;
  } finally {
    saving = false;
    updatePostButton();
  }

  retryDraft = null;
  if (currentUser?.id !== ownerId) return;
  if (draftRevision === revision) resetForm();
  renderTrips([savedTrip, ...displayedTrips.filter((trip) => trip.id !== savedTrip.id)]);
  void loadTrips();
  saveMessage.textContent = "Trip saved";
  saveMessage.hidden = false;
  byId("saved-title").focus();
});

dateField.min = localToday();
initializeMap();
void initializeBackend();
