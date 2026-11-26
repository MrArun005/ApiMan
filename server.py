#!/usr/bin/env python3
"""
ApiMan local server: a private, local Postman-style API client. Python standard library only.

    python3 server.py                      # http://127.0.0.1:5577, data in ./collections
    python3 server.py --data ~/my-apis     # keep collections + environments somewhere else
    python3 server.py --port 6000 --no-browser
    python3 server.py --ca-file ~/company-root-ca.pem   # internal HTTPS APIs signed by your company CA
    python3 server.py run api.json -e staging.json --junit report.xml   # run a collection headlessly (CI)

Requests are sent from THIS machine, so they go through whatever VPN you are connected to.
Collections are Postman v2.1 JSON files; environments are Postman environment JSON files.
"""
import argparse
import base64
import hashlib
import hmac
import ipaddress
import json
import secrets
import socket
import os
import queue
import re
import shutil
import ssl
import subprocess
import sys
import tempfile
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
import webbrowser
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

HERE = Path(__file__).resolve().parent
# Names as people really write them ("Orders (v2).json", "Café API.json"): Unicode letters and digits, spaces and
# common punctuation. Never a path separator, a leading dot or "..", so a segment can't climb out or hide.
NAME_CHARS = r"[\w\u0300-\u036f .()+,&@'!#\[\]~-]"  # + combining marks: macOS stores "é" as e + ´
ID_RE = re.compile(rf"^[^\W_]{NAME_CHARS}{{0,120}}\.json$")
FOLDER_RE = re.compile(rf"^[^\W_]{NAME_CHARS}{{0,120}}$")  # one folder level of an id: no "..", never hidden
MAX_DEPTH = 8                     # folder levels searched below the data folder
MAX_SCAN_FILES = 5000             # .json files looked at per listing
MAX_SCAN_FILE = 20 * 1024 * 1024  # larger files are never read while listing
METHOD_RE = re.compile(r"^[A-Z]{1,16}$")
MAX_REQUEST = 50 * 1024 * 1024    # what the browser may send us
MAX_RESPONSE = 20 * 1024 * 1024   # what we read back from the target API
MAX_STATE = 5 * 1024 * 1024       # workspace state (<data>/.apiman/state.json)
STATE_KEYS = ("settings", "activeEnv", "open", "history", "tabs", "diffIgnore", "layout", "codeLang", "sizeUnit")
SCHEMA_V21 = "https://schema.getpostman.com/json/collection/v2.1.0/collection.json"
CA_FILE = None  # extra trusted CA bundle (PEM), set by --ca-file
# A fresh secret per launch. It's written only into ApiMan's own page and required on every /api call,
# so other websites in your browser and requests ApiMan itself proxies can't use the API. (Local programs
# running as you can read the page, but they can already read your collection files directly.)
SESSION_TOKEN = secrets.token_urlsafe(32)
SERVER_PORT = None  # set in main(); the proxy refuses to call ApiMan itself
RUN_JOB = None      # `server.py run`: what the headless page should run
RUN_EVENTS = None   # ...and the queue its results come back on
TOKEN_HEADER = "X-ApiMan-Token"


def targets_self(url):
    """True when a URL points at this ApiMan server (any loopback/unspecified address on our port)."""
    if SERVER_PORT is None:
        return False
    u = urllib.parse.urlsplit(url)
    port = u.port or (443 if u.scheme == "https" else 80)
    if port != SERVER_PORT or not u.hostname:
        return False
    host = u.hostname.strip("[]")
    if host == "localhost" or host.endswith(".localhost"):
        return True
    try:
        addrs = {ipaddress.ip_address(host)}
    except ValueError:
        try:
            addrs = {ipaddress.ip_address(i[4][0]) for i in socket.getaddrinfo(host, port)}
        except OSError:
            return False
    addrs = {getattr(a, "ipv4_mapped", None) or a for a in addrs}  # ::ffff:127.0.0.1 is loopback too
    return any(a.is_loopback or a.is_unspecified or (a.version == 4 and a in ipaddress.ip_network("0.0.0.0/8")) for a in addrs)
STATIC = {"/": ("index.html", "text/html"), "/index.html": ("index.html", "text/html"),
          "/app.js": ("app.js", "text/javascript"), "/app.css": ("app.css", "text/css"),
          "/fonts/Geist-Variable.woff2": ("fonts/Geist-Variable.woff2", "font/woff2"),
          "/fonts/GeistMono-Variable.woff2": ("fonts/GeistMono-Variable.woff2", "font/woff2"),
          "/vendor/codemirror.js": ("vendor/codemirror.js", "text/javascript"),
          "/vendor/codemirror.css": ("vendor/codemirror.css", "text/css"),
          "/oauth-callback.html": ("oauth-callback.html", "text/html")}
# The OAuth 2.0 provider redirects the sign-in popup here from its own site, so this one page accepts cross-site
# navigations. It holds no data and no session token; it only hands the code to the ApiMan tab that asked for it.
OAUTH_CALLBACK = "/oauth-callback.html"


def validate_collection(data):
    if not (isinstance(data, dict) and isinstance(data.get("info"), dict)
            and isinstance(data["info"].get("name"), str) and isinstance(data.get("item"), list)):
        raise ValueError("Not a Postman v2 collection (needs info.name and item[]). "
                         "In Postman: Export -> Collection v2.1.")


def validate_environment(data):
    if not (isinstance(data, dict) and isinstance(data.get("name"), str) and isinstance(data.get("values"), list)):
        raise ValueError("Not a Postman environment (needs name and values[]).")


def classify(data):
    """What a JSON document is, by content (Postman exports keep working whatever their file name)."""
    if isinstance(data, dict):
        if isinstance(data.get("info"), dict) and isinstance(data.get("item"), list):
            return "collections"
        if isinstance(data.get("values"), list) and "item" not in data:
            return "environments"
    return None


def doc_name(kind, data, path):
    name = data["info"].get("name") if kind == "collections" else data.get("name")
    return name if isinstance(name, str) and name.strip() else Path(path).stem


class Discovery:
    """Finds every collection and environment anywhere in the data folder, classified by content.
    Skips hidden folders (.apiman, .git, ...), node_modules, symlinks, anything deeper than MAX_DEPTH folders and
    files over MAX_SCAN_FILE, and stops after MAX_SCAN_FILES .json files. Results are cached by (path, mtime, size)."""

    def __init__(self, root):
        self.root = Path(root).expanduser().resolve()
        self._cache = {}  # absolute path -> (mtime_ns, size, kind, name)
        self._lock = threading.Lock()

    def info(self, path, st=None):
        """(kind, name) of one file; kind is None when it's neither a collection nor an environment."""
        try:
            st = st or os.stat(path, follow_symlinks=False)
        except OSError:
            return None, None
        key = str(path)
        with self._lock:
            hit = self._cache.get(key)
        if hit and hit[0] == st.st_mtime_ns and hit[1] == st.st_size:
            return hit[2], hit[3]
        kind = name = None
        if st.st_size <= MAX_SCAN_FILE:
            try:
                data = json.loads(Path(path).read_bytes().decode("utf-8-sig"))
                kind = classify(data)
                name = kind and doc_name(kind, data, path)
            except (OSError, ValueError):
                pass
        with self._lock:
            self._cache[key] = (st.st_mtime_ns, st.st_size, kind, name)
        return kind, name

    def scan(self):
        """[(folder segments, file name, kind, name)] for every collection and environment in the data folder."""
        found, seen, count = [], set(), 0
        level = [()]  # breadth-first: when the file limit is reached, what's nearer the top is listed
        while level and count < MAX_SCAN_FILES:
            nxt = []
            for segs in level:
                try:
                    with os.scandir(self.root.joinpath(*segs)) as it:
                        entries = sorted(it, key=lambda e: e.name)
                except OSError:
                    continue
                for e in entries:
                    try:
                        if e.is_symlink():
                            continue  # never followed: a link could lead out of the data folder
                        if e.is_dir(follow_symlinks=False):
                            # hidden folders (.apiman, .git) and names no id can address are skipped
                            if len(segs) < MAX_DEPTH and FOLDER_RE.fullmatch(e.name) and e.name != "node_modules":
                                nxt.append((*segs, e.name))
                            continue
                        if not (e.name.lower().endswith(".json") and e.is_file(follow_symlinks=False)):
                            continue
                        if count >= MAX_SCAN_FILES:
                            break
                        count += 1
                        if not ID_RE.fullmatch(e.name):
                            continue  # a file name no id can address
                        seen.add(e.path)
                        kind, name = self.info(e.path, e.stat(follow_symlinks=False))
                        if kind:
                            found.append((segs, e.name, kind, name))
                    except OSError:
                        continue
            level = nxt
        with self._lock:  # forget files that are gone
            for k in [k for k in self._cache if k not in seen]:
                del self._cache[k]
        return found


class Store:
    """Collections or environments: one document = one JSON file anywhere in the data folder.

    Ids are POSIX paths relative to the data folder ("Orders.json", "payments/v2/Orders.json"). For environments,
    an id without "/" means environments/<id> (so existing ids keep working); any other is relative to the data
    folder, written "./Local.json" for a file at the top."""

    def __init__(self, discovery, kind, validate, default_dir=()):
        self.disc = discovery
        self.data = discovery.root
        self.kind = kind
        self.validate = validate
        self.default_dir = tuple(default_dir)
        self.root = self.data.joinpath(*self.default_dir)  # where new documents go when no folder is given

    # ---- ids <-> paths ----
    @staticmethod
    def folder_segments(folder):
        """Validated folder segments: "a/b" -> ("a", "b"); "" or None -> ()."""
        if folder is None or folder == "":
            return ()
        if not isinstance(folder, str):
            raise ValueError("Invalid folder")
        segs = tuple(folder.strip("/").split("/"))
        if len(segs) > MAX_DEPTH or not all(FOLDER_RE.fullmatch(s) for s in segs):
            raise ValueError("Invalid folder: use letters, digits, spaces, '.', '_' or '-', "
                             f"not starting with '.', at most {MAX_DEPTH} levels")
        return segs

    def segments(self, doc_id):
        """(folder segments, file name) of an id, validated segment by segment."""
        if not isinstance(doc_id, str):
            raise ValueError("Invalid id")
        if self.kind == "environments":
            if "/" not in doc_id:
                doc_id = "/".join((*self.default_dir, doc_id))
            elif doc_id.startswith("./"):
                doc_id = doc_id[2:]
        *folder, name = doc_id.split("/")
        if not ID_RE.fullmatch(name):  # fullmatch: "$" would also accept a trailing newline
            raise ValueError("Invalid id")
        if len(folder) > MAX_DEPTH or not all(FOLDER_RE.fullmatch(s) for s in folder):  # no "", ".", "..", hidden
            raise ValueError("Invalid id")
        return tuple(folder), name

    def id_of(self, segs, name):
        if self.kind == "environments":
            if segs == self.default_dir:
                return name
            if not segs:
                return "./" + name
        return "/".join((*segs, name))

    @staticmethod
    def _check_clash(parent, name):
        # macOS/Windows file systems ignore case: "foo.json" must not silently alias "Foo.json"
        try:
            names = os.listdir(parent)
        except (FileNotFoundError, NotADirectoryError):
            return
        clash = next((n for n in names if n.lower() == name.lower() and n != name), None)
        if clash:
            raise ValueError(f"Invalid id: {clash} already exists")

    def _safe_dir(self, segs, create=False):
        """The folder for these segments: inside the data folder and reached without any symlink."""
        d = self.data
        for s in segs:
            self._check_clash(d, s)
            d = d / s
            if create and not d.exists() and not d.is_symlink():
                d.mkdir(exist_ok=True)
        real = d.resolve()
        if real != d or not real.is_relative_to(self.data):  # no symlinked folder, no escape
            raise ValueError("Invalid id")
        if d.exists() and not d.is_dir():
            raise ValueError("Invalid id: a file is in the way of that folder")
        return d

    def path(self, doc_id):
        segs, name = self.segments(doc_id)
        parent = self._safe_dir(segs)
        p = (parent / name).resolve()
        if p.parent != parent:  # a symlinked file may not point anywhere else
            raise ValueError("Invalid id")
        self._check_clash(parent, name)
        return p

    def _own(self, doc_id):
        """The path of an existing document of this kind. Other JSON in the data folder is never read or changed."""
        p = self.path(doc_id)
        if not p.is_file() or self.disc.info(p)[0] != self.kind:
            raise FileNotFoundError(doc_id)
        return p

    # ---- documents ----
    def list(self):
        out = []
        for segs, fname, kind, name in self.disc.scan():
            if kind == self.kind:
                top = self.kind == "environments" and segs == self.default_dir
                out.append({"id": self.id_of(segs, fname), "name": name, "folder": "" if top else "/".join(segs)})
        out.sort(key=lambda d: (d["folder"].lower(), d["name"].lower(), d["id"].lower()))
        return out

    def get(self, doc_id):
        return self.get_with_version(doc_id)[0]

    def exists(self, doc_id):
        try:
            self._own(doc_id)
            return True
        except FileNotFoundError:
            return False

    def version(self, doc_id):
        # a content hash, not mtime: coarse timestamps (network shares, FAT) can't hide a change
        return hashlib.sha256(self._own(doc_id).read_bytes()).hexdigest()[:32]

    def get_with_version(self, doc_id):
        raw = self._own(doc_id).read_bytes()  # one read: the content and its version always match
        return json.loads(raw.decode("utf-8-sig")), hashlib.sha256(raw).hexdigest()[:32]

    def put(self, doc_id, data):
        """Writes the document in place: an existing id keeps its folder and file name."""
        self.validate(data)
        p = self.path(doc_id)
        if p.exists() and (not p.is_file() or self.disc.info(p)[0] != self.kind):
            raise ValueError("Invalid id: that file isn't " + ("a collection" if self.kind == "collections" else "an environment"))
        # Atomic write: a crash mid-save never leaves a half-written file.
        fd, tmp = tempfile.mkstemp(dir=p.parent, suffix=".tmp")
        try:
            with os.fdopen(fd, "w", encoding="utf-8") as f:
                json.dump(data, f, indent=2, ensure_ascii=False)
            # Collections and environments often hold tokens: new files stay owner-only (mkstemp's 0600).
            # An existing file keeps the mode its owner chose (e.g. a shared team folder).
            if p.exists():
                os.chmod(tmp, p.stat().st_mode & 0o777)
            os.replace(tmp, p)
        except BaseException:
            try:
                os.unlink(tmp)
            except FileNotFoundError:
                pass
            raise

    _create_lock = threading.Lock()  # two quick imports with the same name must not pick the same file

    def create(self, data, folder=None):
        with self._create_lock:
            return self._create(data, folder)

    def _create(self, data, folder=None):
        self.validate(data)
        segs = self.default_dir if folder in (None, "") else self.folder_segments(folder)
        name = data["info"]["name"] if self.kind == "collections" else data["name"]
        base = re.sub(r"[^A-Za-z0-9._-]+", "-", name).strip("-._")[:80] or "untitled"
        if base.lower() == "globals":
            base = "globals-env"  # globals.json is the Globals document, never a normal environment
        parent = self._safe_dir(segs, create=True)  # the folder is created if missing
        existing = {n.lower() for n in os.listdir(parent)}  # case-insensitive, like macOS/Windows
        fname, n = f"{base}.json", 2
        while fname.lower() in existing:
            fname, n = f"{base}-{n}.json", n + 1
        doc_id = self.id_of(segs, fname)
        self.put(doc_id, data)
        return doc_id

    def delete(self, doc_id):
        self._own(doc_id).unlink()

    def find(self, ref):
        """A document by id or by name (case-insensitive), for `server.py run`. Returns its id or None."""
        try:
            if self.exists(ref):
                return self.id_of(*self.segments(ref))
        except ValueError:
            pass
        for key in ("id", "name"):
            hits = [d["id"] for d in self.list() if d[key].lower() in (ref.lower(), ref.lower() + ".json")]
            if len(hits) > 1:
                raise ValueError(f"{ref!r} matches several documents: {', '.join(hits)}")
            if hits:
                return hits[0]
        return None


def make_stores(root, create=True):
    disc = Discovery(root)
    stores = {
        "collections": Store(disc, "collections", validate_collection),
        "environments": Store(disc, "environments", validate_environment, ("environments",)),
    }
    if create:
        for s in stores.values():
            s.root.mkdir(parents=True, exist_ok=True)
    return stores


class TooLarge(ValueError):
    pass


class StateStore:
    """Workspace state: one JSON object in <data>/.apiman/state.json, ApiMan's private, local-only folder."""

    _lock = threading.Lock()

    def __init__(self, root):
        self.dir = Path(root) / ".apiman"
        self.file = self.dir / "state.json"

    @staticmethod
    def clean(data):
        if not isinstance(data, dict):
            raise ValueError("State must be a JSON object")
        return {k: data[k] for k in STATE_KEYS if k in data}  # allowlist: nothing else lands in the folder

    def get(self):
        try:
            return self.clean(json.loads(self.file.read_text("utf-8")))
        except FileNotFoundError:
            return None
        except ValueError:  # bad JSON, bad UTF-8, or not an object: treated as absent
            return None

    def put(self, data):
        data = self.clean(data)
        with self._lock:
            if not self.dir.is_dir():
                self.dir.mkdir(mode=0o700, exist_ok=True)
                os.chmod(self.dir, 0o700)  # mkdir's mode is masked by the umask
            ignore = self.dir / ".gitignore"
            if not ignore.exists():  # history and tabs can hold tokens: never let git pick this folder up
                ignore.write_text("# ApiMan's private, local-only state\n*\n", "utf-8")
            # Atomic, owner-only: history and tabs can hold tokens. mkstemp creates the file 0600.
            fd, tmp = tempfile.mkstemp(dir=self.dir, suffix=".tmp")
            try:
                with os.fdopen(fd, "w", encoding="utf-8") as f:
                    json.dump(data, f, ensure_ascii=False)
                os.chmod(tmp, 0o600)
                os.replace(tmp, self.file)
            except BaseException:
                try:
                    os.unlink(tmp)
                except FileNotFoundError:
                    pass
                raise


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
        if targets_self(newurl):
            raise RedirectRefused("Refused a redirect to ApiMan's own local server.")
        if urllib.parse.urlsplit(newurl).scheme.lower() not in ("http", "https"):
            raise RedirectRefused(f"Refused redirect to a non-HTTP URL: {newurl}")
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


def connect_error(url, reason):
    """A plain-language connection error instead of '[Errno 61] Connection refused'."""
    host = urllib.parse.urlsplit(url).netloc
    if isinstance(reason, ConnectionRefusedError):
        return f"Connection refused by {host}: nothing is listening there. Is the server running, or the VPN connected?"
    if isinstance(reason, socket.gaierror):
        return f"Couldn't find {host}: the name doesn't resolve. Check the URL, or connect to the VPN."
    if isinstance(reason, (TimeoutError, socket.timeout)):
        return f"{host} didn't answer in time."
    return f"Could not connect to {host}: {getattr(reason, 'strerror', None) or reason}"


def send(spec):
    """Execute one HTTP request exactly as described by the UI (variables, auth and scripts already applied)."""
    if not isinstance(spec, dict):
        return {"error": "Invalid request"}
    headers_in = spec.get("headers") or []
    if not isinstance(headers_in, list) or not all(isinstance(h, list) and len(h) == 2 for h in headers_in):
        return {"error": "Invalid headers"}
    method = str(spec.get("method", "GET")).upper()
    url = str(spec.get("url", "")).strip()
    if not METHOD_RE.match(method):
        return {"error": f"Invalid method: {method}"}
    if not re.match(r"^https?://", url, re.I):
        return {"error": "URL must start with http:// or https://"}
    # A custom Host naming ApiMan + a domain that re-resolves to 127.0.0.1 (DNS rebinding) would get past
    # both targets_self and the server's Host check, so such a Host header is refused outright.
    own_hosts = {f"127.0.0.1:{SERVER_PORT}", f"localhost:{SERVER_PORT}"}
    if targets_self(url) or any(str(k).strip().lower() == "host" and str(v).strip().lower() in own_hosts for k, v in headers_in):
        return {"error": "ApiMan can't send requests to its own local server."}

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
    for key, value in headers_in:
        if str(key).strip().lower() == TOKEN_HEADER.lower():
            continue  # never forward ApiMan's own token
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
        timeout = max(1.0, min(float(spec.get("timeout", 60) or 60), 600.0))
        resp = opener.open(req, timeout=timeout)
    except urllib.error.HTTPError as e:   # 4xx/5xx (and unfollowed 3xx) still have a useful response
        resp = e
    except RedirectRefused as e:
        return {"error": str(e)}
    except urllib.error.URLError as e:
        return {"error": connect_error(url, e.reason)}
    except Exception as e:  # timeouts, bad TLS, etc.
        return {"error": f"{type(e).__name__}: {e}"}

    try:
        with resp:
            raw = resp.read(MAX_RESPONSE + 1)
    except Exception as e:  # read timeout, connection reset, IncompleteRead
        return {"error": f"The response broke off while downloading: {type(e).__name__}: {e}"}
    promised = resp.headers.get("Content-Length")
    no_body = method == "HEAD" or resp.status in (204, 304) or 100 <= resp.status < 200  # Content-Length describes a body that isn't sent
    if not no_body and promised and promised.isdigit() and len(raw) < min(int(promised), MAX_RESPONSE + 1):
        return {"error": f"The response broke off while downloading: received {len(raw)} of {promised} bytes."}
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
    timeout = 30   # seconds a client may stall mid-request

    # ---- safety: this server can reach your VPN, so only our own page may talk to it ----
    def allowed(self):
        port = self.server.server_address[1]
        hosts = {f"127.0.0.1:{port}", f"localhost:{port}"}
        if self.headers.get("Host") not in hosts:  # blocks DNS-rebinding attacks
            return False
        if self.command == "GET" and urllib.parse.urlparse(self.path).path == OAUTH_CALLBACK:
            return True  # a provider's redirect arrives as a cross-site navigation
        origin = self.headers.get("Origin")
        # Blocks other websites in your browser from using this as a proxy into your network.
        if not (origin is None or origin in {f"http://{h}" for h in hosts}):
            return False
        # Browsers label cross-site requests (<script>, <img>, links) even when they carry no Origin.
        site = self.headers.get("Sec-Fetch-Site")
        return site in (None, "same-origin", "none")

    def route(self, method):
        if not self.allowed():
            return self.reply(403, {"error": "Forbidden"})
        path = urllib.parse.urlparse(self.path).path
        if path.startswith("/api/") and not hmac.compare_digest(self.headers.get(TOKEN_HEADER, ""), SESSION_TOKEN):
            return self.reply(403, {"error": "Forbidden"})
        try:
            if method == "GET" and path in STATIC:
                name, ctype = STATIC[path]
                return self.reply_file(HERE / name, ctype)
            if method == "GET" and path == "/api/info":
                return self.reply(200, {"dataDir": str(self.stores["collections"].root), **({"run": RUN_JOB} if RUN_JOB else {})})
            if method == "POST" and path == "/api/run-event" and RUN_EVENTS is not None:
                RUN_EVENTS.put(self.read_json())
                return self.reply(200, {"ok": True})
            if method == "POST" and path == "/api/send":
                return self.reply(200, send(self.read_json()))
            if path == "/api/state" and method in ("GET", "PUT"):
                state = StateStore(self.stores["collections"].root)
                if method == "GET":
                    return self.reply(200, {"state": state.get()})
                state.put(self.read_json(MAX_STATE))
                return self.reply(200, {"ok": True})
            m = re.match(r"^/api/(collections|environments)(?:/(.+))?$", path)
            if m:
                store, doc_id = self.stores[m.group(1)], m.group(2) and urllib.parse.unquote(m.group(2))
                if doc_id is None and method == "GET":
                    return self.reply(200, store.list())
                if doc_id is None and method == "POST":
                    body = self.read_json()
                    if not isinstance(body, dict):
                        raise ValueError("Invalid request body")
                    data = body.get("collection") or body.get("document") or {
                        "info": {"name": body.get("name") or "New collection", "schema": SCHEMA_V21}, "item": []}
                    return self.reply(201, {"id": store.create(data, body.get("folder"))})
                if doc_id and method == "GET":
                    data, version = store.get_with_version(doc_id)
                    return self.reply(200, data, {"X-Version": version})
                if doc_id and method == "PUT":
                    expected = self.headers.get("If-Match")
                    body = self.read_json()  # read before locking: a slow client never blocks other saves
                    with store._create_lock:  # check-then-write must not interleave with another save
                        if expected and (not store.exists(doc_id) or store.version(doc_id) != expected):
                            return self.reply(409, {"error": "This document was changed or deleted elsewhere since it was loaded."})
                        store.put(doc_id, body)
                        return self.reply(200, {"ok": True}, {"X-Version": store.version(doc_id)})
                if doc_id and method == "DELETE":
                    expected = self.headers.get("If-Match")
                    with store._create_lock:
                        if expected and store.exists(doc_id) and store.version(doc_id) != expected:
                            return self.reply(409, {"error": "This document was changed elsewhere; reload before deleting it."})
                        store.delete(doc_id)
                    return self.reply(200, {"ok": True})
            return self.reply(404, {"error": "Not found"})
        except FileNotFoundError:
            return self.reply(404, {"error": "Not found"})
        except TooLarge as e:
            return self.reply(413, {"error": str(e)})
        except (ValueError, json.JSONDecodeError) as e:
            return self.reply(400, {"error": str(e)})
        except (TypeError, AttributeError, KeyError):
            return self.reply(400, {"error": "Invalid request body"})

    def do_GET(self): self.route("GET")
    def do_POST(self): self.route("POST")
    def do_PUT(self): self.route("PUT")
    def do_DELETE(self): self.route("DELETE")

    def read_json(self, limit=None):
        length = max(0, int(self.headers.get("Content-Length") or 0))
        if length > MAX_REQUEST:
            raise ValueError("Request too large")
        if limit is not None and length > limit:
            remaining = length  # drain it (bounded by MAX_REQUEST), so the client gets our answer, not a reset
            while remaining > 0:
                chunk = self.rfile.read(min(1 << 16, remaining))
                if not chunk:
                    break
                remaining -= len(chunk)
            raise TooLarge(f"Request too large (limit {limit // (1024 * 1024)} MB)")
        return json.loads(self.rfile.read(length) or b"{}")

    def reply(self, status, payload, extra_headers=None):
        data = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        for k, val in (extra_headers or {}).items():
            self.send_header(k, val)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(data)

    def reply_file(self, path, ctype):
        data = path.read_bytes()
        if path.name == "index.html":  # hand ApiMan's own page the token for this launch
            data = data.replace(b"__APIMAN_TOKEN__", SESSION_TOKEN.encode())
        self.send_response(200)
        self.send_header("Content-Type", ctype if ctype.startswith("font/") else f"{ctype}; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("X-Frame-Options", "DENY")  # nobody can embed ApiMan to click-jack it
        self.end_headers()
        self.wfile.write(data)

    def log_message(self, fmt, *args):
        pass  # keep the terminal quiet


# ---------- `server.py run`: headless collection runs for CI ----------
# Scripts in collections may be untrusted, and only a browser sandbox isolates them safely, so the run happens in a
# headless Chrome / Chromium / Edge already on the machine, driving the same runner as the app. Nothing to install.

def find_browser(explicit=None):
    names = ["google-chrome", "google-chrome-stable", "chromium", "chromium-browser", "chrome", "msedge", "microsoft-edge", "microsoft-edge-stable"]
    paths = [explicit, os.environ.get("APIMAN_BROWSER"), os.environ.get("CHROME_PATH"),
             *[shutil.which(n) for n in names],
             "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/Applications/Chromium.app/Contents/MacOS/Chromium",
             "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
             *[os.path.expandvars(p) for p in (r"%ProgramFiles%\Google\Chrome\Application\chrome.exe", r"%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe",
                                               r"%LocalAppData%\Google\Chrome\Application\chrome.exe", r"%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe",
                                               r"%ProgramFiles%\Microsoft\Edge\Application\msedge.exe")],
             "/opt/pw-browsers/chromium"]
    for p in paths:
        if p and Path(p).is_file() and os.access(p, os.X_OK):
            return p
    return None


def load_json_file(path, what):
    try:
        return json.loads(Path(path).expanduser().read_text(encoding="utf-8-sig"))
    except FileNotFoundError:
        raise SystemExit(f"error: {what} file not found: {path}")
    except json.JSONDecodeError as e:
        raise SystemExit(f"error: {what} file isn't valid JSON ({path}): {e}")


def junit_report(results, suite_name, path):
    import xml.etree.ElementTree as ET
    root = ET.Element("testsuites", name=suite_name)
    tot = {"tests": 0, "failures": 0, "errors": 0, "time": 0.0}
    for r in results:
        label = " / ".join([*r["path"], r["name"]]) + (f" (iteration {r['iteration']})" if r.get("iterations", 1) > 1 else "")
        secs = (r.get("timeMs") or 0) / 1000
        suite = ET.SubElement(root, "testsuite", name=label, time=f"{secs:.3f}")
        cases = failures = errors = 0
        classname = ".".join(re.sub(r"[^\w-]+", "_", x) for x in [*r["path"], r["name"]]) or "request"
        if r["error"]:
            cases += 1; errors += 1
            tc = ET.SubElement(suite, "testcase", classname=classname, name=f"{r['method']} request", time=f"{secs:.3f}")
            ET.SubElement(tc, "error", message=r["error"][:500]).text = r["error"]
        for t in r["tests"]:
            cases += 1
            tc = ET.SubElement(suite, "testcase", classname=classname, name=t["name"], time="0")
            if t["passed"] is False:
                failures += 1
                ET.SubElement(tc, "failure", message=(t["error"] or "failed")[:500]).text = t["error"] or "failed"
            elif t["passed"] is None:
                ET.SubElement(tc, "skipped")
        if not cases:  # a request without tests still shows up, passing if it got a response
            cases = 1
            ET.SubElement(suite, "testcase", classname=classname, name=f"{r['method']} responded {r['status']}", time=f"{secs:.3f}")
        suite.set("tests", str(cases)); suite.set("failures", str(failures)); suite.set("errors", str(errors))
        tot["tests"] += cases; tot["failures"] += failures; tot["errors"] += errors; tot["time"] += secs
    for k, v in tot.items():
        root.set(k, f"{v:.3f}" if k == "time" else str(v))
    ET.ElementTree(root).write(path, encoding="utf-8", xml_declaration=True)


def resolve_run_file(ref, kind, data_dir):
    """`server.py run` takes a file path, or the id or name of a document anywhere in the data folder
    ("payments/v2/Orders.json", "Orders", "environments/team/Staging.json", "Staging")."""
    if Path(ref).expanduser().is_file() or not Path(data_dir).expanduser().is_dir():
        return ref
    try:
        store = make_stores(data_dir, create=False)[kind]  # only reads: nothing is created in the data folder
        doc_id = store.find(ref)
    except (OSError, ValueError) as e:
        raise SystemExit(f"error: {e}")
    return str(store.path(doc_id)) if doc_id else ref  # not found: load_json_file reports the missing file


def run_main(argv):
    ap = argparse.ArgumentParser(prog="server.py run", description="Run a collection headlessly, e.g. in CI. Exits 1 when a test fails or a request can't be sent.")
    ap.add_argument("collection", help="Postman v2.1 collection JSON file, or the id or name of one in the data folder")
    ap.add_argument("-e", "--env", help="environment JSON file, or the id or name of one in the data folder")
    ap.add_argument("-g", "--globals", help="globals JSON file (or id in the data folder, e.g. globals.json)")
    ap.add_argument("--data", default=str(HERE / "collections"), help="data folder searched for ids and names (default: ./collections)")
    ap.add_argument("--var", action="append", default=[], metavar="KEY=VALUE", help="set an environment variable (repeatable), e.g. --var token=$API_TOKEN")
    ap.add_argument("--folder", help="run only the folder with this name")
    ap.add_argument("-n", "--iterations", type=int, default=1)
    ap.add_argument("--delay", type=int, default=0, metavar="MS", help="pause between requests")
    ap.add_argument("--bail", action="store_true", help="stop at the first failure")
    ap.add_argument("--junit", metavar="FILE", help="write a JUnit XML report (for CI test tabs)")
    ap.add_argument("--json", metavar="FILE", help="write a JSON report")
    ap.add_argument("--browser", help="path to Chrome, Chromium or Edge (default: found automatically, or $APIMAN_BROWSER)")
    ap.add_argument("--ca-file", help="PEM file with your company's root CA, for internal HTTPS APIs")
    ap.add_argument("--timeout", type=float, default=1800, metavar="SECONDS", help="give up after this long (default 1800)")
    args = ap.parse_args(argv)

    global CA_FILE, SERVER_PORT, RUN_JOB, RUN_EVENTS
    if args.ca_file:
        CA_FILE = str(Path(args.ca_file).expanduser().resolve())
        ssl.create_default_context().load_verify_locations(cafile=CA_FILE)
    browser = find_browser(args.browser)
    if not browser:
        raise SystemExit("error: no Chrome, Chromium or Edge found. Install one, or pass --browser /path/to/chrome (or set APIMAN_BROWSER).")

    col = load_json_file(resolve_run_file(args.collection, "collections", args.data), "collection")
    if not (isinstance(col, dict) and isinstance(col.get("info"), dict) and isinstance(col.get("item"), list)):
        raise SystemExit("error: that file isn't a Postman v2.1 collection (export it from Postman or ApiMan as JSON).")
    env = load_json_file(resolve_run_file(args.env, "environments", args.data), "environment") if args.env else None
    if env is not None and not (isinstance(env, dict) and isinstance(env.get("values"), list)):
        raise SystemExit("error: that file isn't a Postman environment.")
    for kv in args.var:
        if "=" not in kv:
            raise SystemExit(f"error: --var needs KEY=VALUE, got {kv!r}")
        k, v = kv.split("=", 1)
        env = env or {"name": "Command line", "values": []}
        env["values"] = [x for x in env["values"] if not (isinstance(x, dict) and x.get("key") == k)] + [{"key": k, "value": v, "enabled": True}]

    tmp = tempfile.TemporaryDirectory(prefix="apiman-run-")
    data = Path(tmp.name) / "data"
    (data / "environments").mkdir(parents=True)
    (data / "collection.json").write_text(json.dumps(col), encoding="utf-8")
    if env is not None:
        env.setdefault("name", "Environment")
        (data / "environments" / "env.json").write_text(json.dumps(env), encoding="utf-8")
    if args.globals:
        g = load_json_file(resolve_run_file(args.globals, "environments", args.data), "globals")
        g["_postman_variable_scope"] = "globals"
        g.setdefault("name", "Globals")
        (data / "environments" / "globals.json").write_text(json.dumps(g), encoding="utf-8")

    Handler.stores = make_stores(str(data))
    RUN_JOB = {"cid": "collection.json", "envId": "env.json" if env is not None else "", "folder": args.folder,
               "iterations": max(1, args.iterations), "delay": max(0, args.delay), "bail": args.bail}
    RUN_EVENTS = queue.Queue()
    srv = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    SERVER_PORT = srv.server_address[1]
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    cmd = [browser, "--headless=new", "--no-first-run", "--no-default-browser-check", "--disable-extensions", "--disable-sync",
           "--disable-background-networking", "--mute-audio", f"--user-data-dir={Path(tmp.name) / 'profile'}"]
    if sys.platform.startswith("linux") and hasattr(os, "geteuid") and os.geteuid() == 0:
        cmd.append("--no-sandbox")  # Chrome refuses to start as root otherwise (common in CI containers); scripts stay in ApiMan's own sandbox
    proc = subprocess.Popen([*cmd, f"http://127.0.0.1:{SERVER_PORT}/"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

    color = sys.stdout.isatty() and not os.environ.get("NO_COLOR")
    paint = (lambda code, t: f"\033[{code}m{t}\033[0m") if color else (lambda code, t: t)
    try:
        "✓✗".encode(sys.stdout.encoding or "ascii")
        OK, BAD = "✓", "✗"
    except (UnicodeEncodeError, LookupError):
        OK, BAD = "PASS", "FAIL"
    name = col["info"].get("name", "Collection")
    print(f'ApiMan: running "{name}"' + (f' with "{env.get("name")}"' if env is not None else "") + (f' (folder "{args.folder}")' if args.folder else "")
          + (f", {args.iterations} iterations" if args.iterations > 1 else ""))
    results, started, deadline, outcome = [], time.time(), time.time() + args.timeout, None
    try:
        while outcome is None:
            try:
                ev = RUN_EVENTS.get(timeout=0.5)
            except queue.Empty:
                if proc.poll() is not None:
                    outcome = {"type": "fatal", "error": f"the browser exited unexpectedly (code {proc.returncode})."}
                elif time.time() > deadline:
                    outcome = {"type": "fatal", "error": f"timed out after {args.timeout:g} s."}
                continue
            if ev.get("type") == "result":
                r = ev["result"]
                r["iterations"] = args.iterations
                results.append(r)
                where = " / ".join([*r["path"], r["name"]])
                status = paint("31", f"ERROR {r['error']}") if r["error"] else paint("32" if r["status"] < 400 else "33" if r["status"] < 500 else "31", f"{r['status']} {r['reason']}".strip())
                timing = f"  {r['timeMs']} ms" if r["timeMs"] is not None else ""
                print(f"\n{paint('1', where)}" + (f"  (iteration {r['iteration']})" if args.iterations > 1 else ""))
                print(f"  {r['method']} {r['url']}  {status}{timing}")
                for t in r["tests"]:
                    if t["passed"] is False:
                        print(f"  {paint('31', BAD)} {t['name']}" + (f"\n      {t['error']}" if t["error"] else ""))
                    else:
                        print(f"  {paint('32', OK) if t['passed'] else '-'} {t['name']}")
                for w in r["warnings"] + r["logs"]:
                    print(f"  {paint('33', '!')} {w}")
            elif ev.get("type") in ("done", "fatal"):
                outcome = ev
    except KeyboardInterrupt:
        outcome = {"type": "fatal", "error": "interrupted."}
    finally:
        proc.terminate()
        try:
            proc.wait(5)
        except subprocess.TimeoutExpired:
            proc.kill()
        srv.shutdown()

    tests = [t for r in results for t in r["tests"]]
    passed = sum(1 for t in tests if t["passed"] is True)
    failed = sum(1 for t in tests if t["passed"] is False)
    errors = sum(1 for r in results if r["error"])
    elapsed = time.time() - started
    if args.json:
        Path(args.json).write_text(json.dumps({"collection": name, "environment": env.get("name") if env is not None else None,
                                               "passed": passed, "failed": failed, "requestErrors": errors, "seconds": round(elapsed, 3),
                                               "results": results, **({"error": outcome["error"]} if outcome["type"] == "fatal" else {})}, indent=2), encoding="utf-8")
    if args.junit:
        junit_report(results, name, args.junit)
    print()
    if outcome["type"] == "fatal":
        print(paint("31", f"Run failed: {outcome['error']}"))
    summary = f"{len(results)} request{'s' * (len(results) != 1)}, {errors} not sent · tests: {passed} passed, {failed} failed · {elapsed:.1f} s"
    print(paint("31" if failed or errors else "32", summary))
    tmp.cleanup()
    return 2 if outcome["type"] == "fatal" else 1 if failed or errors else 0


def main():
    if len(sys.argv) > 1 and sys.argv[1] == "run":
        sys.exit(run_main(sys.argv[2:]))
    ap = argparse.ArgumentParser(description="ApiMan local server (or: server.py run COLLECTION.json --help)")
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

    global SERVER_PORT
    SERVER_PORT = args.port
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
