"""Robot Framework listener that streams a run to ApiMan, live.

ApiMan starts Robot with:  --listener robot_listener.py;<run folder>
Every suite, test and keyword, every warning, every HTTP call made through `requests` (RequestsLibrary) and a
screenshot after each Browser-library step are appended to <run folder>/events.jsonl, one JSON object per line,
which the Automation screen reads while the run goes. Standard library only; works with Robot Framework 4-7.
"""
import json
import os
import threading
import time

ROBOT_LISTENER_API_VERSION = 2
STEP_DELAY = float(os.environ.get("APIMAN_STEP_DELAY") or 0)  # Watch speed: seconds each page-changing step stays on screen
MAX_BODY = 64 * 1024          # bytes of each request/response body kept in the log
# Browser steps that only read or wait don't change the screen: no screenshot after them (each costs ~30-80 ms)
READ_ONLY = ("get ", "wait ", "set ", "evaluate", "new browser", "new context", "close ", "take screenshot", "should",
             "register", "promise", "add ", "observe", "highlight", "connect", "switch ", "save storage", "log ")
SECRET_HEADERS = ("authorization", "cookie", "set-cookie", "proxy-authorization")
SECRET_WORDS = ("token", "secret", "password", "api-key", "apikey")


class robot_listener:
    ROBOT_LISTENER_API_VERSION = 2

    def __init__(self, out_dir):
        self.out = out_dir
        self.f = open(os.path.join(out_dir, "events.jsonl"), "a", encoding="utf-8")
        self.lock = threading.Lock()
        self.depth = 0
        self.suite = ""
        self.test = ""
        self.shots = 0
        self.browser_used = False
        self.t0 = {}
        self._patch_requests()

    # ---- writing ----
    def emit(self, **event):
        event["at"] = round(time.time(), 3)
        line = json.dumps(event, default=str, ensure_ascii=False)
        with self.lock:
            self.f.write(line + "\n")
            self.f.flush()

    # ---- suites and tests ----
    def start_suite(self, name, attrs):
        self.suite = attrs.get("longname", name)
        self.emit(t="suite_start", name=name, longname=self.suite, source=attrs.get("source", ""), tests=attrs.get("totaltests", 0))

    def end_suite(self, name, attrs):
        self.emit(t="suite_end", name=name, longname=attrs.get("longname", name), status=attrs.get("status"),
                  message=attrs.get("message", ""), ms=attrs.get("elapsedtime"), stats=attrs.get("statistics", ""))

    def start_test(self, name, attrs):
        self.test = name
        self.depth = 0
        self.emit(t="test_start", name=name, suite=self.suite, tags=attrs.get("tags", []))

    def end_test(self, name, attrs):
        shot = self._screenshot() if self.browser_used else None  # the screen as the test ended: shows failures
        self.emit(t="test_end", **({"shot": shot} if shot else {}), name=name, suite=self.suite, status=attrs.get("status"), message=attrs.get("message", ""),
                  ms=attrs.get("elapsedtime"), tags=attrs.get("tags", []))
        self.test = ""

    # ---- keywords ----
    def start_keyword(self, name, attrs):
        self.depth += 1
        self.emit(t="kw_start", name=attrs.get("kwname") or name, lib=attrs.get("libname", ""), args=[str(a) for a in attrs.get("args", [])][:8],
                  kind=attrs.get("type", ""), depth=self.depth, test=self.test)

    def end_keyword(self, name, attrs):
        lib = attrs.get("libname", "")
        if lib == "Browser":
            self.browser_used = True
        kw = (attrs.get("kwname") or name).lower()
        shot = self._screenshot() if lib == "Browser" and not kw.startswith(READ_ONLY) else None
        if shot and STEP_DELAY:
            time.sleep(STEP_DELAY)  # so a person watching ApiMan can follow what the test does
        self.emit(t="kw_end", name=attrs.get("kwname") or name, lib=lib, status=attrs.get("status"), ms=attrs.get("elapsedtime"),
                  depth=self.depth, test=self.test, **({"shot": shot} if shot else {}))
        self.depth -= 1

    def log_message(self, message):
        if message.get("level") in ("WARN", "ERROR", "FAIL") and not message.get("html") == "yes":
            self.emit(t="log", level=message.get("level"), text=str(message.get("message", ""))[:2000], test=self.test)

    def message(self, message):  # Robot's own errors (bad imports, syntax): shown too
        if message.get("level") in ("WARN", "ERROR"):
            self.emit(t="log", level=message.get("level"), text=str(message.get("message", ""))[:2000], test=self.test)

    def close(self):
        self.emit(t="close")
        self.f.close()

    # ---- the live browser view ----
    def _screenshot(self):
        try:
            from robot.libraries.BuiltIn import BuiltIn
            browser = BuiltIn().get_library_instance("Browser")
        except Exception:
            return None
        self.shots += 1
        name = f"shot-{self.shots:05d}"
        path = os.path.join(self.out, "shots", name)
        for kwargs in ({"log_screenshot": False}, {}):  # log_screenshot: Browser 16+
            try:
                saved = browser.take_screenshot(filename=path, **kwargs)
                return "shots/" + os.path.basename(str(saved))
            except TypeError:
                continue
            except Exception:
                return None  # no page open yet
        return None

    # ---- every HTTP call made with requests (RequestsLibrary and custom Python keywords) ----
    def _patch_requests(self):
        try:
            import requests
        except ImportError:
            return
        if getattr(requests.Session.send, "_apiman", False):
            return
        original = requests.Session.send
        listener = self

        def send(session, request, **kwargs):
            started = time.time()
            event = {"t": "http", "method": request.method, "url": request.url, "test": listener.test,
                     "reqHeaders": _headers(request.headers), "reqBody": _body(request.body)}
            try:
                resp = original(session, request, **kwargs)
            except Exception as e:
                listener.emit(**event, error=f"{type(e).__name__}: {e}", ms=round((time.time() - started) * 1000))
                raise
            listener.emit(**event, status=resp.status_code, reason=resp.reason, ms=round((time.time() - started) * 1000),
                          resHeaders=_headers(resp.headers), resBody=_body(resp.content), size=len(resp.content or b""))
            return resp

        send._apiman = True
        requests.Session.send = send


def _headers(headers):
    out = {}
    for k, v in (headers or {}).items():
        low = k.lower()
        out[k] = "•••" if low in SECRET_HEADERS or any(w in low for w in SECRET_WORDS) else str(v)
    return out


def _body(body):
    if body is None:
        return ""
    if isinstance(body, str):
        body = body.encode("utf-8", "replace")
    if not isinstance(body, (bytes, bytearray)):
        return f"<{type(body).__name__}>"  # a streamed upload
    text = bytes(body[:MAX_BODY]).decode("utf-8", "replace")
    return text + (f"\n… {len(body) - MAX_BODY} more bytes" if len(body) > MAX_BODY else "")
