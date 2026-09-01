# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

"My Tasks" — a single-page todo list app built with plain HTML/CSS/JS (no framework, no build step, no package.json). The entire app is three files: `index.html`, `style.css`, `script.js`.

## Running it

There is no build or install step. Because the app uses `localStorage`, open it through a local HTTP server rather than a `file://` URL (some browsers restrict `localStorage` on `file://`):

```
python -m http.server 8811
```

Then visit `http://localhost:8811/index.html`. There is no test suite or linter configured.

## Architecture

All application logic lives in `script.js` as a single classic (non-module) script, organized into clearly commented sections (search for `// ---` banners to jump between them): constants, DOM refs, state, utilities, persistence, task CRUD, undo toast, date helpers, filtering/sorting, drag-and-drop, dashboard, inline-edit form, main render, export/import, event wiring, init.

**State and rendering model**: the single source of truth is the in-memory `tasks` array (each task: `{ id, text, completed, category, createdAt }`). Every mutation (add/delete/toggle/edit/reorder/import) updates `tasks`, persists it, then calls `render()`, which fully rebuilds the `<ul id="task-list">` from scratch via a `DocumentFragment` + `replaceChildren` (no virtual-DOM diffing, no per-item incremental updates). This "just re-render everything" approach is intentionally simple; it stays fast (~11ms for 100+ tasks) because DOM writes are batched.

**Derived view**: `getVisibleTasks()` is the single function that turns raw `tasks` into what should be on screen — it applies the category filter, the search term, and then one of four sort modes (`completed` | `created` | `category` | `manual`) before `render()` draws it. Nothing else should filter/sort tasks independently of this function.

**Manual drag-and-drop sort**: when `currentSort === "manual"`, list items become `draggable` and drag handles/keyboard reorder buttons (▲▼) appear. `reorderTasks()` reorders only the currently-visible subset while preserving the relative position of tasks hidden by the active filter/search — it does this by walking the full `tasks` array and substituting in the new visible order at the slots visible tasks already occupy, rather than maintaining a separate `order` field.

**One-shot animation flags**: `enteringId` / `togglingId` are set right before a mutating call to `render()` and consumed (read once, then reset to `null`) inside `render()` itself. This lets a specific `<li>` play a fade-in or slide animation on the render that creates/changes it, without replaying on unrelated future renders.

**Delete + undo**: `deleteTask()` waits for the `.task-exit` CSS animation to finish (via `animationend`) before actually removing the item from `tasks`, but also arms a `setTimeout` safety fallback (`DELETE_ANIM_MS + 150`) in case the tab is backgrounded, since Chrome can pause CSS animations on hidden tabs and `animationend` would otherwise never fire. The removed task is kept in `lastDeleted` and surfaced via a toast (`showUndoToast`) so `undoDelete()` can splice it back into its original index.

**Persistence**: four independent `localStorage` keys — `tasks`, `taskFilter`, `taskSort`, `theme`. Task saves are debounced (`SAVE_DEBOUNCE_MS`) and force-flushed on `beforeunload`/`visibilitychange` so a pending debounce never loses data. `sanitizeTask()` is the single choke point that normalizes/validates a raw task-like object — used both when loading from `localStorage` and when importing a JSON file — so corrupt storage or a malformed import file can't crash rendering.

**Theming**: dark mode is a `body.dark` class toggle; all themeable colors are CSS custom properties on `:root` / `body.dark` in `style.css`, so components never hardcode light/dark colors directly (category tag colors are the intentional exception — they stay identical in both themes).

**Accessibility**: the dashboard progress bar has `role="progressbar"` with live `aria-value*`; filter buttons carry `aria-pressed`; checkboxes/delete buttons get per-task `aria-label`s generated at render time; a visually-hidden `#sr-announcer` (`aria-live="polite"`) is updated by `announce()` after key actions (add/delete/toggle/import/etc.) for screen-reader feedback.

## Keyboard shortcuts (implemented in the `keydown` listener near the bottom of `script.js`)

- `Alt+N` — focus the new-task input
- `Alt+1`/`2`/`3`/`4` — switch category filter (all/work/personal/study)
- `Alt+D` — toggle dark mode
- Inline edit: `Enter` commits, `Escape` cancels
