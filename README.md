# TaskHub

A local, Asana/Jira-style project & task manager where **the source of truth is markdown files**. Every epic, task, and subtask is a markdown file with YAML frontmatter, so an AI agent like Claude Code can read a task's full requirements (and its prompts) and update its status while working — even when the dashboard isn't running.

No build step, no `npm install`, no `pip install`. The backend is pure Python standard library; the frontend is plain HTML/CSS/JS.

---

## Requirements

- **Python 3** (3.7+). Check with `python3 --version`.
- A modern web browser.

That's it — there are no third-party dependencies.

## Run it locally

From the project folder:

```bash
python3 server.py
```

Then open **http://localhost:5174** in your browser.

- Use a different port with `PORT=8080 python3 server.py`.
- The server prints where the task files live (`./data`).
- Stop it with `Ctrl-C`.

A **Demo Product** project is included so you have something to explore immediately.

---

## Using the dashboard

### Projects
- **+ Project** — create a project. Each project gets a folder under `data/` and an ID prefix (e.g. `DEMO-1`).
- Switch projects with the dropdown in the top bar.
- **Delete project** (top-right) — permanently deletes the project and *all* its tasks. It asks you to type the project name to confirm.

### Creating work
- **+ Epic** — create a high-level epic.
- **+ Task** — create a task; in the dialog you can optionally pick a parent (an epic or another task).
- Inside any item's detail panel, **+ Add task / + Add subtask** creates a child. Nesting is unlimited: epic → task → subtask → sub-subtask → …
- In **Tree** view, hover a row and click **+ add** to add a child there.

### The task lifecycle
Every new task starts **In Backlog** and moves through:

> **In Backlog → Under Refinement → Ready for Dev → Dev In Progress → Ready for Review → Done**

### Two views
- **Board** — a Kanban column per status. **Drag a card** between columns to change its status. The **Show epics** toggle hides/shows epic cards (on by default).
- **Tree** — the full epic → task → subtask hierarchy, with a derived roll-up (e.g. `3/6`) showing how many descendants are done. Expand/collapse with the carets.

### Editing a task
Click any card or tree row to open the detail panel, where you can edit:
- **Title, Status, Type, Priority, Assignee, Parent, Labels**
- **Description** — markdown, with an Edit/Preview toggle.
- **Subtasks** — listed with their status; click to open, or add a new one.
- **Prompts** — see below.

Click **Save changes** to write everything back to the file.

### Prompts (instructions for an AI to run later)
Each task can hold **multiple prompts** — short instructions you write for an agent to act on.
- **+ Add prompt** adds another.
- Each prompt has **Copy** (to clipboard) and **Delete** (with confirmation).
- A prompt's editor **auto-sizes to its text** when idle and grows while you edit it.
- A **Save prompt** button appears below a prompt only while you're editing it.

### Search
The search box filters by task ID, title, description, and prompt text.

---

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

A task file looks like:

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

## AI Prompts

<!-- prompt -->
Implement the welcome screen per the description and check the acceptance boxes.

<!-- prompt -->
Then take a screenshot and attach it to the task notes.
```

- The **frontmatter** is the machine-readable part; the **body** is the human/agent-readable requirements.
- Hierarchy lives only on the child (`parent:`); a parent's children and roll-up progress are derived by scanning — there's no duplicated list to keep in sync.
- Prompts live under a `## AI Prompts` heading, each preceded by a `<!-- prompt -->` marker so multiple multi-line prompts round-trip cleanly.

---

## Command-line interface (for agents / scripting)

The CLI operates directly on the files via the same code the dashboard uses, so it works with **no server running**:

```bash
python3 cli.py projects                 # list projects
python3 cli.py tasks <project>          # list tasks
python3 cli.py show <project> DEMO-2    # print a task's full markdown (its spec + prompts)
python3 cli.py tree <project>          # hierarchy with roll-up
python3 cli.py create <project> --title "..." --type task --parent DEMO-1
python3 cli.py update <project> DEMO-2 status=dev_in_progress priority=high
python3 cli.py delete <project> DEMO-1  # deletes the item and its descendants
python3 cli.py seed                     # recreate the Demo Product sample project
```

A suggested loop for an agent working a task:
1. `python3 cli.py show <project> <ID>` to load the full requirements and prompts.
2. `python3 cli.py update <project> <ID> status=dev_in_progress` when starting.
3. Do the work; tick acceptance-criteria checkboxes in the file body.
4. `python3 cli.py update <project> <ID> status=ready_for_review` when done — leave the final `done` for a human.

---

## Project layout

| Path | Purpose |
|------|---------|
| `server.py` | Zero-dependency HTTP server: serves the UI and a JSON REST API over the files. |
| `taskhub_core.py` | The single implementation of the file format: parse/write, ID allocation, hierarchy, roll-up. Imported by both the server and the CLI. |
| `cli.py` | Command-line interface — the agent's entry point. |
| `public/` | The dashboard (`index.html`, `styles.css`, `app.js`). |
| `data/` | Your projects and tasks (the source of truth). |

## Notes

- `data/` holds your real projects. This repo ships only the **Demo Product** sample; other projects under `data/` are git-ignored (see `.gitignore`).
- Everything is local and single-user; there's no auth or hosting.
