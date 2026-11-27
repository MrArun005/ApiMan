#!/usr/bin/env python3
"""ApiMan as an MCP server: AI assistants (Claude Code, Claude Desktop, any MCP client) use your collections,
environments and Robot Framework projects through ApiMan.

    claude mcp add apiman -- python3 /path/to/ApiMan/mcp_server.py --data ~/ApiMan-data

It speaks MCP over stdio (JSON-RPC 2.0, one message per line) and works straight from the data folder: ApiMan
doesn't have to be running. Python standard library only, like server.py, whose code it reuses.

What an assistant can do (tools): list collections, requests and environments (variable names only, never their
values); send a saved request with an environment (variables, path variables and auth applied, through server.py's
send: cookies, redirects, decoding); send a one-off request; list Robot projects, run one and read the result; list
runs. Runs started here show in ApiMan's Automation History too.

Not here: pre-request and test scripts (they run in the app's sandboxed browser worker) and OAuth 2.0 sign-in.
"""
import argparse
import base64
import json
import random
import re
import sys
import time
import urllib.parse
import uuid
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import server  # noqa: E402  (ApiMan's server: stores, send, Robot runs)

PROTOCOL = "2025-06-18"
VAR_RE = re.compile(r"{{\s*([^{}]+?)\s*}}")
MAX_BODY_OUT = 60_000  # characters of a response body handed to the assistant


# ---------------------------------------------------------------- the data folder
class ApiMan:
    def __init__(self, data):
        self.root = Path(data).expanduser().resolve()
        self.stores = server.make_stores(self.root)
        server.Handler.stores = self.stores

    def collections(self):
        return self.stores["collections"].list()

    def find_collection(self, ref):
        ref = str(ref or "").strip()
        rows = self.collections()
        hit = next((c for c in rows if c["id"] == ref), None) or next((c for c in rows if c["name"].lower() == ref.lower()), None)
        if not hit:
            raise ValueError(f"No collection {ref!r}. Collections: {', '.join(c['name'] for c in rows) or 'none'}.")
        return hit, self.stores["collections"].get(hit["id"])

    def environments(self):
        return [e for e in self.stores["environments"].list() if e["id"] != "globals.json"]

    def env_values(self, ref):
        if not ref:
            return {}, None
        rows = self.environments()
        hit = next((e for e in rows if e["id"] == ref), None) or next((e for e in rows if e["name"].lower() == str(ref).lower()), None)
        if not hit:
            raise ValueError(f"No environment {ref!r}. Environments: {', '.join(e['name'] for e in rows) or 'none'}.")
        doc = self.stores["environments"].get(hit["id"])
        return {v["key"]: str(v.get("value", "")) for v in doc.get("values", []) if v.get("key") and v.get("enabled", True) is not False}, hit

    def globals(self):
        try:
            doc = self.stores["environments"].get("globals.json")
            return {v["key"]: str(v.get("value", "")) for v in doc.get("values", []) if v.get("key") and v.get("enabled", True) is not False}
        except (FileNotFoundError, ValueError, KeyError):
            return {}


def walk(items, parents=()):
    """Every request of a collection with its folder path and the auth it inherits."""
    for it in items or []:
        if isinstance(it.get("item"), list):
            yield from walk(it["item"], parents + (it,))
        elif isinstance(it.get("request"), (dict, str)):
            yield it, parents


def raw_url(req):
    u = req.get("url") if isinstance(req, dict) else req
    if isinstance(u, dict):
        return u.get("raw") or "", {v.get("key"): str(v.get("value", "")) for v in u.get("variable") or [] if v.get("key")}
    return str(u or ""), {}


def resolve(text, vars_):
    s = str(text or "")
    dyn = {"$guid": lambda: str(uuid.uuid4()), "$randomUUID": lambda: str(uuid.uuid4()), "$timestamp": lambda: str(int(time.time())),
           "$isoTimestamp": lambda: time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), "$randomInt": lambda: str(random.randint(0, 1000))}
    for _ in range(10):
        nxt = VAR_RE.sub(lambda m: vars_[m.group(1)] if m.group(1) in vars_ else dyn[m.group(1)]() if m.group(1) in dyn else m.group(0), s)
        if nxt == s:
            break
        s = nxt
    return s


def effective_auth(item, parents, col):
    for owner in [item.get("request") if isinstance(item.get("request"), dict) else {}, *reversed(parents), col]:
        auth = (owner or {}).get("auth")
        if auth and auth.get("type") != "inherit":
            return auth
    return None


def auth_param(auth, key):
    for p in auth.get(auth.get("type"), []) or []:
        if p.get("key") == key:
            return str(p.get("value", ""))
    return ""


def build_request(col, item, parents, vars_):
    """A saved request as server.send's spec: variables, path variables, query, headers, body and auth."""
    req = item["request"] if isinstance(item["request"], dict) else {"url": item["request"], "method": "GET"}
    url, path_vars = raw_url(req)
    url = resolve(url, vars_)
    for k, v in path_vars.items():
        url = re.sub(rf"(?<=/):{re.escape(k)}(?=/|\?|#|$)", urllib.parse.quote(resolve(v, vars_), safe=""), url)
    left = sorted(set(VAR_RE.findall(url)))
    headers = [[resolve(h.get("key"), vars_), resolve(h.get("value"), vars_)] for h in req.get("header") or [] if h.get("key") and not h.get("disabled")]
    body, b = None, req.get("body") or {}
    has = lambda name: any(k.lower() == name for k, _ in headers)
    if b.get("mode") == "raw" and b.get("raw"):
        body = resolve(b["raw"], vars_)
        lang = ((b.get("options") or {}).get("raw") or {}).get("language")
        if lang == "json" and not has("content-type"):
            headers.append(["Content-Type", "application/json"])
    elif b.get("mode") == "urlencoded":
        body = urllib.parse.urlencode([(resolve(p.get("key"), vars_), resolve(p.get("value"), vars_)) for p in b.get("urlencoded") or [] if p.get("key") and not p.get("disabled")])
        if not has("content-type"):
            headers.append(["Content-Type", "application/x-www-form-urlencoded"])
    elif b.get("mode") == "graphql":
        g = b.get("graphql") or {}
        try:
            gv = json.loads(resolve(g.get("variables") or "{}", vars_) or "{}")
        except ValueError:
            gv = {}
        body = json.dumps({"query": resolve(g.get("query"), vars_), "variables": gv})
        if not has("content-type"):
            headers.append(["Content-Type", "application/json"])
    elif b.get("mode") == "formdata":
        raise ValueError("Form-data bodies (file uploads) aren't sent from MCP: send this request in ApiMan.")
    auth = effective_auth(item, parents, col)
    if auth:
        t = auth.get("type")
        if t == "bearer" and not has("authorization"):
            headers.append(["Authorization", f"Bearer {resolve(auth_param(auth, 'token'), vars_)}"])
        elif t == "basic" and not has("authorization"):
            cred = f"{resolve(auth_param(auth, 'username'), vars_)}:{resolve(auth_param(auth, 'password'), vars_)}"
            headers.append(["Authorization", "Basic " + base64.b64encode(cred.encode()).decode()])
        elif t == "apikey":
            k, v = resolve(auth_param(auth, "key"), vars_), resolve(auth_param(auth, "value"), vars_)
            if auth_param(auth, "in") == "query":
                url += ("&" if "?" in url else "?") + urllib.parse.urlencode({k: v})
            elif k:
                headers.append([k, v])
        elif t == "oauth2":
            raise ValueError("This request uses OAuth 2.0: sign in and send it in ApiMan (MCP doesn't open sign-in windows).")
        elif t not in (None, "noauth"):
            raise ValueError(f"Auth type {t!r} isn't supported from MCP.")
    left += sorted({m for _, v in headers for m in VAR_RE.findall(v)} | set(VAR_RE.findall(body or "")))
    if left:
        raise ValueError(f"Unknown variable{'s' if len(set(left)) > 1 else ''} {', '.join('{{' + x + '}}' for x in sorted(set(left)))}: pick an environment that defines them.")
    return {"method": str(req.get("method") or "GET").upper(), "url": url, "headers": headers, "body": body}


def response_out(res, spec):
    if res.get("error"):
        return {"error": res["error"]}
    body = res.get("body")
    shown = body if body is not None else f"<binary body, {res.get('size', 0)} bytes>"
    return {"request": {"method": spec["method"], "url": server.mask_url(spec["url"])},
            "status": res.get("status"), "reason": res.get("reason"), "timeMs": res.get("timeMs"), "size": res.get("size"),
            "headers": server.mask_headers(dict(res.get("headers") or [])),  # Set-Cookie, tokens: never handed to the assistant
            "body": shown[:MAX_BODY_OUT] + (f"\n… {len(shown) - MAX_BODY_OUT} more characters" if len(shown) > MAX_BODY_OUT else ""),
            **({"finalUrl": server.mask_url(res["finalUrl"])} if res.get("finalUrl") and res.get("finalUrl") != spec["url"] else {}),
            **({"warning": f"Stopped after {res.get('redirectLimit')} redirects."} if res.get("redirectLimitHit") else {})}


# ---------------------------------------------------------------- tools
def t_list_collections(app, a):
    out = []
    for c in app.collections():
        try:
            n = sum(1 for _ in walk(app.stores["collections"].get(c["id"]).get("item")))
        except (FileNotFoundError, ValueError):
            n = None
        out.append({"id": c["id"], "name": c["name"], "folder": c.get("folder", ""), "requests": n})
    return out


def t_list_requests(app, a):
    _, col = app.find_collection(a.get("collection"))
    rows = []
    for it, parents in walk(col.get("item")):
        req = it["request"] if isinstance(it["request"], dict) else {"url": it["request"]}
        rows.append({"name": it.get("name"), "folder": " / ".join(p.get("name", "") for p in parents), "method": str(req.get("method") or "GET").upper(), "url": raw_url(req)[0]})
    return rows


def t_list_environments(app, a):
    out = []
    for e in app.environments():
        doc = app.stores["environments"].get(e["id"])
        out.append({"id": e["id"], "name": e["name"], "variables": [v["key"] for v in doc.get("values", []) if v.get("key")]})
    return out


def t_send_request(app, a):
    meta, col = app.find_collection(a.get("collection"))
    name = str(a.get("request") or "").strip()
    found = [(it, p) for it, p in walk(col.get("item")) if it.get("name") == name or " / ".join([*(x.get("name", "") for x in p), it.get("name", "")]) == name]
    if not found:
        raise ValueError(f"No request {name!r} in {meta['name']}. Use list_requests to see them.")
    if len(found) > 1:
        raise ValueError(f"{len(found)} requests are called {name!r}: name it with its folder, e.g. 'Folder / {name}'.")
    item, parents = found[0]
    env, _ = app.env_values(a.get("environment"))
    vars_ = {**app.globals(), **{v["key"]: str(v.get("value", "")) for v in col.get("variable") or [] if v.get("key") and not v.get("disabled")}, **env,
             **{str(k): str(v) for k, v in (a.get("variables") or {}).items()}}
    spec = build_request(col, item, parents, vars_)
    res = server.send({**spec, "timeout": a.get("timeout") or 60}, app.root)
    return response_out(res, spec)


def t_send_http(app, a):
    spec = {"method": str(a.get("method") or "GET").upper(), "url": str(a.get("url") or ""),
            "headers": [[str(k), str(v)] for k, v in (a.get("headers") or {}).items()], "body": a.get("body")}
    if isinstance(spec["body"], (dict, list)):
        spec["body"] = json.dumps(spec["body"])
        if not any(k.lower() == "content-type" for k, _ in spec["headers"]):
            spec["headers"].append(["Content-Type", "application/json"])
    return response_out(server.send({**spec, "timeout": a.get("timeout") or 60}, app.root), spec)


def t_list_robot_projects(app, a):
    out = []
    for p in server.robot_projects(app.root):
        try:
            d = server.robot_project(app.root, p["id"])
            out.append({"id": p["id"], "name": p["name"], "linked": bool(p.get("linked")), "tests": sum(len(s["tests"]) for s in d["suites"]),
                        "suites": [{"path": s["path"], "tests": [t["name"] for t in s["tests"]]} for s in d["suites"]],
                        "tags": sorted({tag for s in d["suites"] for t in s["tests"] for tag in t["tags"]}), "needs": [k["name"] for k in d.get("keys", [])]})
        except (OSError, ValueError) as e:
            out.append({"id": p["id"], "name": p["name"], "error": str(e)})
    return out


def run_result(app, run_id):
    out = server.robot_run_dir(app.root, run_id)
    meta = server.read_meta(out)
    fails = [{"test": t["name"], "suite": t.get("suite", ""), "message": t.get("message", "")} for t in meta.get("tests", []) if t.get("status") == "FAIL"]
    return {"id": run_id, "project": meta.get("projectName"), "target": meta.get("target"), "status": meta.get("status"),
            "passed": meta.get("passed"), "failed": meta.get("failed"), "skipped": meta.get("skipped"), "apiCalls": meta.get("http"),
            "seconds": round((meta.get("ended") or time.time()) - meta.get("started", time.time()), 2), "environment": meta.get("env"),
            "failures": fails[:30], "report": str(out / "report.html")}


def t_run_robot(app, a):
    projects = server.robot_projects(app.root)
    ref = str(a.get("project") or "")
    hit = next((p for p in projects if p["id"] == ref or p["name"].lower() == ref.lower()), None)
    if not hit:
        raise ValueError(f"No Robot project {ref!r}. Projects: {', '.join(p['name'] for p in projects) or 'none'}.")
    env_id = ""
    if a.get("environment"):
        _, e = app.env_values(a["environment"])
        env_id = e["id"]
    meta = server.robot_start(app.root, app.stores, {"project": hit["id"], "suite": a.get("suite") or ".", "test": a.get("test") or "",
                                                       "include": a.get("tags") or "", "envId": env_id, "speed": "full"})
    deadline = time.time() + max(10, min(int(a.get("timeout") or 900), 3600))
    while time.time() < deadline:
        with server.RUNS_LOCK:
            done = meta["id"] not in server.RUNS
        if done:
            return run_result(app, meta["id"])
        time.sleep(1)
    server.robot_stop(meta["id"])
    return {**run_result(app, meta["id"]), "note": "Stopped: it ran longer than the timeout."}


def t_list_runs(app, a):
    pid = None
    if a.get("project"):
        hit = next((p for p in server.robot_projects(app.root) if p["id"] == a["project"] or p["name"].lower() == str(a["project"]).lower()), None)
        pid = hit["id"] if hit else a["project"]
    return [{"id": r["id"], "project": r.get("projectName"), "kind": r.get("kind") or "robot", "target": r.get("target"), "status": r.get("status"),
             "passed": r.get("passed"), "failed": r.get("failed"), "started": time.strftime("%Y-%m-%d %H:%M", time.localtime(r.get("started", 0)))}
            for r in server.robot_runs(app.root, pid, int(a.get("limit") or 20))]


def t_get_run(app, a):
    return run_result(app, str(a.get("id") or ""))


S = lambda **props: {"type": "object", "properties": props, "additionalProperties": False}
STR = lambda d: {"type": "string", "description": d}
TOOLS = {
    "list_collections": (t_list_collections, "List the Postman collections in ApiMan's data folder, with how many requests each has.", S()),
    "list_requests": (t_list_requests, "List the saved requests of a collection: name, folder, method and URL (with its {{variables}}).",
                      {**S(collection=STR("Collection name or id")), "required": ["collection"]}),
    "list_environments": (t_list_environments, "List environments and the names of their variables (values are never shown).", S()),
    "send_request": (t_send_request, "Send a saved request from a collection, with an environment's variables and the request's auth (bearer, basic, API key). "
                     "Returns status, headers and body. Pre-request and test scripts don't run here.",
                     {**S(collection=STR("Collection name or id"), request=STR("Request name, or 'Folder / Name' when names repeat"),
                          environment=STR("Environment name or id (optional)"), variables={"type": "object", "description": "Extra variables that win over the environment (optional)"},
                          timeout={"type": "number", "description": "Seconds (default 60)"}), "required": ["collection", "request"]}),
    "send_http": (t_send_http, "Send a one-off HTTP request from this computer (works over VPN, no CORS). Returns status, headers and body.",
                  {**S(method=STR("GET, POST, …"), url=STR("http:// or https:// URL"), headers={"type": "object", "description": "Header name to value"},
                       body={"description": "A string, or JSON (sent as application/json)"}, timeout={"type": "number"}), "required": ["url"]}),
    "list_robot_projects": (t_list_robot_projects, "List the Robot Framework projects ApiMan knows (in the data folder or linked): suites, tests, tags and the variables they need.", S()),
    "run_robot": (t_run_robot, "Run a Robot Framework project (or one suite, test or tags) and wait for the result: passed, failed, each failure's message and the report path. "
                  "The run shows in ApiMan's Automation History.",
                  {**S(project=STR("Project name or id"), suite=STR("Suite path, e.g. tests/api (optional)"), test=STR("One test's name (optional)"),
                       tags=STR("Only tests with these tags, comma-separated (optional)"), environment=STR("ApiMan environment for its variables (optional)"),
                       timeout={"type": "number", "description": "Seconds to wait (default 900)"}), "required": ["project"]}),
    "list_runs": (t_list_runs, "List recent Robot and collection runs, newest first.", S(project=STR("Only this project (optional)"), limit={"type": "number"})),
    "get_run": (t_get_run, "One run's result: status, counts, failures and its report path.", {**S(id=STR("Run id from list_runs or run_robot")), "required": ["id"]}),
}


# ---------------------------------------------------------------- MCP over stdio
def handle(app, msg):
    method, mid, params = msg.get("method"), msg.get("id"), msg.get("params") or {}
    if mid is None:
        return None  # notifications (initialized, cancelled): nothing to answer
    if method == "initialize":
        return {"protocolVersion": params.get("protocolVersion") or PROTOCOL, "capabilities": {"tools": {}},
                "serverInfo": {"name": "apiman", "version": "1.0.0"},
                "instructions": f"ApiMan's data folder: {app.root}. Collections, environments and Robot projects come from there."}
    if method == "ping":
        return {}
    if method == "tools/list":
        return {"tools": [{"name": n, "description": d, "inputSchema": s} for n, (_, d, s) in TOOLS.items()]}
    if method == "tools/call":
        name = params.get("name")
        if name not in TOOLS:
            raise LookupError(f"Unknown tool: {name}")
        try:
            out = TOOLS[name][0](app, params.get("arguments") or {})
            return {"content": [{"type": "text", "text": json.dumps(out, ensure_ascii=False, indent=1)}]}
        except Exception as e:  # a tool's failure is the assistant's to read, not a protocol error
            return {"content": [{"type": "text", "text": f"Error: {e}"}], "isError": True}
    raise LookupError(f"Method not found: {method}")


def main():
    ap = argparse.ArgumentParser(description="ApiMan as an MCP server (stdio)")
    ap.add_argument("--data", default=None, help="ApiMan's data folder (default: the desktop app's, else ./collections)")
    args = ap.parse_args()
    app = ApiMan(args.data or server.desktop_data_dir())
    out = sys.stdout
    sys.stdout = sys.stderr  # anything printed (Robot runs announce themselves) must never corrupt the protocol stream
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            msg = json.loads(line)
        except ValueError:
            out.write(json.dumps({"jsonrpc": "2.0", "id": None, "error": {"code": -32700, "message": "Parse error"}}) + "\n")
            out.flush()
            continue
        try:
            result = handle(app, msg)
            reply = None if result is None else {"jsonrpc": "2.0", "id": msg.get("id"), "result": result}
        except LookupError as e:
            reply = {"jsonrpc": "2.0", "id": msg.get("id"), "error": {"code": -32601, "message": str(e)}}
        except Exception as e:
            reply = {"jsonrpc": "2.0", "id": msg.get("id"), "error": {"code": -32603, "message": str(e)}}
        if reply:
            out.write(json.dumps(reply, ensure_ascii=False) + "\n")
            out.flush()
    server.stop_all_runs()


if __name__ == "__main__":
    main()
