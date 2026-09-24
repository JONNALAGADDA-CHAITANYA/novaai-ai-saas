const state = {
  token: localStorage.getItem("nova_token"),
  user: null,
  conversationId: null,
  conversations: [],
  sending: false
};

const $ = (id) => document.getElementById(id);

function showToast(message) {
  const toast = $("toast");
  toast.textContent = message;
  toast.classList.add("show");
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => toast.classList.remove("show"), 3200);
}

function escapeHtml(value) {
  return value.replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;"
  }[c]));
}

async function api(url, options = {}) {
  const headers = { "Content-Type": "application/json", ...(options.headers || {}) };
  if (state.token) headers.Authorization = `Bearer ${state.token}`;

  const response = await fetch(url, { ...options, headers });
  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    if (response.status === 401 && state.token) logout();
    throw new Error(data.error || "Request failed.");
  }
  return data;
}

function setAuthMode(mode) {
  document.querySelectorAll(".tab").forEach((b) => b.classList.toggle("active", b.dataset.auth === mode));
  $("login-form").classList.toggle("hidden", mode !== "login");
  $("register-form").classList.toggle("hidden", mode !== "register");
}

function showApp() {
  $("auth-view").classList.add("hidden");
  $("app-view").classList.remove("hidden");
}

function showAuth() {
  $("auth-view").classList.remove("hidden");
  $("app-view").classList.add("hidden");
}

async function loadMe() {
  const data = await api("/api/auth/me");
  state.user = data.user;
  $("user-name").textContent = state.user.name;
  $("user-email").textContent = state.user.email;
  $("avatar").textContent = state.user.name.charAt(0).toUpperCase();
}

async function loadUsage() {
  const data = await api("/api/usage");
  const percent = data.limit ? Math.min((data.used / data.limit) * 100, 100) : 0;
  $("usage-text").textContent = `${data.used} / ${data.limit}`;
  $("usage-bar").style.width = `${percent}%`;
}
function showDeleteModal() {
  return new Promise((resolve) => {
    const modal = $("delete-modal");
    const cancelButton = $("delete-cancel");
    const confirmButton = $("delete-confirm");
    const closeButton = $("delete-modal-close");

    if (!modal || !cancelButton || !confirmButton || !closeButton) {
      resolve(false);
      return;
    }

    modal.classList.remove("hidden");

    const close = (result) => {
      modal.classList.add("hidden");

      cancelButton.onclick = null;
      confirmButton.onclick = null;
      closeButton.onclick = null;

      resolve(result);
    };

    cancelButton.onclick = () => close(false);
    closeButton.onclick = () => close(false);
    confirmButton.onclick = () => close(true);
  });
}
async function loadConversations() {
  const data = await api("/api/conversations");
  state.conversations = data.conversations;
  renderConversations();
}

function renderConversations() {
  const list = $("conversation-list");
  list.innerHTML = "";

  if (!state.conversations.length) {
    list.innerHTML = `<div style="color:#777f8f;font-size:12px;padding:10px">No conversations yet.</div>`;
    return;
  }

  for (const c of state.conversations) {
    const row = document.createElement("div");
    row.className = `conversation-item ${state.conversationId === c.id ? "active" : ""}`;
    row.innerHTML = `
  <span class="chat-icon">◌</span>
<button class="title" type="button">${escapeHtml(c.title)}</button>
<button class="delete-chat" type="button" title="Delete">×</button>
`;
    row.querySelector(".title").onclick = () => openConversation(c.id);
    row.querySelector(".delete-chat").onclick = async (e) => {
  e.stopPropagation();

if (!(await showDeleteModal())) return;

  try {
    await api(`/api/conversations/${c.id}`, {
      method: "DELETE"
    });

    if (state.conversationId === c.id) {
      newConversation();
    }

    await loadConversations();

  } catch (err) {
    showToast(err.message);
  }
};


    list.appendChild(row);
  }
}

function renderMessage(role, content) {
  const wrapper = document.createElement("div");
  wrapper.className = `message ${role}`;
  wrapper.innerHTML = `
    <div class="message-avatar">${role === "user" ? "U" : "✦"}</div>
    <div class="bubble">${escapeHtml(content)}</div>
  `;
  $("messages").appendChild(wrapper);
  $("messages").scrollTop = $("messages").scrollHeight;
}

function renderWelcome() {
  $("messages").innerHTML = `
    <div class="welcome">
      <div class="welcome-icon">✦</div>
      <h1>What are you building today?</h1>
      <p>Ask NovaAI to explain a concept, write content, summarize notes, brainstorm ideas, or help with code.</p>
      <div class="suggestions">
        <button data-prompt="Explain REST APIs in simple terms">Explain REST APIs</button>
        <button data-prompt="Give me 5 project ideas for a college student">Project ideas</button>
        <button data-prompt="Rewrite this professionally: I need more time to finish the project">Rewrite professionally</button>
        <button data-prompt="Summarize the key benefits of cloud computing">Summarize</button>
      </div>
    </div>
  `;
  document.querySelectorAll("[data-prompt]").forEach((b) => {
    b.onclick = () => {
      $("message-input").value = b.dataset.prompt;
      $("message-input").focus();
    };
  });
}

function newConversation() {
  state.conversationId = null;
  $("conversation-title").textContent = "New conversation";
  renderWelcome();
  renderConversations();
}

async function ensureConversation() {
  if (state.conversationId) return state.conversationId;
  const data = await api("/api/conversations", {
    method: "POST",
    body: JSON.stringify({ title: "New conversation" })
  });
  state.conversationId = data.id;
  await loadConversations();
  return state.conversationId;
}

async function openConversation(id) {
  try {
    const data = await api(`/api/conversations/${id}`);
    state.conversationId = id;
    $("conversation-title").textContent = data.conversation.title;
    $("messages").innerHTML = "";
    for (const message of data.messages) renderMessage(message.role, message.content);
    renderConversations();
  } catch (err) {
    showToast(err.message);
  }
}

async function sendMessage(text) {
  if (state.sending) return;
  const message = text.trim();
  if (!message) return;

  state.sending = true;
  $("send-btn").disabled = true;
  renderMessage("user", message);

  const typing = document.createElement("div");
  typing.className = "message assistant";
  typing.id = "typing";
  typing.innerHTML = `<div class="message-avatar">✦</div><div class="typing">NovaAI is thinking…</div>`;
  $("messages").appendChild(typing);
  $("messages").scrollTop = $("messages").scrollHeight;

  try {
    const conversationId = await ensureConversation();
    const data = await api("/api/chat", {
      method: "POST",
      body: JSON.stringify({
        conversationId,
        message,
   mode: $("mode")?.value || "default"
      })
    });

    $("typing")?.remove();
    renderMessage("assistant", data.answer);
    await loadUsage();
    await loadConversations();

    const current = state.conversations.find((c) => c.id === state.conversationId);
    if (current) $("conversation-title").textContent = current.title;
  } catch (err) {
    $("typing")?.remove();
    renderMessage("assistant", `Error: ${err.message}`);
    showToast(err.message);
  } finally {
    state.sending = false;
    $("send-btn").disabled = false;
  }
}

function logout() {
  localStorage.removeItem("nova_token");
  state.token = null;
  state.user = null;
  state.conversationId = null;
  showAuth();
}

async function boot() {
  if (!state.token) {
    showAuth();
    return;
  }

  try {
    await loadMe();
    showApp();
    await Promise.all([loadUsage(), loadConversations()]);
  } catch {
    logout();
  }
}

document.querySelectorAll(".tab").forEach((button) => {
  button.addEventListener("click", () => setAuthMode(button.dataset.auth));
});

$("login-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  try {
    const data = await api("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({
        email: $("login-email").value,
        password: $("login-password").value
      })
    });
    state.token = data.token;
    localStorage.setItem("nova_token", state.token);
    await loadMe();
    showApp();
    await Promise.all([loadUsage(), loadConversations()]);
    showToast("Welcome back!");
  } catch (err) {
    showToast(err.message);
  }
});

$("register-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  try {
    const data = await api("/api/auth/register", {
      method: "POST",
      body: JSON.stringify({
        name: $("register-name").value,
        email: $("register-email").value,
        password: $("register-password").value
      })
    });
    state.token = data.token;
    localStorage.setItem("nova_token", state.token);
    await loadMe();
    showApp();
    await Promise.all([loadUsage(), loadConversations()]);
    showToast("Account created!");
  } catch (err) {
    showToast(err.message);
  }
});

$("logout").onclick = logout;
$("new-chat").onclick = newConversation;
$("chat-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const input = $("message-input");
  const value = input.value;
  input.value = "";
  input.style.height = "auto";
  await sendMessage(value);
});

$("message-input").addEventListener("input", (e) => {
  e.target.style.height = "auto";
  e.target.style.height = `${Math.min(e.target.scrollHeight, 180)}px`;
});

$("message-input").addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    $("chat-form").requestSubmit();
  }
});

$("upgrade-btn").onclick = () => $("upgrade-modal").classList.remove("hidden");
$("close-modal").onclick = () => $("upgrade-modal").classList.add("hidden");
$("demo-upgrade").onclick = () => {
  showToast("Demo only: connect Stripe before enabling real billing.");
  $("upgrade-modal").classList.add("hidden");
};

document.addEventListener("click", (e) => {
  const button = e.target.closest("[data-prompt]");

  if (!button) return;

  const input = $("message-input");

  if (!input) return;

  input.value = button.dataset.prompt || "";
  input.focus();
});
/* =========================================================
   MOBILE RECENT CHATS DRAWER
   ========================================================= */

const mobileMenuButton = $("mobile-menu-btn");

function openMobileMenu() {
  const appView = $("app-view");

  if (!appView || !mobileMenuButton) return;

  appView.classList.add("mobile-menu-open");
  mobileMenuButton.setAttribute("aria-expanded", "true");

  document.body.classList.add("mobile-drawer-open");
}

function closeMobileMenu() {
  const appView = $("app-view");

  if (!appView || !mobileMenuButton) return;

  appView.classList.remove("mobile-menu-open");
  mobileMenuButton.setAttribute("aria-expanded", "false");

  document.body.classList.remove("mobile-drawer-open");
}

if (mobileMenuButton) {
  mobileMenuButton.addEventListener("click", () => {
    const appView = $("app-view");

    if (appView.classList.contains("mobile-menu-open")) {
      closeMobileMenu();
    } else {
      openMobileMenu();
    }
  });
}

/* Close drawer when tapping outside it */
document.addEventListener("click", (event) => {
  const appView = $("app-view");
  const sidebar = document.querySelector(".sidebar");

  if (!appView || !sidebar) return;
  if (!appView.classList.contains("mobile-menu-open")) return;

  if (
    !sidebar.contains(event.target) &&
    !mobileMenuButton.contains(event.target)
  ) {
    closeMobileMenu();
  }
});

/* Close drawer after selecting a conversation */
document.addEventListener("click", (event) => {
  if (event.target.closest(".conversation-item")) {
    closeMobileMenu();
  }
});

/* Close drawer after New Chat */
$("new-chat")?.addEventListener("click", () => {
  closeMobileMenu();
});
boot();
