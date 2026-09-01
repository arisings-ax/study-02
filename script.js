/**
 * My Tasks - vanilla JS todo app
 *
 * Single-file app logic. State lives in the `tasks` array (persisted to
 * localStorage) plus a handful of UI state variables (filter, sort, search,
 * theme, editing/animation flags). Every state change funnels through
 * render(), which rebuilds the task list from scratch. This keeps the app
 * simple to reason about; the DocumentFragment batching and debounced
 * search/save keep that "rebuild everything" approach fast even with a
 * large number of tasks.
 */

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const STORAGE_KEY = "tasks";
const FILTER_KEY = "taskFilter";
const THEME_KEY = "theme";
const SORT_KEY = "taskSort";

const SAVE_DEBOUNCE_MS = 300; // coalesce rapid saves (e.g. quick successive toggles)
const SEARCH_DEBOUNCE_MS = 200; // avoid re-rendering on every keystroke while typing
const UNDO_TIMEOUT_MS = 6000; // how long the "undo delete" toast stays visible
const DELETE_ANIM_MS = 250; // must match the .task-exit CSS animation duration

const CATEGORY_LABELS = {
  work: "업무",
  personal: "개인",
  study: "공부",
};

// Canonical category order, reused for both the mini dashboard and the
// "카테고리순" sort mode.
const CATEGORY_ORDER = ["work", "personal", "study"];

// Alt+1..4 map to these filters, in the same order as the filter buttons.
const FILTER_SHORTCUTS = {
  1: "all",
  2: "work",
  3: "personal",
  4: "study",
};

// A small, fixed pool of quotes. One is picked deterministically per day
// (see pickQuoteOfDay) so it stays the same across reloads within a day.
const QUOTES = [
  "작은 진전도 진전이다.",
  "완벽보다 완료가 낫다.",
  "오늘 할 일을 내일로 미루지 말자.",
  "시작이 반이다.",
  "쉬운 일부터 하나씩 끝내보자.",
  "느려도 괜찮으니 멈추지만 말자.",
  "할 일을 적는 순간, 이미 절반은 해결된 것이다.",
  "완료한 일의 목록이 곧 자신감이 된다.",
];

// ---------------------------------------------------------------------------
// DOM references
// ---------------------------------------------------------------------------

const taskInput = document.getElementById("task-input");
const categorySelect = document.getElementById("category-select");
const addBtn = document.getElementById("add-btn");
const taskList = document.getElementById("task-list");
const filterBar = document.getElementById("filter-bar");
const overallCountEl = document.getElementById("overall-count");
const overallProgressFill = document.getElementById("overall-progress-fill");
const overallProgressTrack = document.getElementById("overall-progress-track");
const categoryStatsEl = document.getElementById("category-stats");
const todayCountEl = document.getElementById("today-count");
const remainingBadge = document.getElementById("remaining-badge");
const searchInput = document.getElementById("search-input");
const themeToggleInput = document.getElementById("theme-toggle-input");
const clearCompletedBtn = document.getElementById("clear-completed-btn");
const quoteOfDayEl = document.getElementById("quote-of-day");
const encouragementEl = document.getElementById("encouragement-message");
const sortSelect = document.getElementById("sort-select");
const exportBtn = document.getElementById("export-btn");
const importBtn = document.getElementById("import-btn");
const importFileInput = document.getElementById("import-file-input");
const undoToast = document.getElementById("undo-toast");
const undoToastText = document.getElementById("undo-toast-text");
const undoBtn = document.getElementById("undo-btn");
const srAnnouncer = document.getElementById("sr-announcer");

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let tasks = loadTasks();
let currentFilter = loadFilter();
let currentSort = loadSort();
let currentTheme = loadTheme();
let searchTerm = "";

let editingId = null; // id of the task currently in inline-edit mode
let enteringId = null; // id of the task that should play the "fade in" animation on next render
let togglingId = null; // id of the task that should play the "slide" animation on next render

let lastDeleted = null; // { task, index } snapshot used by the undo toast
let undoTimer = null; // setTimeout handle for auto-hiding the undo toast

let saveTimer = null; // setTimeout handle for the debounced localStorage write

// ---------------------------------------------------------------------------
// Small generic utilities
// ---------------------------------------------------------------------------

/**
 * Returns a debounced version of `fn`: calling it repeatedly only runs `fn`
 * once, after `delay` ms have passed without another call. Used to avoid
 * expensive work (re-rendering, localStorage writes) on every keystroke.
 */
function debounce(fn, delay) {
  let timer = null;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), delay);
  };
}

/** Tiny deterministic string hash (djb2), used to seed the quote of the day. */
function hashString(str) {
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = (hash * 33) ^ str.charCodeAt(i);
  }
  return Math.abs(hash);
}

/**
 * Generates a reasonably unique id. Date.now() alone can collide if two
 * tasks are created within the same millisecond (e.g. importing a file, or
 * a fast double-click), so a random suffix is appended.
 */
function generateId() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/** Announces a short message to screen readers via the aria-live region. */
function announce(message) {
  srAnnouncer.textContent = message;
}

// ---------------------------------------------------------------------------
// Persistence: tasks
// ---------------------------------------------------------------------------

/**
 * Normalizes a raw task-like object (from localStorage or an imported file)
 * into a valid task, or returns null if it can't be salvaged. This is the
 * single place that guards against corrupted/foreign data shapes.
 */
function sanitizeTask(raw) {
  if (!raw || typeof raw !== "object") return null;

  const text = typeof raw.text === "string" ? raw.text.trim() : "";
  if (!text) return null; // a task without text is meaningless

  const category = CATEGORY_ORDER.includes(raw.category) ? raw.category : "work";
  const completed = Boolean(raw.completed);

  const createdAt =
    typeof raw.createdAt === "string" && !Number.isNaN(Date.parse(raw.createdAt))
      ? raw.createdAt
      : new Date().toISOString();

  const id = typeof raw.id === "string" || typeof raw.id === "number" ? raw.id : generateId();

  return { id, text, completed, category, createdAt };
}

function loadTasks() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(parsed)) return [];
    return parsed.map(sanitizeTask).filter(Boolean);
  } catch (err) {
    // Corrupted localStorage content (manual edits, storage bugs, etc.)
    // should not crash the app - fall back to an empty list.
    console.error("할 일 데이터를 불러오지 못했습니다.", err);
    return [];
  }
}

/** Writes `tasks` to localStorage immediately (no debounce). */
function writeTasksNow() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(tasks));
  } catch (err) {
    // Most likely a quota-exceeded error. The in-memory state is still
    // correct, so the app keeps working - the user just won't see this
    // change persisted across reloads.
    console.error("할 일 데이터를 저장하지 못했습니다.", err);
    announce("저장 공간이 부족하여 변경 사항이 저장되지 못했습니다.");
  }
}

/**
 * Debounced save: batches rapid successive mutations (e.g. dragging several
 * items, or toggling many checkboxes quickly) into a single localStorage
 * write. flushSaveTasks() forces an immediate write, used before the page
 * might unload.
 */
const saveTasks = debounce(writeTasksNow, SAVE_DEBOUNCE_MS);

function flushSaveTasks() {
  writeTasksNow();
}

// Guarantee no pending debounced save is lost if the tab is closed/hidden.
window.addEventListener("beforeunload", flushSaveTasks);
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden") flushSaveTasks();
});

// ---------------------------------------------------------------------------
// Persistence: filter / sort / theme
// ---------------------------------------------------------------------------

function loadFilter() {
  return localStorage.getItem(FILTER_KEY) || "all";
}

function saveFilter() {
  localStorage.setItem(FILTER_KEY, currentFilter);
}

function loadSort() {
  const stored = localStorage.getItem(SORT_KEY);
  return ["completed", "created", "category", "manual"].includes(stored) ? stored : "completed";
}

function saveSort() {
  localStorage.setItem(SORT_KEY, currentSort);
}

function loadTheme() {
  return localStorage.getItem(THEME_KEY) || "light";
}

function applyTheme(theme) {
  document.body.classList.toggle("dark", theme === "dark");
  themeToggleInput.checked = theme === "dark";
}

function setTheme(theme) {
  currentTheme = theme;
  localStorage.setItem(THEME_KEY, currentTheme);
  applyTheme(currentTheme);
}

// ---------------------------------------------------------------------------
// Task CRUD
// ---------------------------------------------------------------------------

/**
 * Adds a new task. Warns (and asks for confirmation) if an identical piece
 * of text already exists, since that's usually an accidental duplicate.
 */
function addTask(text, category) {
  const trimmed = text.trim();
  if (!trimmed) {
    // Nothing to add - give the user a visible + accessible signal instead
    // of silently doing nothing.
    taskInput.classList.remove("shake");
    // Force reflow so the animation can be re-triggered on repeated attempts.
    void taskInput.offsetWidth;
    taskInput.classList.add("shake");
    announce("할 일 내용을 입력해주세요.");
    return;
  }

  const isDuplicate = tasks.some(
    (task) => task.text.toLowerCase() === trimmed.toLowerCase()
  );
  if (isDuplicate) {
    const proceed = window.confirm(
      `"${trimmed}"와(과) 동일한 할 일이 이미 있습니다. 그래도 추가할까요?`
    );
    if (!proceed) return;
  }

  const task = {
    id: generateId(),
    text: trimmed,
    completed: false,
    category,
    createdAt: new Date().toISOString(),
  };

  tasks.push(task);
  enteringId = task.id;
  saveTasks();
  render();
  announce(`"${trimmed}" 할 일이 추가되었습니다.`);
}

/**
 * Deletes a task, but only after its fade-out animation finishes. The
 * removed task is kept in `lastDeleted` so the undo toast can restore it.
 */
function deleteTask(id) {
  const index = tasks.findIndex((task) => task.id === id);
  if (index === -1) return;

  const li = taskList.querySelector(`[data-id="${CSS.escape(String(id))}"]`);

  let done = false;
  const finishDelete = () => {
    if (done) return; // guard against both the event and the fallback timer firing
    done = true;
    const [removed] = tasks.splice(index, 1);
    lastDeleted = { task: removed, index };
    saveTasks();
    render();
    showUndoToast(removed);
  };

  if (!li) {
    // Element not currently rendered (e.g. filtered out) - remove immediately.
    finishDelete();
    return;
  }

  li.classList.add("task-exit");
  li.addEventListener("animationend", finishDelete, { once: true });
  // Safety net: if the tab is backgrounded, browsers can pause CSS
  // animations (animationend never fires) - fall back to a timer so the
  // task is never stuck mid-delete.
  setTimeout(finishDelete, DELETE_ANIM_MS + 150);
}

/** Restores the most recently deleted task to its original position. */
function undoDelete() {
  if (!lastDeleted) return;

  const { task, index } = lastDeleted;
  const safeIndex = Math.min(index, tasks.length);
  tasks.splice(safeIndex, 0, task);
  enteringId = task.id;
  lastDeleted = null;

  saveTasks();
  render();
  hideUndoToast();
  announce(`"${task.text}" 할 일이 복구되었습니다.`);
}

function toggleTask(id) {
  const task = tasks.find((task) => task.id === id);
  if (!task) return;

  task.completed = !task.completed;
  togglingId = id;
  saveTasks();
  render();
  announce(`"${task.text}"이(가) ${task.completed ? "완료" : "미완료"} 처리되었습니다.`);
}

function startEdit(id) {
  editingId = id;
  render();
}

/** Returns focus to a task's text element after leaving edit mode, so
 * keyboard/screen-reader users don't lose their place. */
function focusTaskText(id) {
  const li = taskList.querySelector(`[data-id="${CSS.escape(String(id))}"]`);
  const span = li && li.querySelector(".task-text");
  if (span) span.focus();
}

function cancelEdit() {
  const id = editingId;
  editingId = null;
  render();
  focusTaskText(id);
}

function commitEdit(id, newText, newCategory) {
  const trimmed = newText.trim();
  const task = tasks.find((task) => task.id === id);

  if (task && trimmed) {
    task.text = trimmed;
    task.category = newCategory;
    saveTasks();
  }

  editingId = null;
  render();
  focusTaskText(id);
}

/** Swaps a task with its neighbor. Used by the keyboard-accessible reorder buttons. */
function moveTask(id, direction) {
  const index = tasks.findIndex((task) => task.id === id);
  const swapWith = index + direction;
  if (index === -1 || swapWith < 0 || swapWith >= tasks.length) return;

  [tasks[index], tasks[swapWith]] = [tasks[swapWith], tasks[index]];
  saveTasks();
  render();
}

// ---------------------------------------------------------------------------
// Undo toast
// ---------------------------------------------------------------------------

function showUndoToast(task) {
  clearTimeout(undoTimer);
  undoToastText.textContent = `"${task.text}" 삭제됨`;
  undoToast.hidden = false;
  undoTimer = setTimeout(hideUndoToast, UNDO_TIMEOUT_MS);
}

function hideUndoToast() {
  clearTimeout(undoTimer);
  undoToast.hidden = true;
  lastDeleted = null;
}

// ---------------------------------------------------------------------------
// Date / time helpers
// ---------------------------------------------------------------------------

function getRelativeTime(isoString) {
  const diffMs = Date.now() - new Date(isoString).getTime();
  const minutes = Math.floor(diffMs / (1000 * 60));
  const hours = Math.floor(diffMs / (1000 * 60 * 60));
  const days = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (minutes < 1) return "방금 전";
  if (minutes < 60) return `${minutes}분 전`;
  if (hours < 24) return `${hours}시간 전`;
  return `${days}일 전`;
}

function isToday(isoString) {
  const date = new Date(isoString);
  const now = new Date();
  return (
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate()
  );
}

// ---------------------------------------------------------------------------
// Filtering / sorting
// ---------------------------------------------------------------------------

function setFilter(filter) {
  currentFilter = filter;
  saveFilter();
  render();
}

function setSort(sort) {
  currentSort = sort;
  saveSort();
  render();
}

function updateFilterButtons() {
  filterBar.querySelectorAll(".filter-btn").forEach((btn) => {
    const isActive = btn.dataset.filter === currentFilter;
    btn.classList.toggle("active", isActive);
    btn.setAttribute("aria-pressed", String(isActive));
  });
}

/**
 * Returns the tasks that should currently be rendered: filtered by
 * category + search term, then ordered according to `currentSort`.
 *
 * - "manual": the array's own order is the order (drag-and-drop reorders
 *   `tasks` directly, so no extra sorting happens here).
 * - "created": pure chronological order.
 * - "category": grouped by CATEGORY_ORDER, then chronological within a group.
 * - "completed": incomplete items first, completed items last (the
 *   long-standing default from earlier versions of this app).
 */
function getVisibleTasks() {
  const byCategory =
    currentFilter === "all" ? tasks : tasks.filter((task) => task.category === currentFilter);

  const term = searchTerm.trim().toLowerCase();
  const filtered = term
    ? byCategory.filter((task) => task.text.toLowerCase().includes(term))
    : byCategory;

  const indexed = filtered.map((task, index) => ({ task, index }));

  switch (currentSort) {
    case "manual":
      return indexed.map((entry) => entry.task);

    case "created":
      return indexed
        .sort((a, b) => new Date(a.task.createdAt) - new Date(b.task.createdAt))
        .map((entry) => entry.task);

    case "category":
      return indexed
        .sort((a, b) => {
          const categoryDiff =
            CATEGORY_ORDER.indexOf(a.task.category) - CATEGORY_ORDER.indexOf(b.task.category);
          if (categoryDiff !== 0) return categoryDiff;
          return new Date(a.task.createdAt) - new Date(b.task.createdAt);
        })
        .map((entry) => entry.task);

    case "completed":
    default:
      return indexed
        .sort((a, b) => {
          if (a.task.completed !== b.task.completed) return a.task.completed ? 1 : -1;
          return a.index - b.index;
        })
        .map((entry) => entry.task);
  }
}

// ---------------------------------------------------------------------------
// Drag-and-drop manual reordering
// ---------------------------------------------------------------------------

let dragSourceId = null;

function handleDragStart(e, id) {
  dragSourceId = id;
  e.dataTransfer.effectAllowed = "move";
  e.dataTransfer.setData("text/plain", String(id));
  e.currentTarget.classList.add("dragging");
}

function handleDragOver(e) {
  e.preventDefault(); // required to allow a drop
  e.dataTransfer.dropEffect = "move";
  e.currentTarget.classList.add("drag-over");
}

function handleDragLeave(e) {
  e.currentTarget.classList.remove("drag-over");
}

function handleDrop(e, targetId) {
  e.preventDefault();
  e.currentTarget.classList.remove("drag-over");

  const sourceId = dragSourceId;
  dragSourceId = null;
  if (sourceId == null || sourceId === targetId) return;

  reorderTasks(sourceId, targetId);
}

function handleDragEnd(e) {
  e.currentTarget.classList.remove("dragging");
  taskList.querySelectorAll(".drag-over").forEach((el) => el.classList.remove("drag-over"));
}

/**
 * Moves `sourceId` to sit where `targetId` currently is, within the
 * currently visible (filtered/searched) subset - while leaving tasks that
 * are hidden by the current filter/search in their original relative
 * position in the underlying `tasks` array.
 */
function reorderTasks(sourceId, targetId) {
  const visibleIds = getVisibleTasks().map((task) => task.id);
  const fromIndex = visibleIds.indexOf(sourceId);
  const toIndex = visibleIds.indexOf(targetId);
  if (fromIndex === -1 || toIndex === -1) return;

  const [moved] = visibleIds.splice(fromIndex, 1);
  visibleIds.splice(toIndex, 0, moved);

  const visibleSet = new Set(visibleIds);
  const taskById = new Map(tasks.map((task) => [task.id, task]));
  let cursor = 0;

  tasks = tasks.map((task) => {
    if (!visibleSet.has(task.id)) return task;
    const nextId = visibleIds[cursor];
    cursor++;
    return taskById.get(nextId);
  });

  saveTasks();
  render();
}

// ---------------------------------------------------------------------------
// Dashboard (progress, category stats, today count, quote, encouragement)
// ---------------------------------------------------------------------------

function pickQuoteOfDay() {
  const todayKey = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  const index = hashString(todayKey) % QUOTES.length;
  return QUOTES[index];
}

function getEncouragementMessage(total, percent) {
  if (total === 0) return "오늘의 할 일을 추가해보세요!";
  if (percent === 100) return "🎉 모든 할 일을 완료했어요! 최고예요!";
  if (percent >= 70) return "거의 다 왔어요! 조금만 더 힘내세요 💪";
  if (percent >= 40) return "좋은 흐름이에요, 계속 이어가봐요!";
  if (percent > 0) return "시작이 반이에요, 화이팅!";
  return "오늘도 시작해볼까요?";
}

function renderDashboard() {
  const total = tasks.length;
  const completed = tasks.filter((task) => task.completed).length;
  const percent = total === 0 ? 0 : Math.round((completed / total) * 100);

  overallCountEl.textContent = `${completed}/${total} 완료 (${percent}%)`;
  overallProgressFill.style.width = `${percent}%`;
  overallProgressTrack.setAttribute("aria-valuenow", String(percent));

  categoryStatsEl.innerHTML = "";
  const statsFragment = document.createDocumentFragment();

  CATEGORY_ORDER.forEach((category) => {
    const categoryTasks = tasks.filter((task) => task.category === category);
    const categoryTotal = categoryTasks.length;
    const categoryCompleted = categoryTasks.filter((task) => task.completed).length;
    const categoryPercent =
      categoryTotal === 0 ? 0 : Math.round((categoryCompleted / categoryTotal) * 100);

    const row = document.createElement("div");
    row.className = "category-stat-row";

    const label = document.createElement("span");
    label.className = "category-stat-label";
    label.textContent = CATEGORY_LABELS[category];

    const track = document.createElement("div");
    track.className = "category-stat-track";

    const fill = document.createElement("div");
    fill.className = "category-stat-fill " + category;
    fill.style.width = `${categoryPercent}%`;

    const count = document.createElement("span");
    count.className = "category-stat-count";
    count.textContent = `${categoryCompleted}/${categoryTotal}`;

    track.appendChild(fill);
    row.appendChild(label);
    row.appendChild(track);
    row.appendChild(count);
    statsFragment.appendChild(row);
  });

  categoryStatsEl.appendChild(statsFragment);

  const todayCount = tasks.filter((task) => isToday(task.createdAt)).length;
  todayCountEl.textContent = todayCount;

  const remaining = tasks.filter((task) => !task.completed).length;
  remainingBadge.textContent = `${remaining}개 남음`;

  encouragementEl.textContent = getEncouragementMessage(total, percent);
}

// ---------------------------------------------------------------------------
// Inline edit form
// ---------------------------------------------------------------------------

function buildEditForm(task) {
  const wrapper = document.createDocumentFragment();

  const input = document.createElement("input");
  input.type = "text";
  input.className = "task-edit-input";
  input.value = task.text;
  input.setAttribute("aria-label", "할 일 수정");

  const select = document.createElement("select");
  select.className = "task-edit-select";
  select.setAttribute("aria-label", "카테고리 수정");
  CATEGORY_ORDER.forEach((category) => {
    const option = document.createElement("option");
    option.value = category;
    option.textContent = CATEGORY_LABELS[category];
    if (category === task.category) option.selected = true;
    select.appendChild(option);
  });

  const commit = () => commitEdit(task.id, input.value, select.value);

  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      commit();
    } else if (e.key === "Escape") {
      cancelEdit();
    }
  });

  wrapper.appendChild(input);
  wrapper.appendChild(select);

  return { wrapper, input };
}

// ---------------------------------------------------------------------------
// Main render
// ---------------------------------------------------------------------------

function render() {
  renderDashboard();
  updateFilterButtons();

  const isManualSort = currentSort === "manual";
  const visibleTasks = getVisibleTasks();

  // These "one-shot" animation flags are consumed here so that an unrelated
  // future render (e.g. toggling a different task) doesn't replay the
  // animation on this task again.
  const justEntered = enteringId;
  const justToggled = togglingId;
  enteringId = null;
  togglingId = null;

  // Build the new list off-screen in a DocumentFragment and swap it in with
  // a single DOM write, instead of mutating taskList incrementally. This
  // keeps re-renders fast even with a large number of tasks.
  const fragment = document.createDocumentFragment();

  if (visibleTasks.length === 0) {
    const emptyMessage = document.createElement("li");
    emptyMessage.className = "empty-message";
    emptyMessage.textContent =
      tasks.length === 0 ? "할 일이 없습니다. 추가해보세요!" : "조건에 맞는 할 일이 없습니다.";
    fragment.appendChild(emptyMessage);
    taskList.replaceChildren(fragment);
    return;
  }

  let focusInput = null;

  visibleTasks.forEach((task) => {
    const li = document.createElement("li");
    li.className = "task-item" + (task.completed ? " completed" : "");
    li.dataset.id = task.id;

    if (task.id === justEntered) li.classList.add("task-enter");
    if (task.id === justToggled) li.classList.add("task-toggling");

    // Manual-sort drag-and-drop is only wired up while that sort mode is
    // active; otherwise a drag would just be undone by the active sort.
    if (isManualSort) {
      li.draggable = true;
      li.addEventListener("dragstart", (e) => handleDragStart(e, task.id));
      li.addEventListener("dragover", handleDragOver);
      li.addEventListener("dragleave", handleDragLeave);
      li.addEventListener("drop", (e) => handleDrop(e, task.id));
      li.addEventListener("dragend", handleDragEnd);

      const handle = document.createElement("span");
      handle.className = "drag-handle";
      handle.textContent = "⠿";
      handle.setAttribute("aria-hidden", "true");
      li.appendChild(handle);
    }

    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.className = "task-checkbox";
    checkbox.checked = task.completed;
    checkbox.setAttribute("aria-label", `${task.text} 완료 처리`);
    checkbox.addEventListener("change", () => toggleTask(task.id));
    li.appendChild(checkbox);

    if (task.id === editingId) {
      const { wrapper, input } = buildEditForm(task);
      li.appendChild(wrapper);
      focusInput = input;
    } else {
      const categoryTag = document.createElement("span");
      categoryTag.className = "category-tag " + task.category;
      categoryTag.textContent = CATEGORY_LABELS[task.category] || task.category;

      const span = document.createElement("span");
      span.className = "task-text";
      span.textContent = task.text;
      span.tabIndex = 0;
      span.setAttribute("role", "button");
      span.setAttribute("aria-label", `${task.text}, 더블클릭 또는 Enter로 수정`);
      span.addEventListener("dblclick", () => startEdit(task.id));
      span.addEventListener("keydown", (e) => {
        if (e.key === "Enter") startEdit(task.id);
      });

      const time = document.createElement("span");
      time.className = "task-time";
      time.textContent = getRelativeTime(task.createdAt);

      const deleteBtn = document.createElement("button");
      deleteBtn.type = "button";
      deleteBtn.className = "delete-btn";
      deleteBtn.textContent = "×";
      deleteBtn.setAttribute("aria-label", `${task.text} 삭제`);
      deleteBtn.addEventListener("click", () => deleteTask(task.id));

      li.appendChild(categoryTag);
      li.appendChild(span);
      li.appendChild(time);

      if (isManualSort) {
        const reorderGroup = document.createElement("div");
        reorderGroup.className = "reorder-buttons";

        const upBtn = document.createElement("button");
        upBtn.type = "button";
        upBtn.className = "reorder-btn";
        upBtn.textContent = "▲";
        upBtn.setAttribute("aria-label", `${task.text} 위로 이동`);
        upBtn.addEventListener("click", () => moveTask(task.id, -1));

        const downBtn = document.createElement("button");
        downBtn.type = "button";
        downBtn.className = "reorder-btn";
        downBtn.textContent = "▼";
        downBtn.setAttribute("aria-label", `${task.text} 아래로 이동`);
        downBtn.addEventListener("click", () => moveTask(task.id, 1));

        reorderGroup.appendChild(upBtn);
        reorderGroup.appendChild(downBtn);
        li.appendChild(reorderGroup);
      }

      li.appendChild(deleteBtn);
    }

    fragment.appendChild(li);
  });

  taskList.replaceChildren(fragment);

  if (focusInput) {
    focusInput.focus();
    focusInput.select();
  }
}

// ---------------------------------------------------------------------------
// Export / import
// ---------------------------------------------------------------------------

/** Builds the exportable payload: just the tasks, plus a version tag for future-proofing. */
function buildExportPayload() {
  return { version: 1, exportedAt: new Date().toISOString(), tasks };
}

function exportTasks() {
  const payload = buildExportPayload();
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);

  const a = document.createElement("a");
  a.href = url;
  a.download = `my-tasks-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);

  announce("할 일 데이터를 내보냈습니다.");
}

function triggerImport() {
  importFileInput.value = ""; // allow re-selecting the same file twice in a row
  importFileInput.click();
}

function handleImportFile(e) {
  const file = e.target.files && e.target.files[0];
  if (!file) return;

  const reader = new FileReader();

  reader.onerror = () => {
    window.alert("파일을 읽는 중 오류가 발생했습니다.");
  };

  reader.onload = () => {
    let payload;
    try {
      payload = JSON.parse(reader.result);
    } catch (err) {
      window.alert("올바른 JSON 파일이 아닙니다.");
      return;
    }

    // Accept either a raw array of tasks, or the { tasks: [...] } export format.
    const rawTasks = Array.isArray(payload) ? payload : payload && payload.tasks;
    if (!Array.isArray(rawTasks)) {
      window.alert("가져올 수 있는 할 일 데이터가 없습니다.");
      return;
    }

    const importedTasks = rawTasks.map(sanitizeTask).filter(Boolean);
    if (importedTasks.length === 0) {
      window.alert("가져올 수 있는 유효한 할 일이 없습니다.");
      return;
    }

    if (tasks.length > 0) {
      const wantsBackup = window.confirm(
        `현재 ${tasks.length}개의 할 일이 있습니다. 가져오기 전에 백업 파일을 다운로드할까요?`
      );
      if (wantsBackup) exportTasks();
    }

    const confirmed = window.confirm(
      `가져온 ${importedTasks.length}개의 할 일로 현재 목록을 대체합니다. 계속할까요?`
    );
    if (!confirmed) return;

    tasks = importedTasks;
    saveTasks();
    render();
    announce(`${importedTasks.length}개의 할 일을 가져왔습니다.`);
  };

  reader.readAsText(file);
}

// ---------------------------------------------------------------------------
// Event wiring
// ---------------------------------------------------------------------------

addBtn.addEventListener("click", () => {
  addTask(taskInput.value, categorySelect.value);
  taskInput.value = "";
  taskInput.focus();
});

taskInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    addTask(taskInput.value, categorySelect.value);
    taskInput.value = "";
  }
});

// Remove the shake feedback once the user starts fixing the input.
taskInput.addEventListener("input", () => taskInput.classList.remove("shake"));

filterBar.addEventListener("click", (e) => {
  const btn = e.target.closest(".filter-btn");
  if (btn) setFilter(btn.dataset.filter);
});

sortSelect.addEventListener("change", () => setSort(sortSelect.value));

const debouncedSearch = debounce(() => {
  searchTerm = searchInput.value;
  render();
}, SEARCH_DEBOUNCE_MS);
searchInput.addEventListener("input", debouncedSearch);

themeToggleInput.addEventListener("change", () => {
  setTheme(themeToggleInput.checked ? "dark" : "light");
});

clearCompletedBtn.addEventListener("click", () => {
  const completedCount = tasks.filter((task) => task.completed).length;
  if (completedCount === 0) return;

  const confirmed = window.confirm(`완료된 항목 ${completedCount}개를 모두 삭제할까요?`);
  if (confirmed) {
    tasks = tasks.filter((task) => !task.completed);
    saveTasks();
    render();
    announce(`완료된 항목 ${completedCount}개를 삭제했습니다.`);
  }
});

exportBtn.addEventListener("click", exportTasks);
importBtn.addEventListener("click", triggerImport);
importFileInput.addEventListener("change", handleImportFile);

undoBtn.addEventListener("click", undoDelete);

document.addEventListener("keydown", (e) => {
  if (!e.altKey) return;

  const key = e.key.toLowerCase();

  if (key === "n") {
    e.preventDefault();
    taskInput.focus();
  } else if (key === "d") {
    e.preventDefault();
    setTheme(currentTheme === "dark" ? "light" : "dark");
  } else if (FILTER_SHORTCUTS[e.key]) {
    e.preventDefault();
    setFilter(FILTER_SHORTCUTS[e.key]);
  }
});

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------

applyTheme(currentTheme);
sortSelect.value = currentSort;
quoteOfDayEl.textContent = `"${pickQuoteOfDay()}"`;
render();
