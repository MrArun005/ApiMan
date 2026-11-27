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

## What it tests

| Suite | Tests |
|---|---|
| `tests/api/collections.robot` (API) | ApiMan's own API: collections are created, listed, read, updated and deleted; the session token is required. |
| `tests/ui/app.robot` (UI) | The welcome screen, opening a request, the method colour, the theme switch, Settings. |
| `tests/ui/workflows.robot` (UI) | ApiMan used the way a person uses it: sending GET requests and reading the JSON, headers and a 404; the Ctrl/Cmd+Enter shortcut; query parameters kept in sync with the URL; environment variables resolving in the URL; unknown and self-referencing variables explained; duplicate environment keys pointed out; passing and failing `pm.test` scripts; `console.log` in the Console; a cURL command becoming a request; generated code matching the request; saving into a collection; History; and a file dropped into the data folder showing up by itself. Its requests go to a small local web server (Python's `http.server` on `testdata/`) that the suite starts, never to the internet. |

Run one part with tags: `ui`, `api`, `smoke`, `workflows`.
