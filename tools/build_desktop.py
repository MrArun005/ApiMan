"""Builds the ApiMan desktop app with PyInstaller: dist/ApiMan.app (macOS) or dist/ApiMan/ApiMan.exe (Windows, Linux).

    python3 -m pip install pyinstaller && python3 tools/build_desktop.py

The app is server.py plus the page files. It opens in its own Chrome/Edge app window, keeps data in ~/ApiMan and
quits when the window closes. Robot Framework isn't bundled: a project's own .venv, <data>/.venv-robot or python3 runs it.
"""
import sys
from pathlib import Path

import PyInstaller.__main__

ROOT = Path(__file__).resolve().parent.parent
DATA = ["index.html", "app.js", "app.css", "oauth-callback.html", "robot_listener.py", "fonts", "vendor"]

PyInstaller.__main__.run([
    str(ROOT / "server.py"),
    "--name", "ApiMan",
    "--windowed",  # no console window; server.py sends print() nowhere when there's no stdout
    "--onedir",    # starts at once (onefile unpacks itself on every launch)
    "--noconfirm", "--clean",
    "--distpath", str(ROOT / "dist"), "--workpath", str(ROOT / "build"), "--specpath", str(ROOT / "build"),
    *[a for f in DATA for a in ("--add-data", f"{ROOT / f}{':'}{'.' if (ROOT / f).is_file() else f}")],
    *(["--osx-bundle-identifier", "dev.apiman.desktop"] if sys.platform == "darwin" else []),
])
