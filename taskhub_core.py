"""TaskHub core: read/write the markdown files that ARE the source of truth.

Every project is a folder under ./data/<project-id>/ containing:
  - project.md            (project metadata in YAML frontmatter)
  - .tasks/<ID>.md        (one markdown file per epic / task / subtask)

A task file looks like:

    ---
    id: ASTRO-12
    title: Migrate JSON store to Postgres
    type: subtask
    status: dev_in_progress
    parent: ASTRO-3
    priority: high
    assignee: ashley
    labels: [backend, db]
    created: 2026-06-21
    updated: 2026-06-21
    ---

    ## Description
    ...markdown body that Claude Code reads as the requirements...

Hierarchy is stored ONLY on the child (`parent: <ID>`). A parent's children and
roll-up progress are *derived* by scanning — there is no duplicated list to keep
in sync. Nesting is unlimited: a subtask may have its own subtasks.

This module is pure standard library so it runs anywhere Python 3 runs, and it is
imported by BOTH server.py (the dashboard API) and cli.py (the agent interface),
so the file format has exactly one implementation.
"""

import os
import re
import shutil
import datetime

ROOT = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(ROOT, "data")

# The task lifecycle requested for TaskHub. Board columns map 1:1 to this order.
STATUSES = [
    "backlog",
    "refinement",
    "ready_for_dev",
    "dev_in_progress",
    "ready_for_review",
    "done",
]
STATUS_LABELS = {
    "backlog": "In Backlog",
    "refinement": "Under Refinement",
    "ready_for_dev": "Ready for Dev",
    "dev_in_progress": "Dev In Progress",
    "ready_for_review": "Ready for Review",
    "done": "Done",
}
TYPES = ["epic", "task", "subtask"]
PRIORITIES = ["low", "medium", "high", "urgent"]


def today():
    return datetime.date.today().isoformat()


def ensure_data():
    os.makedirs(DATA_DIR, exist_ok=True)


# --------------------------------------------------------------------------- #
# Frontmatter (a small, dependency-free YAML subset: scalars + inline lists)   #
# --------------------------------------------------------------------------- #
def parse_md(text):
    """Return (frontmatter_dict, body_str)."""
    m = re.match(r"^---\n(.*?)\n---\n?(.*)$", text, re.S)
    if not m:
        return {}, text
    data = {}
    for line in m.group(1).split("\n"):
        if not line.strip() or ":" not in line:
            continue
        key, _, val = line.partition(":")
        data[key.strip()] = _parse_scalar(val.strip())
    return data, m.group(2)


def _parse_scalar(val):
    if val in ("", "null", "~"):
        return None
    if val.startswith("[") and val.endswith("]"):
        inner = val[1:-1].strip()
        if not inner:
            return []
        return [x.strip().strip("\"'") for x in inner.split(",") if x.strip()]
    if re.fullmatch(r"-?\d+", val):
        return int(val)
    return val.strip("\"'")


def dump_md(data, body):
    lines = ["---"]
    for k, v in data.items():
        lines.append(f"{k}: {_fmt_scalar(v)}")
    lines.append("---")
    out = "\n".join(lines) + "\n\n" + (body or "").lstrip("\n")
    if not out.endswith("\n"):
        out += "\n"
    return out


def _fmt_scalar(v):
    if v is None:
        return "null"
    if isinstance(v, list):
        return "[" + ", ".join(str(x) for x in v) + "]"
    return str(v)


def _read(path):
    with open(path, encoding="utf-8") as f:
        return f.read()


def _atomic_write(path, text):
    """Write via temp file + rename so a crash never leaves a half-written task."""
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        f.write(text)
    os.replace(tmp, path)


# --------------------------------------------------------------------------- #
# Paths                                                                        #
# --------------------------------------------------------------------------- #
def _slugify(name):
    s = re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")
    return s or "project"


def _project_dir(pid):
    return os.path.join(DATA_DIR, pid)


def _tasks_dir(pid):
    return os.path.join(_project_dir(pid), ".tasks")


def _task_files(pid):
    d = _tasks_dir(pid)
    if not os.path.isdir(d):
        return []
    return [f for f in os.listdir(d) if f.endswith(".md")]


# --------------------------------------------------------------------------- #
# Projects                                                                     #
# --------------------------------------------------------------------------- #
def list_projects():
    ensure_data()
    out = []
    for name in sorted(os.listdir(DATA_DIR)):
        pf = os.path.join(DATA_DIR, name, "project.md")
        if os.path.isfile(pf):
            data, body = parse_md(_read(pf))
            data["id"] = name
            data["description"] = body.strip()
            data["taskCount"] = len(_task_files(name))
            out.append(data)
    return out


def get_project(pid):
    pf = os.path.join(_project_dir(pid), "project.md")
    if not os.path.isfile(pf):
        return None
    data, body = parse_md(_read(pf))
    data["id"] = pid
    data["description"] = body.strip()
    data["taskCount"] = len(_task_files(pid))
    return data


def create_project(name, prefix=None, description=""):
    ensure_data()
    base = _slugify(name)
    pid = base
    i = 2
    while os.path.exists(_project_dir(pid)):
        pid = f"{base}-{i}"
        i += 1
    os.makedirs(_tasks_dir(pid), exist_ok=True)
    if not prefix:
        words = [w for w in re.split(r"[\s\-_]+", name) if w]
        prefix = "".join(w[0] for w in words).upper()
        prefix = re.sub(r"[^A-Z0-9]", "", prefix)[:5] or base[:4].upper()
    data = {"name": name, "prefix": prefix.upper(), "created": today()}
    _atomic_write(
        os.path.join(_project_dir(pid), "project.md"), dump_md(data, description)
    )
    return get_project(pid)


def delete_project(pid):
    d = _project_dir(pid)
    if os.path.isdir(d):
        shutil.rmtree(d)
        return True
    return False


# --------------------------------------------------------------------------- #
# Tasks                                                                        #
# --------------------------------------------------------------------------- #
def _normalize(t):
    t.setdefault("status", "backlog")
    t.setdefault("type", "task")
    t.setdefault("priority", "medium")
    if not isinstance(t.get("prompts"), list):
        t["prompts"] = [t["prompts"]] if t.get("prompts") else []
    if t.get("status") not in STATUSES:
        t["status"] = "backlog"
    if t.get("parent") in ("", "null"):
        t["parent"] = None
    if t.get("labels") is None:
        t["labels"] = []
    if not isinstance(t.get("labels"), list):
        t["labels"] = [t["labels"]]
    return t


def list_tasks(pid):
    out = []
    for f in _task_files(pid):
        data, body = parse_md(_read(os.path.join(_tasks_dir(pid), f)))
        data["project"] = pid
        data["description"], data["prompts"] = split_body(body)
        out.append(_normalize(data))
    # newest first by id number, stable enough for display
    return out


def get_task(pid, tid):
    p = os.path.join(_tasks_dir(pid), tid + ".md")
    if not os.path.isfile(p):
        return None
    data, body = parse_md(_read(p))
    data["project"] = pid
    data["description"], data["prompts"] = split_body(body)
    return _normalize(data)


def _next_id(pid):
    prefix = get_project(pid)["prefix"]
    maxn = 0
    pat = re.compile(re.escape(prefix) + r"-(\d+)\.md$")
    for f in _task_files(pid):
        m = pat.match(f)
        if m:
            maxn = max(maxn, int(m.group(1)))
    return f"{prefix}-{maxn + 1}"


def _default_body(title):
    return (
        f"## Description\n\n_What and why for: {title}._\n\n"
        "## Acceptance criteria\n- [ ] \n\n"
        "## Notes\n"
    )


# The task body is split into a free-form description and a dedicated AI prompt
# section. The prompt is what you write for an agent to act on later, so it is
# kept under a clearly named heading that Claude Code can find in the file.
PROMPT_HEADING = "## AI Prompts"
# Accept the legacy singular heading when reading older files.
PROMPT_HEADINGS = ("## ai prompts", "## ai prompt")
# Each prompt is preceded by this marker so multiple multi-line prompts can be
# stored unambiguously while staying readable to a human / agent.
PROMPT_MARKER = "<!-- prompt -->"


def split_body(body):
    """Split a stored body into (description, [prompts]) around the prompt heading."""
    lines = (body or "").split("\n")
    for i, line in enumerate(lines):
        if line.strip().lower() in PROMPT_HEADINGS:
            desc = "\n".join(lines[:i]).strip()
            section = "\n".join(lines[i + 1:]).strip()
            return desc, _parse_prompts(section)
    return (body or "").strip(), []


def _parse_prompts(section):
    if not section.strip():
        return []
    if PROMPT_MARKER in section:
        return [p.strip() for p in section.split(PROMPT_MARKER) if p.strip()]
    # legacy: the whole section was a single prompt
    return [section.strip()]


def join_body(description, prompts):
    """Reassemble a stored body from description + a list of prompts."""
    description = (description or "").strip()
    prompts = [p.strip() for p in (prompts or []) if p and p.strip()]
    if prompts:
        section = PROMPT_HEADING + "\n\n" + "\n\n".join(
            PROMPT_MARKER + "\n" + p for p in prompts
        )
        return (description + "\n\n" + section).strip() + "\n"
    return description


def create_task(
    pid,
    title,
    type="task",
    parent=None,
    status="backlog",
    description="",
    priority="medium",
    labels=None,
    assignee=None,
    prompt="",
    prompts=None,
):
    if get_project(pid) is None:
        raise ValueError("no such project: %s" % pid)
    if parent and get_task(pid, parent) is None:
        raise ValueError("no such parent: %s" % parent)
    tid = _next_id(pid)
    if type not in TYPES:
        type = "task"
    data = {
        "id": tid,
        "title": title,
        "type": type,
        "status": status if status in STATUSES else "backlog",
        "parent": parent or None,
        "priority": priority if priority in PRIORITIES else "medium",
        "assignee": assignee,
        "labels": labels or [],
        "created": today(),
        "updated": today(),
    }
    desc = description.strip() if description and description.strip() else _default_body(title)
    if prompts is None:
        prompts = [prompt] if (prompt and prompt.strip()) else []
    body = join_body(desc, prompts)
    _atomic_write(os.path.join(_tasks_dir(pid), tid + ".md"), dump_md(data, body))
    return get_task(pid, tid)


def update_task(pid, tid, fields):
    p = os.path.join(_tasks_dir(pid), tid + ".md")
    if not os.path.isfile(p):
        return None
    data, body = parse_md(_read(p))

    if "parent" in fields:
        np = fields["parent"] or None
        if np == tid or (np and np in descendant_ids(pid, tid)):
            raise ValueError("invalid parent: would create a cycle")
        fields["parent"] = np

    if any(k in fields for k in ("description", "prompt", "prompts")):
        cur_desc, cur_prompts = split_body(body)
        new_desc = fields.pop("description") if "description" in fields else cur_desc
        if "prompts" in fields:
            new_prompts = fields.pop("prompts") or []
        elif "prompt" in fields:
            v = fields.pop("prompt")
            new_prompts = [v] if (v and v.strip()) else []
        else:
            new_prompts = cur_prompts
        body = join_body(new_desc, new_prompts)

    for k, v in fields.items():
        if k in ("id", "project"):
            continue
        if k == "status" and v not in STATUSES:
            continue
        if k == "type" and v not in TYPES:
            continue
        data[k] = v

    data["updated"] = today()
    _atomic_write(p, dump_md(data, body))
    return get_task(pid, tid)


def descendant_ids(pid, tid):
    """All descendant task ids of tid (children, grandchildren, ...)."""
    tasks = list_tasks(pid)
    children = {}
    for t in tasks:
        children.setdefault(t.get("parent"), []).append(t["id"])
    out, stack = [], list(children.get(tid, []))
    while stack:
        c = stack.pop()
        out.append(c)
        stack.extend(children.get(c, []))
    return out


def delete_task(pid, tid):
    """Delete a task and all of its descendants. Returns the deleted ids."""
    ids = [tid] + descendant_ids(pid, tid)
    for i in ids:
        f = os.path.join(_tasks_dir(pid), i + ".md")
        if os.path.isfile(f):
            os.remove(f)
    return ids


def rollup(pid, tid):
    """Derived progress over all descendants: {done, total} or None if leaf."""
    kids = descendant_ids(pid, tid)
    if not kids:
        return None
    by_id = {t["id"]: t for t in list_tasks(pid)}
    done = sum(1 for i in kids if by_id.get(i, {}).get("status") == "done")
    return {"done": done, "total": len(kids)}
