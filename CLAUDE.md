# ApiMan: working rules for Claude sessions

ApiMan is a local, private Postman-style API client: `index.html` + `app.js` + `app.css` (no build step, no dependencies), served by `server.py` (Python standard library only). Read `README.md` for features and the Safety section before changing anything security-related.

## UI: the design system is the only way to build UI

Read **`DESIGN.md`** before any UI change. Every piece of UI is one of its components, built from its tokens:

- Build controls with the `ui.*` functions in `app.js` (`ui.button`, `ui.input`, `ui.select`, `ui.field`, `ui.check`, `ui.seg`, `ui.toolbar`, `ui.emptyPane`, …). Never create a `button`, `input`, `select` or `textarea` directly in feature code.
- Use only classes listed in `tools/design-system.json`. If a need isn't covered, change the system first (DESIGN.md, the registry, the component's CSS section and its `ui.*` function), then use it. Never style something on the spot.
- CSS: one section per component in `app.css`, in DESIGN.md order; values come from the `:root` tokens; no raw colours outside token definitions; regions only place components (position, size, order, spacing), never restyle them.
- Primary buttons only in dialog footers and the welcome screen. Toasts carry a tone (`toast(msg, 'ok' | 'warn' | 'err' | 'muted')`).

## Checks: run both before calling any change done

```bash
node tools/ui-lint.mjs                       # must print: everything is built from the design system
python3 server.py --port 5599 --no-browser --data "$(mktemp -d)" &
APP=http://127.0.0.1:5599/ node tools/layout-check.mjs   # must end with: PASS: no layout failures
python3 test_server.py                       # server self-check
```

`ui-lint` checks every class, raw control and colour against the system. `layout-check` drives the real app through 544 combinations of width, sidebar, layout, text size, density, divider and panel, and fails on clipped controls, overlaps, notes or toasts spilling out of their area, and small targets. A failing check is a bug to fix, not to skip or loosen.

## Safety

Scripts in imported collections are untrusted: they run in a sandboxed worker with no network of their own. Anything that lets a script reach the network or change where a request goes must keep the guarantees described in README.md → Safety (destination checks against saved variables, asking the user, refusing in the Runner). Don't weaken them to make a feature work.

## Git

Collections in `collections/` hold tokens and are git-ignored; never commit them.
