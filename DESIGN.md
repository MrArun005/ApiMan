# ApiMan UI rules

New UI is built from the parts below. If something doesn't fit, change the part (everywhere), don't add a one-off.
`node tools/ui-lint.mjs` checks the button rules; `node tools/layout-check.mjs` checks layout at every size.

## Buttons

| Where | Class | Examples |
|---|---|---|
| Toolbar actions in a `.pane-tools` row (right-aligned in a `.tool-group`) | `btn small ghost` | Find, Copy, Download, Snippets, Clear, Pin, Resend |
| Actions inside content: forms, empty states (in an `.actions` row) | `btn small` | Choose file, New collection, Get new token, Send with Prod |
| Header bar and dialog-launching commands | `btn` | New, Import, Runner, Save |
| Icon-only (always with `aria-label` and `title`) | `btn icon`, or `btn icon small` in tool rows | eye, copy, maximise |
| Primary | `btn primary` | Only dialog footers (`openDialog({ buttons: [{ primary: true }] })`) and the welcome screen's first action |

There is no `btn small primary`, and no full-width or large button inside a pane. The app's one strong action per screen is Send in the URL bar.

## Rows and sections

- **Toolbars** above pane content are a `.pane-tools` row: controls on the left, a `.tool-group` of `btn small ghost` on the right. Selects and search inputs in it take the small height automatically.
- **Section headings** inside a pane are a `.label` (with a `.hint` beside it for counts), e.g. in a `.pane-tools.diff-section` row.
- **Lists of results** (tests, diff changes) use `.test-row`: a `.pill` (Pass/Fail, Added/Changed/Removed; fixed width so names line up), then the name, then a `.msg` line.
- **Logs** (script console, WebSocket messages) use `.console .line` with a `.src` column.
- **Read-only values with one action** (callback URL, secrets) use `.secret-field` with a `btn icon` inside the field.
- **Checkboxes** are `label.check` > input + `span` (text, then a `small` explanation).

## Text

- Explanations are `.hint` (muted, small). Warnings and errors are `.note.warn` / `.note.err`.
- A hint never gets cut to a few letters: give it room or let it wrap to its own line. Long values (paths) stay on one line, cut at the start, with the full value in `title`.
- Toasts are short: what happened, and the one thing to do next if any. They wrap inside the sidebar.
- Say it once. If the UI already shows it (a label, a status), the hint doesn't repeat it.

## Values

Spacing, radii, colours and sizes come from the tokens in `:root` (`--s1`…`--s6`, `--r`, `--h-sm`, `--fs-sm`, `--ok`/`--warn`/`--err`, `--muted`…). No raw pixel radii or colours in feature CSS.
