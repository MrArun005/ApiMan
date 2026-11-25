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
```

You only need Python 3. There's nothing to install.

## Features

| | |
|---|---|
| **Requests** | All methods, a Params table kept in sync with the URL, headers, and multiple tabs with unsaved work restored after a reload |
| **Bodies** | JSON / text / XML / HTML raw, form data with file uploads, URL-encoded, binary file, GraphQL |
| **Auth** | Bearer token, Basic, API key (header or query), inherited from folder or collection, or none |
| **Variables** | Environments, collection variables, globals and dynamic values (`{{$guid}}`, `{{$timestamp}}`, …), with a live "Resolves to" preview under the URL |
| **Scripts** | Pre-request and test scripts with Postman's `pm.*` commands (`pm.test`, `pm.expect`, `pm.response`, `pm.environment`, …), plus snippets |
| **Runner** | Run a collection or folder, with iterations, delay, stop on failure, and live pass/fail results |
| **Responses** | Pretty (highlighted JSON) / raw / preview views, headers, cookies, test results, script console, copy, save to file |
| **Import / export** | Postman collections v2.1, environments and globals, cURL commands (paste into the URL bar or use Import), export as JSON |
| **Code** | cURL, JavaScript fetch, Python requests, Java HttpClient |
| **Comfort** | Light / dark / system theme, filter, history, keyboard shortcuts (<kbd>Ctrl/Cmd+Enter</kbd> send, <kbd>Ctrl/Cmd+S</kbd> save, <kbd>/</kbd> filter) |

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
