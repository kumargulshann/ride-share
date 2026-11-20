import { closeShareConversation, readShareConversation, sendShareMessage } from "./backend.js";

function notice(element, text = "") {
  element.textContent = text;
  element.hidden = !text;
}

function readDraft(key) {
  try {
    const saved = JSON.parse(sessionStorage.getItem(key));
    if (typeof saved?.text === "string") return saved;
  } catch {
    // Chat still works when the browser's session storage is unavailable.
  }
  return { text: "", pending: null };
}

function saveDraft(state) {
  try {
    if (state.draft.text || state.draft.pending) {
      sessionStorage.setItem(state.storageKey, JSON.stringify(state.draft));
    } else {
      sessionStorage.removeItem(state.storageKey);
    }
  } catch {
    // The draft is also held in memory while the conversation is open.
  }
}

function makeMessage(message, otherName, timeFormat) {
  const item = document.createElement("li");
  item.className = message.mine ? "chat-message mine" : "chat-message";
  const meta = document.createElement("div");
  meta.className = "chat-message-meta";
  const author = document.createElement("strong");
  author.textContent = message.mine ? "You" : otherName;
  const time = document.createElement("time");
  time.dateTime = message.created_at;
  time.textContent = timeFormat.format(new Date(message.created_at));
  const body = document.createElement("p");
  body.className = "chat-message-body";
  body.textContent = message.body;
  meta.append(author, time);
  item.append(meta, body);
  return item;
}

export function createChatView(pollInterval) {
  const byId = (id) => document.getElementById(id);
  const page = byId("chat-view");
  const title = byId("chat-title");
  const details = byId("chat-details");
  const thread = byId("chat-thread");
  const messages = byId("chat-messages");
  const composer = byId("chat-composer");
  const entry = byId("chat-entry");
  const send = byId("chat-send");
  const sendError = byId("chat-send-error");
  const loadStatus = byId("chat-load-status");
  const retry = byId("retry-chat");
  const close = byId("close-chat");
  const dialog = byId("close-chat-dialog");
  const confirmClose = byId("confirm-close-chat");
  const closeError = byId("chat-close-error");
  let active;

  function fitViewport() {
    if (!active) return;
    const viewport = window.visualViewport;
    const bottom = viewport ? viewport.offsetTop + viewport.height : window.innerHeight;
    const available = Math.max(0, bottom - page.getBoundingClientRect().top);
    page.style.setProperty("--chat-height", `${available}px`);
  }

  function isClosed(state) {
    return Boolean(state.snapshot?.closed_at || state.rejectedAfterClose);
  }

  function updateComposer(state) {
    const closed = isClosed(state);
    const showDraft = closed && Boolean(entry.value.trim());
    composer.hidden = !state.snapshot || (closed && !showDraft);
    entry.readOnly = closed || state.sending;
    send.hidden = closed;
    send.disabled = !state.snapshot || closed || state.sending || !entry.value.trim();
    send.textContent = state.sending ? "Sending…" : "Send";
    close.hidden = !state.snapshot || closed;
    byId("chat-closed").hidden = !closed;
  }

  function renderConversation(state, snapshot) {
    const previous = state.snapshot?.messages ?? [];
    state.snapshot = snapshot;
    title.textContent = `Chat with ${snapshot.display_name}`;
    details.hidden = false;
    byId("chat-pickup").textContent = snapshot.pickup_area;
    byId("chat-dropoff").textContent = snapshot.dropoff_area;

    const timeZone = snapshot.time_zone;
    const time = new Intl.DateTimeFormat("en-IN", { hour: "numeric", minute: "2-digit", timeZone });
    const date = new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeZone });
    const start = new Date(snapshot.shared_start);
    const end = new Date(snapshot.shared_end);
    byId("chat-window").textContent = `${time.formatRange(start, end)} · ${date.format(start)}`;

    const nearEnd = thread.scrollHeight - thread.scrollTop - thread.clientHeight < 80;
    const appended = snapshot.messages.slice(previous.length);
    for (const message of appended) messages.append(makeMessage(message, snapshot.display_name, time));

    byId("chat-empty").hidden = snapshot.messages.length > 0 || isClosed(state);
    if (dialog.open && isClosed(state)) dialog.close();
    updateComposer(state);
    if (nearEnd || appended.some((message) => message.mine)) thread.scrollTop = thread.scrollHeight;
  }

  async function refresh(state, force = false) {
    if (active !== state || (state.loading && !force)) return;
    clearTimeout(state.timer);
    const sequence = ++state.sequence;
    state.loading = true;
    retry.hidden = true;
    if (!state.snapshot) notice(loadStatus, "Loading conversation…");
    try {
      const snapshot = await readShareConversation(state.client, state.requestId);
      if (active !== state || sequence !== state.sequence) return;
      notice(loadStatus);
      renderConversation(state, snapshot);
    } catch (error) {
      if (active !== state || sequence !== state.sequence) return;
      if (error.message === "chat_unavailable") {
        state.unavailable = true;
        state.snapshot = null;
        title.textContent = "Conversation";
        details.hidden = true;
        messages.replaceChildren();
        byId("chat-empty").hidden = true;
        updateComposer(state);
        notice(loadStatus, "This conversation is unavailable for your account.");
      } else {
        notice(loadStatus, "Couldn’t load the conversation. Try again.");
        retry.hidden = false;
      }
    } finally {
      if (active === state && sequence === state.sequence) {
        state.loading = false;
        if (!state.unavailable) state.timer = setTimeout(() => refresh(state), pollInterval);
      }
    }
  }

  function hide() {
    if (!active) return;
    clearTimeout(active.timer);
    active = null;
    page.hidden = true;
    if (dialog.open) dialog.close();
    entry.value = "";
    messages.replaceChildren();
  }

  function open(client, userId, requestId) {
    if (active?.requestId === requestId && active.userId === userId) return;
    hide();
    const storageKey = `rideshare.chat.draft.v1.${userId}.${requestId}`;
    const state = { client, userId, requestId, storageKey, draft: readDraft(storageKey), sequence: 0 };
    active = state;
    entry.value = state.draft.text;
    notice(sendError);
    notice(closeError);
    confirmClose.disabled = false;
    title.textContent = "Conversation";
    details.hidden = true;
    byId("chat-empty").hidden = true;
    page.hidden = false;
    updateComposer(state);
    window.scrollTo(0, 0);
    fitViewport();
    title.focus({ preventScroll: true });
    void refresh(state);
  }

  entry.addEventListener("input", () => {
    if (!active) return;
    active.draft.text = entry.value;
    saveDraft(active);
    notice(sendError);
    updateComposer(active);
  });

  composer.addEventListener("submit", async (event) => {
    event.preventDefault();
    const state = active;
    const body = entry.value.trim();
    if (!state?.snapshot || state.sending || isClosed(state) || !body) return;

    if (state.draft.pending?.body !== body) state.draft.pending = { body, id: crypto.randomUUID() };
    const { id } = state.draft.pending;
    saveDraft(state);
    state.sending = true;
    notice(sendError);
    updateComposer(state);
    try {
      await sendShareMessage(state.client, state.requestId, id, body);
      state.draft = { text: "", pending: null };
      if (active === state || active?.storageKey !== state.storageKey) saveDraft(state);
      if (active === state) {
        entry.value = "";
        void refresh(state, true);
      }
    } catch (error) {
      if (active !== state) return;
      if (error.message === "chat_closed") {
        state.rejectedAfterClose = true;
        notice(sendError, "This conversation is closed. Your unsent draft is still here.");
        void refresh(state, true);
      } else {
        notice(sendError, "Couldn’t confirm your message. Your draft is still here. Try Send again.");
      }
    } finally {
      state.sending = false;
      if (active === state) updateComposer(state);
    }
  });

  close.addEventListener("click", () => {
    if (!active?.snapshot || isClosed(active)) return;
    notice(closeError);
    dialog.showModal();
  });

  confirmClose.addEventListener("click", async () => {
    const state = active;
    if (!state?.snapshot || isClosed(state) || state.closing) return;
    state.closing = true;
    confirmClose.disabled = true;
    notice(closeError);
    try {
      const closedAt = await closeShareConversation(state.client, state.requestId);
      if (active !== state) return;
      state.snapshot.closed_at = closedAt;
      dialog.close();
      updateComposer(state);
      void refresh(state, true);
    } catch {
      if (active === state) notice(closeError, "Couldn’t confirm closure. Try again.");
    } finally {
      state.closing = false;
      if (active === state) confirmClose.disabled = false;
    }
  });

  retry.addEventListener("click", () => { if (active) void refresh(active, true); });
  window.addEventListener("resize", fitViewport);
  window.visualViewport?.addEventListener("resize", fitViewport);
  window.visualViewport?.addEventListener("scroll", fitViewport);

  return { open, hide, isOpen: () => Boolean(active) };
}
