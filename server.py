#!/usr/bin/env python3
"""
Local API client (a tiny Postman). Python standard library only, nothing to install.

    python3 server.py                      # http://127.0.0.1:5577, collections in ./collections
    python3 server.py --data ~/my-apis     # keep collections somewhere else
    python3 server.py --port 6000 --no-browser
    python3 server.py --ca-file ~/company-root-ca.pem   # internal HTTPS APIs signed by your company CA

Requests are sent from THIS machine, so they go through whatever VPN you are connected to.
Collections are Postman v2.1 JSON files: import from Postman, or drop .json files into the data folder.
"""
import argparse
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


def validate_collection(data):
    if not (isinstance(data, dict) and isinstance(data.get("info"), dict)
            and isinstance(data["info"].get("name"), str) and isinstance(data.get("item"), list)):
        raise ValueError("Not a Postman v2 collection (needs info.name and item[]). "
                         "In Postman: Export -> Collection v2.1.")


class Store:
    """One collection = one JSON file in the data folder."""

    def __init__(self, root):
        self.root = Path(root).expanduser().resolve()
        self.root.mkdir(parents=True, exist_ok=True)

    def path(self, cid):
        if not ID_RE.match(cid):
            raise ValueError("Invalid collection id")
        p = (self.root / cid).resolve()
        if p.parent != self.root:  # no ../ escapes
            raise ValueError("Invalid collection id")
        return p

    def list(self):
        out = []
        for p in sorted(self.root.glob("*.json"), key=lambda p: p.name.lower()):
            try:
                name = json.loads(p.read_text("utf-8"))["info"]["name"]
            except Exception:
                name = p.stem + " (unreadable)"
            out.append({"id": p.name, "name": name})
        return out

    def get(self, cid):
        return json.loads(self.path(cid).read_text("utf-8"))

    def put(self, cid, data):
        validate_collection(data)
        p = self.path(cid)
        # Atomic write: a crash mid-save never leaves a half-written collection.
        fd, tmp = tempfile.mkstemp(dir=self.root, suffix=".tmp")
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            json.dump(data, f, indent=2, ensure_ascii=False)
        os.replace(tmp, p)

    def create(self, data):
        validate_collection(data)
        data["info"].setdefault("schema", SCHEMA_V21)
        base = re.sub(r"[^A-Za-z0-9._-]+", "-", data["info"]["name"]).strip("-.")[:80] or "collection"
        cid, n = f"{base}.json", 2
        while (self.root / cid).exists():
            cid, n = f"{base}-{n}.json", n + 1
        self.put(cid, data)
        return cid

    def delete(self, cid):
        self.path(cid).unlink()


SENSITIVE_HEADERS = {"authorization", "cookie", "proxy-authorization"}


class RedirectRefused(Exception):
    pass


class SafeRedirect(urllib.request.HTTPRedirectHandler):
    """Follows redirects like Postman, but never carries credentials to a different origin."""

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
            new.headers = {k: v for k, v in new.headers.items() if k.lower() not in SENSITIVE_HEADERS}
        return new


def send(spec):
    """Execute one HTTP request exactly as described by the UI (variables and auth already applied)."""
    method = str(spec.get("method", "GET")).upper()
    url = str(spec.get("url", "")).strip()
    if not METHOD_RE.match(method):
        return {"error": f"Invalid method: {method}"}
    if not re.match(r"^https?://", url, re.I):
        return {"error": "URL must start with http:// or https://"}

    body = spec.get("body")
    data = body.encode("utf-8") if isinstance(body, str) and body != "" else None
    if data is None and method in ("POST", "PUT", "PATCH"):
        data = b""  # send Content-Length: 0 instead of no length (some servers answer 411)

    req = urllib.request.Request(url, data=data, method=method)
    for key, value in spec.get("headers", []):
        req.add_header(str(key), str(value))
    if not req.has_header("User-agent"):
        req.add_header("User-Agent", "local-api-client/1.0")

    ctx = ssl.create_default_context()
    if CA_FILE:
        ctx.load_verify_locations(cafile=CA_FILE)  # trust your company's CA: the safe fix for internal certs
    if spec.get("insecure"):
        # Last resort, opt-in per click: skips certificate checks (exposes you to MITM). Off by default.
        ctx.check_hostname = False
        ctx.verify_mode = ssl.CERT_NONE
    opener = urllib.request.build_opener(urllib.request.HTTPSHandler(context=ctx), SafeRedirect())

    start = time.perf_counter()
    try:
        resp = opener.open(req, timeout=float(spec.get("timeout", 60)))
    except urllib.error.HTTPError as e:   # 4xx/5xx still have a useful response
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
        text, binary = raw.decode("utf-8"), False
    except UnicodeDecodeError:
        text, binary = None, True
    return {
        "status": resp.status,
        "reason": resp.reason,
        "headers": list(resp.headers.items()),
        "body": text,
        "binary": binary,
        "size": len(raw),
        "truncated": truncated,
        "timeMs": elapsed_ms,
        "finalUrl": resp.geturl(),
    }


class Handler(BaseHTTPRequestHandler):
    store: Store = None  # set in main()

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
            if method == "GET" and path in ("/", "/index.html"):
                return self.reply_file(HERE / "index.html")
            if method == "GET" and path == "/api/info":
                return self.reply(200, {"dataDir": str(self.store.root)})
            if path == "/api/collections":
                if method == "GET":
                    return self.reply(200, self.store.list())
                if method == "POST":
                    body = self.read_json()
                    data = body.get("collection") or {
                        "info": {"name": body.get("name") or "New collection", "schema": SCHEMA_V21},
                        "item": []}
                    return self.reply(201, {"id": self.store.create(data)})
            if path.startswith("/api/collections/"):
                cid = urllib.parse.unquote(path[len("/api/collections/"):])
                if method == "GET":
                    return self.reply(200, self.store.get(cid))
                if method == "PUT":
                    self.store.put(cid, self.read_json())
                    return self.reply(200, {"ok": True})
                if method == "DELETE":
                    self.store.delete(cid)
                    return self.reply(200, {"ok": True})
            if method == "POST" and path == "/api/send":
                return self.reply(200, send(self.read_json()))
            return self.reply(404, {"error": "Not found"})
        except FileNotFoundError:
            return self.reply(404, {"error": "Collection not found"})
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

    def reply_file(self, path):
        data = path.read_bytes()
        self.send_response(200)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(data)

    def log_message(self, fmt, *args):
        pass  # keep the terminal quiet


def main():
    ap = argparse.ArgumentParser(description="Local API client")
    ap.add_argument("--port", type=int, default=5577)
    ap.add_argument("--data", default=str(HERE / "collections"), help="folder holding collection .json files")
    ap.add_argument("--ca-file", help="PEM file with your company's root CA, for internal HTTPS APIs")
    ap.add_argument("--no-browser", action="store_true")
    args = ap.parse_args()

    global CA_FILE
    if args.ca_file:
        CA_FILE = str(Path(args.ca_file).expanduser().resolve())
        ssl.create_default_context().load_verify_locations(cafile=CA_FILE)  # fail fast on a bad file

    Handler.store = Store(args.data)
    server = ThreadingHTTPServer(("127.0.0.1", args.port), Handler)  # localhost only, never the LAN
    url = f"http://127.0.0.1:{args.port}"
    print(f"API client running at {url}\nCollections folder: {Handler.store.root}\nCtrl+C to stop.")
    if not args.no_browser:
        webbrowser.open(url)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
