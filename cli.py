#!/usr/bin/env python3
"""taskhub — command-line interface to the task files.

This exists so Claude Code (or you) can read and update tasks directly, with no
server running. It is a thin wrapper over taskhub_core, the same code the
dashboard uses, so the file format stays consistent.

Usage:
  python3 cli.py projects
  python3 cli.py tasks <project>
  python3 cli.py show <project> <task-id>
  python3 cli.py tree <project>
  python3 cli.py create <project> --title "..." [--type epic|task|subtask]
                                  [--parent ID] [--status backlog] [--priority high]
  python3 cli.py update <project> <task-id> status=dev_in_progress priority=high
  python3 cli.py delete <project> <task-id>
  python3 cli.py seed                # create a demo project to explore
"""

import sys
import json
import taskhub_core as core


def _print_task_row(t):
    pid = t.get("parent") or "-"
    print(
        f"  {t['id']:<10} {t['type']:<8} {t['status']:<16} "
        f"par:{pid:<10} {t['title']}"
    )


def cmd_projects(_):
    for p in core.list_projects():
        print(f"{p['id']:<24} prefix={p.get('prefix'):<8} tasks={p['taskCount']:<4} {p.get('name','')}")


def cmd_tasks(args):
    pid = args[0]
    for t in core.list_tasks(pid):
        _print_task_row(t)


def cmd_show(args):
    pid, tid = args[0], args[1]
    path = core._tasks_dir(pid) + "/" + tid + ".md"
    try:
        print(core._read(path))
    except FileNotFoundError:
        sys.exit(f"no such task: {tid}")


def cmd_tree(args):
    pid = args[0]
    tasks = core.list_tasks(pid)
    children = {}
    for t in tasks:
        children.setdefault(t.get("parent"), []).append(t)

    def walk(node, depth):
        r = core.rollup(pid, node["id"])
        roll = f"  [{r['done']}/{r['total']}]" if r else ""
        print("  " * depth + f"{node['id']} · {node['title']}  ({node['status']}){roll}")
        for c in sorted(children.get(node["id"], []), key=lambda x: x["id"]):
            walk(c, depth + 1)

    for root in sorted(children.get(None, []), key=lambda x: x["id"]):
        walk(root, 0)


def _flags(args):
    out, i = {}, 0
    while i < len(args):
        a = args[i]
        if a.startswith("--"):
            key = a[2:]
            val = args[i + 1] if i + 1 < len(args) else ""
            out[key] = val
            i += 2
        else:
            i += 1
    return out


def cmd_create(args):
    pid = args[0]
    f = _flags(args[1:])
    if not f.get("title"):
        sys.exit("--title is required")
    t = core.create_task(
        pid,
        f["title"],
        type=f.get("type", "task"),
        parent=f.get("parent"),
        status=f.get("status", "backlog"),
        priority=f.get("priority", "medium"),
        description=f.get("description", ""),
        assignee=f.get("assignee"),
        prompt=f.get("prompt", ""),
    )
    print(f"created {t['id']}")


def cmd_update(args):
    pid, tid = args[0], args[1]
    fields = {}
    for kv in args[2:]:
        if "=" in kv:
            k, _, v = kv.partition("=")
            fields[k] = v if v != "" else None
    t = core.update_task(pid, tid, fields)
    if not t:
        sys.exit(f"no such task: {tid}")
    print(f"updated {tid}: " + ", ".join(f"{k}={v}" for k, v in fields.items()))


def cmd_delete(args):
    pid, tid = args[0], args[1]
    ids = core.delete_task(pid, tid)
    print("deleted " + ", ".join(ids))


def cmd_seed(_):
    if any(p["id"] == "demo-product" for p in core.list_projects()):
        print("demo project already exists")
        return
    p = core.create_project(
        "Demo Product",
        prefix="DEMO",
        description="A sample project showing epics, tasks, and nested subtasks.",
    )
    pid = p["id"]
    epic = core.create_task(
        pid, "Launch onboarding flow", type="epic", status="dev_in_progress",
        priority="high",
        description="## Goal\nGet new users to first value in under 2 minutes.\n\n"
        "## Acceptance criteria\n- [ ] Signup → guided setup → first task created\n- [ ] Drop-off tracked\n",
    )
    t1 = core.create_task(
        pid, "Design welcome screen", type="task", parent=epic["id"],
        status="ready_for_review", priority="medium",
        description="## Description\nFirst screen a new user sees.\n\n## Acceptance criteria\n- [x] Wireframe\n- [ ] Final visual\n",
    )
    core.create_task(
        pid, "Pick hero illustration", type="subtask", parent=t1["id"],
        status="done", priority="low",
    )
    core.create_task(
        pid, "Write headline copy", type="subtask", parent=t1["id"],
        status="dev_in_progress", priority="medium",
    )
    t2 = core.create_task(
        pid, "Build setup wizard API", type="task", parent=epic["id"],
        status="ready_for_dev", priority="high",
        description="## Description\nBackend endpoints powering the wizard steps.\n\n## Acceptance criteria\n- [ ] POST /setup/start\n- [ ] POST /setup/complete\n",
    )
    core.create_task(
        pid, "Persist wizard progress", type="subtask", parent=t2["id"],
        status="backlog", priority="medium",
    )
    core.create_task(
        pid, "Instrument funnel analytics", type="task", parent=epic["id"],
        status="backlog", priority="medium",
    )
    core.create_task(
        pid, "Refine billing settings page", type="epic", status="refinement",
        priority="low",
        description="## Goal\nClean up the billing UX before GA.\n",
    )
    print(f"seeded project '{p['name']}' (id={pid}) with epics, tasks and subtasks")


COMMANDS = {
    "projects": cmd_projects,
    "tasks": cmd_tasks,
    "show": cmd_show,
    "tree": cmd_tree,
    "create": cmd_create,
    "update": cmd_update,
    "delete": cmd_delete,
    "seed": cmd_seed,
}


def main():
    args = sys.argv[1:]
    if not args or args[0] in ("-h", "--help", "help"):
        print(__doc__)
        return
    cmd = args[0]
    fn = COMMANDS.get(cmd)
    if not fn:
        sys.exit(f"unknown command: {cmd}\nrun: python3 cli.py --help")
    try:
        fn(args[1:])
    except IndexError:
        sys.exit("missing arguments — run: python3 cli.py --help")
    except ValueError as e:
        sys.exit(f"error: {e}")


if __name__ == "__main__":
    main()
