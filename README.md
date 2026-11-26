# ApiMan

A private, local API client in the spirit of Postman. You don't need an account, and nothing syncs to the cloud. It reads and writes Postman files, so you can move your collections back and forth.

- **Local mode** (`python3 server.py`): requests go out from your own computer, so they work over your VPN, reach internal hosts, and have no CORS limits. Collections are plain JSON files in a folder.
- **Website mode** (GitHub Pages): open the page and send requests straight from the browser. The API must allow cross-site requests (CORS). Data stays in your browser, or in a folder you pick (Chrome/Edge).

```bash
git clone https://github.com/MrArun005/ApiMan.git && cd ApiMan
python3 server.py                     # opens http://127.0.0.1:5577
python3 server.py --data ~/my-apis    # keep collections + environments somewhere else
python3 server.py --ca-file ~/company-root-ca.pem   # trust internal HTTPS certificates
python3 test_server.py                # server self-check
node tools/layout-check.mjs           # layout check: 508 width/sidebar/layout/text/density/divider combinations (needs Playwright)
```

You only need Python 3. There's nothing to install.

## Features

| | |
|---|---|
| **Requests** | All methods, a Params table kept in sync with the URL, Postman path variables (`/users/:id`), headers, and multiple tabs with unsaved work restored after a reload |
| **Editors** | Code editors with line numbers, syntax colours, bracket matching, search (<kbd>Cmd/Ctrl+F</kbd>) and collapsible JSON/XML, for bodies, scripts, responses and generated code (CodeMirror, bundled) |
| **Bodies** | JSON / text / XML / HTML raw, form data with file uploads, URL-encoded, binary file, GraphQL |
| **Auth** | Bearer token, Basic, API key (header or query), inherited from folder or collection, or none |
| **Variables** | Environments, collection variables, globals and dynamic values (`{{$guid}}`, `{{$timestamp}}`, …), with a live "Resolves to" preview under the URL |
| **Scripts** | Pre-request and test scripts with Postman's `pm.*` commands (`pm.test`, `pm.expect`, `pm.response`, `pm.environment`, …), plus snippets |
| **Click-to-test** | Right-click any value in a JSON response (or put the cursor on it and press the menu key or <kbd>Shift+F10</kbd>) to add a test without writing code: *equals this value*, *exists*, *is a string/number/list…*, *is not empty*, or *save it to a variable* for the next request (e.g. a login token). ApiMan writes the `pm.test` into the request's Tests script, where you can edit it |
| **Runner** | Run a collection or folder, with iterations, delay, stop on failure, and live pass/fail results |
| **Responses** | Pretty (highlighted JSON) / raw / preview views, headers, cookies, test results, script console, copy, save to file |
| **Diff** | Compare a response with the previous one, one you pinned, or **the same request sent with another environment** (staging vs prod) in one click, without switching environments. JSON is compared field by field (key order and formatting don't count; list items with an `id` are matched by it), with a line view too. Ignore noisy fields by name or path (`updatedAt, data.items[*].etag`); headers that change on every response (Date, request ids…) are skipped |
| **Import / export** | Postman collections v2.1, environments and globals, cURL commands (paste into the URL bar or use Import), export as JSON |
| **OpenAPI** | Import OpenAPI 3.x or Swagger 2.0 specs, JSON or YAML (drop, choose or paste). Each tag becomes a folder, and `{{baseUrl}}` comes from the spec's server. Requests get example bodies built from the schemas, path, query and header parameters (optional ones turned off), and auth (bearer, basic or API key, with OAuth 2 as a bearer token). Every request also gets **contract tests**: the status must be one the spec documents, and a 2xx body must have the schema's required fields. Run the collection in the Runner to check a live API against its spec |
| **Code** | cURL, HTTPie, PowerShell, JavaScript fetch, Python requests, Java HttpClient, Go net/http (secrets hidden by default) |
| **Your layout** | Drag the sidebar edge and the request/response divider (live size readout, arrow keys, double-click resets); maximise either pane; sidebar left, right or hidden (<kbd>Cmd/Ctrl+B</kbd>); side-by-side or stacked |
| **Appearance** | Light / dark / system theme, accent colour (presets or any colour), interface and code fonts, interface text size, code size, density, code line height, tab width, line wrapping: every size as a slider and an exact number |
| **Comfort** | Filter, history, keyboard shortcuts (<kbd>Ctrl/Cmd+Enter</kbd> send, <kbd>Ctrl/Cmd+S</kbd> save, <kbd>/</kbd> filter), full keyboard navigation in the sidebar tree |

## Safety

- **Scripts are sandboxed.** Imported collections can contain scripts you didn't write. In ApiMan, every script runs in a Web Worker inside a sandboxed iframe whose Content-Security-Policy is `default-src 'none'`. A script can't make network requests of its own (`pm.sendRequest` is disabled too), can't read ApiMan's storage or the page, and is stopped after 5 seconds, so an endless loop can't freeze the app.
- **Scripts can't quietly send your request elsewhere.** If a pre-request script changes which server a request goes to, ApiMan asks before sending it there with your auth. In the runner, where there's no one to ask, it blocks the request. If a script changes or deletes variables in a way that would send any saved request to a different server, you're asked before the change is saved (the check resolves every request's URL, so variable names don't matter). Every variable a script changes is listed in the Console.
- **Imported methods are validated.** HTTP methods from imported files are checked, and generated shell code quotes every value.
- **Credentials never follow a redirect to another site.** When a redirect changes the scheme, host or port, only harmless headers (Accept, Accept-Language, User-Agent, Content-Type) are kept, and the response tells you which ones were removed. HTTPS is never downgraded to HTTP.
- **Only ApiMan can use the local server.** It listens on `127.0.0.1` only, and it rejects requests from other websites (Origin check) and DNS-rebinding attempts (Host check). It serves only its own three files.
- **Secrets stay hidden on screen.** Mark environment or collection variables as Secret to mask them. Generated code hides tokens by default.
- **You're warned about plain HTTP.** If credentials go over `http://` to a non-local host, the response says so.
- **Response previews are inert.** HTML previews render with scripts and network access disabled.
- **Your collections stay off GitHub.** `collections/` is git-ignored, because collections usually hold tokens.

## Not included (yet)

Cloud and team sync, mock servers, monitors, WebSocket and gRPC, the OAuth 2.0 authorization flow, and npm libraries inside scripts (`require`).

Fonts: Geist and Geist Mono (SIL Open Font License, `fonts/OFL.txt`). Editor: CodeMirror 5 (MIT, `vendor/CODEMIRROR-LICENSE`). Both are bundled, so ApiMan never loads anything from a CDN.
