# My Tasks

A todo list app built with plain HTML, CSS, and JavaScript — no framework, no build step, no dependencies.

## Features

- Add, edit (double-click to rename inline), complete, and delete tasks
- Categories (업무 / 개인 / 공부) with color tags and per-category filtering
- Real-time search
- Progress dashboard: overall completion %, per-category progress, today's added count, a daily quote, and an encouragement message
- Sort by completion status, creation date, category, or manual drag-and-drop (with keyboard-accessible ▲▼ reorder buttons)
- Dark mode with a saved preference
- Undo for deletions, duplicate-task warning, JSON export/import
- Keyboard shortcuts (see below)
- Responsive layout down to mobile widths, with accessibility touches (ARIA labels, live-region announcements, focus management)

All data is stored locally in the browser via `localStorage` — nothing is sent to a server.

## Running it

This is a static site with no build step. Because the app relies on `localStorage`, serve it over HTTP rather than opening `index.html` directly as a `file://` URL:

```bash
python -m http.server 8811
```

Then open `http://localhost:8811/index.html`.

## Keyboard shortcuts

| Shortcut | Action |
| --- | --- |
| `Alt+N` | Focus the new-task input |
| `Alt+1` / `2` / `3` / `4` | Switch filter to All / 업무 / 개인 / 공부 |
| `Alt+D` | Toggle dark mode |
| `Enter` / `Escape` (while editing a task) | Save / cancel the edit |

## Tech stack

Vanilla HTML, CSS, and JavaScript (ES6+). No frameworks, bundlers, or external libraries.

See [CLAUDE.md](CLAUDE.md) for a deeper look at the app's architecture.
