"""Self-check for server.py. Run: python3 test_server.py  (stdlib only, no network beyond localhost)."""
import base64
import zlib
import json
import os
import tempfile
import threading
import time
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


def quiet_runs():
    """No run left over from an earlier test: ApiMan runs one at a time, and a stopped run finishes in the background."""
    server.stop_all_runs()
    end = time.time() + 15
    while time.time() < end:
        with server.RUNS_LOCK:
            if not server.RUNS:
                break
        time.sleep(0.05)
    with server.RUNS_LOCK:
        server.COLLECTION_RUNS.clear()


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
        if os.name != "nt":  # Windows has no Unix file modes
            self.assertEqual(path.stat().st_mode & 0o777, 0o600)                     # new files: owner-only (may hold tokens)
        os.chmod(path, 0o640)
        self.call("PUT", "/api/collections/Internal-API.json", {"info": {"name": "_Internal API"}, "item": []})
        if os.name != "nt":  # Windows has no Unix file modes
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
        if os.name != "nt":  # Windows has no Unix file modes
            self.assertEqual(state_file.stat().st_mode & 0o777, 0o600)
        if os.name != "nt":  # Windows has no Unix file modes
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

    def test_projects_can_be_linked_from_anywhere_and_imported_as_zips(self):
        import io, zipfile
        root = server.Handler.stores["collections"].root
        with tempfile.TemporaryDirectory() as outside:
            (Path(outside) / "suite.robot").write_text("*** Test Cases ***\nT\n    Log    ${URL}\n")
            self.assertEqual(self.call("POST", "/api/robot/links", {"path": outside})[0], 200)
            linked = [x for x in self.call("GET", "/api/robot/projects")[1] if x.get("linked")]
            self.assertEqual(len(linked), 1)
            d = self.call("GET", f"/api/robot/projects/{linked[0]['id']}")[1]
            self.assertEqual([k["name"] for k in d["keys"]], ["URL"])
            empty = Path(outside) / "empty"
            empty.mkdir()
            self.assertEqual(self.call("POST", "/api/robot/links", {"path": str(empty)})[0], 400)  # no tests there
            self.assertEqual(self.call("DELETE", f"/api/robot/links/{linked[0]['id']}")[0], 200)
            self.assertFalse([x for x in self.call("GET", "/api/robot/projects")[1] if x.get("linked")])

        def zipped(files):
            buf = io.BytesIO()
            with zipfile.ZipFile(buf, "w") as z:
                for name, text in files.items():
                    z.writestr(name, text)
            return base64.b64encode(buf.getvalue()).decode()
        ok = zipped({"office-tests/tests/login.robot": "*** Test Cases ***\nLogin\n    Log    hi\n", "office-tests/data/u.csv": "a\n"})
        status, res = self.call("POST", "/api/robot/import", {"name": "office-tests.zip", "data": ok})
        self.assertEqual((status, res["id"]), (201, "office-tests"))
        self.assertTrue((root / "office-tests" / "tests" / "login.robot").is_file())  # the top folder became the project
        self.assertEqual(self.call("POST", "/api/robot/import", {"name": "x.zip", "data": ok})[1]["id"], "office-tests-2")
        status, res = self.call("POST", "/api/robot/import", {"name": "_api-tests.zip", "data": zipped({"t.robot": "*** Test Cases ***\nT\n    Log    x\n"})})
        self.assertEqual(status, 201, res)
        self.assertIn(res["id"], [x["id"] for x in self.call("GET", "/api/robot/projects")[1]])  # a name every id can address
        for bad in ({"../evil.robot": "x"}, {"/abs.robot": "x"}, {"a/../../evil.robot": "x"}, {"notes.txt": "no tests"}):
            status, res = self.call("POST", "/api/robot/import", {"name": "bad.zip", "data": zipped(bad)})
            self.assertEqual(status, 400, (bad, res))
        self.assertFalse((root.parent / "evil.robot").exists())
        self.assertEqual(self.call("POST", "/api/robot/import", {"name": "x.zip", "data": base64.b64encode(b"nope").decode()})[0], 400)

    def test_robot_http_calls_are_found_for_pairing(self):
        text = ("*** Test Cases ***\nA\n    ${r}=    GET On Session    api    /employees/${id}    expected_status=200\n"
                "    RequestsLibrary.DELETE On Session    api    url=/x\n    ${r}    =    GET    ${BASE_URL}/api/info\n"
                "    PUT    https://api.example.com/v1/things/7\n    Log    /not/http\n    GET On Session    api    ${ENDPOINT}\n")
        self.assertEqual(server.robot_http_calls(text), [("GET", "/employees/${id}", ""), ("DELETE", "/x", ""), ("GET", "/api/info", ""),
                                                         ("PUT", "/v1/things/7", "api.example.com")])

    def test_collection_runs_are_suite_results(self):
        quiet_runs()
        root = server.Handler.stores["collections"].root
        (root / "shop-tests").mkdir(exist_ok=True)
        (root / "shop-tests" / "t.robot").write_text("*** Test Cases ***\nT\n    GET On Session    s    /api/orders\n")
        status, meta = self.call("POST", "/api/robot/runs/collection", {"project": "shop-tests", "projectName": "shop-tests", "collectionName": "Shop", "cases": 2})
        self.assertEqual((status, meta["kind"], meta["status"]), (201, "collection", "running"))
        rid = meta["id"]
        ev = [{"t": "test_start", "name": "Login"}, {"t": "http", "method": "POST", "url": "http://h/api/login", "status": 200,
               "reqHeaders": {"Authorization": "Bearer abc", "X-Api-Key": "k", "Accept": "json"}, "resHeaders": {"Set-Cookie": "s=1"}},
              {"t": "test_end", "name": "Login", "status": "PASS"}, {"t": "evil", "x": 1}, "garbage"]
        self.assertEqual(self.call("POST", f"/api/robot/runs/{rid}/events", {"events": ev})[0], 200)
        res = self.call("GET", f"/api/robot/runs/{rid}")[1]
        http = [e for e in res["events"] if e["t"] == "http"][0]
        self.assertEqual(http["reqHeaders"], {"Authorization": "•••", "X-Api-Key": "•••", "Accept": "json"})  # masked server-side too
        self.assertEqual(http["resHeaders"], {"Set-Cookie": "•••"})
        self.assertNotIn("evil", [e["t"] for e in res["events"]])
        self.assertEqual(res["meta"]["status"], "running")
        done = [{"t": "test_start", "name": "Orders"}, {"t": "test_end", "name": "Orders", "status": "FAIL", "message": "HTTP 500"}]
        self.assertEqual(self.call("POST", f"/api/robot/runs/{rid}/events", {"events": done, "done": "done"})[0], 200)
        m = self.call("GET", f"/api/robot/runs?project=shop-tests")[1][0]
        self.assertEqual((m["status"], m["passed"], m["failed"], m["kind"]), ("failed", 1, 1, "collection"))
        self.assertEqual(self.call("POST", f"/api/robot/runs/{rid}/events", {"events": []})[0], 400)  # finished: nothing more
        # its own calls never count as "called by the tests"
        d = self.call("GET", "/api/robot/projects/shop-tests")[1]
        self.assertEqual([(e["method"], e["path"]) for e in d["endpoints"]], [("GET", "/api/orders")])
        # a page closed mid-run: reported stopped, not running forever
        rid2 = self.call("POST", "/api/robot/runs/collection", {"project": "shop-tests", "collectionName": "Shop"})[1]["id"]
        server.COLLECTION_RUNS[rid2] = 0  # no news for a long time
        self.assertEqual(self.call("GET", f"/api/robot/runs/{rid2}")[1]["meta"]["status"], "stopped")
        self.assertEqual(self.call("POST", "/api/robot/runs/collection", {"project": "../x"})[0], 400)
        # cut short by an error: failed and interrupted, never "passed"
        rid3 = self.call("POST", "/api/robot/runs/collection", {"project": "shop-tests", "collectionName": "Shop"})[1]["id"]
        ok = [{"t": "test_start", "name": "A"}, {"t": "test_end", "name": "A", "status": "PASS"},
              {"t": "http", "method": "POST", "url": "http://h/login?api_key=k1&page=2", "status": 200, "reqBody": '{"user":"a","password":"hunter2","nested":{"token":"t"}}'}]
        self.call("POST", f"/api/robot/runs/{rid3}/events", {"events": ok, "done": "error"})
        m3 = self.call("GET", f"/api/robot/runs/{rid3}")[1]
        self.assertEqual((m3["meta"]["status"], m3["meta"].get("interrupted")), ("failed", True))
        logged = [e for e in m3["events"] if e["t"] == "http"][0]
        self.assertEqual(logged["url"], "http://h/login?api_key=•••&page=2")         # credentials hidden in URLs
        self.assertEqual(json.loads(logged["reqBody"]), {"user": "a", "password": "•••", "nested": {"token": "•••"}})  # and in JSON bodies
        self.assertEqual(m3["meta"]["calls"], [["POST", "/login", "h"]])             # the calls it made, kept with the run

    def test_second_launch_trusts_only_our_own_server(self):
        data = self.tmp.name
        inst = server.private_dir(data) / "instance"
        inst.write_text(server.INSTANCE_SECRET, "utf-8")
        self.assertTrue(server.is_our_server(self.base, data))                     # ours: signs the challenge with our secret
        self.assertFalse(server.is_our_server(self.base, tempfile.mkdtemp()))      # another data folder: no secret file
        inst.write_text("someone-else", "utf-8")
        self.assertFalse(server.is_our_server(self.base, data))                    # a different ApiMan: wrong proof
        inst.write_text(server.INSTANCE_SECRET, "utf-8")
        squat = start(Echo)                                                        # anything else on the port
        seen = []
        orig = Echo.do_GET
        Echo.do_GET = lambda h: (seen.append(h.path + str(dict(h.headers))), orig(h))[1]
        try:
            self.assertFalse(server.is_our_server(f"http://127.0.0.1:{squat.server_address[1]}", data))
        finally:
            Echo.do_GET = orig
            squat.shutdown()
        self.assertEqual(len(seen), 1)                                             # it was asked once...
        self.assertFalse(any(server.INSTANCE_SECRET in x or server.SESSION_TOKEN in x for x in seen))  # it learned nothing
        self.assertEqual(self.call("GET", "/api/instance?nonce=nothex")[0], 400)
        inst.unlink()

    def test_review_fixes_stop_twice_shutdown_and_leaks(self):
        import robot_listener as rl
        import subprocess, sys
        proc = subprocess.Popen([sys.executable, "-c", "import time; time.sleep(30)"], **({"start_new_session": True} if os.name != "nt" else {}))
        fd, varfile = tempfile.mkstemp(prefix="apiman_vars_"); os.close(fd)
        with server.RUNS_LOCK:
            server.RUNS["t-run"], server.VARFILES["t-run"] = proc, varfile
        try:
            self.assertTrue(server.robot_stop("t-run"))
            self.assertTrue(server.robot_stop("t-run"))                            # Stop again: still "stopped", never a new run
            server.stop_all_runs()                                                 # ApiMan stopping: runs end, secrets file gone
            self.assertFalse(os.path.exists(varfile))
            proc.wait(10)
        finally:
            with server.RUNS_LOCK:
                server.RUNS.pop("t-run", None); server.VARFILES.pop("t-run", None); server.STOPPING.discard("t-run")
        for name in ("X-Session-Id", "jwt", "db_pwd", "AWS_ACCESS_KEY", "x-auth"):
            self.assertTrue(server.secret_name(name) and rl._secret(name), name)
        self.assertFalse(server.secret_name("Content-Type"))
        big = rl._cut(rl._secrets(json.dumps({"password": "p", "x": "a" * 70000})))
        self.assertIn('"password": "•••"', big)                                    # masked before it's cut
        self.assertNotIn("abc", rl._mask_text("ConnectionError: url: /a?token=abc&page=2"))
        self.assertEqual(server.robot_http_calls("*** Test Cases ***\nT\n    GET    https://u:pw@h.io/a\n"), [("GET", "/a", "h.io")])

    def test_masking_covers_userinfo_and_form_bodies(self):
        self.assertEqual(server.mask_url("https://bob:pw@h.io/x?token=t&a=1"), "https://•••@h.io/x?token=•••&a=1")
        self.assertEqual(server.mask_url("http://h/x"), "http://h/x")
        self.assertEqual(server.mask_body("user=a&password=p%20w&client_secret=s"), "user=a&password=•••&client_secret=•••")
        self.assertEqual(server.mask_body("plain text = not a form"), "plain text = not a form")
        self.assertEqual(server.run_calls([{"t": "http", "url": "http://u:p@H:8080/a"}]), [("GET", "/a", "h:8080")])
        import robot_listener as rl
        self.assertEqual(rl._url("https://bob:pw@h.io/x?api_key=k"), "https://•••@h.io/x?api_key=•••")
        self.assertEqual(rl._secrets("user=a&password=p"), "user=a&password=•••")

    def test_app_check_says_what_answers(self):
        res = self.call("POST", "/api/robot/apps/check", {"urls": [self.target + "/x", "http://127.0.0.1:9/", "ftp://x"]})[1]
        self.assertEqual([r["up"] for r in res], [True, False, False])
        self.assertEqual(res[0]["status"], 200)
        # only the app's address is asked, never the path from a value (a reset link must not be called)
        self.assertEqual(self.call("POST", "/api/robot/apps/check", {"urls": [self.target + "/missing?token=x"]})[1][0]["status"], 200)

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
        if os.name != "nt":  # Windows has no Unix file modes
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
        if os.name != "nt":  # Windows has no Unix file modes
            self.assertEqual(p.stat().st_mode & 0o777, 0o640)
        self.assertEqual(sorted(x.relative_to(self.root).as_posix() for x in self.root.rglob("*") if x.is_file()),
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


class RunDataAndReportsTest(unittest.TestCase):
    """`server.py run`: iteration data (-d), the RUN_JOB seam, the report event and the reports, without a browser."""

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.dir = Path(self.tmp.name)

    def tearDown(self):
        self.tmp.cleanup()

    def file(self, name, content):
        p = self.dir / name
        p.write_bytes(content if isinstance(content, bytes) else content.encode("utf-8"))
        return str(p)

    def refused(self, name, content, *words):
        with self.assertRaises(SystemExit) as cm:
            server.load_iteration_data(self.file(name, content))
        msg = str(cm.exception.code)
        self.assertTrue(msg.startswith("error: "), msg)
        for w in words:
            self.assertIn(w, msg)
        return msg

    @staticmethod
    def args(argv):
        return server.run_parser().parse_args(argv)

    # ---------- CSV ----------

    def test_csv_quotes_embedded_commas_newlines_and_bom(self):
        text = '﻿id,name , note\r\n1,"Smith, Jane","line one\nline two"\r\n2,"say ""hi""",\r\n\r\n'
        rows = server.load_iteration_data(self.file("rows.csv", text.encode("utf-8")))
        self.assertEqual(rows, [{"id": "1", "name": "Smith, Jane", "note": "line one\nline two"},
                                {"id": "2", "name": 'say "hi"', "note": ""}])
        self.assertEqual(list(rows[0]), ["id", "name", "note"])               # BOM gone, header names trimmed
        self.assertEqual(server.load_iteration_data(self.file("unix.csv", "a\nx\ny")), [{"a": "x"}, {"a": "y"}])  # no final newline
        self.assertEqual(server.load_iteration_data(self.file("data.txt", "a,b\n1,2\n")), [{"a": "1", "b": "2"}])  # unknown extension: CSV

    def test_csv_mistakes_are_refused_clearly(self):
        self.refused("ragged.csv", "a,b\n1,2\n3\n", "row 2", "line 3", "1 value", "2 columns")
        self.refused("long.csv", "a,b\n1,2,3\n", "row 1", "3 values")
        self.refused("empty.csv", "", "empty")
        self.refused("blank.csv", "\n\n  \n", "empty")
        self.refused("header.csv", "a,b\n", "no data rows", "header")
        self.refused("noname.csv", "a,,c\n1,2,3\n", "column 2", "no name")
        self.refused("dup.csv", "a,b,a\n1,2,3\n", '"a" twice')
        self.refused("badquote.csv", 'a,b\n"1"x,2\n', "isn't valid CSV")
        self.refused("latin1.csv", "name\nCaf\xe9\n".encode("latin-1"), "UTF-8")
        with self.assertRaises(SystemExit) as cm:
            server.load_iteration_data(str(self.dir / "nope.csv"))
        self.assertIn("not found", str(cm.exception.code))

    def test_limits_rows_and_size(self):
        old_rows, old_size = server.MAX_DATA_ROWS, server.MAX_ITERATION_FILE
        server.MAX_DATA_ROWS = 3
        try:
            self.assertEqual(len(server.load_iteration_data(self.file("ok.csv", "a\n1\n2\n3\n"))), 3)
            self.refused("many.csv", "a\n1\n2\n3\n4\n", "more than 3 rows")
            self.refused("many.json", "[{}, {}, {}, {}]", "4 rows", "limit is 3")
        finally:
            server.MAX_DATA_ROWS = old_rows
        self.assertEqual(server.MAX_DATA_ROWS, 100_000)
        self.assertEqual(server.MAX_ITERATION_FILE, 20 * 1024 * 1024)
        server.MAX_ITERATION_FILE = 10
        try:
            self.refused("big.csv", "a\n1234567890\n", "too large")
        finally:
            server.MAX_ITERATION_FILE = old_size

    # ---------- JSON ----------

    def test_json_rows_become_strings_like_postman(self):
        rows = server.load_iteration_data(self.file("rows.json", '﻿[{"id": 1, "price": 2.5, "ok": true, "none": null, "name": "Zoë"}, {"id": 2}]'))
        self.assertEqual(rows, [{"id": "1", "price": "2.5", "ok": "true", "none": "", "name": "Zoë"}, {"id": "2"}])
        self.assertEqual(server.load_iteration_data(self.file("data", ' [{"a": "x"}]')), [{"a": "x"}])  # sniffed by its "["

    def test_json_that_isnt_an_array_of_flat_objects_is_refused(self):
        self.refused("obj.json", '{"id": 1}', "array of objects")
        self.refused("scalars.json", "[1, 2]", "row 1", "isn't an object")
        self.refused("nested.json", '[{"id": 1}, {"user": {"id": 2}}]', "row 2", '"user"', "nested")
        self.refused("list.json", '[{"ids": [1, 2]}]', "row 1", "nested")
        self.refused("empty.json", "[]", "no data rows")
        self.refused("blank.json", "   ", "empty")
        self.refused("broken.json", "[{", "isn't valid JSON")

    # ---------- iterations and the RUN_JOB seam ----------

    def test_iterations_follow_the_data_and_n_caps_them(self):
        rows = [{"a": str(i)} for i in range(5)]
        self.assertEqual(server.run_iterations(None, None), 1)
        self.assertEqual(server.run_iterations(3, None), 3)
        self.assertEqual(server.run_iterations(None, rows), 5)       # data, no -n: one per row
        self.assertEqual(server.run_iterations(2, rows), 2)          # -n caps it
        self.assertEqual(server.run_iterations(9, rows), 5)          # ...but never past the rows

    def test_run_job_carries_data_and_report_options(self):
        rows = [{"id": "1"}, {"id": "2"}, {"id": "3"}]
        a = self.args(["c.json", "-d", "rows.csv", "--html", "r.html", "--report-bodies", "--folder", "Smoke", "--delay", "5", "--bail"])
        self.assertEqual(a.iteration_data, "rows.csv")
        self.assertIsNone(a.iterations)
        self.assertEqual(server.build_run_job(a, True, rows), {
            "cid": "collection.json", "envId": "env.json", "folder": "Smoke", "iterations": 3, "delay": 5, "bail": True,
            "iterationData": rows, "dataFile": "rows.csv", "report": {"html": True, "bodies": True}})
        job = server.build_run_job(self.args(["c.json", "--iteration-data", "x.json", "-n", "2"]), False, rows)
        self.assertEqual((job["envId"], job["iterations"], job["iterationData"]), ("", 2, rows[:2]))
        self.assertEqual(job["report"], {"html": False, "bodies": False})
        job = server.build_run_job(self.args(["c.json", "-n", "4", "--report-bodies"]), False, None)
        self.assertEqual((job["iterations"], job["iterationData"], job["report"]), (4, None, {"html": False, "bodies": False}))
        json.dumps(job)  # served as-is in /api/info

    def test_bad_data_fails_before_a_browser_is_looked_for(self):
        old = server.find_browser
        server.find_browser = lambda *a: self.fail("looked for a browser")
        try:
            with self.assertRaises(SystemExit) as cm:
                server.run_main(["c.json", "-d", self.file("bad.csv", "a,b\n1\n")])
            self.assertIn("row 1", str(cm.exception.code))
            with self.assertRaises(SystemExit) as cm:
                server.run_main(["c.json", "-n", "0"])
            self.assertIn("1 or more", str(cm.exception.code))
        finally:
            server.find_browser = old

    # ---------- run events, the HTML report and the reports ----------

    @staticmethod
    def result(it, row, passed=True, error=""):
        return {"iteration": it, "dataRow": row, "name": "Get order", "path": ["Orders"], "method": "GET", "url": "https://api.test/o/1",
                "status": None if error else 200, "reason": "" if error else "OK", "timeMs": None if error else 12, "size": 10,
                "error": error, "warnings": [], "logs": [], "tests": [{"name": "status is 200", "passed": passed, "error": "" if passed else "expected 500"}]}

    def queue_of(self, *events):
        q = server.queue.Queue()
        for e in events:
            q.put(e)
        return q

    def test_report_event_is_written_to_the_html_file(self):
        html = "<!doctype html><title>Run</title><p>Zoë ✓</p>"
        shown = []
        results, outcome, report = server.consume_run_events(self.queue_of(
            {"type": "result", "result": self.result(1, 1)}, {"type": "report", "html": html}, {"type": "done", "totals": {}}),
            lambda: None, shown.append)
        self.assertEqual((len(results), len(shown), outcome, report), (1, 1, {"type": "done"}, html))
        out = self.dir / "report.html"
        self.assertIsNone(server.write_html_report(report, str(out)))
        self.assertEqual(out.read_text("utf-8"), html)

    def test_no_report_means_no_file_and_a_warning(self):
        results, outcome, report = server.consume_run_events(self.queue_of({"type": "fatal", "error": "No folder named x"}), lambda: None)
        self.assertEqual((results, outcome, report), ([], {"type": "fatal", "error": "No folder named x"}, None))
        out = self.dir / "report.html"
        self.assertIn("wasn't written", server.write_html_report(report, str(out)))
        self.assertFalse(out.exists())
        old = server.MAX_REPORT
        server.MAX_REPORT = 10
        try:
            _, _, report = server.consume_run_events(self.queue_of({"type": "report", "html": "<!doctype html>" + "x" * 20}, {"type": "done"}), lambda: None)
        finally:
            server.MAX_REPORT = old
        self.assertIn("larger than", server.write_html_report(report, str(out)))
        self.assertFalse(out.exists())
        _, outcome, _ = server.consume_run_events(server.queue.Queue(), lambda: "the browser exited unexpectedly (code 1).")
        self.assertEqual(outcome, {"type": "fatal", "error": "the browser exited unexpectedly (code 1)."})

    def test_results_without_iteration_fields_still_work(self):
        r = self.result(1, None)
        del r["iteration"], r["dataRow"]
        results, _, _ = server.consume_run_events(self.queue_of({"type": "result", "result": r}, {"type": "done"}), lambda: None)
        self.assertEqual((results[0]["iteration"], results[0]["dataRow"]), (1, None))

    def test_junit_names_and_properties_carry_iteration_and_data_row(self):
        import xml.etree.ElementTree as ET
        path = self.dir / "junit.xml"
        server.junit_report([self.result(1, 1), self.result(2, 2, passed=False), self.result(3, 3, error="connection refused")],
                            "Orders API", str(path), 3, True)
        root = ET.parse(path).getroot()
        self.assertEqual((root.get("tests"), root.get("failures"), root.get("errors")), ("4", "1", "1"))
        suites = root.findall("testsuite")
        self.assertEqual([s.get("name") for s in suites], ["Orders / Get order (iteration 1, data row 1)",
                                                           "Orders / Get order (iteration 2, data row 2)",
                                                           "Orders / Get order (iteration 3, data row 3)"])
        self.assertEqual({p.get("name"): p.get("value") for p in suites[1].find("properties")}, {"iteration": "2", "dataRow": "2"})
        self.assertEqual(suites[1].find("testcase").get("name"), "status is 200 [iteration 2, data row 2]")
        self.assertIsNotNone(suites[1].find("testcase/failure"))
        self.assertEqual(suites[2].find("testcase").get("name"), "GET request [iteration 3, data row 3]")
        # one plain iteration, no data: names stay as they were
        server.junit_report([self.result(1, None)], "Orders API", str(path))
        suite = ET.parse(path).getroot().find("testsuite")
        self.assertEqual((suite.get("name"), suite.find("properties"), suite.find("testcase").get("name")),
                         ("Orders / Get order", None, "status is 200"))

    def test_skipped_request_is_reported_as_skipped(self):
        import xml.etree.ElementTree as ET
        path = self.dir / "junit-skip.xml"
        skipped = {**self.result(1, 1), "status": None, "reason": "", "timeMs": None, "tests": [], "skipped": True}
        server.junit_report([skipped], "Orders API", str(path), 1, True)
        case = ET.parse(path).getroot().find("testsuite/testcase")
        self.assertEqual(case.get("name"), "GET skipped [iteration 1, data row 1]")
        self.assertIsNotNone(case.find("skipped"))

    def test_console_label(self):
        self.assertEqual(server.iteration_label({"iteration": 1, "dataRow": None}, 1, False), "")
        self.assertEqual(server.iteration_label({"iteration": 2, "dataRow": None}, 3, False), "iteration 2")
        self.assertEqual(server.iteration_label({"iteration": 1, "dataRow": 1}, 1, True), "iteration 1, data row 1")

    # ---------- the run-event endpoint ----------

    def test_run_event_endpoint_only_during_a_run_and_with_the_token(self):
        handler = type("RunHandler", (server.Handler,), {})
        handler.stores = server.make_stores(self.tmp.name)
        srv = start(handler)
        base = f"http://127.0.0.1:{srv.server_address[1]}"

        def post(body, token=server.SESSION_TOKEN):
            req = urllib.request.Request(base + "/api/run-event", method="POST", data=json.dumps(body).encode(),
                                         headers={server.TOKEN_HEADER: token} if token else {})
            try:
                with urllib.request.urlopen(req) as r:
                    return r.status
            except urllib.error.HTTPError as e:
                with e:
                    return e.code
        old, old_max = server.RUN_EVENTS, server.MAX_REQUEST
        try:
            server.RUN_EVENTS = None
            self.assertEqual(post({"type": "report", "html": "<!doctype html>"}), 404)   # no run: no endpoint
            server.RUN_EVENTS = server.queue.Queue()
            self.assertEqual(post({"type": "report", "html": "<!doctype html>"}, token=None), 403)
            self.assertEqual(post({"type": "report", "html": "<!doctype html>"}, token="wrong"), 403)
            self.assertEqual(post(["not", "an", "event"]), 400)
            self.assertTrue(server.RUN_EVENTS.empty())
            server.MAX_REQUEST = 1024 * 1024                                             # a report may exceed a plain request's limit
            big = "<!doctype html>" + "é" * (1024 * 1024)
            self.assertEqual(post({"type": "report", "html": big}), 200)
            self.assertEqual(server.RUN_EVENTS.get_nowait()["html"], big)
        finally:
            server.MAX_REQUEST = old_max
            server.RUN_EVENTS = old
            srv.shutdown()
            srv.server_close()


class Wire(BaseHTTPRequestHandler):
    """A target API for the send() regressions: compression, redirects, cookies, and what arrived on the wire."""

    def answer(self, status=200, body=b"", headers=()):
        self.send_response(status)
        for k, v in headers:
            self.send_header(k, v)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(body)

    def handle_any(self):
        import gzip
        n = int(self.headers.get("Content-Length") or 0)
        got = self.rfile.read(n) if n else b""
        p = self.path
        echo = lambda: self.answer(200, json.dumps({"method": self.command, "path": p, "body": got.decode("utf-8", "replace"),
                                                     "auth": self.headers.get("Authorization"), "cookie": self.headers.get("Cookie"),
                                                     "ae": self.headers.get("Accept-Encoding")}).encode(), [("Content-Type", "application/json")])
        if p == "/gzip":
            return self.answer(200, gzip.compress(b'{"gz": true}'), [("Content-Encoding", "gzip")])
        if p == "/deflate":
            return self.answer(200, zlib.compress(b'{"deflate": true}'), [("Content-Encoding", "deflate")])
        if p == "/rawdeflate":
            c = zlib.compressobj(wbits=-15)
            return self.answer(200, c.compress(b'{"raw": true}') + c.flush(), [("Content-Encoding", "deflate")])
        if p == "/bomb":  # 25 MB of zeros in ~25 KB
            return self.answer(200, gzip.compress(b"0" * (25 * 1024 * 1024)), [("Content-Encoding", "gzip")])
        if p.startswith("/r307") or p.startswith("/r302"):
            return self.answer(int(p[2:5]), b"", [("Location", "/echo?after=1")])
        if p.startswith("/loop/"):
            return self.answer(302, b"", [("Location", f"/loop/{int(p[6:]) + 1}")])
        if p == "/setcookie":
            return self.answer(302, b"", [("Set-Cookie", "sid=abc; Path=/"), ("Location", "/echo")])
        if p.startswith("/to307?"):
            return self.answer(307, b"", [("Location", urllib.parse.unquote(p.split("=", 1)[1]))])
        if p.startswith("/to-other?"):
            return self.answer(302, b"", [("Location", urllib.parse.unquote(p.split("=", 1)[1]))])
        return echo()

    do_GET = do_POST = do_PUT = do_HEAD = handle_any

    def log_message(self, *a):
        pass


class SendRegressionTest(unittest.TestCase):
    """What the reviewer found in send(), kept fixed: one test per finding."""

    @classmethod
    def setUpClass(cls):
        cls.srv = start(Wire)
        cls.base = f"http://127.0.0.1:{cls.srv.server_address[1]}"
        cls.tmp = tempfile.TemporaryDirectory()

    @classmethod
    def tearDownClass(cls):
        cls.srv.shutdown()
        cls.tmp.cleanup()

    def send(self, url, method="GET", body=None, headers=(), **kw):
        return server.send({"method": method, "url": url, "body": body, "headers": [list(h) for h in headers], **kw}, self.tmp.name)

    def j(self, r):
        self.assertNotIn("error", r, r.get("error"))
        return json.loads(r["body"])

    def test_1_spaces_and_non_ascii_in_the_url_are_encoded(self):
        got = self.j(self.send(self.base + "/anything/ಕ path?q=hello world&lang=ಕನ್ನಡ&keep=%2F"))
        self.assertEqual(got["path"], "/anything/%E0%B2%95%20path?q=hello%20world&lang=%E0%B2%95%E0%B2%A8%E0%B3%8D%E0%B2%A8%E0%B2%A1&keep=%2F")
        self.assertEqual(server.encode_url("http://bücher.example/x")[0], "http://xn--bcher-kva.example/x")

    def test_2_compressed_responses_are_decoded(self):
        for path, want in (("/gzip", {"gz": True}), ("/deflate", {"deflate": True}), ("/rawdeflate", {"raw": True})):
            r = self.send(self.base + path)
            self.assertFalse(r["binary"], path)
            self.assertEqual(json.loads(r["body"]), want)
            self.assertIn(r["encoding"], ("gzip", "deflate"))
        self.assertIn("gzip", self.j(self.send(self.base + "/echo"))["ae"])        # asked for, like Postman
        bomb = self.send(self.base + "/bomb")                                     # capped while decoding
        self.assertTrue(bomb["truncated"])
        self.assertEqual(bomb["size"], server.MAX_RESPONSE)

    def test_3_redirects_keep_or_change_the_method_like_browsers(self):
        got = self.j(self.send(self.base + "/r307", "POST", '{"a":1}', [("Content-Type", "application/json")]))
        self.assertEqual((got["method"], got["body"]), ("POST", '{"a":1}'))       # 307: same method and body
        got = self.j(self.send(self.base + "/r302", "PUT", "x"))
        self.assertEqual((got["method"], got["body"]), ("GET", ""))               # 302: GET, no body
        head = self.send(self.base + "/r302", "HEAD")
        self.assertEqual(head["status"], 200)                                     # HEAD stays HEAD (no body to read)

    def test_3b_a_body_never_follows_a_307_to_another_site(self):
        other = start(Wire)
        try:
            target = urllib.parse.quote(f"http://localhost:{other.server_address[1]}/echo", safe="")
            r = self.send(self.base + "/to307?u=" + target, "POST", "password=hunter2")
            self.assertEqual(r["status"], 307)                                    # the redirect itself is the answer
            self.assertTrue(r["redirectBodyRefused"].endswith("/echo"))
        finally:
            other.shutdown()

    def test_5_user_and_password_in_the_url_become_basic_auth(self):
        got = self.j(self.send(self.base.replace("://", "://user:p%40ss@") + "/echo"))
        self.assertEqual(got["auth"], "Basic " + base64.b64encode(b"user:p@ss").decode())
        got = self.j(self.send(self.base.replace("://", "://u:p@") + "/echo", headers=[("Authorization", "Bearer t")]))
        self.assertEqual(got["auth"], "Bearer t")                                  # an explicit Authorization wins

    def test_6_cookies_are_kept_across_redirects_and_requests(self):
        server.CookieStore.delete(self.tmp.name)
        r = self.send(self.base + "/setcookie")
        self.assertEqual(self.j(r)["cookie"], "sid=abc")                          # inside the redirect chain
        self.assertEqual([c["name"] for c in r["cookies"]], ["sid"])             # pm.cookies
        self.assertEqual(self.j(self.send(self.base + "/echo"))["cookie"], "sid=abc")   # and on the next request
        self.assertIsNone(self.j(self.send(self.base + "/echo", cookies=False))["cookie"])  # the setting off: none
        self.assertTrue(os.path.exists(os.path.join(self.tmp.name, ".apiman", "cookies.txt")))
        server.CookieStore.set(self.tmp.name, {"domain": "127.0.0.1", "name": "extra", "value": "1"})
        self.assertIn("extra=1", self.j(self.send(self.base + "/echo"))["cookie"])
        server.CookieStore.delete(self.tmp.name, "127.0.0.1", "/", "sid")
        self.assertEqual([c["name"] for c in server.CookieStore.list(self.tmp.name)], ["extra"])
        server.CookieStore.delete(self.tmp.name)
        self.assertEqual(server.CookieStore.list(self.tmp.name), [])

    def test_7_too_many_redirects_are_reported(self):
        r = self.send(self.base + "/loop/0", maxRedirects=5)
        self.assertTrue(r["redirectLimitHit"])
        self.assertEqual((r["status"], r["redirectLimit"]), (302, 5))
        self.assertFalse(self.send(self.base + "/r302")["redirectLimitHit"])

    def test_11_a_line_break_in_a_header_is_explained(self):
        r = self.send(self.base + "/echo", headers=[("X-Crlf", "a\r\nX-Injected: yes")])
        self.assertEqual(r["error"], "Header 'X-Crlf' contains a line break: remove it to send the request.")
        self.assertIn("isn't valid", self.send(self.base + "/echo", headers=[("Bad Name", "1")])["error"])

    def test_13_stripped_headers_are_named_as_typed(self):
        other = start(Wire)
        try:
            target = urllib.parse.quote(f"http://localhost:{other.server_address[1]}/echo", safe="")
            r = self.send(self.base + "/to-other?u=" + target, headers=[("X-Keep", "1"), ("Authorization", "Bearer t")])
            self.assertEqual(sorted(r["redirectStripped"]), ["Authorization", "X-Keep"])
        finally:
            other.shutdown()


@unittest.skipIf(os.name == "nt", "the fake Robot is a script with a #! line")
class RunLifecycleTest(unittest.TestCase):
    """Start, a second run refused, Stop twice, cleanup, the finish race and shutdown, with a fake Robot."""

    def setUp(self):
        import sys
        self.tmp = tempfile.TemporaryDirectory()
        self.root = self.tmp.name
        os.makedirs(os.path.join(self.root, "proj"))
        with open(os.path.join(self.root, "proj", "t.robot"), "w") as f:
            f.write("*** Test Cases ***\nT\n    Log    hi\n")
        fake = os.path.join(self.root, "fake-robot")
        with open(fake, "w") as f:  # answers the version probe; a run sleeps FAKE_SLEEP seconds, then exits FAKE_EXIT
            f.write(f"#!{sys.executable}\nimport os, sys, time\n"
                    "if sys.argv[1:2] == ['-c']: print('7.0'); sys.exit(0)\n"
                    "time.sleep(float(os.environ.get('FAKE_SLEEP', '0'))); sys.exit(int(os.environ.get('FAKE_EXIT', '0')))\n")
        os.chmod(fake, 0o755)
        self.env = {k: os.environ.get(k) for k in ("APIMAN_ROBOT_PYTHON", "FAKE_SLEEP", "FAKE_EXIT")}
        os.environ["APIMAN_ROBOT_PYTHON"] = fake
        self.stores = server.make_stores(self.root)
        quiet_runs()

    def tearDown(self):
        quiet_runs()  # its run has written its last meta.json before the folder goes
        for k, v in self.env.items():
            if v is None:
                os.environ.pop(k, None)
            else:
                os.environ[k] = v
        self.tmp.cleanup()

    def start(self, sleep, code=0):
        os.environ["FAKE_SLEEP"], os.environ["FAKE_EXIT"] = str(sleep), str(code)
        return server.robot_start(self.root, self.stores, {"project": "proj", "envId": ""})

    def wait(self, run_id, timeout=15):
        out = server.robot_run_dir(self.root, run_id)
        end = time.time() + timeout
        while time.time() < end:
            meta = server.read_meta(out)
            with server.RUNS_LOCK:
                gone = run_id not in server.RUNS
            if meta["status"] != "running" and gone:
                return meta
            time.sleep(0.05)
        self.fail("the run never finished")

    def test_start_refuse_stop_twice_and_clean_up(self):
        meta = self.start(30)
        self.assertEqual(meta["status"], "running")
        with server.RUNS_LOCK:
            varfile = server.VARFILES[meta["id"]]
        self.assertTrue(os.path.exists(varfile))
        with self.assertRaises(server.RunBusy):                                   # one run at a time
            self.start(0)
        with self.assertRaises(server.RunBusy):                                   # a collection run too
            server.collection_run_start(self.root, {"project": "proj"})
        self.assertTrue(server.robot_stop(meta["id"]))
        self.assertTrue(server.robot_stop(meta["id"]))                            # Stop again: still "stopped"
        done = self.wait(meta["id"])
        self.assertEqual(done["status"], "stopped")
        self.assertFalse(os.path.exists(varfile))                                 # the secrets file is gone
        self.assertFalse(server.robot_stop(meta["id"]))                           # nothing left to stop
        self.assertEqual(len([d for d in os.listdir(os.path.join(self.root, ".apiman", "runs"))]), 1)  # the refused ones left nothing

    def test_finish_race_never_records_a_passed_run_as_interrupted(self):
        meta = self.start(0.3)
        out = server.robot_run_dir(self.root, meta["id"])
        seen = set()
        while True:  # several views polling while it finishes
            with server.RUNS_LOCK:
                gone = meta["id"] not in server.RUNS
            seen.add(server.read_meta(out)["status"])
            if gone:
                break
        final = server.read_meta(out)
        self.assertEqual(final["status"], "passed")
        self.assertNotIn("interrupted", final)
        self.assertLessEqual(seen, {"running", "passed"})

    def test_shutdown_stops_runs_and_removes_secrets(self):
        meta = self.start(30)
        with server.RUNS_LOCK:
            varfile, proc = server.VARFILES[meta["id"]], server.RUNS[meta["id"]]
        server.stop_all_runs()
        proc.wait(10)
        self.assertFalse(os.path.exists(varfile))

    def test_runs_are_pruned(self):
        runs = server.runs_dir(self.root, create=True)
        for i in range(server.KEEP_RUNS + 5):
            os.makedirs(runs / f"20200101-000000-{i:06x}")
        server.prune_runs(self.root)
        self.assertEqual(len(os.listdir(runs)), server.KEEP_RUNS)
        self.assertNotIn("20200101-000000-000000", os.listdir(runs))           # the oldest go first


if __name__ == "__main__":
    unittest.main()
