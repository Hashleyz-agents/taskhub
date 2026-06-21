# TaskHub

A local, Asana/Jira-style project & task manager where **the source of truth is markdown files** — so Claude Code can read a task's full requirements and update its status while working, even when the dashboard isn't running.

No build step, no `npm install`, no `pip install`. Pure Python 3 standard library + plain HTML/CSS/JS.

## Run it

```bash
python3 server.py
# open http://localhost:5174
```

Set a different port with `PORT=8080 python3 server.py`.

A demo project is already seeded. To recreate it: `python3 cli.py seed`.

## What you can do

- **Create a project** (top bar → `+ Project`). Each project gets a folder and an ID prefix (e.g. `DEMO-1`).
- **Create high-level Epics** (`+ Epic`).
- **Create tasks inside an Epic**, **subtasks inside a task**, and **sub-subtasks inside a subtask** — nesting is unlimited (open any item → *Add task/subtask*, or hover a row in Tree view → `+ add`).
- Every new task starts **In Backlog** and moves through the lifecycle:
  **In Backlog → Under Refinement → Ready for Dev → Dev In Progress → Ready for Review → Done.**
- **Dashboard, two views:**
  - **Board** — a Kanban column per status, drag a card between columns to change status.
  - **Tree** — the full epic → task → subtask hierarchy, with derived roll-up progress (`3/6`).
- **Click any task** to open a detail drawer and **edit** its title, status, type, priority, parent, assignee, labels, and markdown description (with live preview).
- **Search** across IDs, titles, and descriptions.

## How tasks are stored

```
data/
  <project-id>/
    project.md            # project metadata
    .tasks/
      DEMO-1.md           # one markdown file per epic / task / subtask
      DEMO-2.md
      ...
```

Each task file:

```markdown
---
id: DEMO-2
title: Design welcome screen
type: task                 # epic | task | subtask
status: ready_for_review   # backlog | refinement | ready_for_dev | dev_in_progress | ready_for_review | done
parent: DEMO-1             # the item this belongs to (null if top level)
priority: medium
assignee: null
labels: []
created: 2026-06-21
updated: 2026-06-21
---

## Description
First screen a new user sees.

## Acceptance criteria
- [x] Wireframe
- [ ] Final visual
```

The **frontmatter** is the machine-readable part; the **body** is the human/agent-readable requirements. Hierarchy lives only on the child (`parent:`); a parent's children and progress roll-up are derived by scanning — there is no duplicated list to keep in sync.

## Claude Code / CLI interface

The dashboard and the CLI both operate directly on the files via `taskhub_core.py`, so an agent never needs the server running.

```bash
python3 cli.py projects                 # list projects
python3 cli.py tasks <project>          # list tasks
python3 cli.py show <project> DEMO-2    # print a task's full markdown (its spec)
python3 cli.py tree <project>          # hierarchy with roll-up
python3 cli.py create <project> --title "..." --type task --parent DEMO-1
python3 cli.py update <project> DEMO-2 status=dev_in_progress priority=high
python3 cli.py delete <project> DEMO-1  # deletes the item and its descendants
```

**A suggested workflow for an agent** working a task:
1. `python3 cli.py show <project> <ID>` (or read `data/<project>/.tasks/<ID>.md`) to load the full requirements.
2. `python3 cli.py update <project> <ID> status=dev_in_progress` when starting.
3. Do the work; tick acceptance-criteria checkboxes in the file body.
4. `python3 cli.py update <project> <ID> status=ready_for_review` when done — leave the final `done` for a human.

## Files

| File | Purpose |
|------|---------|
| `taskhub_core.py` | The one implementation of the file format: parse/write, ID allocation, hierarchy, roll-up. Imported by both server and CLI. |
| `server.py` | Zero-dependency HTTP server: serves the UI and a JSON REST API over the files. |
| `cli.py` | Command-line interface — the agent's entry point. |
| `public/` | The dashboard (`index.html`, `styles.css`, `app.js`). |
| `data/` | Your projects and tasks (the source of truth). |
| `TASKHUB_PLAN.md` | The original design spec. |
