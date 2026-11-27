#!/usr/bin/env python3
"""
ApiMan local server: a private, local Postman-style API client. Python standard library only.

    python3 server.py                      # http://127.0.0.1:5577, data in ./collections
    python3 server.py --data ~/my-apis     # keep collections + environments somewhere else
    python3 server.py --port 6000 --no-browser
    python3 server.py --ca-file ~/company-root-ca.pem   # internal HTTPS APIs signed by your company CA
    python3 server.py run api.json -e staging.json --junit report.xml   # run a collection headlessly (CI)
    python3 server.py run api.json -d rows.csv --html report.html       # ...once per data row, with an HTML report

Requests are sent from THIS machine, so they go through whatever VPN you are connected to.
Collections are Postman v2.1 JSON files; environments are Postman environment JSON files.
"""
import argparse
import base64
import csv
import hashlib
import hmac
import io
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
import zipfile
import zlib
import http.cookiejar
import concurrent.futures
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

FROZEN = getattr(sys, "frozen", False)  # the packaged desktop app (PyInstaller)
HERE = Path(getattr(sys, "_MEIPASS", Path(__file__).resolve().parent))  # app files: next to server.py, or inside the bundle
# The bundle is read-only and replaced on every update, so the desktop app keeps its data in your home folder.
DEFAULT_DATA = Path.home() / "ApiMan" if FROZEN else HERE / "collections"
if FROZEN and sys.platform == "darwin":  # opened from Finder: no shell PATH, so Homebrew's python3 and node (Robot's Browser) go missing
    os.environ["PATH"] = os.pathsep.join([os.environ.get("PATH", "/usr/bin:/bin"), "/opt/homebrew/bin", "/usr/local/bin"])
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
INSTANCE_SECRET = secrets.token_urlsafe(32)  # in <data>/.apiman/instance: lets a second launch recognise this copy
SERVER_PORT = None  # set in main(); the proxy refuses to call ApiMan itself
RUN_JOB = None      # `server.py run`: what the headless page should run
RUN_EVENTS = None   # ...and the queue its results come back on
MAX_ITERATION_FILE = 20 * 1024 * 1024  # `run -d`: iteration data file
MAX_DATA_ROWS = 100_000
MAX_REPORT = 50 * 1024 * 1024     # `run --html`: the report the headless page sends back
RUN_EVENT_LIMIT = 2 * MAX_REPORT  # one run event on the wire (JSON escaping can grow the report)
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


def private_dir(root):
    """<data>/.apiman: ApiMan's own folder, owner-only and ignored by git (history, tabs and run logs can hold tokens)."""
    d = Path(root) / ".apiman"
    if not d.is_dir():
        d.mkdir(mode=0o700, exist_ok=True)
    os.chmod(d, 0o700)  # every time: mkdir's mode is masked by the umask, and a loosened folder is tightened again
    ignore = d / ".gitignore"
    if not ignore.exists():
        ignore.write_text("# ApiMan's private, local-only state\n*\n", "utf-8")
    return d


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
            private_dir(self.dir.parent)
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
CROSS_ORIGIN_SAFE_HEADERS = {"accept", "accept-language", "accept-encoding", "user-agent", "content-type"}


class RedirectRefused(Exception):
    pass


try:
    import brotli  # optional: Content-Encoding: br is decoded only when it's installed
except ImportError:
    brotli = None
URL_SAFE = "/%:@!$&'()*+,;=-._~"  # kept as typed; everything else (spaces, non-ASCII, control chars) is percent-encoded


def encode_url(url):
    """(url ready for the wire, (user, password) or None). Spaces and non-ASCII in the path and query are
    percent-encoded (existing %XX kept), a non-ASCII host becomes IDNA, user:password@ is taken out (it becomes
    Basic auth) and the #fragment, never sent, is dropped."""
    u = urllib.parse.urlsplit(url.strip())
    userinfo, _, hostport = u.netloc.rpartition("@")
    cred = None
    if userinfo:
        user, _, pw = userinfo.partition(":")
        cred = (urllib.parse.unquote(user), urllib.parse.unquote(pw))
    m = re.fullmatch(r"(\[[^\]]*\]|[^:\[\]]*)(:\d*)?", hostport)
    if not m or not m.group(1):
        raise ValueError(f"Invalid host in the URL: {hostport or '(empty)'}")
    host, port = m.group(1), m.group(2) or ""
    if not host.startswith("[") and not host.isascii():
        try:
            host = host.encode("idna").decode("ascii")
        except UnicodeError:
            raise ValueError(f"Invalid host in the URL: {host}") from None
    path = urllib.parse.quote(u.path, safe=URL_SAFE)
    query = urllib.parse.quote(u.query, safe=URL_SAFE + "?")
    return urllib.parse.urlunsplit((u.scheme, host + port, path, query, "")), cred


def decode_body(raw, encoding):
    """(body, note): the response decoded by its Content-Encoding (gzip, deflate, br), at most MAX_RESPONSE bytes
    out (a small zip bomb can't fill memory); note says why it couldn't be, and the raw bytes are kept."""
    enc = (encoding or "").strip().lower()
    if enc in ("", "identity") or not raw:
        return raw, None
    try:
        if enc in ("gzip", "x-gzip", "deflate"):
            for wbits in ((16 + zlib.MAX_WBITS,) if enc != "deflate" else (zlib.MAX_WBITS, -zlib.MAX_WBITS)):
                try:  # deflate: zlib-wrapped as the spec says, or raw deflate as many servers send it
                    d = zlib.decompressobj(wbits)
                    return d.decompress(raw, MAX_RESPONSE + 1), None
                except zlib.error:
                    if wbits == -zlib.MAX_WBITS or enc != "deflate":
                        raise
        if enc == "br":
            if not brotli:
                return raw, "The response is Brotli-compressed (br); install the brotli package to read it."
            d, out, size = brotli.Decompressor(), [], 0
            for i in range(0, len(raw), 4096):  # a little at a time: stop as soon as the cap is passed (a bomb never fills memory)
                chunk = raw[i:i + 4096]
                try:
                    part = d.process(chunk, output_buffer_limit=MAX_RESPONSE + 1 - size)
                except TypeError:  # older brotli without output_buffer_limit: 4 KB in still bounds each step
                    part = d.process(chunk)
                out.append(part)
                size += len(part)
                if size > MAX_RESPONSE:
                    break
            return b"".join(out)[:MAX_RESPONSE + 1], None
    except (zlib.error, OSError, Exception) as e:  # brotli.error isn't an OSError
        return raw, f"Couldn't decode the {enc} response: {e}"
    return raw, f"Unknown Content-Encoding: {enc}"


class CookieStore:
    """One cookie jar per data folder (<data>/.apiman/cookies.txt, owner-only), like Postman's: cookies set by a
    response are sent with later requests to the same site and inside a redirect chain, by the domain, path, expiry
    and Secure rules of http.cookiejar."""
    _lock = threading.Lock()
    _jars = {}

    @classmethod
    def jar(cls, root):
        root = str(Path(root).resolve())
        with cls._lock:
            if root not in cls._jars:
                jar = http.cookiejar.MozillaCookieJar(str(Path(root) / ".apiman" / "cookies.txt"))
                try:
                    jar.load(ignore_discard=True)
                except (OSError, http.cookiejar.LoadError):
                    pass
                cls._jars[root] = jar
            return cls._jars[root]

    @classmethod
    def save(cls, root):
        jar = cls.jar(root)
        with cls._lock:
            private_dir(root)
            fd, tmp = tempfile.mkstemp(dir=Path(root) / ".apiman", suffix=".tmp")
            os.close(fd)
            try:
                jar.save(tmp, ignore_discard=True)  # session cookies too: like Postman, they last until you clear them
                os.chmod(tmp, 0o600)
                os.replace(tmp, jar.filename)
            except OSError:
                try:
                    os.unlink(tmp)
                except OSError:
                    pass

    @staticmethod
    def row(c):
        return {"domain": c.domain, "path": c.path, "name": c.name, "value": c.value or "", "expires": c.expires,
                "secure": bool(c.secure), "httpOnly": c.has_nonstandard_attr("HttpOnly")}

    @classmethod
    def list(cls, root, url=None):
        jar = cls.jar(root)
        if url:  # the cookies a request to url would send: domain, path, Secure and expiry
            u = urllib.parse.urlsplit(url)
            host, path = (u.hostname or "").lower(), u.path or "/"
            ok = lambda c: ((host == c.domain.lstrip(".") or host.endswith("." + c.domain.lstrip("."))) and path.startswith(c.path or "/")
                            and (not c.secure or u.scheme == "https") and not c.is_expired())
            return [cls.row(c) for c in jar if ok(c)]
        return [cls.row(c) for c in jar if not c.is_expired()]

    @classmethod
    def delete(cls, root, domain=None, path=None, name=None):
        jar = cls.jar(root)
        try:
            if domain is None:
                jar.clear()
            else:
                jar.clear(domain, path, name) if name else jar.clear(domain)
        except KeyError:
            pass
        cls.save(root)

    @classmethod
    def set(cls, root, body):
        if not isinstance(body, dict) or not str(body.get("domain") or "").strip() or not str(body.get("name") or "").strip():
            raise ValueError("A cookie needs a domain and a name.")
        domain, name = str(body["domain"]).strip().lower(), str(body["name"]).strip()
        if any(c in name + str(body.get("value", "")) for c in ";\r\n"):
            raise ValueError("A cookie's name and value can't contain ; or line breaks.")
        expires = body.get("expires")
        c = http.cookiejar.Cookie(0, name, str(body.get("value", "")), None, False, domain, True, domain.startswith("."),
                                  str(body.get("path") or "/"), True, bool(body.get("secure")),
                                  int(expires) if isinstance(expires, (int, float)) and expires > 0 else None,
                                  not expires, None, None, {"HttpOnly": None} if body.get("httpOnly") else {})
        cls.jar(root).set_cookie(c)
        cls.save(root)


class SafeRedirect(urllib.request.HTTPRedirectHandler):
    """Follows redirects like Postman and browsers (307/308 keep the method and body; 301/302/303 become GET, HEAD
    stays HEAD), but only harmless headers survive a change of origin."""
    http_error_308 = urllib.request.HTTPRedirectHandler.http_error_302  # Python < 3.11 doesn't follow 308

    def __init__(self, names=None, limit=10):
        super().__init__()
        self.stripped = []  # header names dropped on cross-origin redirects, reported to the UI as the user typed them
        self.names = names or {}
        self.max_redirections = limit
        self.hops = 0
        self.body_refused = None  # a 307/308 to another site that would have re-sent the body

    @staticmethod
    def origin(url):
        u = urllib.parse.urlsplit(url)
        return u.scheme, u.hostname, u.port or (443 if u.scheme == "https" else 80)

    def redirect_request(self, req, fp, code, msg, headers, newurl):
        if targets_self(newurl):
            raise RedirectRefused("Refused a redirect to ApiMan's own local server.")
        if urllib.parse.urlsplit(newurl).scheme.lower() not in ("http", "https"):
            raise RedirectRefused(f"Refused redirect to a non-HTTP URL: {newurl}")
        if code not in (301, 302, 303, 307, 308):
            return None
        try:
            newurl = encode_url(newurl)[0]  # a Location with spaces or non-ASCII characters
        except ValueError as e:
            raise RedirectRefused(f"Refused a redirect to an invalid URL: {e}") from None
        method = req.get_method()
        if code in (307, 308) and req.data and self.origin(req.full_url) != self.origin(newurl):
            # the body (a login form, a token) would go to another site: not followed, the 3xx is the answer
            self.body_refused = newurl
            return None
        if code in (307, 308):  # the same request again, body and all
            data = req.data
        else:
            method, data = ("HEAD" if method == "HEAD" else "GET"), None
        hdrs = {k: v for k, v in req.headers.items() if data is not None or k.lower() not in ("content-length", "content-type")}
        new = urllib.request.Request(newurl, data=data, headers=hdrs, origin_req_host=req.origin_req_host,
                                     unverifiable=True, method=method)
        self.hops += 1
        old_origin, new_origin = self.origin(req.full_url), self.origin(new.full_url)
        if old_origin[0] == "https" and new_origin[0] != "https":
            raise RedirectRefused(f"Refused redirect from HTTPS to insecure {new.full_url}")
        if old_origin != new_origin:
            # urllib only copies req.headers (never unredirected_hdrs) into the new request.
            kept = {k: v for k, v in new.headers.items() if k.lower() in CROSS_ORIGIN_SAFE_HEADERS}
            self.stripped += [self.names.get(k.lower(), k) for k in new.headers
                              if k not in kept and self.names.get(k.lower(), k) not in self.stripped]
            new.headers = kept
        return new


class NoRedirect(urllib.request.HTTPRedirectHandler):
    """Returns the 3xx response itself (the 'Follow redirects' setting is off)."""

    def redirect_request(self, *args, **kwargs):
        return None


def connect_error(url, reason):
    """A plain-language connection error instead of '[Errno 61] Connection refused'."""
    host = urllib.parse.urlsplit(url).netloc.rpartition("@")[2]  # never user:password@
    if isinstance(reason, ConnectionRefusedError):
        return f"Connection refused by {host}: nothing is listening there. Is the server running, or the VPN connected?"
    if isinstance(reason, socket.gaierror):
        return f"Couldn't find {host}: the name doesn't resolve. Check the URL, or connect to the VPN."
    if isinstance(reason, (TimeoutError, socket.timeout)):
        return f"{host} didn't answer in time."
    return f"Could not connect to {host}: {getattr(reason, 'strerror', None) or reason}"


def send(spec, root=None):
    """Execute one HTTP request exactly as described by the UI (variables, auth and scripts already applied).
    root: the data folder, whose cookie jar the request uses (spec.cookies false: none)."""
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
    for k, v in headers_in:  # a line break would start a new header (header injection): say which one, plainly
        if any(c in f"{k}{v}" for c in "\r\n\0"):
            return {"error": f"Header '{str(k).strip()[:60]}' contains a line break: remove it to send the request."}
        if not str(k).strip() or not re.fullmatch(r"[!#$%&'*+.^_`|~0-9A-Za-z-]+", str(k).strip()):
            return {"error": f"Header name '{str(k)[:60]}' isn't valid: use letters, digits and - only."}
    try:
        url, cred = encode_url(url)
    except ValueError as e:
        return {"error": str(e)}
    if cred and not any(str(k).strip().lower() == "authorization" for k, _ in headers_in):
        token = base64.b64encode(f"{cred[0]}:{cred[1]}".encode("utf-8")).decode("ascii")
        headers_in = [*headers_in, ["Authorization", f"Basic {token}"]]  # user:password@ in the URL = Basic auth, like curl
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
    if method == "HEAD":
        data = None  # a HEAD request has no body, whatever was typed
    if data is None and method in ("POST", "PUT", "PATCH"):
        data = b""  # send Content-Length: 0 instead of no length (some servers answer 411)

    req = urllib.request.Request(url, data=data, method=method)
    for key, value in headers_in:
        if str(key).strip().lower() == TOKEN_HEADER.lower():
            continue  # never forward ApiMan's own token
        req.add_header(str(key), str(value))
    if not req.has_header("User-agent"):
        req.add_header("User-Agent", "ApiMan/1.0")
    if not req.has_header("Accept-encoding"):  # like Postman: compressed answers are decoded below
        req.add_header("Accept-Encoding", "gzip, deflate" + (", br" if brotli else ""))

    ctx = ssl.create_default_context()
    if CA_FILE:
        ctx.load_verify_locations(cafile=CA_FILE)  # trust your company's CA: the safe fix for internal certs
    if spec.get("insecure"):
        # Last resort, opt-in in Settings: skips certificate checks (exposes you to MITM). Off by default.
        ctx.check_hostname = False
        ctx.verify_mode = ssl.CERT_NONE
    try:
        limit = max(1, min(int(spec.get("maxRedirects") or 10), 50))
    except (TypeError, ValueError):
        limit = 10
    names = {str(k).strip().lower(): str(k).strip() for k, _ in headers_in}
    redirects = SafeRedirect(names, limit) if spec.get("followRedirects", True) else NoRedirect()
    handlers = [urllib.request.HTTPSHandler(context=ctx), redirects]
    jar = CookieStore.jar(root) if root and spec.get("cookies", True) else None
    if jar is not None:
        handlers.append(urllib.request.HTTPCookieProcessor(jar))  # sent and stored on every hop of a redirect too
    opener = urllib.request.build_opener(*handlers)

    start = time.perf_counter()
    limit_hit = False
    timeout = 60.0
    try:
        timeout = max(1.0, min(float(spec.get("timeout", 60) or 60), 600.0))
        resp = opener.open(req, timeout=timeout)
    except urllib.error.HTTPError as e:   # 4xx/5xx (and unfollowed 3xx) still have a useful response
        resp = e
        limit_hit = isinstance(redirects, SafeRedirect) and str(e.msg).startswith(SafeRedirect.inf_msg)
    except RedirectRefused as e:
        return {"error": str(e)}
    except urllib.error.URLError as e:
        return {"error": connect_error(url, e.reason)}
    except (TimeoutError, socket.timeout):
        return {"error": f"No answer within {timeout:g} s: the server is slow or unreachable (the timeout is in Settings)."}
    except ssl.SSLError as e:
        return {"error": f"Secure connection failed: {getattr(e, 'reason', None) or e}. For an internal certificate, start ApiMan with --ca-file."}
    except Exception as e:  # anything else, in words rather than a traceback
        return {"error": f"Couldn't send the request: {e}"}
    finally:
        if jar is not None:
            CookieStore.save(root)

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
    wire_size = len(raw)
    encoding = resp.headers.get("Content-Encoding")
    raw, decode_note = decode_body(raw, encoding) if not no_body else (raw, None)
    truncated = len(raw) > MAX_RESPONSE or wire_size > MAX_RESPONSE
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
        "redirects": getattr(redirects, "hops", 0),
        "redirectLimitHit": limit_hit,
        **({"redirectBodyRefused": redirects.body_refused} if getattr(redirects, "body_refused", None) else {}),
        **({"redirectLimit": limit} if limit_hit else {}),
        **({"encoding": encoding.strip().lower(), "wireSize": wire_size} if encoding and not decode_note and not no_body else {}),
        **({"decodeNote": decode_note} if decode_note else {}),
        **({"cookies": CookieStore.list(root, resp.geturl())} if jar is not None else {}),
    }


# =====================================================================================================
# Automation: Robot Framework projects in the data folder
# =====================================================================================================
# A project is a folder with .robot files: the data folder itself, or any folder directly inside it. ApiMan lists
# its suites, tests, tags and test data, suggests environment keys from the variables it uses but never defines,
# and runs it with the project's own Python. A listener (robot_listener.py) streams every step, HTTP call and
# browser screenshot to <data>/.apiman/runs/<run>/events.jsonl, which the page reads as the run goes.
ROBOT_SKIP_DIRS = {"node_modules", "venv", ".venv", "results", "output", "outputs", "reports", "__pycache__", "site-packages"}
DATA_EXTS = {".json", ".csv", ".yaml", ".yml", ".xlsx", ".xls", ".txt", ".xml", ".tsv"}
MAX_PROJECT_FILES = 3000      # files looked at per project
MAX_DATA_FILE = 2 * 1024 * 1024  # test data opened in the app
RUN_ID_RE = re.compile(r"^\d{8}-\d{6}-[0-9a-f]{6}$")
RUN_FILE_RE = re.compile(r"^(shots/)?[\w.-]{1,120}$")
ROBOT_BUILTIN_VARS = {"curdir", "tempdir", "execdir", "outputdir", "outputfile", "logfile", "reportfile", "debugfile",
                      "testname", "testtags", "testdocumentation", "teststatus", "testmessage", "prevtestname",
                      "prevteststatus", "prevtestmessage", "suitename", "suitesource", "suitedocumentation",
                      "suitemetadata", "suitestatus", "suitemessage", "keywordstatus", "keywordmessage", "loglevel",
                      "options", "empty", "space", "true", "false", "none", "null", "/", ":", "\\n"}
RUNS = {}  # run id -> Popen (None while starting) of runs this server is running, until their final meta.json
STOPPING = set()  # run ids the user stopped
RUNS_LOCK = threading.Lock()
VARFILES = {}  # run id -> its secrets file, removed when ApiMan stops even if the run hasn't finished


def stop_all_runs():
    """ApiMan is stopping: stop its Robot runs (and the browsers they started) and remove their secrets files."""
    with RUNS_LOCK:
        procs, files = [p for p in RUNS.values() if p], list(VARFILES.values())
    for proc in procs:
        try:
            kill_tree(proc)
        except (OSError, subprocess.SubprocessError):
            pass
    for f in files:
        try:
            os.unlink(f)
        except OSError:
            pass


def robot_norm(name):
    """Robot matches variable names ignoring case, spaces and underscores: ${BASE_URL} is ${baseUrl}."""
    return re.sub(r"[\s_]", "", name).lower()


def robot_walk(top):
    """Files below a project folder, skipping hidden folders, virtualenvs, outputs and links."""
    count = 0
    for dirpath, dirs, files in os.walk(top):
        dirs[:] = sorted(d for d in dirs if not d.startswith(".") and d.lower() not in ROBOT_SKIP_DIRS
                         and not os.path.islink(os.path.join(dirpath, d)))
        for f in sorted(files):
            p = Path(dirpath) / f
            if f.startswith(".") or p.is_symlink():
                continue
            count += 1
            if count > MAX_PROJECT_FILES:
                return
            yield p


VARFILE_DIRS = {"env", "envs", "environment", "environments", "config", "configs", "variables", "vars", "settings"}
PROJECT_MARKERS = {".git", "requirements.txt", "requirements-dev.txt", "pyproject.toml", "robot.toml", "tests", "test",
                   "testcases", "test_cases", "suites", "resources", "keywords", "libraries"}
PROJECT_DEPTH = 4  # folder levels searched for projects


def robot_subdirs(d):
    try:
        return sorted(e for e in d.iterdir() if e.is_dir() and not e.is_symlink() and not e.name.startswith(".")
                      and e.name.lower() not in ROBOT_SKIP_DIRS and FOLDER_RE.fullmatch(e.name))
    except OSError:
        return []


def robot_projects(root):
    """Every Robot Framework project in the data folder. A project is the first folder, going down, that has .robot
    files of its own or looks like a project root (.git, requirements.txt, tests/, resources/...) with .robot files
    below it; a folder holding several such repos gives one project each."""
    root = Path(root).resolve()
    out = []

    def visit(d, depth):
        try:
            names = {e.name.lower() for e in d.iterdir()}
        except OSError:
            return
        own = any(n.endswith(".robot") for n in names)
        # markers (.git, tests/, requirements.txt) make a folder a project, but never the data folder itself:
        # that would swallow every project below it
        if own or (depth and names & PROJECT_MARKERS and any(p.suffix == ".robot" for p in robot_walk(d))):
            rel = d.relative_to(root).as_posix()
            out.append({"id": rel if rel != "." else ".", "name": d.name if rel != "." else (d.name or "Data folder"),
                        "path": rel})
            return
        if depth < PROJECT_DEPTH:
            for sub in robot_subdirs(d):
                visit(sub, depth + 1)

    visit(root, 0)
    for lid, path in robot_links(root).items():
        out.append({"id": lid, "name": Path(path).name, "path": path, "linked": True, "missing": not Path(path).is_dir()})
    return out


LINK_ID_RE = re.compile(r"^link-[0-9a-f]{12}$")


def links_file(root, create=False):
    return (private_dir(root) if create else Path(root) / ".apiman") / "links.json"


def robot_links(root):
    """Project folders linked from anywhere on this computer: {id: absolute path}."""
    try:
        paths = json.loads(links_file(root).read_text("utf-8"))
    except (OSError, ValueError):
        return {}
    return {"link-" + hashlib.sha256(x.encode()).hexdigest()[:12]: x for x in paths if isinstance(x, str)}


def robot_has_tests(d):
    return any(p.suffix == ".robot" for p in robot_walk(d))


def robot_link(root, path, remove=False):
    """Link (or unlink) a project folder anywhere on this computer. It's run where it is: nothing is copied."""
    links = robot_links(root)
    if remove:
        if path not in links:
            raise FileNotFoundError(path)
        del links[path]
    else:
        d = Path(os.path.expanduser(str(path or "").strip())).resolve()
        if not d.is_dir():
            raise ValueError(f"No folder at {d}.")
        if not robot_has_tests(d):
            raise ValueError(f"No Robot Framework tests (.robot files) in {d}.")
        if d == Path(root).resolve() or Path(root).resolve() in d.parents:
            raise ValueError("That folder is already in your data folder: it's listed without linking.")
        links["link-" + hashlib.sha256(str(d).encode()).hexdigest()[:12]] = str(d)
    f = links_file(root, create=True)
    f.write_text(json.dumps(sorted(set(links.values()))), "utf-8")
    os.chmod(f, 0o600)
    return {"ok": True}


def robot_project_dir(root, pid):
    root = Path(root).resolve()
    if pid == ".":
        return root
    if LINK_ID_RE.fullmatch(pid or ""):
        link = robot_links(root).get(pid)
        if not link or not Path(link).is_dir():
            raise FileNotFoundError(pid)
        return Path(link).resolve()
    segs = (pid or "").split("/")
    if len(segs) > PROJECT_DEPTH or not all(FOLDER_RE.fullmatch(x) for x in segs):
        raise ValueError("Invalid project")
    p = (root / pid).resolve()
    if root not in p.parents or not p.is_dir():
        raise FileNotFoundError(pid)
    return p


MAX_ZIP = 36 * 1024 * 1024            # the zip itself: it travels as base64 in JSON (+1/3), under MAX_REQUEST
MAX_ZIP_UNPACKED = 300 * 1024 * 1024  # what it may unpack to
MAX_ZIP_FILES = 10000


def robot_import_zip(root, name, data):
    """Unpack an uploaded project zip into the data folder, safely: no absolute paths, no "..", no links, bounded
    size and file count. One folder at the top of the zip becomes the project folder."""
    if len(data) > MAX_ZIP:
        raise ValueError("That zip is too large (limit 36 MB).")
    try:
        z = zipfile.ZipFile(io.BytesIO(data))
    except zipfile.BadZipFile:
        raise ValueError("That file isn't a zip.")
    members = [m for m in z.infolist() if not m.filename.startswith("__MACOSX/") and not m.filename.endswith(".DS_Store")]
    if len(members) > MAX_ZIP_FILES or sum(m.file_size for m in members) > MAX_ZIP_UNPACKED:
        raise ValueError("That zip unpacks to too much (limit 300 MB, 10,000 files).")
    for m in members:
        parts = m.filename.replace("\\", "/").split("/")
        if m.filename.startswith(("/", "\\")) or ".." in parts or ":" in parts[0] or (m.external_attr >> 16) & 0o170000 == 0o120000:
            raise ValueError(f"Refused: {m.filename} would land outside the project (or is a link).")
    tops = {m.filename.split("/")[0] for m in members}
    strip = len(tops) == 1 and all("/" in m.filename for m in members)
    base = re.sub(r"[^\w.-]+", "-", (next(iter(tops)) if strip else Path(str(name or "project")).stem)).strip("-._")[:60]
    base = base if FOLDER_RE.fullmatch(base or "") else "project"
    root = Path(root).resolve()
    if any(x["id"] == "." for x in robot_projects(root)):
        raise ValueError("Your data folder is itself a Robot project, so an imported one wouldn't be listed apart. "
                         "Link the project folder instead.")
    dest, n = root / base, 2
    while dest.exists():
        dest, n = root / f"{base}-{n}", n + 1
    dest.mkdir()
    try:
        for m in members:
            rel = m.filename.split("/", 1)[1] if strip else m.filename
            if not rel:
                continue
            target = (dest / rel).resolve()
            if target == dest:
                continue  # "proj/./"
            if dest not in target.parents:
                raise ValueError(f"Refused: {m.filename} would land outside the project.")
            if m.is_dir():
                target.mkdir(parents=True, exist_ok=True)
                continue
            target.parent.mkdir(parents=True, exist_ok=True)
            with z.open(m) as src, open(target, "wb") as out:
                shutil.copyfileobj(src, out)
        if not robot_has_tests(dest):
            raise ValueError("That zip has no Robot Framework tests (.robot files).")
    except BaseException:
        shutil.rmtree(dest, ignore_errors=True)  # only the folder this import just created
        raise
    return {"id": dest.relative_to(root).as_posix(), "name": dest.name}


def robot_inside(project, rel):
    """A path given by the page, resolved strictly inside the project."""
    p = (project / rel).resolve()
    if project != p and project not in p.parents:
        raise ValueError("Path outside the project")
    return p


SECTION_RE = re.compile(r"^\*+\s*(settings?|variables?|test cases?|tasks?|keywords?|comments?)\b", re.I)
VAR_USE_RE = re.compile(r"[$@&%]\{([^{}]+)\}")
CELL_SPLIT = re.compile(r" {2,}|\t| \| ")


def robot_var_name(inner):
    """The variable an ${...} refers to: ${user.name} and ${row}[id] are ${user} and ${row}; None for ${1}, ${{expr}}."""
    if re.fullmatch(r"[\d.eE+-]+|0[xob]\w+|\{.*", inner):
        return None
    return re.split(r"[.\[+\-*/=!<>()]", inner.strip(), maxsplit=1)[0].strip() or None


def robot_parse(text):
    """Suites, tests, tags and variables from Robot source: a light parser, enough to list and suggest.
    Returns (tests, used, defined, env_vars): `used` are variables read somewhere without being set in that same
    test or keyword (arguments, assignments and FOR variables only count in their own block); `defined` are set for
    everyone (Variables section, Set Suite/Global Variable).
    ponytail: regex, not robot.api.get_model (needs Robot in ApiMan's own Python); swap in if it misjudges."""
    tests, used, defined, envs, suite_tags = [], {}, set(), set(), []
    section, current = None, None
    block_uses, block_locals = [], set()

    def flush():
        for norm, name in block_uses:
            if norm not in block_locals:
                used.setdefault(norm, name)
        block_uses.clear()
        block_locals.clear()

    for n, raw in enumerate(text.splitlines(), 1):
        line = raw.rstrip()
        if not line.strip() or line.lstrip().startswith("#"):
            continue
        m = SECTION_RE.match(line)
        if m:
            flush()
            section = m.group(1).lower().rstrip("s").replace("test case", "test").replace("task", "test")
            current = None
            continue
        cells = [c for c in CELL_SPLIT.split(line.strip()) if c]
        if section == "comment" or not cells:
            continue
        first = cells[0]
        low = [robot_norm(c) for c in cells]
        uses = [(mm.group(0)[0], mm.group(1)) for c in cells for mm in VAR_USE_RE.finditer(c)]
        if section == "setting" and low[0] in ("testtags", "forcetags", "defaulttags", "tasktags"):
            suite_tags += cells[1:]
        if section == "variable":
            m = re.match(r"^[$@&]\{([^{}]+)\}", first)
            if m:
                defined.add(robot_norm(m.group(1)))
                uses = [u for u in uses if u[1] != m.group(1)]
        if section in ("test", "keyword") and not raw[:1].isspace():
            flush()  # a new test or keyword starts
            if section == "test":
                current = {"name": first, "tags": [], "line": n}
                tests.append(current)
            else:  # embedded arguments in a keyword name are its arguments
                block_locals.update(robot_norm(v) for v in VAR_USE_RE.findall(first))
            continue
        if current is not None and low[0] == "[tags]":
            current["tags"] += cells[1:]
        if low[0] == "[arguments]":
            block_locals.update(robot_norm(v.split("=")[0]) for c in cells[1:] for v in VAR_USE_RE.findall(c.split("=")[0] + "}" if "=" in c else c))
        elif low[0] in ("for", "var"):
            block_locals.update(robot_norm(v) for v in VAR_USE_RE.findall(cells[1] if len(cells) > 1 else ""))
        elif low[0] in ("setsuitevariable", "setglobalvariable", "settestvariable", "settaskvariable") and len(cells) > 1:
            target = re.sub(r"^\\", "", cells[1])
            for v in VAR_USE_RE.findall(target):
                defined.add(robot_norm(v))
            uses = uses[1:] if uses else uses
        for i, c in enumerate(cells):  # ${x}=  or  ${x}  =   assignments
            m = re.match(r"^[$@&]\{([^{}]+)\}\s*=?$", c)
            if m and (c.endswith("=") or cells[i + 1:i + 2] == ["="]):
                block_locals.add(robot_norm(m.group(1)))
        for sigil, inner in uses:
            name = robot_var_name(inner)
            if not name:
                continue
            if sigil == "%":
                envs.add(name)
            else:
                block_uses.append((robot_norm(name), name))
    flush()
    for t in tests:
        t["tags"] = sorted(set(t["tags"] + suite_tags), key=str.lower)
    return tests, used, defined, envs


def robot_varfile_names(path):
    """Variable names defined by a variable file (.py NAME = ..., .yaml/.json top-level keys)."""
    try:
        text = path.read_text("utf-8", errors="replace")
    except OSError:
        return set()
    if path.suffix == ".json":
        try:
            data = json.loads(text)
            return {robot_norm(k) for k in data} if isinstance(data, dict) else set()
        except ValueError:
            return set()
    pat = r"^([A-Za-z_]\w*)\s*=" if path.suffix == ".py" else r"^([A-Za-z_][\w ]*)\s*:"
    return {robot_norm(re.sub(r"^(LIST|DICT)__", "", m)) for m in re.findall(pat, text, re.M)}


HTTP_KEYWORDS = {f"{m}{suffix}": m.upper() for m in ("get", "post", "put", "patch", "delete", "head", "options")
                 for suffix in ("", "onsession", "request")}  # RequestsLibrary: GET, GET On Session; others: Get Request
HTTP_CELL = re.compile(r"^(?:https?://[^\s/]+)?(/[^\s|]*)$|^https?://[^\s/]+$")


def robot_http_calls(text):
    """(method, path, host) of every HTTP call written in Robot source: "GET On Session  api  /users/${id}"."""
    out = []
    for raw in text.splitlines():
        cells = [c for c in CELL_SPLIT.split(raw.strip()) if c]
        # skip "${resp}=" assignment cells, then the keyword
        while cells and re.match(r"^[$@&]\{[^{}]+\}\s*=?$", cells[0]) or cells[:1] == ["="]:
            cells = cells[1:]
        if not cells:
            continue
        method = HTTP_KEYWORDS.get(robot_norm(cells[0].split(".")[-1]))  # RequestsLibrary.GET On Session too
        if not method:
            continue
        for c in cells[1:4]:  # session alias, then the URL or path
            c = re.sub(r"^(?:url|uri|path)\s*=\s*", "", c, flags=re.I)  # url=/x (named argument)
            c = re.sub(r"^[$]\{[^{}]+\}(?=/)", "", c)  # ${BASE_URL}/api/info: the host is a variable
            m = HTTP_CELL.match(c)
            if m:
                host = re.match(r"^https?://([^\s/]+)", c)
                out.append((method, m.group(1) or "/", host.group(1).rpartition("@")[2].lower() if host else ""))  # never user:password@
                break
    return out


def robot_project(root, pid):
    project = robot_project_dir(root, pid)
    calls = set()
    suites, data, used, defined, envs, uses, varfiles = [], [], {}, set(), set(), {}, []
    for p in robot_walk(project):
        rel = p.relative_to(project).as_posix()
        ext = p.suffix.lower()
        if ext in (".robot", ".resource"):
            try:
                text = p.read_text("utf-8", errors="replace")
            except OSError:
                continue
            tests, u, d, e = robot_parse(text)
            calls.update(robot_http_calls(text))
            for k, name in u.items():
                used.setdefault(k, name)
                uses.setdefault(k, []).append(rel)
            defined |= d
            envs |= e
            for m in re.finditer(r"^Variables\s{2,}(\S+(?: \S+)*)", text, re.M):
                vf = (p.parent / m.group(1).replace("${CURDIR}", ".")).resolve()
                if vf.is_file():
                    defined |= robot_varfile_names(vf)
            if ext == ".robot" and tests:
                suites.append({"path": rel, "name": p.stem.replace("_", " "), "tests": tests})
        elif ext in DATA_EXTS and not p.name.lower().startswith("requirements"):
            try:
                data.append({"path": rel, "size": p.stat().st_size})
            except OSError:
                pass
        if ext in (".py", ".yaml", ".yml", ".json") and set(p.relative_to(project).parts[:-1]) & VARFILE_DIRS:
            names = robot_varfile_names(p)
            if names:  # a variable file of the project's own (env/qa.yaml, config/prod.py): offered as an environment
                defined |= names
                varfiles.append(rel)
    keys = sorted((name for k, name in used.items() if k not in defined and k not in ROBOT_BUILTIN_VARS),
                  key=str.lower)
    for run in [r for r in robot_runs(root, pid, limit=20) if r.get("kind") != "collection"][:5]:  # calls its Robot runs made (a collection run's own calls don't count)
        if "calls" not in run and run.get("status") != "running":  # a run from before calls were kept: work them out once
            run["calls"] = run_calls(robot_events(runs_dir(root) / run["id"]))
            write_meta(runs_dir(root) / run["id"], run)
        calls.update(tuple(c) for c in run.get("calls") or [])
    return {
        "id": pid, "name": project.name, "path": str(project), "suites": suites, "data": data,
        "keys": [{"name": k, "files": sorted(set(uses[robot_norm(k)]))[:5]} for k in keys],
        "envVars": sorted(envs, key=str.lower), "varfiles": varfiles, "python": robot_python(project, root, probe=False),
        "endpoints": [{"method": m, "path": pth, "host": h} for m, pth, h in sorted(calls)][:2000],
    }


def robot_python(project, root, probe=True):
    """The interpreter that runs a project's tests: its own virtualenv first, then ApiMan's, then the system's.
    {"path", "version"} or {"error"}. probe=False (listing a project) runs nothing: a project's own Python is
    project code, so it only runs once you click Run; until then the first interpreter found is named."""
    bins = ("Scripts/python.exe",) if os.name == "nt" else ("bin/python",)
    cands = [os.environ.get("APIMAN_ROBOT_PYTHON")]
    root = Path(root).resolve()
    inside = root in project.parents  # a data-folder project may share a venv with its folder; never above the data folder
    # a linked one: its own venv, the data folder's or ApiMan's only (the desktop app keeps Robot in <data>/.venv-robot)
    bases = [project] + ([project.parent] if inside else []) + [root, HERE]
    for base in bases:
        for venv in (".venv", "venv", ".venv-robot"):
            cands += [str(base / venv / b) for b in bins]
    cands += [shutil.which("python3"), shutil.which("python"), None if getattr(sys, "frozen", False) else sys.executable]
    found = list(dict.fromkeys(x for x in cands if x and Path(x).is_file()))
    if not probe:
        return {"path": found[0], "version": None} if found else {"error": "No Python found to run Robot Framework."}
    for c in found:
        try:
            v = subprocess.run([c, "-c", "import robot; print(robot.__version__)"], capture_output=True, text=True, timeout=20)
        except (OSError, subprocess.SubprocessError):
            continue
        if v.returncode == 0:
            return {"path": c, "version": v.stdout.strip()}
    win = os.name == "nt"
    pip = r".venv\Scripts\pip" if win else ".venv/bin/pip"
    rfb = r".venv\Scripts\rfbrowser" if win else ".venv/bin/rfbrowser"
    reqs = next((r for r in ("requirements.txt", "requirements-dev.txt") if (project / r).is_file()), None)
    install = f"-r {reqs}" if reqs else "robotframework robotframework-browser robotframework-requests"
    return {"error": f"Robot Framework isn't installed for this project. In {project}, run: {'py' if win else 'python3'} -m venv .venv && "
                     f"{pip} install {install}" + (f" && {rfb} init" if not reqs or "browser" in
                     (project / reqs).read_text("utf-8", "replace").lower() else "") + " (or set APIMAN_ROBOT_PYTHON)."}


KEEP_RUNS = 200  # runs kept in <data>/.apiman/runs, screenshots included; older ones are deleted as new ones start


def prune_runs(root):
    try:
        old = sorted((d for d in runs_dir(root).iterdir() if d.is_dir() and RUN_ID_RE.fullmatch(d.name)), key=lambda d: d.name)
    except OSError:
        return
    with RUNS_LOCK:
        busy = set(RUNS) | set(COLLECTION_RUNS)
    for d in [d for d in old if d.name not in busy][:-KEEP_RUNS or None]:
        shutil.rmtree(d, ignore_errors=True)


def robot_at_least(version, want):
    try:
        return tuple(int(x) for x in str(version).split(".")[:2]) >= want
    except ValueError:
        return False


def runs_dir(root, create=False):
    return (private_dir(root) if create else Path(root) / ".apiman") / "runs"


def robot_start(root, stores, body):
    if not isinstance(body, dict):
        raise ValueError("Invalid request body")
    pid = str(body.get("project") or "")
    project = robot_project_dir(root, pid)
    target = robot_inside(project, str(body.get("suite") or "."))
    if not target.exists():
        raise FileNotFoundError(str(body.get("suite")))
    project_varfile = None
    if body.get("varfile"):  # the project's own variable file (env/qa.yaml)
        project_varfile = robot_inside(project, str(body["varfile"]))
        if not project_varfile.is_file():
            raise FileNotFoundError(str(body["varfile"]))
    py = robot_python(project, root)
    if "error" in py:
        raise ValueError(py["error"])
    variables, env_name = {}, ""
    if body.get("envId"):
        env = stores["environments"].get(str(body["envId"]))
        env_name = env.get("name", "")
        variables.update({v["key"]: v.get("value", "") for v in env.get("values", [])
                          if isinstance(v, dict) and v.get("key") and v.get("enabled", True) is not False})
    data = body.get("data")
    if data not in (None, ""):
        if not isinstance(data, dict):
            raise ValueError("Test data must be a JSON object: each key becomes a ${variable}.")
        variables.update(data)
    run_id = time.strftime("%Y%m%d-%H%M%S") + "-" + secrets.token_hex(3)
    prune_runs(root)
    out = runs_dir(root, create=True) / run_id
    out.mkdir(parents=True)
    (out / "shots").mkdir()
    # Secrets go through a file only this user can read (never the command line), deleted when the run ends.
    # A Python variable file (get_variables) works on every Robot version; JSON ones need Robot 6.1+.
    values = json.dumps({k: v for k, v in variables.items() if isinstance(k, str) and k.strip()})
    fd, varfile = tempfile.mkstemp(suffix=".py", prefix="apiman_vars_")
    with os.fdopen(fd, "w", encoding="utf-8") as f:
        f.write(f"import json\n\n\ndef get_variables():\n    return json.loads({values!r})\n")
    cmd = [py["path"], "-m", "robot", "--listener", f"{HERE / 'robot_listener.py'};{out}",
           "--variablefile", varfile, "--outputdir", str(out), "--consolecolors", "off", "--consolewidth", "100"]
    if project_varfile:  # after ApiMan's, so test data still wins (the first variable file wins)
        cmd += ["--variablefile", str(project_varfile)]
        env_name = project_varfile.relative_to(project).as_posix()
    if body.get("test"):
        # one argv entry with "=": a name starting with "-" stays a name; * ? [ are escaped so it's not a pattern
        cmd.append("--test=" + re.sub(r"([*?\[])", r"[\1]", str(body["test"])))
    for tag in [t.strip() for t in str(body.get("include") or "").split(",") if t.strip()]:
        cmd.append(f"--include={tag}")
    shown = target.relative_to(project).as_posix()  # what you picked, even when the whole project is parsed for its setups
    inits = [d for d in target.parents if d == project or project in d.parents]
    if target != project and any((d / "__init__.robot").is_file() for d in inits) and robot_at_least(py["version"], (6, 1)):
        cmd += ["--parse-include", str(target)]  # the whole project is the suite, so its __init__ setups run too
        target = project
    cmd.append(str(target))
    meta = {"id": run_id, "project": pid, "projectName": project.name, "target": shown,
            "test": body.get("test") or "", "include": body.get("include") or "", "env": env_name,
            "speed": "full" if body.get("speed") == "full" else "watch",
            "started": time.time(), "status": "running", "robot": py["version"]}
    with RUNS_LOCK:
        if run_going():
            os.unlink(varfile)
            shutil.rmtree(out, ignore_errors=True)
            raise RunBusy("Another run is going: wait for it or stop it first.")
        RUNS[run_id] = None  # before meta.json says running, so a poll never takes it for an interrupted run
    write_meta(out, meta)
    log = open(out / "console.txt", "wb")
    try:
        watch = body.get("speed", "watch") == "watch"  # Watch: each browser step stays on screen a moment
        proc = subprocess.Popen(cmd, cwd=project, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, stdin=subprocess.DEVNULL,
                                # PYTHONDONTWRITEBYTECODE: importing the secrets file must not leave a .pyc copy in __pycache__
                                env={**os.environ, "APIMAN_STEP_DELAY": "0.6" if watch else "0", "PYTHONDONTWRITEBYTECODE": "1",
                                     "PYTHONIOENCODING": "utf-8", "PYTHONUTF8": "1"},  # one encoding for the console on every OS
                                **({"start_new_session": True} if os.name != "nt" else {}))
    except OSError as e:
        log.close()
        os.unlink(varfile)
        meta.update(status="failed", ended=time.time(), error=str(e))
        write_meta(out, meta)
        with RUNS_LOCK:
            RUNS.pop(run_id, None)
        raise
    print(f"\n[automation] {project.name}: running {meta['target']} with {py['path']} (Robot Framework {py['version']})", flush=True)
    tee = threading.Thread(target=robot_tee, args=(proc, log, meta), daemon=True)
    tee.start()
    with RUNS_LOCK:
        RUNS[run_id] = proc
        VARFILES[run_id] = varfile
    threading.Thread(target=robot_finish, args=(out, proc, tee, varfile, meta), daemon=True).start()
    return meta


def robot_events(out):
    events = []
    try:
        with open(out / "events.jsonl", "rb") as f:
            for line in f:
                try:
                    events.append(json.loads(line))
                except ValueError:
                    pass
    except OSError:
        pass
    return events


def robot_summary(events):
    tests = [e for e in events if e.get("t") == "test_end"]
    count = lambda s: sum(1 for t in tests if t.get("status") == s)
    http = [e for e in events if e.get("t") == "http"]
    return {"passed": count("PASS"), "failed": count("FAIL"), "skipped": count("SKIP"), "http": len(http),
            "httpErrors": sum(1 for e in http if e.get("error") or (e.get("status") or 0) >= 400),
            "tests": [{"name": t.get("name"), "suite": t.get("suite", ""), "status": t.get("status"),
                       "key": t.get("tid") or f"{t.get('suite', '')} › {t.get('name')}",
                       "ms": t.get("ms"), "message": (t.get("message") or "")[:300],
                       **({"shot": t["shot"]} if t.get("shot") and t.get("status") == "FAIL" else {})} for t in tests]}


def robot_tee(proc, log, meta):
    """Robot's console output goes to the run's console.txt and to the terminal ApiMan runs in."""
    for line in iter(proc.stdout.readline, b""):
        log.write(line)
        log.flush()
        try:
            sys.stdout.write(line.decode("utf-8", "replace"))
            sys.stdout.flush()
        except (OSError, ValueError, AttributeError):
            pass  # no terminal (desktop app): the file still has it
    log.close()


def run_calls(events):
    """The distinct API calls (method, path, host) a run made: kept in its meta.json so pairing never re-reads logs."""
    calls = set()
    for e in events:
        if e.get("t") == "http" and e.get("url"):
            u = urllib.parse.urlsplit(str(e["url"]))
            host = (u.netloc.rpartition("@")[2] or "").lower()  # never user:password@
            calls.add((str(e.get("method") or "GET").upper(), u.path or "/", host))
    return sorted(calls)[:500]


def robot_finish(out, proc, tee, varfile, meta):
    code = proc.wait()
    tee.join(10)  # console.txt complete before the run is reported done
    try:
        os.unlink(varfile)
    except OSError:
        pass
    with RUNS_LOCK:
        stopped = meta["id"] in STOPPING
    s = robot_summary(robot_events(out))
    # Robot exits 0 only when every test passed: 1-250 failures, 251+ errors, negative when killed
    meta.update(s, ended=time.time(), exitCode=code, status="stopped" if stopped else "passed" if code == 0 else "failed")
    meta["calls"] = run_calls(robot_events(out))
    write_meta(out, meta)
    with RUNS_LOCK:  # only now: until the final meta.json is written, the run is still this server's
        RUNS.pop(meta["id"], None)
        VARFILES.pop(meta["id"], None)
        STOPPING.discard(meta["id"])
    print(f"[automation] {meta['projectName']}: {meta['status']}, {s['passed']} passed, {s['failed']} failed, "
          f"{s['http']} API calls. Report: {out / 'report.html'}", flush=True)


def write_meta(out, meta):
    """meta.json, written atomically: a page polling the run never reads half a file."""
    fd, tmp = tempfile.mkstemp(dir=out, suffix=".tmp")
    with os.fdopen(fd, "w", encoding="utf-8") as f:
        json.dump(meta, f)
    os.replace(tmp, out / "meta.json")


def read_meta(out):
    """A run's meta.json. A run still marked running that this server isn't running was cut short (ApiMan was
    stopped or crashed mid-run): it's recorded as stopped, so it never blocks a new run or shows as running forever."""
    meta = json.loads((out / "meta.json").read_text("utf-8"))
    if meta.get("status") != "running":
        return meta
    with RUNS_LOCK:
        if meta.get("kind") == "collection":  # runs in the page: alive while the page keeps reporting
            alive = time.time() - COLLECTION_RUNS.get(meta.get("id"), 0) < COLLECTION_STALE
        else:
            alive = meta.get("id") in RUNS
        if alive:
            return meta
        meta = json.loads((out / "meta.json").read_text("utf-8"))  # it may have just finished: the final one wins
        if meta.get("status") == "running":
            meta.update(robot_summary(robot_events(out)), status="stopped", interrupted=True,
                        ended=meta.get("ended") or (out / "meta.json").stat().st_mtime)
            write_meta(out, meta)
            COLLECTION_RUNS.pop(meta.get("id"), None)
    return meta


COLLECTION_RUNS = {}  # run id -> time the page last reported on it (collection runs execute in the page)


def run_going():
    """The run in progress, if any (call with RUNS_LOCK held). One run at a time: two would fight over the app
    under test, the browser and the console."""
    if RUNS:
        return next(iter(RUNS))
    return next((rid for rid, at in COLLECTION_RUNS.items() if time.time() - at < COLLECTION_STALE), None)


class RunBusy(ValueError):
    pass
COLLECTION_STALE = 90  # seconds without news: the page was closed mid-run
MAX_RUN_EVENTS_POST = 8 * 1024 * 1024
SECRET_HEADER_WORDS = ("authorization", "cookie", "token", "secret", "password", "passwd", "pwd", "api-key", "apikey",
                       "access-key", "private-key", "jwt", "session", "credential", "x-auth")


def secret_name(name):
    low = re.sub(r"[-_\s]", "", str(name).lower())  # api_key, api-key, API Key, apikey alike
    return any(w.replace("-", "") in low for w in SECRET_HEADER_WORDS)


def mask_pairs(query):
    """a=1&password=x&token=y with the secret values hidden (query strings and form bodies)."""
    return "&".join(f"{k}=•••" if secret_name(urllib.parse.unquote_plus(k)) else pair
                    for pair in query.split("&") for k, _, _ in [pair.partition("=")])


def mask_url(url):
    """user:password@ and ?api_key=… / ?token=… hidden in a logged URL."""
    u = urllib.parse.urlsplit(str(url))
    if "@" in u.netloc:
        u = u._replace(netloc="•••@" + u.netloc.rpartition("@")[2])
    if u.query:
        u = u._replace(query=mask_pairs(u.query))
    return urllib.parse.urlunsplit(u) if ("@" in u.netloc or u.query) else str(url)


def mask_body(text):
    """A JSON or form (a=1&password=x) body with its password, token, secret… fields hidden (other bodies as they are)."""
    if not isinstance(text, str):
        return text
    if not text.strip().startswith(("{", "[")):
        return mask_pairs(text) if re.fullmatch(r"[^\s&=]+=[^\s&]*(&[^\s&=]+=[^\s&]*)*", text.strip()) else text
    try:
        data = json.loads(text)
    except ValueError:
        return re.sub(r'("(?:[^"]*(?:password|token|secret|api[-_]?key)[^"]*)"\s*:\s*)"[^"]*"', r'\1"•••"', text, flags=re.I)

    def walk(v):
        if isinstance(v, dict):
            return {k: "•••" if secret_name(k) and not isinstance(x, (dict, list)) else walk(x) for k, x in v.items()}
        if isinstance(v, list):
            return [walk(x) for x in v]
        return v
    return json.dumps(walk(data), ensure_ascii=False, indent=2)


def mask_headers(headers):
    if not isinstance(headers, dict):
        return {}
    return {str(k): "•••" if secret_name(k) else str(v)[:2000] for k, v in headers.items()}


def collection_run_start(root, body):
    """Open a run record for a collection run the page is about to do (with the paired project's test data)."""
    if not isinstance(body, dict):
        raise ValueError("Invalid request body")
    pid = str(body.get("project") or "")
    robot_project_dir(root, pid)  # the project must exist
    run_id = time.strftime("%Y%m%d-%H%M%S") + "-" + secrets.token_hex(3)
    prune_runs(root)
    out = runs_dir(root, create=True) / run_id
    out.mkdir(parents=True)
    (out / "shots").mkdir()
    meta = {"id": run_id, "project": pid, "projectName": str(body.get("projectName") or pid)[:200], "kind": "collection",
            "target": str(body.get("collectionName") or "collection")[:200], "collection": str(body.get("collection") or "")[:500],
            "test": "", "include": "", "env": str(body.get("env") or "")[:200], "started": time.time(), "status": "running",
            "robot": None, "cases": int(body.get("cases") or 0)}
    with RUNS_LOCK:
        if run_going():
            shutil.rmtree(out, ignore_errors=True)
            raise RunBusy("Another run is going: wait for it or stop it first.")
        COLLECTION_RUNS[run_id] = time.time()
    write_meta(out, meta)
    return meta


def collection_run_events(root, run_id, body):
    """Events of a collection run, as the page sends them; with "done", the run's final status."""
    out = robot_run_dir(root, run_id)
    meta = json.loads((out / "meta.json").read_text("utf-8"))
    if meta.get("kind") != "collection" or meta.get("status") != "running":
        raise ValueError("This run isn't a collection run in progress.")
    events = body.get("events") if isinstance(body, dict) else None
    if not isinstance(events, list):
        raise ValueError("Invalid request body")
    allowed = {"suite_start", "suite_end", "test_start", "test_end", "kw_start", "kw_end", "http", "log"}
    with open(out / "events.jsonl", "a", encoding="utf-8") as f:
        for e in events:
            if not isinstance(e, dict) or e.get("t") not in allowed:
                continue
            if e.get("t") == "http":  # credentials never land in the run log, whatever the page sent
                e["reqHeaders"], e["resHeaders"] = mask_headers(e.get("reqHeaders")), mask_headers(e.get("resHeaders"))
                e["url"], e["reqBody"], e["resBody"] = mask_url(e.get("url", "")), mask_body(e.get("reqBody", "")), mask_body(e.get("resBody", ""))
                for k in ("reqBody", "resBody"):
                    if isinstance(e.get(k), str) and len(e[k]) > 65536:
                        e[k] = e[k][:65536] + f"\n… {len(e[k]) - 65536} more characters"
            e.pop("shot", None)  # no screenshots in API runs
            e["at"] = round(time.time(), 3)
            f.write(json.dumps(e, ensure_ascii=False, default=str) + "\n")
    done = body.get("done")
    with RUNS_LOCK:
        COLLECTION_RUNS[run_id] = time.time()
    if done:
        s = robot_summary(robot_events(out))
        status = "stopped" if done == "stopped" else "failed" if done == "error" else "passed" if s["passed"] and not s["failed"] else "failed"
        meta.update(s, ended=time.time(), status=status, exitCode=0 if status == "passed" else 1, **({"interrupted": True} if done == "error" else {}))
        meta["calls"] = run_calls(robot_events(out))
        write_meta(out, meta)
        with RUNS_LOCK:
            COLLECTION_RUNS.pop(run_id, None)
        print(f"[automation] {meta['projectName']}: collection {meta['target']} {status}, {s['passed']} passed, "
              f"{s['failed']} failed, {s['http']} API calls.", flush=True)
    return {"ok": True}


def robot_stop(run_id):
    with RUNS_LOCK:
        proc = RUNS.get(run_id)
        if not proc:
            return False
        if run_id in STOPPING:
            return True  # Stop clicked again: still stopping, never "start a new run"
        STOPPING.add(run_id)
    try:
        kill_tree(proc)
    except OSError:
        pass
    return True


def kill_tree(proc):
    """Robot and everything it started (the browser, node): its process group, or on Windows its process tree."""
    if os.name != "nt":
        os.killpg(proc.pid, 15)
    else:
        subprocess.run(["taskkill", "/T", "/F", "/PID", str(proc.pid)], capture_output=True, timeout=20)


def robot_run_dir(root, run_id):
    if not RUN_ID_RE.fullmatch(run_id or ""):
        raise ValueError("Invalid run")
    out = runs_dir(root) / run_id
    if not out.is_dir():
        raise FileNotFoundError(run_id)
    return out


def robot_runs(root, pid=None, limit=60):
    out = []
    d = runs_dir(root)
    for p in sorted(d.iterdir(), reverse=True) if d.is_dir() else []:
        if not RUN_ID_RE.fullmatch(p.name):
            continue
        try:
            meta = read_meta(p)
        except (OSError, ValueError):
            continue
        if pid is None or meta.get("project") == pid:
            out.append(meta)
        if len(out) >= limit:
            break
    return out


def robot_dashboard(root):
    """One row per project for the Automation dashboard: tests, suites, keys and its recent runs."""
    runs = robot_runs(root, limit=400)
    out = []
    for proj in robot_projects(root):
        row = dict(proj)
        try:
            d = robot_project(root, proj["id"])
            row.update(tests=sum(len(x["tests"]) for x in d["suites"]), suites=len(d["suites"]),
                       keys=[k["name"] for k in d["keys"]], tags=sorted({t for x in d["suites"] for y in x["tests"] for t in y["tags"]}, key=str.lower),
                       endpoints=d["endpoints"])
        except (OSError, ValueError) as e:
            row["error"] = str(e)
        row["runs"] = [{k: r.get(k) for k in ("id", "status", "passed", "failed", "skipped", "started", "ended", "env", "http")}
                       for r in runs if r.get("project") == proj["id"]][:30]
        out.append(row)
    return out


def robot_events_since(root, run_id, offset):
    """New complete event lines from byte `offset`, so the page can follow a run by polling."""
    out = robot_run_dir(root, run_id)
    events, nxt = [], offset
    try:
        with open(out / "events.jsonl", "rb") as f:
            f.seek(offset)
            chunk = f.read(4 * 1024 * 1024)
        end = chunk.rfind(b"\n") + 1
        for line in chunk[:end].splitlines():
            try:
                events.append(json.loads(line))
            except ValueError:
                pass
        nxt = offset + end
    except OSError:
        pass
    meta = read_meta(out)
    console = ""
    if meta.get("status") != "running":  # shown only once a run has ended (why Robot stopped); never re-read while it runs
        try:
            with open(out / "console.txt", "rb") as f:
                f.seek(max(0, f.seek(0, 2) - 6000))
                console = f.read().decode("utf-8", "replace")
        except OSError:
            pass
    return {"events": events, "next": nxt, "meta": meta, "console": console}



def robot_data_file(root, pid, rel, text=None):
    """Read (or, with text, save) one test-data file of a project."""
    project = robot_project_dir(root, pid)
    p = robot_inside(project, rel)
    if p.suffix.lower() not in DATA_EXTS or p.suffix.lower() in (".xlsx", ".xls") or not p.is_file():
        raise ValueError("Only text test-data files (JSON, CSV, YAML, XML, TXT) open here.")
    if p.stat().st_size > MAX_DATA_FILE or (text is not None and len(text.encode()) > MAX_DATA_FILE):
        raise ValueError("This file is too large to open here (limit 2 MB).")
    if text is None:
        return {"path": rel, "text": p.read_text("utf-8", errors="replace")}
    fd, tmp = tempfile.mkstemp(dir=p.parent, suffix=".tmp")
    with os.fdopen(fd, "w", encoding="utf-8") as f:
        f.write(text)
    os.chmod(tmp, p.stat().st_mode & 0o777)
    os.replace(tmp, p)
    return {"ok": True}


RUN_FILE_TYPES = {".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".html": "text/html",
                  ".xml": "application/xml", ".txt": "text/plain", ".jsonl": "application/json"}


def robot_run_file(root, run_id, name):
    out = robot_run_dir(root, run_id)
    if not RUN_FILE_RE.fullmatch(name) or name.split("/")[-1].startswith("."):
        raise ValueError("Invalid file")
    p = (out / name).resolve()
    if out.resolve() not in p.parents or p.suffix.lower() not in RUN_FILE_TYPES:
        raise ValueError("Invalid file")
    return p.read_bytes(), RUN_FILE_TYPES[p.suffix.lower()]

COMMON_PORTS = (3000, 3001, 3030, 4000, 4200, 5000, 5001, 5173, 5174, 5500, 5600, 7000, 8000, 8001, 8080, 8081, 8082,
                8443, 8888, 9000, 9090, 1337)


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *a, **k):
        return None  # a redirect is an answer: the app is up


def app_check(url, timeout=1.5):
    """Is an app answering at this URL? {url, up, status, ms, title}. Any HTTP answer counts as up (even a 404)."""
    u = urllib.parse.urlsplit(str(url))
    if u.scheme not in ("http", "https") or not u.hostname:
        return {"url": url, "up": False, "error": "Not an http(s) URL"}
    # Only the app's address (scheme, host, port) is asked: never a path or query from an environment value
    # (a reset link or a webhook must not be called just by opening the dashboard), and redirects aren't followed.
    origin = f"{u.scheme}://{u.netloc.rsplit('@', 1)[-1]}/"
    started = time.time()
    try:
        req = urllib.request.Request(origin, method="GET", headers={"User-Agent": "ApiMan app check"})
        ctx = ssl.create_default_context(cafile=CA_FILE) if u.scheme == "https" else None
        handlers = [_NoRedirect()] + ([urllib.request.HTTPSHandler(context=ctx)] if ctx else [])
        try:
            r = urllib.request.build_opener(*handlers).open(req, timeout=timeout)
            status, body, server_name = r.status, r.read(65536), r.headers.get("Server", "")
        except urllib.error.HTTPError as e:
            status, body, server_name = e.code, e.read(65536), e.headers.get("Server", "")
        m = re.search(rb"<title[^>]*>([^<]{1,120})", body, re.I)
        return {"url": url, "up": True, "status": status, "ms": round((time.time() - started) * 1000), "server": server_name,
                "title": m.group(1).decode("utf-8", "replace").strip() if m else ""}
    except Exception as e:  # refused, timed out, TLS...
        return {"url": url, "up": False, "error": str(getattr(e, "reason", e))[:200]}


def app_scan():
    """Apps listening on this computer's common development ports (never ApiMan's own)."""
    def open_port(port):
        for family, host in ((socket.AF_INET, "127.0.0.1"), (socket.AF_INET6, "::1")):
            try:
                with socket.socket(family) as sk:
                    sk.settimeout(0.25)
                    if sk.connect_ex((host, port)) == 0:
                        return True
            except OSError:
                continue
        return False
    ports = [x for x in COMMON_PORTS if x != SERVER_PORT]
    with concurrent.futures.ThreadPoolExecutor(16) as pool:
        up = [x for x, ok in zip(ports, pool.map(open_port, ports)) if ok]
        found = pool.map(lambda x: app_check(f"http://localhost:{x}/"), up)
        return [a for a in found if "airtunes" not in a.get("server", "").lower()]  # macOS AirPlay listens on 5000/7000


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
        if method == "GET" and path == "/api/instance":  # a second launch asking "is this ApiMan?": answers a challenge, reveals nothing
            nonce = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query).get("nonce", [""])[0]
            if not re.fullmatch(r"[0-9a-f]{32}", nonce):
                return self.reply(400, {"error": "Bad nonce"})
            return self.reply(200, {"proof": instance_proof(INSTANCE_SECRET, nonce)})
        if path.startswith("/api/") and not hmac.compare_digest(self.headers.get(TOKEN_HEADER, ""), SESSION_TOKEN):
            return self.reply(403, {"error": "Forbidden"})
        try:
            if method == "GET" and path in STATIC:
                name, ctype = STATIC[path]
                return self.reply_file(HERE / name, ctype)
            if method == "GET" and path == "/api/info":
                return self.reply(200, {"dataDir": str(self.stores["collections"].root), **({"run": RUN_JOB} if RUN_JOB else {})})
            if method == "POST" and path == "/api/run-event" and RUN_EVENTS is not None:  # only while `server.py run` runs
                ev = self.read_json(RUN_EVENT_LIMIT)  # room for a MAX_REPORT report after JSON escaping
                if not isinstance(ev, dict):
                    raise ValueError("Invalid run event")
                RUN_EVENTS.put(ev)
                return self.reply(200, {"ok": True})
            if method == "POST" and path == "/api/send":
                return self.reply(200, send(self.read_json(), self.stores["collections"].root))
            if path == "/api/cookies":
                root = self.stores["collections"].root
                q = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query)
                one = lambda k: (q.get(k) or [None])[0]
                if method == "GET":
                    return self.reply(200, CookieStore.list(root))
                if method == "DELETE":
                    CookieStore.delete(root, one("domain"), one("path"), one("name"))
                    return self.reply(200, {"ok": True})
                if method == "PUT":
                    CookieStore.set(root, self.read_json())
                    return self.reply(200, {"ok": True})
            if path == "/api/state" and method in ("GET", "PUT"):
                state = StateStore(self.stores["collections"].root)
                if method == "GET":
                    return self.reply(200, {"state": state.get()})
                state.put(self.read_json(MAX_STATE))
                return self.reply(200, {"ok": True})
            if path.startswith("/api/robot/"):
                return self.robot_route(method, path)
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

    def robot_route(self, method, path):
        root = self.stores["collections"].root
        query = {k: v[-1] for k, v in urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query).items()}
        parts = [urllib.parse.unquote(x) for x in path[len("/api/robot/"):].split("/")]
        if parts == ["projects"] and method == "GET":
            return self.reply(200, robot_projects(root))
        if parts == ["dashboard"] and method == "GET":
            return self.reply(200, robot_dashboard(root))
        if parts == ["links"] and method == "POST":
            body = self.read_json()
            return self.reply(200, robot_link(root, body.get("path") if isinstance(body, dict) else None))
        if len(parts) == 2 and parts[0] == "links" and method == "DELETE":
            return self.reply(200, robot_link(root, parts[1], remove=True))
        if parts == ["import"] and method == "POST":
            body = self.read_json()
            if not isinstance(body, dict) or not isinstance(body.get("data"), str):
                raise ValueError("Invalid request body")
            return self.reply(201, robot_import_zip(root, body.get("name"), base64.b64decode(body["data"], validate=True)))
        if parts == ["apps", "scan"] and method == "GET":
            return self.reply(200, app_scan())
        if parts == ["apps", "check"] and method == "POST":
            body = self.read_json()
            urls = body.get("urls") if isinstance(body, dict) else None
            if not isinstance(urls, list) or len(urls) > 50:
                raise ValueError("Invalid request body")
            with concurrent.futures.ThreadPoolExecutor(8) as pool:
                return self.reply(200, list(pool.map(app_check, [str(u) for u in urls])))
        if len(parts) == 2 and parts[0] == "projects" and method == "GET":
            return self.reply(200, robot_project(root, parts[1]))
        if len(parts) == 3 and parts[0] == "projects" and parts[2] == "file" and method in ("GET", "PUT"):
            text = None
            if method == "PUT":
                body = self.read_json(MAX_DATA_FILE * 2)
                text = body.get("text") if isinstance(body, dict) else None
                if not isinstance(text, str):
                    raise ValueError("Invalid request body")
            return self.reply(200, robot_data_file(root, parts[1], query.get("path", ""), text))
        if parts == ["runs"] and method == "GET":
            return self.reply(200, robot_runs(root, query.get("project")))
        if parts == ["runs"] and method == "POST":
            return self.reply(201, robot_start(root, self.stores, self.read_json()))
        if parts == ["runs", "collection"] and method == "POST":
            return self.reply(201, collection_run_start(root, self.read_json()))
        if len(parts) == 3 and parts[0] == "runs" and parts[2] == "events" and method == "POST":
            return self.reply(200, collection_run_events(root, parts[1], self.read_json(MAX_RUN_EVENTS_POST)))
        if len(parts) == 2 and parts[0] == "runs" and method == "GET":
            return self.reply(200, robot_events_since(root, parts[1], max(0, int(query.get("from") or 0))))
        if len(parts) == 3 and parts[0] == "runs" and parts[2] == "stop" and method == "POST":
            robot_run_dir(root, parts[1])
            return self.reply(200, {"stopped": robot_stop(parts[1])})
        if len(parts) >= 4 and parts[0] == "runs" and parts[2] == "files" and method == "GET":
            data, ctype = robot_run_file(root, parts[1], "/".join(parts[3:]))
            return self.reply_bytes(data, ctype)
        return self.reply(404, {"error": "Not found"})

    def reply_bytes(self, data, ctype):
        self.send_response(200)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self): self.route("GET")
    def do_POST(self): self.route("POST")
    def do_PUT(self): self.route("PUT")
    def do_DELETE(self): self.route("DELETE")

    def read_json(self, limit=None):
        length = max(0, int(self.headers.get("Content-Length") or 0))
        if length > max(MAX_REQUEST, limit or 0):  # a larger explicit limit (a run's HTML report) may exceed MAX_REQUEST
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


def open_window(url, server, data):
    """The desktop app's window: Chrome/Edge in app mode with its own profile (kept in <data>/.apiman/window), so
    it's a separate process and closing it quits ApiMan. False when no such browser is installed."""
    browser = find_browser()
    if not browser:
        return False
    proc = subprocess.Popen([browser, f"--app={url}", f"--user-data-dir={Path(data) / '.apiman' / 'window'}",
                             "--no-first-run", "--no-default-browser-check", "--window-size=1440,900"])
    if server:  # same profile as a running copy: Chrome hands the window to it and this process ends at once
        threading.Thread(target=lambda: (proc.wait(), server.shutdown()), daemon=True).start()
    return True


def instance_proof(token, nonce):
    return hmac.new(token.encode(), b"apiman-instance:" + nonce.encode(), "sha256").hexdigest()


def is_our_server(url, data):
    """Whether ApiMan with this data folder is what answers at url. It must prove it knows the secret in
    <data>/.apiman/instance (owner-only) by signing a fresh random challenge; the secret itself is never sent, so
    anything squatting on the port learns nothing and gets no window."""
    try:
        token = (Path(data) / ".apiman" / "instance").read_text("utf-8").strip()
        nonce = secrets.token_hex(16)
        got = json.loads(urllib.request.urlopen(f"{url}/api/instance?nonce={nonce}", timeout=3).read(4096)).get("proof", "")
        return bool(token) and hmac.compare_digest(str(got), instance_proof(token, nonce))
    except (OSError, ValueError, AttributeError):
        return False


def load_json_file(path, what):
    try:
        return json.loads(Path(path).expanduser().read_text(encoding="utf-8-sig"))
    except FileNotFoundError:
        raise SystemExit(f"error: {what} file not found: {path}")
    except json.JSONDecodeError as e:
        raise SystemExit(f"error: {what} file isn't valid JSON ({path}): {e}")


class DataFileError(ValueError):
    """An iteration data file `server.py run -d` can't use; the message says why, for the person running it."""


def _data_value(v):
    """Iteration data values become strings, as in Postman: 3 -> "3", true -> "true", null -> ""."""
    if isinstance(v, str):
        return v
    if v is None:
        return ""
    return json.dumps(v, ensure_ascii=False)  # numbers and booleans as JSON writes them


def parse_iteration_data(text, fmt):
    """Rows for a data-driven run: a list of {column: string}, one per iteration.
    fmt "csv": a header row, then one row per iteration (RFC 4180 quoting); fmt "json": an array of flat objects."""
    if not text.strip():
        raise DataFileError("the file is empty")
    rows = []
    if fmt == "json":
        try:
            data = json.loads(text)
        except json.JSONDecodeError as e:
            raise DataFileError(f"it isn't valid JSON: {e}")
        if not isinstance(data, list):
            raise DataFileError('a JSON data file must be an array of objects, e.g. [{"id": 1}, {"id": 2}]')
        if len(data) > MAX_DATA_ROWS:
            raise DataFileError(f"it has {len(data)} rows; the limit is {MAX_DATA_ROWS}")
        for n, obj in enumerate(data, 1):
            if not isinstance(obj, dict):
                raise DataFileError(f"row {n} isn't an object (each array item must be a flat object of column: value)")
            for k, v in obj.items():
                if isinstance(v, (dict, list)):
                    raise DataFileError(f'row {n}, "{k}": nested objects and arrays aren\'t supported, only flat objects of text, numbers and true/false')
            rows.append({k: _data_value(v) for k, v in obj.items()})
    else:
        old = csv.field_size_limit()
        csv.field_size_limit(MAX_ITERATION_FILE)  # one big quoted cell is fine as long as the file is within the limit
        reader = csv.reader(io.StringIO(text, newline=""), strict=True)
        header = None
        try:
            for rec in reader:
                if not rec:
                    continue  # blank lines (e.g. a trailing newline) aren't rows
                if header is None:
                    header = [c.strip() for c in rec]
                    for i, c in enumerate(header, 1):
                        if not c:
                            raise DataFileError(f"column {i} of the header row has no name")
                    dup = next((c for i, c in enumerate(header) if c in header[:i]), None)
                    if dup is not None:
                        raise DataFileError(f'the header row names the column "{dup}" twice')
                    continue
                if len(rec) != len(header):
                    raise DataFileError(f"row {len(rows) + 1} (line {reader.line_num}) has {len(rec)} value{'s' * (len(rec) != 1)}, "
                                        f"but the header row has {len(header)} column{'s' * (len(header) != 1)}")
                if len(rows) >= MAX_DATA_ROWS:
                    raise DataFileError(f"it has more than {MAX_DATA_ROWS} rows; the limit is {MAX_DATA_ROWS}")
                rows.append(dict(zip(header, rec)))
        except csv.Error as e:
            raise DataFileError(f"line {reader.line_num} isn't valid CSV: {e}")
        finally:
            csv.field_size_limit(old)
    if not rows:
        raise DataFileError("it has no data rows" + (" (only a header row)" if fmt != "json" else ""))
    return rows


def load_iteration_data(path):
    """Read and parse `-d FILE`: .json is JSON, .csv is CSV, anything else is JSON if it starts with "[", else CSV.
    Exits with a clear message when the file can't be used."""
    p = Path(path).expanduser()
    try:
        if not p.is_file():
            raise FileNotFoundError
        size = p.stat().st_size
        if size > MAX_ITERATION_FILE:
            raise SystemExit(f"error: iteration data file is too large ({size / 1048576:.1f} MB; the limit is {MAX_ITERATION_FILE // 1048576} MB): {path}")
        text = p.read_bytes().decode("utf-8-sig")  # a byte-order mark (Excel's "CSV UTF-8") is dropped
    except FileNotFoundError:
        raise SystemExit(f"error: iteration data file not found: {path}")
    except UnicodeDecodeError:
        raise SystemExit(f'error: iteration data file isn\'t UTF-8 text ({path}). Save it as "CSV UTF-8" or as JSON.')
    except OSError as e:
        raise SystemExit(f"error: can't read iteration data file {path}: {e.strerror or e}")
    ext = p.suffix.lower()
    fmt = "json" if ext == ".json" else "csv" if ext == ".csv" else "json" if text.lstrip().startswith("[") else "csv"
    try:
        return parse_iteration_data(text, fmt)
    except DataFileError as e:
        raise SystemExit(f"error: can't use iteration data file {path}: {e}")


def run_iterations(requested, rows):
    """How many iterations to run: one per data row when there is data (an explicit -n caps it), else -n (default 1)."""
    if rows:
        return len(rows) if requested is None else max(1, min(requested, len(rows)))
    return max(1, requested or 1)


def build_run_job(args, has_env, rows):
    """What the headless page runs (served as `run` in /api/info): the seam between server.py and app.js."""
    iterations = run_iterations(args.iterations, rows)
    return {"cid": "collection.json", "envId": "env.json" if has_env else "", "folder": args.folder,
            "iterations": iterations, "delay": max(0, args.delay), "bail": args.bail,
            "iterationData": rows[:iterations] if rows else None,
            "dataFile": Path(args.iteration_data).name if rows else None,  # shown in the HTML report
            "report": {"html": bool(args.html), "bodies": bool(args.html and args.report_bodies)}}


def iteration_label(r, iterations, with_data):
    """ "iteration 2 · data row 2" for console lines and reports; "" for a single iteration without data."""
    parts = []
    if iterations > 1 or with_data:
        parts.append(f"iteration {r.get('iteration', 1)}")
    if r.get("dataRow") is not None:
        parts.append(f"data row {r['dataRow']}")
    return ", ".join(parts)


def consume_run_events(events, check, show=lambda r: None):
    """Collect what the headless page posts until it's done: (results, outcome, report_html).
    check() returns an error message when the run should be given up (browser gone, timeout), else None.
    report_html is None when no report came, "" when it was over MAX_REPORT (never written)."""
    results, outcome, report = [], None, None
    while outcome is None:
        try:
            ev = events.get(timeout=0.5)
        except queue.Empty:
            err = check()
            if err:
                outcome = {"type": "fatal", "error": err}
            continue
        kind = ev.get("type")
        if kind == "result" and isinstance(ev.get("result"), dict):
            r = ev["result"]
            r.setdefault("iteration", 1)
            r.setdefault("dataRow", None)
            results.append(r)
            show(r)
        elif kind == "report" and isinstance(ev.get("html"), str):
            report = ev["html"] if len(ev["html"].encode("utf-8")) <= MAX_REPORT else ""
        elif kind in ("done", "fatal"):
            outcome = {"type": kind, **({"error": str(ev.get("error") or "unknown error")} if kind == "fatal" else {})}
    return results, outcome, report


def write_html_report(report, path):
    """Write the page's HTML report to --html. Returns a warning to print, or None when it was written."""
    if report is None:
        return f"no HTML report was produced, so {path} wasn't written."
    if report == "":
        return f"the HTML report was larger than {MAX_REPORT // 1048576} MB, so {path} wasn't written."
    Path(path).expanduser().write_text(report, encoding="utf-8")
    return None


def junit_report(results, suite_name, path, iterations=1, with_data=False):
    import xml.etree.ElementTree as ET
    root = ET.Element("testsuites", name=suite_name)
    tot = {"tests": 0, "failures": 0, "errors": 0, "time": 0.0}
    for r in results:
        which = iteration_label(r, iterations, with_data)  # "iteration 2, data row 2": test names stay unique per row
        tag = f" [{which}]" if which else ""
        secs = (r.get("timeMs") or 0) / 1000
        suite = ET.SubElement(root, "testsuite", name=" / ".join([*r["path"], r["name"]]) + (f" ({which})" if which else ""), time=f"{secs:.3f}")
        if which:
            props = ET.SubElement(suite, "properties")
            ET.SubElement(props, "property", name="iteration", value=str(r.get("iteration", 1)))
            if r.get("dataRow") is not None:
                ET.SubElement(props, "property", name="dataRow", value=str(r["dataRow"]))
        cases = failures = errors = 0
        classname = ".".join(re.sub(r"[^\w-]+", "_", x) for x in [*r["path"], r["name"]]) or "request"
        if r["error"]:
            cases += 1; errors += 1
            tc = ET.SubElement(suite, "testcase", classname=classname, name=f"{r['method']} request{tag}", time=f"{secs:.3f}")
            ET.SubElement(tc, "error", message=r["error"][:500]).text = r["error"]
        for t in r["tests"]:
            cases += 1
            tc = ET.SubElement(suite, "testcase", classname=classname, name=f"{t['name']}{tag}", time="0")
            if t["passed"] is False:
                failures += 1
                ET.SubElement(tc, "failure", message=(t["error"] or "failed")[:500]).text = t["error"] or "failed"
            elif t["passed"] is None:
                ET.SubElement(tc, "skipped")
        if not cases and r.get("skipped"):  # skipped by a script: reported as skipped, not as a pass
            cases = 1
            tc = ET.SubElement(suite, "testcase", classname=classname, name=f"{r['method']} skipped{tag}", time="0")
            ET.SubElement(tc, "skipped", message="pm.execution.skipRequest()")
        if not cases:  # a request without tests still shows up, passing if it got a response
            cases = 1
            ET.SubElement(suite, "testcase", classname=classname, name=f"{r['method']} responded {r['status']}{tag}", time=f"{secs:.3f}")
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


def run_parser():
    ap = argparse.ArgumentParser(prog="server.py run", description="Run a collection headlessly, e.g. in CI. Exits 1 when a test fails or a request can't be sent.")
    ap.add_argument("collection", help="Postman v2.1 collection JSON file, or the id or name of one in the data folder")
    ap.add_argument("-e", "--env", help="environment JSON file, or the id or name of one in the data folder")
    ap.add_argument("-g", "--globals", help="globals JSON file (or id in the data folder, e.g. globals.json)")
    ap.add_argument("--data", default=str(DEFAULT_DATA), help=f"data folder searched for ids and names (default: {DEFAULT_DATA})")
    ap.add_argument("--var", action="append", default=[], metavar="KEY=VALUE", help="set an environment variable (repeatable), e.g. --var token=$API_TOKEN")
    ap.add_argument("--folder", help="run only the folder with this name")
    ap.add_argument("-n", "--iterations", type=int, help="how many times to run (default 1, or one per data row with -d; caps the rows)")
    ap.add_argument("-d", "--iteration-data", metavar="FILE", help="CSV (header row + one row per iteration) or JSON (array of flat objects); "
                    "each row's values are {{column}} variables for its iteration")
    ap.add_argument("--delay", type=int, default=0, metavar="MS", help="pause between requests")
    ap.add_argument("--bail", action="store_true", help="stop at the first failure")
    ap.add_argument("--junit", metavar="FILE", help="write a JUnit XML report (for CI test tabs)")
    ap.add_argument("--json", metavar="FILE", help="write a JSON report")
    ap.add_argument("--html", metavar="FILE", help="write a self-contained HTML report (no headers or bodies unless --report-bodies)")
    ap.add_argument("--report-bodies", action="store_true", help="include request/response headers and bodies in the HTML report (credentials masked)")
    ap.add_argument("--browser", help="path to Chrome, Chromium or Edge (default: found automatically, or $APIMAN_BROWSER)")
    ap.add_argument("--ca-file", help="PEM file with your company's root CA, for internal HTTPS APIs")
    ap.add_argument("--timeout", type=float, default=1800, metavar="SECONDS", help="give up after this long (default 1800)")
    return ap


def run_main(argv):
    args = run_parser().parse_args(argv)

    global CA_FILE, SERVER_PORT, RUN_JOB, RUN_EVENTS
    if args.ca_file:
        CA_FILE = str(Path(args.ca_file).expanduser().resolve())
        ssl.create_default_context().load_verify_locations(cafile=CA_FILE)
    if args.iterations is not None and args.iterations < 1:
        raise SystemExit("error: -n/--iterations must be 1 or more")
    if args.report_bodies and not args.html:
        print("warning: --report-bodies only applies to the HTML report (--html FILE); ignoring it.", file=sys.stderr)
    rows = load_iteration_data(args.iteration_data) if args.iteration_data else None  # before the browser: bad data fails fast
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
    RUN_JOB = build_run_job(args, env is not None, rows)
    iterations, with_data = RUN_JOB["iterations"], rows is not None
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
          + (f", {iterations} iterations" if iterations > 1 else "")
          + (f", data from {Path(args.iteration_data).name} ({len(rows)} row{'s' * (len(rows) != 1)})" if with_data else ""))
    started, deadline = time.time(), time.time() + args.timeout

    def show(r):
        where = " / ".join([*r["path"], r["name"]])
        if r.get("skipped"):  # pm.execution.skipRequest(): never sent, so no status
            status = paint("2", "SKIPPED (not sent)")
        elif r["error"] or not isinstance(r.get("status"), int):
            status = paint("31", f"ERROR {r['error'] or 'no response'}")
        else:
            status = paint("32" if r["status"] < 400 else "33" if r["status"] < 500 else "31", f"{r['status']} {r['reason']}".strip())
        timing = f"  {r['timeMs']} ms" if r["timeMs"] is not None else ""
        which = iteration_label(r, iterations, with_data)
        print(f"\n{paint('1', where)}" + (f"  ({which})" if which else ""))
        print(f"  {r['method']} {r['url']}  {status}{timing}")
        for t in r["tests"]:
            if t["passed"] is False:
                print(f"  {paint('31', BAD)} {t['name']}" + (f"\n      {t['error']}" if t["error"] else ""))
            else:
                print(f"  {paint('32', OK) if t['passed'] else '-'} {t['name']}")
        for w in r["warnings"] + r["logs"]:
            print(f"  {paint('33', '!')} {w}")

    def check():
        if proc.poll() is not None:
            return f"the browser exited unexpectedly (code {proc.returncode})."
        if time.time() > deadline:
            return f"timed out after {args.timeout:g} s."
        return None

    results, outcome, report = [], None, None
    try:
        results, outcome, report = consume_run_events(RUN_EVENTS, check, show)
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
                                               "iterations": iterations,
                                               "iterationData": {"file": Path(args.iteration_data).name, "rows": len(rows)} if with_data else None,
                                               "passed": passed, "failed": failed, "requestErrors": errors, "seconds": round(elapsed, 3),
                                               "results": results, **({"error": outcome["error"]} if outcome["type"] == "fatal" else {})}, indent=2), encoding="utf-8")
    if args.junit:
        junit_report(results, name, args.junit, iterations, with_data)
    report_warning = write_html_report(report, args.html) if args.html else None
    print()
    if report_warning:
        print(paint("33", f"warning: {report_warning}"))
    if outcome["type"] == "fatal":
        print(paint("31", f"Run failed: {outcome['error']}"))
    skipped = sum(1 for r in results if r.get("skipped"))
    summary = (f"{len(results)} request{'s' * (len(results) != 1)}, {errors} failed to send"
               + (f", {skipped} skipped by scripts" if skipped else "") + f" · tests: {passed} passed, {failed} failed · {elapsed:.1f} s")
    print(paint("31" if failed or errors else "32", summary))
    tmp.cleanup()
    return 2 if outcome["type"] == "fatal" else 1 if failed or errors else 0


def main():
    if len(sys.argv) > 1 and sys.argv[1] == "run":
        sys.exit(run_main(sys.argv[2:]))
    ap = argparse.ArgumentParser(description="ApiMan local server (or: server.py run COLLECTION.json --help)")
    ap.add_argument("--port", type=int, default=5577)
    ap.add_argument("--data", default=str(DEFAULT_DATA),
                    help="folder holding collection .json files (environments go in its environments/ subfolder)")
    ap.add_argument("--ca-file", help="PEM file with your company's root CA, for internal HTTPS APIs")
    ap.add_argument("--no-browser", action="store_true")
    ap.add_argument("--window", action=argparse.BooleanOptionalAction, default=FROZEN,
                    help="open ApiMan in its own app window (Chrome/Edge) and quit when it closes (default in the desktop app)")
    args = ap.parse_args()
    if sys.stdout is None:  # desktop app without a console: print() must not crash
        sys.stdout = sys.stderr = open(os.devnull, "w")

    global CA_FILE
    if args.ca_file:
        CA_FILE = str(Path(args.ca_file).expanduser().resolve())
        ssl.create_default_context().load_verify_locations(cafile=CA_FILE)  # fail fast on a bad file

    global SERVER_PORT
    SERVER_PORT = args.port
    Handler.stores = make_stores(args.data)
    try:
        server = ThreadingHTTPServer(("127.0.0.1", args.port), Handler)  # localhost only, never the LAN
    except OSError:
        url = f"http://127.0.0.1:{SERVER_PORT}"
        running = args.window and is_our_server(url, Handler.stores["collections"].root)  # desktop app opened twice
        if not running:
            raise
        if not open_window(url, None, Handler.stores["collections"].root):
            webbrowser.open(url)
        return
    url = f"http://127.0.0.1:{SERVER_PORT}"
    instance = private_dir(Handler.stores["collections"].root) / "instance"  # proves to a second launch that this is us
    fd, tmp = tempfile.mkstemp(dir=instance.parent)  # a new owner-only file, renamed over the old: never follows a link
    with os.fdopen(fd, "w") as f:
        f.write(INSTANCE_SECRET)
    os.replace(tmp, instance)
    print(f"ApiMan running at {url}\nData folder: {Handler.stores['collections'].root}\nCtrl+C to stop.")
    if not args.no_browser and not (args.window and open_window(url, server, Handler.stores["collections"].root)):
        webbrowser.open(url)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        instance.unlink(missing_ok=True)  # stopped: nothing left to recognise
        stop_all_runs()


if __name__ == "__main__":
    main()
