"""Self-check for server.py. Run: python3 test_server.py  (stdlib only, no network beyond localhost)."""
import json
import tempfile
import threading
import unittest
import urllib.error
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import server


class Echo(BaseHTTPRequestHandler):
    """Fake target API: echoes method, auth header and body."""

    def handle_any(self):
        body = self.rfile.read(int(self.headers.get("Content-Length") or 0)).decode()
        status = 404 if self.path == "/missing" else 200
        data = json.dumps({"method": self.command, "auth": self.headers.get("Authorization"), "body": body}).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    do_GET = do_POST = do_PUT = do_DELETE = handle_any

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
        server.Handler.store = server.Store(cls.tmp.name)
        cls.app = start(server.Handler)
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
        req = urllib.request.Request(self.base + path, method=method, headers=headers or {},
                                     data=json.dumps(body).encode() if body is not None else None)
        try:
            with urllib.request.urlopen(req) as r:
                return r.status, json.loads(r.read())
        except urllib.error.HTTPError as e:
            return e.code, json.loads(e.read())

    def test_send_forwards_method_headers_body_and_reports_errors(self):
        status, res = self.call("POST", "/api/send", {
            "method": "POST", "url": self.target + "/x", "headers": [["Authorization", "Bearer abc"]], "body": '{"a":1}'})
        self.assertEqual(status, 200)
        self.assertEqual(res["status"], 200)
        echoed = json.loads(res["body"])
        self.assertEqual(echoed, {"method": "POST", "auth": "Bearer abc", "body": '{"a":1}'})

        _, res = self.call("POST", "/api/send", {"method": "GET", "url": self.target + "/missing"})
        self.assertEqual(res["status"], 404)  # 4xx is a response, not an error

        _, res = self.call("POST", "/api/send", {"method": "GET", "url": "http://127.0.0.1:1/"})
        self.assertIn("Could not connect", res["error"])

        _, res = self.call("POST", "/api/send", {"method": "GET", "url": "file:///etc/passwd"})
        self.assertIn("must start with http", res["error"])

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

        self.assertEqual(self.call("POST", "/api/collections", {"collection": {"values": []}})[0], 400)  # not a collection
        self.assertEqual(self.call("DELETE", f"/api/collections/{cid}")[0], 200)
        self.assertEqual(self.call("GET", f"/api/collections/{cid}")[0], 404)

    def test_path_traversal_is_rejected(self):
        for bad in ("..%2Fsecret.json", "%2Fetc%2Fpasswd", ".hidden.json", "x.txt"):
            self.assertEqual(self.call("GET", f"/api/collections/{bad}")[0], 400, bad)

    def test_other_websites_cannot_use_the_proxy(self):
        status, _ = self.call("POST", "/api/send", {"method": "GET", "url": self.target},
                              headers={"Origin": "https://evil.example"})
        self.assertEqual(status, 403)
        status, _ = self.call("GET", "/api/collections", headers={"Host": "attacker.example:5577"})
        self.assertEqual(status, 403)


if __name__ == "__main__":
    unittest.main()
