/* TaskHub frontend — vanilla JS, no build step. */

const state = {
  meta: null,
  projects: [],
  projectId: null,
  tasks: [],
  view: localStorage.getItem("th.view") || "board",
  showEpics: localStorage.getItem("th.showEpics") !== "false",
  search: "",
  selected: null,
  descTab: "edit",
  draftPrompts: [],
  savedPrompts: [],
};

/* ----------------------------- helpers ----------------------------- */
const $ = (sel) => document.querySelector(sel);
const esc = (s) =>
  String(s == null ? "" : s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

function api(method, url, body) {
  return fetch(url, {
    method,
    headers: body ? { "Content-Type": "application/json" } : {},
    body: body ? JSON.stringify(body) : undefined,
  }).then(async (r) => {
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(data.error || r.statusText);
    return data;
  });
}

function toast(msg, isErr) {
  let t = $(".toast");
  if (!t) {
    t = document.createElement("div");
    t.className = "toast";
    document.body.appendChild(t);
  }
  t.textContent = msg;
  t.className = "toast show" + (isErr ? " err" : "");
  clearTimeout(toast._t);
  toast._t = setTimeout(() => (t.className = "toast"), 2200);
}

const statusLabel = (s) => (state.meta.statusLabels[s] || s);
const statusColor = (s) => `var(--s-${s})`;
const typeOf = (id) => state.tasks.find((t) => t.id === id);
const childrenOf = (id) => state.tasks.filter((t) => (t.parent || null) === id);
function descendantsOf(id) {
  const out = [];
  const stack = [...childrenOf(id)];
  while (stack.length) {
    const t = stack.pop();
    out.push(t);
    stack.push(...childrenOf(t.id));
  }
  return out;
}

/* ----------------------------- data load ----------------------------- */
async function init() {
  state.meta = await api("GET", "/api/meta");
  await loadProjects();
  bindTopbar();
  render();
}

async function loadProjects() {
  state.projects = await api("GET", "/api/projects");
  const saved = localStorage.getItem("th.project");
  if (state.projects.length) {
    state.projectId =
      (state.projects.find((p) => p.id === saved) || state.projects[0]).id;
    await loadTasks();
  } else {
    state.projectId = null;
    state.tasks = [];
  }
}

async function loadTasks() {
  if (!state.projectId) return (state.tasks = []);
  state.tasks = await api("GET", `/api/projects/${state.projectId}/tasks`);
  localStorage.setItem("th.project", state.projectId);
}

/* ----------------------------- topbar ----------------------------- */
function bindTopbar() {
  $("#newProjectBtn").onclick = openProjectModal;
  $("#deleteProjectBtn").onclick = deleteProjectModal;
  $("#newEpicBtn").onclick = () => openTaskForm({ type: "epic", parent: null });
  $("#newTaskBtn").onclick = () => openTaskForm({ type: "task", parent: null });
  $("#projectSelect").onchange = async (e) => {
    state.projectId = e.target.value;
    await loadTasks();
    render();
  };
  $("#epicToggleInput").onchange = (e) => {
    state.showEpics = e.target.checked;
    localStorage.setItem("th.showEpics", state.showEpics);
    renderMain();
  };
  $("#viewToggle").onclick = (e) => {
    const b = e.target.closest("button[data-view]");
    if (!b) return;
    state.view = b.dataset.view;
    localStorage.setItem("th.view", state.view);
    render();
  };
  $("#search").oninput = (e) => {
    state.search = e.target.value.trim().toLowerCase();
    renderMain();
  };
}

function renderTopbar() {
  const sel = $("#projectSelect");
  sel.innerHTML = state.projects
    .map(
      (p) =>
        `<option value="${esc(p.id)}" ${p.id === state.projectId ? "selected" : ""}>${esc(p.name)} (${p.taskCount})</option>`
    )
    .join("");
  if (!state.projects.length) sel.innerHTML = `<option>No projects yet</option>`;
  document
    .querySelectorAll("#viewToggle button")
    .forEach((b) => b.classList.toggle("active", b.dataset.view === state.view));
  $("#newEpicBtn").disabled = !state.projectId;
  $("#newTaskBtn").disabled = !state.projectId;
  $("#epicToggleInput").checked = state.showEpics;
  $("#epicToggle").style.display = state.view === "board" ? "" : "none";
  $("#deleteProjectBtn").disabled = !state.projectId;
}

/* ----------------------------- render ----------------------------- */
function render() {
  renderTopbar();
  renderMain();
}

function matchesSearch(t) {
  if (!state.search) return true;
  return (
    (t.id || "").toLowerCase().includes(state.search) ||
    (t.title || "").toLowerCase().includes(state.search) ||
    (t.description || "").toLowerCase().includes(state.search) ||
    (t.prompts || []).join(" ").toLowerCase().includes(state.search)
  );
}

function renderMain() {
  const main = $("#main");
  if (!state.projectId) {
    main.innerHTML = `<div class="empty"><div>
      <h2>Welcome to TaskHub</h2>
      <p>Create a project to start tracking epics, tasks, and subtasks.</p>
      <button class="btn primary" onclick="openProjectModal()">+ New project</button>
    </div></div>`;
    return;
  }
  if (!state.tasks.length) {
    main.innerHTML = `<div class="empty"><div>
      <h2>No tasks yet</h2>
      <p>Start by creating a high-level epic, then break it into tasks and subtasks.</p>
      <button class="btn primary" onclick="openTaskForm({type:'epic',parent:null})">+ New epic</button>
    </div></div>`;
    return;
  }
  main.innerHTML = state.view === "board" ? boardHTML() : treeHTML();
  if (state.view === "board") wireBoard();
  else wireTree();
}

/* ----------------------------- board view ----------------------------- */
function boardHTML() {
  const cols = state.meta.statuses
    .map((s) => {
      const items = state.tasks.filter(
        (t) =>
          t.status === s &&
          matchesSearch(t) &&
          (state.showEpics || t.type !== "epic")
      );
      return `<section class="column" data-status="${s}">
        <div class="column-head">
          <span class="dot" style="background:${statusColor(s)}"></span>
          ${esc(statusLabel(s))}
          <span class="count">${items.length}</span>
        </div>
        <div class="column-body">${items.map(cardHTML).join("")}</div>
      </section>`;
    })
    .join("");
  return `<div class="board">${cols}</div>`;
}

function cardHTML(t) {
  const parent = t.parent ? typeOf(t.parent) : null;
  const r = t.rollup;
  const pct = r && r.total ? Math.round((r.done / r.total) * 100) : 0;
  const labels = (t.labels || [])
    .slice(0, 3)
    .map((l) => `<span class="label-chip">${esc(l)}</span>`)
    .join("");
  return `<article class="card" draggable="true" data-id="${esc(t.id)}"
      style="border-left-color:${statusColor(t.status)}">
    <div class="card-top">
      <span class="badge type-${t.type}">${t.type}</span>
      <span class="card-id">${esc(t.id)}</span>
    </div>
    <div class="card-title">${esc(t.title)}</div>
    ${parent ? `<div class="card-parent">↳ ${esc(parent.id)} · ${esc(parent.title)}</div>` : ""}
    <div class="card-meta">
      <span class="badge prio" data-p="${t.priority}">${esc(t.priority)}</span>
      ${t.assignee ? `<span class="card-parent">@${esc(t.assignee)}</span>` : ""}
      ${labels}
    </div>
    ${
      r
        ? `<div class="card-meta"><div class="rollup">
            <span>${r.done}/${r.total}</span>
            <span class="bar"><i style="width:${pct}%"></i></span>
          </div></div>`
        : ""
    }
  </article>`;
}

function wireBoard() {
  let dragId = null;
  document.querySelectorAll(".card").forEach((el) => {
    el.addEventListener("click", () => openDrawer(el.dataset.id));
    el.addEventListener("dragstart", (e) => {
      dragId = el.dataset.id;
      el.classList.add("dragging");
      e.dataTransfer.effectAllowed = "move";
    });
    el.addEventListener("dragend", () => el.classList.remove("dragging"));
  });
  document.querySelectorAll(".column").forEach((col) => {
    col.addEventListener("dragover", (e) => {
      e.preventDefault();
      col.classList.add("drop-target");
    });
    col.addEventListener("dragleave", () => col.classList.remove("drop-target"));
    col.addEventListener("drop", async (e) => {
      e.preventDefault();
      col.classList.remove("drop-target");
      const status = col.dataset.status;
      const t = typeOf(dragId);
      if (!t || t.status === status) return;
      await changeField(dragId, { status });
    });
  });
}

/* ----------------------------- tree view ----------------------------- */
const collapsed = new Set(JSON.parse(localStorage.getItem("th.collapsed") || "[]"));
function saveCollapsed() {
  localStorage.setItem("th.collapsed", JSON.stringify([...collapsed]));
}

function treeHTML() {
  const roots = state.tasks
    .filter((t) => !t.parent)
    .sort((a, b) => idNum(a.id) - idNum(b.id));
  return `<div class="tree"><div class="tree-inner">${roots
    .map((r) => tnodeHTML(r))
    .join("")}</div></div>`;
}

function tnodeHTML(t) {
  const kids = childrenOf(t.id).sort((a, b) => idNum(a.id) - idNum(b.id));
  const open = !collapsed.has(t.id);
  const hit = matchesSearch(t) || descendantsOf(t.id).some(matchesSearch);
  if (!hit) return "";
  const r = t.rollup;
  return `<div class="tnode">
    <div class="trow" data-id="${esc(t.id)}">
      <span class="tcaret ${kids.length ? "" : "leaf"}" data-caret="${esc(t.id)}">${open ? "▾" : "▸"}</span>
      <span class="badge type-${t.type}">${t.type}</span>
      <span class="card-id">${esc(t.id)}</span>
      <span class="ttitle">${esc(t.title)}</span>
      <span class="tmeta">
        ${r ? `<span class="card-parent">${r.done}/${r.total}</span>` : ""}
        <span class="status-pill" style="background:${statusColor(t.status)}">${esc(statusLabel(t.status))}</span>
        <span class="tadd" data-add="${esc(t.id)}" title="Add ${t.type === "epic" ? "task" : "subtask"}">+ add</span>
      </span>
    </div>
    ${
      kids.length && open
        ? `<div class="tchildren">${kids.map(tnodeHTML).join("")}</div>`
        : ""
    }
  </div>`;
}

function wireTree() {
  document.querySelectorAll(".tcaret[data-caret]").forEach((el) => {
    el.addEventListener("click", (e) => {
      e.stopPropagation();
      const id = el.dataset.caret;
      if (collapsed.has(id)) collapsed.delete(id);
      else collapsed.add(id);
      saveCollapsed();
      renderMain();
    });
  });
  document.querySelectorAll(".tadd[data-add]").forEach((el) => {
    el.addEventListener("click", (e) => {
      e.stopPropagation();
      const parent = typeOf(el.dataset.add);
      openTaskForm({
        parent: parent.id,
        type: parent.type === "epic" ? "task" : "subtask",
      });
    });
  });
  document.querySelectorAll(".trow[data-id]").forEach((el) => {
    el.addEventListener("click", () => openDrawer(el.dataset.id));
  });
}

const idNum = (id) => {
  const m = /(\d+)$/.exec(id || "");
  return m ? parseInt(m[1], 10) : 0;
};

/* ----------------------------- drawer (detail/edit) ----------------------------- */
function openDrawer(id) {
  const t = typeOf(id);
  if (!t) return;
  state.selected = id;
  state.descTab = "edit";
  renderDrawer(t);
  $("#drawer").classList.add("open");
  $("#drawer").setAttribute("aria-hidden", "false");
  $("#overlay").classList.remove("hidden");
  $("#overlay").onclick = closeDrawer;
}
function closeDrawer() {
  state.selected = null;
  $("#drawer").classList.remove("open");
  $("#drawer").setAttribute("aria-hidden", "true");
  $("#overlay").classList.add("hidden");
}

function renderDrawer(t) {
  state.draftPrompts = (t.prompts || []).slice();
  state.savedPrompts = (t.prompts || []).slice();
  const parent = t.parent ? typeOf(t.parent) : null;
  const kids = childrenOf(t.id).sort((a, b) => idNum(a.id) - idNum(b.id));
  const statusOpts = state.meta.statuses
    .map((s) => `<option value="${s}" ${s === t.status ? "selected" : ""}>${esc(statusLabel(s))}</option>`)
    .join("");
  const typeOpts = state.meta.types
    .map((x) => `<option value="${x}" ${x === t.type ? "selected" : ""}>${x}</option>`)
    .join("");
  const prioOpts = state.meta.priorities
    .map((x) => `<option value="${x}" ${x === t.priority ? "selected" : ""}>${x}</option>`)
    .join("");
  // valid parents: any task except self and its descendants
  const banned = new Set([t.id, ...descendantsOf(t.id).map((d) => d.id)]);
  const parentOpts =
    `<option value="">— none (top level) —</option>` +
    state.tasks
      .filter((o) => !banned.has(o.id))
      .map((o) => `<option value="${esc(o.id)}" ${o.id === t.parent ? "selected" : ""}>${esc(o.id)} · ${esc(o.title)}</option>`)
      .join("");

  const childLabel = t.type === "epic" ? "task" : "subtask";

  $("#drawer").innerHTML = `
    <div class="drawer-head">
      <span class="badge type-${t.type}">${t.type}</span>
      <span class="card-id">${esc(t.id)}</span>
      <button class="x" title="Close" onclick="closeDrawer()">×</button>
    </div>
    <div class="drawer-body">
      ${
        parent
          ? `<div class="crumb">Parent: <a onclick="openDrawer('${esc(parent.id)}')">${esc(parent.id)} · ${esc(parent.title)}</a></div>`
          : ""
      }
      <div class="field title-field">
        <label>Title</label>
        <input id="f-title" type="text" value="${esc(t.title)}" />
      </div>
      <div class="row2">
        <div class="field"><label>Status</label><select id="f-status">${statusOpts}</select></div>
        <div class="field"><label>Type</label><select id="f-type">${typeOpts}</select></div>
      </div>
      <div class="row2">
        <div class="field"><label>Priority</label><select id="f-priority">${prioOpts}</select></div>
        <div class="field"><label>Assignee</label><input id="f-assignee" type="text" value="${esc(t.assignee || "")}" /></div>
      </div>
      <div class="field"><label>Parent</label><select id="f-parent">${parentOpts}</select></div>
      <div class="field"><label>Labels (comma separated)</label><input id="f-labels" type="text" value="${esc((t.labels || []).join(", "))}" /></div>

      <div class="field">
        <label>Description (markdown — read by Claude Code)</label>
        <div class="desc-tabs">
          <button data-tab="edit" class="${state.descTab === "edit" ? "active" : ""}">Edit</button>
          <button data-tab="preview" class="${state.descTab === "preview" ? "active" : ""}">Preview</button>
        </div>
        <textarea id="f-desc" style="${state.descTab === "edit" ? "" : "display:none"}">${esc(t.description || "")}</textarea>
        <div class="md-preview" id="f-preview" style="${state.descTab === "preview" ? "" : "display:none"}">${renderMarkdown(t.description || "")}</div>
      </div>

      <div class="field">
        <label>Subtasks (${kids.length})</label>
        <div class="subtask-list">
          ${
            kids
              .map(
                (k) => `<div class="subtask-row" onclick="openDrawer('${esc(k.id)}')">
                  <span class="status-pill" style="background:${statusColor(k.status)}">${esc(statusLabel(k.status))}</span>
                  <span class="card-id">${esc(k.id)}</span>
                  <span class="st-title">${esc(k.title)}</span>
                </div>`
              )
              .join("") || `<div class="card-parent">No subtasks yet.</div>`
          }
        </div>
        <div style="margin-top:8px"><button class="btn small" onclick="openTaskForm({parent:'${esc(t.id)}',type:'${childLabel}'})">+ Add ${childLabel}</button></div>
      </div>

      <div class="field">
        <div class="field-head">
          <label>Prompts (for AI to process this task later)</label>
          <button type="button" class="copy-btn" id="addPromptBtn"><span class="copy-ico">+</span> Add prompt</button>
        </div>
        <div id="promptsList" class="prompts-list"></div>
      </div>

      <div class="meta-line"><span>Created ${esc(t.created || "—")}</span><span>Updated ${esc(t.updated || "—")}</span></div>
    </div>
    <div class="drawer-foot">
      <button class="btn primary" id="saveBtn">Save changes</button>
      <div class="spacer" style="flex:1"></div>
      <button class="btn danger" id="delBtn">Delete</button>
    </div>`;

  // wire description tabs
  document.querySelectorAll(".desc-tabs button").forEach((b) => {
    b.onclick = () => {
      state.descTab = b.dataset.tab;
      $("#f-preview").innerHTML = renderMarkdown($("#f-desc").value);
      $("#f-desc").style.display = state.descTab === "edit" ? "" : "none";
      $("#f-preview").style.display = state.descTab === "preview" ? "" : "none";
      document
        .querySelectorAll(".desc-tabs button")
        .forEach((x) => x.classList.toggle("active", x.dataset.tab === state.descTab));
    };
  });

  renderPromptsList();
  $("#addPromptBtn").onclick = () => {
    syncPrompts();
    state.draftPrompts.push("");
    renderPromptsList();
    const inputs = $("#promptsList").querySelectorAll(".prompt-input");
    if (inputs.length) inputs[inputs.length - 1].focus();
  };

  $("#saveBtn").onclick = () => saveDrawer(t.id);
  $("#delBtn").onclick = () => deleteTask(t.id);
}

function renderPromptsList() {
  const wrap = $("#promptsList");
  if (!wrap) return;
  if (!state.draftPrompts.length) {
    wrap.innerHTML = `<div class="prompts-empty">No prompts yet. Click “+ Add prompt” to create one.</div>`;
    return;
  }
  wrap.innerHTML = state.draftPrompts
    .map(
      (p, i) => `<div class="prompt-item" data-idx="${i}">
        <div class="field-head">
          <label>Prompt ${i + 1}</label>
          <span class="prompt-actions">
            <button type="button" class="copy-btn" data-copy="${i}"><span class="copy-ico">⧉</span> Copy</button>
            <button type="button" class="copy-btn del" data-del="${i}">Delete</button>
          </span>
        </div>
        <textarea class="prompt-area prompt-input" data-idx="${i}" placeholder="Write instructions for an agent to act on…">${esc(p)}</textarea>
        <div class="prompt-save-row" style="display:none">
          <button type="button" class="btn primary prompt-save-btn" data-save="${i}">Save prompt</button>
        </div>
      </div>`
    )
    .join("");
  wrap.querySelectorAll("[data-copy]").forEach((b) => {
    b.onclick = () => {
      const ta = wrap.querySelector(`textarea[data-idx="${b.dataset.copy}"]`);
      copyPromptButton(b, ta.value);
    };
  });
  wrap.querySelectorAll("[data-del]").forEach((b) => {
    b.onclick = async () => {
      const i = Number(b.dataset.del);
      const preview = (state.draftPrompts[i] || "").trim();
      const snippet = preview ? `\n\n"${preview.slice(0, 80)}${preview.length > 80 ? "…" : ""}"` : "";
      if (!confirm(`Delete prompt ${i + 1}? This cannot be undone.${snippet}`)) return;
      syncPrompts();
      state.draftPrompts.splice(i, 1);
      const id = state.selected;
      const prompts = state.draftPrompts.map((s) => s.trim()).filter(Boolean);
      try {
        await api("PATCH", `/api/projects/${state.projectId}/tasks/${id}`, { prompts });
        await loadTasks();
        const cur = typeOf(id);
        state.draftPrompts = ((cur && cur.prompts) || prompts).slice();
        state.savedPrompts = state.draftPrompts.slice();
        renderPromptsList();
        toast("Prompt deleted");
      } catch (e) {
        toast(e.message, true);
      }
    };
  });
  wrap.querySelectorAll("[data-save]").forEach((b) => {
    b.onclick = () => savePromptButton(b);
  });
  // Save row only appears while a prompt is being edited (focused) or has
  // unsaved changes; mousedown keeps it alive long enough for the click.
  wrap.querySelectorAll(".prompt-item").forEach((item) => {
    const idx = Number(item.dataset.idx);
    const ta = item.querySelector(".prompt-input");
    const row = item.querySelector(".prompt-save-row");
    const toggle = (focused) => setPromptSaveVisible(item, idx, focused);
    ta.addEventListener("input", () => {
      toggle(document.activeElement === ta);
      autosize(ta);
    });
    ta.addEventListener("focus", () => {
      ta.classList.add("editing");
      toggle(true);
      autosize(ta);
    });
    ta.addEventListener("blur", () => {
      ta.classList.remove("editing");
      toggle(false);
      autosize(ta);
    });
    row.addEventListener("mousedown", (e) => e.preventDefault());
    toggle(false);
    autosize(ta);
  });
}

function autosize(ta) {
  ta.style.height = "auto";
  ta.style.height = ta.scrollHeight + "px";
}

function setPromptSaveVisible(item, idx, focused) {
  const ta = item.querySelector(".prompt-input");
  const row = item.querySelector(".prompt-save-row");
  if (!ta || !row) return;
  const baseline = (state.savedPrompts || [])[idx];
  const dirty = ta.value !== (baseline == null ? "" : baseline);
  row.style.display = focused || dirty ? "" : "none";
}

function syncPrompts() {
  const wrap = $("#promptsList");
  if (!wrap) return;
  state.draftPrompts = [...wrap.querySelectorAll(".prompt-input")].map((t) => t.value);
}

async function copyPromptButton(btn, text) {
  const val = (text || "").trim();
  if (!val) return toast("Prompt is empty", true);
  try {
    await copyText(val);
    const old = btn.innerHTML;
    btn.classList.add("copied");
    btn.innerHTML = '<span class="copy-ico">✓</span> Copied';
    toast("Prompt copied to clipboard");
    setTimeout(() => {
      btn.classList.remove("copied");
      btn.innerHTML = old;
    }, 1500);
  } catch (e) {
    toast("Copy failed", true);
  }
}

function copyText(text) {
  if (navigator.clipboard && navigator.clipboard.writeText) {
    // Fall back to the legacy path if the async API is denied (e.g. no focus).
    return navigator.clipboard.writeText(text).catch(() => legacyCopy(text));
  }
  return legacyCopy(text);
}

function legacyCopy(text) {
  return new Promise((resolve, reject) => {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    try {
      document.execCommand("copy") ? resolve() : reject(new Error("copy rejected"));
    } catch (e) {
      reject(e);
    } finally {
      document.body.removeChild(ta);
    }
  });
}

async function saveDrawer(id) {
  const labels = $("#f-labels").value
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  syncPrompts();
  const prompts = state.draftPrompts.map((s) => s.trim()).filter(Boolean);
  const patch = {
    title: $("#f-title").value.trim(),
    status: $("#f-status").value,
    type: $("#f-type").value,
    priority: $("#f-priority").value,
    assignee: $("#f-assignee").value.trim() || null,
    parent: $("#f-parent").value || null,
    labels,
    description: $("#f-desc").value,
    prompts,
  };
  try {
    await api("PATCH", `/api/projects/${state.projectId}/tasks/${id}`, patch);
    await loadTasks();
    toast("Saved " + id);
    const cur = typeOf(id);
    if (cur) renderDrawer(cur);
    renderTopbar();
    renderMain();
  } catch (e) {
    toast(e.message, true);
  }
}

async function savePromptButton(btn) {
  const id = state.selected;
  if (!id) return;
  syncPrompts();
  const prompts = state.draftPrompts.map((s) => s.trim()).filter(Boolean);
  try {
    await api("PATCH", `/api/projects/${state.projectId}/tasks/${id}`, { prompts });
    await loadTasks();
    const cur = typeOf(id);
    state.draftPrompts = ((cur && cur.prompts) || prompts).slice();
    state.savedPrompts = state.draftPrompts.slice();
    renderPromptsList();
    toast("Prompt saved");
  } catch (e) {
    toast(e.message, true);
  }
}

async function changeField(id, patch) {
  try {
    await api("PATCH", `/api/projects/${state.projectId}/tasks/${id}`, patch);
    await loadTasks();
    renderMain();
    if (state.selected === id) renderDrawer(typeOf(id));
  } catch (e) {
    toast(e.message, true);
  }
}

async function deleteTask(id) {
  const kids = descendantsOf(id);
  const msg = kids.length
    ? `Delete ${id} and its ${kids.length} subtask(s)? This cannot be undone.`
    : `Delete ${id}? This cannot be undone.`;
  if (!confirm(msg)) return;
  try {
    await api("DELETE", `/api/projects/${state.projectId}/tasks/${id}`);
    await loadTasks();
    closeDrawer();
    render();
    toast("Deleted " + id);
  } catch (e) {
    toast(e.message, true);
  }
}

/* ----------------------------- create task modal ----------------------------- */
function openTaskForm({ parent = null, type = "task" } = {}) {
  if (!state.projectId) return;
  const statusOpts = state.meta.statuses
    .map((s) => `<option value="${s}" ${s === "backlog" ? "selected" : ""}>${esc(statusLabel(s))}</option>`)
    .join("");
  const typeOpts = state.meta.types
    .map((x) => `<option value="${x}" ${x === type ? "selected" : ""}>${x}</option>`)
    .join("");
  const prioOpts = state.meta.priorities
    .map((x) => `<option value="${x}" ${x === "medium" ? "selected" : ""}>${x}</option>`)
    .join("");
  const parentOpts =
    `<option value="">— none (top level) —</option>` +
    state.tasks
      .slice()
      .sort((a, b) => idNum(a.id) - idNum(b.id))
      .map((o) => `<option value="${esc(o.id)}" ${o.id === parent ? "selected" : ""}>${esc(o.id)} · ${esc(o.title)}</option>`)
      .join("");
  modal(
    `New ${type}`,
    `
      <div class="field title-field"><label>Title</label><input id="m-title" type="text" placeholder="What needs doing?" /></div>
      <div class="row2">
        <div class="field"><label>Type</label><select id="m-type">${typeOpts}</select></div>
        <div class="field"><label>Status</label><select id="m-status">${statusOpts}</select></div>
      </div>
      <div class="row2">
        <div class="field"><label>Priority</label><select id="m-priority">${prioOpts}</select></div>
        <div class="field"><label>Parent (optional)</label><select id="m-parent">${parentOpts}</select></div>
      </div>
      <div class="field"><label>Description (optional)</label><textarea id="m-desc" style="min-height:110px" placeholder="Leave blank for a starter template"></textarea></div>
      <div class="field"><label>Prompt (optional — for AI to process later)</label><textarea id="m-prompt" class="prompt-area" style="min-height:90px" placeholder="Instructions for an agent to complete this task…"></textarea></div>
    `,
    async () => {
      const title = $("#m-title").value.trim();
      if (!title) {
        toast("Title is required", true);
        return false;
      }
      const chosenParent = $("#m-parent").value || null;
      try {
        const t = await api("POST", `/api/projects/${state.projectId}/tasks`, {
          title,
          type: $("#m-type").value,
          status: $("#m-status").value,
          priority: $("#m-priority").value,
          parent: chosenParent,
          description: $("#m-desc").value,
          prompts: $("#m-prompt").value.trim() ? [$("#m-prompt").value] : [],
        });
        await loadTasks();
        render();
        if (chosenParent && collapsed.has(chosenParent)) {
          collapsed.delete(chosenParent);
          saveCollapsed();
        }
        toast("Created " + t.id);
        openDrawer(t.id);
        return true;
      } catch (e) {
        toast(e.message, true);
        return false;
      }
    }
  );
  setTimeout(() => $("#m-title") && $("#m-title").focus(), 30);
}

/* ----------------------------- create project modal ----------------------------- */
function openProjectModal() {
  modal(
    "New project",
    `
      <div class="field title-field"><label>Name</label><input id="p-name" type="text" placeholder="e.g. Personal Astrology App" /></div>
      <div class="field"><label>ID prefix (optional)</label><input id="p-prefix" type="text" placeholder="auto from name, e.g. ASTRO" /></div>
      <div class="field"><label>Description (optional)</label><textarea id="p-desc" style="min-height:90px"></textarea></div>
    `,
    async () => {
      const name = $("#p-name").value.trim();
      if (!name) {
        toast("Name is required", true);
        return false;
      }
      try {
        const p = await api("POST", "/api/projects", {
          name,
          prefix: $("#p-prefix").value.trim() || undefined,
          description: $("#p-desc").value,
        });
        state.projectId = p.id;
        await loadProjects();
        state.projectId = p.id;
        await loadTasks();
        render();
        toast("Created project " + p.name);
        return true;
      } catch (e) {
        toast(e.message, true);
        return false;
      }
    }
  );
  setTimeout(() => $("#p-name") && $("#p-name").focus(), 30);
}

/* ----------------------------- delete project ----------------------------- */
function deleteProjectModal() {
  const p = state.projects.find((x) => x.id === state.projectId);
  if (!p) return;
  const count = typeof p.taskCount === "number" ? p.taskCount : state.tasks.length;
  const root = $("#modalRoot");
  root.innerHTML = `<div class="modal-back">
    <div class="modal">
      <h3>Delete project?</h3>
      <div class="modal-body">
        <p class="warn-text">⚠ This permanently deletes the project and everything in it. It cannot be undone.</p>
        <p>Deleting <strong>${esc(p.name)}</strong> will remove the project <strong>and all ${count} task${count === 1 ? "" : "s"}</strong> (epics, tasks and subtasks). Every markdown file under <code>data/${esc(p.id)}/</code> will be deleted.</p>
        <div class="field">
          <label>Type the project name <strong>${esc(p.name)}</strong> to confirm</label>
          <input id="confirmName" type="text" autocomplete="off" placeholder="${esc(p.name)}" />
        </div>
      </div>
      <div class="modal-foot">
        <button class="btn" id="delCancel">Cancel</button>
        <button class="btn danger" id="delConfirm" disabled>Delete project</button>
      </div>
    </div></div>`;
  const close = () => (root.innerHTML = "");
  const input = $("#confirmName");
  const btn = $("#delConfirm");
  $("#delCancel").onclick = close;
  root.querySelector(".modal-back").onclick = (e) => {
    if (e.target.classList.contains("modal-back")) close();
  };
  input.oninput = () => {
    btn.disabled = input.value.trim() !== p.name;
  };
  btn.onclick = async () => {
    if (input.value.trim() !== p.name) return;
    try {
      await api("DELETE", `/api/projects/${p.id}`);
      close();
      closeDrawer();
      localStorage.removeItem("th.project");
      toast("Deleted project " + p.name);
      await loadProjects();
      render();
    } catch (e) {
      toast(e.message, true);
    }
  };
  setTimeout(() => input && input.focus(), 30);
}

/* ----------------------------- modal primitive ----------------------------- */
function modal(title, bodyHTML, onSave) {
  const root = $("#modalRoot");
  root.innerHTML = `<div class="modal-back">
    <div class="modal">
      <h3>${esc(title)}</h3>
      <div class="modal-body">${bodyHTML}</div>
      <div class="modal-foot">
        <button class="btn" id="modalCancel">Cancel</button>
        <button class="btn primary" id="modalSave">Create</button>
      </div>
    </div></div>`;
  const close = () => (root.innerHTML = "");
  $("#modalCancel").onclick = close;
  root.querySelector(".modal-back").onclick = (e) => {
    if (e.target.classList.contains("modal-back")) close();
  };
  $("#modalSave").onclick = async () => {
    const ok = await onSave();
    if (ok !== false) close();
  };
}

/* ----------------------------- tiny markdown renderer ----------------------------- */
function renderMarkdown(src) {
  const lines = String(src || "").split("\n");
  let html = "";
  let inList = false;
  const inline = (s) =>
    esc(s)
      .replace(/`([^`]+)`/g, "<code>$1</code>")
      .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
      .replace(/(^|[^*])\*([^*]+)\*/g, "$1<em>$2</em>");
  const closeList = () => {
    if (inList) {
      html += "</ul>";
      inList = false;
    }
  };
  for (const raw of lines) {
    const line = raw.replace(/\s+$/, "");
    let m;
    if ((m = /^### (.*)/.exec(line))) {
      closeList();
      html += `<h3>${inline(m[1])}</h3>`;
    } else if ((m = /^## (.*)/.exec(line))) {
      closeList();
      html += `<h2>${inline(m[1])}</h2>`;
    } else if ((m = /^# (.*)/.exec(line))) {
      closeList();
      html += `<h2>${inline(m[1])}</h2>`;
    } else if ((m = /^\s*- \[([ xX])\] (.*)/.exec(line))) {
      if (!inList) {
        html += "<ul>";
        inList = true;
      }
      const checked = m[1].toLowerCase() === "x";
      html += `<li class="chk"><input type="checkbox" disabled ${checked ? "checked" : ""}/> ${inline(m[2])}</li>`;
    } else if ((m = /^\s*[-*] (.*)/.exec(line))) {
      if (!inList) {
        html += "<ul>";
        inList = true;
      }
      html += `<li>${inline(m[1])}</li>`;
    } else if (line.trim() === "") {
      closeList();
    } else {
      closeList();
      html += `<p>${inline(line)}</p>`;
    }
  }
  closeList();
  return html || '<p class="card-parent">Nothing here yet.</p>';
}

// expose handlers used in inline onclick
window.openDrawer = openDrawer;
window.closeDrawer = closeDrawer;
window.openTaskForm = openTaskForm;
window.openProjectModal = openProjectModal;

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    if ($("#modalRoot").innerHTML) $("#modalRoot").innerHTML = "";
    else if (state.selected) closeDrawer();
  }
});

init().catch((e) => {
  document.body.innerHTML = `<div class="empty"><div><h2>Could not start</h2><p>${esc(e.message)}</p></div></div>`;
});
