# ApiMan design system

Every piece of UI is one of the components below, built from the tokens below. There is nothing else.

- **New need?** Use a component and its existing variants. If none fits, change the system first (this file, `tools/design-system.json`, the component's CSS section and its `ui.*` function), and then use it. Never style something on the spot.
- **Enforced.** `node tools/ui-lint.mjs` fails on any class that isn't in `tools/design-system.json`, any button / input / select / textarea created outside a component function, and any raw colour outside the tokens. `node tools/layout-check.mjs` checks every component at every size.
- **One stylesheet section per component**, in the order of this file. A region may place components (position, size, margin, order, flex), never restyle them (colour, border, type).

## 1. Tokens (`:root` in `app.css`)

| Group | Tokens |
|---|---|
| Space (4px grid) | `--s1` 4 · `--s2` 8 · `--s3` 12 · `--s4` 16 · `--s5` 20 · `--s6` 24 · edges `--gutter`, `--side-gutter` |
| Type | `--fs-xs` 12 · `--fs-sm` 13 · `--fs-md` 14 · `--fs-lg` 16 · `--fs-xl` 28 · `--fs-code` · faces `--font-ui`, `--font-code` |
| Size | controls `--h` 32 · compact `--h-sm` 26 · tab rows `--h-bar` 40 · request bar `--h-req` 44 · list rows `--row-h` 30 · icons `--icon`, `--icon-sm` · dots `--dot` |
| Radius | `--r` controls · `--r-lg` containers · `--r-xl` dialogs · `--r-pill` |
| Colour | surfaces `--bg --panel --hover --sunken` · lines `--line --line-strong --line-control` · text `--ink --ink-2 --muted` · `--focus` (accent) · `--select` · tones `--ok --warn --err --redirect` · methods `--get --post --put --patch --delete --other` · code `--j-key --j-str --j-num --j-lit` · segmented `--seg-track --seg-on --seg-on-edge` · overlays `--scrim`, `--shadow`, `--shadow-sm` |
| User knobs | `--text-scale`, `--code-size`, `--d` (density), `--code-lh` (Settings → Appearance) |

Light and dark themes redefine the colour tokens only.

## 2. Shared vocabulary

Every component uses the same words for the same thing:

| Kind | Classes | Meaning |
|---|---|---|
| Size | `.small` | the compact size (`--h-sm`, `--fs-sm`) of Button, Input, Select, StatusCode |
| Tone | `.ok` `.warn` `.err` `.muted` | success, attention, failure, quiet: Pill, Count, Note, Meta values, Log lines, Progress, Dot, inline marks |
| State | `.on` | selected / current / active: Segmented option, Tab, Tree row, Menu item, Document tab, Swatch, Dot |
| | `.off` | present but switched off (struck-out table row, hidden-but-reserved dot) |
| | `.open` | expanded (tree caret) |
| | `.busy` `.done` `.show` `.stale` `.clipped` `.menu-open` `.dragging` | in progress · just succeeded · visible (toast) · outdated content · cut by its container · its menu is open · being dragged |
| Hidden | `[hidden]`, `.ovf` | not shown · folded into a More menu |

## 3. Components

Each row: the root class, its variants (modifiers), its parts, and the `ui.*` function that builds it in `app.js`. Static markup in `index.html` uses the same classes.

| # | Component | Root & variants | Parts | Build with |
|---|---|---|---|---|
| 1 | **Button** | `.btn` · `.primary` `.ghost` `.danger` `.solid` · `.small` · `.icon` | `.lbl`, `svg` | `ui.button()`, `ui.iconButton()` |
| 2 | **Input** | `input`, `select`, `textarea` · `.small` · `.bare` (no box: inside bars, tables, pickers) · `.code` (mono) · `.num` (numbers) · `.title` (the request name) · textarea `.prose` `.short` | select chevron | `ui.input()`, `ui.select()`, `ui.textarea()` |
| 3 | **Field** | `.field` · `.narrow` `.grow` · layouts `.grid-2` (`.lead`: the first column twice as wide, e.g. the live browser beside its steps) `.grid-3` `.field-row` | `label`, control, `.hint` | `ui.field()` |
| | Field types | `.secret-field` (input + icon button) · `.slider-row` (range + number + `.unit`) · `.swatches` (colour) | `.swatch` `.custom` | `ui.secretField()` |
| 4 | **Check** | `label.check` · `.align-end` | `input[type=checkbox]`, `span`, `small` | `ui.check()` |
| 5 | **Segmented** | `.seg` · `.block` | options `.seg-btn` (radio) or `.tab` (tab), `.count`/`.dot` inside, More button `.seg-more` | `ui.seg()`, `fitTabs()` |
| 6 | **Badge** | `.pill` · tone · `.count` · tone · `.status-code` · `.s2` `.s3` `.s4` `.s5` `.err` · `.small` · `.mtag` · `.GET` `.POST` `.PUT` `.PATCH` `.DELETE` `.HEAD` `.OPTIONS` | | `ui.pill()`, `ui.count()`, `ui.status()`, `ui.method()` |
| 7 | **Dot** | `.dot` · `.ok` (live, passed) · `.warn` (unsaved) · `.err` (failed) · `.muted` · `.off` · `.dots` (a strip of results, oldest to newest) | | `ui.dot()`, `ui.dots()` |
| 8 | **Text** | `.label` · `.hint` (`.one-line`; `.path`: a long path on one line, cut at its start, the whole path in `title`) · `.note` (tone) · `code.inline` · `pre.code-block` · `kbd` · `mark` · `.pre-line` | | `ui.hint()`, `ui.note()`, `ui.kbd()` |
| 9 | **Toolbar** | `.pane-tools` · `.boxed` (find bar) · **ActionRow** `.actions` | `.tool-group` (right-aligned actions), `.spacer` | `ui.toolbar()`, `ui.actions()` |
| 10 | **SectionHead** | `.section-head` | `.label`, `.hint`, a trailing control | `ui.sectionHead()` |
| 11 | **Meta** | `.meta` | items; values in `b` (tone); hide hooks `.m-reason` `.m-time` `.m-size`; `.sending`, `.elapsed` | `ui.meta()` |
| 12 | **TreeRow** | `.row` · `.collection` · state `.on` `.menu-open` | `.caret` (`.open`), `.folder-ico`, `.name`, `.sub`, `.time`, `.acts` | `rowActs()`, tree renderers, `categoryNodes()` (data-folder categories: caret, `.folder-ico`, name, `.sub` count) |
| 13 | **ResultRow** | `.test-row` · `.compact` | Pill, name, `.msg` | `ui.result()` |
| 14 | **Log** | `.console` · `.scroll` (a live log: fixed height, scrolls) | `.line` (tone), `.src` | `ui.logLine()` |
| 15 | **Table** | `table.kv` (editable key/value) · `table.grid` (read-only) · `.boxed` | `.chk` `.type` `.act` `.file-pick` `.fname` · `.num` `.tight` `.v` `.r` `.mono` · rows `.off` `.ghost` | `kvTable()`, `ui.table()` |
| 16 | **CodeView** | `.code-editor` · `.short` `.fill` `.readonly` `.codegen` · `pre.out` · `.line-diff` · `.preview` (`.tall`: most of the window, for Robot's report and log) · `.docs-preview` | `.editor-host`, CodeMirror (`CodeMirror*`, `cm-*`), JSON marks `.j-key` `.j-str` `.j-num` `.j-lit`, diff `.n` `.sign`, rows `.del` `.ins` `.gap` | `codeEditor()`, `renderLineDiff()` |
| 17 | **EmptyState** | `.empty-state` (compact, in lists) · `.fill` (owns a pane: centred icon, title, one line) · `.drop` (drop zone) | `svg`, `strong` title, `p`, shortcuts `dl.keys`, `pre.code-block`, ActionRow | `ui.empty()`, `ui.emptyPane()` |
| 18 | **Dialog** | `dialog` · `.confirm` `.wide` `.full` (the whole window: Automation) `.drawer` `.docked` | `.dlg-shell` `.dlg-head` `.dlg-body` (`.tall`) `.dlg-foot` (`.push-left`) `.dlg-tabs` `.dlg-after` | `openDialog()`, `ask()` |
| 19 | **Menu** | `.popover` | `.mi` (`.on`, `.danger`), `.sep`, `.mi-tab` `.mi-name` `.mi-sub`, `.peek`; anchor `.ctx-anchor` | `showMenu()` |
| 20 | **Toast** | `.toast` · tone (`ok` done, `warn` needs you, `err` failed, `muted` information) · `.show` | tone icon, text | `toast(message, tone)`: a light surface like menus, bottom-right over the work area; problems stay 6 s, the rest 2.6 s |
| 21 | **Progress** | `.bar` · tone | fill `div` | `ui.progress()` |
| 22 | **DocumentTabs** | `.tabstrip` | `.rtab` (`.on`, `.clipped`), `.tname`, Dot, close = Button `.btn.icon.small.x`, `.newtab`, `.alltabs` | `renderTabs()` |
| 23 | **RequestBar** | `.reqbar` (`data-method`) | method Select, `.url-wrap` (`#url`, `.url-hl`, `.v`), `.send` (`.busy`), `.resolved` | static markup |
| 24 | **Chart** | `.chart` (bars, oldest to newest) · `.small` (a trend line inside a Card) | one `div` per bar, height = value, tone (`ok` `warn` `err` `muted`), the value in `title` | `ui.chart()` |
| 25 | **Card** | `.card` in a `.cards` grid (as many columns as fit) | `.card-head` (title, Badge, a trailing Dot), then Text, Meta, Chart `.small`, an ActionRow | `ui.card()` |

### Buttons: which one

| Where | Button |
|---|---|
| Toolbar actions, in a `.tool-group` | `ui.button({ label, variant: 'ghost', size: 'small' })` |
| Actions inside content (forms, empty states), in an `.actions` row | `ui.button({ label, size: 'small' })` |
| Header commands | `ui.button({ label })` |
| Icon only (always labelled) | `ui.iconButton(icon, label)`, `size: 'small'` in rows and tables |
| Primary | only dialog footers (`openDialog({ buttons: [{ primary: true }] })`) and the welcome screen's first action |
| Destructive | `variant: 'danger'` (dialog footers: `danger` + `solid`) |

The one strong action on a screen is the request bar's Send.

## 4. Regions (layout only)

Regions place components on the page. They own position, size, order and spacing, never colour, border or type.

`.app` · header `.top` (`.brand` `.logo-bg` `.wordmark` `.top-actions` `.top-end` `.env-picker`) · sidebar `.side` (`.side-tabs` `.side-search` `.side-body` `.side-section` `.side-foot` `.data-dir` `.dd-path`, phone `.side-open`) · `.work` · `.welcome` (`.welcome-inner` `.welcome-cols` `.shortcuts`) · `.editor` · `.titlebar` (`.crumb`) · `.split` (`.pane-col` `.req-col` `.resp-col` `.resizer` `.pane-max`) · tab rows `.tabs` · `.pane` · `.resp-body` · `.ws` (`.ws-log` `.ws-compose`) · `.drag-tip` · utilities `.sr-only` `.spacer` `.mono` `.desktop-only` `.fade-left` `.fade-right` `.skip-link`.

## 5. Writing

- Hints explain, once. Labels name. Toasts say what happened and the one next step, in one short sentence, with the tone that matches: an error is never shown as `ok`.
- A hint is never cut to a few letters: it wraps or moves to its own line. Long values (paths, URLs) stay on one line, cut at the start or end, with the whole value in `title`.
- Numbers use tabular figures; timings and sizes come from `fmtMs()` / `fmtSize()`.
