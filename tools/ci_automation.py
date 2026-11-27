"""CI check: Robot Framework automation through ApiMan, the way the Automation window runs it, on this OS.

    python tools/ci_automation.py      (Robot Framework, Browser and RequestsLibrary installed in this Python)

Starts ApiMan (server.py) on a throwaway data folder holding the sample project (examples/robot-apiman) and its
environment, then through ApiMan's own API: runs the API tests, runs the UI tests in a headless browser, and starts a
long UI run and stops it (Stop must end Robot and its browser, and the run must be recorded as stopped). Exits 1 when
anything doesn't pass. Used by .github/workflows/desktop.yml on macOS and Windows.
"""
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import time
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PORT = 5590
BASE = f"http://127.0.0.1:{PORT}"


def main():
    data = Path(tempfile.mkdtemp(prefix="apiman-ci-"))
    shutil.copytree(ROOT / "examples" / "robot-apiman", data / "robot-apiman")
    (data / "environments").mkdir()
    (data / "environments" / "ci.json").write_text(json.dumps({"name": "CI", "values": [
        {"key": "BASE_URL", "value": "http://127.0.0.1:5600", "enabled": True},  # the ApiMan under test, started by the suites
        {"key": "APIMAN_SERVER", "value": str(ROOT / "server.py"), "enabled": True},
        {"key": "HEADLESS", "value": "true", "enabled": True}]}), "utf-8")
    env = {**os.environ, "APIMAN_ROBOT_PYTHON": sys.executable}
    srv = subprocess.Popen([sys.executable, str(ROOT / "server.py"), "--port", str(PORT), "--no-browser", "--data", str(data)], env=env)
    failures = []
    try:
        for _ in range(80):
            try:
                page = urllib.request.urlopen(BASE + "/", timeout=2).read().decode()
                break
            except OSError:
                time.sleep(0.25)
        else:
            raise SystemExit("ApiMan didn't start")
        token = re.search(r'name="apiman-token" content="([^"]+)"', page).group(1)

        def api(method, path, body=None):
            req = urllib.request.Request(BASE + path, method=method, data=json.dumps(body).encode() if body is not None else None,
                                         headers={"X-ApiMan-Token": token, "Content-Type": "application/json"})
            with urllib.request.urlopen(req, timeout=60) as r:
                return json.loads(r.read())

        def run(label, body, stop_after=None, want="passed"):
            meta = api("POST", "/api/robot/runs", {"project": "robot-apiman", "envId": "ci.json", "speed": "full", **body})
            started = time.time()
            stopped = False
            while time.time() - started < 900:
                m = api("GET", f"/api/robot/runs/{meta['id']}?from=0")["meta"]
                if stop_after and not stopped and time.time() - started > stop_after:
                    stopped = api("POST", f"/api/robot/runs/{meta['id']}/stop")["stopped"]
                if m["status"] != "running":
                    break
                time.sleep(1)
            fails = [f"{t['name']}: {t.get('message', '')}" for t in m.get("tests", []) if t.get("status") == "FAIL"]
            line = f"{label}: {m['status']} ({m.get('passed')} passed, {m.get('failed')} failed) in {time.time() - started:.1f} s"
            print(line, *[f"    FAIL {f}" for f in fails], sep="\n", flush=True)
            if m["status"] != want:
                failures.append(line)
                console = Path(data, ".apiman", "runs", meta["id"], "console.txt")
                if console.exists():
                    print(console.read_text("utf-8", "replace")[-4000:], flush=True)
            return m

        project = api("GET", "/api/robot/projects/robot-apiman")
        print(f"Project: {sum(len(s['tests']) for s in project['suites'])} tests in {len(project['suites'])} suites; "
              f"Python {project['python']}", flush=True)
        run("API tests", {"suite": ".", "include": "api"})
        run("UI tests (app)", {"suite": "tests/ui/app.robot"})
        run("UI tests (workflows)", {"suite": "tests/ui/workflows.robot"})
        run("Stop a UI run", {"suite": "tests/ui/workflows.robot"}, stop_after=5, want="stopped")
        time.sleep(3)
        left = [p for p in robot_processes() if "robot" in p.lower()]
        if left:
            failures.append(f"Robot still running after Stop: {left[:3]}")
            print("FAIL: Robot still running after Stop", left[:3], flush=True)
    finally:
        srv.terminate()
        try:
            srv.wait(10)
        except subprocess.TimeoutExpired:
            srv.kill()
    if failures:
        print("\nAutomation check FAILED:", *failures, sep="\n  ")
        sys.exit(1)
    print(f"\nAutomation check passed on {sys.platform}.")


def robot_processes():
    """Command lines of running `-m robot` processes (ApiMan's runs)."""
    try:
        if os.name == "nt":
            out = subprocess.run(["powershell", "-NoProfile", "-Command", "Get-CimInstance Win32_Process | ForEach-Object { $_.CommandLine }"],
                                 capture_output=True, text=True, timeout=60).stdout
        else:
            out = subprocess.run(["ps", "-eo", "args"], capture_output=True, text=True, timeout=20).stdout
    except (OSError, subprocess.SubprocessError):
        return []
    return [line.strip() for line in out.splitlines() if "-m robot" in line and "--listener" in line]


if __name__ == "__main__":
    main()
