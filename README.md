# ApiMan

A small local Postman-style tool. It's two files, needs nothing installed beyond Python 3, and doesn't use any account or cloud service.

```bash
git clone https://github.com/MrArun005/ApiMan.git && cd ApiMan
python3 server.py                    # opens http://127.0.0.1:5577
python3 server.py --data ~/my-apis   # store collections in another folder
python3 server.py --ca-file ~/company-root-ca.pem   # trust internal HTTPS certificates
python3 test_server.py               # self-check
```

- **Works over VPN.** Requests are sent from your own machine, so they use whatever network or VPN you're connected to, including internal hosts.
- **Collections are files.** Each collection is one Postman v2.1 `.json` file in `collections/`. That folder is git-ignored because collections usually contain tokens. To try it out, import [`examples/order-service.json`](examples/order-service.json).
- **Import from Postman.** In Postman, use Export → Collection v2.1, then click **Import** here or drag the file onto the page. You can also drop `.json` files straight into the folder.
- **Bearer tokens.** Set a token on the collection (⚙), and every request inherits it unless the request overrides it or chooses "No auth". When a response contains `accessToken`/`token`, the **Use … as {{token}}** button saves it for the whole collection.
- **Variables.** `{{baseUrl}}`, `{{token}}` and so on are set per collection (⚙) and work in the URL, headers, body and token.
- **Shortcuts.** <kbd>Ctrl/Cmd+Enter</kbd> sends the request and <kbd>Ctrl/Cmd+S</kbd> saves it.

The server only listens on `127.0.0.1` and refuses requests from other websites, so no web page you visit can use it to reach your VPN.

Not supported: Postman scripts (pre-request scripts and tests), form-data/file bodies, auth types other than Bearer, and Postman environment files. Put environment values into the collection variables instead.
