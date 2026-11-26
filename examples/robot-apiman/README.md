# Sample Robot Framework project: ApiMan tests ApiMan

A small automation project with UI tests (Browser library, Playwright) and API tests (RequestsLibrary) for ApiMan
itself. Put this folder in your ApiMan data folder and open **Automation**: ApiMan lists the suites, tests, tags and
test data, suggests the environment keys (`BASE_URL`, `HEADLESS`) and runs it live.

The tests never touch your real collections: they run against a *second* ApiMan with a throwaway data folder,
which the suites start themselves. Set two environment keys:

| Key | Example |
|---|---|
| `BASE_URL` | `http://127.0.0.1:5600` (where the ApiMan under test listens) |
| `APIMAN_SERVER` | `/path/to/ApiMan/server.py` (used to start it when nothing answers at `BASE_URL`) |
| `HEADLESS` | optional, `true` by default: the browser runs out of sight and ApiMan shows it live |

Needs, in the project's (or ApiMan's) virtualenv: `pip install robotframework robotframework-browser robotframework-requests && rfbrowser init chromium`.
