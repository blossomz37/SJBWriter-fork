let fileCache = {}; // { "section/filename": content }

// =====================
// APPEARANCE: MODE (light / dark / system) × ACCENT
// =====================

const ACCENTS = ["blue", "indigo", "teal", "crimson", "amber", "violet"];

// Old single-theme names map onto mode + accent
const LEGACY_THEMES = {
  "light": ["light", "blue"],
  "dark": ["dark", "blue"],
  "crimson": ["dark", "crimson"],
  "dark-stellar": ["dark", "blue"],
  "light-stellar": ["light", "blue"]
};

const systemDark = window.matchMedia("(prefers-color-scheme: dark)");

function applyAppearance(mode, accent) {
  const dark = mode === "dark" || (mode === "system" && systemDark.matches);
  document.body.classList.toggle("mode-dark", dark);
  ACCENTS.forEach(a => {
    document.body.classList.toggle(`accent-${a}`, a === accent);
  });
  document.body.dataset.mode = mode;
  document.body.dataset.accent = accent;
  updateModeToggle();
}

// Top bar sun/moon: shows the mode a click switches to
function updateModeToggle() {
  const btn = document.getElementById("modeToggle");
  if (!btn) return;
  const dark = document.body.classList.contains("mode-dark");
  const label = dark ? "Light mode" : "Dark mode";
  btn.innerHTML = iconSvg(dark ? "sun" : "moon");
  btn.dataset.tip = label;
  btn.setAttribute("aria-label", `Switch to ${label.toLowerCase()}`);
}

// Quick switch keeps the accent; "Match system" stays a Settings choice
async function toggleLightDark() {
  const themeMode = document.body.classList.contains("mode-dark") ? "light" : "dark";
  const { accent } = savedAppearance();
  applyAppearance(themeMode, accent);

  state.app_state.themeMode = themeMode;
  state.app_state.accent = accent;
  await fetch('/save_app_state', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ themeMode, accent })
  });
}

function savedAppearance() {
  const appState = state.app_state || {};
  const legacy = LEGACY_THEMES[appState.theme] || ["light", "blue"];
  return {
    mode: appState.themeMode || legacy[0],
    accent: ACCENTS.includes(appState.accent) ? appState.accent : legacy[1]
  };
}

// Still accepts the old theme names
function setTheme(theme) {
  const [mode, accent] = LEGACY_THEMES[theme] || [theme, "blue"];
  applyAppearance(mode, accent);
}

// In "Match system" mode, follow the OS as it switches
systemDark.addEventListener("change", () => {
  if (document.body.dataset.mode === "system") {
    applyAppearance("system", document.body.dataset.accent);
  }
});

function pickAccent(accent) {
  document.querySelectorAll(".accent-swatch").forEach(swatch => {
    swatch.setAttribute("aria-checked", String(swatch.dataset.accent === accent));
  });
  previewAppearance();
}

// Settings > Visual: show choices live; Back/Cancel restores the saved look
function previewAppearance() {
  const mode = document.getElementById("themeModeSelect").value;
  const accent =
    document.querySelector('.accent-swatch[aria-checked="true"]')?.dataset.accent || "blue";
  applyAppearance(mode, accent);
}

function loadTheme() {
  const { mode, accent } = savedAppearance();
  applyAppearance(mode, accent);
  const savedSize =
    state.app_state.sidebarFontSize || "13px";
  applySidebarFontSize(savedSize);
}

function applySidebarFontSize(size) {
  document.documentElement.style.setProperty('--sidebar-font-size', size);
}


const editor = document.getElementById("editor");
const promptBox = document.getElementById("promptBox");


const titleInput = document.getElementById("titleInput");

let currentFile = {
  section: null,
  filename: null
};

let draggedRow = null;

let draggedModelId = null;

let selectedModelId = null;

let activeModelLabelFilters = [];

let modelSearchQuery = "";

let generationUndoStack = [];
const MAX_UNDO = 10;

let isGenerating = false;
let generationCursorPos = null;
let followGeneration = true;

let wakeLock = null;

let currentAbortController = null;

let savedModelName = "";
let savedModelSource = "";


function shouldShowCounts(sectionName) {

  const settings = state.app_state || {};

  switch (sectionName) {

    case "writing":
      return settings.showWritingCounts ?? true;

    case "background":
      return settings.showBackgroundCounts ?? true;

    case "prompts":
      return settings.showPromptCounts ?? false;

    case "system":
      return settings.showSystemCounts ?? false;

    default:
      return false;
  }
}

function shouldShowFolderTotals() {
  return state.app_state?.showFolderTotals ?? true;
}


function getFolderWordCount(items) {
  let total = 0;

  for (const item of items || []) {

    if (item.type === "file") {

      if (item.wordCount == null) {
        return null;
      }

      total += item.wordCount;
    }

    else if (item.type === "folder") {

      const childTotal =
        getFolderWordCount(item.items);

      if (childTotal == null) {
        return null;
      }

      total += childTotal;
    }
  }

  return total;
}


function getFilename(item) {
  return typeof item === "string" ? item : item.filename;
}


function wrapSelection(wrapper) {
  const start = editor.selectionStart;
  const end = editor.selectionEnd;
  const selected = editor.value.substring(start, end);
  if (!selected) {
    const inserted = wrapper + wrapper;
    editor.value =
      editor.value.substring(0, start) +
      inserted +
      editor.value.substring(end);
    editor.selectionStart = editor.selectionEnd = start + wrapper.length;
  } else {
    const newText = wrapper + selected + wrapper;
    editor.value =
      editor.value.substring(0, start) +
      newText +
      editor.value.substring(end);
    editor.selectionStart = start + wrapper.length;
    editor.selectionEnd = end + wrapper.length;
  }
  editor.focus();
}


function insertPrefix(prefix) {
  const start = editor.selectionStart;
  const end = editor.selectionEnd;
  const text = editor.value;
  const before = text.substring(0, start);
  const selected = text.substring(start, end);
  const after = text.substring(end);
  const lines = selected.split('\n').map(line => prefix + line);
  const newText = lines.join('\n');
  editor.value = before + newText + after;
  editor.selectionStart = start;
  editor.selectionEnd = start + newText.length;
  editor.focus();
}


async function changeEditorFont(font) {
  editor.style.fontFamily = font;
  schedulePreviewRender();
  state.app_state.editor_font = font;
  await fetch('/save_app_state', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      editor_font: font
    })
  });
  editor.focus();
}


async function changeEditorSize(size) {
  editor.style.fontSize = size;
  schedulePreviewRender();
  state.app_state.editor_font_size = size;
  await fetch('/save_app_state', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      editor_font_size: size
    })
  });
  editor.focus();
}


// Inline icon from the sprite in _icons.html
function iconSvg(name) {
  return `<svg class="icon" aria-hidden="true"><use href="#i-${name}"/></svg>`;
}

// Small muted icon for a sidebar row: documents are pages, AI setup files are memos
function treeIcon(name) {
  const span = document.createElement("span");
  span.className = "tree-icon";
  span.innerHTML = iconSvg(name);
  return span;
}

function documentIconName(sectionName) {
  return sectionName === "system" || sectionName === "prompts" ? "sticky-note" : "file-text";
}


// =====================
// TOASTS: non-blocking messages in place of alert()
// =====================

function showToast(message, kind = "error") {
  let stack = document.getElementById("toastStack");
  if (!stack) {
    stack = document.createElement("div");
    stack.id = "toastStack";
    stack.className = "toast-stack";
    stack.setAttribute("aria-live", "polite");
    document.body.appendChild(stack);
  }

  const toast = document.createElement("div");
  toast.className = `toast toast-${kind}`;
  toast.setAttribute("role", kind === "error" ? "alert" : "status");
  toast.textContent = message ? String(message) : "Something went wrong.";

  const dismiss = () => {
    toast.classList.add("toast-leaving");
    setTimeout(() => toast.remove(), 200);
  };
  toast.onclick = dismiss;

  stack.appendChild(toast);
  setTimeout(dismiss, kind === "error" ? 7000 : 3500);
}


// TOKEN ESTIMATE
function estimateTokens(text) {
  return Math.floor(text.length / 4);
}

async function ensureFileCached(section, filename) {
  const key = `${section}/${filename}`;

  if (fileCache[key]) return fileCache[key];

  const res = await fetch('/load_file', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      section: section,
      filename: filename
    })
  });

  const data = await res.json();

  const content = data.content || "";
  fileCache[key] = content;

  return content;
}


async function fetchModels() {

  const res = await fetch('/models');

  modelRegistry = await res.json();

  renderModelDropdown();
}

async function renderModelsManager() {
  const list =
    document.getElementById("modelsManagerList");

  list.innerHTML = "";

  const scrollContent =
    document.createElement("div");

  scrollContent.classList.add(
    "models-scroll-content"
  );

  list.appendChild(scrollContent);

  const res = await fetch('/models');
  const data = await res.json();

  const filterBar =
    document.getElementById(
      "modelLabelFilters"
    );

  filterBar.innerHTML = "";

  // ---------- HEADER ----------
  const filterHeader =
    document.createElement("div");

  const filterLabel =
    document.createElement("span");

  filterLabel.textContent =
    "Filter by clicking below:";

  const clearBtn =
    document.createElement("button");

  clearBtn.textContent =
    "Clear Filters";

  if (
    activeModelLabelFilters.length === 0
  ) {
    clearBtn.disabled = true;
  }

  clearBtn.onclick = () => {
    activeModelLabelFilters = [];
    renderModelsManager();
  };

  filterHeader.appendChild(filterLabel);
  filterHeader.appendChild(clearBtn);

  filterBar.appendChild(filterHeader);

  // ---------- LABEL COLLECTION ----------
  const allLabels = new Set();

  for (const sourceModels of Object.values(data)) {

    if (!Array.isArray(sourceModels)) {
      continue;
    }

    for (const model of sourceModels) {

      for (const label of (model.labels || [])) {
        allLabels.add(label);
      }
    }
  }

  const chipsContainer =
    document.createElement("div");

  chipsContainer.classList.add(
    "model-filter-chips"
  );

  filterBar.appendChild(chipsContainer);

  for (const label of [...allLabels].sort()) {

    const chip =
      document.createElement("button");

    chip.classList.add(
      "model-filter-chip"
    );

    chip.textContent = label;

    if (
      activeModelLabelFilters.includes(label)
    ) {
      chip.classList.add("active");
    }

    chip.onclick = () => {
      const existingIndex =
        activeModelLabelFilters.indexOf(label);

      // Remove existing
      if (existingIndex !== -1) {
        activeModelLabelFilters.splice(
          existingIndex,
          1
        );

      } else {
        // Limit to 3
        if (
          activeModelLabelFilters.length >= 3
        ) {
          return;
        }
        activeModelLabelFilters.push(label);
      }
      renderModelsManager();
    };
    chipsContainer.appendChild(chip);
  }

  const models = [];

  for (const sourceModels of Object.values(data)) {

    if (Array.isArray(sourceModels)) {
      models.push(...sourceModels);
    }
  }

  const visibleModels = models.filter(model => {

    // ---------- SEARCH ----------
    const searchTarget = [
      model.name || "",
      model.id || "",
      model.source || "",
      ...(model.labels || [])
    ]
      .join(" ")
      .toLowerCase();

    if (
      modelSearchQuery &&
      !searchTarget.includes(modelSearchQuery)
    ) {
      return false;
    }

    // ---------- LABEL FILTERS ----------
    if (
      activeModelLabelFilters.length === 0
    ) {
      return true;
    }

    const labels =
      model.labels || [];

    return activeModelLabelFilters.every(
      filterLabel =>
        labels.includes(filterLabel)
    );
  });

  const groupedModels = {
    ollama: [],
    openrouter: []
  };

  for (const model of visibleModels) {

    const source =
      model.source || "openrouter";

    if (!groupedModels[source]) {
      groupedModels[source] = [];
    }

    groupedModels[source].push(model);
  }

  const providerOrder = [
    "ollama",
    "openrouter"
  ];

  for (const provider of providerOrder) {

    const providerModels =
      groupedModels[provider];

    if (
      !providerModels ||
      providerModels.length === 0
    ) {
      continue;
    }

    const section =
      document.createElement("div");

    section.classList.add(
      "provider-section"
    );

    const header =
      document.createElement("div");

    header.classList.add(
      "provider-header"
    );

    header.textContent =
      provider === "ollama"
        ? "OLLAMA"
        : "OPENROUTER";

    section.appendChild(header);

    for (const model of providerModels) {
    const row = document.createElement("div");
    row.classList.add("model-row");
    row.draggable = true;
    row.dataset.modelId = model.id;

    row.addEventListener("dragstart", () => {
      draggedRow = row;
      draggedModelId = model.id;
      row.classList.add("dragging");
    });

    row.addEventListener("dragend", () => {
      row.classList.remove("dragging");
      document
        .querySelectorAll(".model-row")
        .forEach(r => {
          r.classList.remove("drag-over");
        });
    });

    row.addEventListener("dragover", (e) => {
      e.preventDefault();
      if (row === draggedRow) return;
      document
        .querySelectorAll(".model-row")
        .forEach(r => {
          r.classList.remove("drag-over");
        });
      row.classList.add("drag-over");
    });

    row.addEventListener("drop", async (e) => {
      e.preventDefault();
      document
        .querySelectorAll(".model-row")
        .forEach(r => {
          r.classList.remove(
            "drag-over-top",
            "drag-over-bottom"
          );
        });

      const targetModelId =
        row.dataset.modelId;

      const draggedModel =
        visibleModels.find(
          m => m.id === draggedModelId
        );

      const targetModel =
        visibleModels.find(
          m => m.id === targetModelId
        );

      if (
        !draggedModel ||
        !targetModel
      ) {
        return;
      }

      if (
        draggedModel.source !==
        targetModel.source
      ) {

        row.classList.add(
          "invalid-drop"
        );

        setTimeout(() => {
          row.classList.remove(
            "invalid-drop"
          );
        }, 500);

        return;
      }

      if (
        !draggedModelId ||
        draggedModelId === targetModelId
      ) {
        return;
      }

      await moveModelToPosition(
        draggedModelId,
        targetModelId
      );

      draggedRow = null;
      draggedModelId = null;
    });

    row.onclick = () => {
      selectModel(model);
    };

    if (model.id === selectedModelId) {
      row.classList.add("active");
    }


    // ---------- INFO ----------

    const info = document.createElement("div");
    info.classList.add("model-info");

    const title = document.createElement("div");
    title.classList.add("model-title");

    title.textContent =
      model.name || model.id;

    const meta = document.createElement("div");
    meta.classList.add("model-meta");

    const source =
      model.source || "openrouter";
    const context =
      model.context
        ? ` • ${model.context} ctx`
        : "";
    meta.textContent =
      `${source}${context}`;

    info.appendChild(title);
    info.appendChild(meta);

    if (model.labels?.length) {

      const labels =
        document.createElement("div");

      labels.classList.add("model-labels");

      for (const label of model.labels) {

        const badge =
          document.createElement("span");

        badge.classList.add("model-label");

        badge.textContent = label;

        labels.appendChild(badge);
      }

      info.appendChild(labels);
    }

    // ---------- ACTIONS ----------
    const actions = document.createElement("div");
    actions.classList.add("model-actions");



    row.appendChild(info);
    row.appendChild(actions);

    section.appendChild(row);
  }
  scrollContent.appendChild(section);
}
}

function selectModel(model) {
  selectedModelId = model.id;
  renderModelsManager();
  populateModelEditor(model);
}


function populateModelEditor(model) {
  const editor =
    document.getElementById("modelEditor");
  editor.classList.remove("hidden");

  creatingModel = false;

  document
    .getElementById("saveModelChangesBtn")
    .classList.remove("hidden");

  document
    .getElementById("createModelBtn")
    .classList.add("hidden");

  document.getElementById(
    "editModelIdDisplay"
  ).textContent = model.id || "";

  document.getElementById(
    "editModelIdDisplay"
  ).classList.remove("hidden");

  document.getElementById(
    "editModelIdInput"
  ).classList.add("hidden");

  document.getElementById("verifyModelBtn").classList.remove("hidden");
  document.getElementById("verifyModelStatus").textContent = "";

  document.getElementById(
    "editModelName"
  ).value = model.name || model.id || "";

  document.getElementById(
    "editModelSource"
  ).value = model.source || "openrouter";

  const deleteButton =
    document.getElementById("deleteModelBtn");

  const isOllama = model.source === "ollama";

  deleteButton.disabled = isOllama;
  deleteButton.title = isOllama
    ? "Ollama models are managed outside SJB Writer. Uninstall the model through Ollama to reclaim disk space. SJB Writer retains its catalog information for future reinstalls."
    : "Delete this model from SJB Writer.";

  deleteButton.style.opacity = isOllama ? "0.5" : "";
  deleteButton.style.cursor = isOllama ? "not-allowed" : "";

  document.getElementById(
    "editModelContext"
  ).value = model.context || "";

  document.getElementById(
    "editModelLabels"
  ).value =
    (model.labels || []).join(", ");

  document.getElementById(
    "editModelDescription"
  ).value = model.description || "";
}

async function saveModelChanges() {
  if (!selectedModelId) return;
  const payload = {
    id: selectedModelId,
    name: document.getElementById(
      "editModelName"
    ).value,

    source: document.getElementById(
      "editModelSource"
    ).value,

    context: document.getElementById(
      "editModelContext"
    ).value,

    description: document.getElementById(
      "editModelDescription"
    ).value,

    labels: document.getElementById(
      "editModelLabels"
    ).value
      .split(",")
      .map(label => label.trim())
      .filter(Boolean)
  };
  const res = await fetch(
    "/update_model",
    {
      method: "POST",

      headers: {
        "Content-Type": "application/json"
      },

      body: JSON.stringify(payload)
    }
  );
  const data = await res.json();
  if (data.error) {
    showToast(data.error);
    return;
  }
  await fetchModels();

  await renderModelsManager();

  renderModelDropdown();
}


async function createModel() {

  const payload = {

    id: document.getElementById(
      "editModelIdInput"
    ).value.trim(),

    name: document.getElementById(
      "editModelName"
    ).value.trim(),

    source: document.getElementById(
      "editModelSource"
    ).value.trim(),

    context: parseInt(
      document.getElementById(
        "editModelContext"
      ).value
    ) || 0,

    description: document.getElementById(
      "editModelDescription"
    ).value.trim(),

    labels: document.getElementById(
      "editModelLabels"
    ).value
      .split(",")
      .map(label => label.trim())
      .filter(Boolean)
  };

  if (!payload.id || !payload.name) {

    showToast("Model ID and Name required", "info");
    return;
  }

  const res = await fetch(
    "/add_model",
    {
      method: "POST",

      headers: {
        "Content-Type": "application/json"
      },

      body: JSON.stringify(payload)
    }
  );

  const data = await res.json();

  if (data.error) {

    showToast(data.error);
    return;
  }

  await fetchModels();

  selectedModelId = payload.id;

  await renderModelsManager();

  // Re-open newly created model
  const sourceModels =
    modelRegistry[payload.source] || [];

  const createdModel =
    sourceModels.find(
      m => m.id === payload.id
    );

  if (createdModel) {
    populateModelEditor(createdModel);
  }
}

async function verifyModelId() {
  const idInput = document.getElementById("editModelIdInput");
  const idDisplay = document.getElementById("editModelIdDisplay");
  const modelId = idInput.classList.contains("hidden")
    ? idDisplay.textContent.trim()
    : idInput.value.trim();
  if (!modelId) {
    document.getElementById("verifyModelStatus").textContent = "Enter a model ID first.";
    return;
  }

  const statusEl = document.getElementById("verifyModelStatus");
  statusEl.textContent = "Checking...";

  try {
    const res = await fetch("https://openrouter.ai/api/v1/models");
    const data = await res.json();
    const match = data.data.find(m => m.id === modelId);

    if (!match) {
      statusEl.textContent = "⚠️ Model not found on OpenRouter.";
      return;
    }

    // Auto-fill blank fields only
    const nameInput = document.getElementById("editModelName");
    const contextInput = document.getElementById("editModelContext");
    const descInput = document.getElementById("editModelDescription");
    const labelsInput = document.getElementById("editModelLabels");

    if (!nameInput.value.trim()) {
      nameInput.value = match.name || "";
    }

    if (!contextInput.value || contextInput.value === "0") {
      contextInput.value = match.context_length || "";
    }

    if (!descInput.value.trim()) {
      descInput.value = match.description || "";
    }

    // Add Free label if applicable and not already present
    const promptCost = parseFloat(match.pricing?.prompt ?? 1);
    const completionCost = parseFloat(match.pricing?.completion ?? 1);
    const isFree = promptCost === 0 && completionCost === 0;

    if (isFree) {
      const currentLabels = labelsInput.value
        .split(",")
        .map(l => l.trim())
        .filter(Boolean);
      if (!currentLabels.map(l => l.toLowerCase()).includes("free")) {
        currentLabels.push("Free");
        labelsInput.value = currentLabels.join(", ");
      }
    }

    statusEl.textContent = `✅ Found: ${match.name} — ${(match.context_length || 0).toLocaleString()} ctx`;

  } catch (err) {
    document.getElementById("verifyModelStatus").textContent = "Error reaching OpenRouter.";
  }
}



async function deleteSelectedModel() {
  if (!selectedModelId) {
    return;
  }

  const model = getModelById(selectedModelId);

  if (model?.source === "ollama") {
    return;
  }

  const confirmed =
    confirm(
      `Delete "${model?.name || selectedModelId}"?`
    );

  if (!confirmed) {
    return;
  }

  await deleteModel(selectedModelId);

  selectedModelId = null;

  document
    .getElementById("modelEditor")
    .classList.add("hidden");
}



async function deleteModel(modelId) {

  const res = await fetch('/delete_model', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      id: modelId
    })
  });

  const data = await res.json();

  if (data.status !== "deleted") {
    showToast(data.error || "Delete failed");
    return;
  }

  await fetchModels();
  await renderModelsManager();
}

async function moveModel(modelId, direction) {

  const res = await fetch('/move_model', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      id: modelId,
      direction: direction
    })
  });

  const data = await res.json();

  if (data.status !== "moved") {
    showToast(data.error || "Move failed");
    return;
  }

  await fetchModels();
  await renderModelsManager();
}


async function moveModelToPosition(
  draggedId,
  targetId
) {

  const visibleRows = [
    ...document.querySelectorAll(".model-row")
  ];

  const draggedVisibleIndex =
    visibleRows.findIndex(
      row =>
        row.dataset.modelId === draggedId
    );

  const targetVisibleIndex =
    visibleRows.findIndex(
      row =>
        row.dataset.modelId === targetId
    );

  if (
    draggedVisibleIndex === -1 ||
    targetVisibleIndex === -1
  ) {
    return;
  }

  const direction =
    draggedVisibleIndex < targetVisibleIndex
      ? 1
      : -1;

  const movesNeeded =
    Math.abs(
      targetVisibleIndex -
      draggedVisibleIndex
    );

  for (let i = 0; i < movesNeeded; i++) {

    const res = await fetch('/move_model', {

      method: 'POST',

      headers: {
        'Content-Type': 'application/json'
      },

      body: JSON.stringify({
        id: draggedId,
        direction: direction
      })
    });

    const data = await res.json();

    if (data.status !== "moved") {

      showToast(data.error || "Move failed");

      return;
    }
  }

  await fetchModels();

  await renderModelsManager();

  renderModelDropdown();
}


function openVisualPanel() {
  document.getElementById("settingsMainLayout").classList.add("hidden");
  document.getElementById("settingsVisualView").classList.remove("hidden");
  loadVisualSettingsIntoUI();
}

function closeVisualPanel() {
  const { mode, accent } = savedAppearance();
  applyAppearance(mode, accent);
  document.getElementById("settingsVisualView").classList.add("hidden");
  document.getElementById("settingsMainLayout").classList.remove("hidden");
}

async function openModelsPanel() {
  activeModelLabelFilters = [];
  document.getElementById("settingsMainLayout")
    .classList.add("hidden");
  document.getElementById("settingsModelsView")
    .classList.remove("hidden");

  const searchInput =
    document.getElementById("modelSearchInput");
  searchInput.value = modelSearchQuery;
  searchInput.oninput = (e) => {
    modelSearchQuery = e.target.value.toLowerCase();
    renderModelsManager();
  };
  await renderModelsManager();
}

function closeModelsPanel() {
  document.getElementById("settingsModelsView")
    .classList.add("hidden");
  document.getElementById("settingsMainLayout")
    .classList.remove("hidden");
}



function renderModelDropdown() {
  const selects = [
    document.getElementById("modelName"),
    document.getElementById("footerModelName")
  ].filter(Boolean);

  selects.forEach(select => {
    select.innerHTML =
      '<option value="">-- Select Model --</option>';
  });

  function appendGroup(label, items) {
    if (!items.length) return;

    selects.forEach(select => {
      const group = document.createElement("optgroup");
      group.label = label;

      for (const model of items) {
        const option = document.createElement("option");
        option.value = model.id;
        option.textContent = model.name || model.id;
        group.appendChild(option);
      }

      select.appendChild(group);
    });
  }

  appendGroup("Ollama (Local)", modelRegistry.ollama || []);
  appendGroup("OpenRouter", modelRegistry.openrouter || []);

  if (settings.modelName) {
    const modelExists = selects.some(select =>
      Array.from(select.options).some(
        option => option.value === settings.modelName
      )
    );

    if (!modelExists) {
      settings.modelName = "";
      settings.modelSource = "openrouter";
      localStorage.setItem(
        "sjb_settings",
        JSON.stringify(settings)
      );
    }
  }

  selects.forEach(select => {
    select.value = settings.modelName;

    select.onchange = () => {
      setActiveModel(select.value);
    };
  });
}

function setActiveModel(modelId) {
  const selectedModel = getModelById(modelId);

  settings.modelName = modelId;
  settings.modelSource = selectedModel?.source || "openrouter";

  updateActiveModelDisplay();
  updateTokenMeter();
}

function updateActiveModelDisplay() {
  const modelId = settings.modelName || "";

  const el = document.getElementById("activeModel");
  if (el) {
    el.innerText = modelId ? `Model: ${modelId}` : "Model: None";
  }

  const settingsSelect = document.getElementById("modelName");
  const footerSelect = document.getElementById("footerModelName");

  if (settingsSelect) settingsSelect.value = modelId;
  if (footerSelect) footerSelect.value = modelId;
}


async function updateTokenMeter() {
  // Same parts, in the same order, as the request generate() sends
  const pick = (tree, set) =>
    collectFilenames(tree || []).filter(f => set.has(f));
  const read = (section, files) =>
    Promise.all(files.map(f => ensureFileCached(section, f)));

  const parts = {
    Rules: await read("system", pick(state.global?.system, selected.system)),
    Notes: await read("background", pick(state.project?.background, selected.background)),
    Chapters: await read(
      "writing",
      pick(state.project?.writing, selected.writing).filter(f => f !== currentFile.filename)
    ),
    "This document": [editor.value],
    Instruction: [promptBox.value]
  };

  const join = list => list.join("\n\n---\n\n");
  const tokens = estimateTokens(join(Object.values(parts).flat()));
  const selectedModel = getModelById(settings.modelName);
  // Context sizes typed into Manage Models are stored as text
  const max = Number(selectedModel?.context) || 128000;

  let level = "ok";
  if (tokens / max > 0.9) level = "high";
  else if (tokens / max > 0.7) level = "warn";

  const short = n =>
    n >= 1000000 ? `${Math.round(n / 100000) / 10}M`
    : n >= 1000 ? `${Math.round(n / 1000)}k`
    : String(n);
  const meter = document.getElementById("tokenMeter");
  meter.dataset.level = level;
  meter.innerText = `AI request ≈ ${tokens.toLocaleString()} tokens`;

  // Hover: where the tokens come from, and how much of the model's limit they use
  const breakdown = Object.entries(parts)
    .filter(([, list]) => list.some(text => text))
    .map(([name, list]) => `${name} ${estimateTokens(join(list)).toLocaleString()}`)
    .join(" · ") || "Nothing to send yet";
  const used = (tokens / max) * 100;
  meter.dataset.tip =
    `${breakdown} — ${used < 0.1 ? "<0.1" : used.toFixed(used < 10 ? 1 : 0)}% of this model's ${short(max)} limit`;
}

function toggleProjectMenu(e) {
  e.stopPropagation();

  document.querySelectorAll('.file-menu').forEach(m => m.remove());

  const rect = e.target.getBoundingClientRect();

  const menu = document.createElement('div');
  menu.classList.add('file-menu');

  // ---- CREATE PROJECT ----

  const create = document.createElement('div');
  create.textContent = "Create Project";

  create.onclick = async () => {

    const name = prompt("Project name:");

    if (!name) return;

    // SAVE FIRST
    if (isDirty) {
      await saveCurrentFile();
    }

    const res = await fetch('/create_project', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        name: name
      })
    });

    const data = await res.json();

    if (data.status === "created") {

      currentProject = data.project;

      loadSelections();

      await loadProjects();
      await loadAll();

    } else {

      showToast(data.error || "Failed to create project");
    }

    menu.remove();
  };

  // ---- RENAME PROJECT ----

  const rename = document.createElement('div');
  rename.textContent = "Rename Project";

  rename.onclick = async () => {

    const project =
      projects.find(p => p.id === currentProject);

    const currentName =
      project?.title || currentProject;

    const newName =
      prompt("New project name:", currentName);

    if (!newName) return;

    const res = await fetch('/rename_project', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        project: currentProject,
        name: newName
      })
    });

    const data = await res.json();

    if (data.status === "renamed") {

      await loadProjects();
      await loadAll();

    } else {

      showToast(data.error || "Rename failed");
    }

    menu.remove();
  };

  // ---- DELETE PROJECT ----

  const del = document.createElement('div');
  del.textContent = "Delete Project";

  del.onclick = async () => {

    if (projects.length <= 1) {
      showToast("At least one project must exist.", "info");
      return;
    }

    if (currentProject === "default") {

      showToast("Cannot delete default project", "info");
      return;
    }

    const confirmed = confirm(
      `Delete project "${currentProject}"?`
    );

    if (!confirmed) return;

    // SAVE FIRST
    if (isDirty) {
      await saveCurrentFile();
    }

    const res = await fetch('/delete_project', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        project: currentProject
      })
    });

    const data = await res.json();

    if (data.status === "deleted") {

      currentProject = data.current_project;

      await loadProjects();

      loadSelections();

      await loadAll();

    } else {

      showToast(data.error || "Delete failed");
    }

    menu.remove();
  };

  menu.appendChild(create);
  menu.appendChild(rename);
  menu.appendChild(del);

  document.body.appendChild(menu);

  menu.style.top = `${rect.bottom}px`;
  menu.style.left =
    `${rect.right - menu.offsetWidth}px`;

  setTimeout(() => {
    document.addEventListener('click', () => {
      menu.remove();
    }, { once: true });
  }, 0);
}


function toggleProjectDropdown(e) {
  e.stopPropagation();

  document.querySelectorAll('.file-menu').forEach(m => m.remove());

  const rect =
    document.getElementById("projectDropdown")
      .getBoundingClientRect();

  const menu = document.createElement("div");
  menu.classList.add("file-menu", "project-menu");

  const allProjects = projects || [];
  const recentIds = recentProjects || [];
  const showRecent = allProjects.length >= 7;

  const projectMap = Object.fromEntries(
    allProjects.map(project => [project.id, project])
  );

  const recent = showRecent
    ? [...new Set(recentIds)]
        .map(id => projectMap[id])
        .filter(Boolean)
        .slice(0, 5)
    : [];

  const recentIdSet = new Set(
    recent.map(project => project.id)
  );

  const alphabetical = allProjects
    .filter(project => !recentIdSet.has(project.id))
    .sort((a, b) =>
      (a.title || a.id).localeCompare(b.title || b.id)
    );

  function addHeader(label) {
    const header = document.createElement("div");
    header.classList.add("project-menu-header");
    header.textContent = label;
    menu.appendChild(header);
  }

  function addProject(project) {
    const item = document.createElement("div");
    item.classList.add("project-menu-item");
    item.innerHTML = iconSvg("book");
    item.appendChild(document.createTextNode(project.title || project.id));

    if (project.id === currentProject) {
      item.classList.add("current");
    }

    item.onclick = async () => {
      try {
        if (isDirty) {
          await saveCurrentFile();
        }

        const res = await fetch('/switch_project', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            project: project.id
          })
        });

        const data = await res.json();

        if (data.status === "switched") {
          currentProject = project.id;
          await loadProjects();
          loadSelections();
          await loadAll();
        } else {
          showToast(data.error || "Failed to switch project");
        }
      } catch (error) {
        console.error("Project switch failed:", error);
        showToast("Failed to switch project.");
      }

      closeMenu();
    };

    menu.appendChild(item);
  }

  if (recent.length > 0) {
    addHeader("RECENT");

    recent.forEach(addProject);

    const divider = document.createElement("div");
    divider.classList.add("project-menu-divider");
    menu.appendChild(divider);
  }

  if (alphabetical.length > 0) {
    addHeader(recent.length > 0 ? "OTHER PROJECTS" : "PROJECTS");
    alphabetical.forEach(addProject);
  }

  function closeMenu() {
    menu.remove();
    document.removeEventListener("click", handleOutsideClick);
  }

  function handleOutsideClick(event) {
    if (!menu.contains(event.target)) {
      closeMenu();
    }
  }

  menu.addEventListener("click", event => {
    event.stopPropagation();
  });

  document.body.appendChild(menu);

  const gap = 8;
  const below = window.innerHeight - rect.bottom - gap;
  const above = rect.top - gap;

  menu.style.left = `${Math.max(
    8,
    Math.min(rect.left, window.innerWidth - menu.offsetWidth - 8)
  )}px`;

  if (menu.scrollHeight > below && above > below) {
    menu.style.maxHeight = `${Math.max(80, above)}px`;
    menu.style.top = "auto";
    menu.style.bottom = `${window.innerHeight - rect.top + 4}px`;
  } else {
    menu.style.top = `${rect.bottom + 4}px`;
    menu.style.bottom = "auto";
    menu.style.maxHeight = `${Math.max(80, below)}px`;
  }

  setTimeout(() => {
    document.addEventListener("click", handleOutsideClick);
  }, 0);
}



editor.addEventListener("input", () => {
  updateTokenMeter();
  updateWordCount();
});

promptBox.addEventListener("input", () => {
  // If editing deviates from original prompt → deselect
  if (selected.prompt && promptBox.value !== originalPromptContent) {
    selected.prompt = null;
    renderLists(); // update radio UI
  }

  saveSelections();
  updateTokenMeter();
  updateWordCount();
});


async function loadApiKeyStatus() {
  const res = await fetch('/api_key_status');
  const data = await res.json();

  const el = document.getElementById("apiKeyStatus");

  if (data.status === "saved") {
    el.innerText = "API Key: Saved";
  } else {
    el.innerText = "API Key: Not set";
  }
}


// INSERT LOGIC
function getInsertMode() {
  const start = editor.selectionStart;
  const end = editor.selectionEnd;
  const length = editor.value.length;

  if (length === 0) return "empty";
  if (start === 0 && end === 0) return "start";
  if (start === length && end === length) return "end";
  return "middle";
}

const DEFAULT_MARKER_BEFORE = "********\nNew generated content below\n********";
const DEFAULT_MARKER_AFTER = "********\nEnd of generated content above\n********";

// Marker text from Settings; empty strings when markers are turned off
function getOutputMarkers() {
  const appState = state.app_state || {};
  if (appState.showOutputMarkers === false) return { before: "", after: "" };
  return {
    before: appState.outputMarkerBefore ?? DEFAULT_MARKER_BEFORE,
    after: appState.outputMarkerAfter ?? DEFAULT_MARKER_AFTER
  };
}

// Text placed before and after the AI output, by where the cursor was.
// Markers sit in their own paragraph; with markers off, only the paragraph breaks remain.
function getOutputWrappers(mode) {
  const { before, after } = getOutputMarkers();
  const open = before ? `${before}\n\n` : "";
  const close = after ? `\n\n${after}` : "";

  if (mode === "empty") return { before: "", after: "" };
  if (mode === "start") return { before: "", after: `${close}\n\n` };
  if (mode === "end") return { before: `\n\n${open}`, after: "" };
  return { before: `\n\n${open}`, after: `${close}\n\n` };
}

function insertAtCursor(text) {
  const start = editor.selectionStart;
  const end = editor.selectionEnd;

  const before = editor.value.substring(0, start);
  const after = editor.value.substring(end);

  editor.value = before + text + after;

  editor.selectionStart = editor.selectionEnd = start + text.length;
}

function insertAtGenerationPoint(text) {

  const before = editor.value.substring(0, generationCursorPos);
  const after = editor.value.substring(generationCursorPos);

  editor.value = before + text + after;

  generationCursorPos += text.length;

}


function clearPrompt() {
  promptBox.value = "";
  selected.prompt = null;
  saveSelections();
  renderLists();
  updateTokenMeter();
}


// =====================
// GENERATE WITH SELECTIONS
// =====================

async function generate() {
  if (!settings.modelName) {
    showToast("Please select a model in Settings.", "info");
    return;
  }

  isGenerating = true;
  followGeneration = true;
  generationCursorPos = editor.selectionStart;
  currentAbortController = new AbortController();
  document.getElementById("stopGenerateBtn").disabled = false;
  document.getElementById("loadingIndicator").style.display = "block";
  await requestWakeLock();

  const button = document.getElementById("generateBtn");
  button.classList.add("is-busy");
  button.disabled = true;

// Snapshot before generation
generationUndoStack.push({
  content: editor.value,
  title: titleInput.value
});
if (generationUndoStack.length > MAX_UNDO) {
  generationUndoStack.shift();
}
updateUndoButton();

  try {
    // Preserve order from state
    const systemFiles = collectFilenames(state.global.system || [])
      .filter(f => selected.system.has(f));
    const backgroundFiles = collectFilenames(state.project.background || [])
      .filter(f => selected.background.has(f));
    const writingFiles = collectFilenames(state.project.writing || [])
      .filter(f => selected.writing.has(f) && f !== currentFile.filename);

    // Final ordered payload
    const payload = {
      system: systemFiles,
      background: backgroundFiles,
      writing: [...writingFiles, editor.value],
      prompt: promptBox.value,
      settings: settings
    };

    const res = await fetch('/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: currentAbortController.signal
    });

    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      showToast(errData.error || `Generation failed (${res.status})`);
      generationUndoStack.pop();
      updateUndoButton();
      return;
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    const mode = getInsertMode();
    let started = false;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value);
        // Add separators only once
        if (!started) {
          const wrap = getOutputWrappers(mode);
          insertAtGenerationPoint(wrap.before);
          // Closing text goes after the cursor, so the AI text streams in between
          editor.value =
            editor.value.substring(0, generationCursorPos) +
            wrap.after +
            editor.value.substring(generationCursorPos);
          started = true;
        }
        insertAtGenerationPoint(chunk);
        isDirty = true;
        if (followGeneration) {
          editor.scrollTop = editor.scrollHeight;
        }
        updateWordCount();
      }
    } catch (err) {
      if (err.name === "AbortError") {
        console.log("Generation stopped by user.");
      } else {
        throw err;
      }
    }

    await saveCurrentFile();


    // Restore prompt to original after generation
    if (selected.prompt) {
      promptBox.value = originalPromptContent;
    }

  } finally {
    isGenerating = false;
    generationCursorPos = null;
    currentAbortController = null;
    releaseWakeLock();
    document.getElementById("stopGenerateBtn").disabled = true;
    button.classList.remove("is-busy");
    button.disabled = false;
    document.getElementById("loadingIndicator").style.display = "none";
  }
}

async function requestWakeLock() {
  if ('wakeLock' in navigator) {
    try {
      wakeLock = await navigator.wakeLock.request('screen');
    } catch (err) {
      console.log('Wake Lock not available:', err);
    }
  }
}

function releaseWakeLock() {
  if (wakeLock) {
    wakeLock.release().catch(() => {});
    wakeLock = null;
  }
}

function stopGeneration() {
  if (currentAbortController) {
    currentAbortController.abort();
  }
}


function undoLastGeneration() {
  if (generationUndoStack.length === 0) {
    showToast("Nothing to undo.", "info");
    return;
  }
  const snapshot = generationUndoStack.pop();
  editor.value = snapshot.content;
  titleInput.value = snapshot.title;
  isDirty = true;
  updateWordCount();
  updateTokenMeter();
  updateUndoButton();
}

function updateUndoButton() {
  const btn = document.getElementById("undoGenerateBtn");
  if (btn) btn.disabled = generationUndoStack.length === 0;
}


let selected = {
  system: new Set(),
  background: new Set(),
  writing: new Set(),
  prompt: null
};

let originalPromptContent = "";


let state = {
  global: {},
  project: {}
};

let projects = [];
let currentProject = "default";
let recentProjects = [];
let modelsData = [];
let selectedModelIndex = null;
let creatingModel = false;

function showAddModelForm() {

    creatingModel = true;

    document
        .getElementById("modelEditor")
        .classList
        .remove("hidden");

    // ID mode
    document
        .getElementById("editModelIdDisplay")
        .classList
        .add("hidden");

    document
        .getElementById("editModelIdInput")
        .classList
        .remove("hidden");

    document
        .getElementById("verifyModelBtn")
        .classList.remove("hidden");
    document
        .getElementById("verifyModelStatus")
        .textContent = "";

    // Buttons
    document
        .getElementById("saveModelChangesBtn")
        .classList
        .add("hidden");

    document
        .getElementById("createModelBtn")
        .classList
        .remove("hidden");

    // Clear fields
    document.getElementById("editModelIdInput").value = "";

    document.getElementById("editModelName").value = "";

    document.getElementById("editModelSource").value =
        "openrouter";

    document.getElementById("editModelContext").value = "";

    document.getElementById("editModelLabels").value = "";

    document.getElementById("editModelDescription").value = "";
}



// =====================
// CREATE NEW FILE
// =====================

async function createNew(section) {
  const title = prompt("Enter title:");

  if (!title) return;

  const res = await fetch('/create_item', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      section: section,
      title: title
    })
  });

  const data = await res.json();

  if (data.status === "created") {
    const prevSelected = {
      system: new Set(selected.system),
      background: new Set(selected.background),
      writing: new Set(selected.writing),
      prompt: selected.prompt
    };

    await loadAll();

    // restore selections
    selected = prevSelected;

    await openFile(section, data.filename);

  } else {
    showToast(data.error || "Error creating file");
  }
}
// ===================
// END CREATE NEW FILE
// ===================


// ===================
// CREATE NEW FOLDER
// ===================


async function createFolder(section) {

  const title = prompt("Folder name:");

  if (!title) return;

  const res = await fetch('/create_folder', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      section,
      title
    })
  });

  const data = await res.json();

  if (data.status === "created") {

    await loadAll();

  } else {

    showToast(data.error || "Error creating folder");
  }
}


function collectFilenames(items) {

  const filenames = [];

  for (const item of items) {

    // Legacy fallback
    if (typeof item === "string") {
      filenames.push(item);
      continue;
    }

    // Typed files
    if (item.type === "file") {
      filenames.push(item.filename);
      continue;
    }

    // Typed folders
    if (
      item.type === "folder" &&
      Array.isArray(item.items)
    ) {
      filenames.push(
        ...collectFilenames(item.items)
      );
    }
  }

  return filenames;
}

function getFolderSelectionState(folderItems, sectionName) {
  const filenames = collectFilenames(folderItems);
  if (filenames.length === 0) return "empty";

  const selectedSet = selected[sectionName];
  const selectedCount = filenames.filter(f => selectedSet.has(f)).length;

  if (selectedCount === 0) return "empty";
  if (selectedCount === filenames.length) return "full";
  return "partial";
}

function setFolderSelection(folderItems, sectionName, shouldSelect) {
  const filenames = collectFilenames(folderItems);
  const selectedSet = selected[sectionName];
  for (const f of filenames) {
    if (shouldSelect) {
      selectedSet.add(f);
    } else {
      selectedSet.delete(f);
    }
  }
}


// ===================
// END CREATE NEW FOLDER
// ===================


async function loadAll() {
  const res = await fetch('/load');
  const data = await res.json();

  state.global = data.global;
  state.project = data.project;
  state.app_state = data.app_state;
  fileCache = {};

  // Restore global editor preferences
  const editorFont = state.app_state.editor_font || "Georgia";
  const editorFontSize = state.app_state.editor_font_size || "16px";

  editor.style.fontFamily = editorFont;
  editor.style.fontSize = editorFontSize;

  fontSelect.value = editorFont;
  fontSizeSelect.value = editorFontSize;

  // Remove invalid selections
  const allBackgroundFilenames = collectFilenames(state.project.background);
  const allWritingFilenames = collectFilenames(state.project.writing);

  selected.background = new Set(
    [...selected.background].filter(f =>
      allBackgroundFilenames.includes(f)
    )
  );
  selected.writing = new Set(
    [...selected.writing].filter(f =>
      allWritingFilenames.includes(f)
    )
  );

  const allWritingFiles =
    collectFilenames(state.project.writing);

  const allBackgroundFiles =
    collectFilenames(state.project.background);

  const fileStillExists =
    (
      currentFile.section === "writing" &&
      allWritingFiles.includes(currentFile.filename)
    ) ||
    (
      currentFile.section === "background" &&
      allBackgroundFiles.includes(currentFile.filename)
    ) ||
    (
      currentFile.section === "system"
    ) ||
    (
      currentFile.section === "prompts"
    );

  if (!fileStillExists) {
    currentFile = {
      section: null,
      filename: null
    };

    editor.value = "";
    schedulePreviewRender();
    titleInput.value = "";
  }

  renderLists();

  // Primary startup restore:
  // restore the actual last file opened anywhere

  const globalLast = state.global.last_opened_global;
  const allFilenames = [
    ...collectFilenames(state.project.writing),
    ...collectFilenames(state.project.background),
    ...collectFilenames(state.global.prompts || []),
    ...collectFilenames(state.global.system || [])
  ];

  // The writer closed the document here last time: stay on the empty state
  if (readPref(`sjb_doc_closed_${currentProject}`, false)) {
    currentFile = {
      section: null,
      filename: null
    };
    editor.value = "";
    schedulePreviewRender();
    titleInput.value = "";
    isDirty = false;
    renderLists();
  }

  else if (
    globalLast &&
    globalLast.project === currentProject &&
    globalLast.section &&
    globalLast.filename &&
    allFilenames.includes(globalLast.filename)
  ) {
    await openFile(globalLast.section, globalLast.filename);
  }

  // Future project fallback
  else {
    const projectLast = state.project.last_opened_project;
    if (
      projectLast &&
      projectLast.section &&
      projectLast.filename &&
      allFilenames.includes(projectLast.filename)
    ) {
      await openFile(projectLast.section, projectLast.filename);
    }

    // Final fallback
    else if (allWritingFiles.length > 0) {
      await openFile('writing', allWritingFiles[0]);
    }
    else {

      // No files exist in this project
      currentFile = {
        section: null,
        filename: null
      };

      editor.value = "";
      schedulePreviewRender();
      titleInput.value = "";

      isDirty = false;

      renderLists();
    }
  }

  updateTokenMeter();
}


async function loadProjects() {
  const res = await fetch('/projects');
  const data = await res.json();
  projects = data.projects || [];
  recentProjects = data.recent || [];
  currentProject = data.current || "default";
  renderProjectList(data);
}



function renderProjectList(data) {
  const container =
    document.getElementById("projectsList");

  container.innerHTML = "";

  const allProjects = data.projects || [];
  const recentIds = data.recent || [];
  const showRecent = allProjects.length >= 7;

  // Build lookup map
  const projectMap = {};

  for (const project of allProjects) {
    projectMap[project.id] = project;
  }

  // Current project label uses TITLE
  const currentMeta = projectMap[currentProject];

  document.getElementById("currentProjectLabel").innerText =
    currentMeta?.title || currentProject;

  // Build recent project objects, ignoring stale IDs
  const recentProjects = showRecent
    ? [...new Set(recentIds)]
        .map(id => projectMap[id])
        .filter(Boolean)
        .slice(0, 5)
    : [];

  const recentProjectIds = new Set(
    recentProjects.map(project => project.id)
  );

  // Remaining projects, sorted alphabetically by title
  const remaining = allProjects
    .filter(project => !recentProjectIds.has(project.id))
    .sort((a, b) =>
      (a.title || a.id).localeCompare(b.title || b.id)
    );

  // ---------- RECENT ----------
  if (recentProjects.length > 0) {
    const recentHeader = document.createElement("div");
    recentHeader.classList.add("project-header");
    recentHeader.textContent = "RECENT";
    container.appendChild(recentHeader);

    for (const project of recentProjects) {
      container.appendChild(createProjectRow(project));
    }

    // Divider between Recent and the other projects
    const divider = document.createElement("div");
    divider.classList.add("project-section-divider");
    container.appendChild(divider);
  }

  // ---------- OTHER PROJECTS (A–Z) ----------
  if (remaining.length > 0) {
    const allHeader = document.createElement("div");
    allHeader.classList.add("project-header");
    allHeader.textContent = recentProjects.length > 0 ? "OTHER PROJECTS" : "PROJECTS";
    container.appendChild(allHeader);

    for (const project of remaining) {
      container.appendChild(createProjectRow(project));
    }
  }
}


function createProjectRow(project) {

  const row = document.createElement("div");

  row.classList.add("project-row");

  if (project.id === currentProject) {
    row.classList.add("active-project");
  }

  row.textContent = project.title;

  row.onclick = async () => {

    // SAVE FIRST
    if (isDirty) {
      await saveCurrentFile();
    }

    const res = await fetch('/switch_project', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        project: project.id
      })
    });

    const data = await res.json();

    if (data.status === "switched") {

      currentProject = project.id;

      await loadProjects();

      loadSelections();

      await loadAll();

    } else {

      showToast(data.error || "Failed to switch project");
    }
  };

  return row;
}

async function createProject() {

  const name = prompt("Project name:");

  if (!name) return;

  const res = await fetch('/create_project', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      name: name
    })
  });

  const data = await res.json();

  if (data.status === "created") {

    currentProject = data.project;

    loadSelections();

    await loadProjects();
    await loadAll();

  } else {

    showToast(data.error || "Failed to create project");
  }
}


async function renderLists() {
  await renderSection('promptsList', state.global.prompts || [], 'prompts');
  await renderSection('systemList', state.global.system || [], 'system');
  await renderSection('backgroundList', state.project.background || [], 'background');
  await renderSection('writingList', state.project.writing || [], 'writing');
  updateAiSummary();
  updateEmptyState();
}



async function saveCurrentFile() {

  if (!currentFile.filename) return;

  const res = await fetch('/save_file', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      section: currentFile.section,
      filename: currentFile.filename,
      title: titleInput.value,
      content: editor.value
    })
  });

  const data = await res.json();

  if (data.status === "saved") {
    isDirty = false;
    lastSavedAt = Date.now();
    fileCache[`${currentFile.section}/${currentFile.filename}`] = editor.value;

    const isGlobal =
      currentFile.section === "prompts" ||
      currentFile.section === "system";

    const stateArr = isGlobal
      ? state.global[currentFile.section]
      : state.project[currentFile.section];

    const item = findFileItemInTree(
      stateArr || [],
      currentFile.filename
    );

    if (item) {
      item.title = titleInput.value;

      if (typeof data.wordCount === "number") {
        item.wordCount = data.wordCount;
      }
    }

    await renderLists();

  } else {
    console.error("Save failed", data);
  }
}


function loadSelections() {

  // ---------- GLOBAL ----------
  const globalSaved =
    localStorage.getItem("sjb_selected_global");

  if (globalSaved) {
    try {

      const data = JSON.parse(globalSaved);

      selected.system = new Set(data.system || []);
      selected.prompt = data.prompt || null;

    } catch (e) {
      console.error("Failed loading global selections", e);
    }
  }

  // ---------- PROJECT ----------
  const projectSaved =
    localStorage.getItem(`sjb_selected_${currentProject}`);

  if (projectSaved) {
    try {

      const data = JSON.parse(projectSaved);

      selected.background =
        new Set(data.background || []);

      selected.writing =
        new Set(data.writing || []);

    } catch (e) {
      console.error("Failed loading project selections", e);
    }
  } else {

    // clean defaults
    selected.background = new Set();
    selected.writing = new Set();
  }
}



editor.addEventListener("keydown", function (e) {
  if (e.key === "Tab") {
    e.preventDefault();

    const start = editor.selectionStart;
    const end = editor.selectionEnd;

    const value = editor.value;

    const before = value.substring(0, start);
    const selected = value.substring(start, end);
    const after = value.substring(end);

    // MULTI-LINE SELECTION
    if (selected.includes("\n")) {
      const lines = selected.split("\n");

      let newLines;

      if (e.shiftKey) {
        // UNINDENT
        newLines = lines.map(line =>
          line.startsWith("  ") ? line.slice(2) : line
        );
      } else {
        // INDENT
        newLines = lines.map(line => "  " + line);
      }

      const newText = newLines.join("\n");

      editor.value = before + newText + after;

      editor.selectionStart = start;
      editor.selectionEnd = start + newText.length;

    } else {
      // SINGLE LINE
      if (e.shiftKey) {
        // UNINDENT
        if (before.endsWith("  ")) {
          editor.value =
            before.slice(0, -2) + selected + after;

          editor.selectionStart = editor.selectionEnd = start - 2;
        }
      } else {
        // INDENT
        editor.value =
          before + "  " + selected + after;

        editor.selectionStart = editor.selectionEnd = start + 2;
      }
    }
  }
});

editor.addEventListener('wheel', () => {
  if (isGenerating) {
    followGeneration = false;
  }
});

editor.addEventListener('touchmove', () => {
  if (isGenerating) {
    followGeneration = false;
  }
});

function renderSection(
  elementId,
  items,
  sectionName,
  depth = 0,
  isRecursive = false
) {
  const container =
    typeof elementId === "string"
      ? document.getElementById(elementId)
      : elementId;

  if (!container) {
    console.error(
      "renderSection missing container:",
      elementId,
      sectionName
    );
    return;
  }

  if (!isRecursive) {
    container.innerHTML = '';
  }

  // Listeners go on once; the container element survives re-renders
  if (!isRecursive && !container.dataset.dropReady) {
    container.dataset.dropReady = "1";

    container.addEventListener('dragover', (e) => {
      e.preventDefault();
    });

    container.addEventListener('drop', async (e) => {
      // Only handle drops directly on the container (empty space),
      // not on file-row or folder-row (those stopPropagation or handle their own)
      if (e.target !== container) return;

      const draggedFilename = e.dataTransfer.getData('text/plain');
      const draggedSection = e.dataTransfer.getData('section');
      if (!draggedFilename) return;
      if (draggedSection !== sectionName) {
        await moveFileToSection(draggedSection, sectionName, draggedFilename);
        return;
      }

      await moveFileTo(sectionName, draggedFilename, null, null, null);
    });
  }

  for (let item of sortForView(items, sectionName)) {
    if (item.type === "folder") {
      const folderRow =
        document.createElement("div");

      folderRow.classList.add("folder-row");
      folderRow.draggable = true;
      folderRow.dataset.section = sectionName;
      folderRow.dataset.folderId = item.id;
      folderRow.style.marginLeft = `calc(var(--tree-indent) * ${depth})`;

      // Arrow (collapse/expand toggle)
      const folderArrow = document.createElement("span");
      folderArrow.className = "folder-arrow";
      folderArrow.innerHTML = iconSvg(item.collapsed ? "chevron-right" : "chevron-down");
      folderArrow.style.cursor = "pointer";
      folderArrow.style.flexShrink = "0";
      folderArrow.onclick = async () => {
        item.collapsed = !item.collapsed;
        await fetch('/update_folder_state', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            section: sectionName,
            state: sectionName === 'prompts'
              ? state.global.prompts
              : sectionName === 'system'
                ? state.global.system
                : state.project[sectionName]
          })
        });
        renderLists();
      };
      folderRow.appendChild(folderArrow);

      // Selection checkbox (skip for prompts — single-select only)
      if (sectionName !== "prompts") {
        const folderCheckbox = document.createElement("input");
        folderCheckbox.type = "checkbox";
        const folderState = getFolderSelectionState(item.items || [], sectionName);
        if (folderState === "full") {
          folderCheckbox.checked = true;
        } else if (folderState === "partial") {
          folderCheckbox.indeterminate = true;
        }
        folderCheckbox.onchange = () => {
          const shouldSelect = folderCheckbox.checked;
          setFolderSelection(item.items || [], sectionName, shouldSelect);
          saveSelections();
          renderLists();
          updateTokenMeter();
        };
        folderRow.appendChild(folderCheckbox);
      }

      // Title
      const folderLabel = document.createElement("span");

      folderLabel.className = "tree-label";
      const folderText = document.createElement("span");
      folderText.className = "tree-text";
      folderText.textContent = item.title;
      folderLabel.append(treeIcon(item.collapsed ? "folder" : "folder-open"), folderText);
      if (
        shouldShowCounts(sectionName) &&
        shouldShowFolderTotals()
      ) {

        const total =
          getFolderWordCount(item.items);

        const countSpan =
          document.createElement("span");

        countSpan.classList.add("word-count");

        if (total === null) {
          countSpan.textContent = " (?)";
        }
        else if (total > 0) {
          countSpan.textContent =
            ` (${total.toLocaleString()})`;
        }

        folderText.appendChild(countSpan);
      }
      folderLabel.style.cursor = "pointer";
      folderLabel.onclick = async () => {
        item.collapsed = !item.collapsed;
        await fetch('/update_folder_state', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            section: sectionName,
            state: sectionName === 'prompts'
              ? state.global.prompts
              : sectionName === 'system'
                ? state.global.system
                : state.project[sectionName]
          })
        });
        renderLists();
      };
      folderRow.appendChild(folderLabel);

      const menuBtn =
        document.createElement("span");
      menuBtn.innerHTML = iconSvg("ellipsis");
      menuBtn.classList.add("menu-btn");
      menuBtn.onclick = (e) => {
        e.stopPropagation();
        toggleFolderMenu(
          folderRow,
          sectionName,
          item
        );
      };

      folderRow.appendChild(menuBtn);

      // FOLDER DRAG START/END (for reordering folders)
      folderRow.addEventListener('dragstart', (e) => {
        e.stopPropagation();
        draggedRow = folderRow;
        folderRow.classList.add('dragging');
        e.dataTransfer.setData('folder-id', item.id);
        e.dataTransfer.setData('section', sectionName);
      });

      folderRow.addEventListener('dragend', () => {
        folderRow.classList.remove('dragging');
        draggedRow = null;
        document.querySelectorAll('.file-row, .folder-row').forEach(r => {
          r.classList.remove('drag-over-top', 'drag-over-bottom', 'drag-over-folder');
        });
      });

      // FOLDER DRAG OVER — highlight as drop target (file→folder) or top/bottom (folder reorder)
      folderRow.addEventListener('dragover', (e) => {
        e.preventDefault();
        e.stopPropagation();
        document.querySelectorAll('.folder-row, .file-row').forEach(r => {
          r.classList.remove('drag-over-folder', 'drag-over-top', 'drag-over-bottom');
        });

        const draggedFolderId = draggedRow?.dataset?.folderId;
        if (draggedFolderId) {
          // Folder being dragged over another folder — show top/bottom reorder indicator
          if (draggedFolderId === item.id) return;
          const rect = folderRow.getBoundingClientRect();
          const midpoint = rect.top + rect.height / 2;
          if (e.clientY < midpoint) {
            folderRow.classList.add('drag-over-top');
          } else {
            folderRow.classList.add('drag-over-bottom');
          }
        } else {
          // File being dragged over folder — highlight as "move into"
          folderRow.classList.add('drag-over-folder');
        }
      });

      folderRow.addEventListener('dragleave', () => {
        folderRow.classList.remove('drag-over-folder', 'drag-over-top', 'drag-over-bottom');
      });

      // DROP on folder — either move file into this folder, or reorder this folder
      folderRow.addEventListener('drop', async (e) => {
        e.preventDefault();
        e.stopPropagation();
        folderRow.classList.remove('drag-over-folder', 'drag-over-top', 'drag-over-bottom');

        const draggedSection = e.dataTransfer.getData('section');
        const draggedFolderId = e.dataTransfer.getData('folder-id');

        if (draggedSection !== sectionName) {
          if (draggedFolderId) {
            showToast("Folders move only within their own section.", "info");
            return;
          }
          const otherFile = e.dataTransfer.getData('text/plain');
          if (otherFile) {
            await moveFileToSection(draggedSection, sectionName, otherFile, { folderId: item.id });
          }
          return;
        }

        if (draggedFolderId) {
          if (draggedFolderId === item.id) return;
          const rect = folderRow.getBoundingClientRect();
          const position = e.clientY < rect.top + rect.height / 2 ? "before" : "after";
          await moveFolderTo(sectionName, draggedFolderId, null, item.id, position);
          return;
        }

        const draggedFilename = e.dataTransfer.getData('text/plain');
        if (!draggedFilename) return;
        await moveFileTo(sectionName, draggedFilename, null, null, item.id);
      });

      container.appendChild(folderRow);

      if (!item.collapsed) {
        renderSection(
          container,
          item.items,
          sectionName,
          depth + 1,
          true
        );
      }
      continue;
    }

    // Legacy string support
    if (typeof item === "string") {

      item = {
        type: "file",
        filename: item,
        title: item
      };
    }

    // Legacy object support
    if (!item.type && item.filename) {

      item = {
        type: "file",
        filename: item.filename,
        title: item.title || item.filename
      };
    }

    if (item.type !== "file") {
      continue;
    }
    const filename = item.filename;
    const title =
      item.title || item.filename;
    if (item.filename === "17.json") {
    }

    const row = document.createElement('div');
    row.classList.add('file-row');
    row.style.marginLeft =
      `calc(var(--tree-indent) * ${depth})`;

    row.draggable = true;
    row.dataset.section = sectionName;
    row.dataset.filename = filename;


    // ✅ Highlight if active
    if (
      currentFile.section === sectionName &&
      currentFile.filename === filename
    ) {
      row.classList.add('active-file');
    }

    const input = document.createElement('input');

    if (sectionName === "prompts") {
      input.type = "radio";
      input.name = "promptSelect";
      input.checked = selected.prompt === filename;
    } else {
      input.type = "checkbox";
      input.checked = selected[sectionName].has(filename);
    }

    input.onchange = () => {
      if (sectionName === "prompts") {
        selected.prompt = filename;
        loadPromptIntoBox(filename);
      } else {
        if (input.checked) {
          selected[sectionName].add(filename);
        } else {
          selected[sectionName].delete(filename);
        }
        }
      saveSelections();
      renderLists();
      updateTokenMeter();
    };


    const label = document.createElement('span');
    label.className = "tree-label";
    label.style.cursor = "pointer";

    label.appendChild(treeIcon(documentIconName(sectionName)));
    const labelText = document.createElement("span");
    labelText.className = "tree-text";
    labelText.appendChild(
      document.createTextNode(title)
    );
    label.appendChild(labelText);
    if (shouldShowCounts(sectionName)) {

      const countSpan =
        document.createElement("span");

      countSpan.classList.add("word-count");

      if (item.wordCount == null) {

        countSpan.textContent = " (?)";
      }
      else if (item.wordCount > 0) {

        countSpan.textContent =
          ` (${item.wordCount.toLocaleString()})`;
      }

      labelText.appendChild(countSpan);
    }

    row.onclick = (e) => {
      // Prevent checkbox/radio clicks from triggering open
      if (e.target.tagName.toLowerCase() === 'input') return;
      openFile(sectionName, filename);
    };


    // Empty slot where folders have their arrow, so files line up with folders
    const arrowSlot = document.createElement("span");
    arrowSlot.className = "tree-spacer";
    row.appendChild(arrowSlot);
    row.appendChild(input);
    row.appendChild(label);

    // Ellipsis Button
    const menuBtn = document.createElement('span');
    menuBtn.innerHTML = iconSvg("ellipsis");
    menuBtn.classList.add("menu-btn");

    menuBtn.onclick = (e) => {
      e.stopPropagation();
      toggleMenu(row, sectionName, filename);
    };

    row.appendChild(menuBtn);

    // DRAG START
    row.addEventListener('dragstart', (e) => {
      draggedRow = row;
      row.classList.add('dragging');
      e.dataTransfer.setData('text/plain', filename);
      e.dataTransfer.setData('section', sectionName);
    });

    // DRAG END
    row.addEventListener('dragend', () => {
      row.classList.remove('dragging');
      draggedRow = null;
      document.querySelectorAll('.file-row, .folder-row').forEach(r => {
        r.classList.remove('drag-over-top', 'drag-over-bottom', 'drag-over-folder');
      });
    });

    // DRAG OVER
    row.addEventListener('dragover', (e) => {
      e.preventDefault();
      if (row === draggedRow) return;
      document.querySelectorAll('.file-row').forEach(r => {
        r.classList.remove('drag-over-top', 'drag-over-bottom');
      });
      const rect = row.getBoundingClientRect();
      const midpoint = rect.top + rect.height / 2;
      if (e.clientY < midpoint) {
        row.classList.add('drag-over-top');
      } else {
        row.classList.add('drag-over-bottom');
      }
    });

    // DROP on file row — insert before or after this file (root level)
    row.addEventListener('drop', async (e) => {
      e.preventDefault();
      const draggedSection = e.dataTransfer.getData('section');

      const rect = row.getBoundingClientRect();
      const position = e.clientY < rect.top + rect.height / 2 ? "before" : "after";

      const draggedFolderId = e.dataTransfer.getData('folder-id');

      if (draggedSection !== sectionName) {
        if (draggedFolderId) {
          showToast("Folders move only within their own section.", "info");
          return;
        }
        const otherFile = e.dataTransfer.getData('text/plain');
        if (otherFile) {
          await moveFileToSection(draggedSection, sectionName, otherFile, { targetFilename: filename, position });
        }
        return;
      }
      if (draggedFolderId) {
        await moveFolderTo(sectionName, draggedFolderId, filename, null, position);
        return;
      }

      const draggedFilename = e.dataTransfer.getData('text/plain');
      if (!draggedFilename || draggedFilename === filename) return;
      await moveFileTo(sectionName, draggedFilename, filename, position, null);
    });

    container.appendChild(row);
  }
}


function toggleFolderMenu(
  row,
  section,
  folder
) {

  document
    .querySelectorAll('.file-menu')
    .forEach(m => m.remove());

  const rect =
    row.getBoundingClientRect();

  const menu =
    document.createElement('div');

  menu.classList.add('file-menu');

  // ---------- Add File ----------

  const addFile =
    document.createElement('div');

  addFile.textContent =
    "Add File";

  addFile.onclick = async () => {

    const title =
      prompt("Enter title:");

    if (!title) return;

    const res =
      await fetch(
        '/create_item_in_folder',
        {
          method: 'POST',
          headers: {
            'Content-Type':
              'application/json'
          },
          body: JSON.stringify({
            section,
            folder_id: folder.id,
            title
          })
        }
      );

    const data =
      await res.json();

    if (
      data.status === "created"
    ) {

      await loadAll();

      await openFile(
        section,
        data.filename
      );

    } else {

      showToast(
        data.error ||
        "Error creating file"
      );
    }

    menu.remove();
  };

  // ---------- Rename Folder ----------

  const rename =
    document.createElement('div');

  rename.textContent =
    "Rename Folder";

  rename.onclick = async () => {

    const newTitle =
      prompt(
        "New folder name:",
        folder.title
      );

    if (!newTitle) return;

    const res =
      await fetch(
        '/rename_folder',
        {
          method: 'POST',
          headers: {
            'Content-Type':
              'application/json'
          },
          body: JSON.stringify({
            section,
            folder_id: folder.id,
            title: newTitle
          })
        }
      );

    const data =
      await res.json();

    if (
      data.status === "renamed"
    ) {

      await loadAll();

    } else {

      showToast(
        data.error ||
        "Rename failed"
      );
    }

    menu.remove();
  };

  // ---------- Delete Folder ----------

  const del =
    document.createElement('div');

  del.textContent =
    "Delete Folder";

  del.onclick = async () => {

    if (
      !confirm(
        `Delete folder "${folder.title}"?`
      )
    ) {
      return;
    }

    const res =
      await fetch(
        '/delete_folder',
        {
          method: 'POST',
          headers: {
            'Content-Type':
              'application/json'
          },
          body: JSON.stringify({
            section,
            folder_id: folder.id
          })
        }
      );

    const data =
      await res.json();

    if (
      data.status === "deleted"
    ) {

      await loadAll();

    } else {

      showToast(
        data.error ||
        "Delete failed"
      );
    }

    menu.remove();
  };

  menu.appendChild(addFile);
  menu.appendChild(rename);
  menu.appendChild(del);

  document.body.appendChild(menu);

  const menuRect =
    menu.getBoundingClientRect();

  let top = rect.bottom;

  let left =
    rect.right - menuRect.width;

  if (
    rect.bottom + menuRect.height >
    window.innerHeight
  ) {
    top =
      rect.top - menuRect.height;
  }

  if (top < 0) top = 10;

  if (
    left + menuRect.width >
    window.innerWidth
  ) {
    left =
      window.innerWidth -
      menuRect.width -
      10;
  }

  menu.style.top =
    `${top}px`;

  menu.style.left =
    `${left}px`;

  setTimeout(() => {

    document.addEventListener(
      'click',
      () => menu.remove(),
      { once: true }
    );

  }, 0);
}

function removeFileFromTree(items, filename) {
  const result = [];
  for (const item of items) {
    if (item.type === "folder") {
      result.push({
        ...item,
        items: removeFileFromTree(item.items || [], filename)
      });
    } else if (getFilename(item) === filename) {
      // drop it
    } else {
      result.push(item);
    }
  }
  return result;
}

function findFileItemInTree(items, filename) {
  for (const item of items) {
    if (item.type === "folder") {
      const found = findFileItemInTree(item.items || [], filename);
      if (found) return found;
    } else if (getFilename(item) === filename) {
      return item;
    }
  }
  return null;
}

async function moveFileTo(sectionName, draggedFilename, targetFilename, position, targetFolderId) {
  // Get the right state array
  const isGlobal = sectionName === 'prompts' || sectionName === 'system';
  const stateArr = isGlobal ? state.global[sectionName] : state.project[sectionName];

  // Find the file object being moved
  const fileObj = findFileItemInTree(stateArr, draggedFilename);
  if (!fileObj) return;

  // Ensure it has type
  const fileItem = {
    type: "file",
    filename: fileObj.filename || fileObj,
    title: fileObj.title || fileObj.filename || fileObj
  };

  // Remove from wherever it currently is
  const cleaned = removeFileFromTree(stateArr, draggedFilename);

  // Insert into new location
  function insertInto(items) {
    if (targetFolderId) {
      return items.map(item => {
        if (item.type === "folder" && item.id === targetFolderId) {
          return { ...item, items: [...(item.items || []), fileItem] };
        }
        if (item.type === "folder") {
          return { ...item, items: insertInto(item.items || []) };
        }
        return item;
      });
    }

    // Insert relative to targetFilename — search recursively
    const result = [];
    let foundHere = false;

    for (const item of items) {
      if (item.type === "folder") {
        const newFolderItems = insertInto(item.items || []);
        // Detect if insertion happened inside this folder by checking length change
        if (newFolderItems.length !== (item.items || []).length) {
          foundHere = true;
        }
        result.push({ ...item, items: newFolderItems });
        continue;
      }
      if (getFilename(item) === targetFilename) {
        if (position === "before") {
          result.push(fileItem);
          result.push(item);
        } else {
          result.push(item);
          result.push(fileItem);
        }
        foundHere = true;
      } else {
        result.push(item);
      }
    }

    // Only append at this level if nothing matched anywhere below
    if (!foundHere && items === cleaned) {
      result.push(fileItem);
    }

    return result;
  }

  const newState = insertInto(cleaned);

  // Update local state
  if (isGlobal) {
    state.global[sectionName] = newState;
  } else {
    state.project[sectionName] = newState;
  }

  // Persist
  await fetch('/update_folder_state', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ section: sectionName, state: newState })
  });

  renderLists();
}


function removeFolderFromTree(items, folderId) {
  const result = [];
  for (const item of items) {
    if (item.type === "folder" && item.id === folderId) {
      continue; // drop it
    } else if (item.type === "folder") {
      result.push({
        ...item,
        items: removeFolderFromTree(item.items || [], folderId)
      });
    } else {
      result.push(item);
    }
  }
  return result;
}

function findFolderInTree(items, folderId) {
  for (const item of items) {
    if (item.type === "folder") {
      if (item.id === folderId) return item;
      const found = findFolderInTree(item.items || [], folderId);
      if (found) return found;
    }
  }
  return null;
}

async function moveFolderTo(sectionName, draggedFolderId, targetFilename, targetFolderIdForFile, position) {
  const isGlobal = sectionName === 'prompts' || sectionName === 'system';
  const stateArr = isGlobal ? state.global[sectionName] : state.project[sectionName];

  const folderObj = findFolderInTree(stateArr, draggedFolderId);
  if (!folderObj) return;

  // Only support reordering at the SAME level as the target (root level for now)
  const cleaned = removeFolderFromTree(stateArr, draggedFolderId);

  const result = [];
  let inserted = false;
  for (const item of cleaned) {
    const isTargetFile = item.type === "file" && getFilename(item) === targetFilename;
    const isTargetFolder = item.type === "folder" && item.id === targetFolderIdForFile;

    if ((isTargetFile || isTargetFolder)) {
      if (position === "before") {
        result.push(folderObj);
        result.push(item);
      } else {
        result.push(item);
        result.push(folderObj);
      }
      inserted = true;
    } else {
      result.push(item);
    }
  }
  if (!inserted) {
    result.push(folderObj);
  }

  if (isGlobal) {
    state.global[sectionName] = result;
  } else {
    state.project[sectionName] = result;
  }

  await fetch('/update_folder_state', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ section: sectionName, state: result })
  });

  renderLists();
}

async function saveSectionOrder(sectionName) {
  const containerMap = {
    prompts: 'promptsList',
    system: 'systemList',
    background: 'backgroundList',
    writing: 'writingList'
  };

  const container =
    document.getElementById(containerMap[sectionName]);

  const rows = container.querySelectorAll('.file-row');

  const reordered = Array.from(rows).map(row => {
    const filename = row.dataset.filename;

    const source =
      sectionName === 'prompts' || sectionName === 'system'
        ? state.global[sectionName]
        : state.project[sectionName];

    return source.find(item => {
      return getFilename(item) === filename;
    });
  });

  // Update local state immediately
  if (sectionName === 'prompts' || sectionName === 'system') {
    state.global[sectionName] = reordered;
  } else {
    state.project[sectionName] = reordered;
  }

  // Persist backend
  await fetch('/save_order', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      section: sectionName,
      items: reordered
    })
  });
}


// ---- Ellipsis Menu Logic ----
function toggleMenu(row, section, filename) {
  // Remove any existing menus
  document.querySelectorAll('.file-menu').forEach(m => m.remove());

  const rect = row.getBoundingClientRect();

  const menu = document.createElement('div');
  menu.classList.add('file-menu');

  // --- CONTENT ---

  const rename = document.createElement('div');
  rename.textContent = "Rename";
  rename.onclick = async () => {
    const newTitle = prompt("New name:");
    if (!newTitle) return;

    const res = await fetch('/rename_item', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ section, filename, title: newTitle })
    });

    const data = await res.json();

    if (data.status === "renamed") {

      if (
        currentFile.section === section &&
        currentFile.filename === filename
      ) {
        currentFile.filename = data.filename;

        await openFile(
          currentFile.section,
          currentFile.filename
        );
      }

      await loadAll();

    } else {
      showToast(data.error);
    }
  };

  const del = document.createElement('div');
  del.textContent = "Delete";
  del.onclick = async () => {
    if (!confirm("Delete this file?")) return;

    const res = await fetch('/delete_item', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ section, filename })
    });

    const data = await res.json();
    if (data.status === "deleted") {
      const deletedWasCurrent =
        currentFile.section === section &&
        currentFile.filename === filename;

      // Clear last_opened pointers before loadAll tries to restore them
      if (state.global.last_opened_global?.filename === filename) {
        state.global.last_opened_global = {};
      }
      if (state.project.last_opened_project?.filename === filename) {
        state.project.last_opened_project = {};
      }

      await loadAll();

      // If deleted file was active,
      // load a sensible replacement
      if (deletedWasCurrent) {

        let replacement = null;

        // Determine source list
        let source;

        if (section === "prompts" || section === "system") {
          source = state.global[section];
        } else {
          source = state.project[section];
        }

        // Try first remaining file (skip folders, search recursively)
        if (source && source.length > 0) {
          const allFiles = collectFilenames(source);
          if (allFiles.length > 0) {
            replacement = { filename: allFiles[0] };
          }
        }

        if (replacement) {
          const newFilename =
            typeof replacement === "string"
              ? replacement
              : replacement.filename;

          await openFile(section, newFilename);

        } else {

          // Fully clear editor state safely
          currentFile = {
            section: null,
            filename: null
          };

          titleInput.value = "";
          editor.value = "";
          schedulePreviewRender();

          isDirty = false;

          renderLists();
          updateTokenMeter();
        }
      }

    } else {

      showToast(data.error);
    }
  };

  const history = document.createElement('div');
  history.textContent = "Version history…";
  history.onclick = () => openHistory(section, filename);

  menu.appendChild(rename);
  menu.appendChild(history);
  menu.appendChild(del);

  // --- POSITIONING LOGIC ---

  document.body.appendChild(menu);

  const menuRect = menu.getBoundingClientRect();

  let top = rect.bottom;
  let left = rect.right - menuRect.width;

  // If not enough space below → open upward
  if (rect.bottom + menuRect.height > window.innerHeight) {
    top = rect.top - menuRect.height;
  }

  // If still offscreen top → clamp
  if (top < 0) top = 10;

  // Prevent right overflow
  if (left + menuRect.width > window.innerWidth) {
    left = window.innerWidth - menuRect.width - 10;
  }

  menu.style.top = `${top}px`;
  menu.style.left = `${left}px`;

  // Close on click outside
  setTimeout(() => {
    document.addEventListener('click', () => {
      menu.remove();
    }, { once: true });
  }, 0);
}

// Words inside quotation marks ("…" or “…”). A quote still open at the end of a
// paragraph counts to that paragraph's end: the usual way speech runs on.
function countDialogueWords(text) {
  let words = 0;
  for (const paragraph of text.split("\n")) {
    let inQuote = false;
    let spoken = "";
    for (const ch of paragraph) {
      if (!inQuote && (ch === "\u201C" || ch === '"')) {
        inQuote = true;
      } else if (inQuote && (ch === "\u201D" || ch === '"')) {
        inQuote = false;
        spoken += " ";
      } else if (inQuote) {
        spoken += ch;
      }
    }
    const said = spoken.trim();
    if (said) words += said.split(/\s+/).length;
  }
  return words;
}

function updateWordCount() {
  const text = editor.value.trim();
  const count = text === "" ? 0 : text.split(/\s+/).length;
  document.getElementById("wordCount").textContent = `${count.toLocaleString()} words`;

  const dialogue = count === 0 ? 0 : countDialogueWords(text);
  const dialogueEl = document.getElementById("dialoguePercent");
  dialogueEl.textContent = count === 0 ? "" : `${Math.round((dialogue / count) * 100)}% dialogue`;
  dialogueEl.dataset.tip = `${dialogue.toLocaleString()} of ${count.toLocaleString()} words are in quotes`;
  document.getElementById("readingTime").textContent =
    count === 0 ? "" : `${Math.max(1, Math.round(count / 230))} min read`;
  schedulePreviewRender();
  updateStatusBar();
}


// =====================
// SIDEBAR, ZEN MODE, STATUS BAR
// =====================

let lastSavedAt = null;

function setSidebarCollapsed(collapsed) {
  document.body.classList.toggle("sidebar-collapsed", collapsed);
  document.getElementById("sidebarToggle").setAttribute("aria-pressed", String(!collapsed));

  try {
    localStorage.setItem("sjb_sidebar_collapsed", collapsed ? "1" : "0");
  } catch (e) {}
}

function toggleSidebar() {
  setSidebarCollapsed(!document.body.classList.contains("sidebar-collapsed"));
}

function setZen(on) {
  document.body.classList.toggle("zen", on);
  document.getElementById("zenToggle").setAttribute("aria-pressed", String(on));
  if (!on && !previewOn) editor.focus();
}

function toggleZen() {
  setZen(!document.body.classList.contains("zen"));
}

function timeAgo(time) {
  const seconds = Math.round((Date.now() - time) / 1000);
  if (seconds < 10) return "just now";
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  return new Date(time).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

// With no file open, typing in the editor would go nowhere: show the empty state instead.
// Waits for startup, so it does not flash while the last file reopens.
let appReady = false;

function updateEmptyState() {
  if (!appReady) return;
  document.body.classList.toggle("no-document", !currentFile.filename);
}

function updateStatusBar() {
  updateEmptyState();
  const project = document.getElementById("currentProjectLabel")
    .textContent.trim();
  const file = currentFile.filename ? (titleInput.value || "Untitled") : "";
  document.getElementById("statusLocation").textContent =
    file ? `${project} › ${file}` : project;

  const saveStatus = document.getElementById("saveStatus");
  if (!currentFile.filename) {
    saveStatus.textContent = "";
  } else if (isDirty) {
    saveStatus.textContent = "Unsaved";
    saveStatus.dataset.state = "dirty";
  } else {
    saveStatus.textContent = lastSavedAt ? `Saved · ${timeAgo(lastSavedAt)}` : "Saved";
    saveStatus.dataset.state = "saved";
  }
}

// Keeps "Saved · 2 min ago" current and catches title edits
setInterval(updateStatusBar, 2000);

// Open every folder above the current file so its highlight is visible
async function revealActiveFile() {
  const { section, filename } = currentFile;
  if (!section || !filename) return;

  const tree = (section === "prompts" || section === "system")
    ? state.global[section]
    : state.project[section];

  let changed = false;

  const openPath = (items) => {
    for (const item of items || []) {
      if (item && item.type === "folder") {
        if (openPath(item.items)) {
          if (item.collapsed) {
            item.collapsed = false;
            changed = true;
          }
          return true;
        }
      } else if (item === filename || item?.filename === filename) {
        return true;
      }
    }
    return false;
  };

  openPath(tree);

  if (changed) {
    await fetch('/update_folder_state', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ section, state: tree })
    });
    await renderLists();
  }

  document.querySelector(".file-row.active-file")?.scrollIntoView({ block: "nearest" });
}


// =====================
// MARKDOWN PREVIEW
// =====================

const preview = document.getElementById("preview");
const IMAGE_URL = /\.(png|jpe?g|gif|webp|svg|avif)(\?.*)?$/i;
let previewOn = false;
let previewFrame = null;

function renderPreview() {
  previewFrame = null;

  const html = marked.parse(editor.value, { gfm: true, breaks: true });
  preview.innerHTML = DOMPurify.sanitize(html);

  preview.querySelectorAll("a[href]").forEach(a => {
    const href = a.getAttribute("href");

    // A plain link straight to an image file shows the image
    if (IMAGE_URL.test(href) && !a.querySelector("img")) {
      const img = document.createElement("img");
      img.src = href;
      img.alt = a.textContent;
      a.textContent = "";
      a.appendChild(img);
    }

    // Open links in a new tab so the app never navigates away
    a.target = "_blank";
    a.rel = "noopener noreferrer";
  });

  // Match the editor's chosen font
  preview.style.fontFamily = editor.style.fontFamily;
  preview.style.fontSize = editor.style.fontSize;
}

// Re-render at most once per frame (generation streams many small chunks)
function schedulePreviewRender() {
  if (!previewOn || previewFrame) return;
  previewFrame = requestAnimationFrame(renderPreview);
}

function setPreview(on) {
  previewOn = on;
  if (on) renderPreview();

  editor.classList.toggle("hidden", on);
  preview.classList.toggle("hidden", !on);
  document.getElementById("previewToggle").setAttribute("aria-pressed", String(on));
  document.querySelectorAll(".formatting .md-tool").forEach(btn => {
    btn.disabled = on;
  });

  try {
    localStorage.setItem("sjb_preview", on ? "1" : "0");
  } catch (e) {}

  if (!on) editor.focus();
}

function togglePreview() {
  setPreview(!previewOn);
}

preview.addEventListener("dblclick", () => setPreview(false));

// =====================
// SIDEBAR: SORT, FOLD, SECTION ORDER, MOVES BETWEEN SECTIONS
// =====================

const SECTION_LABELS = {
  prompts: "Prompts",
  system: "System",
  background: "Background",
  writing: "Writing"
};

const SORT_MODES = ["manual", "az", "za"];
const SORT_INFO = {
  manual: { icon: "arrow-up-down", tip: "Sort: My order" },
  az: { icon: "arrow-down-a-z", tip: "Sort: A–Z" },
  za: { icon: "arrow-down-z-a", tip: "Sort: Z–A" }
};

// Per-viewer sidebar preferences live in localStorage
function readPref(key, fallback) {
  try {
    return JSON.parse(localStorage.getItem(key)) ?? fallback;
  } catch (e) {
    return fallback;
  }
}

function writePref(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (e) {}
}

function getSort(section) {
  return readPref("sjb_sort", {})[section] || "manual";
}

// Sorting only changes the view; the saved hand-made order stays as it is
function sortForView(items, section) {
  const mode = getSort(section);
  if (mode === "manual") return items;

  const title = item => (typeof item === "string" ? item : item.title || item.filename || "");
  const byTitle = (a, b) => title(a).localeCompare(title(b), undefined, { numeric: true, sensitivity: "base" });
  const folders = items.filter(i => i?.type === "folder").sort(byTitle);
  const files = items.filter(i => i?.type !== "folder").sort(byTitle);
  if (mode === "za") {
    folders.reverse();
    files.reverse();
  }
  return [...folders, ...files];
}

function updateSortButtons() {
  document.querySelectorAll(".sort-btn").forEach(btn => {
    const info = SORT_INFO[getSort(btn.dataset.sortSection)];
    btn.innerHTML = iconSvg(info.icon);
    btn.dataset.tip = info.tip;
    btn.setAttribute("aria-label", info.tip);
    btn.classList.toggle("is-sorted", info !== SORT_INFO.manual);
  });
}

async function cycleSort(section) {
  const sorts = readPref("sjb_sort", {});
  const next = SORT_MODES[(SORT_MODES.indexOf(getSort(section)) + 1) % SORT_MODES.length];
  sorts[section] = next;
  writePref("sjb_sort", sorts);
  updateSortButtons();
  await renderLists();
}

function sectionEl(section) {
  return document.querySelector(`.section[data-weight="${section}"]`);
}

function applySectionFolds() {
  const folded = readPref("sjb_folded_sections", []);
  Object.keys(SECTION_LABELS).forEach(section => {
    const isFolded = folded.includes(section);
    sectionEl(section)?.classList.toggle("folded", isFolded);
    sectionEl(section)?.querySelector(".section-toggle")
      ?.setAttribute("aria-expanded", String(!isFolded));
  });
}

function toggleSectionFold(section) {
  const folded = new Set(readPref("sjb_folded_sections", []));
  folded.has(section) ? folded.delete(section) : folded.add(section);
  writePref("sjb_folded_sections", [...folded]);
  applySectionFolds();
}

// Sections reorder within their group (Prompts/System, Background/Writing)
function applySectionOrder() {
  const order = readPref("sjb_section_order", []);
  order.forEach(section => {
    const el = sectionEl(section);
    el?.parentElement.appendChild(el);
  });
}

function saveSectionPositions() {
  writePref(
    "sjb_section_order",
    [...document.querySelectorAll(".section[data-weight]")].map(el => el.dataset.weight)
  );
}

function initSectionHeaders() {
  document.querySelectorAll(".section-header").forEach(header => {
    const section = header.dataset.section;
    const el = sectionEl(section);

    header.addEventListener("dragstart", (e) => {
      // Rows inside the section start their own drags
      if (e.target !== header) return;
      e.dataTransfer.setData("application/x-sjb-section", section);
      e.dataTransfer.effectAllowed = "move";
      el.classList.add("dragging-section");
    });

    header.addEventListener("dragend", () => {
      el.classList.remove("dragging-section");
      document.querySelectorAll(".section-header").forEach(h => {
        h.classList.remove("drop-before", "drop-after", "drop-into");
      });
    });

    header.addEventListener("dragover", (e) => {
      const types = [...e.dataTransfer.types];
      if (types.includes("application/x-sjb-section")) {
        e.preventDefault();
        const rect = header.getBoundingClientRect();
        const before = e.clientY < rect.top + rect.height / 2;
        header.classList.toggle("drop-before", before);
        header.classList.toggle("drop-after", !before);
      } else if (types.includes("text/plain")) {
        // A file dropped on a header lands at the top level of that section
        e.preventDefault();
        header.classList.add("drop-into");
      }
    });

    header.addEventListener("dragleave", () => {
      header.classList.remove("drop-before", "drop-after", "drop-into");
    });

    header.addEventListener("drop", async (e) => {
      e.preventDefault();
      header.classList.remove("drop-before", "drop-after", "drop-into");

      const draggedSection = e.dataTransfer.getData("application/x-sjb-section");
      if (draggedSection) {
        const dragged = sectionEl(draggedSection);
        if (draggedSection === section || dragged.parentElement !== el.parentElement) {
          if (dragged.parentElement !== el.parentElement) {
            showToast("Prompts and System are shared by all projects, so they stay apart from Background and Writing.", "info");
          }
          return;
        }
        const rect = header.getBoundingClientRect();
        const before = e.clientY < rect.top + rect.height / 2;
        el.parentElement.insertBefore(dragged, before ? el : el.nextSibling);
        saveSectionPositions();
        return;
      }

      const filename = e.dataTransfer.getData("text/plain");
      const fromSection = e.dataTransfer.getData("section");
      if (filename && e.dataTransfer.getData("folder-id")) return;
      if (filename && fromSection === section) {
        await moveFileTo(section, filename, null, null, null);
      } else if (filename && fromSection) {
        await moveFileToSection(fromSection, section, filename);
      }
    });
  });
}

// Move a file to another section: on disk, with its history, into the dropped spot
async function moveFileToSection(fromSection, toSection, filename, opts = {}) {
  const wasOpen = currentFile.section === fromSection && currentFile.filename === filename;
  if (wasOpen && isDirty) await saveCurrentFile();

  const res = await fetch('/move_file_section', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from_section: fromSection,
      section: toSection,
      filename,
      folder_id: opts.folderId || null,
      target_filename: opts.targetFilename || null,
      position: opts.position || "after"
    })
  });
  const data = await res.json();

  if (!res.ok) {
    showToast(data.error || "Move failed");
    return;
  }

  // Checkbox and prompt selections do not follow the file across sections
  if (fromSection === "prompts") {
    if (selected.prompt === filename) selected.prompt = null;
  } else {
    selected[fromSection]?.delete(filename);
  }
  saveSelections();
  delete fileCache[`${fromSection}/${filename}`];

  if (wasOpen) {
    currentFile.section = toSection;
    await fetch('/opened_file', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ section: toSection, filename })
    });
  }

  await loadAll();
  showToast(`Moved to ${SECTION_LABELS[toSection]}.`, "info");
}


// =====================
// CLOSE THE DOCUMENT (title-row × and the app logo)
// =====================

// Saves first, then shows the empty state; remembered per project across reloads
async function closeDocument() {
  if (!currentFile.filename) return;
  if (isGenerating) {
    showToast("Please wait for generation to finish.", "info");
    return;
  }
  if (isDirty) await saveCurrentFile();

  currentFile = {
    section: null,
    filename: null
  };
  titleInput.value = "";
  editor.value = "";
  isDirty = false;
  lastSavedAt = null;
  writePref(`sjb_doc_closed_${currentProject}`, true);

  updateWordCount();
  updateTokenMeter();
  await renderLists();
}


// =====================
// RESIZABLE SIDEBAR AND AI PANEL (drag the inner edge, double-click to reset)
// =====================

const PANEL_SIZES = {
  sidebar: { min: 200, max: 520, cssVar: "--sidebar-w", pref: "sjb_sidebar_w" },
  ai: { min: 240, max: 520, cssVar: "--ai-panel-w", pref: "sjb_ai_panel_w" }
};
const EDITOR_MIN_WIDTH = 360;

function applyPanelWidth(name, px) {
  const { cssVar } = PANEL_SIZES[name];
  if (px == null) document.documentElement.style.removeProperty(cssVar);
  else document.documentElement.style.setProperty(cssVar, `${px}px`);
}

function initPanelResize() {
  for (const [name, size] of Object.entries(PANEL_SIZES)) {
    applyPanelWidth(name, readPref(size.pref, null));
  }

  document.querySelectorAll(".resize-handle").forEach(handle => {
    const name = handle.dataset.resize;
    const size = PANEL_SIZES[name];
    const panel = handle.parentElement;
    const otherPanel = document.querySelector(name === "sidebar" ? ".ai-panel" : ".left");
    let width = null;

    const onMove = (e) => {
      const rect = panel.getBoundingClientRect();
      const wanted = name === "sidebar" ? e.clientX - rect.left : rect.right - e.clientX;
      // Never squeeze the editor below its minimum
      const room = window.innerWidth - otherPanel.getBoundingClientRect().width - EDITOR_MIN_WIDTH;
      width = Math.round(Math.max(size.min, Math.min(size.max, room, wanted)));
      applyPanelWidth(name, width);
    };

    const onUp = () => {
      handle.removeEventListener("pointermove", onMove);
      handle.classList.remove("dragging");
      document.body.classList.remove("is-resizing");
      if (width != null) writePref(size.pref, width);
    };

    handle.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      width = null;
      handle.setPointerCapture(e.pointerId);
      handle.classList.add("dragging");
      document.body.classList.add("is-resizing");
      handle.addEventListener("pointermove", onMove);
      handle.addEventListener("pointerup", onUp, { once: true });
      handle.addEventListener("pointercancel", onUp, { once: true });
    });

    handle.addEventListener("dblclick", () => {
      applyPanelWidth(name, null);
      writePref(size.pref, null);
    });
  });
}


// =====================
// TOOLBAR OVERFLOW: buttons that do not fit move into a "⋯" menu
// =====================

// Least important first; Preview and Generate always stay
const OVERFLOW_GROUPS = {
  formatting: {
    bar: ".formatting",
    hideOrder: ['[aria-label="Bullet list"]', '[aria-label="Heading"]', '[aria-label="Italic"]', '[aria-label="Bold"]', "#zenToggle"]
  },
  actions: {
    bar: ".controls",
    hideOrder: ['[aria-label="Clear instruction"]', '[aria-label="Save (⌘S)"]', "#undoGenerateBtn", "#stopGenerateBtn"]
  }
};

function overflowItems(name) {
  const bar = document.querySelector(OVERFLOW_GROUPS[name].bar);
  return OVERFLOW_GROUPS[name].hideOrder.map(sel => bar.querySelector(sel)).filter(Boolean);
}

function fitToolbar(name) {
  const bar = document.querySelector(OVERFLOW_GROUPS[name].bar);
  const more = bar.querySelector(".toolbar-more");
  const fits = () => bar.scrollWidth <= bar.clientWidth + 1;

  overflowItems(name).forEach(el => el.classList.remove("is-overflowed"));
  more.classList.add("hidden");
  if (fits()) return;

  more.classList.remove("hidden");
  for (const el of overflowItems(name)) {
    el.classList.add("is-overflowed");
    if (fits()) break;
  }
}

function fitToolbars() {
  fitToolbar("formatting");
  fitToolbar("actions");
}

// Re-fit whenever the writing area changes width (window, sidebar, AI panel)
new ResizeObserver(fitToolbars).observe(document.querySelector(".right"));

function openOverflowMenu(button, name) {
  document.querySelectorAll(".file-menu").forEach(m => m.remove());

  const menu = document.createElement("div");
  menu.className = "file-menu overflow-menu";

  // Same left-to-right order as on the toolbar
  overflowItems(name)
    .filter(el => el.classList.contains("is-overflowed"))
    .reverse()
    .forEach(el => {
      const item = document.createElement("div");
      item.className = "overflow-item";
      if (el.disabled) item.classList.add("is-disabled");
      item.innerHTML = el.innerHTML;
      item.appendChild(document.createTextNode(el.getAttribute("aria-label")));
      item.onclick = () => {
        if (!el.disabled) el.click();
        menu.remove();
      };
      menu.appendChild(item);
    });

  document.body.appendChild(menu);

  // Below the toolbar button, or above it when the button sits low (AI dock)
  const rect = button.getBoundingClientRect();
  const menuRect = menu.getBoundingClientRect();
  const above = rect.top > window.innerHeight / 2;
  menu.style.top = `${above ? rect.top - menuRect.height - 4 : rect.bottom + 4}px`;
  menu.style.left = `${Math.max(8, rect.right - menuRect.width)}px`;

  setTimeout(() => {
    document.addEventListener("click", () => menu.remove(), { once: true });
  }, 0);
}


// =====================
// AI SETUP PANEL (System + Prompts, on the right)
// =====================

function setAiPanelOpen(open) {
  document.body.classList.toggle("ai-panel-open", open);
  document.getElementById("aiSummaryChip").setAttribute("aria-expanded", String(open));
  document.getElementById("aiPanelToggle").setAttribute("aria-pressed", String(open));
  writePref("sjb_ai_panel_open", open);
}

function toggleAiPanel() {
  setAiPanelOpen(!document.body.classList.contains("ai-panel-open"));
}

// "2 rules · Prompt: EPBM 3": what the AI will get, even with the panel closed
function updateAiSummary() {
  const text = document.getElementById("aiSummaryText");
  if (!text || !state.global) return;

  const rules = collectFilenames(state.global.system || [])
    .filter(f => selected.system.has(f)).length;

  let prompt = "No prompt";
  if (selected.prompt) {
    const item = findFileItemInTree(state.global.prompts || [], selected.prompt);
    prompt = `Prompt: ${item?.title || selected.prompt.replace(/\.json$/, "")}`;
  }

  const rulesText = rules === 0 ? "No rules" : rules === 1 ? "1 rule" : `${rules} rules`;
  text.textContent = `${rulesText} · ${prompt}`;
  document.getElementById("aiSummaryChip")
    .classList.toggle("is-active", rules > 0 || Boolean(selected.prompt));
  fitToolbars();
}


// =====================
// VERSION HISTORY
// =====================

let historyTarget = null;      // { section, filename } shown in the window
let historySelectedId = null;

async function openHistory(section, filename) {
  // Save first so the newest text is on disk
  if (isDirty && currentFile.section === section && currentFile.filename === filename) {
    await saveCurrentFile();
  }

  historyTarget = { section, filename };
  historySelectedId = null;
  document.getElementById("historyRestoreBtn").disabled = true;

  const preview = document.getElementById("historyPreview");
  preview.textContent = "";
  preview.style.fontFamily = editor.style.fontFamily;

  const res = await fetch('/file_history', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ section, filename })
  });
  const data = await res.json();
  const versions = data.versions || [];

  const list = document.getElementById("historyList");
  list.innerHTML = "";

  if (versions.length === 0) {
    const empty = document.createElement("div");
    empty.className = "history-empty";
    empty.textContent =
      "No earlier versions yet. The app keeps the old text each time you save a change, at most every 5 minutes.";
    list.appendChild(empty);
  }

  for (const version of versions) {
    const row = document.createElement("div");
    row.className = "history-row";

    const when = document.createElement("span");
    when.textContent = new Date(version.time).toLocaleString([], {
      month: "short", day: "numeric", hour: "numeric", minute: "2-digit"
    });

    const meta = document.createElement("span");
    meta.className = "history-meta";
    meta.textContent = `${version.words.toLocaleString()} words · ${timeAgo(new Date(version.time))}`;

    row.append(when, meta);
    row.onclick = () => selectVersion(version.id, row);
    list.appendChild(row);
  }

  document.getElementById("historyModal").classList.remove("hidden");
  list.querySelector(".history-row")?.click();
}

async function selectVersion(id, row) {
  historySelectedId = id;
  document.querySelectorAll(".history-row").forEach(r => {
    r.classList.toggle("active", r === row);
  });

  const res = await fetch('/file_version', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...historyTarget, id })
  });
  const data = await res.json();

  document.getElementById("historyPreview").textContent = data.content || "";
  document.getElementById("historyRestoreBtn").disabled = false;
}

async function restoreSelectedVersion() {
  if (!historyTarget || !historySelectedId) return;
  const { section, filename } = historyTarget;

  const res = await fetch('/restore_version', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ section, filename, id: historySelectedId })
  });
  const data = await res.json();

  if (data.status !== "restored") {
    showToast(data.error || "Restore failed");
    return;
  }

  fileCache[`${section}/${filename}`] = data.content;

  const isGlobal = section === "prompts" || section === "system";
  const item = findFileItemInTree(
    (isGlobal ? state.global[section] : state.project[section]) || [],
    filename
  );
  if (item) {
    item.title = data.title;
    item.wordCount = data.wordCount;
  }

  if (currentFile.section === section && currentFile.filename === filename) {
    titleInput.value = data.title || "";
    editor.value = data.content;
    isDirty = false;
    lastSavedAt = Date.now();
    updateWordCount();
    updateTokenMeter();
  }

  await renderLists();
  closeHistory();
}

function closeHistory() {
  document.getElementById("historyModal").classList.add("hidden");
  historyTarget = null;
  historySelectedId = null;
}


// =====================
// KEYBOARD SHORTCUTS (⌘ on Mac, Ctrl elsewhere)
// =====================
// ⌘E preview (same key as Obsidian) · ⌘S save · ⌘Enter generate
// ⌘\ sidebar · ⌘⌥\ AI setup · ⌘⇧F zen · Esc stops generation, then leaves zen

document.addEventListener("keydown", (e) => {
  if (!document.getElementById("settingsModal").classList.contains("hidden")) return;
  if (!document.getElementById("historyModal").classList.contains("hidden")) {
    if (e.key === "Escape") closeHistory();
    return;
  }

  if ((e.metaKey || e.ctrlKey) && e.altKey && e.code === "Backslash") {
    e.preventDefault();
    toggleAiPanel();
    return;
  }

  const mod = (e.metaKey || e.ctrlKey) && !e.altKey;
  const key = e.key.toLowerCase();

  if (mod && !e.shiftKey && key === "e") {
    e.preventDefault();
    togglePreview();
  } else if (mod && !e.shiftKey && key === "s") {
    e.preventDefault();
    saveCurrentFile();
  } else if (mod && !e.shiftKey && e.key === "Enter") {
    e.preventDefault();
    if (!isGenerating) generate();
  } else if (mod && !e.shiftKey && e.key === "\\") {
    e.preventDefault();
    toggleSidebar();
  } else if (mod && e.shiftKey && key === "f") {
    e.preventDefault();
    toggleZen();
  } else if (e.key === "Escape") {
    if (isGenerating) stopGeneration();
    else if (document.body.classList.contains("zen")) setZen(false);
  }
});


let settings = {
  modelSource: "openrouter",
  modelName: "",
};
let modelRegistry = {};

async function openSettings() {
  savedModelName = settings.modelName;
  savedModelSource = settings.modelSource;
  loadSettingsIntoUI();
  await loadApiKeyStatus();
  await fetchModels();
  document.getElementById("settingsModal").classList.remove("hidden");
}

function closeSettings(restoreModel = false) {
  if (restoreModel) {
    settings.modelName = savedModelName;
    settings.modelSource = savedModelSource;
  }

  document.getElementById("modelName").value =
    settings.modelName;

  updateActiveModelDisplay();
  updateTokenMeter();

  document.getElementById("settingsModal").classList.add("hidden");
}


function addModelRow() {
  showToast("Add Model UI coming next.", "info");
}


function getModelById(modelId) {
  for (const sourceModels of Object.values(modelRegistry)) {
    const found = sourceModels.find(
      m => m.id === modelId
    );

    if (found) {
      return found;
    }
  }
  return null;
}


async function saveSettings() {
  const selectedModel =
    getModelById(
      document.getElementById("modelName").value
    );
  settings.modelSource =
    selectedModel?.source || "openrouter";
  settings.modelName = document.getElementById("modelName").value;
  const apiKey = document.getElementById("apiKey").value;
  localStorage.setItem("sjb_settings", JSON.stringify({
    modelSource: settings.modelSource,
    modelName: settings.modelName
  }));
  if (apiKey) {
    await fetch('/save_api_key', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ apiKey: apiKey })
    });
  }

  const markers = {
    showOutputMarkers: document.getElementById("showOutputMarkers").checked,
    outputMarkerBefore: document.getElementById("outputMarkerBefore").value,
    outputMarkerAfter: document.getElementById("outputMarkerAfter").value
  };
  Object.assign(state.app_state, markers);
  await fetch('/save_app_state', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(markers)
  });

  updateActiveModelDisplay();
  await updateTokenMeter();
  closeSettings();
}

async function saveVisualSettings() {
  const themeMode = document.getElementById("themeModeSelect").value;
  const accent =
    document.querySelector('.accent-swatch[aria-checked="true"]')?.dataset.accent || "blue";
  const sidebarFontSize =
    document.getElementById("sidebarFontSize").value;

  applyAppearance(themeMode, accent);
  applySidebarFontSize(sidebarFontSize);

  state.app_state.themeMode = themeMode;
  state.app_state.accent = accent;
  state.app_state.sidebarFontSize = sidebarFontSize;
  state.app_state.showWritingCounts =
   document.getElementById("showWritingCounts").checked;
  state.app_state.showBackgroundCounts =
    document.getElementById("showBackgroundCounts").checked;
  state.app_state.showPromptCounts =
    document.getElementById("showPromptCounts").checked;
  state.app_state.showSystemCounts =
    document.getElementById("showSystemCounts").checked;
  state.app_state.showFolderTotals =
    document.getElementById("showFolderTotals").checked;

  await fetch('/save_app_state', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      showWritingCounts:
        state.app_state.showWritingCounts,
      showBackgroundCounts:
        state.app_state.showBackgroundCounts,
      showPromptCounts:
        state.app_state.showPromptCounts,
      showSystemCounts:
        state.app_state.showSystemCounts,
      showFolderTotals:
        state.app_state.showFolderTotals,
      themeMode: state.app_state.themeMode,
      accent: state.app_state.accent,
      sidebarFontSize: state.app_state.sidebarFontSize
    })
  });

  await renderLists();
  closeVisualPanel();
}


function loadSettings() {
  const saved = localStorage.getItem("sjb_settings");
  if (saved) {
    settings = JSON.parse(saved);
  updateActiveModelDisplay();
  }
}

function loadSettingsIntoUI() {
  document.getElementById("modelName").value = settings.modelName;
  document.getElementById("showWritingCounts").checked =
    state.app_state.showWritingCounts;
  document.getElementById("showBackgroundCounts").checked =
    state.app_state.showBackgroundCounts;
  document.getElementById("showPromptCounts").checked =
    state.app_state.showPromptCounts;
  document.getElementById("showSystemCounts").checked =
    state.app_state.showSystemCounts;
  document.getElementById("showFolderTotals").checked =
    state.app_state.showFolderTotals;
  document.getElementById("sidebarFontSize").value =
    state.app_state.sidebarFontSize || "13px";
  document.getElementById("showOutputMarkers").checked =
    state.app_state.showOutputMarkers !== false;
  document.getElementById("outputMarkerBefore").value =
    state.app_state.outputMarkerBefore ?? DEFAULT_MARKER_BEFORE;
  document.getElementById("outputMarkerAfter").value =
    state.app_state.outputMarkerAfter ?? DEFAULT_MARKER_AFTER;
}

function loadVisualSettingsIntoUI() {
  const { mode, accent } = savedAppearance();
  document.getElementById("themeModeSelect").value = mode;
  pickAccent(accent);
  document.getElementById("sidebarFontSize").value =
    state.app_state.sidebarFontSize || "13px";
}



async function loadPromptIntoBox(filename) {
  const res = await fetch('/load_file', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      section: 'prompts',
      filename: filename
    })
  });

  const data = await res.json();

  fileCache[`prompts/${filename}`] = data.content || "";

  originalPromptContent = data.content || "";
  promptBox.value = originalPromptContent;

  saveSelections();
  updateTokenMeter();
}


function saveSelections() {

  // GLOBAL selections
  const globalData = {
    system: Array.from(selected.system),
    prompt: selected.prompt
  };

  localStorage.setItem(
    "sjb_selected_global",
    JSON.stringify(globalData)
  );

  // PROJECT selections
  const projectData = {
    background: Array.from(selected.background),
    writing: Array.from(selected.writing)
  };

  localStorage.setItem(
    `sjb_selected_${currentProject}`,
    JSON.stringify(projectData)
  );

  updateAiSummary();
}



async function openFile(section, filename) {

  if (isGenerating) {
    showToast("Please wait for generation to finish before switching files.", "info");
    return;
  }

  if (isDirty) {
    await saveCurrentFile();
  }

  const res = await fetch('/load_file', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      section: section,
      filename: filename
    })
  });

  const data = await res.json();

  if (!res.ok) {
    showToast(data.error || "Failed to load file");
    return;
  }

  // ✅ Cache HERE
  fileCache[`${section}/${filename}`] = data.content || "";

  currentFile.section = section;
  currentFile.filename = filename;

  await fetch('/opened_file', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      section,
      filename
    })
  });


  titleInput.value = data.title || "";
  editor.value = data.content || "";
  isDirty = false;
  lastSavedAt = null;
  writePref(`sjb_doc_closed_${currentProject}`, false);
  saveSelections();
  await renderLists();
  await revealActiveFile();
  updateTokenMeter();
  updateWordCount();
}



let isDirty = false;
let idleTimer = null;

editor.addEventListener("input", () => {
  isDirty = true;

  if (idleTimer) clearTimeout(idleTimer);

  idleTimer = setTimeout(() => {
    if (isDirty) {
      saveCurrentFile();
    }
  }, 30000);
});


editor.addEventListener("paste", function (e) {
    e.preventDefault();

    const text =
        (e.clipboardData || window.clipboardData).getData("text/plain");

    insertAtCursor(text);

    isDirty = true;
    updateTokenMeter();
    updateWordCount();
});


titleInput.addEventListener("input", () => {
  isDirty = true;
});

titleInput.addEventListener("blur", async () => {
  if (isDirty) {
    await saveCurrentFile();
  }
});


window.addEventListener("beforeunload", (e) => {
  if (isDirty) {
    e.preventDefault();
    e.returnValue = "";
  }
});



window.onload = async () => {
  loadSettings();
  await fetchModels();
  await loadProjects();
  loadSelections();
  await loadAll();
  loadTheme();
  updateUndoButton();

  try {
    if (localStorage.getItem("sjb_preview") === "1") setPreview(true);
    if (localStorage.getItem("sjb_sidebar_collapsed") === "1") setSidebarCollapsed(true);
  } catch (e) {}

  setAiPanelOpen(readPref("sjb_ai_panel_open", false));
  initPanelResize();
  applySectionOrder();
  applySectionFolds();
  updateSortButtons();
  initSectionHeaders();

  appReady = true;
  updateStatusBar();
};