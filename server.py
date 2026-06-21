"""TaskHub dashboard server — pure standard library, no pip installs.

Run:  python3 server.py   then open  http://localhost:5174

It serves the static frontend in ./public and a small JSON REST API that reads
and writes the markdown task files via taskhub_core. The files remain the source
of truth: Claude Code can edit them directly even when this server is not running.
"""

import os
import re
import json
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import taskhub_core as core

PUBLIC = os.path.join(core.ROOT, "public")
ROUTES = []  # list of (method, compiled_pattern, handler)


def route(method, pattern):
    def deco(fn):
        ROUTES.append((method, re.compile("^" + pattern + "$"), fn))
        return fn

    return deco


# --------------------------------------------------------------------------- #
# API handlers — each returns (status_code, json_serializable)                 #
# --------------------------------------------------------------------------- #
@route("GET", r"/api/meta")
def _meta(h, m, body):
    return 200, {
        "statuses": core.STATUSES,
        "statusLabels": core.STATUS_LABELS,
        "types": core.TYPES,
        "priorities": core.PRIORITIES,
    }


@route("GET", r"/api/projects")
def _projects(h, m, body):
    return 200, core.list_projects()


@route("POST", r"/api/projects")
def _create_project(h, m, body):
    name = (body.get("name") or "").strip()
    if not name:
        return 400, {"error": "name is required"}
    return 201, core.create_project(name, body.get("prefix"), body.get("description", ""))


@route("DELETE", r"/api/projects/([^/]+)")
def _delete_project(h, m, body):
    core.delete_project(m.group(1))
    return 200, {"ok": True}


@route("GET", r"/api/projects/([^/]+)/tasks")
def _list_tasks(h, m, body):
    if core.get_project(m.group(1)) is None:
        return 404, {"error": "no such project"}
    tasks = core.list_tasks(m.group(1))
    for t in tasks:
        t["rollup"] = core.rollup(m.group(1), t["id"])
    return 200, tasks


@route("POST", r"/api/projects/([^/]+)/tasks")
def _create_task(h, m, body):
    title = (body.get("title") or "").strip()
    if not title:
        return 400, {"error": "title is required"}
    try:
        t = core.create_task(
            m.group(1),
            title,
            type=body.get("type", "task"),
            parent=body.get("parent"),
            status=body.get("status", "backlog"),
            description=body.get("description", ""),
            priority=body.get("priority", "medium"),
            labels=body.get("labels"),
            assignee=body.get("assignee"),
            prompt=body.get("prompt", ""),
            prompts=body.get("prompts"),
        )
    except ValueError as e:
        return 400, {"error": str(e)}
    return 201, t


@route("GET", r"/api/projects/([^/]+)/tasks/([^/]+)")
def _get_task(h, m, body):
    t = core.get_task(m.group(1), m.group(2))
    if not t:
        return 404, {"error": "not found"}
    t["rollup"] = core.rollup(m.group(1), t["id"])
    return 200, t


def _update(h, m, body):
    try:
        t = core.update_task(m.group(1), m.group(2), body)
    except ValueError as e:
        return 400, {"error": str(e)}
    if not t:
        return 404, {"error": "not found"}
    t["rollup"] = core.rollup(m.group(1), t["id"])
    return 200, t


route("PATCH", r"/api/projects/([^/]+)/tasks/([^/]+)")(_update)
route("PUT", r"/api/projects/([^/]+)/tasks/([^/]+)")(_update)


@route("DELETE", r"/api/projects/([^/]+)/tasks/([^/]+)")
def _delete_task(h, m, body):
    return 200, {"deleted": core.delete_task(m.group(1), m.group(2))}


# --------------------------------------------------------------------------- #
# HTTP plumbing                                                                #
# --------------------------------------------------------------------------- #
_CTYPES = {
    ".html": "text/html",
    ".js": "application/javascript",
    ".css": "text/css",
    ".svg": "image/svg+xml",
}


class Handler(BaseHTTPRequestHandler):
    def _json(self, status, obj):
        data = json.dumps(obj).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def _read_body(self):
        length = int(self.headers.get("Content-Length") or 0)
        if not length:
            return {}
        raw = self.rfile.read(length)
        try:
            return json.loads(raw or b"{}")
        except json.JSONDecodeError:
            return {}

    def _dispatch(self, method):
        path = self.path.split("?", 1)[0]
        if path.startswith("/api/"):
            body = self._read_body() if method in ("POST", "PUT", "PATCH") else {}
            for mth, pat, fn in ROUTES:
                if mth != method:
                    continue
                mm = pat.match(path)
                if mm:
                    try:
                        status, obj = fn(self, mm, body)
                    except Exception as e:  # never crash the server on one bad request
                        status, obj = 500, {"error": str(e)}
                    return self._json(status, obj)
            return self._json(404, {"error": "no such route"})
        if method == "GET":
            return self._serve_static(path)
        return self._json(405, {"error": "method not allowed"})

    def _serve_static(self, path):
        if path in ("", "/"):
            path = "/index.html"
        fp = os.path.normpath(os.path.join(PUBLIC, path.lstrip("/")))
        if not fp.startswith(PUBLIC) or not os.path.isfile(fp):
            return self._json(404, {"error": "not found"})
        with open(fp, "rb") as f:
            data = f.read()
        ctype = _CTYPES.get(os.path.splitext(fp)[1], "application/octet-stream")
        self.send_response(200)
        self.send_header("Content-Type", ctype + "; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        self._dispatch("GET")

    def do_POST(self):
        self._dispatch("POST")

    def do_PATCH(self):
        self._dispatch("PATCH")

    def do_PUT(self):
        self._dispatch("PUT")

    def do_DELETE(self):
        self._dispatch("DELETE")

    def log_message(self, *args):
        pass  # quiet


def main():
    core.ensure_data()
    port = int(os.environ.get("PORT", "5174"))
    print(f"TaskHub running at  http://localhost:{port}")
    print(f"Task files live in  {core.DATA_DIR}")
    ThreadingHTTPServer(("127.0.0.1", port), Handler).serve_forever()


if __name__ == "__main__":
    main()
