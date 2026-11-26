"""Self-check for server.py. Run: python3 test_server.py  (stdlib only, no network beyond localhost)."""
import base64
import json
import os
import tempfile
import threading
import unittest
import urllib.error
import urllib.parse
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

import server


class Echo(BaseHTTPRequestHandler):
    """Fake target API: echoes what it received; /redirect?to=URL answers 302."""

    def handle_any(self):
        if self.path.startswith("/redirect?to="):
            self.send_response(302)
            self.send_header("Location", urllib.parse.unquote(self.path[len("/redirect?to="):]))
            self.send_header("Content-Length", "0")
            self.end_headers()
            return
        if self.path == "/broken":  # promises 1000 bytes, sends 3, then hangs up
            self.send_response(200)
            self.send_header("Content-Length", "1000")
            self.end_headers()
            self.wfile.write(b"abc")
            self.wfile.flush()
            self.connection.shutdown(2)
            return
        raw = self.rfile.read(int(self.headers.get("Content-Length") or 0))
        status = 404 if self.path == "/missing" else 200
        data = json.dumps({"method": self.command, "auth": self.headers.get("Authorization"),
                           "apikey": self.headers.get("X-Api-Key"), "ctype": self.headers.get("Content-Type"),
                           "body_b64": base64.b64encode(raw).decode()}).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    do_GET = do_POST = do_PUT = do_DELETE = handle_any

    def do_HEAD(self):  # promises a body length, sends no body (as HEAD must)
        self.send_response(200)
        self.send_header("Content-Length", "1234")
        self.end_headers()

    def log_message(self, *a):
        pass


def start(handler):
    srv = ThreadingHTTPServer(("127.0.0.1", 0), handler)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    return srv


class ServerTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory()
        server.Handler.stores = server.make_stores(cls.tmp.name)
        cls.app = start(server.Handler)
        server.SERVER_PORT = cls.app.server_address[1]
        cls.echo = start(Echo)
        cls.base = f"http://127.0.0.1:{cls.app.server_address[1]}"
        cls.target = f"http://127.0.0.1:{cls.echo.server_address[1]}"

    @classmethod
    def tearDownClass(cls):
        for srv in (cls.app, cls.echo):
            srv.shutdown()
            srv.server_close()
        cls.tmp.cleanup()

    def call(self, method, path, body=None, headers=None, data=None):
        if data is None and body is not None:
            data = json.dumps(body).encode()
        req = urllib.request.Request(self.base + path, method=method, headers={server.TOKEN_HEADER: server.SESSION_TOKEN, **(headers or {})},
                                     data=data)
        try:
            with urllib.request.urlopen(req) as r:
                raw = r.read()
                return r.status, json.loads(raw) if r.headers.get_content_type() == "application/json" else raw
        except urllib.error.HTTPError as e:
            with e:
                return e.code, json.loads(e.read())

    def send(self, **spec):
        return self.call("POST", "/api/send", spec)[1]

    # ---------- sending ----------

    def test_send_forwards_method_headers_body_and_reports_errors(self):
        res = self.send(method="POST", url=self.target + "/x", headers=[["Authorization", "Bearer abc"]], body='{"a":1}')
        self.assertEqual(res["status"], 200)
        echoed = json.loads(res["body"])
        self.assertEqual((echoed["method"], echoed["auth"]), ("POST", "Bearer abc"))
        self.assertEqual(base64.b64decode(echoed["body_b64"]), b'{"a":1}')

        self.assertEqual(self.send(method="GET", url=self.target + "/missing")["status"], 404)  # 4xx is a response
        self.assertIn("Connection refused by 127.0.0.1:1: nothing is listening", self.send(method="GET", url="http://127.0.0.1:1/")["error"])
        self.assertIn("must start with http", self.send(method="GET", url="file:///etc/passwd")["error"])

    def test_binary_body_is_sent_byte_for_byte(self):
        payload = bytes(range(256))
        res = self.send(method="PUT", url=self.target + "/upload", headers=[["Content-Type", "application/octet-stream"]],
                        bodyBase64=base64.b64encode(payload).decode())
        self.assertEqual(base64.b64decode(json.loads(res["body"])["body_b64"]), payload)

    # ---------- redirects ----------

    def redirect_to(self, url):
        return f"{self.target}/redirect?to=" + urllib.parse.quote(url, safe="")

    def test_redirects_keep_credentials_on_same_origin_but_drop_them_cross_origin(self):
        port = self.echo.server_address[1]
        creds = [["Authorization", "Bearer secret"], ["X-Api-Key", "k-123"], ["Accept", "application/json"]]

        same = self.send(method="GET", url=self.redirect_to(f"http://127.0.0.1:{port}/x"), headers=creds)
        self.assertEqual(json.loads(same["body"])["auth"], "Bearer secret")
        self.assertEqual(same["redirectStripped"], [])

        cross = self.send(method="GET", url=self.redirect_to(f"http://localhost:{port}/x"), headers=creds)
        echoed = json.loads(cross["body"])
        self.assertEqual(cross["finalUrl"], f"http://localhost:{port}/x")
        self.assertIsNone(echoed["auth"])     # bearer token not leaked to the other host
        self.assertIsNone(echoed["apikey"])   # nor a custom credential header (allowlist, not denylist)
        self.assertEqual(sorted(h.lower() for h in cross["redirectStripped"]), ["authorization", "x-api-key"])

    def test_https_to_http_redirect_is_refused(self):
        req = urllib.request.Request("https://api.example/a")
        with self.assertRaises(server.RedirectRefused):
            server.SafeRedirect().redirect_request(req, None, 302, "Found", {}, "http://api.example/b")

    def test_redirect_to_non_http_scheme_is_refused(self):
        res = self.send(method="GET", url=self.redirect_to("ftp://127.0.0.1:1/x"))
        self.assertIn("non-HTTP", res["error"])

    def test_response_that_breaks_off_is_reported_not_dropped(self):
        res = self.send(method="GET", url=self.target + "/broken")
        self.assertIn("broke off", res["error"])

    def test_malformed_send_requests_get_a_clear_error(self):
        self.assertEqual(self.call("POST", "/api/send", [])[1]["error"], "Invalid request")
        self.assertEqual(self.send(method="GET", url=self.target, headers=None)["status"], 200)  # null = no headers
        self.assertEqual(self.send(method="GET", url=self.target, headers=[["only-one"]])["error"], "Invalid headers")
        self.assertEqual(self.call("POST", "/api/collections", [1, 2])[0], 400)

    def test_follow_redirects_can_be_turned_off(self):
        res = self.send(method="GET", url=self.redirect_to(self.target + "/x"), followRedirects=False)
        self.assertEqual(res["status"], 302)

    # ---------- storage ----------

    def test_collections_crud_and_import_validation(self):
        coll = {"info": {"name": "My API"}, "item": [{"name": "r", "request": {"method": "GET", "url": "x"}}]}
        status, res = self.call("POST", "/api/collections", {"collection": coll})
        self.assertEqual(status, 201)
        cid = res["id"]
        self.assertEqual(cid, "My-API.json")
        self.assertEqual(self.call("POST", "/api/collections", {"collection": coll})[1]["id"], "My-API-2.json")

        coll["item"].append({"name": "r2", "request": {"method": "POST", "url": "y"}})
        self.assertEqual(self.call("PUT", f"/api/collections/{cid}", coll)[0], 200)
        self.assertEqual(len(self.call("GET", f"/api/collections/{cid}")[1]["item"]), 2)
        self.assertIn({"id": cid, "name": "My API", "folder": ""}, self.call("GET", "/api/collections")[1])

        self.assertEqual(self.call("POST", "/api/collections", {"collection": {"values": []}})[0], 400)
        self.assertEqual(self.call("DELETE", f"/api/collections/{cid}")[0], 200)
        self.assertEqual(self.call("GET", f"/api/collections/{cid}")[0], 404)

    def test_environments_are_stored_separately(self):
        env = {"name": "Staging", "values": [{"key": "baseUrl", "value": "https://staging", "enabled": True}]}
        eid = self.call("POST", "/api/environments", {"document": env})[1]["id"]
        self.assertEqual(eid, "Staging.json")
        self.assertEqual(self.call("GET", f"/api/environments/{eid}")[1]["values"][0]["key"], "baseUrl")
        self.assertNotIn(eid, [c["id"] for c in self.call("GET", "/api/collections")[1]])
        self.assertEqual(self.call("POST", "/api/environments", {"document": {"info": {}}})[0], 400)

    def test_ids_are_always_valid_case_insensitive_and_never_globals(self):
        mk = lambda name: self.call("POST", "/api/collections", {"collection": {"info": {"name": name}, "item": []}})[1]["id"]
        self.assertEqual(mk("_Internal API"), "Internal-API.json")              # leading _ no longer rejected
        self.assertEqual(mk("internal api"), "internal-api-2.json")             # same name in other case: new file
        env = lambda name: self.call("POST", "/api/environments", {"document": {"name": name, "values": []}})[1]["id"]
        self.assertEqual(env("Globals"), "globals-env.json")                    # never overwrites the Globals doc
        path = server.Handler.stores["collections"].root / "Internal-API.json"
        self.assertEqual(path.stat().st_mode & 0o777, 0o600)                     # new files: owner-only (may hold tokens)
        os.chmod(path, 0o640)
        self.call("PUT", "/api/collections/Internal-API.json", {"info": {"name": "_Internal API"}, "item": []})
        self.assertEqual(path.stat().st_mode & 0o777, 0o640)                     # an existing file keeps its chosen mode
        self.assertEqual(list(path.parent.glob("*.tmp")), [])                   # no leftovers

    def test_head_is_not_reported_as_broken(self):
        res = self.send(method="HEAD", url=self.target + "/x")
        self.assertEqual(res.get("status"), 200, res)

    def test_save_from_a_stale_window_is_refused_not_silently_overwritten(self):
        cid = self.call("POST", "/api/collections", {"collection": {"info": {"name": "Shared"}, "item": []}})[1]["id"]
        req = urllib.request.Request(f"{self.base}/api/collections/{cid}", headers={server.TOKEN_HEADER: server.SESSION_TOKEN})
        with urllib.request.urlopen(req) as r:
            version = r.headers["X-Version"]
        put = lambda body, v: urllib.request.urlopen(urllib.request.Request(
            f"{self.base}/api/collections/{cid}", data=json.dumps(body).encode(), method="PUT",
            headers={"Content-Type": "application/json", "If-Match": v, server.TOKEN_HEADER: server.SESSION_TOKEN}))
        import time as _t
        _t.sleep(0.01)
        with put({"info": {"name": "Shared"}, "item": [{"name": "from window A"}]}, version) as r:  # window A saves
            self.assertEqual(r.status, 200)
        with self.assertRaises(urllib.error.HTTPError) as ctx:                                      # window B, stale
            put({"info": {"name": "Shared"}, "item": [{"name": "from window B"}]}, version)
        self.assertEqual(ctx.exception.code, 409)
        ctx.exception.close()
        self.assertEqual(self.call("GET", f"/api/collections/{cid}")[1]["item"][0]["name"], "from window A")

    # ---------- workspace state (<data>/.apiman/state.json) ----------

    def test_state_round_trip_allowlist_and_owner_only_file(self):
        root = server.Handler.stores["collections"].root
        state_file = root / ".apiman" / "state.json"
        if state_file.exists():
            state_file.unlink()
        self.assertEqual(self.call("GET", "/api/state"), (200, {"state": None}))      # absent -> null

        snap = {"settings": {"theme": "dark"}, "activeEnv": "Staging.json", "history": [{"url": "https://x"}],
                "tabs": [], "layout": "side", "codeLang": "curl", "sizeUnit": "kb", "open": {"a": True}, "diffIgnore": []}
        self.assertEqual(self.call("PUT", "/api/state", {**snap, "oauthTokens": "secret", "outs": [1]}), (200, {"ok": True}))
        self.assertEqual(self.call("GET", "/api/state"), (200, {"state": snap}))       # unknown keys dropped
        self.assertNotIn("secret", state_file.read_text("utf-8"))
        self.assertEqual(state_file.stat().st_mode & 0o777, 0o600)
        self.assertEqual(state_file.parent.stat().st_mode & 0o777, 0o700)
        self.assertEqual(list(state_file.parent.glob("*.tmp")), [])                       # atomic, no leftovers
        self.assertIn("*", (state_file.parent / ".gitignore").read_text())             # git never picks it up
        self.assertNotIn(".apiman", str(self.call("GET", "/api/collections")[1]))        # never listed as a collection

        self.call("PUT", "/api/state", {"codeLang": "python"})                            # whole snapshot replaces
        self.assertEqual(self.call("GET", "/api/state")[1], {"state": {"codeLang": "python"}})

    def test_state_rejects_non_objects_and_oversize_bodies(self):
        for bad in ([1, 2], "x", 3, None):
            status, res = self.call("PUT", "/api/state", data=json.dumps(bad).encode())
            self.assertEqual(status, 400, bad)
        self.assertEqual(self.call("PUT", "/api/state", data=b"{not json")[0], 400)
        big = {"history": ["x" * (server.MAX_STATE + 1)]}
        self.assertEqual(self.call("PUT", "/api/state", big)[0], 413)
        self.assertEqual(self.call("POST", "/api/state", {})[0], 404)  # only GET and PUT

    def test_state_needs_the_session_token(self):
        for method, data in (("GET", None), ("PUT", b'{"codeLang": "evil"}')):
            req = urllib.request.Request(self.base + "/api/state", method=method, data=data)
            with self.assertRaises(urllib.error.HTTPError) as ctx:
                urllib.request.urlopen(req)
            self.assertEqual(ctx.exception.code, 403, method)
            ctx.exception.close()
        self.assertNotEqual((self.call("GET", "/api/state")[1]["state"] or {}).get("codeLang"), "evil")
        self.assertEqual(self.call("GET", "/api/state", headers={"Origin": "https://evil.example"})[0], 403)

    def test_api_needs_the_session_token(self):
        req = urllib.request.Request(self.base + "/api/collections")  # no token, like any other local program
        with self.assertRaises(urllib.error.HTTPError) as ctx:
            urllib.request.urlopen(req)
        self.assertEqual(ctx.exception.code, 403)
        ctx.exception.close()

    def test_proxy_cannot_call_apiman_itself(self):
        self.assertIn("own local server", self.send(method="GET", url=f"{self.base}/api/collections")["error"])
        self.assertIn("own local server", self.send(method="GET", url=f"http://localhost:{self.app.server_address[1]}/api/info")["error"])
        res = self.send(method="GET", url=self.redirect_to(f"{self.base}/api/collections"))  # via a redirect
        self.assertIn("own local server", res["error"])
        echoed = json.loads(self.send(method="GET", url=self.target, headers=[[server.TOKEN_HEADER, "x"], ["X-Api-Key", "k"]])["body"])
        self.assertEqual(echoed["apikey"], "k")  # normal headers pass; the token header is never forwarded
        port = self.app.server_address[1]
        self.assertIn("own local server", self.send(method="GET", url=f"http://[::ffff:127.0.0.1]:{port}/")["error"])
        # a rebinding domain plus a forged Host header naming ApiMan is refused before any lookup
        self.assertIn("own local server", self.send(method="GET", url=self.target, headers=[["Host", f"127.0.0.1:{port}"]])["error"])

    def test_path_traversal_is_rejected(self):
        for bad in ("..%2Fsecret.json", "%2Fetc%2Fpasswd", ".hidden.json", "x.txt"):
            self.assertEqual(self.call("GET", f"/api/collections/{bad}")[0], 400, bad)

    # ---------- who may talk to the server ----------

    def test_other_websites_cannot_use_the_proxy(self):
        status, _ = self.call("POST", "/api/send", {"method": "GET", "url": self.target},
                              headers={"Origin": "https://evil.example"})
        self.assertEqual(status, 403)
        status, _ = self.call("GET", "/api/collections", headers={"Host": "attacker.example:5577"})
        self.assertEqual(status, 403)

    def test_only_the_oauth_callback_accepts_cross_site_navigation(self):
        nav = {"Sec-Fetch-Site": "cross-site", "Sec-Fetch-Mode": "navigate", "Origin": "https://login.example"}
        status, page = self.call("GET", "/oauth-callback.html?code=x&state=y", headers=nav)
        self.assertEqual(status, 200)
        self.assertNotIn(server.SESSION_TOKEN.encode(), page)  # the callback never carries the session token
        self.assertEqual(self.call("GET", "/?code=x&state=y", headers=nav)[0], 403)  # the app itself stays same-site only
        self.assertEqual(self.call("GET", "/oauth-callback.html", headers={"Host": "attacker.example:5577"})[0], 403)

    # ---------- automation (Robot Framework) ----------

    def test_robot_projects_are_found_and_described(self):
        root = server.Handler.stores["collections"].root
        proj = root / "work" / "shop-tests"              # nested: "work" is just a folder of repos
        (proj / "tests" / "api").mkdir(parents=True)
        (proj / "resources").mkdir()
        (proj / "env").mkdir()
        (proj / "testdata").mkdir()
        (proj / "node_modules" / "x").mkdir(parents=True)
        (proj / "requirements.txt").write_text("robotframework\n")
        (proj / "env" / "qa.yaml").write_text("API_KEY: abc\n")
        (proj / "testdata" / "users.csv").write_text("name\nann\n")
        (proj / "resources" / "common.resource").write_text(
            "*** Variables ***\n${TIMEOUT}    5s\n\n*** Keywords ***\nLogin As ${user}\n    [Arguments]    ${password}\n"
            "    ${token}=    Get Token    ${BASE_URL}    ${user}    ${password}\n    RETURN    ${token}\n")
        (proj / "tests" / "api" / "orders.robot").write_text(
            "*** Settings ***\nResource    ../../resources/common.resource\nTest Tags    api\n\n*** Test Cases ***\n"
            "Place An Order\n    [Tags]    smoke\n    ${t}=    Login As ann    ${PASSWORD}\n    Log    ${CURDIR} ${TIMEOUT} ${API_KEY} %{HOME} ${1} ${t}\n"
            "    FOR    ${row}    IN    @{ROWS}\n        Log    ${row}[id]\n    END\n\nList Orders\n    Log    ${BASE URL}\n")
        (proj / "node_modules" / "x" / "skip.robot").write_text("*** Test Cases ***\nHidden\n    Log    ${NOPE}\n")
        projects = self.call("GET", "/api/robot/projects")[1]
        self.assertIn("work/shop-tests", [x["id"] for x in projects])
        status, d = self.call("GET", "/api/robot/projects/" + urllib.parse.quote("work/shop-tests", safe=""))
        self.assertEqual(status, 200, d)
        suite = d["suites"][0]
        self.assertEqual(suite["path"], "tests/api/orders.robot")
        self.assertEqual([t["name"] for t in suite["tests"]], ["Place An Order", "List Orders"])
        self.assertEqual(suite["tests"][0]["tags"], ["api", "smoke"])
        # used but never defined: BASE_URL (also written ${BASE URL}), PASSWORD, ROWS; not TIMEOUT, user, password,
        # token, t, row (defined), CURDIR (built in), API_KEY (env/qa.yaml), numbers, or anything in node_modules
        self.assertEqual(sorted(k["name"] for k in d["keys"]), ["BASE_URL", "PASSWORD", "ROWS"])
        self.assertEqual(d["envVars"], ["HOME"])
        self.assertEqual(d["varfiles"], ["env/qa.yaml"])
        self.assertIn("testdata/users.csv", [f["path"] for f in d["data"]])
        pq = urllib.parse.quote("work/shop-tests", safe="")
        self.assertEqual(self.call("GET", f"/api/robot/projects/{pq}/file?path=testdata/users.csv")[1]["text"], "name\nann\n")
        self.assertEqual(self.call("PUT", f"/api/robot/projects/{pq}/file?path=testdata/users.csv", {"text": "name\nbob\n"})[0], 200)
        self.assertEqual((proj / "testdata" / "users.csv").read_text(), "name\nbob\n")
        for bad in ("../../../etc/passwd", "../../../../x.csv", "tests/api/orders.robot"):  # outside, or not test data
            self.assertEqual(self.call("GET", f"/api/robot/projects/{pq}/file?path={urllib.parse.quote(bad)}")[0], 400, bad)

    def test_robot_ids_and_run_files_cannot_escape(self):
        for bad in ("..", "..%2F..", ".git", "a%2F..%2F..%2Fetc"):
            self.assertIn(self.call("GET", f"/api/robot/projects/{bad}")[0], (400, 404), bad)
        for bad in ("../x", "20261127-000000-abcdef%2F..", "nope"):
            self.assertIn(self.call("GET", f"/api/robot/runs/{bad}")[0], (400, 404), bad)
        runs = server.runs_dir(server.Handler.stores["collections"].root, create=True) / "20261127-000000-abcdef"
        (runs / "shots").mkdir(parents=True)
        (runs / "meta.json").write_text('{"id": "20261127-000000-abcdef", "project": "p", "status": "passed", "started": 1}')
        (runs / "shots" / "shot-00001.png").write_bytes(b"\x89PNG")
        (runs / "secret.json").write_text("{}")
        self.assertEqual(self.call("GET", "/api/robot/runs/20261127-000000-abcdef/files/shots/shot-00001.png")[1], b"\x89PNG")
        for bad in ("secret.json", "..%2Fmeta.json", "shots%2F..%2F..%2Fx.png", ".hidden.png"):
            self.assertEqual(self.call("GET", f"/api/robot/runs/20261127-000000-abcdef/files/{bad}")[0], 400, bad)
        self.assertEqual([r["id"] for r in self.call("GET", "/api/robot/runs?project=p")[1]], ["20261127-000000-abcdef"])
        status, res = self.call("POST", "/api/robot/runs", {"project": "..", "suite": "."})
        self.assertEqual(status, 400, res)

    def test_a_run_cut_short_is_reported_stopped_not_running_forever(self):
        out = server.runs_dir(server.Handler.stores["collections"].root, create=True) / "20261127-000001-abcdef"
        out.mkdir(parents=True)
        (out / "meta.json").write_text('{"id": "20261127-000001-abcdef", "project": "q", "status": "running", "started": 1}')
        (out / "events.jsonl").write_text('{"t": "test_end", "name": "A", "status": "PASS"}\n')
        self.assertEqual(self.call("GET", "/api/robot/runs?project=q")[1][0]["status"], "stopped")  # server never ran it
        res = self.call("GET", "/api/robot/runs/20261127-000001-abcdef")[1]
        self.assertEqual((res["meta"]["status"], res["meta"]["passed"]), ("stopped", 1))
        self.assertEqual(self.call("POST", "/api/robot/runs/20261127-000001-abcdef/stop")[1], {"stopped": False})

    def test_only_whitelisted_static_files_are_served(self):
        self.assertEqual(self.call("GET", "/server.py")[0], 404)
        self.assertEqual(self.call("GET", "/../server.py")[0], 404)


class NestedFoldersTest(unittest.TestCase):
    """Collections and environments anywhere in the data folder (each test gets a fresh data folder)."""

    @classmethod
    def setUpClass(cls):
        cls.handler = type("NestedHandler", (server.Handler,), {})
        cls.app = start(cls.handler)
        cls.base = f"http://127.0.0.1:{cls.app.server_address[1]}"

    @classmethod
    def tearDownClass(cls):
        cls.app.shutdown()
        cls.app.server_close()

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.outside = tempfile.TemporaryDirectory()
        self.handler.stores = server.make_stores(self.tmp.name)
        self.root = self.handler.stores["collections"].root

    def tearDown(self):
        self.tmp.cleanup()
        self.outside.cleanup()

    call = ServerTest.call

    def write(self, rel, obj, base=None):
        p = (base or self.root) / rel
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(obj if isinstance(obj, str) else json.dumps(obj), "utf-8")
        return p

    @staticmethod
    def coll(name):
        return {"info": {"name": name}, "item": []}

    @staticmethod
    def env(name):
        return {"name": name, "values": []}

    def listing(self, kind):
        status, res = self.call("GET", f"/api/{kind}")
        self.assertEqual(status, 200)
        return [(d["folder"], d["id"], d["name"]) for d in res]

    def q(self, doc_id):
        return urllib.parse.quote(doc_id, safe="")

    def test_names_as_people_write_them_are_found_and_editable(self):
        import unicodedata
        names = ["Orders (v2).json", "Café API.json", "R&D + QA [old].json", unicodedata.normalize("NFD", "Équipe.json")]
        for n in names:
            self.write(f"Équipe (2024)/{n}", self.coll(n[:-5]))
        found = {i for _, i, _ in self.listing("collections")}
        self.assertEqual(found, {f"Équipe (2024)/{n}" for n in names})
        doc_id = "Équipe (2024)/Orders (v2).json"
        self.assertEqual(self.call("GET", f"/api/collections/{self.q(doc_id)}")[0], 200)
        self.assertEqual(self.call("PUT", f"/api/collections/{self.q(doc_id)}", self.coll("Renamed"))[0], 200)
        self.assertEqual(json.loads((self.root / doc_id).read_text("utf-8"))["info"]["name"], "Renamed")
        for bad in ["Équipe (2024)/../x.json", "a/\\b.json", "a:b/x.json", "a/x?.json"]:
            self.assertNotEqual(self.call("GET", f"/api/collections/{self.q(bad)}")[0], 200, bad)

    def test_nested_collections_are_found_at_every_depth(self):
        self.write("Top.json", self.coll("Top"))
        self.write("payments/Pay.json", self.coll("Pay"))
        self.write("payments/v2/deep/Orders.json", self.coll("Orders"))
        self.write("a/b/c/d/e/f/g/h/Eight.json", self.coll("Eight"))          # 8 folder levels: found
        self.write("a/b/c/d/e/f/g/h/i/Nine.json", self.coll("Nine"))          # 9: too deep
        self.assertEqual(self.listing("collections"), [
            ("", "Top.json", "Top"),
            ("a/b/c/d/e/f/g/h", "a/b/c/d/e/f/g/h/Eight.json", "Eight"),
            ("payments", "payments/Pay.json", "Pay"),
            ("payments/v2/deep", "payments/v2/deep/Orders.json", "Orders"),
        ])
        # the id arrives URL-encoded as one segment, or with literal "/"
        self.assertEqual(self.call("GET", "/api/collections/" + self.q("payments/v2/deep/Orders.json"))[1]["info"]["name"], "Orders")
        self.assertEqual(self.call("GET", "/api/collections/payments/v2/deep/Orders.json")[1]["info"]["name"], "Orders")
        self.assertNotIn("Nine", str(self.listing("collections")))

    def test_postman_export_file_names_are_detected_by_content(self):
        self.write("exports/Orders API.postman_collection.json", self.coll("Orders API"))
        self.write("exports/Staging.postman_environment.json", self.env("Staging"))
        self.assertEqual(self.listing("collections"), [("exports", "exports/Orders API.postman_collection.json", "Orders API")])
        self.assertEqual(self.listing("environments"), [("exports", "exports/Staging.postman_environment.json", "Staging")])

    def test_other_json_is_ignored_and_never_touched(self):
        pkg = self.write("package.json", {"name": "web", "version": "1.0.0"})
        self.write("tsconfig.json", "{not json")
        self.write("list.json", "[1, 2]")
        self.write("both.json", {"values": [], "item": []})   # neither a collection nor an environment
        self.write("Real.json", self.coll("Real"))
        self.assertEqual([i for _, i, _ in self.listing("collections")], ["Real.json"])
        self.assertEqual(self.listing("environments"), [])
        before = pkg.read_bytes()
        self.assertEqual(self.call("GET", "/api/collections/package.json")[0], 404)
        self.assertEqual(self.call("GET", "/api/environments/.%2Fpackage.json")[0], 404)
        self.assertEqual(self.call("DELETE", "/api/collections/package.json")[0], 404)
        self.assertEqual(self.call("PUT", "/api/collections/package.json", self.coll("x"))[0], 400)
        self.assertEqual(pkg.read_bytes(), before)
        # a collection id can't be used to read or overwrite an environment, and the other way round
        self.write("environments/Staging.json", self.env("Staging"))
        self.assertEqual(self.call("GET", "/api/collections/" + self.q("environments/Staging.json"))[0], 404)
        self.assertEqual(self.call("PUT", "/api/environments/.%2FReal.json", self.env("x"))[0], 400)

    def test_environment_files_anywhere_get_the_contract_ids(self):
        self.write("environments/Staging.json", self.env("Staging"))
        self.write("environments/globals.json", {"name": "Globals", "values": [], "_postman_variable_scope": "globals"})
        self.write("environments/team/Dev.json", self.env("Dev"))
        self.write("Local.json", self.env("Local"))
        self.write("payments/Pay.postman_environment.json", self.env("Pay"))
        self.assertEqual(self.listing("environments"), [
            ("", "globals.json", "Globals"), ("", "./Local.json", "Local"), ("", "Staging.json", "Staging"),
            ("environments/team", "environments/team/Dev.json", "Dev"),
            ("payments", "payments/Pay.postman_environment.json", "Pay"),
        ])
        for eid, name in (("Staging.json", "Staging"), ("environments/Staging.json", "Staging"), ("./Local.json", "Local"),
                          ("environments/team/Dev.json", "Dev"), ("payments/Pay.postman_environment.json", "Pay")):
            self.assertEqual(self.call("GET", "/api/environments/" + self.q(eid))[1]["name"], name, eid)
        self.assertEqual(self.call("GET", "/api/environments/Local.json")[0], 404)  # bare = environments/Local.json
        self.assertEqual(self.listing("collections"), [])

    def test_legacy_ids_still_work(self):
        self.write("Orders.json", self.coll("Orders"))
        self.write("environments/Staging.json", self.env("Staging"))
        self.assertEqual(self.call("PUT", "/api/collections/Orders.json", self.coll("Orders 2"))[0], 200)
        self.assertEqual(self.call("GET", "/api/collections/Orders.json")[1]["info"]["name"], "Orders 2")
        self.assertEqual(self.call("PUT", "/api/environments/Staging.json", self.env("Staging 2"))[0], 200)
        self.assertEqual(json.loads((self.root / "environments" / "Staging.json").read_text())["name"], "Staging 2")
        self.assertEqual(self.call("POST", "/api/environments", {"document": self.env("Prod")})[1]["id"], "Prod.json")
        self.assertEqual(self.call("POST", "/api/collections", {"collection": self.coll("New")})[1]["id"], "New.json")
        self.assertEqual(self.call("DELETE", "/api/collections/Orders.json")[0], 200)
        self.assertEqual(self.call("DELETE", "/api/environments/Staging.json")[0], 200)
        self.assertFalse((self.root / "Orders.json").exists() or (self.root / "environments" / "Staging.json").exists())

    def test_create_in_a_folder_creates_the_folder(self):
        status, res = self.call("POST", "/api/collections", {"collection": self.coll("Orders"), "folder": "teams/alpha"})
        self.assertEqual((status, res["id"]), (201, "teams/alpha/Orders.json"))
        p = self.root / "teams" / "alpha" / "Orders.json"
        self.assertEqual(p.stat().st_mode & 0o777, 0o600)
        self.assertEqual(self.call("POST", "/api/collections", {"collection": self.coll("orders"), "folder": "teams/alpha"})[1]["id"],
                         "teams/alpha/orders-2.json")                                         # case-insensitive per folder
        self.assertEqual(self.call("POST", "/api/collections", {"collection": self.coll("Orders")})[1]["id"], "Orders.json")
        self.assertIn(("teams/alpha", "teams/alpha/Orders.json", "Orders"), self.listing("collections"))
        env = lambda folder, name="Staging": self.call("POST", "/api/environments", {"document": self.env(name), "folder": folder})
        self.assertEqual(env("payments")[1]["id"], "payments/Staging.json")
        self.assertEqual(env("")[1]["id"], "Staging.json")
        self.assertEqual(env("environments/team")[1]["id"], "environments/team/Staging.json")
        self.assertEqual(env("payments", "Globals")[1]["id"], "payments/globals-env.json")
        for bad in ("../x", ".hidden", "a/../b", "a//b", "a\\b", "/".join("abcdefghi"), 5):
            self.assertEqual(env(bad)[0], 400, bad)
        self.assertEqual(self.call("POST", "/api/collections", {"collection": self.coll("X"), "folder": "Teams"})[0], 400)  # "teams" exists
        self.assertFalse((self.root.parent / "x").exists())
        self.assertEqual(list(self.root.rglob("*.tmp")), [])

    def test_invalid_ids_are_rejected(self):
        self.write("ok/Fine.json", self.coll("Fine"))
        bad = ["../secret.json", "ok/../Fine.json", "/etc/passwd.json", "./Fine.json", "ok/./Fine.json", ".apiman/state.json",
               "ok/.git/x.json", "ok//Fine.json", "ok\\Fine.json", "/".join("abcdefghi") + "/x.json", "ok/Fine.json\n", "ok/Fine.txt"]
        for doc_id in bad:
            for method in ("GET", "PUT", "DELETE"):
                status = self.call(method, "/api/collections/" + self.q(doc_id), self.coll("x") if method == "PUT" else None)[0]
                self.assertIn(status, (400, 404), (method, doc_id))
        for doc_id in ("../secret.json", "./../secret.json", "environments/../x.json", ".apiman/state.json"):
            self.assertEqual(self.call("GET", "/api/environments/" + self.q(doc_id))[0], 400, doc_id)
        self.assertEqual(self.call("PUT", "/api/environments/" + self.q("./../x.json"), self.env("x"))[0], 400)
        self.assertFalse((self.root.parent / "x.json").exists())
        # a file where a folder should be: a clear 400, not a dropped connection
        self.assertEqual(self.call("PUT", "/api/collections/" + self.q("ok/Fine.json/x.json"), self.coll("x"))[0], 400)
        self.assertEqual(self.call("POST", "/api/collections", {"collection": self.coll("X"), "folder": "ok/Fine.json"})[0], 400)
        self.assertEqual(self.call("PUT", "/api/collections/" + self.q("missing/x.json"), self.coll("x"))[0], 404)

    def test_symlinks_never_lead_out_of_the_data_folder(self):
        out = Path(self.outside.name)
        self.write("Secret.json", self.coll("Secret"), base=out)
        os.symlink(out, self.root / "linked")                          # symlinked folder: skipped
        os.symlink(out / "Secret.json", self.root / "Link.json")       # symlinked file pointing outside
        self.write("real/Inner.json", self.coll("Inner"))
        os.symlink(self.root / "real", self.root / "alias")            # even a link inside the data folder
        self.assertEqual([i for _, i, _ in self.listing("collections")], ["real/Inner.json"])
        for doc_id in ("linked/Secret.json", "Link.json", "alias/Inner.json"):
            self.assertEqual(self.call("GET", "/api/collections/" + self.q(doc_id))[0], 400, doc_id)
            self.assertEqual(self.call("PUT", "/api/collections/" + self.q(doc_id), self.coll("pwned"))[0], 400, doc_id)
        self.assertEqual(self.call("POST", "/api/collections", {"collection": self.coll("X"), "folder": "linked"})[0], 400)
        self.assertEqual(json.loads((out / "Secret.json").read_text())["info"]["name"], "Secret")
        self.assertEqual(os.listdir(out), ["Secret.json"])

    def test_hidden_folders_and_node_modules_are_never_listed(self):
        for rel in (".apiman/Hidden.json", ".git/Hidden.json", "node_modules/pkg/Hidden.json", "a/.cache/Hidden.json", ".Hidden.json"):
            self.write(rel, self.coll("Hidden"))
            self.write(rel.replace("Hidden.json", "HiddenEnv.json"), self.env("Hidden"))
        self.assertEqual(self.listing("collections"), [])
        self.assertEqual(self.listing("environments"), [])
        self.assertEqual(self.call("PUT", "/api/collections/" + self.q(".apiman/state.json"), self.coll("x"))[0], 400)
        self.assertEqual(self.call("POST", "/api/collections", {"collection": self.coll("X"), "folder": ".apiman"})[0], 400)

    def test_put_on_a_nested_id_writes_in_place(self):
        p = self.write("payments/v2/Orders.postman_collection.json", self.coll("Orders"))
        os.chmod(p, 0o640)
        cid = self.q("payments/v2/Orders.postman_collection.json")
        req = urllib.request.Request(f"{self.base}/api/collections/{cid}", headers={server.TOKEN_HEADER: server.SESSION_TOKEN})
        with urllib.request.urlopen(req) as r:
            version = r.headers["X-Version"]
        renamed = {"info": {"name": "Orders (renamed)"}, "item": [{"name": "r"}]}
        self.assertEqual(self.call("PUT", f"/api/collections/{cid}", renamed, headers={"If-Match": version})[0], 200)
        self.assertEqual(json.loads(p.read_text())["info"]["name"], "Orders (renamed)")
        self.assertEqual(p.stat().st_mode & 0o777, 0o640)
        self.assertEqual(sorted(str(x.relative_to(self.root)) for x in self.root.rglob("*") if x.is_file()),
                         ["payments/v2/Orders.postman_collection.json"])
        self.assertEqual(self.call("PUT", f"/api/collections/{cid}", self.coll("stale"), headers={"If-Match": version})[0], 409)
        self.assertEqual(self.call("DELETE", f"/api/collections/{cid}", headers={"If-Match": version})[0], 409)
        self.assertEqual(self.listing("collections"), [("payments/v2", "payments/v2/Orders.postman_collection.json", "Orders (renamed)")])
        self.assertEqual(self.call("PUT", "/api/collections/" + self.q("payments/v2/orders.postman_collection.json"), self.coll("x"))[0], 400)

    def test_listing_follows_changes_and_stops_at_the_file_limit(self):
        p = self.write("A.json", self.coll("First"))
        self.assertEqual(self.listing("collections"), [("", "A.json", "First")])
        p.write_text(json.dumps(self.coll("Second name")), "utf-8")      # the cache notices the change (size/mtime)
        self.assertEqual(self.listing("collections"), [("", "A.json", "Second name")])
        p.write_text(json.dumps(self.env("Now an env")), "utf-8")
        self.assertEqual(self.listing("collections"), [])
        for i in range(5):
            self.write(f"many/C{i}.json", self.coll(f"C{i}"))
        old = server.MAX_SCAN_FILES
        server.MAX_SCAN_FILES = 3
        try:
            self.assertEqual(len(self.listing("collections")), 2)            # A.json counts too; the rest is still listed
        finally:
            server.MAX_SCAN_FILES = old
        big = self.write("Big.json", json.dumps(self.coll("Big")))
        old = server.MAX_SCAN_FILE
        server.MAX_SCAN_FILE = big.stat().st_size - 1
        try:
            self.assertNotIn("Big.json", [i for _, i, _ in self.listing("collections")])
        finally:
            server.MAX_SCAN_FILE = old

    def test_run_finds_documents_by_id_or_name_in_nested_folders(self):
        self.write("payments/v2/Orders.postman_collection.json", self.coll("Orders API"))
        self.write("environments/team/Staging.json", self.env("Staging"))
        self.write("environments/globals.json", self.env("Globals"))
        data = str(self.root)
        target = str(self.root / "payments" / "v2" / "Orders.postman_collection.json")
        self.assertEqual(server.resolve_run_file("payments/v2/Orders.postman_collection.json", "collections", data), target)
        self.assertEqual(server.resolve_run_file("orders api", "collections", data), target)
        self.assertEqual(server.resolve_run_file("Staging", "environments", data), str(self.root / "environments" / "team" / "Staging.json"))
        self.assertEqual(server.resolve_run_file("globals.json", "environments", data), str(self.root / "environments" / "globals.json"))
        self.assertEqual(server.resolve_run_file("Nope", "collections", data), "Nope")  # reported as a missing file later
        self.write("other/Orders.json", self.coll("Orders API"))
        with self.assertRaises(SystemExit):
            server.resolve_run_file("Orders API", "collections", data)            # ambiguous name: refused, not guessed


if __name__ == "__main__":
    unittest.main()
