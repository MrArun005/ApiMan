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

    def call(self, method, path, body=None, headers=None):
        req = urllib.request.Request(self.base + path, method=method, headers={server.TOKEN_HEADER: server.SESSION_TOKEN, **(headers or {})},
                                     data=json.dumps(body).encode() if body is not None else None)
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
        self.assertIn({"id": cid, "name": "My API"}, self.call("GET", "/api/collections")[1])

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

    def test_only_whitelisted_static_files_are_served(self):
        self.assertEqual(self.call("GET", "/server.py")[0], 404)
        self.assertEqual(self.call("GET", "/../server.py")[0], 404)


if __name__ == "__main__":
    unittest.main()
