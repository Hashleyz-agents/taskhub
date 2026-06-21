# TaskHub — Implementation Plan

> A local, multi-project task manager (Asana/Jira-style board) where the **source of truth is markdown files inside each project repo**, so Claude Code / Claude Design can read a task's full requirements and update its status while working — without depending on any server being up.
>
> This document is the spec to hand to Claude Code. Build it phase by phase.

---

## 1. Core idea

Two surfaces over **one source of truth**:

1. **The files** — every task is a markdown file with YAML frontmatter, committed inside the project it belongs to (`.tasks/ASTRO-12.md`). This is what AI agents read and edit. It travels with the repo and needs no running server.
2. **The dashboard** — a local web app (FastAPI + plain HTML/JS) that scans all registered projects, renders a unified Kanban board across them, and reads/writes those same files.

Both the dashboard and the `taskhub` CLI operate directly on the files. The CLI is decoupled from the web server on purpose: Claude Code must be able to read/update tasks even when the dashboard isn't running.

```
                ┌─────────────────────────┐
   You ───────► │  Dashboard (web board)  │ ──┐
                └─────────────────────────┘   │   read / write
                                              ▼
   Claude Code ─► taskhub CLI ──────► .tasks/*.md   (source of truth, per repo)
   Claude Code ─► direct file edit ─►
```

## 2. Recommended stack (and why)

- **Backend:** Python + FastAPI (uvicorn). Matches your existing Personal Astrology App stack, has clean filesystem access across multiple repo paths, trivial to run locally.
- **Frontend:** plain HTML/CSS/JS, no build step. Same no-build philosophy you already use. A single board view + detail drawer is well within reach without a framework.
- **Task storage:** markdown + YAML frontmatter, one file per task, in each project's `.tasks/` folder. Human-readable, diffable, git-friendly, natively readable by any Claude agent.
- **Shared core library:** a small Python package (`taskhub_core`) that parses/writes task files and resolves the project registry. **Both** the FastAPI app and the CLI import it, so there is exactly one implementation of the file format.
- **Agent interface:** a `taskhub` CLI (thin wrapper over `taskhub_core`) + a standard `CLAUDE.md` snippet dropped into each project.

Rejected alternatives: a central DB would break the "task lives with the repo / agent reads it natively" property; Node/React adds a second stack to maintain; a single static HTML file can't write back to files across repos without a helper anyway.

## 3. Data model — the task file

Path: `<project>/.tasks/<ID>.md`. Filename is the task ID.

```markdown
---
id: ASTRO-12
title: Migrate JSON store to Postgres
type: subtask                # epic | task | subtask
status: in_progress          # backlog | todo | in_progress | in_review | done
priority: high               # low | medium | high | urgent
parent: ASTRO-3              # the high-level task this belongs to (omit if none)
labels: [backend, db]
assignee: ashley
created: 2026-06-21
updated: 2026-06-21
depends_on: [ASTRO-08]       # task IDs that must finish first
---

## Description
One paragraph of context: what and why.

## Acceptance criteria
- [ ] Schema created for account + person tables
- [ ] Owner-scoped queries enforced in FastAPI layer
- [ ] Existing JSON data migrated, same UUIDs preserved

## Notes / activity log
- 2026-06-21 — created
- 2026-06-21 — claude-code: status → in_progress
```

Rules:
- `id` = `<PREFIX>-<n>`. Prefix is per-project (e.g. `ASTRO`), counter is per-project and monotonic.
- `status` is a fixed enum; the board columns map 1:1 to it.
- Frontmatter is the machine-readable part; the body is the human/agent-readable requirements.
- The `## Notes / activity log` section is append-only; status changes append a line.

### Hierarchy — high-level tasks and subtasks

A task can hold a list of subtasks (think Jira epic → stories, or Asana task → subtasks).

- **The link lives on the child:** each subtask sets `parent: <ID>`. The parent's
  subtask list is *derived* by scanning for children — there is no duplicated list to
  keep in sync. One source of truth.
- `type` is just a label for display/filtering: `epic` (high-level parent), `task`
  (standalone), `subtask` (has a parent). A parent can itself be a `task` or `epic`.
- **One level is the default.** A subtask may have its own children (sub-subtasks);
  the UI shows the tree, but keep it shallow in practice.
- **Roll-up status (derived, not stored):** the parent shows progress from its children
  — e.g. "3/5 done". The parent's *own* `status` is still settable manually; the board
  shows the roll-up alongside it so a high-level item reads "In progress · 3/5".
- **Roll-up is non-destructive:** changing a subtask never silently rewrites the parent's
  file. Optional convenience: `taskhub update <parent> --auto-status` recomputes the
  parent's status from children on demand (all done → `done`, any in_progress → `in_progress`).
- A subtask's body (its own description + acceptance criteria) is what an agent reads when
  told to work on it; the parent's body holds the high-level goal and context.

Example: a high-level task `ASTRO-3` (type `epic`, "Production-ready data layer") with
subtasks `ASTRO-12` (Postgres migration), `ASTRO-13` (auth), `ASTRO-14` (owner isolation),
each carrying `parent: ASTRO-3`.

## 4. Project registry

A single config file tells the dashboard and CLI which repos to scan.

Path: `~/.taskhub/config.json`

```json
{
  "projects": [
    { "name": "Personal Astrology App", "prefix": "ASTRO",
      "path": "/Users/ashleyzhang/Claude/Projects/Personal Astrology App" },
    { "name": "Another Project", "prefix": "PROJ",
      "path": "/Users/ashleyzhang/Code/another-project" }
  ]
}
```

- `taskhub project add <name> --prefix ASTRO --path <dir>` appends here and creates `.tasks/` in that repo.
- The dashboard reads this on startup to build the multi-project board.

## 5. The `taskhub` CLI (the agent's interface)

Stable, scriptable commands that operate directly on files. Claude Code calls these; everything also works by hand.

```
taskhub list [--project ASTRO] [--status todo] [--assignee me]   # table of tasks
taskhub show ASTRO-12                                            # full file to stdout
taskhub next [--project ASTRO]                                   # highest-priority todo
taskhub create --project ASTRO --title "..." [--priority high]   # new task, prints new ID
taskhub create --parent ASTRO-3 --title "..."                    # new subtask under a parent
taskhub tree ASTRO-3                                             # parent + nested subtasks, with roll-up
taskhub update ASTRO-12 --status in_progress                     # change a field
taskhub update ASTRO-12 --parent ASTRO-3                         # re-parent / set the high-level task
taskhub update ASTRO-3 --auto-status                            # recompute parent status from children
taskhub update ASTRO-12 --add-note "ran migration, tests green"  # append to activity log
taskhub check ASTRO-12 "Schema created..."                       # tick an acceptance box
taskhub project add | list
```

Behavior of `update`:
- Validates the enum, rewrites frontmatter, bumps `updated`, and **appends an activity-log line** noting the actor (`claude-code:` when `--actor` is passed, default `cli`).
- Atomic write (temp file + rename) so a half-written file never corrupts a task.

This CLI is the single point both humans and agents use, so file format and logging stay consistent.

## 6. Claude Code / Claude Design integration

This is the part that makes the request work. Two pieces:

### a) A `CLAUDE.md` block committed to each project

Add this to every managed repo's `CLAUDE.md` so any agent in that repo knows the workflow:

```markdown
## Task workflow (TaskHub)
- Tasks live in `.tasks/<ID>.md`. The frontmatter holds status/priority; the
  body holds the requirements and acceptance criteria.
- When asked to "work on ASTRO-12": run `taskhub show ASTRO-12` (or read
  `.tasks/ASTRO-12.md`) to load full requirements before starting.
- On starting: `taskhub update ASTRO-12 --status in_progress --actor claude-code`.
- While working: tick acceptance criteria with `taskhub check`, and log notable
  steps with `taskhub update ASTRO-12 --add-note "..." --actor claude-code`.
- When done and criteria are met: `taskhub update ASTRO-12 --status in_review
  --actor claude-code` (never jump straight to `done` — leave that for Ashley).
```

### b) Optional: a Claude Code skill

A lightweight skill named e.g. `task` that wraps the above so you can say "/task ASTRO-12" and the agent loads the file, sets in_progress, and begins. Not required for v1 — the `CLAUDE.md` block alone makes `"work on ASTRO-12"` work.

Result: you say *"Claude, work on ASTRO-12"* in any project; the agent reads `.tasks/ASTRO-12.md` for the spec, flips it to in_progress, does the work, ticks criteria, and moves it to in_review. The dashboard reflects all of it because it's reading the same files.

## 7. Dashboard (web UI) — v1 features

- **Multi-project Kanban board**: columns = the five statuses; cards grouped/filterable by project. Drag a card to change status (writes the file).
- **Project filter** + "All projects" view, plus filters for priority, label, assignee.
- **Task detail drawer**: renders the markdown body (description, acceptance criteria with live checkboxes, activity log). For a high-level task it also lists its **subtasks** with a roll-up progress bar ("3/5 done"); each subtask is clickable. For a subtask it shows a link back to its parent.
- **Create subtask** inline from a parent's drawer; **add task** as standalone or under a parent.
- On the board, a high-level card shows its roll-up ("In progress · 3/5"). A view **toggle** flips how subtasks display, **defaulting to nested**: *nested* tucks subtasks under their parent card (hierarchy obvious at a glance, Asana/Jira-style); *flat* shows each subtask as its own card in its status column with a small "↳ ASTRO-3" parent tag. View-only preference, stored locally; the files never change either way.
- **Create / edit task** form (writes a new `.tasks/*.md`).
- **Search** across titles/bodies.
- Follow your existing UI/UX rules: minimal, flat, line-icons or text (no emoji icons), WCAG AA contrast, 44px touch targets, CSS tokens — consistent with the Astrology app's design system.

Backend = a thin REST layer over `taskhub_core`:

```
GET  /api/projects
GET  /api/tasks?project=&status=&priority=&label=&q=&parent=   # filter; parent= lists children
GET  /api/tasks/{id}            # includes derived subtasks[] + roll-up progress
GET  /api/tasks/{id}/tree       # parent + nested subtasks
POST /api/tasks                 # create (optional parent= to make it a subtask)
PATCH /api/tasks/{id}           # update status/fields/parent, append note
```

## 8. Repo layout to build

```
taskhub/
  taskhub_core/         # shared library: parse/write task files, registry, ID alloc
    __init__.py
    model.py            # Task dataclass + enums (incl. type, parent)
    store.py            # read/write .tasks/*.md, atomic writes, ID counter
    hierarchy.py        # derive children, roll-up progress, auto-status, cycle guard
    registry.py         # load/save ~/.taskhub/config.json
  cli/
    taskhub.py          # argparse/click CLI over taskhub_core
  backend/
    main.py             # FastAPI app + REST routes
  frontend/
    index.html
    app.js
    styles.css
  integration/
    CLAUDE.md.snippet   # the block to paste into each project
  tests/
    test_store.py       # round-trip parse/write, ID allocation, atomic update
    test_oracle.py      # compare CLI output vs files on a fixture repo
  pyproject.toml        # installs `taskhub` console script
  README.md             # setup + register-a-project quickstart
```

## 9. Build phases (hand these to Claude Code in order)

1. **Phase 0 — Spec & scaffold.** Repo layout, `pyproject.toml` with the `taskhub` console script, write `model.py` (Task + status/priority enums) and this file format as the contract.
2. **Phase 1 — Core + CLI + hierarchy.** `store.py` (parse/write/atomic-update, per-project ID counter), `registry.py`, `hierarchy.py` (derive children from `parent`, roll-up progress, `--auto-status`, guard against parent cycles), and the full `taskhub` CLI incl. `create --parent`, `tree`, and re-parenting. Unit tests for round-trip, ID allocation, and roll-up. *This alone already makes Claude Code able to read and update tasks, including high-level tasks with subtasks.*
3. **Phase 2 — Backend.** FastAPI REST endpoints over `taskhub_core`. Run locally with uvicorn.
4. **Phase 3 — Frontend.** Kanban board, filters, detail drawer, create/edit, drag-to-change-status. Wire to the API.
5. **Phase 4 — Agent integration kit.** `CLAUDE.md.snippet`, README quickstart, optional `task` skill. Register the Personal Astrology App as the first project and seed a few real tasks (e.g. the Postgres migration, mobile drawer, self-host fonts) from its CLAUDE.md/TO-REVIEW.md.
6. **Phase 5 — Polish & verify.** Search, dependency display (`depends_on`), empty/error states, accessibility pass against your UI rules. Verification: run the CLI and the dashboard against the seeded astrology repo and confirm a full loop — create a task in the UI, `taskhub update` it from a shell, see the board reflect it.

## 10. Decisions already locked

- Scope: local, single-user, multi-project. No auth/hosting in v1.
- Source of truth: markdown files in each repo's `.tasks/`. Dashboard and CLI are views over them.
- Agents read via `taskhub show` / direct file read; update via `taskhub update`. Never depend on the web server.
- Statuses: `backlog → todo → in_progress → in_review → done`. Agents may advance to `in_review` but leave `done` to you.
- Hierarchy: high-level tasks hold subtasks; the link is stored on the child (`parent:`), the parent's list and progress roll-up are derived. No stored duplication.

## 11. Open questions for you

- Where should the `taskhub` repo itself live, and where do your *other* projects sit on disk (so the registry can point at them)?
- One global ID counter or per-project (plan assumes per-project, e.g. `ASTRO-1`, `PROJ-1`)?
- Want the optional Claude Code `/task` skill in v1, or is the `CLAUDE.md` block enough to start?
