# ApiMan

A private, local API client in the spirit of Postman. You don't need an account, and nothing syncs to the cloud. It reads and writes Postman files, so you can move your collections back and forth.

- **Local mode** (`python3 server.py`): requests go out from your own computer, so they work over your VPN, reach internal hosts, and have no CORS limits. Everything is saved in the data folder (`collections/`, or `--data`).
- **Website mode** (GitHub Pages): open the page and send requests straight from the browser. The API must allow cross-site requests (CORS). In Chrome and Edge, ApiMan asks on start which folder on your computer to keep your data in (and offers to copy in what the browser already holds); you can also keep it in the browser for now. Firefox and Safari can't open folders, so data stays in the browser there.

**Where your data lives.** In the data folder, collections are `*.json`, environments are `environments/*.json`, and your workspace (settings, open tabs, history, layout) is `.apiman/state.json`. The browser only keeps a cache of it, so clearing browser storage loses nothing. OAuth tokens and kept responses are never written to the folder: they last only as long as the browser tab.

**Folders become categories.** Organise the data folder in any tree of folders (`payments/v2/Refunds.json`, `team/staging.postman_environment.json`, …): ApiMan finds every collection and environment in it, up to 8 levels deep, by what the file contains rather than its name or place, so Postman exports work as they are. Other JSON files are left alone, and so are hidden folders (`.git`, `.apiman`) and `node_modules`. The sidebar shows each folder as a category you can open and close, collections and environments save back to their own file, and a category's menu creates or imports straight into that folder. The environment picker shows a folder in front of the name (`payments / Staging`). The same works in website mode with a folder; data kept only in the browser has no folders.

```bash
git clone https://github.com/MrArun005/ApiMan.git && cd ApiMan
python3 server.py                     # opens http://127.0.0.1:5577
python3 server.py --data ~/my-apis    # keep collections + environments somewhere else
python3 server.py --ca-file ~/company-root-ca.pem   # trust internal HTTPS certificates
python3 server.py run api.json -e staging.json --junit report.xml   # run a collection headlessly (CI)
python3 test_server.py                # server self-check
node tools/layout-check.mjs           # layout check: 544 combinations of width, sidebar, layout, text, density, divider and panel (needs Playwright and ApiMan running; no other server)
node tools/ui-lint.mjs                # the design system (DESIGN.md): every class, control and colour must come from it
```

You only need Python 3. There's nothing to install.

## Run collections in CI

`python3 server.py run` runs a collection from the command line, the job Postman needs Newman (npm) for. It uses the Chrome, Chromium or Edge already on the machine in headless mode, so scripts run in the same sandbox as in the app, and there's still nothing to install.

```bash
python3 server.py run orders.json -e staging.json            # live results; exit code 1 if a test fails or a request can't be sent
python3 server.py run orders.json -e staging.json --var token=$API_TOKEN --junit report.xml --json report.json
python3 server.py run orders.json --folder Smoke -n 3 --delay 200 --bail
python3 server.py run orders.json -e staging.json -d customers.csv --html report.html   # once per data row, with an HTML report
```

- `--junit FILE` writes a JUnit XML report that GitHub Actions, GitLab and Jenkins show as test results; `--json FILE` writes the same results as JSON.
- `--html FILE` writes one self-contained HTML report (summary, then each request with its tests). It leaves out request and response headers and bodies unless you add `--report-bodies`, and even then masks Authorization, Cookie and token, secret, password and API-key headers.
- `-d`/`--iteration-data FILE` runs the collection once per row: a CSV with a header row (UTF-8, quoted values may hold commas and line breaks), or a JSON array of flat objects. Each column is a `{{column}}` variable for that iteration, and scripts read it with `pm.iterationData.get('column')`. `-n` caps the number of rows run. Up to 100 000 rows and 20 MB. The console and every report say which iteration and data row each result came from.
- `--var KEY=VALUE` sets environment variables, handy for secrets from the CI's environment. `--browser` (or `APIMAN_BROWSER`) points at a browser if it isn't found automatically.

Requests that need an OAuth sign-in window can't run headless; use client credentials there. For GitHub Actions, copy [`docs/ci/github-actions.yml`](docs/ci/github-actions.yml): it runs a collection with a secret token and a data file and keeps the JUnit and HTML reports as artifacts, even when tests fail.

## Features

| | |
|---|---|
| **Requests** | All methods, a Params table kept in sync with the URL, Postman path variables (`/users/:id`), headers, and multiple tabs with unsaved work restored after a reload |
| **Editors** | Code editors with line numbers, syntax colours, bracket matching, search (<kbd>Cmd/Ctrl+F</kbd>) and collapsible JSON/XML, for bodies, scripts, responses and generated code (CodeMirror, bundled) |
| **Bodies** | JSON / text / XML / HTML raw, form data with file uploads, URL-encoded, binary file, GraphQL |
| **Auth** | Bearer token, Basic, API key (header or query), **OAuth 2.0** (authorization code with PKCE, client credentials, password), inherited from folder or collection, or none. OAuth tokens are fetched when you send and refreshed automatically when they expire, no "Get token" click needed (authorization code opens a sign-in window once). Register `http://127.0.0.1:5577/oauth-callback.html` (or your site's `oauth-callback.html`) as the redirect URI |
| **Variables** | Environments, collection variables, globals and dynamic values (`{{$guid}}`, `{{$timestamp}}`, …), with a live "Resolves to" preview under the URL |
| **WebSocket** | Type a `ws://` or `wss://` URL and Send becomes Connect: a live, filterable message log (JSON pretty-printed, millisecond timestamps) with a composer that resolves `{{variables}}`. Uses the browser's own WebSocket, in both modes. Browsers can't send custom headers on a WebSocket, so ApiMan says which ones it couldn't send; `Sec-WebSocket-Protocol` is sent as the subprotocol |
| **Scripts** | Pre-request and test scripts with Postman's `pm.*` commands (`pm.test`, `pm.expect`, `pm.response`, `pm.environment`, `pm.sendRequest` with a callback or `await`, …), plus snippets. Test scripts see the request as it was sent, with variables resolved |
| **Click-to-test** | Right-click any value in a JSON response (or put the cursor on it and press the menu key or <kbd>Shift+F10</kbd>) to add a test without writing code: *equals this value*, *exists*, *is a string/number/list…*, *is not empty*, or *save it to a variable* for the next request (e.g. a login token). ApiMan writes the `pm.test` into the request's Tests script, where you can edit it |
| **Runner** | Run a collection or folder, with iterations, delay, stop on failure, and live pass/fail results. Values scripts set carry to the next request (`/orders/{{orderId}}` chaining works), except ones that could change which server a request goes to. **Data files**: choose a CSV (header row, one row per iteration) or a JSON list of flat objects, and each row's columns become `{{variables}}` (above the environment, below `pm.variables`) and `pm.iterationData`. Scripts can steer the run with `pm.execution.setNextRequest(name)` (`null` ends the iteration; at most 10 000 extra requests per run) and `pm.execution.skipRequest()`. After a run, **Export report** saves an HTML report (one file, no scripts), JSON or JUnit; headers and bodies only if you tick them, with Authorization, cookies, tokens, secrets, passwords and API keys masked. Also from the command line (see above) |
| **Responses** | Pretty (highlighted JSON) / raw / preview views, headers, cookies, test results, script console, copy, save to file |
| **Diff** | Compare a response with the previous one, one you pinned, or **the same request sent with another environment** (staging vs prod) in one click, without switching environments. JSON is compared field by field (key order and formatting don't count; list items with an `id` are matched by it), with a line view too. Ignore noisy fields by name or path (`updatedAt, data.items[*].etag`); headers that change on every response (Date, request ids…) are skipped |
| **Import / export** | Postman collections v2.1, environments and globals, cURL commands (paste into the URL bar or use Import), export as JSON |
| **OpenAPI** | Import OpenAPI 3.x or Swagger 2.0 specs, JSON or YAML (drop, choose or paste). Each tag becomes a folder, and `{{baseUrl}}` comes from the spec's server. Requests get example bodies built from the schemas, path, query and header parameters (optional ones turned off), and auth (bearer, basic or API key, with OAuth 2 as a bearer token). Every request also gets **contract tests**: the status must be one the spec documents, and a 2xx body must have the schema's required fields. Run the collection in the Runner to check a live API against its spec |
| **Code** | cURL, HTTPie, PowerShell, JavaScript fetch, Python requests, Java HttpClient, Go net/http (secrets hidden by default) |
| **Your layout** | Drag the sidebar edge and the request/response divider (live size readout, arrow keys, double-click resets); maximise either pane; sidebar left, right or hidden (<kbd>Cmd/Ctrl+B</kbd>); side-by-side or stacked |
| **Appearance** | Light / dark / system theme, accent colour (presets or any colour), interface and code fonts, interface text size, code size, density, code line height, tab width, line wrapping: every size as a slider and an exact number |
| **Comfort** | Filter, history, keyboard shortcuts (<kbd>Ctrl/Cmd+Enter</kbd> send, <kbd>Ctrl/Cmd+S</kbd> save, <kbd>/</kbd> filter), full keyboard navigation in the sidebar tree |

## Safety

- **Scripts are sandboxed.** Imported collections can contain scripts you didn't write. In ApiMan, every script runs in a Web Worker inside a sandboxed iframe whose Content-Security-Policy is `default-src 'none'`. A script can't make network requests of its own, can't read ApiMan's storage or the page, and is stopped after 5 seconds, so an endless loop can't freeze the app.
- **`pm.sendRequest` goes through ApiMan, under its rules.** The script only describes the request; ApiMan checks it and sends it. Without asking, a script may only call the servers its own collection uses (the request being run, or any saved request in the collection, resolved with your saved variables). For any other server, Send asks you once per server per collection until you close ApiMan, showing the full URL; the runner and `server.py run` refuse it (unless you allowed that server with Send earlier in the session) and say so in the Console. ApiMan adds nothing to the request: only the headers the script set are sent, never your auth or cookies, and redirects aren't followed. A script can make at most 10 requests per run, each gets 30 seconds, and a script that waits for them is still stopped after 60 seconds in total. Every call is listed in the Console, with a warning when it goes over plain `http://`.
- **Scripts can't quietly send your request elsewhere.** If a pre-request script changes which server a request goes to, ApiMan asks before sending it there with your auth. In the runner, where there's no one to ask, it blocks the request, and a value a script sets is only carried to the next request if it can't change any request's server: ApiMan puts a hostile test value in its place in every saved URL, under every environment, and checks that no destination moves (path and query values pass, host, port and scheme values don't). If a script changes or deletes variables in a way that would send any saved request to a different server, you're asked before the change is saved (the check resolves every request's URL, so variable names don't matter). Every variable a script changes is listed in the Console.
- **Imported methods are validated.** HTTP methods from imported files are checked, and generated shell code quotes every value.
- **Credentials never follow a redirect to another site.** When a redirect changes the scheme, host or port, only harmless headers (Accept, Accept-Language, User-Agent, Content-Type) are kept, and the response tells you which ones were removed. HTTPS is never downgraded to HTTP.
- **Only ApiMan can use the local server.** It listens on `127.0.0.1` only, and it rejects requests from other websites (Origin check) and DNS-rebinding attempts (Host check). It serves only its own files. The one page that accepts a link from another site is `oauth-callback.html`, where an OAuth provider sends you back after sign-in; it holds no data or session token and only passes the sign-in code to your ApiMan tab.
- **OAuth tokens stay out of your files.** Access and refresh tokens live only in the browser tab's session, never in collection files or exports (Postman saves them into the collection). OAuth settings are resolved from your saved variables, so a script can't point the token request, and your client secret, at another server. Token URLs must use HTTPS unless they're on this computer.
- **Secrets stay hidden on screen.** Mark environment or collection variables as Secret to mask them. Generated code hides tokens by default.
- **You're warned about plain HTTP.** If credentials go over `http://` to a non-local host, the response says so.
- **Response previews are inert.** HTML previews render with scripts and network access disabled.
- **Your collections stay off GitHub.** `collections/` is git-ignored, because collections usually hold tokens.

## Not included (yet)

Cloud and team sync, mock servers, monitors, gRPC, custom WebSocket headers, OAuth 2.0 implicit and device-code grants, and npm libraries inside scripts (`require`).

Fonts: Geist and Geist Mono (SIL Open Font License, `fonts/OFL.txt`). Editor: CodeMirror 5 (MIT, `vendor/CODEMIRROR-LICENSE`). Both are bundled, so ApiMan never loads anything from a CDN.
