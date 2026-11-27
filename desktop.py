"""ApiMan's desktop window: a native web view (WebKit on macOS, Edge WebView2 on Windows) through pywebview, so the
desktop app is a standalone app with its own window and icon, not a browser window.

Only the desktop build has pywebview; server.py imports this module when it's there and otherwise opens a browser.
The page talks to this shell through window.pywebview.api (the Bridge below) only to open more windows:
  - open_window(path): another ApiMan window on the same server (Automation), never another site
  - open_auth(url):    an OAuth provider's sign-in page; that window gets only AuthBridge.close()
"""
import threading
import urllib.parse
from pathlib import Path

import webview


class AuthBridge:
    """The only call a sign-in window (the provider's own pages) can make: close itself."""

    def __init__(self, shell):
        self._shell = shell

    def close(self):
        self._shell._close_auth()


class Bridge:
    """window.pywebview.api in ApiMan's own windows. Names starting with _ are never exposed to the page."""

    def __init__(self, base):
        self._base = base.rstrip("/")
        self._auth = []

    def open_window(self, path, title="ApiMan"):
        p = str(path or "")
        if not p.startswith("/") or p.startswith("//"):  # a path on ApiMan's own server, nothing else
            return False
        webview.create_window(str(title)[:80] or "ApiMan", self._base + p, js_api=self, width=1400, height=880, min_size=(720, 520))
        return True

    def choose_folder(self):
        """The system's folder picker; the chosen path, or "" when cancelled."""
        win = webview.active_window() or (webview.windows[0] if webview.windows else None)
        picked = win.create_file_dialog(webview.FOLDER_DIALOG) if win else None
        return str(picked[0]) if picked else ""

    def open_auth(self, url):
        u = urllib.parse.urlsplit(str(url or ""))
        if u.scheme not in ("http", "https") or not u.netloc:
            return False
        self._close_auth()  # one sign-in at a time
        self._auth.append(webview.create_window("Sign in", str(url), js_api=AuthBridge(self), width=520, height=720))
        return True

    def close_auth(self):
        self._close_auth()

    def _close_auth(self):
        for w in self._auth:
            try:
                w.destroy()
            except Exception:  # already closed by the user
                pass
        self._auth.clear()


def run(url, server, data):
    """Serves ApiMan in the background and shows it in a native window until that window closes."""
    webview.settings["ALLOW_DOWNLOADS"] = True  # Save body, Export report
    webview.settings["OPEN_EXTERNAL_LINKS_IN_BROWSER"] = True  # links to other sites open in your browser
    main = webview.create_window("ApiMan", url, js_api=Bridge(url), width=1440, height=900, min_size=(720, 520))

    def closed():  # closing the main window quits ApiMan, Automation windows included
        for w in list(webview.windows):
            if w is not main:
                try:
                    w.destroy()
                except Exception:
                    pass

    main.events.closed += closed
    if server:  # None: a second launch showing the copy that's already running
        threading.Thread(target=server.serve_forever, daemon=True).start()
    # private_mode off: localStorage persists and is shared by ApiMan's windows (sign-in results travel through it)
    webview.start(private_mode=False, storage_path=str(Path(data) / ".apiman" / "webview"))
    if server:
        server.shutdown()
