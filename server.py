#!/usr/bin/env python3
"""
ApiMan local server: a private, local Postman-style API client. Python standard library only.

    python3 server.py                      # http://127.0.0.1:5577, data in ./collections
    python3 server.py --data ~/my-apis     # keep collections + environments somewhere else
    python3 server.py --port 6000 --no-browser
    python3 server.py --ca-file ~/company-root-ca.pem   # internal HTTPS APIs signed by your company CA

Requests are sent from THIS machine, so they go through whatever VPN you are connected to.
Collections are Postman v2.1 JSON files; environments are Postman environment JSON files.
"""
import argparse
import base64
import json
import os
import re
import ssl
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request
import webbrowser
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

HERE = Path(__file__).resolve().parent
ID_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._ -]{0,120}\.json$")
METHOD_RE = re.compile(r"^[A-Z]{1,16}$")
MAX_REQUEST = 50 * 1024 * 1024    # what the browser may send us
MAX_RESPONSE = 20 * 1024 * 1024   # what we read back from the target API
SCHEMA_V21 = "https://schema.getpostman.com/json/collection/v2.1.0/collection.json"
CA_FILE = None  # extra trusted CA bundle (PEM), set by --ca-file
STATIC = {"/": ("index.html", "text/html"), "/index.html": ("index.html", "text/html"),
          "/app.js": ("app.js", "text/javascript"), "/app.css": ("app.css", "text/css")}


def validate_collection(data):
    if not (isinstance(data, dict) and isinstance(data.get("info"), dict)
            and isinstance(data["info"].get("name"), str) and isinstance(data.get("item"), list)):
        raise ValueError("Not a Postman v2 collection (needs info.name and item[]). "
                         "In Postman: Export -> Collection v2.1.")


def validate_environment(data):
    if not (isinstance(data, dict) and isinstance(data.get("name"), str) and isinstance(data.get("values"), list)):
        raise ValueError("Not a Postman environment (needs name and values[]).")


class Store:
    """One document = one JSON file in a folder."""

    def __init__(self, root, validate, name_of):
        self.root = Path(root).expanduser().resolve()
        self.root.mkdir(parents=True, exist_ok=True)
        self.validate = validate
        self.name_of = name_of

    def path(self, doc_id):
        if not ID_RE.match(doc_id):
            raise ValueError("Invalid id")
        p = (self.root / doc_id).resolve()
        if p.parent != self.root:  # no ../ escapes
            raise ValueError("Invalid id")
        return p

    def list(self):
        out = []
        for p in sorted(self.root.glob("*.json"), key=lambda p: p.name.lower()):
            try:
                name = self.name_of(json.loads(p.read_text("utf-8")))
            except Exception:
                name = p.stem + " (unreadable)"
            out.append({"id": p.name, "name": name})
        return out

    def get(self, doc_id):
        return json.loads(self.path(doc_id).read_text("utf-8"))

    def put(self, doc_id, data):
        self.validate(data)
        p = self.path(doc_id)
        # Atomic write: a crash mid-save never leaves a half-written file.
        fd, tmp = tempfile.mkstemp(dir=self.root, suffix=".tmp")
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            json.dump(data, f, indent=2, ensure_ascii=False)
        os.replace(tmp, p)

    def create(self, data):
        self.validate(data)
        base = re.sub(r"[^A-Za-z0-9._-]+", "-", self.name_of(data)).strip("-.")[:80] or "untitled"
        doc_id, n = f"{base}.json", 2
        while (self.root / doc_id).exists():
            doc_id, n = f"{base}-{n}.json", n + 1
        self.put(doc_id, data)
        return doc_id

    def delete(self, doc_id):
        self.path(doc_id).unlink()


def make_stores(root):
    root = Path(root).expanduser().resolve()
    return {
        "collections": Store(root, validate_collection, lambda d: d["info"]["name"]),
        "environments": Store(root / "environments", validate_environment, lambda d: d["name"]),
    }


# Allowlist, not denylist: custom credential headers (X-Api-Key, X-Auth-Token, ...) can have any name.
CROSS_ORIGIN_SAFE_HEADERS = {"accept", "accept-language", "user-agent", "content-type"}


class RedirectRefused(Exception):
    pass


class SafeRedirect(urllib.request.HTTPRedirectHandler):
    """Follows redirects like Postman, but only harmless headers survive a change of origin."""

    def __init__(self):
        super().__init__()
        self.stripped = []  # header names dropped on cross-origin redirects, reported to the UI

    @staticmethod
    def origin(url):
        u = urllib.parse.urlsplit(url)
        return u.scheme, u.hostname, u.port or (443 if u.scheme == "https" else 80)

    def redirect_request(self, req, fp, code, msg, headers, newurl):
        new = super().redirect_request(req, fp, code, msg, headers, newurl)
        if new is None:
            return None
        old_origin, new_origin = self.origin(req.full_url), self.origin(new.full_url)
        if old_origin[0] == "https" and new_origin[0] != "https":
            raise RedirectRefused(f"Refused redirect from HTTPS to insecure {new.full_url}")
        if old_origin != new_origin:
            # urllib only copies req.headers (never unredirected_hdrs) into the new request.
            kept = {k: v for k, v in new.headers.items() if k.lower() in CROSS_ORIGIN_SAFE_HEADERS}
            self.stripped += [k for k in new.headers if k not in kept and k not in self.stripped]
            new.headers = kept
        return new


class NoRedirect(urllib.request.HTTPRedirectHandler):
    """Returns the 3xx response itself (the 'Follow redirects' setting is off)."""

    def redirect_request(self, *args, **kwargs):
        return None


def send(spec):
    """Execute one HTTP request exactly as described by the UI (variables, auth and scripts already applied)."""
    method = str(spec.get("method", "GET")).upper()
    url = str(spec.get("url", "")).strip()
    if not METHOD_RE.match(method):
        return {"error": f"Invalid method: {method}"}
    if not re.match(r"^https?://", url, re.I):
        return {"error": "URL must start with http:// or https://"}

    if spec.get("bodyBase64") is not None:
        try:
            data = base64.b64decode(spec["bodyBase64"], validate=True)
        except ValueError:
            return {"error": "Invalid binary body"}
    else:
        body = spec.get("body")
        data = body.encode("utf-8") if isinstance(body, str) and body != "" else None
    if data is None and method in ("POST", "PUT", "PATCH"):
        data = b""  # send Content-Length: 0 instead of no length (some servers answer 411)

    req = urllib.request.Request(url, data=data, method=method)
    for key, value in spec.get("headers", []):
        req.add_header(str(key), str(value))
    if not req.has_header("User-agent"):
        req.add_header("User-Agent", "ApiMan/1.0")

    ctx = ssl.create_default_context()
    if CA_FILE:
        ctx.load_verify_locations(cafile=CA_FILE)  # trust your company's CA: the safe fix for internal certs
    if spec.get("insecure"):
        # Last resort, opt-in in Settings: skips certificate checks (exposes you to MITM). Off by default.
        ctx.check_hostname = False
        ctx.verify_mode = ssl.CERT_NONE
    redirects = SafeRedirect() if spec.get("followRedirects", True) else NoRedirect()
    opener = urllib.request.build_opener(urllib.request.HTTPSHandler(context=ctx), redirects)

    start = time.perf_counter()
    try:
        resp = opener.open(req, timeout=max(1.0, min(float(spec.get("timeout", 60)), 600.0)))
    except urllib.error.HTTPError as e:   # 4xx/5xx (and unfollowed 3xx) still have a useful response
        resp = e
    except RedirectRefused as e:
        return {"error": str(e)}
    except urllib.error.URLError as e:
        return {"error": f"Could not connect: {e.reason}"}
    except Exception as e:  # timeouts, bad TLS, etc.
        return {"error": f"{type(e).__name__}: {e}"}

    with resp:
        raw = resp.read(MAX_RESPONSE + 1)
    elapsed_ms = round((time.perf_counter() - start) * 1000)
    truncated = len(raw) > MAX_RESPONSE
    raw = raw[:MAX_RESPONSE]
    try:
        text, b64 = raw.decode("utf-8"), None
    except UnicodeDecodeError:
        text, b64 = None, base64.b64encode(raw).decode("ascii")  # images, PDFs, zips: downloadable in the UI
    return {
        "status": resp.status,
        "reason": resp.reason,
        "headers": list(resp.headers.items()),
        "body": text,
        "bodyBase64": b64,
        "binary": text is None,
        "size": len(raw),
        "truncated": truncated,
        "timeMs": elapsed_ms,
        "finalUrl": resp.geturl(),
        "redirectStripped": getattr(redirects, "stripped", []),
    }


class Handler(BaseHTTPRequestHandler):
    stores = None  # set in main()

    # ---- safety: this server can reach your VPN, so only our own page may talk to it ----
    def allowed(self):
        port = self.server.server_address[1]
        hosts = {f"127.0.0.1:{port}", f"localhost:{port}"}
        if self.headers.get("Host") not in hosts:  # blocks DNS-rebinding attacks
            return False
        origin = self.headers.get("Origin")
        # Blocks other websites in your browser from using this as a proxy into your network.
        return origin is None or origin in {f"http://{h}" for h in hosts}

    def route(self, method):
        if not self.allowed():
            return self.reply(403, {"error": "Forbidden"})
        path = urllib.parse.urlparse(self.path).path
        try:
            if method == "GET" and path in STATIC:
                name, ctype = STATIC[path]
                return self.reply_file(HERE / name, ctype)
            if method == "GET" and path == "/api/info":
                return self.reply(200, {"dataDir": str(self.stores["collections"].root)})
            if method == "POST" and path == "/api/send":
                return self.reply(200, send(self.read_json()))
            m = re.match(r"^/api/(collections|environments)(?:/(.+))?$", path)
            if m:
                store, doc_id = self.stores[m.group(1)], m.group(2) and urllib.parse.unquote(m.group(2))
                if doc_id is None and method == "GET":
                    return self.reply(200, store.list())
                if doc_id is None and method == "POST":
                    body = self.read_json()
                    data = body.get("collection") or body.get("document") or {
                        "info": {"name": body.get("name") or "New collection", "schema": SCHEMA_V21}, "item": []}
                    return self.reply(201, {"id": store.create(data)})
                if doc_id and method == "GET":
                    return self.reply(200, store.get(doc_id))
                if doc_id and method == "PUT":
                    store.put(doc_id, self.read_json())
                    return self.reply(200, {"ok": True})
                if doc_id and method == "DELETE":
                    store.delete(doc_id)
                    return self.reply(200, {"ok": True})
            return self.reply(404, {"error": "Not found"})
        except FileNotFoundError:
            return self.reply(404, {"error": "Not found"})
        except (ValueError, json.JSONDecodeError) as e:
            return self.reply(400, {"error": str(e)})

    def do_GET(self): self.route("GET")
    def do_POST(self): self.route("POST")
    def do_PUT(self): self.route("PUT")
    def do_DELETE(self): self.route("DELETE")

    def read_json(self):
        length = int(self.headers.get("Content-Length") or 0)
        if length > MAX_REQUEST:
            raise ValueError("Request too large")
        return json.loads(self.rfile.read(length) or b"{}")

    def reply(self, status, payload):
        data = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(data)

    def reply_file(self, path, ctype):
        data = path.read_bytes()
        self.send_response(200)
        self.send_header("Content-Type", f"{ctype}; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("X-Frame-Options", "DENY")  # nobody can embed ApiMan to click-jack it
        self.end_headers()
        self.wfile.write(data)

    def log_message(self, fmt, *args):
        pass  # keep the terminal quiet


def main():
    ap = argparse.ArgumentParser(description="ApiMan local server")
    ap.add_argument("--port", type=int, default=5577)
    ap.add_argument("--data", default=str(HERE / "collections"),
                    help="folder holding collection .json files (environments go in its environments/ subfolder)")
    ap.add_argument("--ca-file", help="PEM file with your company's root CA, for internal HTTPS APIs")
    ap.add_argument("--no-browser", action="store_true")
    args = ap.parse_args()

    global CA_FILE
    if args.ca_file:
        CA_FILE = str(Path(args.ca_file).expanduser().resolve())
        ssl.create_default_context().load_verify_locations(cafile=CA_FILE)  # fail fast on a bad file

    Handler.stores = make_stores(args.data)
    server = ThreadingHTTPServer(("127.0.0.1", args.port), Handler)  # localhost only, never the LAN
    url = f"http://127.0.0.1:{args.port}"
    print(f"ApiMan running at {url}\nData folder: {Handler.stores['collections'].root}\nCtrl+C to stop.")
    if not args.no_browser:
        webbrowser.open(url)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
