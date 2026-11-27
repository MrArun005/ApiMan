'use strict';
/*
 * ApiMan: a local, private Postman-style API client.
 *
 * Two modes, same UI:
 *  - Local   (python3 server.py): requests go through the local server, so there are no CORS limits and any
 *            VPN host works; collections/environments are JSON files in the server's data folder.
 *  - Browser (e.g. GitHub Pages): requests are sent by the browser (the API must allow CORS); data lives in
 *            this browser, or in a folder you pick (Chrome/Edge).
 *
 * Collections are Postman v2.1 JSON, environments are Postman environment JSON, so files move freely
 * between ApiMan and Postman.
 */

// =====================================================================================================
// Utilities
// =====================================================================================================
const $ = (s, root = document) => root.querySelector(s);
const $$ = (s, root = document) => [...root.querySelectorAll(s)];

function h(tag, props, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'class') el.className = v;
    else if (k === 'value') el.value = v;
    else if (k === 'checked') el.checked = !!v;
    else if (v === true) el.setAttribute(k, '');
    else el.setAttribute(k, v);
  }
  for (const kid of kids.flat(Infinity)) {
    if (kid == null || kid === false) continue;
    el.append(kid instanceof Node ? kid : String(kid));
  }
  return el;
}

const SVGNS = 'http://www.w3.org/2000/svg';
const ICONS = {
  plus: '<path d="M10 4v12M4 10h12" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>',
  dots: '<circle cx="4.5" cy="10" r="1.6" fill="currentColor"/><circle cx="10" cy="10" r="1.6" fill="currentColor"/><circle cx="15.5" cy="10" r="1.6" fill="currentColor"/>',
  chevron: '<path d="M7.5 5l5 5-5 5" stroke="currentColor" stroke-width="1.8" fill="none" stroke-linecap="round" stroke-linejoin="round"/>',
  folder: '<path d="M2.5 5.5a1.5 1.5 0 0 1 1.5-1.5h3.6l1.8 2H16a1.5 1.5 0 0 1 1.5 1.5v7A1.5 1.5 0 0 1 16 16H4a1.5 1.5 0 0 1-1.5-1.5Z" fill="none" stroke="currentColor" stroke-width="1.5"/>',
  eye: '<path d="M1.5 10S4.8 4 10 4s8.5 6 8.5 6-3.3 6-8.5 6S1.5 10 1.5 10Z" fill="none" stroke="currentColor" stroke-width="1.6"/><circle cx="10" cy="10" r="2.6" fill="currentColor"/>',
  eyeOff: '<path d="M3 3l14 14M8.2 4.3A8 8 0 0 1 10 4c5.2 0 8.5 6 8.5 6a14 14 0 0 1-2.6 3.3M5.4 6.2A13.6 13.6 0 0 0 1.5 10S4.8 16 10 16a7.7 7.7 0 0 0 3.4-.8" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>',
  x: '<path d="M5 5l10 10M15 5L5 15" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>',
  compare: '<path d="M4 7h11M12 4l3 3-3 3M16 13H5M8 10l-3 3 3 3" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>',
  check: '<circle cx="10" cy="10" r="7.5" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M6.6 10.2l2.3 2.3 4.6-4.8" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/>',
  alert: '<circle cx="10" cy="10" r="7.5" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M10 6v4.6" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><circle cx="10" cy="13.6" r="1.1" fill="currentColor"/>',
  info: '<circle cx="10" cy="10" r="7.5" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M10 9v4.6" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><circle cx="10" cy="6.4" r="1.1" fill="currentColor"/>',
  trash: '<path d="M4 6h12M8 6V4h4v2M6 6l.8 10h6.4L14 6" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/>',
  play: '<path d="M6 4l10 6-10 6Z" fill="currentColor"/>',
  search: '<circle cx="8.5" cy="8.5" r="5" fill="none" stroke="currentColor" stroke-width="1.7"/><path d="M12.5 12.5L17 17" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>',
  copy: '<rect x="7" y="7" width="10" height="10" rx="1.5" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M13 7V4.5A1.5 1.5 0 0 0 11.5 3h-7A1.5 1.5 0 0 0 3 4.5v7A1.5 1.5 0 0 0 4.5 13H7" fill="none" stroke="currentColor" stroke-width="1.5"/>',
  download: '<path d="M10 3v10M5.5 8.5L10 13l4.5-4.5M4 16.5h12" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/>',
};
function icon(name) {
  const s = document.createElementNS(SVGNS, 'svg');
  s.setAttribute('viewBox', '0 0 20 20');
  s.setAttribute('aria-hidden', 'true');
  s.innerHTML = ICONS[name]; // static, trusted markup
  return s;
}

// =====================================================================================================
// UI components (DESIGN.md §3). Feature code builds every control through these: nothing else creates
// buttons, inputs, selects or textareas, and every class here is in tools/design-system.json.
// =====================================================================================================
const cx = (...c) => c.filter(Boolean).join(' ');
const TONES = ['ok', 'warn', 'err', 'muted'];
const toneOf = (t) => (TONES.includes(t) ? t : '');
const ui = {
  /** Button. variant: '' | 'primary' | 'ghost' | 'danger' | 'danger solid'; size: '' | 'small'. Other keys are attributes. */
  button({ label, icon: ic = null, variant = '', size = '', cls = '', pressed = null, onClick, ...attrs } = {}) {
    return h('button', { type: 'button', class: cx('btn', variant, size, cls), onclick: onClick, 'aria-pressed': pressed == null ? null : String(pressed), ...attrs },
      ic ? icon(ic) : null, ic && label != null ? h('span', { class: 'lbl' }, label) : label);
  },
  /** Icon-only Button: always labelled (title + aria-label). stop: the click doesn't reach the row behind it. */
  iconButton(name, label, onClick, { size = '', cls = '', stop = false, ...attrs } = {}) {
    return h('button', { type: 'button', class: cx('btn icon', size, cls), title: label, 'aria-label': label,
      onclick: (e) => { if (stop) e.stopPropagation(); if (onClick) onClick(e); }, ...attrs }, icon(name));
  },
  /** Input. size 'small'; bare (inside bars, tables, pickers); code (mono); num (numbers); asTitle (the request name). `title` is the tooltip. */
  input({ type = 'text', size = '', bare = false, code = false, num = false, asTitle = false, cls = '', onInput, ...attrs } = {}) {
    return h('input', { type, class: cx(size, bare && 'bare', code && 'code', num && 'num', asTitle && 'title', cls) || null, oninput: onInput, ...attrs });
  },
  /** Select. options: [value, label, attrs?] entries, or { group, options } for an optgroup. */
  select(options, { value = null, size = '', bare = false, cls = '', onChange, ...attrs } = {}) {
    const opt = ([v, l, a = {}]) => h('option', { value: v, ...(value != null && String(v) === String(value) ? { selected: true } : {}), ...a }, l);
    const sel = h('select', { class: cx(size, bare && 'bare', cls) || null, onchange: onChange, ...attrs },
      ...options.map((o) => (o && o.group ? h('optgroup', { label: o.group }, ...o.options.map(opt)) : opt(o))));
    if (value != null) sel.value = String(value);
    return sel;
  },
  /** Textarea. code (monospace), prose (documentation), short (three lines). */
  textarea({ code = false, prose = false, short = false, cls = '', onInput, ...attrs } = {}) {
    return h('textarea', { class: cx(code && 'code', prose && 'prose', short && 'short', cls) || null, spellcheck: code ? 'false' : null, oninput: onInput, ...attrs });
  },
  /** Field: a label above a control, an optional hint below. */
  field(label, control, { hint = null, narrow = false, grow = false, cls = '' } = {}) {
    return h('div', { class: cx('field', narrow && 'narrow', grow && 'grow', cls) }, label != null ? h('label', null, label) : null, control, hint ? ui.hint(hint) : null);
  },
  /** Colour swatches (Field type), drawn into root: options [key, colour], plus a custom colour input. */
  swatches(root, options, value, onPick, { customValue = '#2560cf', onCustom } = {}) {
    const custom = h('input', { type: 'color', value: customValue, 'aria-label': 'Custom accent colour', title: 'Custom colour', oninput: (e) => onCustom(e.target.value) });
    root.replaceChildren(...options.map(([k, colour]) => h('button', {
      type: 'button', class: cx('swatch', value === k && 'on'), role: 'radio', 'aria-checked': String(value === k), 'aria-label': k, title: k,
      style: `--sw: ${colour}`, onclick: () => onPick(k),
    })), h('label', { class: cx('swatch custom', value === 'custom' && 'on'), title: 'Custom colour' }, custom));
    return root;
  },
  /** An input with an icon button inside it (show / hide a secret, copy a value). */
  secretField(input, button) { return h('div', { class: 'secret-field' }, input, button); },
  /** Check: checkbox, label, optional explanation. The checkbox is .input. */
  check({ label, help = null, checked = false, cls = '', onChange, ...attrs } = {}) {
    const box = h('input', { type: 'checkbox', ...(checked ? { checked: true } : {}), onchange: onChange, ...attrs });
    const el = h('label', { class: cx('check', cls) }, box, h('span', null, label, help ? h('small', null, help) : null));
    el.input = box;
    return el;
  },
  /** Segmented choice (radio group). options: [key, label, attrs?] entries. */
  seg(options, value, onChange, { label = '', block = false, cls = '', into = null } = {}) {
    const root = into || h('div', { class: cx('seg', block && 'block', cls), role: 'radiogroup', 'aria-label': label || null });
    if (into) into.replaceChildren();
    for (const [k, l, a = {}] of options) {
      root.append(h('button', { type: 'button', class: cx('seg-btn', k === value && 'on'), role: 'radio', 'aria-checked': String(k === value), 'data-key': k, ...a,
        onclick: () => { $$('.seg-btn', root).forEach((b) => { const on = b.dataset.key === k; b.classList.toggle('on', on); b.setAttribute('aria-checked', String(on)); }); onChange(k); } }, l));
    }
    return root;
  },
  /** Segmented tabs (role tab) switching the panes that follow them. defs: { key, label, content }. */
  tabs(defs, onChange, { cls = '' } = {}) {
    const bar = h('div', { class: cx('seg', cls), role: 'tablist' });
    const panes = defs.map((d) => h('div', { 'data-pane': d.key, hidden: d !== defs[0] }, d.content));
    defs.forEach((d, i) => bar.append(h('button', {
      type: 'button', class: cx('seg-btn', i === 0 && 'on'), role: 'tab', 'aria-selected': String(i === 0),
      onclick: (e) => {
        $$('.seg-btn', bar).forEach((b) => { const on = b === e.currentTarget; b.classList.toggle('on', on); b.setAttribute('aria-selected', String(on)); });
        panes.forEach((p) => { p.hidden = p.dataset.pane !== d.key; if (!p.hidden) refreshEditors(p); });
        if (onChange) onChange(d.key);
      },
    }, d.label)));
    return [bar, ...panes];
  },
  pill(text, tone = '', attrs = {}) { return h('span', { class: cx('pill', toneOf(tone)), ...attrs }, text); },
  count(text, tone = '') { return h('span', { class: cx('count', toneOf(tone)) }, text); },
  /** HTTP status, coloured by class (2xx…5xx), or 'err' when there was no response. */
  status(code, { small = false, label = null, ...attrs } = {}) {
    return h('span', { class: cx('status-code', code ? `s${String(code)[0]}` : 'err', small && 'small'), ...attrs }, label ?? (code ? String(code) : 'Error'));
  },
  method(m) { return h('span', { class: `mtag ${m}` }, m); },
  /** Dot: tone 'ok' = live / answering / passed, 'warn' = unsaved / running, 'err' = failed / not answering; off keeps its place but hides it. */
  dot({ tone = '', off = false, label = null, ...attrs } = {}) {
    return h('span', { class: cx('dot', toneOf(tone), off && 'off'), role: label ? 'img' : null, 'aria-label': label, title: label, ...attrs });
  },
  /** Dots: a strip of results, oldest to newest. items: [{ tone, label }]. */
  dots(items, { label = '' } = {}) { return h('span', { class: 'dots', role: 'img', 'aria-label': label || null }, ...items.map((x) => ui.dot({ tone: x.tone, label: x.label }))); },
  hint(text, { oneLine = false, ...attrs } = {}) { return h('p', { class: cx('hint', oneLine && 'one-line'), ...attrs }, text); },
  /** A long path on one line, cut at its start (its end tells it apart); the whole path in the tooltip. */
  path(text) { return h('p', { class: 'hint path', title: text }, h('bdi', null, text)); },
  note(text, tone = '') { return h('p', { class: cx('note', toneOf(tone)) }, text); },
  kbd(text) { return h('kbd', null, text); },
  /** Toolbar: controls on the left, actions (small, ghost) right-aligned. */
  toolbar(left = [], right = [], { cls = '', ...attrs } = {}) {
    return h('div', { class: cx('pane-tools', cls), ...attrs }, ...left, right.length ? h('div', { class: 'tool-group' }, ...right) : null);
  },
  /** ActionRow: buttons inside content (forms, empty states). */
  actions(...btns) { return h('div', { class: 'actions' }, ...btns); },
  /** Section heading inside a pane: label, optional summary, optional trailing control. */
  sectionHead(label, summary = null, trailing = null) {
    return h('div', { class: 'section-head' }, h('span', { class: 'label' }, label), summary != null ? h('span', { class: 'hint' }, summary) : null, trailing);
  },
  /** Meta: a line of inline facts; values are ui.value(). */
  meta(items, attrs = {}) { return h('div', { class: 'meta', ...attrs }, ...items); },
  value(text, tone = '') { return h('b', { class: toneOf(tone) || null }, text); },
  /** Result row (tests, diff changes, runner failures): pill, name, detail. */
  result(tone, pillText, name, msg = null, { compact = false } = {}) {
    return h('div', { class: cx('test-row', compact && 'compact') }, ui.pill(pillText, tone), h('div', null, h('div', null, name), msg != null && msg !== '' ? h('div', { class: 'msg' }, msg) : null));
  },
  logLine(src, text, tone = '', srcAttrs = {}) { return h('div', { class: cx('line', toneOf(tone)) }, h('span', { class: 'src', ...srcAttrs }, src), text); },
  empty(...kids) { return h('div', { class: 'empty-state' }, ...kids); },
  /** EmptyState that owns a whole pane: centred icon, title, one line of text, optional shortcuts [[keys], label], example and actions. */
  emptyPane({ icon: ic = null, title, text = null, shortcuts = [], example = null, actions = [] }) {
    return h('div', { class: 'empty-state fill' },
      ic ? icon(ic) : null,
      h('strong', null, title),
      text ? h('p', null, text) : null,
      shortcuts.length ? h('dl', { class: 'keys' }, ...shortcuts.flatMap(([keys, label]) => [h('dt', null, ...keys.map((k) => ui.kbd(k))), h('dd', null, label)])) : null,
      example ? h('pre', { class: 'code-block' }, example) : null,
      actions.length ? ui.actions(...actions) : null);
  },
  progress(tone = '') { return h('div', { class: cx('bar', toneOf(tone)) }, h('div', { style: 'width:0%' })); },
  /** Card: one thing at a glance. head: [title, badge?, dot?]; then the body nodes; actions (buttons) last. */
  /** Card: tone = the last result (a stripe on top); ring or dot trails the head. */
  card({ title, badge = null, dot = null, ring = null, tone = '', body = [], actions = [], ...attrs }) {
    return h('section', { class: cx('card', toneOf(tone)), ...attrs }, h('div', { class: 'card-head' }, h('strong', { title }, title), badge, dot || ring), ...body,
      actions.length ? ui.actions(...actions) : null);
  },
  /** Chart: bars oldest to newest. bars: [{ value 0..1, tone, title, on }] (on: the latest). small: a run trend inside a Card. */
  chart(bars, { label = '', small = false } = {}) {
    return h('div', { class: cx('chart', small && 'small'), role: 'img', 'aria-label': label || null },
      ...bars.map((b) => h('div', { class: cx(toneOf(b.tone), b.on && 'on') || null, style: `height:${Math.max(0, Math.min(1, b.value)) * 100}%`, title: b.title || null })));
  },
  /** Ring: a share (0..1) as a circle, e.g. a pass rate; the percentage in the middle (text: false leaves it out). */
  ring(share, { tone = '', label = '', large = false, text = true } = {}) {
    const f = Math.max(0, Math.min(1, Number(share) || 0)), c = 2 * Math.PI * 15.5;
    const el = h('span', { class: cx('ring', toneOf(tone), large && 'large'), role: 'img', 'aria-label': label || `${Math.round(f * 100)}%`, title: label || null });
    el.innerHTML = `<svg viewBox="0 0 36 36" aria-hidden="true"><circle class="track" cx="18" cy="18" r="15.5"/><circle class="arc" cx="18" cy="18" r="15.5" stroke-dasharray="${(f * c).toFixed(2)} ${c.toFixed(2)}"/></svg>`;
    if (text) el.append(h('b', null, `${Math.round(f * 100)}%`));
    return el;
  },
  /** Stat: a tile with a small-caps label, a big value (tone) and one line of context; ring before it. */
  stat({ label, value, sub = '', tone = '', ring = null }) {
    return h('div', { class: 'stat' }, ring, h('div', { class: 'stat-body' }, h('span', { class: 'stat-label' }, label),
      h('span', { class: cx('stat-value', toneOf(tone)) }, String(value)), sub ? h('span', { class: 'stat-sub', title: sub }, sub) : null));
  },
  stats(...tiles) { return h('div', { class: 'stats' }, ...tiles.flat().filter(Boolean)); },
  /** Plot: an area chart of shares (0..1) oldest to newest: a smooth line over a soft fill, gridlines at 0/50/100%,
   *  a point per value (failures stand out). points: [{ value, tone, title }]; xLabels: [first, last]. */
  area(points, { label = '', tone = '', xLabels = [] } = {}) {
    const W = 720, H = 210, L = 40, Rt = 12, T = 14, B = 28, n = points.length;
    const x = (i) => L + (W - L - Rt) * (n === 1 ? 0.5 : i / (n - 1)), y = (v) => T + (H - T - B) * (1 - Math.max(0, Math.min(1, v)));
    const pts = points.map((p, i) => [x(i), y(p.value)]);
    const d = smoothPath(pts, T, H - B), gid = `pg${uid().replace(/\W/g, '').slice(0, 10)}`;
    const grid = [0, 0.5, 1].map((v) => `<line class="gridline" x1="${L}" x2="${W - Rt}" y1="${y(v)}" y2="${y(v)}"/><text class="axis" x="${L - 10}" y="${y(v) + 4}" text-anchor="end" font-size="11">${Math.round(v * 100)}%</text>`).join('');
    const xs = xLabels.length ? `<text class="axis" x="${L}" y="${H - 8}" font-size="11">${xmlText(xLabels[0])}</text><text class="axis" x="${W - Rt}" y="${H - 8}" text-anchor="end" font-size="11">${xmlText(xLabels[xLabels.length - 1])}</text>` : '';
    const fill = n ? `<path class="fill" d="${d} L ${pts[n - 1][0]} ${y(0)} L ${pts[0][0]} ${y(0)} Z" fill="url(#${gid})"/>` : '';
    const dots = points.map((p, i) => `<circle class="pt ${toneOf(p.tone) || ''}" cx="${pts[i][0]}" cy="${pts[i][1]}" r="${p.tone === 'err' || p.tone === 'warn' ? 4.5 : 3.2}"><title>${xmlText(p.title || '')}</title></circle>`).join('');
    const el = h('div', { role: 'img', 'aria-label': label || null });
    el.innerHTML = `<svg class="plot ${toneOf(tone) || ''}" viewBox="0 0 ${W} ${H}"><defs><linearGradient id="${gid}" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="currentColor" stop-opacity=".34"/><stop offset="1" stop-color="currentColor" stop-opacity="0"/></linearGradient></defs>${grid}${xs}${fill}<path class="line" d="${d}"/>${dots}</svg>`;
    return el;
  },
  /** Plot .spark: a small area trend for a table row; failures marked, the latest dotted. */
  spark(points, { label = '', tone = '' } = {}) {
    const W = 132, H = 34, P = 4, n = points.length;
    const x = (i) => P + (W - 2 * P) * (n === 1 ? 0.5 : i / (n - 1)), y = (v) => P + (H - 2 * P) * (1 - Math.max(0, Math.min(1, v)));
    const pts = points.map((p, i) => [x(i), y(p.value)]);
    const d = smoothPath(pts, P, H - P), gid = `ps${uid().replace(/\W/g, '').slice(0, 10)}`;
    const marks = points.map((p, i) => (p.tone === 'err' || p.tone === 'warn' || i === n - 1 ? `<circle class="pt ${toneOf(p.tone) || ''}" cx="${pts[i][0]}" cy="${pts[i][1]}" r="2.6"><title>${xmlText(p.title || '')}</title></circle>` : '')).join('');
    const el = h('span', { role: 'img', 'aria-label': label || null, title: label || null });
    el.innerHTML = `<svg class="plot spark ${toneOf(tone) || ''}" viewBox="0 0 ${W} ${H}"><defs><linearGradient id="${gid}" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="currentColor" stop-opacity=".28"/><stop offset="1" stop-color="currentColor" stop-opacity="0"/></linearGradient></defs>${n ? `<path class="fill" d="${d} L ${pts[n - 1][0]} ${H - P} L ${pts[0][0]} ${H - P} Z" fill="url(#${gid})"/>` : ''}<path class="line" d="${d}"/>${marks}</svg>`;
    return el;
  },
  /** Donut: shares of a whole. segs: [{ value, tone, label }]; center: the big text, caption under it. Returns [donut, legend]. */
  donut(segs, { center = '', caption = '', label = '' } = {}) {
    const total = segs.reduce((a, s) => a + (s.value || 0), 0), c = 2 * Math.PI * 15.5;
    let at = 0;
    const arcs = segs.filter((s) => s.value > 0).map((s) => {
      const len = (s.value / total) * c, gap = segs.filter((q) => q.value > 0).length > 1 ? 0.8 : 0;
      const arc = `<circle class="seg ${toneOf(s.tone) || ''}" cx="18" cy="18" r="15.5" stroke-dasharray="${Math.max(0, len - gap).toFixed(2)} ${(c - len + gap).toFixed(2)}" stroke-dashoffset="${(-at).toFixed(2)}"/>`;
      at += len;
      return arc;
    }).join('');
    const el = h('span', { class: 'donut', role: 'img', 'aria-label': label || null });
    el.innerHTML = `<svg viewBox="0 0 36 36" aria-hidden="true">${total ? arcs : '<circle class="seg" cx="18" cy="18" r="15.5"/>'}</svg>`;
    el.append(h('b', null, center, caption ? h('small', null, caption) : null));
    const legend = h('div', { class: 'legend' }, ...segs.map((s) => h('div', { class: 'legend-item' }, ui.dot({ tone: s.tone }), s.label, h('b', null, String(s.value)))));
    return [el, legend];
  },
  /** Panel: a titled box for a chart. */
  panel({ title, sub = '', body = [] }) {
    return h('section', { class: 'panel' }, h('div', { class: 'panel-head' }, h('strong', null, title), sub ? h('span', null, sub) : null), h('div', { class: 'panel-body' }, ...[body].flat().filter(Boolean)));
  },
  panels(...p) { return h('div', { class: 'panels' }, ...p.flat().filter(Boolean)); },
};

/** Text for inside SVG markup built as a string. */
const xmlText = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
/** A smooth line through points (Catmull-Rom as cubic Béziers), its bends kept between top and bottom. */
function smoothPath(p, top, bottom) {
  if (!p.length) return '';
  if (p.length < 3) return p.map((q, i) => `${i ? 'L' : 'M'} ${q[0].toFixed(1)} ${q[1].toFixed(1)}`).join(' ');
  const cy = (v) => Math.max(top, Math.min(bottom, v));
  let d = `M ${p[0][0].toFixed(1)} ${p[0][1].toFixed(1)}`;
  for (let i = 0; i < p.length - 1; i++) {
    const p0 = p[i - 1] || p[i], p1 = p[i], p2 = p[i + 1], p3 = p[i + 2] || p2;
    d += ` C ${(p1[0] + (p2[0] - p0[0]) / 6).toFixed(1)} ${cy(p1[1] + (p2[1] - p0[1]) / 6).toFixed(1)} ${(p2[0] - (p3[0] - p1[0]) / 6).toFixed(1)} ${cy(p2[1] - (p3[1] - p1[1]) / 6).toFixed(1)} ${p2[0].toFixed(1)} ${p2[1].toFixed(1)}`;
  }
  return d;
}
const uid = () => (crypto.randomUUID ? crypto.randomUUID()
  : 'id-' + Math.random().toString(36).slice(2) + Date.now().toString(36));

/** Toast (DESIGN.md §3): a short message with its tone. ok = done, warn = needs you, err = failed, muted = for information. */
function toast(msg, tone = 'ok') {
  const t = $('#toast');
  const tn = ['ok', 'warn', 'err', 'muted'].includes(tone) ? tone : 'ok';
  t.className = `toast ${tn}`;
  t.replaceChildren(icon({ ok: 'check', warn: 'alert', err: 'alert', muted: 'info' }[tn]), h('span', null, msg));
  t.setAttribute('role', tn === 'err' ? 'alert' : 'status');
  requestAnimationFrame(() => t.classList.add('show'));
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => t.classList.remove('show'), tn === 'err' || tn === 'warn' ? 6000 : 2600); // problems stay long enough to read
}

const ls = {
  get(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) {
    try { localStorage.setItem(k, JSON.stringify(v)); } catch { return false; }
    if (STATE_KEYS.includes(k.slice(7)) && k.startsWith('apiman:')) workspace.schedule(); // the data folder keeps a copy
    return true;
  },
};

// Workspace state (settings, open tabs, history, layout…) lives in the data folder, in .apiman/state.json:
// localStorage is only its synchronous cache. OAuth tokens and kept responses stay session-only, never in the folder.
const STATE_KEYS = ['settings', 'activeEnv', 'open', 'history', 'tabs', 'diffIgnore', 'layout', 'codeLang', 'sizeUnit'];
const workspace = {
  ready: false, // false until the folder's state has been read: nothing is written to it before that
  dirty: false, timer: 0, queue: Promise.resolve(), warned: false,
  snapshot() {
    const snap = {};
    for (const k of STATE_KEYS) {
      try { const v = localStorage.getItem(`apiman:${k}`); if (v !== null) snap[k] = JSON.parse(v); } catch { /* skip */ }
    }
    return snap;
  },
  schedule() {
    this.dirty = true;
    if (!this.ready) return;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.flush(), 500);
  },
  /** Saves the whole snapshot now (if anything changed). Saves run one after another, so the last one wins. */
  flush(opts = {}) {
    clearTimeout(this.timer);
    if (!this.ready || !this.dirty || !backend || !backend.state) return this.queue;
    this.dirty = false;
    const store = backend.state, snap = this.snapshot();
    this.queue = this.queue.then(() => store.put(snap, opts)).catch((e) => {
      this.dirty = true;
      if (!this.warned) { this.warned = true; toast(`Couldn't save your workspace to the data folder: ${e.message}`, 'err'); }
    });
    return this.queue;
  },
  /** Reads the data folder's state. Present: it wins (copied into localStorage, then re-applied).
   *  Absent: this browser's state is written there (first run). Returns true when the folder had none yet. */
  async load() {
    this.ready = false;
    clearTimeout(this.timer);
    if (!backend.state) { this.ready = true; return false; } // data kept in this browser: nothing to sync
    let saved;
    try { saved = await backend.state.get(); } catch (e) {
      toast(`Couldn't read your workspace from the data folder, so it won't be saved there: ${e.message}`, 'err');
      return false; // stays not ready: never overwrite a file we couldn't read
    }
    if (saved && typeof saved === 'object' && !Array.isArray(saved)) {
      for (const k of STATE_KEYS) {
        try {
          if (saved[k] !== undefined) localStorage.setItem(`apiman:${k}`, JSON.stringify(saved[k]));
          else localStorage.removeItem(`apiman:${k}`);
        } catch { /* storage blocked: the in-memory state below still uses it */ }
      }
      rehydrate();
      this.dirty = false;
      this.ready = true;
      return false;
    }
    this.ready = true;
    this.dirty = true;
    await this.flush();
    return true;
  },
};

/** Re-reads everything start-up took from localStorage (after the data folder's state replaced it). */
function rehydrate() {
  state.settings = { ...DEFAULT_SETTINGS, ...ls.get('apiman:settings', {}) };
  if (backend && backend.mode !== 'local') state.settings.insecure = false;
  state.activeEnv = String(ls.get('apiman:activeEnv', '') || '');
  const open = ls.get('apiman:open', []);
  state.open = new Set(Array.isArray(open) ? open : []);
  const hist = ls.get('apiman:history', []);
  state.history = Array.isArray(hist) ? hist : [];
  state.diffIgnore = String(ls.get('apiman:diffIgnore', '') ?? '');
  if (initResizers.load) initResizers.load();
  applyTheme(); // and the rest of Appearance
}

function download(filename, data, type = 'application/json') {
  const blob = data instanceof Blob ? data : new Blob([data], { type });
  const a = h('a', { href: URL.createObjectURL(blob), download: filename });
  document.body.append(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
}

function fmtSize(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1048576) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1048576).toFixed(1)} MB`;
}
function fmtMs(ms) { return ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(2)} s`; }
function timeAgo(t) {
  const s = Math.round((Date.now() - t) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return new Date(t).toLocaleDateString();
}
function debounce(fn, ms) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; }

function bufToB64(buf) {
  const bytes = new Uint8Array(buf);
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
function b64ToBytes(b64) {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}
const utf8b64 = (s) => bufToB64(new TextEncoder().encode(s));

const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'];
const IS_MAC = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
const MOD = IS_MAC ? '⌘' : 'Ctrl';
const SCHEMA_V21 = 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json';
const isLocalHost = (host) => ['localhost', '127.0.0.1', '[::1]'].includes(host);

// =====================================================================================================
// Settings & state
// =====================================================================================================
const DEFAULT_SETTINGS = {
  theme: 'system', timeout: 60, followRedirects: true, maxRedirects: 10, cookies: true, history: true, insecure: false,
  textScale: 1, codeSize: 13, density: 'comfortable', layout: 'auto', wrap: true,
  densityScale: null, lineHeight: 1.6, tabSize: 2, tabStyle: 'subtle', sendStyle: 'method', uiFont: 'geist', codeFont: 'geist-mono', accent: 'blue', accentCustom: '#2560cf',
  sidePosition: 'left', sideHidden: false,
};
const DENSITY = { compact: 0.875, comfortable: 1, spacious: 1.125 };
const UI_FONTS = {
  geist: ['Geist', '"Geist", system-ui, sans-serif'],
  system: ['System', 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif'],
  humanist: ['Humanist', '"Avenir Next", "Segoe UI Variable Text", "Segoe UI", Ubuntu, sans-serif'],
};
const CODE_FONTS = {
  'geist-mono': ['Geist Mono', '"Geist Mono", ui-monospace, monospace'],
  system: ['System mono', 'ui-monospace, "SF Mono", "Cascadia Code", Consolas, monospace'],
  menlo: ['Menlo / Monaco', 'Menlo, Monaco, "DejaVu Sans Mono", monospace'],
};
// [light, dark] pairs chosen for AA contrast on each theme's panels
const ACCENTS = { blue: ['#2560cf', '#6b9cff'], violet: ['#6d44c9', '#b08cff'], teal: ['#0f766e', '#2dd4bf'], orange: ['#b4540a', '#f59e42'], pink: ['#be185d', '#f472b6'] };
const clampNum = (v, lo, hi, d) => { const n = Number(v); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d; };

/** Text size, code size, density, layout and line wrapping: all CSS custom properties, so they apply instantly. */
function applyAppearance(s = state.settings) {
  const root = document.documentElement;
  root.style.setProperty('--text-scale', String(clampNum(s.textScale, 0.8, 1.5, 1)));
  root.style.setProperty('--code-size', `${clampNum(s.codeSize, 10, 24, 13)}px`);
  root.style.setProperty('--d', String(clampNum(s.densityScale ?? DENSITY[s.density] ?? 1, 0.75, 1.4, 1)));
  root.dataset.sendStyle = s.sendStyle === 'accent' ? 'accent' : 'method';
  root.style.setProperty('--code-lh', String(clampNum(s.lineHeight, 1.3, 1.9, 1.6)));
  root.style.setProperty('--font-ui', (UI_FONTS[s.uiFont] || UI_FONTS.geist)[1]);
  root.style.setProperty('--font-code', (CODE_FONTS[s.codeFont] || CODE_FONTS['geist-mono'])[1]);
  const dark = effectiveTheme(s) === 'dark';
  const accent = s.accent === 'custom' && /^#[0-9a-f]{6}$/i.test(s.accentCustom || '') ? s.accentCustom : (ACCENTS[s.accent] || ACCENTS.blue)[dark ? 1 : 0];
  root.style.setProperty('--focus', accent);
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(accent.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  root.style.setProperty('--on-accent', 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.18 ? '#0d1520' : '#ffffff'); // readable text on the accent
  root.dataset.tabStyle = s.tabStyle === 'accent' ? 'accent' : 'subtle';
  root.dataset.side = s.sidePosition === 'right' ? 'right' : 'left';
  root.dataset.sideHidden = String(!!s.sideHidden);
  const tab = Number(s.tabSize) || 2;
  document.querySelectorAll('.CodeMirror').forEach((el) => {
    const cm = el.CodeMirror;
    if (!cm) return;
    cm.setOption('tabSize', tab);
    cm.setOption('indentUnit', tab);
    if (el.closest('.code-editor.fill, #bodyEditor')) cm.setOption('lineWrapping', s.wrap !== false);
  });
  document.querySelectorAll('.CodeMirror').forEach((el) => el.CodeMirror && el.CodeMirror.refresh());
  root.dataset.layout = s.layout === 'stacked' ? 'stacked' : 'auto';
  root.dataset.wrap = s.wrap === false ? 'off' : 'on';
  if (initResizers.autoStack) initResizers.autoStack();
  if (initResizers.refresh) initResizers.refresh();
  if (typeof updateDock === 'function') requestAnimationFrame(updateDock); // text size changes the drawer's width
  if (initResizers.showSide) initResizers.showSide(); // re-derive from your stored width; the text-size minimum is applied, never saved
  if (!isPhone()) { $('#btnSide')?.setAttribute('aria-expanded', String(!s.sideHidden)); $('#btnSide')?.setAttribute('aria-label', s.sideHidden ? 'Show sidebar' : 'Hide sidebar'); }
}

const state = {
  settings: { ...DEFAULT_SETTINGS, ...ls.get('apiman:settings', {}) },
  colList: [], cols: {},          // collection summaries + loaded docs
  envList: [], envs: {},          // environment summaries + loaded docs (globals.json is the globals doc)
  activeEnv: ls.get('apiman:activeEnv', ''),
  tabs: [], active: -1,
  open: new Set(ls.get('apiman:open', [])),
  view: 'collections',
  filter: '',
  history: ls.get('apiman:history', []),
  diffIgnore: ls.get('apiman:diffIgnore', ''), // Diff: fields to ignore, kept across requests
};
const GLOBALS_ID = 'globals.json';

function saveSettings() { ls.set('apiman:settings', state.settings); }
function saveOpen() { ls.set('apiman:open', [...state.open]); }

function applyTheme() {
  const t = state.settings.theme;
  if (t === 'light' || t === 'dark') document.documentElement.dataset.theme = t;
  else delete document.documentElement.dataset.theme;
  if (typeof applyAppearance === 'function' && document.body) applyAppearance(); // accent colour depends on the theme
}
function effectiveTheme(s = state.settings) {
  const t = s.theme;
  if (t === 'light' || t === 'dark') return t;
  return matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

// =====================================================================================================
// Storage backends
// =====================================================================================================
const KINDS = {
  collections: {
    validate(d) {
      if (!(d && typeof d === 'object' && d.info && typeof d.info.name === 'string' && Array.isArray(d.item))) {
        throw new Error('Not a Postman v2 collection (needs info.name and item[]). In Postman: Export, then Collection v2.1.');
      }
    },
    nameOf: (d) => d.info.name,
  },
  environments: {
    validate(d) {
      if (!(d && typeof d === 'object' && typeof d.name === 'string' && Array.isArray(d.values))) {
        throw new Error('Not a Postman environment (needs name and values[]).');
      }
    },
    nameOf: (d) => d.name,
  },
};

function newDocId(name, exists) {
  let base = String(name).replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^[-._]+|[-.]+$/g, '').slice(0, 80) || 'untitled';
  if (base.toLowerCase() === 'globals') base = 'globals-env'; // globals.json is the Globals document
  let id = `${base}.json`;
  for (let n = 2; exists(id.toLowerCase()); n++) id = `${base}-${n}.json`; // file systems on macOS/Windows ignore case
  return id;
}

const API_TOKEN = (() => { const m = document.querySelector('meta[name="apiman-token"]'); const v = m && m.content; return v && v !== '__APIMAN_TOKEN__' ? v : ''; })();
const lastPutAt = new Map(); // path -> time the last successful write finished
async function api(method, path, body, signal, headers = {}, retried = false) {
  if (method !== 'GET') lastWriteAt = Date.now();
  const started = performance.now();
  const r = await fetch(path, {
    method,
    signal,
    headers: { ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(API_TOKEN ? { 'X-ApiMan-Token': API_TOKEN } : {}), ...headers },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(data.error || r.statusText), { status: r.status, conflict: r.status === 409 });
  if (method === 'PUT') lastPutAt.set(path, performance.now());
  // A GET that raced a later save of ours may carry the old body: fetch again rather than use stale data.
  if (method === 'GET' && !retried && (lastPutAt.get(path) || 0) > started) return api(method, path, body, signal, headers, true);
  if (api.onVersion && r.headers.get('X-Version')) api.onVersion(path, r.headers.get('X-Version'));
  return data;
}

const versions = new Map(); // document path -> version the server last told us about
api.onVersion = (path, v) => versions.set(path, v);
function serverStore(kind) {
  const base = `/api/${kind}`;
  return {
    list: () => api('GET', base),
    get: (id) => api('GET', `${base}/${encodeURIComponent(id)}`),
    // If-Match: refuse to overwrite a file another window changed since we loaded it
    put: (id, d) => { const p = `${base}/${encodeURIComponent(id)}`; return api('PUT', p, d, undefined, versions.has(p) ? { 'If-Match': versions.get(p) } : {}); },
    create: async (d, folder = '') => (await api('POST', base, { document: d, ...(folder ? { folder } : {}) })).id,
    remove: (id) => api('DELETE', `${base}/${encodeURIComponent(id)}`),
  };
}

function browserStore(kind) {
  const key = `apiman:${kind}`;
  const seen = new Map(); // id -> JSON we last read or wrote (another tab's save changes it)
  const { validate, nameOf } = KINDS[kind];
  const read = () => ls.get(key, {});
  const write = (all) => {
    if (!ls.set(key, all)) throw new Error('Browser storage is full or blocked. Use a folder (Chrome/Edge) or run ApiMan locally.');
  };
  return {
    async list() { return Object.entries(read()).map(([id, d]) => ({ id, name: nameOf(d), folder: '' })).sort((a, b) => a.name.localeCompare(b.name)); }, // flat: no folders here
    async get(id) { const d = read()[id]; if (!d) throw new Error('Not found'); seen.set(id, JSON.stringify(d)); return d; },
    async put(id, d) {
      validate(d);
      const all = read();
      if (all[id] && seen.has(id) && JSON.stringify(all[id]) !== seen.get(id)) {
        throw Object.assign(new Error('This document was changed in another tab.'), { status: 409, conflict: true });
      }
      all[id] = d; write(all); seen.set(id, JSON.stringify(d));
    },
    async create(d) { validate(d); const all = read(); const id = newDocId(nameOf(d), (x) => Object.keys(all).some((k) => k.toLowerCase() === x)); all[id] = d; write(all); return id; },
    async remove(id) { const all = read(); delete all[id]; write(all); },
  };
}

// Data-folder discovery (contract: nested folders). The same rules as server.py: walk the folder, skip dot folders and
// node_modules, at most 8 folder levels, 5000 .json files, 20 MB a file; a file is a collection or an environment by
// its content, never by its name or place (Postman's X.postman_collection.json exports just work).
// Names as server.py accepts them: a letter or digit first (any script), then letters, digits, marks and _ .()+,&@'!#[]~-
// ("Équipe (2024)/Orders (v2).json", "R&D + QA [old].json").
const DOC_FILE_RE = /^[\p{L}\p{N}][\p{L}\p{N}\p{M}_ .()+,&@'!#[\]~-]{0,120}\.json$/u;
const DIR_SEG_RE = /^[\p{L}\p{N}][\p{L}\p{N}\p{M}_ .()+,&@'!#[\]~-]{0,120}$/u;
const SCAN = { depth: 8, files: 5000, bytes: 20 * 1024 * 1024 };
function classifyDoc(d) {
  if (!d || typeof d !== 'object' || Array.isArray(d)) return null;
  if (d.info && typeof d.info === 'object' && !Array.isArray(d.info) && Array.isArray(d.item)) return 'collections';
  if (Array.isArray(d.values) && !('item' in d)) return 'environments';
  return null;
}
/** "payments/v2/Refunds.json" -> "payments/v2"; an environment's bare id ("Staging.json") or "./Local.json" -> "". */
function folderOfId(id) { const s = String(id).replace(/^\.\//, ''); const i = s.lastIndexOf('/'); return i === -1 ? '' : s.slice(0, i); }
const entryFolder = (e) => (typeof e.folder === 'string' ? e.folder : folderOfId(e.id));
/** A folder path ("" or "a/b"): every segment a valid file-system name, at most 8 levels. Returns its segments. */
function cleanFolder(folder) {
  const segs = String(folder || '').split('/').filter(Boolean);
  if (segs.length > SCAN.depth || segs.some((s) => !DIR_SEG_RE.test(s))) throw new Error(`Not a usable folder: ${folder}`);
  return segs;
}
const folderScans = new WeakMap(); // root handle -> Map(path -> { modified, size, kind, name }): files are parsed again only when they change
async function scanFolder(rootDir) {
  if (!folderScans.has(rootDir)) folderScans.set(rootDir, new Map());
  const cache = folderScans.get(rootDir);
  const found = [];
  let files = 0;
  const walk = async (dir, segs) => {
    const entries = [];
    for await (const [name, handle] of dir.entries()) entries.push([name, handle]);
    entries.sort((a, b) => a[0].localeCompare(b[0]));
    for (const [name, handle] of entries) {
      if (files >= SCAN.files) return;
      if (handle.kind === 'directory') {
        if (name.startsWith('.') || name === 'node_modules' || !DIR_SEG_RE.test(name) || segs.length >= SCAN.depth) continue;
        await walk(handle, [...segs, name]);
      } else if (DOC_FILE_RE.test(name)) {
        files++;
        const path = [...segs, name].join('/');
        try {
          const f = await handle.getFile();
          if (f.size > SCAN.bytes) continue;
          let hit = cache.get(path);
          if (!hit || hit.modified !== f.lastModified || hit.size !== f.size) {
            let kind = null, label = '';
            try {
              const d = JSON.parse(await f.text());
              kind = classifyDoc(d);
              const n = kind === 'collections' ? d.info.name : kind === 'environments' ? d.name : '';
              label = typeof n === 'string' && n.trim() ? n : name.replace(/\.json$/, '');
            } catch { /* not JSON: not ours */ }
            hit = { modified: f.lastModified, size: f.size, kind, name: label };
            cache.set(path, hit);
          }
          if (hit.kind) found.push({ segs, file: name, kind: hit.kind, name: hit.name });
        } catch { /* unreadable: skipped */ }
      }
    }
  };
  await walk(rootDir, []);
  return found;
}

/** Website mode with a folder: the same ids as server.py (collections: path in the folder; environments: a bare name
 *  directly in environments/, otherwise the path, "./" in front when it has no "/"). */
function folderStore(rootDir, kind) {
  const { validate, nameOf } = KINDS[kind];
  const envs = kind === 'environments';
  const idOf = (segs, file) => (envs && segs.length === 1 && segs[0] === 'environments' ? file
    : segs.length ? [...segs, file].join('/') : envs ? `./${file}` : file);
  const where = (id) => { // id -> [folder segments, file name]
    const s = String(id);
    const parts = envs && !s.includes('/') ? ['environments', s] : s.replace(/^\.\//, '').split('/');
    const file = parts.pop();
    if (!DOC_FILE_RE.test(file)) throw new Error('Invalid id');
    return [cleanFolder(parts.join('/')), file];
  };
  const dirOf = async (segs, create = false) => { let d = rootDir; for (const s of segs) d = await d.getDirectoryHandle(s, { create }); return d; };
  const namesIn = async (dir) => { const out = []; for await (const [n] of dir.entries()) out.push(n); return out; };
  const read = async (id) => { const [segs, file] = where(id); return JSON.parse(await (await (await (await dirOf(segs)).getFileHandle(file)).getFile()).text()); };
  const write = async (segs, file, d) => {
    const dir = await dirOf(segs, true);
    const clash = (await namesIn(dir)).find((n) => n !== file && n.toLowerCase() === file.toLowerCase()); // macOS/Windows ignore case
    if (clash) throw new Error(`Invalid id: ${clash} already exists`);
    const w = await (await dir.getFileHandle(file, { create: true })).createWritable(); // an existing file is written in place
    await w.write(JSON.stringify(d, null, 2));
    await w.close();
  };
  return {
    async list() {
      return (await scanFolder(rootDir)).filter((f) => f.kind === kind).map((f) => {
        const id = idOf(f.segs, f.file);
        return { id, name: f.name, folder: folderOfId(id) };
      }).sort((a, b) => a.folder.localeCompare(b.folder) || a.name.localeCompare(b.name));
    },
    get: read,
    async put(id, d) { validate(d); const [segs, file] = where(id); await write(segs, file, d); },
    async create(d, folder = '') {
      validate(d);
      let segs = cleanFolder(folder);
      if (envs && !segs.length) segs = ['environments']; // environments go to environments/ unless a folder is chosen
      let names = [];
      try { names = (await namesIn(await dirOf(segs))).map((n) => n.toLowerCase()); } catch { /* a new folder */ }
      const file = newDocId(nameOf(d), (x) => names.includes(x));
      await write(segs, file, d);
      return idOf(segs, file);
    },
    async remove(id) { const [segs, file] = where(id); await (await dirOf(segs)).removeEntry(file); },
  };
}

/** Workspace state in the data folder (contract: backend.state). Local mode: the server's /api/state. */
function serverState() {
  return {
    get: async () => (await api('GET', '/api/state')).state ?? null,
    async put(obj, { unloading = false } = {}) {
      const body = JSON.stringify(obj);
      const r = await fetch('/api/state', { // keepalive lets a save started while the page closes finish (browsers cap it at 64 KB)
        method: 'PUT', body, keepalive: unloading && body.length < 60000,
        headers: { 'Content-Type': 'application/json', ...(API_TOKEN ? { 'X-ApiMan-Token': API_TOKEN } : {}) },
      });
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || r.statusText);
    },
  };
}
/** Website mode with a folder: <folder>/.apiman/state.json, through the directory handle. */
function folderState(rootDir) {
  const missing = (e) => { if (e.name === 'NotFoundError') return null; throw e; };
  return {
    async get() {
      const dir = await rootDir.getDirectoryHandle('.apiman').catch(missing);
      const file = dir && await dir.getFileHandle('state.json').catch(missing);
      if (!file) return null;
      const v = JSON.parse(await (await file.getFile()).text());
      return v && typeof v === 'object' && !Array.isArray(v) ? v : null;
    },
    async put(obj) {
      const dir = await rootDir.getDirectoryHandle('.apiman', { create: true });
      await dir.getFileHandle('.gitignore').catch(async () => { // history and tabs can hold tokens: git never picks this folder up
        const g = await (await dir.getFileHandle('.gitignore', { create: true })).createWritable();
        await g.write("# ApiMan's private, local-only state\n*\n");
        await g.close();
      });
      const w = await (await dir.getFileHandle('state.json', { create: true })).createWritable(); // replaced as a whole on close
      await w.write(JSON.stringify(obj));
      await w.close();
    },
  };
}

// The chosen folder handle survives reloads in IndexedDB (localStorage can't hold it).
function idbHandle(op, value) {
  return new Promise((resolve, reject) => {
    const open = indexedDB.open('apiman', 1);
    open.onupgradeneeded = () => open.result.createObjectStore('kv');
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const tx = open.result.transaction('kv', op === 'get' ? 'readonly' : 'readwrite');
      const req = op === 'get' ? tx.objectStore('kv').get('dir') : tx.objectStore('kv').put(value, 'dir');
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    };
  });
}

// ---------- sending ----------
/** Turns the wire body descriptor into something fetch() can send. */
async function materializeBody(body) {
  if (!body || body.kind === 'none') return { payload: undefined };
  if (body.kind === 'text') return { payload: body.text };
  if (body.kind === 'file') return { payload: body.file };
  const fd = new FormData();
  for (const f of body.fields) f.file ? fd.append(f.key, f.file, f.file.name) : fd.append(f.key, f.value);
  return { payload: fd, isForm: true };
}

async function serverSend(wire, signal) {
  const spec = {
    method: wire.method, url: wire.url, headers: wire.headers,
    timeout: state.settings.timeout, followRedirects: wire.followRedirects ?? state.settings.followRedirects, insecure: state.settings.insecure,
    maxRedirects: state.settings.maxRedirects || 10, cookies: wire.cookies ?? state.settings.cookies !== false,
  };
  const { payload, isForm } = await materializeBody(wire.body);
  if (typeof payload === 'string') spec.body = payload;
  else if (payload) {
    const r = new Response(payload); // encodes multipart with a boundary for FormData
    spec.bodyBase64 = bufToB64(await r.arrayBuffer());
    if (isForm) {
      spec.headers = spec.headers.filter(([k]) => k.toLowerCase() !== 'content-type');
      spec.headers.push(['Content-Type', r.headers.get('content-type')]);
    }
  }
  return api('POST', '/api/send', spec, signal);
}

async function browserSend(wire, signal) {
  const target = new URL(wire.url);
  if (location.protocol === 'https:' && target.protocol === 'http:' && !isLocalHost(target.hostname)) {
    return { error: 'Browsers block plain http:// APIs from a secure page. Use https://, or run ApiMan locally (python3 server.py).' };
  }
  const { payload, isForm } = await materializeBody(wire.body);
  const noBody = ['GET', 'HEAD'].includes(wire.method);
  const SAFE = ['accept', 'accept-language', 'content-language', 'content-type'];
  const carriesSecrets = wire.headers.some(([k]) => !SAFE.includes(k.toLowerCase()));
  const headers = wire.headers.filter(([k]) => !(isForm && k.toLowerCase() === 'content-type'));
  const timeout = AbortSignal.timeout ? AbortSignal.timeout(state.settings.timeout * 1000) : null;
  const sig = signal && timeout && AbortSignal.any ? AbortSignal.any([signal, timeout]) : (signal || timeout);
  const start = performance.now();
  let r;
  try {
    r = await fetch(wire.url, {
      method: wire.method, headers, body: noBody ? undefined : payload,
      // fetch only strips Authorization on cross-site redirects; custom headers (X-Api-Key, ...) would follow.
      credentials: 'omit', redirect: (wire.followRedirects ?? state.settings.followRedirects) && !carriesSecrets ? 'follow' : 'manual', signal: sig,
    });
  } catch (e) {
    if (e.name === 'TimeoutError') return { error: `No response within ${state.settings.timeout} s.` };
    if (e.name === 'AbortError') return { error: 'Request cancelled.' };
    return { error: `The browser couldn't complete this request. Either ${target.host} doesn't allow cross-site requests (CORS), `
      + 'or it isn\'t reachable from here. Run ApiMan locally (python3 server.py) to call any API without CORS limits.' };
  }
  if (r.type === 'opaqueredirect') {
    if (wire.followRedirects === false) return { error: 'The API answered with a redirect, which is not followed here. Browsers hide redirect details; run ApiMan locally to see them.' };
    return { error: state.settings.followRedirects
      ? 'The API answered with a redirect. ApiMan did not follow it because this request carries headers such as Authorization or API keys, which a browser could forward to another site. Run ApiMan locally to follow redirects safely.'
      : 'The API answered with a redirect, and "Follow redirects" is off in Settings. Browsers hide redirect details; run ApiMan locally to see them.' };
  }
  const buf = await r.arrayBuffer();
  let text = null;
  try { text = new TextDecoder('utf-8', { fatal: true }).decode(buf); } catch { /* binary */ }
  return {
    status: r.status, reason: r.statusText, headers: [...r.headers], body: text, binary: text === null,
    bodyBase64: text === null ? bufToB64(buf) : null, size: buf.byteLength, truncated: false,
    timeMs: Math.round(performance.now() - start), finalUrl: r.url, redirectStripped: [],
    notes: noBody && payload !== undefined ? ['Browsers can\'t send a body with GET/HEAD; it was left out.'] : [],
  };
}

let backend = null; // { mode, collections, environments, state, send }; state is null when data stays in this browser
let lastWriteAt = 0; // our own last write: a change it makes on disk isn't news

/** Local mode: every few seconds, has anything in the data folder changed (another app, git pull, an editor, a
 *  teammate's sync)? Then collections, environments and Robot projects reload; tabs you're editing are kept. */
function watchDataFolder() {
  let sig = null, busy = false;
  const tick = async () => {
    if (busy || document.visibilityState !== 'visible') return;
    busy = true;
    try {
      const r = await api('GET', '/api/changes');
      if (sig && r.sig !== sig) {
        // right after our own write the change may be ours, or a file someone dropped in at the same moment: never
        // swallow it, look again once the write has settled (a reload after our own save costs nothing)
        if (Date.now() - lastWriteAt < 2000) return;
        await reloadFromDisk();
      }
      sig = r.sig;
    } catch { /* the server restarting: try again next time */ } finally { busy = false; }
  };
  setInterval(tick, 3000);
  document.addEventListener('visibilitychange', tick);
  tick();
}
async function reloadFromDisk() {
  const editing = new Set(state.tabs.filter((t) => t.dirty && t.cid).map((t) => t.cid));
  for (const cid of Object.keys(state.cols)) if (!editing.has(cid)) delete state.cols[cid];
  await Promise.all([refreshCollections(), refreshEnvironments()]);
  for (const t of state.tabs) { // a request you haven't edited shows its new version
    if (!t.cid || t.dirty || !state.cols[t.cid]) continue;
    const loc = locate(state.cols[t.cid], t.itemId);
    if (loc) t.ed = fromItem(loc.item);
  }
  renderEnvPicker();
  renderAll();
  document.dispatchEvent(new Event('apiman:datachanged'));
}
/** Settings → Data folder → Change: any folder; ApiMan reads its collections, environments and Robot projects. */
async function changeDataFolder() {
  const shell = window.pywebview && window.pywebview.api;
  const path = shell && shell.choose_folder ? await shell.choose_folder()
    : await ask({ title: 'Data folder', message: 'The folder with your collections, environments and Robot projects (subfolders are found too):', input: state.dataDir || '', ok: 'Use this folder' });
  if (!path) return;
  if (state.tabs.some((t) => t.dirty) && !(await ask({ title: 'Switch folder?', message: 'Tabs with unsaved changes will close, and the changes will be lost.', ok: 'Switch folder', danger: true }))) return;
  writeTabs();
  await workspace.flush();
  const r = await api('POST', '/api/data-folder', { path });
  toast(`Using ${r.dataDir}`, 'ok');
  setTimeout(() => location.reload(), 400);
}

function makeBackend(mode, dir) {
  if (mode === 'local') return { mode, collections: serverStore('collections'), environments: serverStore('environments'), state: serverState(), send: serverSend };
  if (dir) return { mode, dir, collections: folderStore(dir, 'collections'), environments: folderStore(dir, 'environments'), state: folderState(dir), send: browserSend };
  return { mode, collections: browserStore('collections'), environments: browserStore('environments'), state: null, send: browserSend };
}

// =====================================================================================================
// Postman v2.x model <-> editor model
// =====================================================================================================
function kvIn(list) {
  return (Array.isArray(list) ? list : []).filter((x) => x && typeof x === 'object').map((x) => ({
    key: String(x.key ?? ''), value: x.value == null ? '' : String(x.value), disabled: !!x.disabled,
    ...(x.description ? { description: typeof x.description === 'string' ? x.description : x.description.content || '' } : {}),
  }));
}
function kvOut(rows) {
  return rows.filter((r) => r.key || r.value).map((r) => ({
    key: r.key, value: r.value, ...(r.disabled ? { disabled: true } : {}), ...(r.description ? { description: r.description } : {}),
  }));
}

function authIn(a) {
  if (!a || typeof a !== 'object') return { type: 'inherit' };
  const get = (k) => {
    const list = a[a.type];
    if (Array.isArray(list)) { const x = list.find((e) => e && e.key === k); return x && x.value != null ? String(x.value) : ''; }
    return list && list[k] != null ? String(list[k]) : '';
  };
  switch (a.type) {
    case 'noauth': return { type: 'noauth' };
    case 'bearer': return { type: 'bearer', token: get('token') };
    case 'basic': return { type: 'basic', username: get('username'), password: get('password') };
    case 'apikey': return { type: 'apikey', key: get('key'), value: get('value'), in: get('in') === 'query' ? 'query' : 'header' };
    case 'oauth2': {
      const g = get('grant_type');
      return { type: 'oauth2', grant: g === 'client_credentials' ? 'client_credentials' : g === 'password_credentials' ? 'password' : 'authorization_code', pkce: g !== 'authorization_code',
        authUrl: get('authUrl'), tokenUrl: get('accessTokenUrl'), clientId: get('clientId'), clientSecret: get('clientSecret'), scope: get('scope'), audience: get('audience'),
        username: get('username'), password: get('password'), clientAuth: get('client_authentication') === 'body' ? 'body' : 'header', headerPrefix: get('headerPrefix') || 'Bearer', raw: a };
    }
    default: return { type: 'unsupported', raw: a };
  }
}
function authOut(m) {
  const pairs = (o) => Object.entries(o).map(([key, value]) => ({ key, value, type: 'string' }));
  switch (m.type) {
    case 'inherit': return undefined;
    case 'noauth': return { type: 'noauth' };
    case 'bearer': return { type: 'bearer', bearer: pairs({ token: m.token }) };
    case 'basic': return { type: 'basic', basic: pairs({ username: m.username, password: m.password }) };
    case 'apikey': return { type: 'apikey', apikey: pairs({ key: m.key, value: m.value, in: m.in }) };
    case 'oauth2': { // Postman's layout; keys ApiMan doesn't edit (redirect_uri, tokenName…) are kept
      const grant_type = m.grant === 'client_credentials' ? 'client_credentials' : m.grant === 'password' ? 'password_credentials' : m.pkce === false ? 'authorization_code' : 'authorization_code_with_pkce';
      const mine = { grant_type, authUrl: m.authUrl || '', accessTokenUrl: m.tokenUrl || '', clientId: m.clientId || '', clientSecret: m.clientSecret || '', scope: m.scope || '',
        ...(m.audience ? { audience: m.audience } : {}), ...(m.grant === 'password' ? { username: m.username || '', password: m.password || '' } : {}),
        client_authentication: m.clientAuth === 'body' ? 'body' : 'header', headerPrefix: m.headerPrefix ?? 'Bearer', addTokenTo: 'header' };
      const keep = (m.raw && Array.isArray(m.raw.oauth2) ? m.raw.oauth2 : []).filter((e) => e && !Object.hasOwn(mine, e.key) && !['audience', 'username', 'password'].includes(e.key));
      return { type: 'oauth2', oauth2: [...pairs(mine), ...keep] };
    }
    default: return m.raw;
  }
}

function blankBody() {
  return { mode: 'none', lang: 'json', raw: '', urlencoded: [], formdata: [], fileSrc: '', fileObj: null, gqlQuery: '', gqlVars: '' };
}
function bodyIn(b) {
  const body = blankBody();
  if (!b || typeof b !== 'object' || !b.mode) return body;
  if (b.mode === 'raw') {
    body.mode = 'raw';
    body.raw = String(b.raw ?? '');
    const lang = b.options && b.options.raw && b.options.raw.language;
    body.lang = ['json', 'text', 'xml', 'html', 'javascript'].includes(lang) ? lang : (/^\s*[[{]/.test(body.raw) ? 'json' : 'text');
  } else if (b.mode === 'urlencoded') {
    body.mode = 'urlencoded';
    body.urlencoded = kvIn(b.urlencoded);
  } else if (b.mode === 'formdata') {
    body.mode = 'formdata';
    body.formdata = (Array.isArray(b.formdata) ? b.formdata : []).filter((x) => x && typeof x === 'object').map((x) => ({
      key: String(x.key ?? ''), value: x.type === 'file' ? '' : String(x.value ?? ''), type: x.type === 'file' ? 'file' : 'text',
      src: Array.isArray(x.src) ? x.src.join(', ') : (x.src || ''), srcRaw: x.src, disabled: !!x.disabled, file: null,
    }));
  } else if (b.mode === 'file') {
    body.mode = 'file';
    body.fileSrc = (b.file && b.file.src) || '';
  } else if (b.mode === 'graphql') {
    body.mode = 'graphql';
    body.gqlQuery = (b.graphql && b.graphql.query) || '';
    body.gqlVars = (b.graphql && b.graphql.variables) || '';
  } else {
    body.mode = 'unsupported';
    body.unsupported = b;
  }
  return body;
}
function bodyOut(b) {
  switch (b.mode) {
    case 'raw': return { mode: 'raw', raw: b.raw, options: { raw: { language: b.lang } } };
    case 'urlencoded': return { mode: 'urlencoded', urlencoded: kvOut(b.urlencoded) };
    case 'formdata': return {
      mode: 'formdata',
      formdata: b.formdata.filter((r) => r.key || r.value || r.src || r.file).map((r) => (r.type === 'file'
        ? { key: r.key, type: 'file', src: r.file ? r.file.name : (r.srcRaw !== undefined && r.src === (Array.isArray(r.srcRaw) ? r.srcRaw.join(', ') : r.srcRaw) ? r.srcRaw : r.src), ...(r.disabled ? { disabled: true } : {}) }
        : { key: r.key, value: r.value, type: 'text', ...(r.disabled ? { disabled: true } : {}) })),
    };
    case 'file': return { mode: 'file', file: { src: b.fileObj ? b.fileObj.name : b.fileSrc } };
    case 'graphql': return { mode: 'graphql', graphql: { query: b.gqlQuery, variables: b.gqlVars } };
    case 'unsupported': return b.unsupported;
    default: return undefined;
  }
}

function scriptIn(events, listen) {
  const ev = (Array.isArray(events) ? events : []).find((e) => e && e.listen === listen);
  if (!ev || !ev.script) return '';
  const exec = ev.script.exec;
  return Array.isArray(exec) ? exec.join('\n') : String(exec || '');
}
function scriptsOut(events, pre, test) {
  const keep = (Array.isArray(events) ? events : []).filter((e) => e && e.listen !== 'prerequest' && e.listen !== 'test');
  const mk = (listen, code) => ({ listen, script: { type: 'text/javascript', exec: code.split('\n') } });
  if (pre.trim()) keep.push(mk('prerequest', pre));
  if (test.trim()) keep.push(mk('test', test));
  return keep.length ? keep : undefined;
}
function docIn(d) { return typeof d === 'string' ? d : (d && d.content) || ''; }

function urlIn(u) {
  if (!u) return { raw: '', disabled: [], pathVars: [] };
  if (typeof u === 'string') return { raw: u, disabled: [], pathVars: [] };
  const disabled = kvIn(u.query).filter((q) => q.disabled);
  const pathVars = (Array.isArray(u.variable) ? u.variable : []).filter((v) => v && typeof v === 'object')
    .map((v) => ({ ...v, key: String(v.key ?? ''), value: v.value == null ? '' : String(v.value) })); // keep type/disabled/description
  if (u.raw) return { raw: String(u.raw), disabled, pathVars };
  const host = Array.isArray(u.host) ? u.host.join('.') : (u.host || '');
  const path = Array.isArray(u.path) ? u.path.join('/') : (u.path || '');
  const q = kvIn(u.query).filter((x) => !x.disabled).map((x) => `${x.key}=${x.value}`).join('&');
  return { pathVars, raw: `${u.protocol ? u.protocol + '://' : ''}${host}${u.port ? ':' + u.port : ''}${path ? '/' + path : ''}${q ? '?' + q : ''}`, disabled };
}
/** Same split Postman uses, so files stay readable by Postman. */
function urlOut(raw, params, pathVars = []) {
  const out = { raw };
  let rest = raw.split('#')[0].split('?')[0];
  const proto = rest.match(/^([a-z][\w+.-]*):\/\//i);
  if (proto) { out.protocol = proto[1]; rest = rest.slice(proto[0].length); }
  const slash = rest.indexOf('/');
  let hostPort = slash === -1 ? rest : rest.slice(0, slash);
  const path = slash === -1 ? '' : rest.slice(slash + 1);
  const port = hostPort.match(/:(\d+|{{[^{}]+}})$/);
  if (port) { out.port = port[1]; hostPort = hostPort.slice(0, -port[0].length); }
  out.host = hostPort.includes('{{') ? [hostPort] : hostPort.split('.').filter(Boolean);
  if (path) out.path = path.split('/');
  const query = kvOut(params);
  if (query.length) out.query = query;
  const variable = pathVars.filter((v) => v.key).map((v) => ({ ...v }));
  if (variable.length) out.variable = variable;
  return out;
}

function parseQuery(url) {
  const q = url.split('#')[0];
  const i = q.indexOf('?');
  if (i === -1) return [];
  return q.slice(i + 1).split('&').filter((p) => p !== '').map((p) => {
    const eq = p.indexOf('=');
    return { key: eq === -1 ? p : p.slice(0, eq), value: eq === -1 ? '' : p.slice(eq + 1), disabled: false, keepEq: eq !== -1 };
  });
}
function withQuery(url, params) {
  const hashAt = url.indexOf('#');
  const hash = hashAt === -1 ? '' : url.slice(hashAt);
  const base = (hashAt === -1 ? url : url.slice(0, hashAt)).split('?')[0];
  const q = params.filter((p) => !p.disabled && (p.key || p.value)).map((p) => (p.value === '' && !p.keepEq ? p.key : `${p.key}=${p.value}`)).join('&');
  return base + (q ? '?' + q : '') + hash;
}

/** ":name" path segments (Postman path variables), never the ":port" after a host. */
function pathVarNames(url) {
  const path = String(url).split(/[?#]/)[0].replace(/^[a-z][\w+.-]*:\/\/[^/]*/i, '').replace(/^{{[^{}]+}}/, '');
  return [...path.matchAll(/\/:([A-Za-z_][\w-]*)/g)].map((m) => m[1]).filter((n, i, a) => a.indexOf(n) === i);
}
function syncPathVars(url, existing = []) {
  return pathVarNames(url).map((key) => existing.find((v) => v.key === key) || { key, value: '' });
}
function applyPathVars(url, pathVars, r) {
  const [beforeQ, ...rest] = String(url).split('?');
  const map = new Map((pathVars || []).filter((v) => v.key && v.value !== '').map((v) => [v.key, r(v.value)]));
  const swapped = beforeQ.replace(/(^[a-z][\w+.-]*:\/\/[^/]*|^{{[^{}]+}})?(.*)$/i, (m, origin = '', path) =>
    origin + path.replace(/\/:([A-Za-z_][\w-]*)/g, (mm, k) => (map.has(k) ? `/${encodeURIComponent(map.get(k))}` : mm)));
  return [swapped, ...rest].join('?');
}

function blankEd() {
  return {
    name: 'Untitled request', method: 'GET', url: '', params: [], pathVars: [], headers: [],
    auth: { type: 'inherit' }, body: blankBody(), pre: '', test: '', docs: '',
  };
}
function fromItem(item) {
  const req = typeof item.request === 'string' ? { url: item.request, method: 'GET' } : (item.request || {});
  const ed = blankEd();
  ed.name = String(item.name ?? '') || 'Untitled request';
  const method = String(req.method || 'GET').toUpperCase();
  ed.method = /^[A-Z]{1,16}$/.test(method) ? method : 'GET'; // imported files are untrusted: no "GET; rm -rf ~"
  const u = urlIn(req.url);
  ed.url = u.raw;
  const described = (typeof req.url === 'object' && req.url ? kvIn(req.url.query) : []).filter((q) => !q.disabled && q.description);
  ed.params = [...parseQuery(u.raw).map((p) => { const d = described.find((q) => q.key === p.key); return d ? { ...p, description: d.description } : p; }), ...u.disabled];
  ed.pathVars = syncPathVars(u.raw, u.pathVars);
  ed.headers = kvIn(req.header);
  ed.auth = authIn(req.auth);
  ed.body = bodyIn(req.body);
  ed.pre = scriptIn(item.event, 'prerequest');
  ed.test = scriptIn(item.event, 'test');
  ed.docs = docIn(req.description);
  return ed;
}
function toItem(ed, orig = {}) {
  const origReq = orig.request && typeof orig.request === 'object' ? orig.request : {};
  const req = { ...origReq, method: ed.method, header: kvOut(ed.headers), url: urlOut(ed.url, ed.params, ed.pathVars || []) };
  const auth = authOut(ed.auth);
  if (auth) req.auth = auth; else delete req.auth;
  const body = bodyOut(ed.body);
  // keep fields ApiMan doesn't edit (options, disabled, ...) when the body type is unchanged
  if (body) req.body = origReq.body && origReq.body.mode === body.mode ? { ...origReq.body, ...body } : body; else delete req.body;
  if (ed.docs) req.description = ed.docs; else delete req.description;
  const item = { ...orig, id: orig.id || uid(), name: ed.name || 'Untitled request', request: req, response: orig.response || [] };
  const ev = scriptsOut(orig.event, ed.pre, ed.test);
  if (ev) item.event = ev; else delete item.event;
  return item;
}

/** A JSON-safe copy of an editor (File objects can't be stored). */
function edForStorage(ed) {
  return JSON.parse(JSON.stringify(ed, (k, v) => (k === 'file' || k === 'fileObj' ? null : v)));
}

// ---------- collection tree helpers ----------
function ensureIds(items, nested = false) {
  if (!nested) ensureIds.seen = new Set();
  let changed = false;
  for (let i = items.length - 1; i >= 0; i--) {   // drop null/garbage entries from hand-edited files
    if (!items[i] || typeof items[i] !== 'object') { items.splice(i, 1); changed = true; }
  }
  for (const it of items) {
    if (!it.id || typeof it.id !== 'string' || ensureIds.seen.has(it.id)) { it.id = uid(); changed = true; } // duplicates would open/save the wrong item
    ensureIds.seen.add(it.id);
    if (it.name != null && typeof it.name !== 'string') { it.name = String(it.name); changed = true; }
    if (Array.isArray(it.item)) changed = ensureIds(it.item, true) || changed;
  }
  return changed;
}
ensureIds.seen = new Set();
function locate(col, id) {
  const walk = (items, parents) => {
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      if (it.id === id) return { item: it, parents, list: items, index: i };
      if (Array.isArray(it.item)) { const r = walk(it.item, [...parents, it]); if (r) return r; }
    }
    return null;
  };
  return col ? walk(col.item, []) : null;
}
function eachRequest(items, fn, parents = [], onFolders = null) {
  for (const it of items) {
    if (Array.isArray(it.item)) { if (onFolders) onFolders([it]); eachRequest(it.item, fn, [...parents, it], onFolders); } else fn(it, parents);
  }
}
function countRequests(items) { let n = 0; eachRequest(items, () => n++); return n; }
const isFolder = (it) => Array.isArray(it.item);
const itemMethod = (it) => String((it.request && typeof it.request === 'object' && it.request.method) || 'GET').toUpperCase();

// =====================================================================================================
// Variables
// =====================================================================================================
const envObj = (doc) => Object.fromEntries((doc && doc.values || []).filter((v) => v && v.key && v.enabled !== false).map((v) => [v.key, String(v.value ?? '')]));
const colObj = (col) => Object.fromEntries((col && col.variable || []).filter((v) => v && v.key && !v.disabled).map((v) => [v.key, String(v.value ?? '')]));

function scopesFor(cid, envId = state.activeEnv) {
  return {
    globals: envObj(state.envs[GLOBALS_ID]),
    collection: colObj(cid && state.cols[cid]),
    environment: envObj(envId && state.envs[envId]),
    local: {},
  };
}
// Postman's precedence: local > iteration data (Runner data file) > environment > collection > globals
const merged = (sc) => ({ ...sc.globals, ...sc.collection, ...sc.environment, ...(sc.data || {}), ...sc.local });

const FIRST = ['Ada', 'Lin', 'Sam', 'Ravi', 'Mia', 'Noah', 'Zoe', 'Omar'];
let dynMemo = null; // while a view needs stable values (Generate code): each {{$dynamic}} keeps the value it got first
function dynamicVar(name) {
  if (dynMemo && dynMemo.has(name)) return dynMemo.get(name);
  const v = dynamicVarNow(name);
  if (dynMemo && v !== undefined) dynMemo.set(name, v);
  return v;
}
function dynamicVarNow(name) {
  const rnd = (n) => Math.floor(Math.random() * n);
  switch (name) {
    case '$guid': case '$randomUUID': return uid();
    case '$timestamp': return String(Math.floor(Date.now() / 1000));
    case '$isoTimestamp': return new Date().toISOString();
    case '$randomInt': return String(rnd(1001));
    case '$randomFirstName': return FIRST[rnd(FIRST.length)];
    case '$randomEmail': return `user${rnd(1e6)}@example.com`;
    case '$randomBoolean': return String(Math.random() < 0.5);
    default: return undefined;
  }
}
const VAR_RE = /{{\s*([^{}]+?)\s*}}/g;
function resolve(str, vars) {
  let s = String(str ?? '');
  for (let pass = 0; pass < 10 && s.includes('{{'); pass++) {
    const next = s.replace(VAR_RE, (m, k) => (Object.hasOwn(vars, k) ? vars[k] : (dynamicVar(k) ?? m)));
    if (next === s) break;
    s = next;
  }
  return s;
}
/** The loop a variable is part of ({{a}} → {{b}} → {{a}}), as names, or null. */
function varCycle(name, vars, path = []) {
  if (path.includes(name)) return [...path.slice(path.indexOf(name)), name];
  if (!Object.hasOwn(vars, name)) return null;
  for (const m of String(vars[name]).matchAll(VAR_RE)) { const c = varCycle(m[1], vars, [...path, name]); if (c) return c; }
  return null;
}
/** Why {{names}} didn't resolve: one that refers to itself says so; the others aren't defined. */
function missingVarMessage(missing, vars) {
  const loop = missing.map((k) => varCycle(k, vars)).find(Boolean);
  if (loop) return `Variable {{${loop[0]}}} refers to itself (${loop.join(' → ')}). Change one of them to a value.`;
  const deep = missing.filter((k) => Object.hasOwn(vars, k));
  if (deep.length) return `Variable {{${deep[0]}}} nests other variables more than 10 levels deep.`;
  return `Unknown variable${missing.length > 1 ? 's' : ''} ${missing.map((v) => `{{${v}}}`).join(', ')}. Define ${missing.length > 1 ? 'them' : 'it'} in the environment, the collection, or Globals.`;
}
/** The preview of a value: nested variables resolved like a send, {{$dynamic}} ones shown as ‹$name›. */
function resolvePreview(str, vars) {
  let s = String(str ?? '');
  for (let pass = 0; pass < 10 && s.includes('{{'); pass++) {
    const next = s.replace(VAR_RE, (m, k) => (Object.hasOwn(vars, k) ? vars[k] : k.startsWith('$') && dynamicVarNow(k) !== undefined ? `‹${k}›` : m));
    if (next === s) break;
    s = next;
  }
  return s;
}
function unresolved(strings) {
  const out = new Set();
  for (const s of strings) for (const m of String(s ?? '').matchAll(VAR_RE)) out.add(m[1]);
  return [...out];
}

// =====================================================================================================
// Script sandbox
//   Scripts (often from imported collections you didn't write) run in a Web Worker started inside a
//   sandboxed iframe whose Content-Security-Policy is default-src 'none':
//     - opaque origin: no access to ApiMan's storage, cookies, IndexedDB or the page
//     - CSP: no fetch/XHR/WebSocket/images, so nothing can be sent anywhere
//     - worker: runs off the main thread and is terminated after a time limit (infinite loops can't hang the app)
// =====================================================================================================
const SCRIPT_TIMEOUT_MS = 5000;

const SCRIPT_MAX_MS = 60000; // hard cap per script run, including time spent waiting for pm.sendRequest replies
const SEND_MAX = 10; // pm.sendRequest calls per script run
const SEND_TIMEOUT_MS = 30000; // per pm.sendRequest call

const PM_WORKER = String.raw`
'use strict';
let started = false;
const sendWaiters = new Map(); // pm.sendRequest id -> settle(reply)
self.onmessage = async (e) => {
  if (started) {
    // later messages are pm.sendRequest replies, relayed by the sandbox frame from the app window
    const r = e.data && e.data.sendResult;
    const settle = r && sendWaiters.get(r.id);
    if (settle) { sendWaiters.delete(r.id); settle(r); }
    return;
  }
  started = true;
  const { code, ctx } = e.data;
  // Self-check: the CSP inherited from the sandbox frame must block loading code/data from anywhere.
  // If this browser doesn't enforce it, scripts could reach the network, so refuse to run them.
  let isolated = false;
  try { importScripts('data:text/javascript,void 0'); } catch (_) { isolated = true; }
  if (!isolated) { postMessage({ fatal: 'Scripts are disabled: this browser does not isolate the script sandbox from the network.' }); return; }
  const logs = [], tests = [], pending = [];
  const show = (v) => { if (typeof v === 'string') return v; try { return JSON.stringify(v); } catch (_) { return String(v); } };
  const cons = {};
  for (const level of ['log', 'info', 'warn', 'error', 'debug']) cons[level] = (...a) => { if (logs.length < 500) logs.push({ level, text: a.map(show).join(' ').slice(0, 5000) }); };

  const V = ctx.vars;
  const str = (v) => (v == null ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v));
  const VAR_RE = /{{\s*([^{}]+?)\s*}}/g;
  // Postman's precedence: local > iteration data > environment > collection > globals
  const all = () => Object.assign({}, V.globals, V.collection, V.environment, V.data || {}, V.local);
  const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
  const replaceIn = (s) => String(s).replace(VAR_RE, (m, k) => { const a = all(); return own(a, k) ? a[k] : m; });
  const scope = (o, extra) => Object.assign({
    get: (k) => o[k], set: (k, v) => { o[k] = str(v); }, unset: (k) => { delete o[k]; }, has: (k) => own(o, k),
    clear: () => { for (const k of Object.keys(o)) delete o[k]; }, toObject: () => Object.assign({}, o), replaceIn,
  }, extra || {});

  // ---------- chai-style expect (the subset Postman collections use) ----------
  const sortKeys = (v) => Array.isArray(v) ? v.map(sortKeys) : v && typeof v === 'object' ? Object.keys(v).sort().reduce((o, k) => (o[k] = sortKeys(v[k]), o), {}) : v;
  const deepEq = (a, b) => JSON.stringify(sortKeys(a)) === JSON.stringify(sortKeys(b));
  function expect(actual, label) {
    let neg = false, deep = false;
    const pre = label ? label + ': ' : '';
    const check = (ok, msg) => { if (neg ? ok : !ok) throw new Error(pre + 'expected ' + show(actual) + (neg ? ' not ' : ' ') + msg); return api; };
    const typeOf = (v) => v === null ? 'null' : Array.isArray(v) ? 'array' : typeof v;
    const api = {
      equal: (v) => check(deep ? deepEq(actual, v) : actual === v, 'to equal ' + show(v)),
      eql: (v) => check(deepEq(actual, v), 'to deeply equal ' + show(v)),
      a: (t) => check(typeOf(actual) === String(t).toLowerCase(), 'to be a ' + t),
      include: (v) => check(
        typeof actual === 'string' ? actual.includes(v)
          : Array.isArray(actual) ? actual.some((x) => deepEq(x, v))
          : actual && typeof actual === 'object' && v && typeof v === 'object' ? Object.keys(v).every((k) => deepEq(actual[k], v[k]))
          : false, 'to include ' + show(v)),
      property: (k, ...val) => {
        const has = actual != null && Object.prototype.hasOwnProperty.call(Object(actual), k);
        check(val.length ? has && deepEq(actual[k], val[0]) : has, 'to have property ' + show(k) + (val.length ? ' of ' + show(val[0]) : ''));
        if (has && !neg) actual = actual[k];
        return api;
      },
      lengthOf: (n) => check(actual != null && actual.length === n, 'to have length ' + n),
      above: (n) => check(actual > n, 'to be above ' + n),
      below: (n) => check(actual < n, 'to be below ' + n),
      least: (n) => check(actual >= n, 'to be at least ' + n),
      most: (n) => check(actual <= n, 'to be at most ' + n),
      within: (a, b) => check(actual >= a && actual <= b, 'to be within ' + a + '..' + b),
      oneOf: (list) => check(list.some((x) => deepEq(x, actual)), 'to be one of ' + show(list)),
      match: (re) => check(re.test(String(actual)), 'to match ' + re),
      keys: (...k) => { const ks = k.flat(); return check(actual && ks.every((x) => x in actual), 'to have keys ' + show(ks)); },
      members: (list) => check(Array.isArray(actual) && list.length === actual.length && list.every((x) => actual.some((y) => deepEq(x, y))), 'to have members ' + show(list)),
      satisfy: (fn) => check(!!fn(actual), 'to satisfy the given function'),
    };
    Object.assign(api, { equals: api.equal, eq: api.equal, eqls: api.eql, an: api.a, includes: api.include, contain: api.include, contains: api.include,
      length: api.lengthOf, gt: api.above, greaterThan: api.above, lt: api.below, lessThan: api.below, gte: api.least, lte: api.most, haveOwnProperty: api.property });
    const chain = ['to', 'be', 'been', 'is', 'that', 'which', 'and', 'has', 'have', 'with', 'at', 'of', 'same', 'does', 'still', 'also'];
    for (const w of chain) Object.defineProperty(api, w, { get: () => api });
    Object.defineProperty(api, 'not', { get: () => { neg = !neg; return api; } });
    Object.defineProperty(api, 'deep', { get: () => { deep = true; return api; } });
    const flag = (name, test, msg) => Object.defineProperty(api, name, { get: () => check(test(actual), msg) });
    flag('ok', (v) => !!v, 'to be truthy');
    flag('true', (v) => v === true, 'to be true');
    flag('false', (v) => v === false, 'to be false');
    flag('null', (v) => v === null, 'to be null');
    flag('undefined', (v) => v === undefined, 'to be undefined');
    flag('exist', (v) => v != null, 'to exist');
    flag('NaN', (v) => Number.isNaN(v), 'to be NaN');
    flag('empty', (v) => v != null && (typeof v === 'string' || Array.isArray(v) ? v.length === 0 : typeof v === 'object' ? Object.keys(v).length === 0 : false), 'to be empty');
    return api;
  }

  // ---------- request (pre-request scripts may change it) ----------
  const req = ctx.request;
  const headerApi = {
    add: (h) => { if (h && h.key) req.headers.push([String(h.key), str(h.value)]); },
    upsert: (h) => { if (!h || !h.key) return; headerApi.remove(h.key); req.headers.push([String(h.key), str(h.value)]); },
    remove: (k) => { req.headers = req.headers.filter(([x]) => x.toLowerCase() !== String(k).toLowerCase()); },
    get: (k) => { const f = req.headers.find(([x]) => x.toLowerCase() === String(k).toLowerCase()); return f ? f[1] : undefined; },
    has: (k) => headerApi.get(k) !== undefined,
    toObject: () => Object.fromEntries(req.headers),
    all: () => req.headers.map(([key, value]) => ({ key, value })),
  };
  const request = {
    get method() { return req.method; }, set method(v) { req.method = String(v).toUpperCase(); },
    get url() { return { toString: () => req.url, update: (u) => { req.url = String(u); } }; },
    set url(v) { req.url = String(v); },
    headers: headerApi,
    get body() { return { raw: req.body, toString: () => req.body || '' }; },
  };

  // ---------- response (test scripts) ----------
  let response;
  if (ctx.response) {
    const r = ctx.response;
    let parsed, parsedOk = false;
    const json = () => { if (!parsedOk) { parsed = JSON.parse(r.body); parsedOk = true; } return parsed; };
    const hget = (k) => { const f = r.headers.find(([x]) => x.toLowerCase() === String(k).toLowerCase()); return f ? f[1] : undefined; };
    const rexpect = (cond, msg) => { if (!cond) throw new Error(msg); };
    const to = {
      have: {
        status: (c) => typeof c === 'number' ? rexpect(r.code === c, 'expected response to have status code ' + c + ' but got ' + r.code)
          : rexpect(String(r.status).toLowerCase() === String(c).toLowerCase(), 'expected response to have status reason ' + show(c) + ' but got ' + show(r.status)),
        header: (k, v) => { const got = hget(k); rexpect(got !== undefined, 'expected response to have header ' + k); if (v !== undefined) rexpect(got === v, 'expected header ' + k + ' to be ' + show(v) + ' but got ' + show(got)); },
        body: (s) => rexpect(s === undefined ? !!r.body : String(r.body).includes(s), s === undefined ? 'expected response to have a body' : 'expected response body to include ' + show(s)),
        jsonBody: (path, val) => {
          let v; try { v = json(); } catch (_) { throw new Error('expected response body to be valid JSON'); }
          if (path === undefined) return;
          for (const p of String(path).split('.')) { v = v == null ? undefined : v[p]; }
          rexpect(arguments.length < 2 ? v !== undefined : deepEq(v, val), 'expected JSON body to have ' + path + (val !== undefined ? ' = ' + show(val) : ''));
        },
        responseTime: { below: (ms) => rexpect(r.responseTime < ms, 'expected response time below ' + ms + ' ms but was ' + r.responseTime) },
      },
      be: {},
    };
    const beFlag = (name, test, msg) => Object.defineProperty(to.be, name, { get: () => rexpect(test(r.code), 'expected response ' + msg + ' but got status ' + r.code) });
    beFlag('ok', (c) => c === 200, 'to be ok (200)');
    beFlag('success', (c) => c >= 200 && c < 300, 'to be success (2xx)');
    beFlag('redirection', (c) => c >= 300 && c < 400, 'to be a redirection (3xx)');
    beFlag('clientError', (c) => c >= 400 && c < 500, 'to be a client error (4xx)');
    beFlag('serverError', (c) => c >= 500, 'to be a server error (5xx)');
    beFlag('error', (c) => c >= 400, 'to be an error');
    beFlag('notFound', (c) => c === 404, 'to be not found (404)');
    beFlag('unauthorized', (c) => c === 401, 'to be unauthorized (401)');
    beFlag('forbidden', (c) => c === 403, 'to be forbidden (403)');
    beFlag('created', (c) => c === 201, 'to be created (201)');
    beFlag('accepted', (c) => c === 202, 'to be accepted (202)');
    beFlag('badRequest', (c) => c === 400, 'to be a bad request (400)');
    Object.defineProperty(to.be, 'json', { get: () => { try { json(); } catch (_) { throw new Error('expected response body to be JSON'); } } });
    to.not = { have: { status: (c) => rexpect(r.code !== c, 'expected response not to have status ' + c) } };
    response = {
      code: r.code, status: r.status, responseTime: r.responseTime, responseSize: r.size,
      headers: { get: hget, has: (k) => hget(k) !== undefined, toObject: () => Object.fromEntries(r.headers), all: () => r.headers.map(([key, value]) => ({ key, value })) },
      text: () => r.body, json, to,
    };
  }

  // ---------- pm.sendRequest ----------
  // The worker has no network. It only describes the request; the app window decides whether and where it
  // may go (destination, limits, no auth/cookies added) and sends it. Nothing here is a safety check.
  let sendSeq = 0;
  const asyncErrors = [];
  const urlText = (u) => u == null ? '' : typeof u === 'string' ? u : typeof u.raw === 'string' ? u.raw : String(u);
  const toSpec = (rq) => {
    const o = typeof rq === 'string' ? { url: rq } : rq && typeof rq === 'object' ? rq : {};
    const headers = [];
    const hd = o.header !== undefined ? o.header : o.headers;
    if (Array.isArray(hd)) { for (const x of hd) if (x && x.key && !x.disabled) headers.push([replaceIn(x.key), replaceIn(str(x.value))]); }
    else if (hd && typeof hd === 'object') { for (const k of Object.keys(hd)) headers.push([replaceIn(k), replaceIn(str(hd[k]))]); }
    const hasH = (n) => headers.some((p) => p[0].toLowerCase() === n);
    let body = null;
    const b = o.body;
    if (typeof b === 'string') body = replaceIn(b);
    else if (b && typeof b === 'object') {
      if (b.mode === 'raw' || (b.mode == null && b.raw != null)) {
        body = replaceIn(str(b.raw));
        const lang = b.options && b.options.raw && String(b.options.raw.language || '').toLowerCase();
        if (lang === 'json' && !hasH('content-type')) headers.push(['Content-Type', 'application/json']);
      } else if (b.mode === 'urlencoded') {
        const rows = Array.isArray(b.urlencoded) ? b.urlencoded : Object.keys(b.urlencoded || {}).map((key) => ({ key, value: b.urlencoded[key] }));
        body = new URLSearchParams(rows.filter((x) => x && x.key && !x.disabled).map((x) => [replaceIn(x.key), replaceIn(str(x.value))])).toString();
        if (!hasH('content-type')) headers.push(['Content-Type', 'application/x-www-form-urlencoded']);
      } else if (b.mode) throw new Error('pm.sendRequest: body mode "' + b.mode + '" is not supported (use raw or urlencoded).');
    }
    return { method: String(o.method || 'GET').toUpperCase(), url: replaceIn(urlText(o.url)).trim(), headers, body };
  };
  const toResponse = (r) => {
    const hs = (Array.isArray(r.headers) ? r.headers : []).map((p) => ({ key: String(p[0]), value: String(p[1]) }));
    const find = (k) => { const f = hs.find((x) => x.key.toLowerCase() === String(k).toLowerCase()); return f ? f.value : undefined; };
    Object.assign(hs, { get: find, has: (k) => find(k) !== undefined, toObject: () => Object.fromEntries(hs.map((x) => [x.key, x.value])), all: () => hs.slice() });
    let parsed, parsedOk = false;
    const body = r.body == null ? '' : String(r.body);
    return {
      code: r.code, status: r.status, headers: hs, responseTime: r.responseTime, responseSize: r.size,
      text: () => body, json: () => { if (!parsedOk) { parsed = JSON.parse(body); parsedOk = true; } return parsed; },
    };
  };
  function sendRequest(rq, cb) {
    const p = new Promise((resolve, reject) => {
      const spec = toSpec(rq); // a bad body mode rejects
      const id = ++sendSeq;
      sendWaiters.set(id, (m) => (m.error ? reject(new Error(String(m.error))) : resolve(toResponse(m.response || {}))));
      postMessage({ sendRequest: { id, spec } });
    });
    if (typeof cb === 'function') {
      // Postman style: callback(err, res). The script stays alive until the callback has run.
      pending.push(p.then((res) => cb(null, res), (err) => cb(err)).catch((err) => { asyncErrors.push(err); }));
      return undefined;
    }
    pending.push(p.catch(() => {})); // keep the script alive until the reply; the caller handles rejection
    return p;
  }

  // ---------- iteration data (read-only: the row of the Runner's data file for this iteration) ----------
  const rowData = ctx.iterationData && typeof ctx.iterationData === 'object' ? ctx.iterationData : {};
  const iterationData = {
    get: (k) => rowData[k], has: (k) => own(rowData, k), toObject: () => Object.assign({}, rowData), toJSON: () => Object.assign({}, rowData), replaceIn,
  };

  // ---------- flow control (used by the Runner; a single Send ignores setNextRequest) ----------
  let next = null, skip = false;
  const setNextRequest = (x) => { next = { to: x == null ? null : typeof x === 'object' && x.id != null ? String(x.id) : String(x) }; };
  const execution = {
    setNextRequest,
    skipRequest: () => { if (ctx.info && ctx.info.eventName === 'prerequest') skip = true; else cons.warn('pm.execution.skipRequest() only works in a pre-request script.'); },
  };

  const pm = {
    environment: scope(V.environment, { name: ctx.envName }),
    collectionVariables: scope(V.collection),
    globals: scope(V.globals),
    variables: {
      get: (k) => { const a = all(); return a[k]; }, set: (k, v) => { V.local[k] = str(v); }, unset: (k) => { delete V.local[k]; },
      has: (k) => own(all(), k), toObject: all, replaceIn,
    },
    iterationData, execution,
    request, response,
    cookies: (() => { // pm.cookies, read-only like Postman's: get, has, toObject, all
      const list = Array.isArray(ctx.cookies) ? ctx.cookies.map((c) => ({ ...c })) : [];
      const find = (n) => list.find((c) => c.name === String(n));
      return { get: (n) => (find(n) || {}).value, has: (n) => !!find(n), toObject: () => Object.fromEntries(list.map((c) => [c.name, c.value])), all: () => list.map((c) => ({ ...c })), count: () => list.length };
    })(),
    info: ctx.info,
    expect,
    test: (name, fn) => {
      const done = (ok, err) => tests.push({ name: String(name), passed: ok, error: err ? String(err && err.message || err) : '' });
      try {
        const r = fn && fn();
        if (r && typeof r.then === 'function') pending.push(r.then(() => done(true), (err) => done(false, err)));
        else done(true);
      } catch (err) { done(false, err); }
    },
    sendRequest,
  };
  pm.test.skip = (name) => tests.push({ name: String(name), passed: null, error: 'skipped' });

  const legacyTests = {};
  const postman = {
    setEnvironmentVariable: pm.environment.set, getEnvironmentVariable: pm.environment.get, clearEnvironmentVariable: pm.environment.unset,
    setGlobalVariable: pm.globals.set, getGlobalVariable: pm.globals.get, clearGlobalVariable: pm.globals.unset,
    setNextRequest,
  };
  const req2 = (m) => { throw new Error("require('" + m + "') isn't available in ApiMan scripts."); };

  let error = '';
  try {
    // an async function, so scripts can use top-level await (await pm.sendRequest(...)), as in Postman
    const AsyncFunction = (async () => {}).constructor;
    const fn = new AsyncFunction('pm', 'console', 'postman', 'tests', 'responseBody', 'responseCode', 'responseTime', 'require', '"use strict";\n' + code);
    const r = fn(pm, cons, postman, legacyTests, ctx.response ? ctx.response.body : undefined,
      ctx.response ? { code: ctx.response.code, name: ctx.response.status } : undefined, ctx.response ? ctx.response.responseTime : undefined, req2);
    if (r && typeof r.then === 'function') await r;
    // callbacks may start more requests or async tests, so wait until nothing is left
    while (pending.length) await Promise.all(pending.splice(0));
    if (asyncErrors.length) throw asyncErrors[0];
  } catch (err) {
    error = String(err && err.message || err);
  }
  for (const [name, ok] of Object.entries(legacyTests)) tests.push({ name, passed: !!ok, error: ok ? '' : 'failed' });
  postMessage({ vars: V, request: req, tests, logs, error, next, skip });
};`;

const SANDBOX_FRAME = `<!doctype html><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval'; worker-src data:">
<script>
// The script's time budget runs only while no pm.sendRequest is waiting for the app window's reply.
// (The app window separately caps each request and the whole run, so waiting can't go on forever.)
let w = null, started = false, inflight = 0, left = 0, since = 0, timer = null, limitS = 0;
const stop = (msg) => { clearTimeout(timer); timer = null; if (w) { w.terminate(); w = null; } if (msg) parent.postMessage(msg, '*'); };
const pause = () => { if (timer) { clearTimeout(timer); timer = null; left -= Date.now() - since; } };
const resume = () => { if (!timer && w) { since = Date.now(); timer = setTimeout(() => stop({ fatal: 'Script stopped after ' + limitS + ' s (possible infinite loop).' }), Math.max(0, left)); } };
onmessage = (e) => {
  if (e.source !== parent) return;
  const d = e.data || {};
  if (d.sendResult) { if (w) { inflight = Math.max(0, inflight - 1); w.postMessage({ sendResult: d.sendResult }); if (!inflight) resume(); } return; }
  if (d.kill) { stop(null); return; }
  if (started) return;
  started = true;
  const { workerSrc, code, ctx, timeoutMs } = d;
  try { w = new Worker('data:text/javascript,' + encodeURIComponent(workerSrc)); }
  catch (err) { parent.postMessage({ fatal: 'Could not start the script sandbox: ' + err.message }, '*'); return; }
  left = timeoutMs; limitS = timeoutMs / 1000;
  resume();
  w.onmessage = (m) => {
    const x = m.data;
    if (x && x.sendRequest) { inflight++; pause(); parent.postMessage({ sendRequest: x.sendRequest }, '*'); return; }
    stop(x);
  };
  w.onerror = (m) => { stop({ fatal: 'Script error: ' + m.message }); m.preventDefault(); };
  w.postMessage({ code, ctx });
};
<\/script>`;

const cleanStrMap = (o) => Object.fromEntries(Object.entries(o && typeof o === 'object' ? o : {})
  .filter(([k]) => typeof k === 'string' && k.length < 300).map(([k, v]) => [k, String(v ?? '').slice(0, 100000)]));

/** Runs one script in the sandbox. Everything coming back is treated as untrusted data. */
/** A timeout that can be paused (it only counts while running). */
function pausableTimer(ms, fn) {
  let left = ms, since = 0, t = null;
  return {
    run() { if (!t && left !== null) { since = Date.now(); t = setTimeout(fn, Math.max(0, left)); } },
    pause() { if (t) { clearTimeout(t); t = null; left -= Date.now() - since; } },
    stop() { clearTimeout(t); t = null; left = null; },
  };
}

/**
 * Runs one script in the sandbox. Everything coming back is treated as untrusted data.
 * onSendRequest(spec, { waitForUser }) answers pm.sendRequest calls ({ response } or { error }); without it they fail.
 * Limits enforced here, in the app window: SEND_MAX calls per run, SCRIPT_MAX_MS per run (time spent asking
 * the user doesn't count), and the fallback timer, which like the frame's budget pauses while a request is out.
 */
function runScript(code, ctx, { onSendRequest = null } = {}) {
  return new Promise((resolve) => {
    const frame = h('iframe', { sandbox: 'allow-scripts', hidden: true, title: 'script sandbox' });
    frame.srcdoc = SANDBOX_FRAME;
    let done = false;
    let sendCount = 0, inflight = 0;
    const runCtrl = new AbortController(); // aborted when the script ends: its requests still out are cancelled
    const fallback = pausableTimer(SCRIPT_TIMEOUT_MS + 2000, () => finish({ fatal: 'Script sandbox did not respond.' }));
    const hardCap = pausableTimer(SCRIPT_MAX_MS, () => finish({ fatal: `Script stopped after ${SCRIPT_MAX_MS / 1000} s in total (including time waiting for pm.sendRequest).` }));
    const waitForUser = async (fn) => { hardCap.pause(); try { return await fn(); } finally { if (!done) hardCap.run(); } };
    const onSend = async (msg) => {
      const id = msg && (typeof msg.id === 'number' || typeof msg.id === 'string') ? msg.id : null;
      inflight++;
      fallback.pause();
      let reply;
      try {
        // the handler logs the call; with overLimit it must refuse without sending
        const overLimit = ++sendCount > SEND_MAX;
        if (!onSendRequest) reply = { error: 'pm.sendRequest is not available here.' };
        else reply = await onSendRequest(msg && msg.spec, { waitForUser, overLimit, runSignal: runCtrl.signal });
      } catch (e) { reply = { error: `pm.sendRequest failed: ${e.message}` }; }
      inflight--;
      if (done) return;
      if (!inflight) fallback.run();
      frame.contentWindow.postMessage({ sendResult: { id, error: reply.error ? String(reply.error) : '', response: reply.error ? null : reply.response } }, '*');
    };
    const finish = (data) => {
      if (done) return;
      done = true;
      fallback.stop();
      hardCap.stop();
      runCtrl.abort();
      window.removeEventListener('message', onMsg);
      try { frame.contentWindow.postMessage({ kill: true }, '*'); } catch { /* already gone */ }
      frame.remove();
      if (!data || data.fatal) {
        resolve({ vars: ctx.vars, request: ctx.request, tests: [], logs: [], error: (data && String(data.fatal)) || 'Script sandbox failed.' });
        return;
      }
      const vars = data.vars || {};
      const rq = data.request && typeof data.request === 'object' ? data.request : ctx.request;
      resolve({
        // iteration data comes from the app (the user's data file), never back from the script
        vars: { globals: cleanStrMap(vars.globals), collection: cleanStrMap(vars.collection), environment: cleanStrMap(vars.environment), local: cleanStrMap(vars.local), data: cleanStrMap(ctx.vars.data) },
        request: {
          method: METHODS.includes(String(rq.method).toUpperCase()) ? String(rq.method).toUpperCase() : ctx.request.method,
          url: String(rq.url ?? ctx.request.url),
          headers: (Array.isArray(rq.headers) ? rq.headers : []).filter((p) => Array.isArray(p) && p.length === 2).map(([k, v]) => [String(k), String(v)]),
          body: ctx.request.body,
        },
        tests: (Array.isArray(data.tests) ? data.tests : []).slice(0, 1000).map((t) => ({
          name: String(t && t.name || 'Unnamed test').slice(0, 500), passed: t && t.passed === null ? null : !!(t && t.passed), error: String(t && t.error || '').slice(0, 2000),
        })),
        logs: (Array.isArray(data.logs) ? data.logs : []).slice(0, 500).map((l) => ({
          level: ['log', 'info', 'warn', 'error', 'debug'].includes(l && l.level) ? l.level : 'log', text: String(l && l.text || ''),
        })),
        error: String(data.error || ''),
        next: data.next && typeof data.next === 'object' ? { to: data.next.to == null ? null : String(data.next.to).slice(0, 500) } : null,
        skip: data.skip === true,
      });
    };
    const onMsg = (e) => {
      if (e.source !== frame.contentWindow || done) return;
      if (e.data && typeof e.data === 'object' && e.data.sendRequest) onSend(e.data.sendRequest); // a request, not the result
      else finish(e.data);
    };
    window.addEventListener('message', onMsg);
    frame.addEventListener('load', () => frame.contentWindow.postMessage({ workerSrc: PM_WORKER, code, ctx, timeoutMs: SCRIPT_TIMEOUT_MS }, '*'));
    fallback.run();
    hardCap.run();
    document.body.append(frame);
  });
}

// =====================================================================================================
// Executing a request: scripts -> variables -> auth -> body -> send -> tests -> persist
// =====================================================================================================
function effectiveAuth(ed, cid, itemId) {
  if (ed.auth.type !== 'inherit') return { auth: ed.auth, from: 'this request' };
  const col = cid && state.cols[cid];
  const loc = col && itemId ? locate(col, itemId) : null;
  for (const f of [...(loc ? loc.parents : [])].reverse()) {
    if (f.auth) return { auth: authIn(f.auth), from: `folder "${f.name}"` };
  }
  if (col && col.auth) return { auth: authIn(col.auth), from: 'the collection' };
  return { auth: { type: 'noauth' }, from: col ? 'the collection (no auth set)' : null };
}

function scriptChain(cid, itemId, ed, listen) {
  const col = cid && state.cols[cid];
  const loc = col && itemId ? locate(col, itemId) : null;
  const out = [];
  if (col) out.push({ src: 'collection', code: scriptIn(col.event, listen) });
  for (const f of loc ? loc.parents : []) out.push({ src: `folder ${f.name}`, code: scriptIn(f.event, listen) });
  out.push({ src: 'request', code: listen === 'prerequest' ? ed.pre : ed.test });
  return out.filter((s) => s.code.trim());
}

const CT_BY_LANG = { json: 'application/json', text: 'text/plain', xml: 'application/xml', html: 'text/html', javascript: 'application/javascript' };

/** Builds the exact request to send. Returns { wire } or { error }. */
function buildWire(ed, req, vars, authInfo) {
  const r = (s) => resolve(s, vars);
  let url = r(applyPathVars(req.url, ed.pathVars, r)).trim();
  if (url && !/^[a-z][\w+.-]*:\/\//i.test(url)) url = 'http://' + url;
  const headers = req.headers.map(([k, v]) => [r(k).trim(), r(v)]).filter(([k]) => k)
    // only one Host header may exist (the last wins, as on the wire), so checks and sending agree
    .filter(([k], i, all) => k.toLowerCase() !== 'host' || all.slice(i + 1).every(([k2]) => k2.trim().toLowerCase() !== 'host'));
  const has = (n) => headers.some(([k]) => k.toLowerCase() === n);
  const checks = [url, ...headers.flat()];
  const shown = { url, headers: headers.map((p) => [...p]) }; // what test scripts see: resolved, without auth
  const auth = authInfo.auth;

  if (auth.type === 'bearer' && auth.token && !has('authorization')) { headers.push(['Authorization', 'Bearer ' + r(auth.token)]); checks.push(auth.token); }
  if (auth.type === 'basic' && (auth.username || auth.password) && !has('authorization')) {
    headers.push(['Authorization', 'Basic ' + utf8b64(`${r(auth.username)}:${r(auth.password)}`)]);
    checks.push(auth.username, auth.password);
  }
  if (auth.type === 'oauth2' && auth._token && !has('authorization')) {
    const prefix = String(auth.headerPrefix ?? 'Bearer').trim();
    headers.push(['Authorization', (prefix ? prefix + ' ' : '') + auth._token.accessToken]);
  }
  if (auth.type === 'apikey' && auth.key) {
    if (auth.in === 'query') {
      try { const u = new URL(url); u.searchParams.append(r(auth.key), r(auth.value)); url = u.toString(); } catch { /* reported below */ }
    } else if (!has(r(auth.key).toLowerCase())) headers.push([r(auth.key), r(auth.value)]);
    checks.push(auth.key, auth.value);
  }

  const b = ed.body;
  let body = { kind: 'none' };
  const setCT = (ct) => { if (!has('content-type')) { headers.push(['Content-Type', ct]); shown.headers.push(['Content-Type', ct]); } };
  if (b.mode === 'raw') {
    body = { kind: 'text', text: r(b.raw) };
    checks.push(b.raw);
    setCT(CT_BY_LANG[b.lang] || 'text/plain');
  } else if (b.mode === 'urlencoded') {
    const rows = b.urlencoded.filter((x) => !x.disabled && x.key);
    body = { kind: 'text', text: new URLSearchParams(rows.map((x) => [r(x.key), r(x.value)])).toString() };
    checks.push(...rows.flatMap((x) => [x.key, x.value]));
    setCT('application/x-www-form-urlencoded');
  } else if (b.mode === 'formdata') {
    const rows = b.formdata.filter((x) => !x.disabled && x.key);
    const missing = rows.filter((x) => x.type === 'file' && !x.file);
    if (missing.length) return { error: `Choose a file for form field "${missing[0].key}" (files aren't stored in collections, so pick it again after reloading).` };
    body = { kind: 'formdata', fields: rows.map((x) => (x.type === 'file' ? { key: r(x.key), file: x.file } : { key: r(x.key), value: r(x.value) })) };
    checks.push(...rows.filter((x) => x.type !== 'file').flatMap((x) => [x.key, x.value]));
  } else if (b.mode === 'file') {
    if (!b.fileObj) return { error: 'Choose a file to send as the binary body.' };
    body = { kind: 'file', file: b.fileObj };
    setCT(b.fileObj.type || 'application/octet-stream');
  } else if (b.mode === 'graphql') {
    let variables = {};
    const vtext = r(b.gqlVars).trim();
    if (vtext) { try { variables = JSON.parse(vtext); } catch (e) { return { error: `GraphQL variables aren't valid JSON: ${e.message}` }; } }
    body = { kind: 'text', text: JSON.stringify({ query: r(b.gqlQuery), variables }) };
    checks.push(b.gqlQuery);
    setCT('application/json');
  }

  if (!url) return { error: 'Enter a URL.' };
  if (!/^[A-Z]{1,16}$/.test(req.method)) return { error: `"${req.method}" isn't a valid HTTP method.` };
  const missingVars = unresolved(checks.map(r));
  if (missingVars.length) return { error: missingVarMessage(missingVars, vars) };
  try { new URL(url); } catch { return { error: `"${url}" isn't a valid URL.` }; }
  return { wire: { method: req.method, url, headers, body }, shown };
}

function requestSnapshot(ed) {
  return {
    method: ed.method,
    url: ed.url,
    headers: ed.headers.filter((x) => !x.disabled && x.key).map((x) => [x.key, x.value]),
    body: ed.body.mode === 'raw' ? ed.body.raw : null,
  };
}

/** Write script-made variable changes back to the environment / collection / globals. */
async function persistScopes(cid, before, after, logs, envId = state.activeEnv) {
  const sync = (values, b, a, mk) => {
    let changed = false;
    for (const [k, v] of Object.entries(a)) {
      if (b[k] === v) continue;
      const entry = values.find((x) => x.key === k);
      if (entry) { entry.value = v; if ('enabled' in entry) entry.enabled = true; delete entry.disabled; } else values.push(mk(k, v));
      changed = true;
    }
    for (const k of Object.keys(b)) {
      if (!Object.hasOwn(a, k)) { const i = values.findIndex((x) => x.key === k); if (i !== -1) { values.splice(i, 1); changed = true; } }
    }
    return changed;
  };
  const envMk = (key, value) => ({ key, value, type: 'default', enabled: true });

  if (envId && state.envs[envId]) {
    await mutateDoc('environments', envId, (doc) => sync(doc.values, before.environment, after.environment, envMk));
  } else if (JSON.stringify(before.environment) !== JSON.stringify(after.environment)) {
    logs.push({ level: 'warn', text: 'pm.environment changes were ignored because no environment is selected.', src: 'ApiMan' });
  }
  if (JSON.stringify(before.globals) !== JSON.stringify(after.globals)) {
    await ensureGlobals();
    await mutateDoc('environments', GLOBALS_ID, (doc) => sync(doc.values, before.globals, after.globals, envMk));
  }
  const col = cid && state.cols[cid];
  if (col) {
    await mutateDoc('collections', cid, (doc) => { doc.variable = doc.variable || []; return sync(doc.variable, before.collection, after.collection, (key, value) => ({ key, value })); });
  } else if (JSON.stringify(before.collection) !== JSON.stringify(after.collection)) {
    logs.push({ level: 'warn', text: 'pm.collectionVariables changes were ignored: save this request into a collection first.', src: 'ApiMan' });
  }
}

/**
 * Runs the whole pipeline for an editor model. Used by Send and by the collection runner.
 * Returns { res, wire, tests, logs, warnings, error }.
 */
function originOf(url) {
  const u = String(url || '').trim();
  try { return new URL(/^[a-z][\w+.-]*:\/\//i.test(u) ? u : `http://${u}`).origin; } catch { return null; }
}
const approvedOrigins = new Set(); // "itemKey -> origin" pairs the user allowed this session

// =====================================================================================================
// pm.sendRequest, performed here in the app window on a script's behalf (the sandbox has no network).
//   - destination: the origin of the request being run or of any saved request in its collection, resolved
//     with the saved (trusted) variables; anything else is asked once per origin per collection (Send) or
//     refused (Runner, CLI: no one to ask). A Host header counts as a destination too.
//   - only what the script set is sent: no auth, cookies or variables are added; redirects aren't followed
//   - at most SEND_MAX calls per script run, SEND_TIMEOUT_MS each; every call is logged in the Console
// =====================================================================================================
const sendApprovals = new Set(); // "collection -> origin" pairs the user allowed for pm.sendRequest this session
let sendAskChain = Promise.resolve(); // one question at a time, so a second call can reuse the first answer

/** Origins a collection's own requests use, resolved with the saved variables. */
async function collectionOrigins(cid, trusted) {
  const out = new Set();
  const col = cid && (state.cols[cid] || await withCol(cid).catch(() => null));
  if (col) eachRequest(col.item || [], (it) => { const o = originOf(resolve(urlIn(it.request && typeof it.request === 'object' ? it.request.url : it.request).raw, trusted)); if (o) out.add(o); });
  return out;
}

const SEND_TOKEN = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/; // a valid header name
async function scriptSendRequest(spec, { overLimit, waitForUser, runSignal }, c) {
  // c: { scope (approval key), allowed() -> Set of origins, ask, signal, log(entry), src }; runSignal aborts when the script ends
  const s = spec && typeof spec === 'object' ? spec : {};
  const method = String(s.method ?? 'GET').toUpperCase().slice(0, 20);
  let url = String(s.url ?? '').trim();
  if (url && !/^[a-z][\w+.-]*:\/\//i.test(url)) url = 'http://' + url;
  const label = `${method} ${url || '(no URL)'}`;
  const started = performance.now();
  // logged when the call starts (so the Console keeps calls in order, and shows ones the script didn't wait for), filled in at the end
  const entry = { level: 'warn', text: `${label} → no reply: the script ended first`, src: c.src };
  c.log(entry);
  const fail = (msg, level = 'error', what = 'not sent') => {
    if (!(runSignal && runSignal.aborted)) Object.assign(entry, { level, text: `${label} → ${what}: ${msg}` }); // else: "the script ended first"
    return { error: `pm.sendRequest: ${msg}` };
  };
  const ended = () => (c.signal && c.signal.aborted) || (runSignal && runSignal.aborted);

  if (overLimit) return fail(`a script can make at most ${SEND_MAX} requests per run.`);
  if (!/^[A-Z]{1,16}$/.test(method)) return fail(`"${method}" isn't a valid HTTP method.`);
  if (url.length > 16000) return fail('the URL is too long.');
  let target;
  try { target = new URL(url); } catch { return fail(`"${url}" isn't a valid URL.`); }
  if (!['http:', 'https:'].includes(target.protocol)) return fail(`only http:// and https:// URLs can be requested, not ${target.protocol}//.`);
  const rawHeaders = Array.isArray(s.headers) ? s.headers : [];
  if (rawHeaders.length > 100) return fail('too many headers.');
  const headers = rawHeaders.filter((p) => Array.isArray(p) && p.length === 2).map(([k, v]) => [String(k).trim(), String(v)]).filter(([k]) => k);
  const badName = headers.find(([k, v]) => !SEND_TOKEN.test(k) || /[\r\n\0]/.test(v) || v.length > 16000);
  if (badName) return fail(`invalid header "${badName[0].slice(0, 100)}".`);
  const body = s.body == null ? null : String(s.body);
  if (body && body.length > 10 * 1024 * 1024) return fail('the body is larger than 10 MB.');
  const missing = unresolved([url, ...headers.flat(), body || '']);
  if (missing.length) return fail(`unknown variable${missing.length > 1 ? 's' : ''} ${missing.map((v) => `{{${v}}}`).join(', ')}.`);

  // Destination: the URL's origin, and the site a Host header would pick on a shared server.
  const hostHeader = ((headers.filter(([k]) => k.toLowerCase() === 'host').pop() || [])[1] || '').trim();
  const hostOrigin = hostHeader ? originOf(`${target.protocol}//${hostHeader}`) : null;
  if (hostHeader && !hostOrigin) return fail(`invalid Host header "${hostHeader.slice(0, 200)}".`);
  const allowed = await c.allowed();
  for (const origin of new Set([target.origin, hostOrigin].filter(Boolean))) {
    const key = `${c.scope} -> ${origin}`;
    if (allowed.has(origin) || sendApprovals.has(key)) continue;
    if (!c.ask) {
      return fail(`${origin} isn't a server this collection's requests use, so a script can't send to it during a run. Send the request on its own to approve it.`, 'warn');
    }
    const shown = `${method} ${target.href}${hostOrigin && hostOrigin !== target.origin ? `\n  Host: ${hostHeader}` : ''}`;
    const ok = await waitForUser(() => {
      const turn = sendAskChain.then(() => sendApprovals.has(key) || c.ask(
        `A script wants to send a request to a server that this collection's requests don't use:\n\n  ${shown}\n\n`
        + `It goes without your auth or cookies, with ${headers.length ? `only the headers the script set (${headers.map(([k]) => k).join(', ')})` : 'no headers'}`
        + `${body ? ` and a ${fmtSize(new Blob([body]).size)} body` : ''}. Allow scripts in this collection to send requests to ${origin} until you close ApiMan? `
        + 'Only allow this if you trust the scripts in this collection.', 'Allow a script to send a request?'));
      sendAskChain = turn.catch(() => {});
      return turn;
    });
    if (!ok) return fail(`you declined requests to ${origin}.`, 'warn');
    sendApprovals.add(key);
  }
  if (ended()) return fail('the request or the script was stopped.');

  if (target.protocol === 'http:' && !isLocalHost(target.hostname)) {
    c.log({ level: 'warn', text: `pm.sendRequest to ${target.host} uses plain HTTP, so anyone on the network path can read it. Prefer https://.`, src: c.src });
  }
  const ctrl = new AbortController();
  let timedOut = false;
  const tm = setTimeout(() => { timedOut = true; ctrl.abort(); }, SEND_TIMEOUT_MS);
  const onAbort = () => ctrl.abort();
  for (const sig of [c.signal, runSignal]) if (sig) sig.addEventListener('abort', onAbort);
  let res;
  try {
    // exactly what the script described: no auth, cookies or other headers are added
    res = await backend.send({ method, url: target.href, headers, body: body === null ? { kind: 'none' } : { kind: 'text', text: body }, followRedirects: false }, ctrl.signal);
  } catch (e) {
    res = { error: timedOut ? `no response within ${SEND_TIMEOUT_MS / 1000} s.` : ctrl.signal.aborted ? 'the request or the script was stopped.' : e.message };
  } finally {
    clearTimeout(tm);
    for (const sig of [c.signal, runSignal]) if (sig) sig.removeEventListener('abort', onAbort);
  }
  if (!res || res.error) return fail(String((res && res.error) || 'no response.'), 'error', 'failed');
  const ms = res.timeMs ?? Math.round(performance.now() - started);
  Object.assign(entry, { level: 'info', text: `${method} ${target.href} → ${res.status} ${res.reason || ''} · ${fmtMs(ms)}`.replace(/ +·/, ' ·') });
  const text = res.binary ? '' : String(res.body ?? '');
  return { response: { code: res.status, status: res.reason || '', headers: (res.headers || []).slice(0, 500), body: text.slice(0, 10 * 1024 * 1024), responseTime: ms, size: res.size } };
}

/**
 * Names of every variable that can influence a request URL: placeholders in the URLs of all saved
 * requests (every collection) and all open tabs, expanded through variable values that themselves
 * contain placeholders ({{baseUrl}} = "{{scheme}}://{{host}}"), across every environment, every
 * collection's variables and globals. Shadowing doesn't matter: a value that is overridden today
 * takes effect the moment you switch environment. `complete` is false if a collection couldn't be read.
 */
async function urlVariableNames(extraPairs = []) {
  let complete = true;
  const urls = []; // { label, url, colId }
  const hostHeaders = []; // Host header values also decide where a request lands on shared servers
  const headerOnly = []; // the header/auth part of hostHeaders (path-variable values are URL-encoded into the path)
  // A variable used in any header name or value (or API-key auth) could later become "Host: attacker", so all are guarded.
  const headerParts = (headers) => (Array.isArray(headers) ? headers : []).filter((x) => x && typeof x === 'object').flatMap((x) => [String(x.key ?? ''), String(x.value ?? '')]);
  const authParts = (auth) => { const a = authIn(auth); return a.type === 'apikey' ? [a.key, a.value] : []; };
  for (const c of state.colList) {
    try {
      const col = await withCol(c.id);
      eachRequest(col.item, (it) => {
        const rq = it.request && typeof it.request === 'object' ? it.request : {};
        urls.push({ label: `${c.name} / ${String(it.name ?? '') || 'Untitled'}`, url: urlIn(rq.url).raw, colId: c.id });
        hostHeaders.push(...urlIn(rq.url).pathVars.map((v) => v.value)); // path-variable values can rewrite the URL too
        hostHeaders.push(...headerParts(rq.header), ...authParts(rq.auth));
        headerOnly.push(...headerParts(rq.header), ...authParts(rq.auth));
      }, [], (parents) => parents.forEach((f) => { hostHeaders.push(...authParts(f.auth)); headerOnly.push(...authParts(f.auth)); }));
      hostHeaders.push(...authParts(col.auth));
      headerOnly.push(...authParts(col.auth));
    } catch (e) {
      if (!/Not a Postman v2 collection/.test(e.message)) complete = false; // a stray non-collection .json isn't a gap
    }
  }
  for (const t of state.tabs) {
    urls.push({ label: `${t.ed.name} (open tab)`, url: t.ed.url, colId: t.cid });
    hostHeaders.push(...(t.ed.pathVars || []).map((v) => v.value));
    hostHeaders.push(...t.ed.headers.flatMap((x) => [x.key, x.value]), ...authParts(authOut(t.ed.auth)));
    headerOnly.push(...t.ed.headers.flatMap((x) => [x.key, x.value]), ...authParts(authOut(t.ed.auth)));
  }
  const names = new Set();
  const add = (s) => { for (const m of String(s ?? '').matchAll(VAR_RE)) names.add(m[1]); };
  urls.forEach((u) => add(u.url));
  hostHeaders.forEach(add);
  // A computed name like {{base_{{stage}}}} can't be resolved statically: then every change counts as risky.
  const nested = /{{[^{}]*{{/;
  if ([...urls.map((u) => u.url), ...hostHeaders].some((x) => nested.test(String(x)))) complete = false;
  const pairs = [
    ...Object.values(state.envs).flatMap((d) => (d && d.values) || []),
    ...Object.values(state.cols).flatMap((c) => (c && c.variable) || []),
    ...extraPairs, // values a script just wrote: they may reference further variables
  ];
  const expand = (set, addTo) => {
    for (let grew = true; grew;) {
      const n = set.size;
      for (const p of pairs) if (p && set.has(p.key)) addTo(p.value);
      grew = set.size > n;
    }
  };
  expand(names, add);
  const headerNames = new Set();
  const addH = (x) => { for (const m of String(x ?? '').matchAll(VAR_RE)) headerNames.add(m[1]); };
  headerOnly.forEach(addH);
  expand(headerNames, addH);
  return { names, complete, urls, headerNames };
}

/**
 * Could variable k send any known request to a different server? It's replaced by a hostile value in every URL,
 * under the run's current values and under every environment: a variable that only ever lands in a path or query
 * (/orders/{{id}}) can't move the origin whatever its value, one in the scheme, host or port always does.
 */
const ORIGIN_CANARY = 'x@evil.invalid:1/#?';
function canMoveOrigin(k, urls, runScopes, cid) {
  const envs = [null, ...Object.entries(state.envs).filter(([id]) => id !== GLOBALS_ID).map(([, d]) => d)];
  for (const u of urls) {
    const col = u.colId === cid ? runScopes.collection : colObj(state.cols[u.colId]);
    const variants = [merged({ ...runScopes, collection: col, local: {} }),
      ...envs.map((d) => merged({ globals: runScopes.globals, collection: col, environment: d ? envObj(d) : {}, local: {} }))];
    for (const vars of variants) {
      if (originOf(resolve(u.url, vars)) !== originOf(resolve(u.url, { ...vars, [k]: ORIGIN_CANARY }))) return true;
    }
  }
  return false;
}

/**
 * Scripts can't make network calls, but they can change (or delete) variables, and variables decide
 * where requests go. Any script change to a variable that can influence a request URL (see above)
 * needs the user's approval; in the runner (no one to ask) all of the script's variable changes are
 * dropped. So the saved variables only ever hold destinations the user approved, which makes them a
 * trusted baseline for the per-request check in execute().
 */
async function guardVarChanges(cid, ed, before, after, ask, logs) {
  const changed = [];
  for (const scope of ['environment', 'collection', 'globals']) {
    const b = before[scope], a = after[scope];
    for (const k of new Set([...Object.keys(b), ...Object.keys(a)])) {
      if (b[k] === a[k]) continue;
      changed.push({ scope, k, removed: !(k in a), value: a[k] });
      logs.push({ level: 'info', text: `Script ${k in a ? 'set' : 'removed'} ${scope} variable "${k}"`, src: 'ApiMan' });
    }
  }
  if (!changed.length) return after;

  const written = ['environment', 'collection', 'globals'].flatMap((sc) => Object.entries(after[sc]).map(([key, value]) => ({ key, value })));
  const { names, complete, urls } = await urlVariableNames(written);
  const risky = changed.filter((c) => names.has(c.k));
  if (!risky.length && complete) return after;

  // The prompt shows FULL values (never truncated: "...", or a long prefix, could hide the real host)
  // and the resulting destination of each affected request with the current environment.
  const varsFor = (sc, colId) => merged({ globals: sc.globals, environment: sc.environment, local: {},
    collection: colId === cid ? sc.collection : colObj(state.cols[colId]) });
  const moves = [];
  for (const u of urls) {
    const from = originOf(resolve(u.url, varsFor(before, u.colId)));
    const to = originOf(resolve(u.url, varsFor(after, u.colId)));
    if (from !== to) moves.push(`  ${u.label}:\n    ${from || '(unresolved)'}  →  ${to || '(unresolved)'}`);
  }
  const list = risky.map((c) => `  ${c.scope}.${c.k} ${c.removed ? '(removed)' : `= ${c.value}`}`).join('\n')
    || '  (some collections could not be read, so ApiMan cannot check them)';
  const where = moves.length
    ? `\n\nWith the current environment, requests would now go to:\n${moves.slice(0, 8).join('\n')}${moves.length > 8 ? `\n  …and ${moves.length - 8} more` : ''}`
    : '\n\nNo request changes destination with the current environment, but these variables are used in request URLs and would apply when you switch environments.';
  const ok = ask ? await ask(`A script changed variables that decide where requests are sent:\n\n${list}${where}\n\nSave the changes? Only allow this if you trust the scripts in this collection.`) : false;
  if (ok) return after;
  logs.push({ level: 'warn', text: `Not saved: the script changed variables used in request URLs (${risky.map((c) => `${c.scope}.${c.k}`).join(', ') || 'unverifiable'})${ask ? '' : '. Send the request on its own to approve them'}.`, src: 'ApiMan' });
  return JSON.parse(JSON.stringify(before));
}

/**
 * Runs the whole pipeline for an editor model. Used by Send (ask = confirm dialog) and by the
 * collection runner (ask = null: anything that needs approval is blocked).
 */
async function execute({ ed, cid, itemId, iteration = 0, iterationCount = 1, iterationData = null, inRun = false, signal, persist = true, ask = null, runScopes = null, envId = state.activeEnv }) {
  // envId: the environment active when the request started (variable changes go there), or the one a Diff compares with
  // iterationData: this iteration's row of the Runner's data file, or Automation's test-data row for this case
  // (the user chose it, so it counts as saved values); scripts read it as pm.iterationData
  const logs = [], tests = [], warnings = [];
  const dataVars = dataRowVars(iterationData);
  const before = runScopes ? JSON.parse(JSON.stringify(runScopes)) : scopesFor(cid, envId);
  delete before.data;
  let scopes = JSON.parse(JSON.stringify(before));
  scopes.local = {};
  scopes.data = dataVars;
  let req = requestSnapshot(ed);
  // The destination baseline always comes from the SAVED (user-approved) variables and the user's data file,
  // never from values scripts carried over in memory during a run.
  const trusted = merged({ ...scopesFor(cid, envId), data: dataVars });
  const plannedOrigin = originOf(resolve(ed.url, trusted));
  const preScripts = scriptChain(cid, itemId, ed, 'prerequest');
  const info = { requestName: ed.name, requestId: itemId || '', iteration, iterationCount, eventName: 'prerequest' };
  let next = null; // pm.execution.setNextRequest: the last call wins
  const noteNext = (out, src) => {
    if (!out.next) return;
    next = out.next;
    if (!inRun) logs.push({ level: 'info', text: `pm.execution.setNextRequest(${next.to === null ? 'null' : JSON.stringify(next.to)}) only applies in the Runner, so it was ignored.`, src });
  };
  const envName = envId && state.envs[envId] ? state.envs[envId].name : '';
  if (!itemId && !ed._approvalId) ed._approvalId = uid();
  // pm.sendRequest: allowed destinations come from the saved variables, like plannedOrigin
  let allowedP = null;
  const allowed = () => (allowedP ||= collectionOrigins(cid, trusted).then((set) => (plannedOrigin && set.add(plannedOrigin), set)));
  const runWithSend = async (code, ctx, src) => {
    const sent = [];
    const out = await runScript(code, ctx, {
      onSendRequest: (spec, opts) => scriptSendRequest(spec, opts, {
        scope: cid || `scratch:${itemId || ed._approvalId}`, allowed, ask, signal, log: (l) => sent.push(l), src: `pm.sendRequest (${src})`,
      }),
    });
    return { ...out, sent };
  };

  let skip = false;
  for (const s of preScripts) {
    const out = await runWithSend(s.code, { vars: scopes, request: req, response: null, info, envName, iterationData }, `pre-request ${s.src}`);
    scopes = out.vars;
    req = out.request;
    logs.push(...out.logs.map((l) => ({ ...l, src: `pre-request (${s.src})` })), ...out.sent);
    tests.push(...out.tests);
    noteNext(out, `pre-request (${s.src})`);
    if (out.error) {
      logs.push({ level: 'error', text: out.error, src: `pre-request (${s.src})` });
      return { error: `Pre-request script (${s.src}) failed: ${out.error.replace(/\.$/, '')}. The request was not sent.`, logs, tests, warnings };
    }
    if (out.skip) { skip = true; break; } // later pre-request scripts don't run either
  }
  if (signal && signal.aborted) return { error: 'Request cancelled.', logs, tests, warnings };
  if (skip) {
    logs.push({ level: 'info', text: 'Skipped: a pre-request script called pm.execution.skipRequest(), so the request was not sent.', src: 'ApiMan' });
    if (persist) {
      try {
        scopes = await guardVarChanges(cid, ed, before, scopes, ask, logs);
        await persistScopes(cid, before, scopes, logs, envId);
      } catch (e) { logs.push({ level: 'error', text: `Couldn't save variable changes: ${e.message}`, src: 'ApiMan' }); }
    }
    // in the Runner a skip is not a failure; a single Send shows it like a request that wasn't sent
    return { skipped: true, error: inRun ? '' : 'Skipped: a pre-request script called pm.execution.skipRequest(), so the request was not sent.', logs, tests, warnings, scopes, next: inRun ? next : null };
  }

  const vars = merged(scopes);
  let authInfo = effectiveAuth(ed, cid, itemId);
  if (authInfo.auth.type === 'oauth2') {
    // resolved with the saved variables (trusted), never script-set ones: a script can't send the client secret elsewhere
    try { authInfo = { ...authInfo, auth: { ...authInfo.auth, _token: await oauthToken(authInfo.auth, trusted, { interactive: !!ask }) } }; }
    catch (e) { return { error: `OAuth 2.0: ${e.message}`, logs, tests, warnings }; }
  }
  const built = buildWire(ed, req, vars, authInfo);
  if (built.error) return { error: built.error, logs, tests, warnings };
  const wire = built.wire;

  // A pre-request script may not silently send this request (and its auth) to a different server.
  const finalOrigin = originOf(wire.url);
  const approvalKey = `${cid || 'scratch'}:${itemId || ed._approvalId} -> ${finalOrigin}`;
  const hostOf = (hs) => ((hs.filter(([k]) => k.toLowerCase() === 'host').pop() || [])[1] || '').trim().toLowerCase(); // the server sends the last one
  const plannedHost = hostOf(requestSnapshot(ed).headers.map(([k, v]) => [k, resolve(v, trusted)]));
  const finalHost = hostOf(wire.headers);
  const hostChanged = finalHost !== plannedHost; // shared servers route by Host
  if ((finalOrigin !== plannedOrigin || hostChanged) && !approvedOrigins.has(`${approvalKey} host=${finalHost}`)) {
    const msg = hostChanged && finalOrigin === plannedOrigin
      ? `A script set the Host header to "${finalHost}". Shared servers use it to decide which site receives the request, so this can send your auth headers to a different site.\n\nSend it anyway? Only allow this if you trust the scripts in this collection.`
      : `A script changed where this request goes:\n\n  from ${plannedOrigin || '(unresolved URL)'}\n  to   ${finalOrigin}${finalHost ? ` (Host: ${finalHost})` : ''}\n\nSend it there, including your auth headers? Only allow this if you trust the scripts in this collection.`;
    if (!(ask && await ask(msg))) {
      logs.push({ level: 'warn', text: `Blocked: a script redirected the request to ${finalOrigin}.`, src: 'ApiMan' });
      return { error: `Not sent: a pre-request script changed the destination to ${finalOrigin}${ask ? '' : '. Send this request on its own to approve it'}.`, logs, tests, warnings };
    }
    approvedOrigins.add(`${approvalKey} host=${finalHost}`);
  }

  const target = new URL(wire.url);
  const sendsSecret = wire.headers.some(([k]) => /^(authorization|cookie|x-api-key)$/i.test(k)) || authInfo.auth.type === 'apikey';
  if (target.protocol === 'http:' && !isLocalHost(target.hostname) && sendsSecret) {
    warnings.push('Credentials were sent over plain HTTP, so anyone on the network path can read them. Prefer https://.');
  }

  let res;
  try {
    res = await backend.send(wire, signal);
  } catch (e) {
    res = { error: backend.mode === 'local' && e.name === 'TypeError' ? `ApiMan's local server isn't reachable. Is "python3 server.py" still running? (${e.message})` : e.message };
  }
  if (signal && signal.aborted) return { error: 'Request cancelled.', logs, tests, warnings, wire };
  if (res.redirectStripped && res.redirectStripped.length) {
    warnings.push(`Redirected to another site, so these headers were removed to protect your credentials: ${res.redirectStripped.join(', ')}.`);
  }
  for (const n of res.notes || []) warnings.push(n);
  if (res.redirectLimitHit) warnings.push(`Stopped after ${res.redirectLimit} redirects: the server kept redirecting. This is its last answer; raise the limit in Settings → Requests if the chain is expected.`);
  if (res.decodeNote) warnings.push(res.decodeNote);
  if (res.redirectBodyRefused) warnings.push(`Not followed: the server redirected (${res.status}) to another site, ${res.redirectBodyRefused}, which would have received this request's body. Send it there yourself if you trust it.`);

  if (!res.error) {
    info.eventName = 'test';
    const response = { code: res.status, status: res.reason || '', headers: res.headers || [], body: res.body ?? '', responseTime: res.timeMs, size: res.size };
    // pm.cookies: the jar's cookies for this URL (local), or what the response set (browser mode)
    const cookies = res.cookies || parseCookies(res.headers || []).map((c) => ({ name: c.name, value: c.value, domain: c.domain || '', path: c.path || '' }));
    // Test scripts see the request that went out (variables and path variables resolved), like Postman,
    // but not the auth ApiMan added to it.
    const sentReq = { method: wire.method, url: built.shown.url, headers: built.shown.headers, body: wire.body.kind === 'text' ? wire.body.text : req.body };
    for (const s of scriptChain(cid, itemId, ed, 'test')) {
      const out = await runWithSend(s.code, { vars: scopes, request: sentReq, response, info, envName, iterationData, cookies }, `tests ${s.src}`);
      scopes = out.vars;
      logs.push(...out.logs.map((l) => ({ ...l, src: `tests (${s.src})` })), ...out.sent);
      noteNext(out, `tests (${s.src})`);
      tests.push(...out.tests);
      if (out.error) {
        logs.push({ level: 'error', text: out.error, src: `tests (${s.src})` });
        tests.push({ name: `Test script (${s.src}) crashed`, passed: false, error: out.error });
      }
    }
  }
  if (persist) {
    try {
      scopes = await guardVarChanges(cid, ed, before, scopes, ask, logs);
      await persistScopes(cid, before, scopes, logs, envId);
    } catch (e) { logs.push({ level: 'error', text: `Couldn't save variable changes: ${e.message}`, src: 'ApiMan' }); }
  }
  return { res, wire, tests, logs, warnings, error: res.error || '', scopes, next: inRun ? next : null };
}

// =====================================================================================================
// OAuth 2.0: authorization code (+PKCE), client credentials, password. Tokens are fetched and refreshed
// automatically on Send, live only in this browser tab's session, and are never written to collection files.
// =====================================================================================================
const OAUTH_GRANTS = [['authorization_code', 'Authorization code'], ['client_credentials', 'Client credentials'], ['password', 'Password (legacy)']];
const oauthRedirectUri = () => new URL('oauth-callback.html', location.origin + location.pathname).href; // see oauth-callback.html
const b64url = (bytes) => bufToB64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const randomB64url = (n = 32) => b64url(crypto.getRandomValues(new Uint8Array(n)));

function oauthResolved(auth, vars) {
  const r = (s) => resolve(s ?? '', vars).trim();
  return {
    grant: OAUTH_GRANTS.some(([g]) => g === auth.grant) ? auth.grant : 'authorization_code',
    authUrl: r(auth.authUrl), tokenUrl: r(auth.tokenUrl), clientId: r(auth.clientId), clientSecret: r(auth.clientSecret), scope: r(auth.scope),
    audience: r(auth.audience), username: r(auth.username), password: resolve(auth.password ?? '', vars),
    clientAuth: auth.clientAuth === 'body' ? 'body' : 'header', pkce: auth.pkce !== false, headerPrefix: (auth.headerPrefix ?? 'Bearer').trim(),
  };
}
async function oauthKey(c) {
  const id = JSON.stringify([c.grant, c.tokenUrl, c.clientId, c.scope, c.audience, c.grant === 'password' ? c.username : '']);
  return 'apiman:oauth:' + b64url(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(id)))).slice(0, 24);
}
const oauthMem = new Map();
function oauthLoad(key) {
  if (oauthMem.has(key)) return oauthMem.get(key);
  try { const v = JSON.parse(sessionStorage.getItem(key) || 'null'); if (v) oauthMem.set(key, v); return v; } catch { return null; }
}
function oauthStore(key, tok) {
  if (tok) oauthMem.set(key, tok); else oauthMem.delete(key);
  try { if (tok) sessionStorage.setItem(key, JSON.stringify(tok)); else sessionStorage.removeItem(key); } catch { /* memory only */ }
  window.dispatchEvent(new Event('apiman:oauth')); // open Auth forms refresh their token status
}
const oauthFresh = (tok) => !!tok && !!tok.accessToken && (!tok.expiresAt || tok.expiresAt - Date.now() > 30_000);

async function oauthTokenRequest(c, params) {
  const headers = [['Content-Type', 'application/x-www-form-urlencoded'], ['Accept', 'application/json']];
  const form = new URLSearchParams(params);
  if (c.clientAuth === 'header' && c.clientSecret) headers.push(['Authorization', 'Basic ' + utf8b64(`${encodeURIComponent(c.clientId)}:${encodeURIComponent(c.clientSecret)}`)]);
  else { form.set('client_id', c.clientId); if (c.clientSecret) form.set('client_secret', c.clientSecret); }
  if (c.audience) form.set('audience', c.audience);
  let target;
  try { target = new URL(c.tokenUrl); } catch { throw new Error('Set a valid Token URL in the OAuth 2.0 settings.'); }
  if (target.protocol === 'http:' && !isLocalHost(target.hostname)) throw new Error(`The token URL uses plain HTTP (${target.origin}); OAuth credentials must go over https://.`);
  const res = await backend.send({ method: 'POST', url: target.toString(), headers, body: { kind: 'text', text: form.toString() } });
  if (res.error) throw new Error(`Token request failed: ${res.error}`);
  let data = {};
  try { data = JSON.parse(res.body || '{}'); } catch { data = Object.fromEntries(new URLSearchParams(res.body || '')); } // some providers answer form-encoded
  if (res.status >= 400 || data.error || !data.access_token) {
    const why = data.error ? `${data.error}${data.error_description ? `: ${data.error_description}` : ''}` : `HTTP ${res.status}${res.body ? ` ${String(res.body).slice(0, 200)}` : ''}`;
    throw new Error(`The token endpoint refused: ${why}`);
  }
  const expiresIn = Number(data.expires_in);
  return { accessToken: String(data.access_token), tokenType: String(data.token_type || 'Bearer'), refreshToken: data.refresh_token ? String(data.refresh_token) : '',
    scope: data.scope ? String(data.scope) : c.scope, expiresAt: Number.isFinite(expiresIn) && expiresIn > 0 ? Date.now() + expiresIn * 1000 : 0, obtainedAt: Date.now() };
}

/** Opens the provider's sign-in page in a popup and resolves with the authorization code. */
async function oauthAuthorize(c) {
  let url;
  try { url = new URL(c.authUrl); } catch { throw new Error('Set a valid Auth URL in the OAuth 2.0 settings.'); }
  const st = randomB64url(16);
  const verifier = c.pkce ? randomB64url(48) : '';
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', c.clientId);
  url.searchParams.set('redirect_uri', oauthRedirectUri());
  if (c.scope) url.searchParams.set('scope', c.scope);
  if (c.audience) url.searchParams.set('audience', c.audience);
  url.searchParams.set('state', st);
  if (verifier) {
    url.searchParams.set('code_challenge', b64url(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)))));
    url.searchParams.set('code_challenge_method', 'S256');
  }
  const pending = ls.get('apiman:oauthPending', {});
  for (const [k, v] of Object.entries(pending)) if (Date.now() - v > 15 * 60_000) delete pending[k];
  pending[st] = Date.now();
  ls.set('apiman:oauthPending', pending);
  const shell = window.pywebview && window.pywebview.api; // the desktop app opens a native sign-in window
  localStorage.removeItem('apiman:oauthResult');
  const popup = shell && shell.open_auth ? await shell.open_auth(url.toString()) : window.open(url.toString(), 'apiman-oauth', 'popup,width=520,height=700');
  if (!popup) throw new Error('The sign-in window was blocked. Allow pop-ups for ApiMan and try again.');
  try {
    const msg = await new Promise((resolveMsg, reject) => {
      let bc = null;
      const done = (m) => { if (!m || m.state !== st) return; cleanup(); resolveMsg(m); };
      const onWin = (e) => { if (e.origin === location.origin && e.data && e.data.apimanOAuth) done(e.data.apimanOAuth); };
      const cleanup = () => {
        window.removeEventListener('message', onWin); if (bc) bc.close(); clearTimeout(timer); clearInterval(poll);
        if ($('#dlg').dataset.oauth === st) { delete $('#dlg').dataset.oauth; if ($('#dlg').open) closeDialog(); }
      };
      try { bc = new BroadcastChannel('apiman-oauth'); bc.onmessage = (e) => done(e.data); } catch { /* opener message only */ }
      window.addEventListener('message', onWin);
      // native windows have no opener, and may not share BroadcastChannel: the callback page also leaves it in storage
      const poll = setInterval(() => { const m = ls.get('apiman:oauthResult', null); if (m && m.state === st) { localStorage.removeItem('apiman:oauthResult'); done(m); } }, 400);
      const timer = setTimeout(() => { cleanup(); reject(new Error('Sign-in timed out after 10 minutes.')); }, 10 * 60_000);
      if ($('#dlg').open) { toast(`Finish signing in to ${url.host} in the window that opened.`, 'muted'); return; } // never replace a dialog with unsaved edits
      openDialog({
        title: 'Sign in',
        body: [h('p', { class: 'hint' }, `Finish signing in to ${url.host} in the window that opened. This dialog closes by itself when you're done.`),
          h('p', { class: 'hint' }, 'If the provider says the redirect URI is wrong, register this one for your client: ', h('code', null, oauthRedirectUri()))],
        buttons: [], cancel: 'Cancel',
        onClose: () => { cleanup(); reject(new Error('Sign-in cancelled.')); },
      });
      $('#dlg').dataset.oauth = st;
    });
    if (msg.error) throw new Error(`Sign-in failed: ${msg.error}${msg.errorDescription ? ` (${msg.errorDescription})` : ''}`);
    return { code: msg.code, verifier };
  } finally {
    const p2 = ls.get('apiman:oauthPending', {}); delete p2[st]; ls.set('apiman:oauthPending', p2);
  }
}

/**
 * A usable access token for this auth config: the cached one, a refreshed one, or a new one.
 * interactive=false (Runner, Diff runs) never opens a sign-in window.
 */
async function oauthToken(auth, vars, { interactive = true, force = false } = {}) {
  const c = oauthResolved(auth, vars);
  if (!c.tokenUrl) throw new Error('Set the Token URL in the OAuth 2.0 auth settings.');
  if (!c.clientId) throw new Error('Set the Client ID in the OAuth 2.0 auth settings.');
  const key = await oauthKey(c);
  const have = oauthLoad(key);
  if (!force && oauthFresh(have)) return have;
  let tok = null;
  if (!force && have && have.refreshToken) {
    try { tok = await oauthTokenRequest(c, { grant_type: 'refresh_token', refresh_token: have.refreshToken, ...(c.scope ? { scope: c.scope } : {}) }); } catch { tok = null; }
    if (tok && !tok.refreshToken) tok.refreshToken = have.refreshToken; // providers may keep the old one valid
  }
  if (!tok) {
    if (c.grant === 'client_credentials') tok = await oauthTokenRequest(c, { grant_type: 'client_credentials', ...(c.scope ? { scope: c.scope } : {}) });
    else if (c.grant === 'password') tok = await oauthTokenRequest(c, { grant_type: 'password', username: c.username, password: c.password, ...(c.scope ? { scope: c.scope } : {}) });
    else {
      if (!interactive) throw new Error(have ? 'The OAuth 2.0 token expired and couldn\'t be refreshed. Open the request and click "Get new token".' : 'No OAuth 2.0 token yet. Open the request\'s Auth tab and click "Get new token".');
      const { code, verifier } = await oauthAuthorize(c);
      tok = await oauthTokenRequest(c, { grant_type: 'authorization_code', code, redirect_uri: oauthRedirectUri(), ...(verifier ? { code_verifier: verifier } : {}) });
    }
  }
  oauthStore(key, tok);
  return tok;
}
async function oauthClear(auth, vars) { oauthStore(await oauthKey(oauthResolved(auth, vars)), null); }
async function oauthPeek(auth, vars) { try { return oauthLoad(await oauthKey(oauthResolved(auth, vars))); } catch { return null; } }

/** The OAuth 2.0 part of the auth form. vars() gives the variables to resolve {{…}} with. */
function oauthFields(model, field, onChange, vars) {
  const sel = (label, key, opts, onPick) => ui.field(label, ui.select(opts, { value: model[key] ?? opts[0][0], onChange: (e) => { model[key] = e.target.value; onChange(); if (onPick) onPick(); } }), { narrow: true });
  const box = h('div');
  const status = ui.hint('', { role: 'status', 'aria-live': 'polite' });
  const showStatus = async () => {
    const tok = await oauthPeek(model, vars());
    if (!tok || !tok.accessToken) { status.textContent = model.grant === 'authorization_code' || !model.grant ? 'No token yet: you\'ll sign in on the first send.' : 'No token yet: one is fetched on the first send.'; return; }
    const left = tok.expiresAt ? Math.round((tok.expiresAt - Date.now()) / 60000) : null;
    status.textContent = !oauthFresh(tok) ? (tok.refreshToken ? 'Token expired: it refreshes on the next send.' : 'Token expired: get a new one.')
      : `Token ready${left == null ? '' : `, expires in ${left < 120 ? `${left} min` : `${Math.round(left / 60)} h`}`}.`;
  };
  const onToken = () => { if (box.isConnected) showStatus(); else window.removeEventListener('apiman:oauth', onToken); };
  window.addEventListener('apiman:oauth', onToken);
  const draw = () => {
    const grant = model.grant || 'authorization_code';
    const kids = [sel('Grant type', 'grant', OAUTH_GRANTS, draw)];
    if (grant === 'authorization_code') kids.push(field('Auth URL', 'authUrl', { placeholder: 'https://login.example.com/oauth2/authorize' }));
    kids.push(field('Token URL', 'tokenUrl', { placeholder: 'https://login.example.com/oauth2/token' }));
    kids.push(h('div', { class: 'grid-2' }, field('Client ID', 'clientId', { placeholder: '{{clientId}}' }), field('Client secret', 'clientSecret', { secret: true, placeholder: grant === 'authorization_code' ? 'Optional with PKCE' : '{{clientSecret}}' })));
    if (grant === 'password') kids.push(h('div', { class: 'grid-2' }, field('Username', 'username'), field('Password', 'password', { secret: true })));
    kids.push(h('div', { class: 'grid-2' }, field('Scope', 'scope', { placeholder: 'openid profile api.read' }), field('Audience', 'audience', { placeholder: 'Optional' })));
    kids.push(h('div', { class: 'grid-2' }, sel('Send client credentials', 'clientAuth', [['header', 'As Basic auth header'], ['body', 'In the request body']]),
      field('Header prefix', 'headerPrefix', { placeholder: 'Bearer' })));
    if (grant === 'authorization_code') {
      kids.push(ui.check({ label: 'Use PKCE', help: 'Recommended. Required for clients without a secret.', checked: model.pkce !== false, onChange: (e) => { model.pkce = e.target.checked; onChange(); } }));
      kids.push(ui.field('Callback URL (register it with your provider)', ui.secretField(ui.input({ value: oauthRedirectUri(), readonly: true, spellcheck: 'false' }),
        ui.iconButton('copy', 'Copy the callback URL', () => navigator.clipboard.writeText(oauthRedirectUri()).then(() => toast('Copied'), () => toast('Copying was blocked by the browser.', 'err'))))));
    }
    kids.push(status, ui.actions(
      ui.button({ label: 'Get new token', size: 'small', onClick: async (e) => {
        const btn = e.currentTarget; btn.disabled = true;
        try { await oauthToken(model, vars(), { force: true }); toast('Got a new token'); } catch (err) { toast(err.message, 'err'); } finally { btn.disabled = false; showStatus(); }
      } }),
      ui.button({ label: 'Clear token', size: 'small', onClick: async () => { await oauthClear(model, vars()); showStatus(); toast('Token cleared'); } })));
    kids.push(ui.hint('Tokens stay in this browser tab, never in collection files.'));
    box.replaceChildren(...kids);
    linkLabels(box);
    showStatus();
  };
  draw();
  return box;
}

// =====================================================================================================
// Data loading
// =====================================================================================================
async function loadCol(id) {
  const doc = await backend.collections.get(id);
  KINDS.collections.validate(doc);
  if (ensureIds(doc.item)) await backend.collections.put(id, doc).catch(() => {}); // stable ids keep tabs attached
  state.cols[id] = doc;
  return doc;
}
async function saveCol(id) {
  try {
    await backend.collections.put(id, state.cols[id]);
  } catch (e) {
    if (!e.conflict) throw e;
    await loadCol(id); // show the other window's version; the user's edit stays in its (still unsaved) tab
    renderSidebar();
    throw new Error('This collection was changed in another window, so ApiMan reloaded it. Save again to apply your change on top.');
  }
}
/** Change a stored environment/collection and save it; if another window saved first, reload and re-apply once. */
async function mutateDoc(kind, id, mutate) {
  for (let attempt = 0; attempt < 2; attempt++) {
    const doc = kind === 'environments' ? state.envs[id] : state.cols[id];
    if (!doc || !mutate(doc)) return;
    try { await backend[kind].put(id, doc); return; } catch (e) {
      if (!e.conflict || attempt) throw e;
      const fresh = await backend[kind].get(id);
      if (kind === 'environments') state.envs[id] = fresh; else { ensureIds(fresh.item); state.cols[id] = fresh; }
    }
  }
}

async function refreshCollections() {
  state.colList = await backend.collections.list();
  const ids = new Set(state.colList.map((c) => c.id));
  for (const id of Object.keys(state.cols)) if (!ids.has(id)) delete state.cols[id];
  const want = state.colList.filter((c) => (state.open.has(c.id) || state.filter || state.tabs.some((t) => t.cid === c.id)) && !state.cols[c.id]);
  await Promise.all(want.map((c) => loadCol(c.id).catch(() => {})));
}

async function refreshEnvironments() {
  const all = await backend.environments.list();
  state.envList = all.filter((e) => e.id !== GLOBALS_ID);
  await Promise.all(all.map(async (e) => { try { state.envs[e.id] = await backend.environments.get(e.id); } catch { /* unreadable */ } }));
  if (state.activeEnv && !state.envs[state.activeEnv]) setActiveEnv('');
  let chosenBefore = true;
  try { chosenBefore = localStorage.getItem('apiman:activeEnv') !== null; } catch { /* storage blocked */ }
  if (!chosenBefore && state.envList.length === 1) setActiveEnv(state.envList[0].id);
}

async function ensureGlobals() {
  if (!state.envs[GLOBALS_ID]) {
    if ((await backend.environments.list()).some((e) => e.id === GLOBALS_ID)) {
      throw new Error('globals.json exists but could not be read (is it valid JSON?). Fix or remove it; ApiMan will not overwrite it.');
    }
    const doc = { name: 'Globals', values: [], _postman_variable_scope: 'globals' };
    await backend.environments.put(GLOBALS_ID, doc);
    state.envs[GLOBALS_ID] = doc;
  }
  return state.envs[GLOBALS_ID];
}

function setActiveEnv(id) {
  state.activeEnv = id;
  ls.set('apiman:activeEnv', id);
  renderEnvPicker();
  renderResolved();
  renderAuth();
  renderDiff();
}

// =====================================================================================================
// Tabs
// =====================================================================================================
function cur() { return state.tabs[state.active] || null; }

function newTab(init) {
  return {
    key: uid(), cid: null, itemId: null, ed: blankEd(), dirty: false,
    out: null, sending: null, reqTab: 'params', respTab: 'rbody', bodyView: 'pretty', scriptKind: 'pre', ...init,
  };
}

const isPhone = () => matchMedia('(max-width: 600px)').matches;
/** The text scale currently applied (a Settings preview included). */
const cssScale = () => Number(getComputedStyle(document.documentElement).getPropertyValue('--text-scale')) || 1;
function toggleSidebar() {
  state.settings.sideHidden = !state.settings.sideHidden;
  saveSettings();
  applyAppearance();
  toast(state.settings.sideHidden ? 'Sidebar hidden. Cmd/Ctrl+B shows it again.' : 'Sidebar shown');
}
/** Phones: the sidebar is a panel you open and close. Wider screens: always visible (no-op). */
function setSide(open) {
  if (!isPhone()) return;
  $('.app').classList.toggle('side-open', open);
  $('#btnSide').setAttribute('aria-expanded', String(open));
  $('#btnSide').setAttribute('aria-label', open ? 'Hide sidebar' : 'Show sidebar');
}

function openTab(tab) {
  setSide(false);
  state.tabs.push(tab);
  state.active = state.tabs.length - 1;
  persistTabs();
  renderAll();
}

function openItem(cid, itemId) {
  const existing = state.tabs.findIndex((t) => t.cid === cid && t.itemId === itemId);
  if (existing !== -1) { setSide(false); state.active = existing; persistTabs(); renderAll(); return; }
  const loc = locate(state.cols[cid], itemId);
  if (!loc) return;
  openTab(newTab({ cid, itemId, ed: fromItem(loc.item) }));
}

function askSaveBeforeClose(t) {
  return new Promise((resolve) => {
    let done = false;
    const finish = (v) => { if (!done) { done = true; resolve(v); } };
    openDialog({
      title: 'Save changes?', confirm: true, cancel: false,
      body: h('p', { class: 'hint field' }, `"${t.ed.name}" has changes that aren't saved.`),
      buttons: [
        { label: "Don't save", danger: true, left: true, onClick: () => { finish('discard'); return true; } },
        { label: 'Cancel', onClick: () => { finish('cancel'); return true; } },
        { label: 'Save', primary: true, onClick: () => { finish('save'); return true; } },
      ],
      onClose: () => finish('cancel'),
      focus: '#dlgFoot .btn.primary',
    });
  });
}

async function closeTab(i) {
  const t = state.tabs[i];
  if (t.ws) wsDisconnect(t);
  if (t.dirty) {
    const choice = await askSaveBeforeClose(t);
    if (choice === 'cancel') return;
    if (choice === 'save') {
      state.active = state.tabs.indexOf(t);
      renderAll();
      if (!t.cid) { await saveAs(); return; } // the save dialog takes over; the tab stays open
      await save();
      if (t.dirty) return; // saving failed
    }
  }
  i = state.tabs.indexOf(t);
  if (i === -1) return;
  if (t.sending) t.sending.abort();
  state.tabs.splice(i, 1);
  if (state.active >= state.tabs.length) state.active = state.tabs.length - 1;
  else if (i < state.active) state.active--;
  persistTabs();
  renderAll();
}

/** What survives a reload: only what the response pane shows. Never the request as sent (resolved tokens),
 *  variables or script logs; secret-looking and cookie headers are dropped. Session-only (gone when the browser tab closes). */
function minimalOut(out) {
  const r = out.res;
  const headers = (r.headers || []).filter(([k]) => !SECRET_HEADER.test(String(k)) && !/^set-cookie2?$/i.test(String(k)));
  return {
    res: { status: r.status, reason: r.reason, timeMs: r.timeMs, size: r.size, truncated: r.truncated, binary: r.binary, headers,
      body: r.binary ? undefined : r.body, bodyBase64: undefined },
    tests: (out.tests || []).map((x) => ({ name: x.name, passed: x.passed })), logs: [], warnings: [], restored: true,
  };
}
function writeTabs() {
  if (automationWin.only) return; // the main window owns the tabs
  ls.set('apiman:tabs', {
    active: state.active,
    tabs: state.tabs.map((t) => (t.cid ? { cid: t.cid, itemId: t.itemId, ed: t.dirty ? edForStorage(t.ed) : null } : { ed: edForStorage(t.ed) })),
  });
  let budget = 2 * 1024 * 1024; // all kept responses together stay well inside the storage quota
  const outs = state.tabs.map((t) => {
    if (state.settings.history === false || !t.out || !t.out.res || t.out.res.binary) return null; // History off: nothing kept
    const json = JSON.stringify(minimalOut(t.out));
    if (json.length > 256 * 1024 || json.length > budget) return null;
    budget -= json.length;
    return JSON.parse(json);
  });
  try { sessionStorage.setItem('apiman:outs', JSON.stringify(outs)); } catch { /* private mode or quota: just not kept */ }
}
const persistTabs = debounce(writeTabs, 300);

async function restoreTabs() {
  const saved = ls.get('apiman:tabs', null);
  if (!saved || !Array.isArray(saved.tabs)) return;
  let outs = [];
  try { outs = JSON.parse(sessionStorage.getItem('apiman:outs') || '[]'); } catch { /* none */ }
  for (const [si, s] of saved.tabs.entries()) {
    s.out = outs[si] && outs[si].res ? outs[si] : null; // this browser tab's own last responses only
    try {
      if (s.cid) {
        if (!state.colList.some((c) => c.id === s.cid)) continue;
        if (!state.cols[s.cid]) await loadCol(s.cid);
        const loc = locate(state.cols[s.cid], s.itemId);
        if (!loc) continue;
        state.tabs.push(newTab({ cid: s.cid, itemId: s.itemId, ed: s.ed ? { ...blankEd(), ...s.ed, body: { ...blankBody(), ...s.ed.body } } : fromItem(loc.item), dirty: !!s.ed, out: s.out && s.out.res ? s.out : null }));
      } else if (s.ed) {
        const ed = { ...blankEd(), ...s.ed, body: { ...blankBody(), ...s.ed.body } };
        state.tabs.push(newTab({ ed, dirty: !!(ed.url || ed.headers.length || ed.body.mode !== 'none' || ed.pre || ed.test), out: s.out && s.out.res ? s.out : null }));
      }
    } catch { /* skip broken entries */ }
  }
  state.active = Math.min(Math.max(0, saved.active | 0), state.tabs.length - 1);
}

function markDirty() {
  const t = cur();
  if (!t) return;
  let dirty = true;
  if (t.cid) { // compare with the saved request: undoing your edit clears the dot
    const loc = state.cols[t.cid] && locate(state.cols[t.cid], t.itemId);
    try { if (loc && JSON.stringify(edForStorage(t.ed)) === JSON.stringify(edForStorage(fromItem(loc.item)))) dirty = false; } catch { /* keep dirty */ }
  }
  if (t.dirty !== dirty) { t.dirty = dirty; renderTabs(); }
  $('#dirtyDot').hidden = !dirty;
  persistTabs();
}

// =====================================================================================================
// Rendering: sidebar
// =====================================================================================================
function renderSidebar() {
  $$('.side .seg-btn').forEach((b) => { const on = b.dataset.view === state.view; b.classList.toggle('on', on); b.setAttribute('aria-selected', on); });
  $('#search').placeholder = state.view === 'history' ? 'Filter history  /' : state.view === 'environments' ? 'Filter environments  /' : 'Filter requests  /';
  const body = $('#sideBody');
  body.setAttribute('role', state.view === 'collections' || (state.view === 'environments' && envsAsTree()) ? 'tree' : 'list');
  body.setAttribute('aria-label', { collections: 'Collections', environments: 'Environments', history: 'History' }[state.view]);
  if (state.view === 'environments') body.replaceChildren(...renderEnvList());
  else if (state.view === 'history') body.replaceChildren(...renderHistoryList());
  else body.replaceChildren(...renderCollectionTree());
  // Roving tabindex: the tree is ONE tab stop; arrows move inside it. Row action buttons are reached with the menu key.
  const rows = $$('.row', body);
  rows.forEach((r) => { r.tabIndex = -1; $$('button', r).forEach((b) => { b.tabIndex = -1; }); });
  const want = state.refocus || state.focusKey;
  const current = (want && rows.find((r) => r.dataset.key === want)) || rows.find((r) => r.classList.contains('on')) || rows[0];
  if (current) current.tabIndex = 0;
  if (state.refocus && current) current.focus();
  state.refocus = null;
}
// 20px = caret + gap, so children sit under their parent's name. Deep folder trees stop indenting at 40% of the sidebar, so a
// name always keeps room to be read (its level is still in aria-level, its path in the title).
const indent = (depth) => `padding-left: calc(var(--s2) + min(${depth} * 20px, 40%))`;

function rowActs(...btns) { return h('span', { class: 'acts' }, ...btns); }
/** Tree row action: an icon Button whose click doesn't also open the row. */
function iconBtn(name, title, onclick) { return ui.iconButton(name, title, onclick, { size: 'small', stop: true }); }
function countMatches(items) { let n = 0; eachRequest(items, (it) => { if (matches(it)) n++; }); return n; }
/** The filter text, highlighted inside a name (built as DOM nodes, never HTML). */
function markMatch(text) {
  const f = state.filter;
  const i = f ? String(text).toLowerCase().indexOf(f) : -1;
  if (i === -1) return [String(text)];
  return [String(text).slice(0, i), h('mark', null, String(text).slice(i, i + f.length)), String(text).slice(i + f.length)];
}
const matches = (it) => {
  const f = state.filter;
  if (!f) return true;
  if (String(it.name ?? '').toLowerCase().includes(f)) return true;
  return urlIn(it.request && it.request.url).raw.toLowerCase().includes(f);
};

// ---------- categories: the data folder's own folders, one TreeRow per level ----------
/** List entries ({ id, name, folder }) as a tree of folders: { path, name, dirs: Map, items, total }. */
function categoryTree(list) {
  const root = { path: '', name: '', dirs: new Map(), items: [], total: 0 };
  for (const e of list) {
    let node = root;
    node.total++;
    for (const seg of entryFolder(e).split('/').filter(Boolean)) {
      if (!node.dirs.has(seg)) node.dirs.set(seg, { path: node.path ? `${node.path}/${seg}` : seg, name: seg, dirs: new Map(), items: [], total: 0 });
      node = node.dirs.get(seg);
      node.total++;
    }
    node.items.push(e);
  }
  return root;
}
/** A folder's own entries first (by name), then its sub-folders, each a collapsible category row (state.open "dir:<path>").
 *  While filtering every category is open, and one is shown when its name or anything inside it matches. */
function categoryNodes(node, depth, force, { entry, add, menu }) {
  const byName = (a, b) => a.name.localeCompare(b.name);
  const nodes = [];
  for (const e of [...node.items].sort(byName)) nodes.push(...entry(e, depth, force));
  for (const d of [...node.dirs.values()].sort(byName)) {
    const key = `dir:${d.path}`;
    const hit = !!state.filter && d.name.toLowerCase().includes(state.filter);
    const open = state.filter ? true : state.open.has(key);
    const kids = open ? categoryNodes(d, depth + 1, force || hit, { entry, add, menu }) : [];
    if (state.filter && !kids.length && !hit && !force) continue;
    const toggle = () => { state.refocus = `d:${d.path}`; toggleOpen(key); renderSidebar(); };
    nodes.push(h('div', {
      class: 'row', style: indent(depth), tabindex: '0', role: 'treeitem', 'aria-level': String(depth + 1), 'aria-expanded': String(open),
      'data-key': `d:${d.path}`, title: d.path, onclick: toggle, onkeydown: (e) => { if (e.key === 'Enter') toggle(); },
    },
      h('span', { class: `caret ${open ? 'open' : ''}` }, icon('chevron')),
      h('span', { class: 'folder-ico' }, icon('folder')),
      h('span', { class: 'name' }, ...markMatch(d.name)),
      h('span', { class: 'sub' }, String(d.total)),
      rowActs(
        iconBtn('plus', add.label, () => add.onClick(d.path)),
        iconBtn('dots', 'More actions', (e) => menu(e.currentTarget, d.path)))), ...kids);
  }
  return nodes;
}
/** Opens the category rows down to a folder, so what was just made or revealed there is in view. */
function openCategory(folder) {
  const segs = String(folder || '').split('/').filter(Boolean);
  segs.forEach((_, i) => state.open.add(`dir:${segs.slice(0, i + 1).join('/')}`));
  saveOpen();
}
/** "payments / Staging": a collection or environment name with its folder in front when it isn't at the top. */
const labelWithFolder = (e) => (entryFolder(e) ? `${entryFolder(e)} / ${e.name}` : e.name);
/** The folder a listed collection or environment is in ("" when unknown). */
const folderOf = (list, id) => { const e = list.find((x) => x.id === id); return e ? entryFolder(e) : ''; };
/** "payments/v2/Refunds.json" -> "Refunds.json" (download names can't hold a "/"). */
const baseName = (id) => String(id).split('/').pop();

function renderCollectionTree() {
  if (!state.colList.length) {
    return [ui.empty(
      h('p', null, 'No collections yet.'),
      h('p', null, 'Create one to save requests, or import an export from Postman.'),
      ui.actions(ui.button({ label: 'New collection', size: 'small', onClick: () => newCollection() }), ui.button({ label: 'Import', size: 'small', onClick: () => openImport() })))];
  }
  const t = cur();
  const out = categoryNodes(categoryTree(state.colList), 0, false, {
    entry: collectionNodes,
    add: { label: 'New collection here', onClick: (path) => newCollection(path) },
    menu: (anchor, path) => showMenu(anchor, [
      { label: 'New collection here', onClick: () => newCollection(path) },
      { label: 'Import here', onClick: () => openImport('file', path) },
    ]),
  });
  if (!out.length) out.push(ui.empty(h('p', null, `Nothing matches "${state.filter}".`)));
  return out;
  function collectionNodes(c, depth, force) {
    const col = state.cols[c.id];
    const open = state.filter ? true : state.open.has(c.id);
    const kids = open && col ? itemsNodes(c.id, col.item, depth + 1) : [];
    if (state.filter && !kids.length && !force && !c.name.toLowerCase().includes(state.filter)) return [];
    return [h('div', {
      class: 'row collection', style: indent(depth), tabindex: '0', title: c.id, role: 'treeitem', 'aria-level': String(depth + 1), 'aria-expanded': String(open), 'data-key': `c:${c.id}`,
      onclick: () => toggleCollection(c.id), onkeydown: (e) => { if (e.key === 'Enter') toggleCollection(c.id); },
    },
      h('span', { class: `caret ${open ? 'open' : ''}` }, icon('chevron')),
      h('span', { class: 'name' }, c.name),
      col ? h('span', { class: 'sub' }, state.filter ? `${countMatches(col.item)} / ${countRequests(col.item)}` : String(countRequests(col.item))) : null,
      rowActs(
        iconBtn('plus', 'Add request', () => addRequest(c.id, null)),
        iconBtn('dots', 'More actions', (e) => collectionMenu(e.currentTarget, c.id)))), ...kids];
  }
  function itemsNodes(cid, items, depth) {
    const nodes = [];
    for (const it of items) {
      if (isFolder(it)) {
        const key = `${cid}:${it.id}`;
        const fopen = state.filter ? true : state.open.has(key);
        const kids = fopen ? itemsNodes(cid, it.item, depth + 1) : [];
        if (state.filter && !kids.length && !matches(it)) continue;
        nodes.push(h('div', {
          class: 'row', style: indent(depth), tabindex: '0', role: 'treeitem', 'aria-level': String(depth + 1), 'aria-expanded': String(fopen), 'data-key': `f:${key}`,
          onclick: () => { toggleOpen(key); renderSidebar(); }, onkeydown: (e) => { if (e.key === 'Enter') { state.refocus = `f:${key}`; toggleOpen(key); renderSidebar(); } },
        },
          h('span', { class: `caret ${fopen ? 'open' : ''}` }, icon('chevron')),
          h('span', { class: 'folder-ico' }, icon('folder')),
          h('span', { class: 'name' }, it.name || 'Folder'),
          rowActs(
            iconBtn('plus', 'Add request', () => addRequest(cid, it.id)),
            iconBtn('dots', 'More actions', (e) => folderMenu(e.currentTarget, cid, it.id)))));
        nodes.push(...kids);
      } else {
        if (!matches(it)) continue;
        const m = itemMethod(it);
        const active = t && t.cid === cid && t.itemId === it.id;
        nodes.push(h('div', {
          class: cx('row', active && 'on'), style: indent(depth), tabindex: '0', role: 'treeitem', 'aria-level': String(depth + 1),
          'aria-selected': String(!!active), 'data-key': `r:${cid}:${it.id}`,
          onclick: () => openItem(cid, it.id), onkeydown: (e) => { if (e.key === 'Enter') openItem(cid, it.id); },
        },
          h('span', { class: 'caret' }),
          ui.method(m),
          h('span', { class: 'name' }, ...markMatch(it.name || 'Untitled')),
          rowActs(iconBtn('dots', 'More actions', (e) => requestMenu(e.currentTarget, cid, it.id)))));
      }
    }
    return nodes;
  }
}

function toggleOpen(key) { state.open.has(key) ? state.open.delete(key) : state.open.add(key); saveOpen(); }
async function toggleCollection(id) {
  toggleOpen(id);
  if (!state.cols[id]) { try { await loadCol(id); } catch (e) { toast(e.message, 'err'); } }
  renderSidebar();
}

/** Environments in folders show as a tree (category rows); all at the top, as a plain list. */
const envsAsTree = () => state.envList.some((e) => entryFolder(e));
function renderEnvList() {
  const f = state.filter;
  const rows = [h('div', { class: 'side-section' }, 'Environments', ui.button({ label: '+ New', variant: 'ghost', size: 'small', onClick: () => editEnvironment(null) }))];
  const g = state.envs[GLOBALS_ID];
  const tree = envsAsTree();
  const role = tree ? 'treeitem' : 'button';
  const level = tree ? { 'aria-level': '1' } : {};
  if (!f || 'globals'.includes(f)) {
    rows.push(h('div', { class: 'row', tabindex: '0', role, ...level, 'data-key': 'e:globals', onclick: () => editEnvironment(GLOBALS_ID), onkeydown: (e) => { if (e.key === 'Enter') editEnvironment(GLOBALS_ID); } },
      h('span', { class: 'caret' }),
      h('span', { class: 'name' }, 'Globals'),
      h('span', { class: 'sub' }, `${g ? g.values.length : 0} vars`)));
  }
  const envRow = (e, depth, force) => {
    if (f && !force && !e.name.toLowerCase().includes(f)) return [];
    const doc = state.envs[e.id];
    const active = e.id === state.activeEnv;
    return [h('div', { class: cx('row', active && 'on'), style: indent(depth), tabindex: '0', role, ...(tree ? { 'aria-level': String(depth + 1) } : {}), 'data-key': `e:${e.id}`, title: e.id, 'aria-label': `${e.name}${active ? ' (active)' : ''}`, onclick: () => editEnvironment(e.id), onkeydown: (ev) => { if (ev.key === 'Enter') editEnvironment(e.id); } },
      h('span', { class: 'caret' }, ui.dot({ tone: active ? 'ok' : '', label: active ? 'Active' : null })),
      h('span', { class: 'name' }, e.name),
      h('span', { class: 'sub' }, `${doc ? doc.values.length : 0} vars`),
      rowActs(iconBtn('dots', 'More actions', (ev) => envMenu(ev.currentTarget, e.id))))];
  };
  rows.push(...categoryNodes(categoryTree(state.envList), 0, false, {
    entry: envRow,
    add: { label: 'New environment here', onClick: (path) => editEnvironment(null, path) },
    menu: (anchor, path) => showMenu(anchor, [
      { label: 'New environment here', onClick: () => editEnvironment(null, path) },
      { label: 'Import here', onClick: () => openImport('file', path) },
    ]),
  }));
  if (!state.envList.length) {
    rows.push(ui.empty(h('p', null, 'Environments hold values that change between setups, like baseUrl and token for local, staging and production.')));
  }
  return rows;
}

function renderHistoryList() {
  if (!state.settings.history) return [ui.empty(h('p', null, 'History is turned off in Settings.'))];
  const f = state.filter;
  const list = state.history.filter((e) => !f || `${e.method} ${e.url} ${e.name}`.toLowerCase().includes(f));
  const out = [h('div', { class: 'side-section' }, f ? `${list.length} of ${state.history.length} requests` : `${state.history.length} requests`,
    state.history.length ? ui.button({ label: 'Clear', variant: 'ghost', size: 'small', onClick: clearHistory }) : null)];
  if (!list.length) out.push(ui.empty(h('p', null, state.history.length ? 'Nothing matches.' : 'Requests you send appear here.')));
  let day = '';
  for (const e of list) {
    const d = new Date(e.at).toDateString();
    if (d !== day) {
      day = d;
      const label = d === new Date().toDateString() ? 'Today' : d === new Date(Date.now() - 864e5).toDateString() ? 'Yesterday' : new Date(e.at).toLocaleDateString();
      out.push(h('div', { class: 'side-section' }, label));
    }
    out.push(historyRow(e));
  }
  return out;
}

/** One history entry: method, path (the base URL is the same everywhere, so it's left out), time, status. */
function historyRow(e) {
  const url = e.url || '';
  const path = url.replace(/^\s*{{[^{}]+}}/, '').replace(/^[a-z][\w+.-]*:\/\//i, '') || url || e.name; // a {{baseUrl}} is dropped, a literal host is kept
  const mins = Math.round((Date.now() - e.at) / 60000);
  const time = mins < 1 ? 'now' : mins < 60 ? `${mins}m` : mins < 1440 ? `${Math.floor(mins / 60)}h` : new Date(e.at).toLocaleDateString([], { month: 'short', day: 'numeric' });
  return h('div', {
    class: 'row', tabindex: '0', role: 'button', 'data-key': `h:${e.id}`, title: `${e.method} ${url}\n${new Date(e.at).toLocaleString()}`,
    onclick: () => openFromHistory(e), onkeydown: (ev) => { if (ev.key === 'Enter') openFromHistory(e); },
  },
    ui.method(e.method),
    h('span', { class: 'name' }, path),
    h('span', { class: 'time' }, time),
    ui.status(e.status, { small: true }));
}

function openFromHistory(e) {
  const ed = { ...blankEd(), ...e.ed, body: { ...blankBody(), ...(e.ed && e.ed.body) } };
  openTab(newTab({ ed }));
}
async function clearHistory() {
  if (!(await ask({ title: 'Clear history?', message: `This removes all ${state.history.length} requests from your history.`, ok: 'Clear history', danger: true }))) return;
  state.history = [];
  ls.set('apiman:history', []);
  renderSidebar();
}
function pushHistory(tab, out) {
  if (!state.settings.history) return;
  state.history.unshift({
    id: uid(), at: Date.now(), method: tab.ed.method, url: tab.ed.url, name: tab.ed.name,
    status: out.res && !out.error ? out.res.status : 0, timeMs: out.res ? out.res.timeMs : 0, ed: edForStorage(tab.ed),
  });
  state.history = state.history.slice(0, 200);
  if (!ls.set('apiman:history', state.history)) { state.history = state.history.slice(0, 50); ls.set('apiman:history', state.history); }
  if (state.view === 'history') renderSidebar();
}

// ---------- menus ----------
function showMenu(anchor, items) {
  const pop = $('#popover');
  const row = anchor.closest('.row');
  pop.setAttribute('role', 'menu');
  const name = anchor.getAttribute('aria-label') || (anchor.innerText || anchor.textContent).replace(/\s+/g, ' ').trim();
  if (name) pop.setAttribute('aria-label', name); else pop.removeAttribute('aria-label');
  pop.replaceChildren(...items.map((it) => (it === '-' ? h('div', { class: 'sep', role: 'separator' })
    : h('button', { type: 'button', class: cx('mi', it.danger && 'danger', it.current && 'on'), role: 'menuitem', 'aria-current': it.current ? 'true' : null, onclick: () => { hideMenu(); it.onClick(); } }, it.label))));
  placePopover(pop, anchor);
  anchor.setAttribute('aria-expanded', 'true');
  showMenu.anchor = anchor;
  if (row) { row.classList.add('menu-open'); pop.dataset.row = '1'; showMenu.row = row; }
  const first = pop.querySelector('.mi.on') || pop.querySelector('button');
  if (first) first.focus();
}
/** Hide the tabs of a segmented row that don't fit (never the active one) and list them in a "More tabs" menu. */
function fitTabs(seg) {
  if (!seg || !seg.isConnected) return;
  const btns = [...seg.children].filter((b) => b.matches('.tab, .seg-btn'));
  btns.forEach((b) => b.classList.remove('ovf'));
  let more = seg.nextElementSibling?.classList.contains('seg-more') ? seg.nextElementSibling : null;
  if (!seg.getClientRects().length || seg.scrollWidth <= seg.clientWidth + 1) { if (more) more.hidden = true; return; }
  if (!more) {
    const what = seg.getAttribute('role') === 'radiogroup' ? 'More options' : 'More tabs';
    more = ui.iconButton('dots', what, null, { size: 'small', cls: 'seg-more', 'aria-haspopup': 'menu', 'aria-expanded': 'false' });
    more.addEventListener('click', () => showMenu(more, btns.filter((b) => b.classList.contains('ovf') && !b.disabled && b.getAttribute('aria-disabled') !== 'true').map((b) => {
      const name = [...b.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent).join('').trim() || b.textContent.trim();
      const count = b.querySelector('.count:not(.dot)')?.textContent.trim();
      return { label: count ? `${name} (${count})` : name, onClick: () => { b.click(); requestAnimationFrame(() => requestAnimationFrame(() => b.focus())); } };
    })));
    seg.after(more);
  }
  more.hidden = false;
  const active = btns.find((b) => b.classList.contains('on'));
  for (let i = btns.length - 1; i >= 0 && seg.scrollWidth > seg.clientWidth + 1; i--) if (btns[i] !== active) btns[i].classList.add('ovf');
  const hidden = btns.filter((b) => b.classList.contains('ovf'));
  if (hidden.length === 1) { // maybe it fits where the More button sits
    more.hidden = true; hidden[0].classList.remove('ovf');
    if (seg.scrollWidth > seg.clientWidth + 1) { hidden[0].classList.add('ovf'); more.hidden = false; }
  }
  // a More menu holding only unavailable options (e.g. Preview for JSON) is noise: hide it
  if (btns.every((b) => !b.classList.contains('ovf') || b.disabled || b.getAttribute('aria-disabled') === 'true')) more.hidden = true;
}
function placePopover(pop, anchor) {
  // A modal dialog is in the top layer: a popover opened from inside it must live in it too, or it opens underneath
  const host = anchor.closest('dialog[open]') || document.body;
  if (pop.parentElement !== host) host.append(pop);
  pop.hidden = false;
  const r = anchor.getBoundingClientRect();
  const pw = pop.offsetWidth, ph = pop.offsetHeight;
  pop.style.left = `${Math.max(8, Math.min(r.left, innerWidth - pw - 8))}px`;
  pop.style.top = `${r.bottom + ph + 8 > innerHeight ? Math.max(8, r.top - ph - 4) : r.bottom + 4}px`;
}
function hideMenu(refocus = false) {
  $('#popover').hidden = true;
  if ($('#popover').parentElement !== document.body) document.body.append($('#popover')); // never left in a closed dialog
  if (showMenu.row) { showMenu.row.classList.remove('menu-open'); showMenu.row = null; }
  if (showMenu.anchor) {
    showMenu.anchor.setAttribute('aria-expanded', 'false');
    if (refocus && showMenu.anchor.isConnected) showMenu.anchor.focus({ preventScroll: true });
    showMenu.anchor = null;
  }
}
document.addEventListener('mousedown', (e) => { if (!$('#popover').hidden && !e.target.closest('#popover')) hideMenu(); });

function collectionMenu(anchor, cid) {
  const name = (state.colList.find((c) => c.id === cid) || {}).name;
  showMenu(anchor, [
    { label: 'Add request', onClick: () => addRequest(cid, null) },
    { label: 'Add folder', onClick: () => addFolder(cid, null) },
    { label: 'Settings: auth, variables, scripts', onClick: () => editContainer(cid, null) },
    { label: 'Run collection', onClick: () => openRunner(cid, null) },
    '-',
    { label: 'Export (Postman v2.1)', onClick: () => exportCollection(cid) },
    { label: 'Duplicate', onClick: () => duplicateCollection(cid) },
    { label: 'Delete', danger: true, onClick: () => deleteCollection(cid, name) },
  ]);
}
function folderMenu(anchor, cid, id) {
  showMenu(anchor, [
    { label: 'Add request', onClick: () => addRequest(cid, id) },
    { label: 'Add folder', onClick: () => addFolder(cid, id) },
    { label: 'Settings: auth, scripts', onClick: () => editContainer(cid, id) },
    { label: 'Run folder', onClick: () => openRunner(cid, id) },
    { label: 'Rename', onClick: () => renameItem(cid, id) },
    '-',
    { label: 'Delete', danger: true, onClick: () => deleteItem(cid, id) },
  ]);
}
function requestMenu(anchor, cid, id) {
  showMenu(anchor, [
    { label: 'Open', onClick: () => openItem(cid, id) },
    { label: 'Duplicate', onClick: () => duplicateItem(cid, id) },
    { label: 'Rename', onClick: () => renameItem(cid, id) },
    '-',
    { label: 'Delete', danger: true, onClick: () => deleteItem(cid, id) },
  ]);
}
function envMenu(anchor, id) {
  showMenu(anchor, [
    { label: id === state.activeEnv ? 'Deactivate' : 'Set as active', onClick: () => { setActiveEnv(id === state.activeEnv ? '' : id); renderSidebar(); } },
    { label: 'Edit', onClick: () => editEnvironment(id) },
    { label: 'Duplicate', onClick: () => duplicateEnvironment(id) },
    { label: 'Export', onClick: () => download(baseName(id), JSON.stringify(state.envs[id], null, 2)) },
    '-',
    { label: 'Delete', danger: true, onClick: () => deleteEnvironment(id) },
  ]);
}

// ---------- tree actions ----------
async function withCol(cid) { return state.cols[cid] || loadCol(cid); }

async function addRequest(cid, folderId) {
  const col = await withCol(cid);
  const list = folderId ? locate(col, folderId).item.item : col.item;
  const item = toItem(blankEd());
  item.name = 'New request';
  list.push(item);
  await saveCol(cid);
  state.open.add(cid);
  if (folderId) state.open.add(`${cid}:${folderId}`);
  saveOpen();
  openItem(cid, item.id);
  setTimeout(() => { $('#reqName').focus(); $('#reqName').select(); }, 30);
}

async function addFolder(cid, parentId) {
  const name = await ask({ title: 'New folder', input: { label: 'Folder name', placeholder: 'e.g. Orders' }, ok: 'Create folder' });
  if (!name) return;
  const col = await withCol(cid);
  const list = parentId ? locate(col, parentId).item.item : col.item;
  const folder = { id: uid(), name, item: [] };
  list.push(folder);
  await saveCol(cid);
  state.open.add(cid);
  state.open.add(`${cid}:${folder.id}`);
  if (parentId) state.open.add(`${cid}:${parentId}`);
  saveOpen();
  renderSidebar();
}

async function renameItem(cid, id) {
  const loc = locate(state.cols[cid], id);
  const name = await ask({ title: `Rename ${isFolder(loc.item) ? 'folder' : 'request'}`, input: { label: 'Name', value: loc.item.name || '' }, ok: 'Rename' });
  if (!name) return;
  const fresh = locate(state.cols[cid], id); // look it up again: the collection may have been reloaded meanwhile
  if (!fresh) { toast('That item no longer exists.', 'err'); return; }
  fresh.item.name = name;
  await saveCol(cid);
  for (const t of state.tabs) if (t.cid === cid && t.itemId === id) t.ed.name = name;
  renderAll();
}

async function duplicateItem(cid, id) {
  const loc = locate(state.cols[cid], id);
  const copy = JSON.parse(JSON.stringify(loc.item));
  const reid = (it) => { it.id = uid(); if (Array.isArray(it.item)) it.item.forEach(reid); };
  reid(copy);
  copy.name = `${loc.item.name || 'Request'} copy`;
  loc.list.splice(loc.index + 1, 0, copy);
  await saveCol(cid);
  openItem(cid, copy.id);
}

/** Tabs of deleted items close; tabs with unsaved edits stay open as unsaved drafts instead. */
function keepDirtyAsDrafts(affected) {
  let kept = 0;
  state.tabs = state.tabs.filter((t) => {
    if (!affected(t)) return true;
    if (!t.dirty) return false;
    Object.assign(t, { cid: null, itemId: null });
    kept++;
    return true;
  });
  if (kept) toast(`${kept} tab${kept > 1 ? 's' : ''} with unsaved changes ${kept > 1 ? 'were' : 'was'} kept as unsaved draft${kept > 1 ? 's' : ''}.`, 'warn');
}

async function deleteItem(cid, id) {
  const loc = locate(state.cols[cid], id);
  const n = isFolder(loc.item) ? countRequests(loc.item.item) : 0;
  if (!(await ask({
    title: `Delete ${isFolder(loc.item) ? 'folder' : 'request'}?`,
    message: `"${loc.item.name}"${n ? ` and the ${n} request${n > 1 ? 's' : ''} in it` : ''} will be removed from the collection.`,
    ok: `Delete ${isFolder(loc.item) ? 'folder' : 'request'}`, danger: true,
  }))) return;
  const fresh = locate(state.cols[cid], id);
  if (!fresh) return;
  fresh.list.splice(fresh.index, 1);
  await saveCol(cid);
  const gone = new Set();
  const collect = (it) => { gone.add(it.id); if (Array.isArray(it.item)) it.item.forEach(collect); };
  collect(loc.item);
  keepDirtyAsDrafts((t) => t.cid === cid && gone.has(t.itemId));
  state.active = Math.min(state.active, state.tabs.length - 1);
  persistTabs();
  renderAll();
}

async function newCollection(folder = '') {
  const name = await ask({ title: folder ? `New collection in ${folder}` : 'New collection', input: { label: 'Collection name', placeholder: 'e.g. Payments API' }, ok: 'Create collection' });
  if (!name) return;
  const doc = { info: { name, schema: SCHEMA_V21, _postman_id: uid() }, item: [] };
  const id = await backend.collections.create(doc, folder);
  state.open.add(id);
  openCategory(folder);
  await refreshCollections();
  state.view = 'collections';
  renderSidebar();
  toast(`Created ${name}`);
}

async function duplicateCollection(cid) {
  const col = JSON.parse(JSON.stringify(await withCol(cid)));
  col.info.name = `${col.info.name} copy`;
  col.info._postman_id = uid();
  const reid = (it) => { it.id = uid(); if (Array.isArray(it.item)) it.item.forEach(reid); };
  col.item.forEach(reid);
  await backend.collections.create(col, folderOf(state.colList, cid)); // the copy sits next to the original
  await refreshCollections();
  renderSidebar();
}

async function deleteCollection(cid, name) {
  if (!(await ask({ title: 'Delete collection?', message: `"${name}" and every request in it will be deleted${backend.mode === 'local' ? ` (the file ${cid} in your data folder)` : ''}.`, ok: 'Delete collection', danger: true }))) return;
  await backend.collections.remove(cid);
  delete state.cols[cid];
  keepDirtyAsDrafts((t) => t.cid === cid);
  state.active = Math.min(state.active, state.tabs.length - 1);
  persistTabs();
  await refreshCollections();
  renderAll();
}

async function exportCollection(cid) {
  const col = await withCol(cid);
  download(baseName(cid), JSON.stringify(col, null, 2));
}

// =====================================================================================================
// Rendering: tabs, editor, response
// =====================================================================================================
function renderAll() {
  renderSidebar();
  renderTabs();
  renderEditor();
}

function renderTabs() {
  const strip = $('#tabstrip');
  strip.replaceChildren(
    ...state.tabs.map((t, i) => {
      const cable = { GET: '--get', POST: '--post', PUT: '--put', PATCH: '--patch', DELETE: '--delete' }[t.ed.method] || '--other';
      return h('div', {
        class: `rtab ${i === state.active ? 'on' : ''}`, role: 'tab', tabindex: '0', 'aria-selected': String(i === state.active),
        style: `--cable: var(${cable})`, title: `${t.ed.name}${t.ed.url ? `\n${t.ed.method} ${t.ed.url}` : ''}`,
        onclick: () => { state.active = i; persistTabs(); renderAll(); },
        onauxclick: (e) => { if (e.button === 1) closeTab(i); },
        onkeydown: (e) => { if (e.key === 'Enter') { state.active = i; renderAll(); } },
      },
        ui.method(t.ed.method),
        h('span', { class: 'tname' }, t.ed.name),
        ui.dot({ tone: 'warn', off: !t.dirty, label: t.dirty ? 'Unsaved changes' : null }),
        ui.iconButton('x', `Close ${t.ed.name}`, () => closeTab(i), { size: 'small', cls: 'x', stop: true, tabindex: i === state.active ? '0' : '-1' }));
    }),
    ui.iconButton('plus', 'New request tab', () => { openTab(newTab()); $('#url').focus(); }, { cls: 'newtab' }),
    ui.iconButton('chevron', 'All open tabs', (e) => { const strip = $('#tabstrip'), keep = strip.scrollLeft; requestAnimationFrame(() => { strip.scrollLeft = keep; }); showMenu(e.currentTarget, state.tabs.map((t, i) => ({
      label: h('span', { class: 'mi-tab' }, ui.method(t.ed.method), h('span', { class: 'mi-name' }, t.ed.name, t.dirty ? ui.dot({ tone: 'warn', label: 'unsaved' }) : null),
        h('span', { class: 'mi-sub' }, (t.ed.url || '').replace(/^[a-z]+:\/\//i, '') || 'no URL yet')),
      current: i === state.active,
      onClick: () => { state.active = i; persistTabs(); renderAll(); requestAnimationFrame(() => $('#tabstrip .rtab.on')?.focus()); },
    }))); }, { cls: 'newtab alltabs', 'aria-haspopup': 'menu', 'aria-expanded': 'false' }));
  const on = strip.querySelector('.rtab.on');
  if (on) on.scrollIntoView({ block: 'nearest', inline: 'nearest' });
}

function renderWelcome() {
  const hasData = state.colList.length > 0 || state.history.length > 0;
  const where = backend && (backend.mode === 'local' || backend.dir) ? 'on this computer' : 'in this browser';
  const kbd = ui.kbd;
  const cols = [];
  if (state.history.length) {
    const seen = new Set();
    const recent = state.history.filter((e) => { const k = `${e.method} ${e.url}`; if (seen.has(k)) return false; seen.add(k); return true; }).slice(0, 8);
    cols.push(h('section', null, h('span', { class: 'label' }, 'Recent requests'), ...recent.map(historyRow)));
  }
  if (state.colList.length) {
    cols.push(h('section', null, h('span', { class: 'label' }, 'Collections'), ...state.colList.map((c) => h('div', {
      class: 'row', tabindex: '0', role: 'button', title: c.id,
      onclick: () => { state.view = 'collections'; setSide(true); openCategory(entryFolder(c)); if (!state.open.has(c.id)) toggleCollection(c.id); else renderSidebar(); },
      onkeydown: (e) => { if (e.key === 'Enter') e.currentTarget.click(); },
    },
      h('span', { class: 'folder-ico' }, icon('folder')),
      h('span', { class: 'name' }, labelWithFolder(c)),
      state.cols[c.id] ? h('span', { class: 'sub' }, `${countRequests(state.cols[c.id].item)} requests`) : null))));
  }
  $('#welcomeInner').replaceChildren(
    h('h1', null, hasData ? 'No request open' : 'Send your first request'),
    h('p', null, hasData
      ? 'Pick up a recent request, open one from a collection, or start a new one.'
      : `Paste a URL, import a Postman collection or an OpenAPI spec, or start from a cURL command. Everything stays ${where}.`),
    ui.actions(
      ui.button({ label: 'New request', variant: 'primary', 'data-act': 'new-request' }), // the welcome screen's one primary action
      ui.button({ label: 'Import collection', 'data-act': 'import' }),
      ui.button({ label: 'Paste cURL', 'data-act': 'import-curl' }),
      backend && backend.mode === 'local' ? ui.button({ label: 'Run automation', 'data-act': 'automation' }) : null),
    h('p', { class: 'hint shortcuts' }, h('span', null, kbd('/'), ' filter requests, ', kbd(MOD), ' + ', kbd('Enter'), ' send, ', kbd(MOD), ' + ', kbd('S'), ' save, ', kbd(MOD), ' + ', kbd('B'), ' sidebar')),
    ...(cols.length ? [h('div', { class: 'welcome-cols' }, ...cols)] : [])); // replaceChildren would print a null as "null"
}

function renderEditor() {
  const t = cur();
  $('#welcome').hidden = !!t;
  $('#editor').hidden = !t;
  if (!t) { renderWelcome(); return; }
  const ed = t.ed;
  $('#reqName').value = ed.name;
  const sel = $('#method');
  if (![...sel.options].some((o) => o.value === ed.method)) sel.append(h('option', { value: ed.method }, ed.method));
  sel.value = ed.method;
  $('#reqbar').dataset.method = ed.method;
  if ($('#url').value !== ed.url) $('#url').value = ed.url;
  $('#dirtyDot').hidden = !t.dirty;
  renderCrumb();
  renderResolved();
  switchPane('#reqTabs', t.reqTab);
  renderParams();
  renderAuth();
  renderHeaders();
  renderBody();
  renderScripts();
  $('#docsText').value = ed.docs;
  if (!$('#docsPreview').hidden) $('#docsPreview').replaceChildren(...renderMarkdown(ed.docs));
  renderCounts();
  renderResponse();
}

function renderCrumb() {
  const t = cur();
  const crumb = $('#crumb');
  if (!t || !t.cid || !state.cols[t.cid]) { crumb.textContent = 'Unsaved request'; return; }
  const col = state.cols[t.cid];
  const loc = locate(col, t.itemId);
  crumb.textContent = [col.info.name, ...(loc ? loc.parents.map((f) => f.name) : [])].join(' / ') + ' /';
}

/** Colour {{variables}} in the URL field: defined ones in the accent, undefined ones red with a wavy underline. */
function renderUrlHl() {
  const hl = $('#urlHl'), inp = $('#url');
  if (!hl) return;
  const t = cur(), text = inp.value, parts = [];
  const vars = t && text.includes('{{') ? merged(scopesFor(t.cid)) : {};
  let last = 0;
  for (const m of text.matchAll(VAR_RE)) {
    parts.push(text.slice(last, m.index));
    const ok = Object.hasOwn(vars, m[1]) || dynamicVar(m[1]) !== undefined;
    parts.push(h('span', { class: ok ? 'v' : 'v err' }, m[0]));
    last = m.index + m[0].length;
  }
  parts.push(text.slice(last), ' ');
  hl.replaceChildren(...parts);
  hl.scrollLeft = inp.scrollLeft;
}
function renderResolved() {
  renderUrlHl();
  { const t0 = cur(); if (t0 && !t0.sending) $('#btnSend').textContent = (t0.ws && t0.ws.state !== 'closed') ? 'Disconnect' : isWsUrl(t0.ed.url) ? 'Connect' : 'Send'; }
  requestAnimationFrame(() => { const el = $('#resolved'); if (el) el.title = el.textContent; });
  const t = cur();
  const el = $('#resolved');
  // The line always keeps its height, so the panes below never jump while you type.
  if (!t || !(t.ed.url.includes('{{') || (t.ed.pathVars || []).some((v) => v.value))) { el.replaceChildren(); return; }
  const vars = merged(scopesFor(t.cid));
  const parts = [];
  let last = 0;
  const shown = applyPathVars(t.ed.url, t.ed.pathVars, (x) => x); // fill :id path variables for display
  for (const m of shown.matchAll(VAR_RE)) {
    parts.push(shown.slice(last, m.index));
    const loop = varCycle(m[1], vars);
    const v = Object.hasOwn(vars, m[1]) ? resolvePreview(vars[m[1]], vars) : dynamicVarNow(m[1]);
    parts.push(loop ? h('span', { class: 'err', title: `Refers to itself: ${loop.join(' → ')}` }, m[0])
      : v === undefined ? h('span', { class: 'err', title: 'Not defined in the environment, collection or Globals' }, m[0])
        : (m[1].startsWith('$') ? `‹${m[1]}›` : v));
    last = m.index + m[0].length;
  }
  parts.push(shown.slice(last));
  el.replaceChildren(h('span', null, 'Resolves to ', ...parts));
}

function renderCounts() {
  const t = cur();
  if (!t) return;
  const ed = t.ed;
  const n = (x) => (x ? String(x) : '');
  $('#cntParams').textContent = n(ed.params.filter((p) => !p.disabled && p.key).length);
  $('#cntHeaders').textContent = n(ed.headers.filter((p) => !p.disabled && p.key).length);
  // Numbers count things; a dot means "configured".
  const a = ed.auth;
  const authSet = (a.type === 'bearer' && a.token) || (a.type === 'basic' && (a.username || a.password)) || (a.type === 'apikey' && a.key);
  setDot('#cntAuth', !!authSet);
  setDot('#cntDocs', !!(ed.docs || '').trim());
  const b = ed.body;
  const hasBody = (b.mode === 'raw' && b.raw.trim()) || (b.mode === 'urlencoded' && b.urlencoded.some((r) => r.key))
    || (b.mode === 'formdata' && b.formdata.some((r) => r.key)) || (b.mode === 'file' && (b.fileObj || b.fileSrc))
    || (b.mode === 'graphql' && b.gqlQuery.trim()) || b.mode === 'unsupported';
  setDot('#cntBody', !!hasBody);
  const hasScript = !!(ed.pre.trim() || ed.test.trim());
  setDot('#cntScripts', hasScript);
}

/** A "configured" dot that always takes the same space, so tabs never shift when it appears. */
/** A tab's "has content" indicator: a muted Dot, absent (no reserved gap) when there's nothing set. */
function setDot(sel, on) {
  const el = $(sel);
  el.className = 'dot muted';
  el.hidden = !on;
  el.textContent = on ? 'set' : 'not set';
}

function switchPane(tabsSel, name) {
  const tabs = $(tabsSel);
  $$('.tab', tabs).forEach((b) => { const on = b.dataset.tab === name; b.classList.toggle('on', on); b.setAttribute('aria-selected', String(on)); if (on) b.scrollIntoView({ block: 'nearest', inline: 'nearest' }); });
  $$(':scope > .pane', tabs.parentElement).forEach((p) => { p.hidden = p.dataset.pane !== name; if (!p.hidden) refreshEditors(p); });
}

// ---------- key/value table ----------
/**
 * Postman-style table: always one empty row at the end; typing in it creates a new row.
 * opts: { onChange, placeholders, secret (type column default/secret), file (type column text/file), enabledKey }
 */
function kvTable(container, rows, opts = {}) {
  const onChange = opts.onChange || (() => {});
  const ph = opts.placeholders || ['Key', 'Value'];
  const render = (focus) => {
    const head = h('tr', null, h('th', { class: 'chk' }), h('th', null, ph[0]), h('th', null, ph[1]),
      opts.secret || opts.file ? h('th', { class: 'type' }, 'Type') : null, h('th', { class: 'act' }));
    const body = rows.map((r, i) => rowEl(r, i));
    body.push(rowEl(null, rows.length));
    container.replaceChildren(h('table', { class: 'kv' }, h('thead', null, head), h('tbody', null, body)));
    if (focus) {
      const el = container.querySelector(`tr[data-i="${focus.i}"] [data-col="${focus.col}"]`);
      if (el) { el.focus(); if (el.setSelectionRange) el.setSelectionRange(el.value.length, el.value.length); }
    }
  };
  const rowEl = (r, i) => {
    const ghost = !r;
    const row = r || { key: '', value: '', disabled: false };
    const promote = (col, v) => {
      const nr = { key: '', value: '', disabled: false, ...(opts.file ? { type: 'text', file: null, src: '' } : {}), ...(opts.secret ? { type: 'default' } : {}) };
      nr[col] = v;
      rows.push(nr);
      onChange();
      render({ i, col });
    };
    const secret = opts.secret && row.type === 'secret';
    const input = (col, placeholder) => ui.input({
      type: col === 'value' && secret && !row.reveal ? 'password' : 'text', bare: true, code: true, value: row[col] ?? '', placeholder: ghost ? placeholder : '',
      spellcheck: 'false', autocomplete: 'off', 'data-col': col, 'aria-label': placeholder,
      onInput: (e) => { if (ghost) promote(col, e.target.value); else { row[col] = e.target.value; onChange(); } },
    });
    let valueCell;
    if (opts.file && row.type === 'file' && !ghost) {
      const pick = ui.input({ type: 'file', hidden: true, onchange: (e) => { row.file = e.target.files[0] || null; row.src = row.file ? row.file.name : row.src; onChange(); render(); } });
      valueCell = h('td', null, h('div', { class: 'file-pick' },
        ui.button({ label: row.file ? 'Change file' : 'Choose file', size: 'small', onClick: () => pick.click() }),
        h('span', { class: 'fname' }, row.file ? `${row.file.name} (${fmtSize(row.file.size)})` : row.src ? `${row.src}: choose it again to send` : 'No file chosen'),
        pick));
    } else valueCell = h('td', null, input('value', ph[1]));
    const typeCell = opts.secret || opts.file ? h('td', { class: 'type' }, ghost ? null : ui.select(opts.secret ? [['default', 'Default'], ['secret', 'Secret']] : [['text', 'Text'], ['file', 'File']],
      { value: row.type || (opts.secret ? 'default' : 'text'), bare: true, 'aria-label': 'Type', onChange: (e) => { row.type = e.target.value; onChange(); render(); } })) : null;
    return h('tr', { 'data-i': i, class: cx(ghost && 'ghost', row.disabled && 'off') || null },
      h('td', { class: 'chk' }, ghost ? null : ui.input({ type: 'checkbox', checked: !row.disabled, title: 'Enabled', 'aria-label': 'Enabled',
        onchange: (e) => { row.disabled = !e.target.checked; onChange(); render(); } })),
      h('td', null, input('key', ph[0])),
      valueCell,
      typeCell,
      h('td', { class: 'act' }, ghost ? null : [
        secret ? ui.iconButton(row.reveal ? 'eyeOff' : 'eye', row.reveal ? 'Hide value' : 'Show value', () => { row.reveal = !row.reveal; render(); }, { size: 'small' }) : null,
        ui.iconButton('trash', 'Remove row', () => { rows.splice(i, 1); onChange(); render(); }, { size: 'small' }),
      ]));
  };
  render();
}

// ---------- request panes ----------
function renderParams() {
  const t = cur();
  t.ed.pathVars = syncPathVars(t.ed.url, t.ed.pathVars || []);
  const pv = $('#pathVarsKv');
  if (!t.ed.pathVars.length) pv.replaceChildren();
  else {
    pv.replaceChildren(ui.sectionHead('Path variables'),
      h('table', { class: 'kv' }, h('thead', null, h('tr', null, h('th', { class: 'chk' }), h('th', null, 'Path variable'), h('th', null, 'Value'), h('th', { class: 'act' }))),
        h('tbody', null, t.ed.pathVars.map((v) => h('tr', null,
          h('td', { class: 'chk' }),
          h('td', null, ui.input({ bare: true, code: true, value: `:${v.key}`, readonly: true, tabindex: '-1', 'aria-label': 'Path variable' })),
          h('td', null, ui.input({ bare: true, code: true, value: v.value, placeholder: 'Value', spellcheck: 'false', 'aria-label': `Value for :${v.key}`,
            onInput: (e) => { v.value = e.target.value; markDirty(); } })),
          h('td', { class: 'act' }))))));
  }
  kvTable($('#paramsKv'), t.ed.params, {
    placeholders: ['Query parameter', 'Value'],
    onChange: () => {
      t.ed.url = withQuery(t.ed.url, t.ed.params);
      $('#url').value = t.ed.url;
      renderResolved();
      renderCounts();
      markDirty();
    },
  });
}

function renderHeaders() {
  const t = cur();
  kvTable($('#headersKv'), t.ed.headers, { placeholders: ['Header', 'Value'], onChange: () => { renderCounts(); markDirty(); } });
}

/** Shared auth form, used for requests, folders and collections. */
function authForm(model, { allowInherit, inheritText, onChange, vars = () => merged(scopesFor(cur() && cur().cid)) }) {
  const wrap = h('div');
  const draw = () => {
    const field = (label, key, { secret, placeholder } = {}) => {
      let reveal = false;
      const input = ui.input({ type: secret ? 'password' : 'text', value: model[key] || '', placeholder: placeholder || '', spellcheck: 'false', autocomplete: 'off',
        onInput: (e) => { model[key] = e.target.value; onChange(); } });
      return ui.field(label, secret ? ui.secretField(input, ui.iconButton('eye', 'Show or hide', (e) => { reveal = !reveal; input.type = reveal ? 'text' : 'password'; e.currentTarget.replaceChildren(icon(reveal ? 'eyeOff' : 'eye')); })) : input);
    };
    const types = [...(allowInherit ? [['inherit', 'Inherit from parent']] : []), ['noauth', 'No auth'], ['bearer', 'Bearer token'], ['basic', 'Basic auth'], ['apikey', 'API key'], ['oauth2', 'OAuth 2.0']];
    if (model.type === 'unsupported') types.push(['unsupported', `${model.raw.type} (not supported)`]);
    const sel = ui.select(types, { value: model.type, 'aria-label': 'Auth type', onChange: (e) => {
      const type = e.target.value;
      for (const k of Object.keys(model)) delete model[k];
      Object.assign(model, { type }, type === 'apikey' ? { in: 'header', key: '', value: '' } : {},
        type === 'oauth2' ? { grant: 'authorization_code', pkce: true, clientAuth: 'header', headerPrefix: 'Bearer' } : {});
      onChange();
      draw();
    } });
    const kids = [ui.field('Type', sel, { narrow: true })];
    if (model.type === 'inherit') kids.push(ui.note(inheritText ? inheritText() : 'Uses the auth of the folder or collection this request is saved in.'));
    if (model.type === 'noauth') kids.push(ui.hint('No Authorization header is added.'));
    if (model.type === 'bearer') kids.push(field('Token', 'token', { secret: true, placeholder: 'eyJhbGciOi… or {{token}}' }));
    if (model.type === 'basic') kids.push(h('div', { class: 'grid-2' }, field('Username', 'username'), field('Password', 'password', { secret: true })));
    if (model.type === 'apikey') {
      kids.push(h('div', { class: 'grid-2' }, field('Key', 'key', { placeholder: 'X-Api-Key' }), field('Value', 'value', { secret: true, placeholder: '{{apiKey}}' })));
      kids.push(ui.field('Add to', ui.select([['header', 'Header'], ['query', 'Query parameter']], { value: model.in === 'query' ? 'query' : 'header', onChange: (e) => { model.in = e.target.value; onChange(); } }), { narrow: true }));
    }
    if (model.type === 'oauth2') kids.push(oauthFields(model, field, onChange, vars));
    if (model.type === 'unsupported') kids.push(ui.note(`The "${model.raw.type}" auth from Postman isn't supported yet. It stays in the file unchanged but isn't sent. Pick another type to replace it.`, 'warn'));
    if (['bearer', 'basic', 'apikey'].includes(model.type)) kids.push(ui.hint('Tip: keep secrets in an environment as Secret variables and reference them like {{token}}.'));
    wrap.replaceChildren(...kids);
    linkLabels(wrap);
  };
  draw();
  return wrap;
}

function renderAuth() {
  const t = cur();
  if (!t) return;
  $('#authEditor').replaceChildren(authForm(t.ed.auth, {
    allowInherit: true,
    inheritText: () => {
      const { auth, from } = effectiveAuth({ auth: { type: 'inherit' } }, t.cid, t.itemId);
      if (!t.cid) return 'This request isn\'t saved in a collection yet, so there is nothing to inherit. Save it, or pick an auth type here.';
      const label = { noauth: 'no auth', bearer: 'a Bearer token', basic: 'Basic auth', apikey: 'an API key', oauth2: 'OAuth 2.0' }[auth.type] || auth.type;
      return `Inherits ${label} from ${from}. Change it in the collection or folder settings.`;
    },
    onChange: () => { renderCounts(); markDirty(); },
  }));
}

const BODY_MODES = [['none', 'None'], ['raw', 'Raw'], ['formdata', 'Form data'], ['urlencoded', 'URL-encoded'], ['file', 'Binary'], ['graphql', 'GraphQL']];

function renderBody() {
  const t = cur();
  const b = t.ed.body;
  ui.seg(BODY_MODES, b.mode, (m) => { b.mode = m; renderBody(); renderCounts(); markDirty(); }, { into: $('#bodyModes') });
  const extras = [];
  if (b.mode === 'raw') {
    extras.push(ui.select([['json', 'JSON'], ['text', 'Text'], ['xml', 'XML'], ['html', 'HTML'], ['javascript', 'JavaScript']],
      { value: b.lang, size: 'small', 'aria-label': 'Raw format', onChange: (e) => { b.lang = e.target.value; markDirty(); renderBody(); } }));
  }
  if (b.mode === 'raw' && b.lang === 'json') extras.push(ui.button({ label: 'Beautify', variant: 'ghost', size: 'small', onClick: () => {
    try { b.raw = JSON.stringify(JSON.parse(b.raw), null, Number(state.settings.tabSize) || 2); renderBody(); markDirty(); } catch (e) { toast(`Not valid JSON: ${e.message}`, 'err'); }
  } }));
  $('#bodyExtras').replaceChildren(...extras);

  const box = $('#bodyEditor');
  if (b.mode === 'none') box.replaceChildren(ui.emptyPane({ title: 'No body', text: 'Pick a body type above to send one.' }));
  else if (b.mode === 'raw') {
    box.replaceChildren(codeEditor({ value: b.raw, mode: b.lang, label: 'Request body', wrap: state.settings.wrap !== false, placeholder: b.lang === 'json' ? '{ "name": "{{$randomFirstName}}" }' : 'Request body',
      onChange: (v) => { b.raw = v; renderCounts(); markDirty(); } }));
  }
  else if (b.mode === 'urlencoded') { box.replaceChildren(); kvTable(box, b.urlencoded, { onChange: markDirty }); }
  else if (b.mode === 'formdata') { box.replaceChildren(); kvTable(box, b.formdata, { file: true, onChange: markDirty }); }
  else if (b.mode === 'file') {
    const pick = ui.input({ type: 'file', hidden: true, onchange: (e) => { b.fileObj = e.target.files[0] || null; if (b.fileObj) b.fileSrc = b.fileObj.name; markDirty(); renderBody(); } });
    box.replaceChildren(h('div', { class: 'empty-state drop' },
      h('p', null, b.fileObj ? `${b.fileObj.name} (${fmtSize(b.fileObj.size)})` : b.fileSrc ? `${b.fileSrc}: choose it again to send (files aren't stored)` : 'Send a file as the raw request body.'),
      ui.button({ label: b.fileObj ? 'Change file' : 'Choose file', size: 'small', onClick: () => pick.click() }), pick));
  } else if (b.mode === 'graphql') {
    box.replaceChildren(
      ui.field('Query', codeEditor({ value: b.gqlQuery, mode: 'graphql', label: 'GraphQL query', placeholder: 'query { users { id name } }', onChange: (v) => { b.gqlQuery = v; renderCounts(); markDirty(); } }), { grow: true }),
      ui.field('Variables (JSON)', codeEditor({ value: b.gqlVars, mode: 'json', label: 'GraphQL variables', placeholder: '{ "id": 1 }', cls: 'short', onChange: (v) => { b.gqlVars = v; markDirty(); } })));
  } else box.replaceChildren(ui.note(`The "${b.unsupported.mode}" body from Postman isn't supported. It's kept in the file but not sent. Pick another body type to replace it.`, 'warn'));
  const m = t.ed.method;
  if (b.mode !== 'none' && (m === 'HEAD' || m === 'GET')) {
    box.append(ui.note(m === 'HEAD' ? 'HEAD requests never carry a body: this one is left out.'
      : backend.mode === 'local' ? 'Sent with GET, like Postman does. Some servers ignore a GET body (Elasticsearch reads it).'
        : 'Browsers can\'t send a body with GET: it is left out here. Run ApiMan locally to send it.', m === 'HEAD' || backend.mode !== 'local' ? 'warn' : 'muted'));
  }
}

const CM_MODES = {
  json: { name: 'javascript', json: true }, javascript: 'javascript', xml: 'xml', html: 'htmlmixed', text: null,
  graphql: 'javascript', shell: 'shell', python: 'python', java: 'text/x-java', go: 'text/x-go', powershell: 'shell',
};
/**
 * A code editor with line numbers, syntax colours, bracket matching, search (Cmd/Ctrl+F) and, when `fold`
 * is set, collapsible JSON/XML blocks. Tab indents; Esc leaves the editor so keyboard users are never trapped.
 */
function codeEditor({ value = '', mode = 'text', readOnly = false, onChange, placeholder = '', fold = false, label = 'Code', wrap = false, cls = '' }) {
  const host = h('div', { class: `code-editor ${readOnly ? 'readonly' : ''} ${cls}` });
  if (!window.CodeMirror) {
    const ta = h(readOnly ? 'pre' : 'textarea', readOnly ? { class: 'out' } : { class: 'code', spellcheck: 'false', wrap: 'off', placeholder, 'aria-label': label, value, oninput: (e) => onChange && onChange(e.target.value) }, readOnly ? value : null);
    host.append(ta);
    return host;
  }
  const tab = Number(state.settings.tabSize) || 2;
  const cm = CodeMirror(host, {
    value: String(value ?? ''), mode: CM_MODES[mode] ?? null, readOnly, lineNumbers: true, lineWrapping: wrap,
    tabSize: tab, indentUnit: tab, indentWithTabs: false, matchBrackets: true, autoCloseBrackets: !readOnly,
    styleActiveLine: !readOnly, foldGutter: fold, gutters: fold ? ['CodeMirror-linenumbers', 'CodeMirror-foldgutter'] : ['CodeMirror-linenumbers'],
    placeholder, viewportMargin: 30, screenReaderLabel: label, cursorBlinkRate: readOnly ? -1 : 530,
    extraKeys: {
      // Read-only viewers let Tab move on to the next control instead of trapping keyboard focus.
      Tab: readOnly ? false : (c) => (c.somethingSelected() ? c.indentSelection('add') : c.replaceSelection(' '.repeat(c.getOption('indentUnit')), 'end')),
      'Shift-Tab': readOnly ? false : (c) => c.indentSelection('subtract'),
      'Cmd-F': cls.includes('fill') ? () => openFind() : 'findPersistent', 'Ctrl-F': cls.includes('fill') ? () => openFind() : 'findPersistent',
      Esc: (c) => { const d = host.closest('dialog'); c.getInputField().blur(); (d || document.body).focus(); },
    },
  });
  if (onChange) cm.on('change', (c, ch) => { if (ch.origin !== 'setValue') onChange(c.getValue()); });
  cm.on('renderLine', (c, line, el) => { // wrapped continuation lines line up under their first character
    if (!c.getOption('lineWrapping')) return;
    const off = CodeMirror.countColumn(line.text, null, c.getOption('tabSize')) * c.defaultCharWidth();
    if (!off) return;
    el.style.textIndent = `-${off}px`;
    el.style.paddingLeft = `${12 + off}px`;
  });
  host.cm = cm;
  requestAnimationFrame(() => cm.refresh());
  return host;
}
/** CodeMirror can't measure itself while hidden: refresh the editors inside a pane once it is shown. */
function refreshEditors(root) { $$('.CodeMirror', root).forEach((el) => el.CodeMirror && el.CodeMirror.refresh()); }

function tabIndent(e) {
  if (e.key !== 'Tab' || e.shiftKey) return; // Shift+Tab still moves focus, so keyboard users are never trapped
  e.preventDefault();
  const ta = e.target;
  const { selectionStart: s, selectionEnd: en } = ta;
  ta.setRangeText('  ', s, en, 'end');
  ta.dispatchEvent(new Event('input'));
}

let scriptEditor = null;
function renderScripts() {
  const t = cur();
  $$('[data-script]').forEach((c) => { const on = c.dataset.script === t.scriptKind; c.classList.toggle('on', on); c.setAttribute('aria-checked', String(on)); });
  if (!scriptEditor) {
    scriptEditor = codeEditor({ mode: 'javascript', label: 'Script', onChange: (v) => { const tt = cur(); tt.ed[tt.scriptKind === 'pre' ? 'pre' : 'test'] = v; renderCounts(); markDirty(); } });
    $('#scriptEditor').replaceChildren(scriptEditor);
  }
  const value = t.scriptKind === 'pre' ? t.ed.pre : t.ed.test;
  const placeholder = t.scriptKind === 'pre' ? '// Runs before the request is sent' : '// Runs after the response arrives, e.g. pm.test(...)';
  if (scriptEditor.cm) {
    if (scriptEditor.cm.getValue() !== value) scriptEditor.cm.setValue(value);
    scriptEditor.cm.setOption('placeholder', placeholder);
    scriptEditor.cm.clearHistory();
  } else {
    const ta = scriptEditor.querySelector('textarea');
    ta.value = value;
    ta.placeholder = placeholder;
  }
}

const SNIPPETS = {
  pre: [
    ['Set an environment variable', 'pm.environment.set("key", "value");'],
    ['Set a collection variable', 'pm.collectionVariables.set("key", "value");'],
    ['Add a request header', 'pm.request.headers.upsert({ key: "X-Request-Id", value: pm.variables.replaceIn("{{$guid}}") });'],
    ['Log the URL', 'console.log(pm.request.url.toString());'],
  ],
  test: [
    ['Status code is 200', 'pm.test("Status code is 200", () => {\n  pm.response.to.have.status(200);\n});'],
    ['Response time is below 500 ms', 'pm.test("Response time is below 500 ms", () => {\n  pm.expect(pm.response.responseTime).to.be.below(500);\n});'],
    ['Body is JSON with a field', 'pm.test("Body has an id", () => {\n  const body = pm.response.json();\n  pm.expect(body).to.have.property("id");\n});'],
    ['Save a token from the response', 'const body = pm.response.json();\npm.environment.set("token", body.accessToken || body.token);'],
    ['Header is present', 'pm.test("Has Content-Type", () => {\n  pm.response.to.have.header("Content-Type");\n});'],
  ],
};

// ---------- response ----------
function renderResponse() {
  const t = cur();
  const status = $('#respStatus');
  const wsMode = !t.sending && (t.ws || isWsUrl(t.ed.url));
  $('#btnSend').textContent = wsMode ? (t.ws && t.ws.state !== 'closed' ? 'Disconnect' : 'Connect') : t.sending ? 'Cancel' : 'Send';
  if (t.ws && isWsUrl(t.ed.url)) { renderWs(t); renderDiff(); return; }
  const stale = !!(t.sending && !t.out && t.prevOut && t.prevOut.res); // keep the last response visible while sending
  const out = t.out || (stale ? t.prevOut : null);
  queueMicrotask(() => {
    $('#respBody').classList.toggle('stale', stale);
    if (stale) status.replaceChildren(h('span', { class: 'sending' }, 'Sending… ', h('b', { class: 'elapsed' }, '0.0 s')));
  });
  $('#btnSend').classList.toggle('busy', !!t.sending);
  const clearCounts = () => { for (const id of ['#cntRHeaders', '#cntRCookies', '#cntRTests', '#cntRDiff', '#cntRConsole']) $(id).textContent = ''; };
  if ((t.sending && !stale) || !out) {
    status.replaceChildren(t.sending ? h('span', { class: 'sending' }, 'Sending… ', h('b', { class: 'elapsed' }, '0.0 s')) : '');
    clearCounts();
    t.respTab = 'rbody';
    switchPane('#respTabs', 'rbody');
    $('#respTools').hidden = !t.sending; // "Sending..." shows where the status will appear
    $('#respTools').classList.add('no-body');
    $('#respBody').replaceChildren(t.sending
      ? ui.emptyPane({ title: 'Waiting for the response…', text: `${t.ed.method} ${t.ed.url || 'this request'}` })
      : ui.emptyPane({ icon: 'play', title: 'No response yet', text: 'Send the request to see its response here.',
        shortcuts: [[[MOD, 'Enter'], 'Send'], [[MOD, 'S'], 'Save'], [[MOD, 'F'], 'Find in the response']] }));
    renderDiff();
    return;
  }
  const res = out.res;
  const hasRes = res && !out.error;
  status.replaceChildren(...(hasRes ? [
    h('span', { title: `${res.status} ${res.reason || REASONS[res.status] || ''}, ${fmtMs(res.timeMs)}, ${fmtSize(res.size)}` },
      ui.status(res.status, { label: [String(res.status), h('span', { class: 'm-reason' }, ` ${res.reason || REASONS[res.status] || ''}`)] })),
    h('span', { class: 'm-time', title: 'Time' }, ui.value(fmtMs(res.timeMs))),
    h('span', { class: 'm-size', title: 'Size' }, ui.value(fmtSize(res.size)), res.truncated ? ' (truncated)' : ''),
    ...(out.wire && res.finalUrl && res.finalUrl !== out.wire.url ? [ui.pill('Redirected', '', { title: res.finalUrl })] : []),
  ] : [ui.status(null)]));
  const notes = [
    ...(out.error ? [ui.note(out.error, 'err')] : []),
    ...(out.warnings || []).map((w) => ui.note(w, 'warn')),
  ];
  const tests = out.tests || [];
  const failed = tests.filter((x) => x.passed === false).length;
  const passed = tests.filter((x) => x.passed === true).length;
  $('#cntRHeaders').textContent = hasRes ? String(res.headers.length) : '';
  const cookies = hasRes ? parseCookies(res.headers) : [];
  $('#cntRCookies').textContent = cookies.length ? String(cookies.length) : '';
  const ct = $('#cntRTests');
  ct.textContent = tests.length ? `${passed}/${tests.length}` : '';
  ct.className = cx('count', failed ? 'err' : tests.length && 'ok');
  $('#cntRConsole').textContent = out.logs && out.logs.length ? String(out.logs.length) : '';
  switchPane('#respTabs', t.respTab);

  // body
  $('#respTools').hidden = false;
  $('#respTools').classList.toggle('no-body', !hasRes);
  const previewable = hasRes && (/html|xml|svg/.test(contentType(res)) || (res.binary && /^image\//.test(contentType(res))) || (!res.binary && !!res.body));
  const view = t.bodyView === 'preview' && !previewable ? 'pretty' : t.bodyView; // nothing to preview: show Pretty, keep the choice for HTML
  $$('#respTools .seg-btn').forEach((b) => { const on = b.dataset.view === view; b.classList.toggle('on', on); b.setAttribute('aria-checked', String(on)); });
  const pv = $('#respTools [data-view="preview"]');
  pv.disabled = false;
  pv.setAttribute('aria-disabled', String(!previewable));
  pv.title = previewable ? '' : 'Preview shows HTML, images and text; this response has none.';
  clearFind();
  if (!$('#findBar').hidden) setTimeout(() => runFind(0), 0); // keep the open Find bar in sync with the new response
  $('#respBody').replaceChildren(...notes, ...(hasRes ? [bodyView(res, view)] : []));
  // headers
  $('#respHeaders').replaceChildren(...(hasRes ? [h('thead', null, h('tr', null, h('th', null, 'Name'), h('th', null, 'Value'))),
    h('tbody', null, res.headers.map(([k, v]) => h('tr', null, h('td', null, k), h('td', { class: 'mono' }, v))))] : []));
  // cookies
  $('#respCookies').replaceChildren(cookies.length
    ? h('table', { class: 'grid' }, h('thead', null, h('tr', null, ...['Name', 'Value', 'Domain', 'Path', 'Expires', 'Flags'].map((x) => h('th', null, x)))),
      h('tbody', null, cookies.map((c) => h('tr', null, h('td', null, c.name), h('td', { class: 'mono' }, c.value), h('td', null, c.domain || ''), h('td', null, c.path || ''), h('td', null, c.expires || ''), h('td', null, c.flags.join(', '))))))
    : ui.emptyPane({ title: 'No cookies', text: backend.mode === 'local' ? 'The response didn\'t set any.' : 'The response set none that browsers let pages read. Run ApiMan locally to see Set-Cookie headers.' }));
  if (backend.mode === 'local') $('#respCookies').append(ui.actions(ui.button({ label: 'Manage cookies…', size: 'small', onClick: () => openCookies() })));
  // tests
  $('#respTests').replaceChildren(tests.length
    ? h('div', null, ui.hint(`${passed} passed, ${failed} failed${tests.length - passed - failed ? `, ${tests.length - passed - failed} skipped` : ''}`),
      ...tests.map((x) => ui.result(x.passed === false ? 'err' : x.passed === null ? '' : 'ok', x.passed === false ? 'Fail' : x.passed === null ? 'Skip' : 'Pass', x.name, x.passed === false ? x.error : null)))
    : ui.emptyPane({ icon: 'check', title: 'No tests ran', text: 'Right-click a value in the JSON body to add a test for it, or write one in Scripts → Tests:',
      example: 'pm.test("Status is 200", () => {\n  pm.response.to.have.status(200);\n});' }));
  // console
  $('#respConsole').replaceChildren(...(stale ? [ui.emptyPane({ title: 'Sending…', text: 'This send\'s logs appear when it finishes.' })] : out.logs && out.logs.length
    ? out.logs.map((l) => ui.logLine(l.src || '', l.text, { error: 'err', warn: 'warn' }[l.level] || ''))
    : [ui.emptyPane({ title: 'Nothing logged', text: 'console.log() output from scripts appears here.' })]));
  renderDiff();
}

const REASONS = { 200: 'OK', 201: 'Created', 202: 'Accepted', 204: 'No Content', 301: 'Moved Permanently', 302: 'Found', 304: 'Not Modified',
  307: 'Temporary Redirect', 308: 'Permanent Redirect', 400: 'Bad Request', 401: 'Unauthorized', 403: 'Forbidden', 404: 'Not Found',
  405: 'Method Not Allowed', 409: 'Conflict', 415: 'Unsupported Media Type', 422: 'Unprocessable Content', 429: 'Too Many Requests',
  500: 'Internal Server Error', 502: 'Bad Gateway', 503: 'Service Unavailable', 504: 'Gateway Timeout' };

/** Small Markdown renderer for Docs: headings, lists, code, bold, italic, links. Builds DOM nodes, never HTML. */
function renderMarkdown(src) {
  const inline = (text) => {
    const out = [];
    const re = /(`[^`]+`|\*\*[^*]+\*\*|\*[^*]+\*|\[[^\]]+\]\((https?:\/\/[^\s)]+)\))/g;
    let last = 0, m;
    while ((m = re.exec(text))) {
      out.push(text.slice(last, m.index));
      const t = m[0];
      if (t.startsWith('`')) out.push(h('code', { class: 'inline' }, t.slice(1, -1)));
      else if (t.startsWith('**')) out.push(h('strong', null, t.slice(2, -2)));
      else if (t.startsWith('*')) out.push(h('em', null, t.slice(1, -1)));
      else out.push(h('a', { href: m[2], target: '_blank', rel: 'noopener noreferrer' }, t.slice(1, t.indexOf(']'))));
      last = m.index + t.length;
    }
    out.push(text.slice(last));
    return out;
  };
  const blocks = [];
  const lines = String(src || '').split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.startsWith('```')) {
      const code = [];
      for (i++; i < lines.length && !lines[i].startsWith('```'); i++) code.push(lines[i]);
      blocks.push(h('pre', { class: 'code-block' }, code.join('\n')));
    } else if (/^#{1,6}\s/.test(line)) {
      const level = line.match(/^#+/)[0].length;
      blocks.push(h(`h${Math.min(level + 2, 6)}`, null, ...inline(line.replace(/^#+\s/, ''))));
    } else if (/^\s*([-*]|\d+\.)\s/.test(line)) {
      const ordered = /^\s*\d+\./.test(line);
      const items = [];
      for (; i < lines.length && /^\s*([-*]|\d+\.)\s/.test(lines[i]); i++) items.push(h('li', null, ...inline(lines[i].replace(/^\s*([-*]|\d+\.)\s/, ''))));
      i--;
      blocks.push(h(ordered ? 'ol' : 'ul', null, ...items));
    } else if (line.trim()) {
      const para = [line];
      for (; i + 1 < lines.length && lines[i + 1].trim() && !/^(#|```|\s*([-*]|\d+\.)\s)/.test(lines[i + 1]); i++) para.push(lines[i + 1]);
      blocks.push(h('p', null, ...inline(para.join(' '))));
    }
  }
  return blocks.length ? blocks : [h('p', { class: 'hint' }, 'Nothing documented yet. Switch to Write to add notes.')];
}

/** Response HTML made inert for Preview: no refresh/redirect metas, <base>, links, forms or embedded frames. */
function inertHtml(html) {
  const doc = new DOMParser().parseFromString(String(html), 'text/html'); // parsing never runs scripts
  doc.querySelectorAll('meta[http-equiv], base, script, iframe, frame, frameset, object, embed, link').forEach((el) => el.remove());
  doc.querySelectorAll('[href]').forEach((el) => el.removeAttribute('href'));
  doc.querySelectorAll('form').forEach((el) => { el.removeAttribute('action'); el.setAttribute('onsubmit', 'return false'); });
  doc.querySelectorAll('*').forEach((el) => [...el.attributes].forEach((a) => {
    if (/^on/i.test(a.localName) || ['href', 'formaction', 'action', 'src', 'srcset', 'ping', 'background'].includes(a.localName.toLowerCase())) {
      if (a.localName.toLowerCase() === 'src' && /^data:image\//i.test(a.value)) return; // inline images may stay (CSP allows data: images)
      el.removeAttributeNode(a);
    }
  }));
  return doc.documentElement.outerHTML;
}

// ---------- Find in the response: a real toolbar row (never covers text), match count, previous/next ----------
const find = { marks: [], hits: [], i: -1 };
const findCm = () => { const el = $('#respBody .CodeMirror'); return el && el.CodeMirror; };
function openFind() {
  const t = cur();
  if ($('#respTools .seg-btn.on')?.dataset.view === 'preview' && !$('#respTools').classList.contains('no-body')) { // search the source instead
    $('#respTools [data-view="raw"]').click();
    find.restoreView = 'preview'; // undone when Find closes: the user never chose Raw
    toast('Searching the Raw view; Preview comes back when you close Find.', 'muted');
    setTimeout(openFind, 0);
    return;
  }
  if (!findCm()) { toast(t && t.out && t.out.res ? 'This response has no text to search.' : 'Send the request first: Find searches the response body.'); return; }
  $('#findBar').hidden = false;
  $('#btnFindBody').setAttribute('aria-pressed', 'true');
  refreshEditors($('#pane-rbody'));
  $('#findInput').focus();
  $('#findInput').select();
  if ($('#findInput').value) runFind(0);
}
function clearFind() { find.marks.forEach((m) => m.clear()); if (find.current) find.current.clear(); find.current = null; find.marks = []; find.hits = []; find.i = -1; }
function closeFind() {
  clearFind(); $('#findBar').hidden = true; $('#findCount').textContent = ''; $('#btnFindBody').setAttribute('aria-pressed', 'false');
  const cm = findCm(); if (cm) refreshEditors($('#pane-rbody'));
  if (find.restoreView) { const v = find.restoreView; find.restoreView = null; $(`#respTools [data-view="${v}"]`)?.click(); }
  $('#btnFindBody').focus(); // focus goes back to the opener
}
function runFind(start) {
  clearFind();
  const cm = findCm();
  const q = $('#findInput').value;
  if (!cm || !q) { $('#findCount').textContent = ''; return; }
  const caseFold = $('#findCase').getAttribute('aria-pressed') !== 'true';
  const cur = cm.getSearchCursor(q, CodeMirror.Pos(0, 0), { caseFold });
  while (cur.findNext() && find.hits.length < 5000) find.hits.push({ from: cur.from(), to: cur.to() });
  find.marks = find.hits.map((m) => cm.markText(m.from, m.to, { className: 'cm-find' }));
  stepFind(0, start);
}
function stepFind(dir, start = null) {
  const cm = findCm();
  const n = find.hits.length;
  if (!cm || !n) { $('#findCount').textContent = $('#findInput').value ? 'No matches' : ''; return; }
  find.i = start != null ? start : (find.i + dir + n) % n;
  if (find.current) find.current.clear();
  const hit = find.hits[find.i];
  find.current = cm.markText(hit.from, hit.to, { className: 'cm-find-current' });
  cm.scrollIntoView({ from: hit.from, to: hit.to }, Math.max(60, cm.getScrollInfo().clientHeight / 2 - 20)); // centred
  $('#findCount').textContent = `${find.i + 1} of ${n}${n >= 5000 ? '+' : ''}`;
}

function contentType(res) {
  const f = res.headers.find(([k]) => k.toLowerCase() === 'content-type');
  return f ? f[1].toLowerCase() : '';
}

function bodyView(res, view) {
  const ct = contentType(res);
  if (view === 'preview') {
    if (res.binary && /^image\//.test(ct) && res.bodyBase64) return h('img', { class: 'preview', alt: 'Response image', src: `data:${ct.split(';')[0]};base64,${res.bodyBase64}` });
    if (!res.binary && (/html|xml|svg/.test(ct) || res.asHtml)) {
      // No scripts, no network: sandbox="" plus a CSP that only allows inline styles and data: images.
      const frame = h('iframe', { class: 'preview', sandbox: '', title: 'Response preview', referrerpolicy: 'no-referrer' });
      frame.srcdoc = `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:">${inertHtml(res.body)}`;
      return frame;
    }
    if (!res.binary && res.body) {
      return ui.emptyPane({ title: `Served as ${ct.split(';')[0] || 'text'}, not HTML`, text: 'Render it as HTML anyway, in the same sandbox (no scripts, no network)?',
        actions: [ui.button({ label: 'Render as HTML anyway', size: 'small', onClick: () => { res.asHtml = true; renderResponse(); } })] });
    }
    return ui.hint('Preview works for HTML and images. Use Pretty or Raw for this response.');
  }
  if (res.binary) {
    return h('div', { class: 'empty-state drop' }, h('p', null, `Binary response (${ct || 'unknown type'}, ${fmtSize(res.size)}).`),
      ui.button({ label: 'Download', size: 'small', onClick: saveBody }));
  }
  const text = res.body ?? '';
  if (!text) return ui.hint('The response body is empty.');
  const wrap = document.documentElement.dataset.wrap !== 'off'; // follows the Settings preview too
  const langOf = () => (/json/.test(ct) ? 'json' : /html/.test(ct) ? 'html' : /xml|svg/.test(ct) ? 'xml' : /javascript/.test(ct) ? 'javascript' : 'text');
  if (view === 'pretty') {
    try {
      JSON.parse(text); // valid JSON only
      const pretty = prettyJson(text, Number(state.settings.tabSize) || 2);
      if (pretty.length > 2_000_000) return h('pre', { class: 'out' }, pretty); // keep very large bodies fast
      const viewer = codeEditor({ value: pretty, mode: 'json', readOnly: true, fold: true, wrap, label: 'Response body (right-click or the menu key on a value to add a test)', cls: 'fill' });
      if (viewer.cm) attachJsonActions(viewer.cm);
      return viewer;
    } catch { /* not JSON: show as-is below */ }
  }
  if (text.length > 2_000_000) return h('pre', { class: 'out' }, text);
  return codeEditor({ value: text, mode: view === 'pretty' ? langOf() : 'text', readOnly: true, fold: view === 'pretty', wrap, label: 'Response body', cls: 'fill' });
}

/** Re-indent JSON text without parsing values, so 0.0, 1e3 and long integers stay exactly as the server sent them. */
function prettyJson(text, indent) {
  let out = '', depth = 0, inStr = false;
  const nl = () => '\n' + ' '.repeat(depth * indent);
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inStr) { out += c; if (c === '\\') out += text[++i] ?? ''; else if (c === '"') inStr = false; continue; }
    if (c === '"') { inStr = true; out += c; } else if (c === '{' || c === '[') {
      let j = i + 1; while (/\s/.test(text[j] || '')) j++;
      if (text[j] === (c === '{' ? '}' : ']')) { out += c + text[j]; i = j; continue; } // {} and [] stay on one line
      depth++; out += c + nl();
    } else if (c === '}' || c === ']') { depth--; out += nl() + c; } else if (c === ',') out += ',' + nl();
    else if (c === ':') out += ': ';
    else if (!/\s/.test(c)) out += c;
  }
  return out;
}
// ---------- point-and-click tests ----------
// Right-click (or the menu key / Shift+F10 on) any value in the Pretty JSON view: ApiMan writes the pm.test for it.
/** Path (keys and indexes) of the JSON value, or member key, at a character offset. The deepest match wins. */
function jsonPathAt(text, offset) {
  let i = 0, found = null;
  const n = text.length;
  const ws = () => { while (i < n && /\s/.test(text[i])) i++; };
  const str = () => { const s = i; i++; while (i < n && text[i] !== '"') { if (text[i] === '\\') i++; i++; } i++; return [s, i]; };
  const value = (path, depth) => {
    if (depth > 500) throw new Error('too deep');
    ws();
    const s = i, c = text[i];
    if (c === '{') {
      i++; ws();
      if (text[i] === '}') i++;
      else while (i < n) {
        ws();
        const [ks, ke] = str();
        const p = [...path, JSON.parse(text.slice(ks, ke))];
        if (!found && offset >= ks && offset < ke) found = p;
        ws(); i++; // ':'
        value(p, depth + 1);
        ws();
        if (text[i++] !== ',') break;
      }
    } else if (c === '[') {
      i++; ws();
      if (text[i] === ']') i++;
      else for (let k = 0; i < n; k++) { value([...path, k], depth + 1); ws(); if (text[i++] !== ',') break; }
    } else if (c === '"') str();
    else { while (i < n && /[-+\w.]/.test(text[i])) i++; if (i === s) throw new Error('bad JSON'); }
    if (!found && offset >= s && offset < i) found = path;
  };
  try { value([], 0); } catch { return null; }
  return found;
}
const jsAccess = (path, root = 'body') => root + path.map((k) => (typeof k === 'number' ? `[${k}]` : /^[A-Za-z_$][\w$]*$/.test(k) ? `.${k}` : `[${JSON.stringify(k)}]`)).join('');
const pathLabel = (path) => (path.length ? jsAccess(path, '').replace(/^\./, '') : 'the body');
const typePhrase = (t) => (t === 'null' ? 'null' : `${/^[aeiou]/.test(t) ? 'an' : 'a'} ${t}`);
const typeName = (v) => (v === null ? 'null' : Array.isArray(v) ? 'list' : typeof v === 'object' ? 'object' : typeof v);

function testCode(kind, path, v) {
  const x = jsAccess(path), label = pathLabel(path);
  const wrap = (title, line) => `pm.test(${JSON.stringify(title)}, () => {\n  const body = pm.response.json();\n  ${line}\n});`;
  const parent = jsAccess(path.slice(0, -1)), last = path[path.length - 1];
  switch (kind) {
    case 'eq': return wrap(`${label} is ${JSON.stringify(v).slice(0, 60)}`, `pm.expect(${x}).to.eql(${JSON.stringify(v)});`);
    case 'exists': return typeof last === 'number'
      ? wrap(`${pathLabel(path.slice(0, -1))} has at least ${last + 1} item${last ? 's' : ''}`, `pm.expect(${parent}.length).to.be.above(${last});`)
      : wrap(`${label} exists`, `pm.expect(${parent}).to.have.property(${JSON.stringify(last)});`);
    case 'type': {
      const t = typeName(v);
      const line = t === 'null' ? `pm.expect(${x}).to.eql(null);` : t === 'list' ? `pm.expect(Array.isArray(${x})).to.be.true;`
        : t === 'object' ? `pm.expect(${x} !== null && typeof ${x} === "object" && !Array.isArray(${x})).to.be.true;` : `pm.expect(typeof ${x}).to.eql(${JSON.stringify(t)});`;
      return wrap(`${label} is ${typePhrase(t)}`, line);
    }
    case 'nonempty': return wrap(`${label} is not empty`, `pm.expect(${x}.length).to.be.above(0);`);
    default: return '';
  }
}

function addToTests(t, code, what) {
  t.ed.test = (t.ed.test.trim() ? t.ed.test.replace(/\s*$/, '\n\n') : '') + code + '\n';
  t.scriptKind = 'test'; // show where it went
  if (cur() === t) { renderScripts(); renderCounts(); markDirty(); }
  toast(`${what} to Scripts → Tests. It runs on the next send.`);
}

function jsonValueMenu(cm, path, anchor) {
  const t = cur();
  let v;
  try { v = path.reduce((o, k) => o[k], JSON.parse(cm.getValue())); } catch { return; }
  const label = pathLabel(path);
  const shown = JSON.stringify(v);
  const items = [];
  if (shown.length <= 200) items.push({ label: `Test: ${label} is ${shown.length > 40 ? shown.slice(0, 40) + '…' : shown}`, onClick: () => addToTests(t, testCode('eq', path, v), 'Test added') });
  if (path.length) items.push({ label: `Test: ${label} exists`, onClick: () => addToTests(t, testCode('exists', path, v), 'Test added') });
  items.push({ label: `Test: ${label} is ${typePhrase(typeName(v))}`, onClick: () => addToTests(t, testCode('type', path, v), 'Test added') });
  if (Array.isArray(v) || typeof v === 'string') items.push({ label: `Test: ${label} is not empty`, onClick: () => addToTests(t, testCode('nonempty', path, v), 'Test added') });
  items.push('-');
  items.push({ label: 'Save to a variable…', onClick: async () => {
    const guess = String([...path].reverse().find((k) => typeof k === 'string') || 'value').replace(/[^\w-]/g, '_');
    const scope = state.activeEnv ? ['environment', `the "${state.envs[state.activeEnv].name}" environment`] : t.cid ? ['collectionVariables', 'the collection'] : ['globals', 'globals'];
    const name = await ask({ title: 'Save to a variable', message: `After each response, the Tests script stores ${label} in ${scope[1]}, so other requests can use it as {{name}}.`, input: { label: 'Variable name', value: guess }, ok: 'Add' });
    if (!name) return;
    const x = jsAccess(path, 'pm.response.json()');
    const expr = v !== null && typeof v === 'object' ? `JSON.stringify(${x})` : x;
    addToTests(t, `// Save ${label} for other requests: {{${name}}}\npm.${scope[0]}.set(${JSON.stringify(name)}, ${expr});`, 'Variable saving added');
  } });
  items.push({ label: 'Copy path', onClick: () => navigator.clipboard.writeText(jsAccess(path, 'pm.response.json()')).then(() => toast('Copied'), () => toast('Copying was blocked by the browser.', 'err')) });
  showMenu(anchor, items);
}

/** Right-click / menu key on the read-only JSON viewer opens jsonValueMenu at that value. */
function attachJsonActions(cm) {
  const at = (x, y) => {
    let a = $('#ctxAnchor');
    if (!a) { a = h('span', { id: 'ctxAnchor', 'aria-label': 'Response value', class: 'ctx-anchor' }); document.body.append(a); }
    a.style.left = `${x}px`; a.style.top = `${y}px`;
    a.focus = () => cm.focus(); // closing the menu returns focus to the viewer
    return a;
  };
  const open = (pos, x, y) => {
    // A click in the indent, after the end of a line or on ":" / "," means that line's key or value.
    const text = cm.getLine(pos.line) || '';
    let ch = Math.min(pos.ch, text.trimEnd().length - 1);
    if (ch < 0) return false;
    if (/\s/.test(text[ch])) { const k = text.slice(ch).search(/\S/); ch = k < 0 ? ch : ch + k; }
    while (ch > 0 && /[,:\s]/.test(text[ch])) ch--;
    pos = { line: pos.line, ch };
    const path = jsonPathAt(cm.getValue(), cm.indexFromPos(pos));
    if (!path) return false;
    cm.setCursor(pos);
    jsonValueMenu(cm, path, at(x, y));
    return true;
  };
  const wrapper = cm.getWrapperElement();
  wrapper.addEventListener('contextmenu', (e) => {
    if (e.target.closest('.CodeMirror-gutters')) return;
    if (open(cm.coordsChar({ left: e.clientX, top: e.clientY }, 'window'), e.clientX, e.clientY)) e.preventDefault();
  });
  wrapper.addEventListener('keydown', (e) => {
    if (!(e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10'))) return;
    const c = cm.cursorCoords(null, 'window');
    if (open(cm.getCursor(), c.left, c.bottom)) { e.preventDefault(); e.stopPropagation(); }
  }, true);
}

// ---------- response diff ----------
// Compare the latest response with the previous one, a pinned one, or the same request sent with another
// environment (staging vs prod). JSON is compared by field, so key order and formatting never show up as changes.
const VOLATILE_HEADERS = /^(date|age|expires|last-modified|etag|via|server-timing|set-cookie|content-length|report-to|nel|traceparent|tracestate|cf-ray|x-request-id|x-correlation-id|x-trace-id|x-amzn-requestid|x-amzn-trace-id|x-amz-cf-id|x-amz-cf-pop|x-amz-request-id|x-runtime|x-response-time|x-cache|x-cache-hits|x-served-by|x-timer|x-github-request-id|(x-)?ratelimit-(remaining|reset|used))$/i;
const DIFF_LIMIT = 2_000_000; // characters per body

/** Field-level JSON diff. Arrays of objects with a unique id/_id/uuid/key are matched by it, others by position. */
function diffJson(a, b, ignore = () => false, limit = 1000) {
  const changes = [];
  let ignored = 0, truncated = false;
  const kindOf = (v) => (v === null ? 'null' : Array.isArray(v) ? 'array' : typeof v);
  const same = (x, y) => JSON.stringify(x) === JSON.stringify(y);
  const step = (path, k) => (typeof k === 'number' ? `${path}[${k}]` : /^[A-Za-z_$][\w$-]*$/.test(k) ? (path ? `${path}.${k}` : k) : `${path}[${JSON.stringify(k)}]`);
  const idKey = (x, y) => {
    const objs = (arr) => arr.length && arr.every((o) => o && typeof o === 'object' && !Array.isArray(o));
    if (!objs(x) || !objs(y)) return null;
    for (const k of ['id', '_id', 'uuid', 'key']) {
      const ok = (arr) => arr.every((o) => typeof o[k] === 'string' || typeof o[k] === 'number') && new Set(arr.map((o) => o[k])).size === arr.length;
      if (ok(x) && ok(y)) return k;
    }
    return null;
  };
  const add = (c) => { if (changes.length >= limit) truncated = true; else changes.push(c); };
  const walk = (x, y, path, key) => {
    if (truncated) return;
    if (path && ignore(path, key)) { if (!same(x, y)) ignored++; return; }
    const kx = kindOf(x), ky = kindOf(y);
    if (kx !== ky) { add({ type: 'changed', path, before: x, after: y }); return; }
    if (kx === 'object') {
      for (const k of Object.keys(x)) {
        const p = step(path, k);
        if (!Object.hasOwn(y, k)) { if (ignore(p, k)) ignored++; else add({ type: 'removed', path: p, before: x[k] }); } else walk(x[k], y[k], p, k);
      }
      for (const k of Object.keys(y)) if (!Object.hasOwn(x, k)) { const p = step(path, k); if (ignore(p, k)) ignored++; else add({ type: 'added', path: p, after: y[k] }); }
      return;
    }
    if (kx === 'array') {
      const id = idKey(x, y);
      if (id) {
        const at = (o) => `${path}[${id}=${JSON.stringify(o[id])}]`;
        const inY = new Map(y.map((o) => [o[id], o]));
        const inX = new Set(x.map((o) => o[id]));
        const n0 = changes.length;
        for (const o of x) { if (inY.has(o[id])) walk(o, inY.get(o[id]), at(o), null); else add({ type: 'removed', path: at(o), before: o }); }
        for (const o of y) if (!inX.has(o[id])) add({ type: 'added', path: at(o), after: o });
        if (changes.length === n0 && x.map((o) => o[id]).join('\u0000') !== y.map((o) => o[id]).join('\u0000')) add({ type: 'changed', path: path || '(root)', note: 'same items, different order' });
        return;
      }
      for (let i = 0; i < Math.max(x.length, y.length); i++) {
        if (i >= y.length) add({ type: 'removed', path: step(path, i), before: x[i] });
        else if (i >= x.length) add({ type: 'added', path: step(path, i), after: y[i] });
        else walk(x[i], y[i], step(path, i), null);
      }
      return;
    }
    if (x !== y) add({ type: 'changed', path, before: x, after: y });
  };
  walk(a, b, '', null);
  return { changes, ignored, truncated };
}

/**
 * "Ignore" list: a bare name (updatedAt) ignores that field anywhere; a path (data.items[*].etag, meta.*) ignores
 * that path and everything under it. * matches within one segment, [*] any index or id.
 */
function diffIgnoreMatcher(spec) {
  const tokens = String(spec || '').split(/[,\n]/).map((s) => s.trim()).filter(Boolean);
  const names = new Set(tokens.filter((t) => /^[\w$-]+$/.test(t)));
  const res = tokens.filter((t) => !names.has(t)).map((t) => new RegExp('^' + t.replace(/^\$\.?/, '').split('*')
    .map((s) => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('[^.\\[\\]]*') + '(?=$|[.[])'));
  return (path, key) => (key != null && names.has(String(key))) || res.some((re) => re.test(path));
}

/** Line diff (LCS after trimming the common start and end). Very large middles fall back to remove-all/add-all. */
function lineDiff(a, b) {
  const A = a.split('\n'), B = b.split('\n');
  let s = 0;
  while (s < A.length && s < B.length && A[s] === B[s]) s++;
  let e = 0;
  while (e < A.length - s && e < B.length - s && A[A.length - 1 - e] === B[B.length - 1 - e]) e++;
  const a2 = A.slice(s, A.length - e), b2 = B.slice(s, B.length - e);
  const ops = A.slice(0, s).map((l) => [' ', l]);
  const n = a2.length, m = b2.length;
  let coarse = false;
  if ((n + 1) * (m + 1) > 4_000_000) {
    coarse = true;
    a2.forEach((l) => ops.push(['-', l]));
    b2.forEach((l) => ops.push(['+', l]));
  } else {
    const w = m + 1, dp = new Uint32Array((n + 1) * w);
    for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) dp[i * w + j] = a2[i] === b2[j] ? dp[(i + 1) * w + j + 1] + 1 : Math.max(dp[(i + 1) * w + j], dp[i * w + j + 1]);
    let i = 0, j = 0;
    while (i < n && j < m) {
      if (a2[i] === b2[j]) { ops.push([' ', a2[i]]); i++; j++; } else if (dp[(i + 1) * w + j] >= dp[i * w + j + 1]) ops.push(['-', a2[i++]]); else ops.push(['+', b2[j++]]);
    }
    while (i < n) ops.push(['-', a2[i++]]);
    while (j < m) ops.push(['+', b2[j++]]);
  }
  A.slice(A.length - e).forEach((l) => ops.push([' ', l]));
  return { ops, coarse };
}

/** A copy without the ignored fields (same paths as diffJson), so the Lines view hides them too. */
function pruneIgnored(v, ignore, path = '', key = null) {
  const step = (k) => (typeof k === 'number' ? `${path}[${k}]` : /^[A-Za-z_$][\w$-]*$/.test(k) ? (path ? `${path}.${k}` : k) : `${path}[${JSON.stringify(k)}]`);
  if (Array.isArray(v)) {
    const id = ['id', '_id', 'uuid', 'key'].find((k) => v.length && v.every((o) => o && typeof o === 'object' && (typeof o[k] === 'string' || typeof o[k] === 'number')));
    return v.map((x, i) => pruneIgnored(x, ignore, id ? `${path}[${id}=${JSON.stringify(x[id])}]` : step(i), null));
  }
  if (v && typeof v === 'object') {
    const o = {};
    for (const k of Object.keys(v)) { const p = step(k); if (!ignore(p, k)) o[k] = pruneIgnored(v[k], ignore, p, k); }
    return o;
  }
  return v;
}
const sortKeysDeep = (v) => (Array.isArray(v) ? v.map(sortKeysDeep) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, sortKeysDeep(v[k])])) : v);
const parseJsonOrNull = (text) => { try { return { v: JSON.parse(text) }; } catch { return null; } };

/** Everything the Diff tab shows, computed from two outs. */
function compareOuts(before, after, ignoreSpec) {
  const rb = before.res, ra = after.res;
  const ignore = diffIgnoreMatcher(ignoreSpec);
  const r = { status: [rb.status, ra.status], time: [rb.timeMs, ra.timeMs], size: [rb.size, ra.size], headers: [], hiddenHeaders: 0 };
  const hmap = (res) => { const m = new Map(); for (const [k, v] of res.headers || []) { const key = String(k).toLowerCase(); m.set(key, m.has(key) ? `${m.get(key)}, ${v}` : String(v)); } return m; };
  const hb = hmap(rb), ha = hmap(ra);
  for (const k of new Set([...hb.keys(), ...ha.keys()])) {
    if (hb.get(k) === ha.get(k)) continue;
    if (VOLATILE_HEADERS.test(k) || ignore(k, k)) { r.hiddenHeaders++; continue; }
    r.headers.push({ name: k, type: !hb.has(k) ? 'added' : !ha.has(k) ? 'removed' : 'changed', before: hb.get(k), after: ha.get(k) });
  }
  if (rb.binary || ra.binary) { r.body = { kind: 'binary', same: rb.bodyBase64 === ra.bodyBase64 && rb.size === ra.size }; return r; }
  const tb = rb.body ?? '', ta = ra.body ?? '';
  if (tb.length > DIFF_LIMIT || ta.length > DIFF_LIMIT) { r.body = { kind: 'large', same: tb === ta }; return r; }
  const jb = tb.trim() ? parseJsonOrNull(tb) : null, ja = ta.trim() ? parseJsonOrNull(ta) : null;
  if (jb && ja) {
    const d = diffJson(jb.v, ja.v, ignore);
    const canon = (v) => JSON.stringify(sortKeysDeep(pruneIgnored(v, ignore)), null, 2);
    r.body = { kind: 'json', ...d, lines: () => lineDiff(canon(jb.v), canon(ja.v)) };
  } else {
    const d = lineDiff(tb, ta);
    r.body = { kind: 'text', lines: () => d, count: d.ops.filter((o) => o[0] !== ' ').length };
  }
  return r;
}
const diffCount = (r) => (r.status[0] !== r.status[1] ? 1 : 0) + r.headers.length
  + (r.body.kind === 'json' ? r.body.changes.length : r.body.kind === 'text' ? r.body.count : r.body.same ? 0 : 1);

function diffBaseline(t) {
  const w = t.diffWith || 'prev';
  if (w === 'pinned') return t.pinned ? { out: t.pinned, label: 'Pinned' } : null;
  if (w.startsWith('env:')) {
    const id = w.slice(4);
    const o = t.envOuts && t.envOuts[id];
    const name = id ? (state.envs[id] && state.envs[id].name) || 'Removed environment' : 'No environment';
    return o ? { out: o, label: name, envId: id, pending: o.pending } : { out: null, label: name, envId: id };
  }
  return t.prevOut && t.prevOut.res && !t.prevOut.error ? { out: t.prevOut, label: 'Previous' } : null;
}

async function runInEnv(t, envId) {
  t.envOuts = t.envOuts || {};
  t.envOuts[envId] = { pending: true };
  renderDiff();
  const out = await execute({ ed: t.ed, cid: t.cid, itemId: t.itemId, persist: false, envId,
    ask: (m, title = 'Review this script change') => ask({ title, message: m, ok: 'Allow', danger: true, pre: true }) });
  t.envOuts[envId] = out;
  if (cur() === t) renderDiff();
}

function renderDiff() {
  const t = cur();
  const root = $('#respDiff');
  const cnt = $('#cntRDiff');
  if (!t || !root) return;
  const out = t.out;
  cnt.textContent = '';
  cnt.className = 'count';
  const activeName = state.activeEnv && state.envs[state.activeEnv] ? state.envs[state.activeEnv].name : 'No environment';
  const hasOut = out && out.res && !out.error;
  const base = diffBaseline(t);
  // Toolbar: the same .pane-tools row as the Body view (select, filter, then text actions on the right).
  const envChoices = [...(state.activeEnv ? [{ id: '', name: 'No environment' }] : []), ...state.envList.filter((e) => e.id !== state.activeEnv)];
  const picker = ui.select([
    ['prev', 'vs previous response'],
    ['pinned', t.pinned ? `vs pinned (${t.pinned.res.status}, ${new Date(t.pinned.pinnedAt).toLocaleTimeString([], { hour12: false })})` : 'vs pinned (pin one first)', t.pinned ? {} : { disabled: true }],
    ...(envChoices.length ? [{ group: `Send again with another environment (now: ${activeName})`, options: envChoices.map((e) => [`env:${e.id}`, `vs ${e.id ? labelWithFolder(e) : e.name}`]) }] : []),
  ], { size: 'small', 'aria-label': 'Compare the latest response with', title: 'Compare the latest response with…', onChange: (e) => { t.diffWith = e.target.value; renderDiff(); } });
  picker.value = t.diffWith || 'prev';
  if (picker.value !== (t.diffWith || 'prev')) { t.diffWith = 'prev'; picker.value = 'prev'; }
  const ignoreIn = ui.input({ type: 'search', size: 'small', id: 'diffIgnore', spellcheck: 'false', 'aria-label': 'Fields to ignore', placeholder: 'Ignore fields',
    title: 'Comma-separated: a name (updatedAt) ignores it anywhere, a path (data.items[*].etag) ignores that path', value: state.diffIgnore || '',
    onInput: debounce((e) => { state.diffIgnore = e.target.value; ls.set('apiman:diffIgnore', state.diffIgnore); renderDiff(); requestAnimationFrame(() => { const el = $('#diffIgnore'); if (el) { el.focus(); el.setSelectionRange(el.value.length, el.value.length); } }); }, 350) });
  const bar = ui.toolbar([picker, ignoreIn], [
    base && base.envId !== undefined && base.out && !base.pending ? ui.button({ label: 'Resend', variant: 'ghost', size: 'small', title: `Send this request with ${base.label} again`, onClick: () => runInEnv(t, base.envId) }) : null,
    ui.button({ label: 'Pin', variant: 'ghost', size: 'small', disabled: !hasOut, title: 'Keep this response to compare later responses with',
      onClick: () => { t.pinned = { ...out, pinnedAt: Date.now() }; t.diffWith = 'pinned'; toast('Pinned'); renderDiff(); } }),
  ].filter(Boolean));
  const body = [];
  const empty = (o) => body.push(ui.emptyPane({ icon: 'compare', ...o }));
  if (!hasOut) {
    empty({ title: 'Nothing to compare yet', text: 'Send the request. Each response is compared with the previous one, a pinned one, or the same request sent with another environment.' });
  } else if (base && base.envId !== undefined && (!base.out || base.pending)) {
    if (base.pending) empty({ title: `Sending with ${base.label}…` });
    else empty({ title: `Compare with ${base.label}`, text: `Sends this request again with the variables of ${base.label} and compares the two responses. Scripts' variable changes aren't saved.`,
      actions: [ui.button({ label: `Send with ${base.label}`, size: 'small', onClick: () => runInEnv(t, base.envId) })] });
  } else if (!base) {
    empty(t.diffWith === 'pinned' ? { title: 'No pinned response', text: 'Pin a response to compare later ones with it.' } : { title: 'One response so far', text: 'Send again to compare the next response with this one, or pin this one.' });
  } else if (base.out.error || !base.out.res) {
    body.push(ui.note(`The ${base.label} request failed: ${base.out.error || 'no response'}`, 'err'));
    if (base.envId !== undefined) body.push(ui.actions(ui.button({ label: 'Try again', size: 'small', onClick: () => runInEnv(t, base.envId) })));
  } else {
    const r = compareOuts(base.out, out, state.diffIgnore);
    const n = diffCount(r);
    cnt.textContent = String(n);
    cnt.className = cx('count', !n && 'ok');
    const left = base.label, right = base.envId !== undefined ? activeName : 'latest';
    const pair = (x, y, fmt) => (x === y ? fmt(y) : ui.value(`${fmt(x)} → ${fmt(y)}`));
    body.push(ui.hint([`${left} → ${right}: status `, pair(r.status[0], r.status[1], String), ', time ', pair(r.time[0], r.time[1], fmtMs), ', size ', pair(r.size[0], r.size[1], fmtSize)]));
    const val = (v) => (v === undefined ? '–' : JSON.stringify(v));
    const short = (s) => (s.length > 300 ? s.slice(0, 300) + '…' : s);
    // One change per row, like the Tests tab: pill, what changed, then before → after.
    const row = (type, name, before, after) => ui.result(type === 'added' ? 'ok' : type === 'removed' ? 'err' : 'warn', type[0].toUpperCase() + type.slice(1),
      h('span', { class: 'mono' }, name), h('span', { class: 'mono' }, before, ' → ', after));
    const section = (title, summary, extra) => ui.sectionHead(title, summary, extra);
    const b = r.body;
    if (b.kind === 'json') {
      const view = t.diffView || 'fields';
      const toggle = ui.seg([['fields', 'Fields'], ['lines', 'Lines']], view, (k) => { t.diffView = k; renderDiff(); }, { label: 'Diff view' });
      body.push(section('Body', `${b.changes.length ? `${b.changes.length}${b.truncated ? '+' : ''} change${b.changes.length === 1 ? '' : 's'}` : 'same JSON'}${b.ignored ? `, ${b.ignored} ignored` : ''}`, toggle));
      if (view === 'lines') body.push(renderLineDiff(b.lines(), left, right));
      else body.push(...b.changes.map((c) => row(c.type, c.path || '(root)', c.note ? '' : short(val(c.before)), c.note || short(val(c.after)))));
      if (b.truncated && view !== 'lines') body.push(ui.hint('Showing the first 1000 changes.'));
    } else if (b.kind === 'text') {
      body.push(section('Body', b.count ? `${b.count} changed line${b.count === 1 ? '' : 's'}` : 'same text'));
      if (b.count) body.push(renderLineDiff(b.lines(), left, right));
    } else {
      body.push(section('Body', `${b.same ? 'same' : 'different'}${b.kind === 'large' ? ' (too large to compare here)' : ' (binary)'}`));
    }
    body.push(section('Headers', `${r.headers.length ? `${r.headers.length} changed` : 'same'}${r.hiddenHeaders ? `, ${r.hiddenHeaders} that change every time not shown` : ''}`));
    body.push(...r.headers.map((c) => row(c.type, c.name, short(c.before ?? '–'), short(c.after ?? '–'))));
  }
  root.replaceChildren(bar, ...body);
}

function renderLineDiff({ ops, coarse }, leftLabel, rightLabel) {
  const CONTEXT = 3;
  const rows = [];
  let ln = 0, rn = 0;
  const keep = ops.map((o, i) => o[0] !== ' ' || ops.slice(Math.max(0, i - CONTEXT), i + CONTEXT + 1).some((x) => x[0] !== ' '));
  for (let i = 0; i < ops.length; i++) {
    const [op, text] = ops[i];
    if (!keep[i]) {
      let j = i; while (j < ops.length && !keep[j]) j++;
      const skipped = j - i;
      const from = i;
      const row = h('tr', { class: 'gap' }, h('td', { colspan: 3 }, ui.button({ label: `Show ${skipped} unchanged line${skipped === 1 ? '' : 's'}`, variant: 'ghost', size: 'small', onClick: () => {
        const extra = [];
        let a = ln0, b = rn0;
        for (let k = from; k < from + skipped; k++) { a++; b++; extra.push(h('tr', null, h('td', { class: 'n' }, String(a)), h('td', { class: 'n' }, String(b)), h('td', { class: 'mono' }, ops[k][1]))); }
        row.replaceWith(...extra);
      } })));
      const ln0 = ln, rn0 = rn;
      rows.push(row);
      ln += skipped; rn += skipped; i = j - 1;
      continue;
    }
    if (op !== '+') ln++;
    if (op !== '-') rn++;
    rows.push(h('tr', { class: op === '+' ? 'ins' : op === '-' ? 'del' : '' }, h('td', { class: 'n' }, op === '+' ? '' : String(ln)), h('td', { class: 'n' }, op === '-' ? '' : String(rn)),
      h('td', { class: 'mono' }, h('span', { class: 'sign', 'aria-hidden': 'true' }, op === ' ' ? ' ' : op), text)));
  }
  return h('div', { class: 'line-diff' },
    coarse ? ui.hint('Too many changed lines to align precisely; showing removed then added lines.') : null,
    h('table', { 'aria-label': `Line changes from ${leftLabel} to ${rightLabel}` }, h('tbody', null, rows)));
}

function escapeHtml(s) { return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function highlightJson(json) {
  return escapeHtml(json).replace(/(&quot;(?:\\.|(?!&quot;)[^\\])*?&quot;)(\s*:)?|\b(true|false|null)\b|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/g, (m, str, colon, lit) => {
    if (str) return colon ? `<span class="j-key">${str}</span>${colon}` : `<span class="j-str">${str}</span>`;
    if (lit) return `<span class="j-lit">${m}</span>`;
    return `<span class="j-num">${m}</span>`;
  });
}

function parseCookies(headers) {
  return headers.filter(([k]) => k.toLowerCase() === 'set-cookie').map(([, v]) => {
    const [pair, ...attrs] = v.split(';').map((s) => s.trim());
    const eq = pair.indexOf('=');
    const c = { name: eq === -1 ? pair : pair.slice(0, eq), value: eq === -1 ? '' : pair.slice(eq + 1), flags: [] };
    for (const a of attrs) {
      const [k, ...rest] = a.split('=');
      const key = k.toLowerCase();
      const val = rest.join('=');
      if (key === 'domain') c.domain = val;
      else if (key === 'path') c.path = val;
      else if (key === 'expires') c.expires = val;
      else if (key === 'max-age') c.expires = `in ${val} s`;
      else c.flags.push(val ? `${k}=${val}` : k);
    }
    return c;
  });
}

function saveBody() {
  const t = cur();
  const res = t && t.out && t.out.res;
  if (!res) return;
  const ct = contentType(res).split(';')[0];
  const ext = { 'application/json': 'json', 'text/html': 'html', 'application/xml': 'xml', 'text/xml': 'xml', 'text/plain': 'txt', 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'application/pdf': 'pdf', 'text/csv': 'csv' }[ct] || (res.binary ? 'bin' : 'txt');
  const name = `${(t.ed.name || 'response').replace(/[^\w.-]+/g, '-')}.${ext}`;
  download(name, res.binary ? new Blob([b64ToBytes(res.bodyBase64 || '')], { type: ct }) : res.body, ct || 'text/plain');
}

// =====================================================================================================
// Actions: send, save
// =====================================================================================================
// ---------- WebSocket ----------
// A ws:// or wss:// URL turns the tab into a WebSocket client: Send becomes Connect, the response pane a live
// message log with a composer. It uses the browser's own WebSocket (so it works in both modes, through your VPN).
const isWsUrl = (url) => /^\s*wss?:\/\//i.test(String(url || ''));
const WS_LOG_MAX = 2000;

function wsConnect(t) {
  const vars = merged(scopesFor(t.cid));
  const url = resolve(t.ed.url, vars).trim();
  const missing = unresolved([url]);
  if (missing.length) { toast(missingVarMessage(missing, vars), 'err'); return; }
  try { new URL(url); } catch { toast(`"${url}" isn't a valid URL.`, 'err'); return; }
  const headers = t.ed.headers.filter((x) => !x.disabled && x.key);
  const proto = headers.find((x) => /^sec-websocket-protocol$/i.test(x.key));
  const protocols = proto ? resolve(proto.value, vars).split(',').map((s) => s.trim()).filter(Boolean) : [];
  const ignored = headers.filter((x) => x !== proto).map((x) => x.key);
  const ws = { url, log: [], state: 'connecting', opened: 0 };
  t.ws = ws;
  const add = (dir, data, extra = {}) => {
    ws.log.push({ dir, data, at: Date.now(), ...extra });
    if (ws.log.length > WS_LOG_MAX) ws.log.splice(0, ws.log.length - WS_LOG_MAX);
    if (cur() === t) renderWsLog(t, dir === 'in' || dir === 'out');
  };
  if (ignored.length) add('info', `Browsers can't send custom headers on a WebSocket, so ${ignored.join(', ')} ${ignored.length > 1 ? 'were' : 'was'} not sent. Put tokens in a query parameter, or the Sec-WebSocket-Protocol header (sent as the subprotocol).`);
  let sock;
  try { sock = protocols.length ? new WebSocket(url, protocols) : new WebSocket(url); } catch (e) { ws.state = 'closed'; add('err', e.message); renderResponse(); return; }
  sock.binaryType = 'arraybuffer';
  ws.sock = sock;
  add('info', `Connecting to ${url}${protocols.length ? ` (subprotocol ${protocols.join(', ')})` : ''}…`);
  sock.onopen = () => { ws.state = 'open'; ws.opened = Date.now(); add('info', `Connected${sock.protocol ? `, subprotocol ${sock.protocol}` : ''}.`); if (cur() === t) renderResponse(); };
  sock.onmessage = (e) => {
    if (typeof e.data === 'string') add('in', e.data);
    else add('in', `(binary, ${fmtSize(e.data.byteLength)}) ${bufToB64(new Uint8Array(e.data)).slice(0, 2000)}`, { binary: true });
  };
  sock.onerror = () => add('err', 'Connection error (the browser doesn\'t say more: check the URL, and that the server accepts WebSocket connections from this page).');
  sock.onclose = (e) => {
    ws.state = 'closed';
    add('info', `Disconnected${e.code ? ` (code ${e.code}${e.reason ? `: ${e.reason}` : ''})` : ''}${ws.opened ? ` after ${fmtMs(Date.now() - ws.opened)}` : ''}.`);
    if (cur() === t) renderResponse();
  };
  renderResponse();
}
function wsDisconnect(t) { if (t.ws && t.ws.sock && t.ws.state !== 'closed') t.ws.sock.close(1000, 'Closed in ApiMan'); }
function wsSend(t, text) {
  const ws = t.ws;
  if (!ws || ws.state !== 'open') { toast('Connect first.', 'warn'); return false; }
  const msg = resolve(text, merged(scopesFor(t.cid)));
  ws.sock.send(msg);
  ws.log.push({ dir: 'out', data: msg, at: Date.now() });
  renderWsLog(t, true);
  return true;
}

function renderWs(t) {
  const ws = t.ws;
  const status = $('#respStatus');
  const label = { connecting: 'Connecting…', open: 'Connected', closed: 'Disconnected' }[ws.state];
  status.replaceChildren(ui.value(label, ws.state === 'open' ? 'ok' : ws.state === 'closed' ? 'err' : ''),
    h('span', { class: 'm-time' }, `${ws.log.filter((m) => m.dir === 'in').length} in, ${ws.log.filter((m) => m.dir === 'out').length} out`));
  for (const id of ['#cntRHeaders', '#cntRCookies', '#cntRTests', '#cntRDiff', '#cntRConsole']) $(id).textContent = '';
  t.respTab = 'rbody';
  switchPane('#respTabs', 'rbody');
  $('#respTools').hidden = true;
  const send = () => { if (wsSend(t, input.value)) { input.value = ''; t.wsDraft = ''; input.focus(); } };
  const input = ui.textarea({ code: true, short: true, rows: 3, 'aria-label': 'Message to send', placeholder: ws.state === 'open' ? 'Message: {{variables}} work' : 'Connect to send messages', value: t.wsDraft || '',
    onInput: (e) => { t.wsDraft = e.target.value; },
    onkeydown: (e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); e.stopPropagation(); send(); } } });
  // Same building blocks as the rest of the response pane: a .pane-tools row, Console-style lines, small buttons.
  const tools = ui.toolbar([ui.input({ type: 'search', size: 'small', id: 'wsFilter', placeholder: 'Filter messages', 'aria-label': 'Filter messages', value: t.wsFilter || '', onInput: (e) => { t.wsFilter = e.target.value; renderWsLog(t, false); } })],
    [ui.button({ label: 'Clear', variant: 'ghost', size: 'small', onClick: () => { ws.log = []; renderWsLog(t, false); } })]);
  const compose = h('div', { class: 'ws-compose' }, input,
    ui.toolbar([ui.hint(`${MOD}+Enter sends`)], [ui.button({ label: 'Send', size: 'small', disabled: ws.state !== 'open', onClick: send })]));
  $('#respBody').replaceChildren(h('div', { class: 'ws' }, tools, h('div', { class: 'console ws-log', id: 'wsLog', role: 'log', 'aria-live': 'polite' }), compose));
  renderWsLog(t, true);
}
function renderWsLog(t, stick) {
  const box = $('#wsLog');
  if (!box || cur() !== t) return;
  const atEnd = box.scrollHeight - box.scrollTop - box.clientHeight < 40;
  const f = (t.wsFilter || '').toLowerCase();
  const rows = t.ws.log.filter((m) => !f || String(m.data).toLowerCase().includes(f)).slice(-500).map((m) => {
    let body = String(m.data);
    if ((m.dir === 'in' || m.dir === 'out') && /^\s*[[{]/.test(body)) { try { JSON.parse(body); body = prettyJson(body, 2); } catch { /* as sent */ } }
    const time = new Date(m.at).toLocaleTimeString([], { hour12: false }) + '.' + String(m.at % 1000).padStart(3, '0');
    return ui.logLine(`${{ in: '↓', out: '↑', info: '·', err: '!' }[m.dir]} ${time}`, body, m.dir === 'err' ? 'err' : m.dir === 'info' ? 'muted' : '', { title: { in: 'Received', out: 'Sent', info: 'Info', err: 'Error' }[m.dir] });
  });
  box.replaceChildren(...(rows.length ? rows : [ui.hint(f ? 'No messages match.' : 'No messages yet.')]));
  if (stick && atEnd) { box.scrollTop = box.scrollHeight; requestAnimationFrame(() => { box.scrollTop = box.scrollHeight; }); } // follow new messages unless you scrolled up
  const st = $('#respStatus .m-time');
  if (st) st.textContent = `${t.ws.log.filter((m) => m.dir === 'in').length} in, ${t.ws.log.filter((m) => m.dir === 'out').length} out`;
}

async function send() {
  const t = cur();
  if (!t) return;
  if (t.ws && t.ws.state !== 'closed') { wsDisconnect(t); return; }
  if (isWsUrl(t.ed.url)) { wsConnect(t); return; }
  if (t.ws) { t.ws = null; } // the URL is HTTP again
  if (t.sending) {
    // Cancel: show it immediately; a late answer from the server is ignored below.
    t.sending.abort();
    t.sending = null;
    t.out = t.prevOut || { error: 'Request cancelled.', tests: [], logs: [], warnings: [] };
    if (t.prevOut) toast('Request cancelled. Showing the previous response.', 'muted');
    renderResponse();
    return;
  }
  const ctrl = new AbortController();
  t.sending = ctrl;
  t.prevOut = t.out && t.out.res ? t.out : null;
  t.out = null;
  renderResponse();
  const started = performance.now();
  const ticker = setInterval(() => { // elapsed time while waiting
    if (t.sending !== ctrl) { clearInterval(ticker); return; }
    if (cur() === t) $$('.elapsed').forEach((el) => { el.textContent = `${((performance.now() - started) / 1000).toFixed(1)} s`; });
  }, 100);
  const out = await execute({ ed: t.ed, cid: t.cid, itemId: t.itemId, signal: ctrl.signal, ask: (m, title = 'Review this script change') => ask({ title, message: m, ok: 'Allow', danger: true, pre: true }) });
  if (t.sending !== ctrl) return; // superseded
  t.sending = null;
  t.out = out;
  persistTabs(); // the last response survives a reload
  if (out.tests.some((x) => x.passed === false)) t.respTab = 'rtests';
  else if (out.error && out.logs.some((l) => l.level === 'error')) t.respTab = 'rconsole';
  else if (t.respTab === 'rtests' || t.respTab === 'rconsole') t.respTab = 'rbody';
  pushHistory(t, out);
  if (cur() === t) { renderResponse(); renderResolved(); }
  if (state.view === 'environments') renderSidebar();
}

async function save() {
  const t = cur();
  if (!t) return;
  if (!t.cid || !state.cols[t.cid] || !locate(state.cols[t.cid], t.itemId)) return saveAs();
  const loc = locate(state.cols[t.cid], t.itemId);
  const previous = loc.item;
  loc.list[loc.index] = toItem(t.ed, loc.item);
  try {
    await saveCol(t.cid);
  } catch (e) {
    // roll back, so a later unrelated save can't write these "unsaved" edits (a 409 already reloaded the doc)
    if (!e.message.includes('changed in another window') && loc.list[loc.index] !== previous) loc.list[loc.index] = previous;
    toast(`Couldn't save: ${e.message}`, 'err');
    return;
  }
  t.dirty = false;
  persistTabs();
  renderTabs();
  renderSidebar();
  $('#dirtyDot').hidden = true;
  toast('Saved');
}

async function saveAs() {
  const t = cur();
  if (!state.colList.length) {
    if (!(await ask({ title: 'Create a collection first', message: 'Requests are saved inside collections, and you have none yet.', ok: 'Create collection' }))) return;
    await newCollection();
    if (!state.colList.length) return;
  }
  await Promise.all(state.colList.map((c) => withCol(c.id).catch(() => {})));
  const nameIn = ui.input({ value: t.ed.name, spellcheck: 'false' });
  const targets = [];
  for (const c of state.colList) {
    const col = state.cols[c.id];
    if (!col) continue;
    targets.push({ label: labelWithFolder(c), cid: c.id, folderId: null });
    const walk = (items, depth) => { for (const it of items) if (isFolder(it)) { targets.push({ label: `${'  '.repeat(depth)}${labelWithFolder(c)} / ${it.name}`, cid: c.id, folderId: it.id }); walk(it.item, depth + 1); } };
    walk(col.item, 1);
  }
  const sel = ui.select(targets.map((x, i) => [String(i), x.label]), { value: String(Math.max(0, targets.findIndex((x) => t.cid === x.cid && !x.folderId))) });
  openDialog({
    title: 'Save request',
    body: [ui.field('Name', nameIn), ui.field('Save to', sel)],
    buttons: [{ label: 'Save', primary: true, onClick: async () => {
      const target = targets[Number(sel.value)];
      t.ed.name = nameIn.value.trim() || t.ed.name;
      const col = state.cols[target.cid];
      const folder = target.folderId ? locate(col, target.folderId) : null;
      if (target.folderId && !folder) throw new Error('That folder no longer exists. Pick another place to save.');
      const list = folder ? folder.item.item : col.item;
      const item = toItem(t.ed);
      list.push(item);
      try { await saveCol(target.cid); } catch (e) {
        const i = list.indexOf(item); if (i !== -1) list.splice(i, 1); // no duplicate on retry
        throw e;
      }
      Object.assign(t, { cid: target.cid, itemId: item.id, dirty: false });
      state.open.add(target.cid);
      if (target.folderId) state.open.add(`${target.cid}:${target.folderId}`);
      saveOpen();
      persistTabs();
      renderAll();
      toast('Saved');
      return true;
    } }],
  });
  setTimeout(() => nameIn.select(), 30);
}

// =====================================================================================================
// Dialogs
// =====================================================================================================
const dialogQueue = [];
let dialogSeq = 0, closingSeq = null;
/** Automation's own window (#automation): it never saves the API client's tabs (they're the main window's, and would be stale). */
const automationWin = { only: location.hash === '#automation', aside: false };
if (automationWin.only) window.name = 'apiman-automation'; // Run → Automation brings this window forward, however it was opened
// aborts the collection run going in this page; outlives one Automation view (Edit environment reopens it), so Stop still reaches it
let suiteCtrl = null;
const dialogCloses = new Map(); // dialog number -> its onClose
/** Opens the dialog, or queues it if one is already open, so a background prompt never replaces your open dialog. */
function openDialog(opts) {
  if ($('#dlg').open) { dialogQueue.push(opts); return; }
  renderDialog(opts);
}
/** Settings docks beside the app only while the app keeps at least 1000px; otherwise it overlays. */
function canDock() { const side = $('.side')?.offsetWidth || 0; return innerWidth > 900 && innerWidth - 360 >= side + 2 * 320 * cssScale() + 16; } // panes stay side by side
function updateDock() {
  const dlg = $('#dlg');
  if (!dlg.open || !dlg.classList.contains('drawer')) return;
  const docked = canDock();
  if (docked === dlg.classList.contains('docked')) return;
  const focused = document.activeElement;
  dlg.dataset.reshowing = '1'; dlg.close(); // re-open in the right mode; the draft stays (the close listener clears the flag)
  dlg.classList.toggle('docked', docked);
  document.documentElement.classList.toggle('drawer-open', docked);
  if (docked) dlg.show(); else dlg.showModal();
  if (focused && dlg.contains(focused)) focused.focus({ preventScroll: true });
}
window.addEventListener('resize', () => requestAnimationFrame(updateDock));
function renderDialog({ title, body, buttons = [], wide = false, full = false, page = false, confirm = false, tall = false, drawer = false, cancel = 'Cancel', closable = true, onClose, focus, onOpen }) {
  const dlg = $('#dlg');
  $('.dlg-head .btn.icon').hidden = !closable; // closable: false = a whole window (Automation's), no ✕ and no Esc
  dlg.dataset.locked = closable ? '' : '1';
  dlg.classList.toggle('wide', wide);
  dlg.classList.toggle('full', full);
  dlg.classList.toggle('page', full && page); // the whole window, no scrim or frame (Automation's own window)
  dlg.classList.toggle('confirm', confirm);
  $('#dlgBody').classList.toggle('tall', tall); // dialogs with tabs keep one height, so nothing jumps under the cursor
  $('#dlg').classList.toggle('drawer', drawer); // docked at the side: the app shrinks beside it, so previews stay visible
  const docked = drawer && canDock(); // the app keeps a representative width beside it
  document.documentElement.classList.toggle('drawer-open', docked);
  dlg.classList.toggle('docked', docked);
  // Every dialog gets the same footer: [destructive/left actions]  ...  Cancel  Primary
  if (cancel && !buttons.some((b) => b.label === 'Cancel')) {
    const at = buttons.findIndex((b) => b.primary || b.solid);
    buttons = [...buttons];
    buttons.splice(at === -1 ? buttons.length : at, 0, { label: cancel, onClick: () => true });
  }
  $('#dlgTitle').textContent = title;
  $('#dlgBody').replaceChildren(...[body].flat().filter((x) => x != null && x !== false));
  linkLabels($('#dlgBody'));
  // Dialog footer: the one place primary buttons live (DESIGN.md §3, Buttons)
  $('#dlgFoot').replaceChildren(...buttons.map((b) => ui.button({
    label: b.label, variant: cx(b.primary && 'primary', b.danger && 'danger', b.solid && 'solid'), cls: b.left ? 'push-left' : '',
    onClick: async (e) => {
      const btn = e.currentTarget;
      btn.disabled = true;
      const mine = dialogSeq;
      try { if (await b.onClick() && dialogSeq === mine && dlg.open) dlg.close(); } catch (err) { toast(err.message, 'err'); } finally { btn.disabled = false; }
    },
  })));
  dialogSeq += 1;
  dialogCloses.set(dialogSeq, onClose || null);
  if (!dlg.open) { if (dlg.classList.contains('docked')) dlg.show(); else dlg.showModal(); } // docked: the app stays usable beside it
  if (onOpen) onOpen(); // before focus: it may enable/disable buttons
  requestAnimationFrame(() => $$('#dlgBody .seg').forEach((sg) => fitTabs(sg)));
  // Start on the first field, not on the close button (or on what the dialog asks for).
  const first = [...$('#dlgBody').querySelectorAll('input:not([type=checkbox]):not([type=file]):not([type=range]):not([type=color]):not([disabled]):not([readonly]), select, textarea')].find((el) => el.getClientRects().length); // first visible field
  if (focus) ($(focus) || dlg).focus();
  else if (first) first.focus();
  else ($('#dlgFoot .btn.primary') || $('#dlgFoot .btn:last-child') || dlg).focus();
  // Never leave focus on the page behind: fall back to the first visible control in the dialog.
  if (!dlg.contains(document.activeElement)) [...dlg.querySelectorAll('button, input, select, textarea, [tabindex="0"]')].find((el) => el.getClientRects().length && !el.disabled)?.focus();
}
function closeDialog() { $('#dlg').close(); }

/** Themed replacement for prompt()/confirm(): resolves to the entered text / true, or null / false when cancelled. */
function ask({ title, message, input, ok = 'OK', cancel = 'Cancel', danger = false, pre = false }) {
  return new Promise((resolve) => {
    let settled = false;
    const settle = (v) => { if (!settled) { settled = true; resolve(v); } };
    const field = input ? ui.input({ value: input.value || '', placeholder: input.placeholder || '', spellcheck: 'false', autocomplete: 'off' }) : null;
    const submit = () => {
      if (field && !field.value.trim()) { field.focus(); return false; }
      settle(field ? field.value.trim() : true);
      return true;
    };
    if (field) field.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); if (submit()) closeDialog(); } });
    openDialog({
      title,
      body: [
        message ? ui.hint(message, { class: cx('hint', pre && 'pre-line') }) : null,
        field ? ui.field(input.label, field) : null,
      ],
      confirm: true,
      cancel: false, // the footer below already has it
      buttons: [
        { label: cancel, onClick: () => { settle(field ? null : false); return true; } },
        { label: ok, primary: !danger, danger, solid: danger, onClick: submit },
      ],
      onClose: () => settle(field ? null : false),
      // Enter never confirms something destructive: focus Cancel for danger prompts
      focus: field ? null : (danger ? '#dlgFoot .btn:first-child' : '#dlgFoot .btn:last-child'),
      onOpen: () => { if (field) field.select(); },
    });
  });
}

/** Ties every .field label to its control, so clicking the label works and screen readers name the control. */
let labelSeq = 0;
function linkLabels(root) {
  for (const lab of $$('.field > label:not([for])', root)) {
    const ctl = lab.parentElement.querySelector('input:not([type=checkbox]):not([type=file]), select, textarea');
    if (!ctl) continue;
    if (!ctl.id) ctl.id = `fld-${++labelSeq}`;
    lab.htmlFor = ctl.id;
  }
}

/** Tabs inside a dialog: Segmented tabs in the dialog's tab slot. */
function dlgTabs(defs, onChange) { return ui.tabs(defs, onChange, { cls: 'dlg-tabs' }); }

function scriptsPair(model) {
  const mk = (key, label, ph) => ui.field(label, codeEditor({ value: model[key], mode: 'javascript', label, placeholder: ph.split('\n')[0], cls: 'short', onChange: (v) => { model[key] = v; } }));
  return [
    mk('pre', 'Pre-request: runs before every request inside', '// e.g. refresh a timestamp\npm.collectionVariables.set("now", Date.now());'),
    mk('test', 'Tests: run after every request inside', 'pm.test("No server errors", () => pm.expect(pm.response.code).to.be.below(500));'),
    ui.hint('Scripts run sandboxed: they can\'t make network calls of their own or read your stored data, and ApiMan asks before a script changes which server a request goes to.'),
  ];
}

/** Collection (folderId = null) or folder settings: name, auth, variables, scripts, docs. */
async function editContainer(cid, folderId) {
  const col = await withCol(cid);
  const target = folderId ? locate(col, folderId).item : col;
  const isCol = !folderId;
  const model = {
    name: isCol ? col.info.name : target.name,
    auth: (() => { const a = authIn(target.auth); return a.type === 'inherit' ? { type: isCol ? 'noauth' : 'inherit' } : a; })(),
    vars: isCol ? (col.variable || []).map((v) => ({ key: v.key || '', value: String(v.value ?? ''), disabled: !!v.disabled, type: v.type === 'secret' ? 'secret' : 'default' })) : [],
    pre: scriptIn(target.event, 'prerequest'),
    test: scriptIn(target.event, 'test'),
    docs: docIn(isCol ? col.info.description : target.description),
  };
  const nameIn = ui.input({ value: model.name, spellcheck: 'false', onInput: (e) => { model.name = e.target.value; } });
  const varsBox = h('div');
  if (isCol) kvTable(varsBox, model.vars, { secret: true, placeholders: ['Variable', 'Value'] });
  const defs = [
    { key: 'auth', label: 'Auth', content: authForm(model.auth, { allowInherit: !isCol, inheritText: () => 'Uses the auth of the parent folder or collection.', onChange: () => {}, vars: () => merged(scopesFor(cid)) }) },
    ...(isCol ? [{ key: 'vars', label: 'Variables', content: [varsBox, ui.hint('Use as {{name}} anywhere in this collection. Environment values win over these when both exist.')] }] : []),
    { key: 'scripts', label: 'Scripts', content: scriptsPair(model) },
    { key: 'docs', label: 'Docs', content: ui.textarea({ prose: true, rows: 8, value: model.docs, onInput: (e) => { model.docs = e.target.value; } }) },
  ];
  openDialog({
    title: isCol ? 'Collection settings' : 'Folder settings',
    wide: true,
    tall: true,
    body: [ui.field('Name', nameIn), ...dlgTabs(defs)],
    buttons: [{ label: 'Save', primary: true, onClick: async () => {
      // apply to the CURRENT document (a conflict may have reloaded it since this dialog opened)
      const col = state.cols[cid] || await withCol(cid);
      const target = folderId ? (locate(col, folderId) || {}).item : col;
      if (!target) throw new Error('That folder no longer exists.');
      const auth = authOut(model.auth);
      if (auth && !(isCol && auth.type === 'noauth')) target.auth = auth; else delete target.auth;
      const ev = scriptsOut(target.event, model.pre, model.test);
      if (ev) target.event = ev; else delete target.event;
      if (isCol) {
        col.info.name = model.name.trim() || col.info.name;
        col.variable = model.vars.filter((v) => v.key).map((v) => ({ key: v.key, value: v.value, ...(v.disabled ? { disabled: true } : {}), ...(v.type === 'secret' ? { type: 'secret' } : {}) }));
        if (model.docs) col.info.description = model.docs; else delete col.info.description;
      } else {
        target.name = model.name.trim() || target.name;
        if (model.docs) target.description = model.docs; else delete target.description;
      }
      await saveCol(cid);
      await refreshCollections();
      renderAll();
      toast('Settings saved');
      return true;
    } }],
  });
}

async function editEnvironment(id, folder = '') {
  const isGlobals = id === GLOBALS_ID;
  const doc = id ? (isGlobals ? await ensureGlobals() : state.envs[id]) : { name: '', values: [], _postman_variable_scope: 'environment' };
  if (!doc) return;
  const rows = doc.values.map((v) => ({ key: v.key || '', value: String(v.value ?? ''), disabled: v.enabled === false, type: v.type === 'secret' ? 'secret' : 'default' }));
  const openedKeys = new Set(rows.map((r) => r.key)); // to tell variables added elsewhere from ones deleted here
  const nameIn = ui.input({ value: isGlobals ? 'Globals' : doc.name, placeholder: 'e.g. Local, Staging, Production', disabled: isGlobals, spellcheck: 'false' });
  const box = h('div');
  const dupNote = h('div');
  const checkDups = () => { // the last one wins (like Postman): say so, rather than quietly sending somewhere else
    const seen = new Map();
    for (const r of rows) if (r.key && !r.disabled) seen.set(r.key, (seen.get(r.key) || 0) + 1);
    const dups = [...seen].filter(([, n]) => n > 1).map(([k]) => k);
    dupNote.replaceChildren(dups.length ? ui.note(`${dups.map((k) => `"${k}"`).join(', ')} ${dups.length > 1 ? 'are' : 'is'} defined more than once: only the last one is used. Delete or rename the others.`, 'warn') : '');
  };
  kvTable(box, rows, { secret: true, placeholders: ['Variable', 'Value'], onChange: checkDups });
  checkDups();
  const activateCheck = ui.check({ label: 'Use this environment', checked: !id || id === state.activeEnv });
  const activate = activateCheck.input;
  openDialog({
    title: isGlobals ? 'Globals' : id ? 'Edit environment' : folder ? `New environment in ${folder}` : 'New environment',
    wide: true,
    body: [
      isGlobals ? ui.hint('Globals apply everywhere, with the lowest priority: environment and collection values win.') : ui.field('Name', nameIn),
      box,
      dupNote,
      ui.hint('Secret values are hidden on screen. Like everything in ApiMan they are stored only on this computer.'),
      isGlobals ? null : activateCheck,
    ],
    buttons: [
      ...(id && !isGlobals ? [{ label: 'Delete', danger: true, onClick: async () => { closeDialog(); await deleteEnvironment(id); return false; } }] : []),
      { label: 'Save', primary: true, onClick: async () => {
        const name = isGlobals ? 'Globals' : nameIn.value.trim();
        if (!name) { toast('Give the environment a name.', 'warn'); return false; }
        const values = rows.filter((r) => r.key).map((r) => ({ key: r.key, value: r.value, type: r.type === 'secret' ? 'secret' : 'default', enabled: !r.disabled }));
        let envId = id;
        if (id) {
          if (!state.envs[id]) throw new Error('This environment no longer exists (deleted in another window?).');
          // On a conflict mutateDoc reloads and re-applies: rows edited here win, rows another window added are kept.
          await mutateDoc('environments', id, (d) => {
            const mine = new Set(values.map((v) => v.key));
            d.name = name;
            d.values = [...values, ...(d.values || []).filter((v) => !openedKeys.has(v.key) && !mine.has(v.key))];
            return true;
          });
        }
        else { doc.name = name; doc.values = values; envId = await backend.environments.create(doc, folder); openCategory(folder); }
        await refreshEnvironments();
        if (!isGlobals) setActiveEnv(activate.checked ? envId : (state.activeEnv === envId ? '' : state.activeEnv));
        renderSidebar();
        renderResolved();
        toast('Environment saved');
        return true;
      } },
    ],
  });
}

async function duplicateEnvironment(id) {
  const copy = JSON.parse(JSON.stringify(state.envs[id]));
  copy.name = `${copy.name} copy`;
  await backend.environments.create(copy, folderOf(state.envList, id));
  await refreshEnvironments();
  renderSidebar();
  renderEnvPicker();
}

async function deleteEnvironment(id) {
  if (!(await ask({ title: 'Delete environment?', message: `"${state.envs[id].name}" and its variables will be deleted.`, ok: 'Delete environment', danger: true }))) return;
  await backend.environments.remove(id);
  delete state.envs[id];
  if (state.activeEnv === id) setActiveEnv('');
  await refreshEnvironments();
  renderSidebar();
  renderEnvPicker();
}

function renderEnvPicker() {
  const sel = $('#envSelect');
  sel.replaceChildren(h('option', { value: '' }, 'No environment'),
    ...state.envList.map((e) => h('option', { value: e.id, ...(e.id === state.activeEnv ? { selected: true } : {}) }, labelWithFolder(e))),
    h('option', { value: '__new' }, '+ New environment…'));
  sel.value = state.activeEnv || '';
  $('#envDot').classList.toggle('ok', !!state.activeEnv); // Dot: live when an environment is active
}

function peekVariables(anchor) {
  const t = cur();
  const sections = [
    ['Environment', state.activeEnv && state.envs[state.activeEnv] ? state.envs[state.activeEnv].values : null, state.activeEnv && state.envs[state.activeEnv] && state.envs[state.activeEnv].name],
    ['Collection', t && t.cid && state.cols[t.cid] ? state.cols[t.cid].variable || [] : null, t && t.cid && state.cols[t.cid] && state.cols[t.cid].info.name],
    ['Globals', state.envs[GLOBALS_ID] ? state.envs[GLOBALS_ID].values : [], ''],
  ];
  const pop = $('#popover');
  const peek = h('div', { class: 'peek' });
  for (const [label, values, name] of sections) {
    peek.append(ui.sectionHead(name ? `${label}: ${name}` : label));
    if (!values) { peek.append(ui.hint(label === 'Environment' ? 'No environment selected.' : 'Open a saved request to see its collection variables.')); continue; }
    const on = values.filter((v) => v.key && v.enabled !== false && !v.disabled);
    if (!on.length) { peek.append(ui.hint('No variables.')); continue; }
    peek.append(h('table', { class: 'grid' }, h('tbody', null, on.map((v) => {
      const secret = v.type === 'secret' || SECRET_HEADER.test(v.key) || /key$/i.test(v.key);
      const value = String(v.value ?? '');
      const cell = h('td', { class: 'v', title: secret ? '' : value }, secret ? '••••••••' : value);
      let shown = false;
      return h('tr', null, h('td', { title: v.key }, v.key), cell,
        h('td', { class: 'r' }, secret ? ui.iconButton('eye', `Show ${v.key}`, (e) => { shown = !shown; cell.textContent = shown ? value : '••••••••'; cell.title = shown ? value : ''; e.currentTarget.replaceChildren(icon(shown ? 'eyeOff' : 'eye')); }, { size: 'small' }) : null));
    }))));
  }
  peek.append(ui.actions(
    ui.button({ label: state.activeEnv ? 'Edit environment' : 'New environment', size: 'small', onClick: () => { hideMenu(); if (state.activeEnv) editEnvironment(state.activeEnv); else editEnvironment(null); } }),
    ui.button({ label: 'Edit globals', size: 'small', onClick: () => { hideMenu(); editEnvironment(GLOBALS_ID); } })));
  pop.replaceChildren(peek);
  pop.setAttribute('role', 'dialog'); // a table and buttons, not a menu
  pop.setAttribute('aria-label', 'Variables in use');
  placePopover(pop, anchor);
  showMenu.anchor = anchor;
  (peek.querySelector('button') || pop).focus();
}

// ---------- import ----------
/** folder: import into that folder of the data folder ("Import here" on a category row). */
function openImport(start = 'file', folder = '') {
  const fileIn = ui.input({ type: 'file', 'aria-label': 'Files to import', accept: '.json,.yaml,.yml,application/json,application/yaml', multiple: true, hidden: true, onchange: (e) => importFiles([...e.target.files], folder) });
  const drop = h('div', {
    class: 'empty-state drop',
    ondragover: (e) => { e.preventDefault(); },
    ondrop: (e) => { e.preventDefault(); importFiles([...e.dataTransfer.files], folder); },
  }, h('p', null, 'Drop Postman collections or environments (v2.1 JSON), or OpenAPI / Swagger specs (JSON or YAML), here.'),
    ui.button({ label: 'Choose files', size: 'small', onClick: () => fileIn.click() }), fileIn);
  const curlIn = ui.textarea({ code: true, 'aria-label': 'cURL command', rows: 10, placeholder: "curl -X POST 'https://api.example.com/items' \\\n  -H 'Authorization: Bearer …' \\\n  -H 'Content-Type: application/json' \\\n  --data-raw '{\"name\":\"x\"}'" });
  const pasteIn = ui.textarea({ code: true, 'aria-label': 'Postman collection, environment, or OpenAPI spec', rows: 10, placeholder: 'Paste a Postman collection or environment (JSON),\nor an OpenAPI / Swagger spec (JSON or YAML)' });
  const defs = [
    { key: 'file', label: 'File', content: [drop, ui.hint('In Postman: ⋯ on a collection → Export → Collection v2.1. An OpenAPI spec becomes a collection with example bodies, auth and tests that check each response against the spec.')] },
    { key: 'curl', label: 'cURL', content: [curlIn] },
    { key: 'paste', label: 'Paste', content: [pasteIn] },
  ];
  const run = {
    file: () => fileIn.click(),
    curl: () => { try { const ed = parseCurl(curlIn.value); closeDialog(); openTab(newTab({ ed, dirty: true })); toast('Imported from cURL'); } catch (e) { toast(e.message, 'err'); } },
    paste: async () => { try { await importJson(parseSpecText(pasteIn.value), 'The pasted text', folder); closeDialog(); } catch (e) { toast(e.message, 'err'); } },
  };
  let activeKey = 'file';
  const updateImport = () => {
    const btn = $('#dlgFoot .btn.primary');
    if (!btn) return;
    const ready = activeKey === 'curl' ? curlIn.value.trim() : activeKey === 'paste' ? pasteIn.value.trim() : '';
    btn.disabled = !ready;
    btn.title = activeKey === 'file' ? 'Choose or drop files above; they import right away.' : '';
  };
  curlIn.addEventListener('input', updateImport);
  pasteIn.addEventListener('input', updateImport);
  const tabsAndPanes = dlgTabs(defs, (k) => { activeKey = k; updateImport(); });
  openDialog({
    title: folder ? `Import into ${folder}` : 'Import', body: tabsAndPanes, onOpen: updateImport, focus: '#dlgBody .dlg-tabs .on',
    buttons: [{ label: 'Import', primary: true, onClick: () => { run[activeKey](); return false; } }],
  });
  if (start !== 'file') $$('#dlgBody .dlg-tabs .seg-btn')[start === 'curl' ? 1 : 2].click();
  setTimeout(() => { if (start === 'curl') curlIn.focus(); }, 50);
}

async function importFiles(files, folder = '') {
  let ok = 0;
  for (const f of files) {
    try { await importJson(parseSpecText(await f.text()), f.name, folder); ok++; } catch (e) { toast(`${f.name}: ${e.message}`, 'err'); }
  }
  if (ok) closeDialog();
}

async function importJson(data, label, folder = '') {
  if (isOpenApi(data)) {
    const col = openApiToCollection(data);
    await importJson(col, label, folder);
    const creds = col.variable.filter((v) => v.key !== 'baseUrl').map((v) => v.key);
    toast(`Imported ${countRequests(col.item)} requests from "${col.info.name}".${creds.length ? ` Set ${creds.join(', ')} in its variables.` : ''}`);
    return;
  }
  if (data && data.info && Array.isArray(data.item)) {
    ensureIds(data.item);
    data.info.schema = data.info.schema || SCHEMA_V21;
    const id = await backend.collections.create(data, folder);
    state.open.add(id);
    openCategory(folder);
    await refreshCollections();
    state.view = 'collections';
    renderSidebar();
    let scripts = 0;
    const count = (ev) => { if (Array.isArray(ev) && ev.some((e) => e && e.script)) scripts++; };
    count(data.event);
    const walk = (items) => items.forEach((it) => { count(it.event); if (Array.isArray(it.item)) walk(it.item); });
    walk(data.item);
    toast(`Imported "${data.info.name}"${scripts ? `. Its ${scripts} script${scripts > 1 ? 's' : ''} will run sandboxed, with no network access.` : ''}`);
    return;
  }
  if (data && typeof data.name === 'string' && Array.isArray(data.values)) {
    if (data._postman_variable_scope === 'globals') {
      const g = await ensureGlobals();
      for (const v of data.values) { const e = g.values.find((x) => x.key === v.key); if (e) Object.assign(e, v); else g.values.push(v); }
      await backend.environments.put(GLOBALS_ID, g);
      await refreshEnvironments();
      toast('Imported globals');
    } else {
      const id = await backend.environments.create(data, folder);
      openCategory(folder);
      await refreshEnvironments();
      if (!state.activeEnv) setActiveEnv(id);
      renderEnvPicker();
      toast(`Imported environment "${data.name}"`);
    }
    state.view = 'environments';
    renderSidebar();
    return;
  }
  if (data && Array.isArray(data.requests)) throw new Error('This is an old Postman v1 collection. In Postman, export it again as Collection v2.1.');
  if (data && typeof data === 'object' && (data.openapi || data.swagger)) throw new Error(`${label} looks like OpenAPI, but it has no "paths" (or it's Swagger 1.x, which isn't supported).`);
  throw new Error(`${label} isn't a Postman collection, environment, or OpenAPI spec.`);
}

// ---------- YAML (the block subset OpenAPI specs use) ----------
/** JSON, or the YAML that API specs use: mappings, sequences, quoted/plain/flow scalars, | and > blocks, << merges. */
function parseSpecText(text) {
  const t = String(text).replace(/^﻿/, '');
  if (/^\s*[[{]/.test(t)) { try { return JSON.parse(t); } catch (_) { /* flow-style YAML */ } }
  return parseYaml(t);
}
function parseYaml(src) {
  const lines = String(src).replace(/\r\n?/g, '\n').split('\n');
  let i = 0;
  const fail = (msg) => { throw new Error(`YAML line ${i + 1}: ${msg}`); };
  const indentOf = (l) => l.match(/^ */)[0].length;
  const blank = (l) => /^\s*$/.test(l);
  const ignorable = (l) => /^\s*(#.*)?$/.test(l) || /^(---|\.\.\.)(\s.*)?$/.test(l) || /^%/.test(l);
  const skip = () => { while (i < lines.length && ignorable(lines[i])) i++; };
  const isItem = (t) => /^-(\s|$)/.test(t);
  // End index of the quoted string starting at t[0], or -1 when it isn't closed.
  const quoteEnd = (t) => {
    const q = t[0];
    for (let j = 1; j < t.length; j++) {
      if (q === '"' && t[j] === '\\') j++;
      else if (t[j] === q) { if (q === "'" && t[j + 1] === q) j++; else return j; }
    }
    return -1;
  };
  const stripComment = (s) => {
    let q = null;
    for (let k = 0; k < s.length; k++) {
      const c = s[k];
      if (q) {
        if (q === '"' && c === '\\') k++;
        else if (c === q) { if (q === "'" && s[k + 1] === "'") k++; else q = null; }
      } else if ((c === '"' || c === "'") && (k === 0 || /[\s[{,:-]/.test(s[k - 1]))) q = c;
      else if (c === '#' && (k === 0 || /\s/.test(s[k - 1]))) return s.slice(0, k).trimEnd();
    }
    return s.trimEnd();
  };
  const unquote = (s) => {
    if (s[0] === "'") return s.slice(1, -1).replace(/''/g, "'");
    return s.slice(1, -1).replace(/\\(x[0-9a-fA-F]{2}|u[0-9a-fA-F]{4}|U[0-9a-fA-F]{8}|[\s\S])/g, (m, e) => {
      if (/^[xuU]./.test(e)) return String.fromCodePoint(parseInt(e.slice(1), 16));
      return { n: '\n', t: '\t', r: '\r', 0: '\0', b: '\b', f: '\f', e: '\x1b', _: ' ', N: '\u0085' }[e] ?? e;
    });
  };
  const plain = (s) => {
    s = s.trim();
    if (s === '' || s === '~' || /^null$/i.test(s)) return null;
    if (/^(true|false)$/i.test(s)) return s.toLowerCase() === 'true';
    if (/^[-+]?\d+$/.test(s)) { const n = Number(s); return Number.isSafeInteger(n) ? n : s; }
    if (/^0x[0-9a-fA-F]+$/.test(s)) return parseInt(s, 16);
    if (/^[-+]?(\d+\.\d*|\.\d+|\d+)([eE][-+]?\d+)?$/.test(s)) return Number(s);
    if (/^[-+]?\.inf$/i.test(s)) return s[0] === '-' ? -Infinity : Infinity;
    if (/^\.nan$/i.test(s)) return NaN;
    return s;
  };
  // Flow collections: [a, b], {k: v}, nested, with quoted or plain scalars.
  const flow = (s) => {
    let p = 0;
    const ws = () => { while (p < s.length && /\s/.test(s[p])) p++; };
    const scalar = (stops) => {
      ws();
      if (s[p] === '"' || s[p] === "'") {
        const e = quoteEnd(s.slice(p));
        if (e < 0) fail('unclosed quote');
        const out = unquote(s.slice(p, p + e + 1)); p += e + 1; return out;
      }
      let j = p;
      while (j < s.length && !stops.includes(s[j]) && !(s[j] === ':' && /[\s,\]}]/.test(s[j + 1] ?? ' '))) j++;
      const out = plain(s.slice(p, j)); p = j; return out;
    };
    const value = () => {
      ws();
      if (s[p] === '[') {
        p++; const arr = [];
        for (;;) {
          ws(); if (s[p] === ']') { p++; return arr; } if (p >= s.length) fail('unclosed [');
          arr.push(value()); ws(); if (s[p] === ',') p++; else if (s[p] !== ']') fail('expected , or ]');
        }
      }
      if (s[p] === '{') {
        p++; const obj = {};
        for (;;) {
          ws(); if (s[p] === '}') { p++; return obj; } if (p >= s.length) fail('unclosed {');
          const k = scalar(',}'); ws();
          let v = null;
          if (s[p] === ':') { p++; v = value(); }
          Object.defineProperty(obj, String(k), { value: v, enumerable: true, writable: true, configurable: true });
          ws(); if (s[p] === ',') p++; else if (s[p] !== '}') fail('expected , or }');
        }
      }
      return scalar(',]}');
    };
    const v = value(); ws();
    if (p < s.length) fail(`unexpected "${s.slice(p, p + 10)}"`);
    return v;
  };
  const balanced = (s) => {
    let d = 0, q = null;
    for (let k = 0; k < s.length; k++) {
      const c = s[k];
      if (q) { if (q === '"' && c === '\\') k++; else if (c === q) q = null; } else if (c === '"' || c === "'") q = c; else if ('[{'.includes(c)) d++; else if (']}'.includes(c)) d--;
    }
    return d <= 0 && !q;
  };
  const splitKey = (t) => {
    if (t[0] === '"' || t[0] === "'") {
      const e = quoteEnd(t);
      if (e < 0) return null;
      const m = t.slice(e + 1).match(/^\s*:(\s+|$)/);
      return m ? { key: unquote(t.slice(0, e + 1)), rest: t.slice(e + 1 + m[0].length) } : null;
    }
    if (/^[[{]/.test(t) || isItem(t)) return null;
    const m = t.match(/^(.*?):(\s+|$)/);
    return m ? { key: m[1].trim(), rest: t.slice(m[0].length) } : null;
  };
  const blockScalar = (header, ind) => {
    const m = header.match(/^([|>])([+-]?)(\d?)([+-]?)$/);
    const style = m[1], chomp = m[2] || m[4], explicit = Number(m[3]) || 0;
    const raw = [];
    while (i < lines.length && (blank(lines[i]) || indentOf(lines[i]) > ind)) raw.push(lines[i++]);
    let bi = explicit ? ind + explicit : 0;
    if (!bi) { const first = raw.find((l) => !blank(l)); bi = first ? indentOf(first) : ind + 1; }
    const body = raw.map((l) => l.slice(bi));
    let trailing = 0;
    while (body.length && body[body.length - 1].trim() === '') { body.pop(); trailing++; }
    let out = '';
    if (style === '|') out = body.join('\n');
    else {
      body.forEach((l, k) => {
        if (k === 0) { out = l; return; }
        const prev = body[k - 1];
        if (l === '') out += '\n';
        else if (prev === '' || /^\s/.test(l) || /^\s/.test(prev)) out += (prev === '' ? '' : '\n') + l;
        else out += ' ' + l;
      });
    }
    if (!body.length) return '';
    if (chomp === '-') return out;
    if (chomp === '+') return out + '\n'.repeat(trailing + 1);
    return out + '\n';
  };
  // A scalar that began on the line just consumed, continuing over deeper-indented lines.
  const inlineValue = (rest, ind) => {
    rest = rest.replace(/^(&\S+|!\S*)\s*/, '').replace(/^(&\S+|!\S*)\s*/, '');
    if (/^\*\S+$/.test(rest)) fail('YAML aliases (*name) aren\'t supported; save the spec as JSON instead.');
    if (/^[|>][+-]?\d?[+-]?$/.test(rest)) return blockScalar(rest, ind);
    if (rest === '') return undefined;
    let text = rest;
    const quoted = /^["']/.test(text), flowy = /^[[{]/.test(text);
    const open = () => (quoted && quoteEnd(text) < 0) || (flowy && !balanced(text));
    while (i < lines.length && (blank(lines[i]) || indentOf(lines[i]) > ind)) {
      if ((quoted || flowy) && !open()) break;
      const nxt = lines[i].trim();
      if (quoted) { text += '\n' + nxt; i++; continue; } // folded below
      if (!open() && /^#/.test(nxt)) break;
      if (nxt === '') {
        let j = i; while (j < lines.length && blank(lines[j])) j++;
        if (j >= lines.length || indentOf(lines[j]) <= ind) break; // trailing blanks end the scalar
        text += '\n'; i = j; continue;
      }
      text += (text.endsWith('\n') ? '' : ' ') + (open() ? nxt : stripComment(nxt));
      i++;
    }
    if (open()) fail('unclosed quote or bracket');
    if (quoted) {
      const e = quoteEnd(text);
      if (text.slice(e + 1).trim()) fail(`unexpected text after a quoted value: "${text.slice(e + 1, e + 21).trim()}"`);
      // line folding: one line break becomes a space, each blank line a newline
      return unquote(text.slice(0, e + 1).replace(/[ \t]*\n((?:[ \t]*\n)*)[ \t]*/g, (m, blanks) => (blanks ? '\n'.repeat(blanks.split('\n').length - 1) : ' ')));
    }
    if (flowy) return flow(text);
    return plain(text.replace(/ ?\n ?/g, '\n'));
  };
  const node = (minIndent) => {
    skip();
    if (i >= lines.length) return null;
    const ind = indentOf(lines[i]);
    if (ind < minIndent) return null;
    const t = stripComment(lines[i].slice(ind));
    if (isItem(t)) return seq(ind);
    if (splitKey(t)) return map(ind);
    i++;
    return inlineValue(t, ind - 1) ?? null;
  };
  const afterKey = (rest, ind) => {
    const v = inlineValue(rest, ind);
    if (v !== undefined) return v;
    skip();
    if (i >= lines.length) return null;
    const ni = indentOf(lines[i]);
    if (ni > ind) return node(ind + 1);
    if (ni === ind && isItem(lines[i].slice(ind))) return seq(ind);
    return null;
  };
  const map = (ind) => {
    const obj = {};
    for (;;) {
      skip();
      if (i >= lines.length) break;
      const li = indentOf(lines[i]);
      if (li < ind) break;
      if (li > ind) fail('unexpected indentation');
      const t = stripComment(lines[i].slice(ind));
      if (isItem(t)) break;
      const kv = splitKey(t);
      if (!kv) fail(`expected "key: value", got "${t.slice(0, 40)}"`);
      i++;
      const v = afterKey(kv.rest, ind);
      if (kv.key === '<<' && v && typeof v === 'object') Object.assign(obj, ...(Array.isArray(v) ? v : [v]));
      else Object.defineProperty(obj, kv.key, { value: v, enumerable: true, writable: true, configurable: true }); // "__proto__" stays a plain key
    }
    return obj;
  };
  const seq = (ind) => {
    const arr = [];
    for (;;) {
      skip();
      if (i >= lines.length || indentOf(lines[i]) !== ind) break;
      const t = stripComment(lines[i].slice(ind));
      if (!isItem(t)) break;
      const after = t.slice(1);
      const pad = after.match(/^\s*/)[0].length;
      const item = after.slice(pad);
      if (item === '') { i++; skip(); arr.push(i < lines.length && indentOf(lines[i]) > ind ? node(ind + 1) : null); continue; }
      if (isItem(item) || splitKey(item)) { lines[i] = ' '.repeat(ind + 1 + pad) + item; arr.push(node(ind + 1)); continue; } // "- key: v" opens a mapping at the item's column
      i++;
      arr.push(inlineValue(item, ind) ?? null);
    }
    return arr;
  };
  const out = node(0);
  skip();
  if (i < lines.length) fail('unexpected content (check the indentation)');
  return out;
}

// ---------- OpenAPI / Swagger ----------
const isOpenApi = (d) => !!d && typeof d === 'object' && !Array.isArray(d) && (typeof d.openapi === 'string' || String(d.swagger) === '2.0') && !!d.paths && typeof d.paths === 'object';

/** OpenAPI 3.x or Swagger 2.0 → a Postman v2.1 collection: folders by tag, example bodies, auth, and contract tests. */
function openApiToCollection(spec) {
  const v2 = !spec.openapi;
  const METHODS = ['get', 'put', 'post', 'delete', 'options', 'head', 'patch', 'trace'];
  const isObj = (o) => !!o && typeof o === 'object' && !Array.isArray(o);
  const pointer = (ref) => {
    if (typeof ref !== 'string' || !ref.startsWith('#/')) return undefined; // external files can't be followed
    let cur = spec;
    for (const part of ref.slice(2).split('/')) {
      const k = decodeURIComponent(part).replace(/~1/g, '/').replace(/~0/g, '~');
      if (!cur || typeof cur !== 'object' || !Object.hasOwn(cur, k)) return undefined;
      cur = cur[k];
    }
    return cur;
  };
  const deref = (o) => { for (let n = 0; isObj(o) && typeof o.$ref === 'string' && n < 20; n++) o = pointer(o.$ref); return isObj(o) ? o : {}; };
  const str = (v) => (v == null ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v));

  // Example value for a schema: example > default > enum > type. A $ref already being expanded stops the cycle.
  const sample = (schema, stack = [], mode = 'request') => {
    if (stack.length > 12) return undefined;
    const ref = isObj(schema) && typeof schema.$ref === 'string' ? schema.$ref : null;
    if (ref && stack.includes(ref)) return undefined;
    const st = ref ? [...stack, ref] : [...stack, null];
    const s = deref(schema);
    if (s.example !== undefined) return s.example;
    if (Array.isArray(s.examples) && s.examples.length) return s.examples[0];
    if (s.const !== undefined) return s.const;
    if (s.default !== undefined) return s.default;
    if (Array.isArray(s.enum) && s.enum.length) return s.enum[0];
    if (Array.isArray(s.allOf)) {
      const parts = s.allOf.map((x) => sample(x, st, mode));
      const own = isObj(s.properties) ? sample({ ...s, allOf: undefined }, st, mode) : undefined;
      if ([...parts, own].every((p) => p === undefined || isObj(p))) return Object.assign({}, ...parts.filter(Boolean), own || {});
      return parts.find((p) => p !== undefined);
    }
    for (const k of ['oneOf', 'anyOf']) if (Array.isArray(s[k]) && s[k].length) return sample(s[k][0], st, mode);
    const type = Array.isArray(s.type) ? s.type.find((x) => x !== 'null') : s.type;
    if (type === 'object' || (!type && (isObj(s.properties) || isObj(s.additionalProperties)))) {
      const o = {};
      for (const [k, p] of Object.entries(isObj(s.properties) ? s.properties : {})) {
        const pd = deref(p);
        if ((mode === 'request' && pd.readOnly) || (mode === 'response' && pd.writeOnly)) continue;
        const v = sample(p, st, mode);
        if (v !== undefined) o[k] = v;
      }
      if (!Object.keys(o).length && isObj(s.additionalProperties)) { const v = sample(s.additionalProperties, st, mode); if (v !== undefined) o.key = v; }
      return o;
    }
    if (type === 'array') { const v = sample(s.items, st, mode); return v === undefined ? [] : [v]; }
    if (type === 'integer' || type === 'number') return typeof s.minimum === 'number' ? s.minimum : 0;
    if (type === 'boolean') return true;
    if (type === 'string' || (!type && s.format)) {
      return ({ 'date-time': '2024-01-01T00:00:00Z', date: '2024-01-01', time: '12:00:00', email: 'user@example.com', uuid: '3fa85f64-5717-4562-b3fc-2c963f66afa6',
        uri: 'https://example.com', url: 'https://example.com', hostname: 'example.com', ipv4: '192.0.2.1', ipv6: '2001:db8::1', byte: 'U3dhZ2dlciByb2Nrcw==',
        password: 'password', binary: '' })[s.format] ?? 'string';
    }
    return undefined;
  };
  const paramValue = (p) => {
    if (p.example !== undefined) return str(p.example);
    if (isObj(p.examples)) { const e = deref(Object.values(p.examples)[0]); if (e.value !== undefined) return str(e.value); }
    const v = sample(v2 ? p : (p.schema || {}));
    return Array.isArray(v) ? v.map(str).join(',') : str(v);
  };

  // Base URL → the {{baseUrl}} collection variable
  let baseUrl;
  if (v2) {
    const scheme = (Array.isArray(spec.schemes) && spec.schemes[0]) || 'https';
    baseUrl = spec.host ? `${scheme}://${spec.host}${spec.basePath || ''}` : String(spec.basePath || '');
  } else {
    const srv = Array.isArray(spec.servers) && isObj(spec.servers[0]) ? spec.servers[0] : { url: '' };
    baseUrl = String(srv.url || '').replace(/{([^{}]+)}/g, (m, k) => { const d = isObj(srv.variables) && isObj(srv.variables[k]) ? srv.variables[k].default : undefined; return d != null ? String(d) : m; });
  }
  baseUrl = baseUrl.replace(/\/+$/, '');
  if (!/^[a-z][\w+.-]*:\/\//i.test(baseUrl)) baseUrl = 'http://localhost' + (baseUrl && !baseUrl.startsWith('/') ? '/' : '') + baseUrl;
  const variable = [{ key: 'baseUrl', value: baseUrl }];
  const addVar = (key) => { if (!variable.some((v) => v.key === key)) variable.push({ key, value: '' }); };

  // Auth → collection auth plus per-request overrides
  const schemes = (v2 ? spec.securityDefinitions : spec.components && spec.components.securitySchemes) || {};
  const pair = (o) => Object.entries(o).map(([key, value]) => ({ key, value, type: 'string' }));
  const authFor = (security) => {
    if (!Array.isArray(security)) return undefined;
    if (!security.length || security.some((r) => isObj(r) && !Object.keys(r).length)) return { type: 'noauth' };
    for (const req of security) {
      for (const name of Object.keys(isObj(req) ? req : {})) {
        const sc = deref(isObj(schemes) ? schemes[name] : undefined);
        const type = String(sc.type || '').toLowerCase();
        if ((type === 'http' && /^bearer$/i.test(sc.scheme)) || type === 'oauth2' || type === 'openidconnect') {
          addVar('bearerToken');
          return { type: 'bearer', bearer: pair({ token: '{{bearerToken}}' }) };
        }
        if ((type === 'http' && /^basic$/i.test(sc.scheme)) || type === 'basic') {
          addVar('username'); addVar('password');
          return { type: 'basic', basic: pair({ username: '{{username}}', password: '{{password}}' }) };
        }
        if (type === 'apikey' && (sc.in === 'header' || sc.in === 'query') && sc.name) {
          addVar('apiKey');
          return { type: 'apikey', apikey: pair({ key: String(sc.name), value: '{{apiKey}}', in: sc.in }) };
        }
      }
    }
    return undefined;
  };
  const colAuth = authFor(spec.security);

  // Contract tests from the documented responses: the status is one the spec lists, and a 2xx body has its required fields
  // (registered only when that status comes back, so a 404 never reports a passing body check).
  const testFor = (responses) => {
    const codes = Object.keys(responses);
    const exact = codes.filter((c) => /^\d{3}$/.test(c)).map(Number);
    const ranges = codes.filter((c) => /^[1-5]XX$/i.test(c)).map((c) => Number(c[0]));
    const lines = [];
    if ((exact.length || ranges.length) && !codes.includes('default')) {
      const cond = [exact.length ? `${JSON.stringify(exact)}.includes(code)` : '', ...ranges.map((r) => `(code >= ${r}00 && code < ${r + 1}00)`)].filter(Boolean).join(' || ');
      const label = [...exact, ...ranges.map((r) => `${r}xx`)].join(', ');
      lines.push(`pm.test("Status is one the spec documents (${label})", () => {`, '  const code = pm.response.code;', `  pm.expect(${cond}, "got " + code).to.be.true;`, '});');
    }
    const ok = exact.find((c) => c >= 200 && c < 300);
    if (ok) {
      const r = deref(responses[String(ok)]);
      let schema = v2 ? r.schema : undefined;
      if (!v2 && isObj(r.content)) { const ct = Object.keys(r.content).find((k) => /json/i.test(k)); if (ct) schema = deref(r.content[ct]).schema; }
      const s = deref(schema);
      const required = Array.isArray(s.required) ? s.required.filter((k) => typeof k === 'string' && !(isObj(s.properties) && deref(s.properties[k]).writeOnly)) : [];
      if (required.length) {
        lines.push(...(lines.length ? [''] : []), `if (pm.response.code === ${ok}) {`, `  pm.test("${ok} body has the required fields", () => {`, '    const body = pm.response.json();',
          ...required.map((k) => `    pm.expect(body).to.have.property(${JSON.stringify(k)});`), '  });', '}');
      } else if (s.type === 'array') {
        lines.push(...(lines.length ? [''] : []), `if (pm.response.code === ${ok}) {`, `  pm.test("${ok} body is a list", () => {`, '    pm.expect(Array.isArray(pm.response.json())).to.be.true;', '  });', '}');
      }
    }
    return lines.length ? [{ listen: 'test', script: { type: 'text/javascript', exec: lines } }] : undefined;
  };

  // Body: JSON / form / multipart / XML / text / binary, with an example filled in
  const pickType = (content) => {
    const keys = Object.keys(content);
    return keys.find((k) => /^application\/([\w.-]+\+)?json/i.test(k)) || keys.find((k) => /x-www-form-urlencoded/i.test(k)) || keys.find((k) => /multipart\/form-data/i.test(k))
      || keys.find((k) => /xml/i.test(k)) || keys.find((k) => /^text\//i.test(k)) || keys.find((k) => /json/i.test(k)) || keys[0];
  };
  const formFields = (schema, multipart) => {
    const s = deref(schema);
    const props = Object.assign({}, ...(Array.isArray(s.allOf) ? s.allOf.map((x) => deref(x).properties || {}) : []), isObj(s.properties) ? s.properties : {});
    const required = Array.isArray(s.required) ? s.required : [];
    return Object.entries(props).filter(([, p]) => !deref(p).readOnly).map(([key, p]) => {
      const pd = deref(p);
      const desc = pd.description ? { description: String(pd.description) } : {};
      if (multipart && (pd.format === 'binary' || pd.format === 'base64' || (pd.type === 'array' && deref(pd.items).format === 'binary'))) return { key, type: 'file', src: [], ...desc };
      const v = sample(p);
      return { key, value: Array.isArray(v) ? v.map(str).join(',') : str(v), type: 'text', ...(required.includes(key) || !required.length ? {} : { disabled: true }), ...desc };
    });
  };
  const rawBody = (raw, language) => ({ mode: 'raw', raw, options: { raw: { language } } });
  const bodyFor = (op, params) => {
    if (v2) {
      const b = params.find((p) => p.in === 'body');
      if (b) { const ex = sample(b.schema || {}); return { contentType: 'application/json', body: rawBody(ex === undefined ? '' : JSON.stringify(ex, null, 2), 'json') }; }
      const form = params.filter((p) => p.in === 'formData');
      if (!form.length) return null;
      const consumes = Array.isArray(op.consumes) ? op.consumes : Array.isArray(spec.consumes) ? spec.consumes : [];
      const multipart = form.some((p) => p.type === 'file') || consumes.some((c) => /multipart/i.test(c));
      const fields = form.map((p) => (p.type === 'file' ? { key: String(p.name), type: 'file', src: [] }
        : { key: String(p.name), value: paramValue(p), type: 'text', ...(p.required ? {} : { disabled: true }), ...(p.description ? { description: String(p.description) } : {}) }));
      return multipart ? { body: { mode: 'formdata', formdata: fields } }
        : { contentType: 'application/x-www-form-urlencoded', body: { mode: 'urlencoded', urlencoded: fields.map(({ type, ...f }) => f) } };
    }
    const rb = deref(op.requestBody);
    if (!isObj(rb.content) || !Object.keys(rb.content).length) return null;
    const ct = pickType(rb.content);
    const media = deref(rb.content[ct]);
    let ex = media.example;
    if (ex === undefined && isObj(media.examples)) ex = deref(Object.values(media.examples)[0]).value;
    if (ex === undefined) ex = sample(media.schema || {});
    if (/x-www-form-urlencoded/i.test(ct)) return { contentType: ct, body: { mode: 'urlencoded', urlencoded: formFields(media.schema).map(({ type, ...f }) => f) } };
    if (/multipart\/form-data/i.test(ct)) return { body: { mode: 'formdata', formdata: formFields(media.schema, true) } }; // the client sets the boundary
    if (/json/i.test(ct)) return { contentType: ct, body: rawBody(ex === undefined ? '' : JSON.stringify(ex, null, 2), 'json') };
    if (/xml/i.test(ct)) return { contentType: ct, body: rawBody(typeof ex === 'string' ? ex : '', 'xml') };
    if (/octet-stream|^image\/|^audio\/|^video\/|\/pdf$|\/zip$/i.test(ct)) return { contentType: ct, body: { mode: 'file', file: {} } };
    return { contentType: ct, body: rawBody(typeof ex === 'string' ? ex : ex === undefined ? '' : JSON.stringify(ex, null, 2), 'text') };
  };

  // Requests, in folders by first tag (spec's tag order first), untagged ones at the top level
  const folders = new Map();
  for (const t of Array.isArray(spec.tags) ? spec.tags : []) if (isObj(t) && t.name != null && !folders.has(String(t.name))) folders.set(String(t.name), { desc: t.description, items: [] });
  const loose = [];
  let count = 0;
  const handled = /^(accept|content-type|authorization)$/i;
  const kv = (p) => ({ key: String(p.name), value: paramValue(p), ...(p.required ? {} : { disabled: true }), ...(p.description ? { description: String(p.description) } : {}) });
  const varName = (n) => String(n).replace(/[^\w-]/g, '_');
  for (const [path, rawItem] of Object.entries(spec.paths)) {
    const pathItem = deref(rawItem);
    const shared = Array.isArray(pathItem.parameters) ? pathItem.parameters : [];
    for (const m of METHODS) {
      if (!isObj(pathItem[m])) continue;
      const op = pathItem[m];
      const byKey = new Map(); // operation parameters override path-level ones with the same name and location
      for (const p of [...shared, ...(Array.isArray(op.parameters) ? op.parameters : [])]) { const d = deref(p); if (d.name != null && d.in) byKey.set(`${d.in}:${d.name}`, d); }
      const params = [...byKey.values()];
      const urlPath = ('/' + String(path).replace(/^\/+/, '')).replace(/{([^{}/]+)}/g, (mm, k) => `:${varName(k)}`);
      const query = params.filter((p) => p.in === 'query').map(kv);
      const header = params.filter((p) => p.in === 'header' && !handled.test(p.name)).map(kv);
      const qs = query.filter((q) => !q.disabled).map((q) => `${q.key}=${q.value}`).join('&');
      const pathVars = params.filter((p) => p.in === 'path').map((p) => ({ key: varName(p.name), value: paramValue(p), ...(p.description ? { description: String(p.description) } : {}) }));
      const url = { raw: `{{baseUrl}}${urlPath}${qs ? '?' + qs : ''}`, host: ['{{baseUrl}}'], path: urlPath.split('/').filter(Boolean), ...(query.length ? { query } : {}), ...(pathVars.length ? { variable: pathVars } : {}) };
      const b = bodyFor(op, params);
      if (b && b.contentType) header.unshift({ key: 'Content-Type', value: b.contentType });
      const responses = isObj(op.responses) ? op.responses : {};
      const codeList = Object.entries(responses).map(([c, r]) => `- **${c}** ${String(deref(r).description || '').split('\n')[0]}`.trimEnd());
      const desc = [op.deprecated ? '**Deprecated.**' : '', op.description && String(op.description).trim() !== String(op.summary || '').trim() ? String(op.description).trim() : '', codeList.length ? `Responses:\n${codeList.join('\n')}` : ''].filter(Boolean).join('\n\n');
      const request = { method: m.toUpperCase(), header, url };
      if (b) request.body = b.body;
      if (desc) request.description = desc;
      const opAuth = authFor(op.security);
      if (opAuth && JSON.stringify(opAuth) !== JSON.stringify(colAuth)) request.auth = opAuth;
      const item = { name: String(op.summary || op.operationId || `${m.toUpperCase()} ${path}`).replace(/\s+/g, ' ').trim().slice(0, 200), request, response: [] };
      const ev = testFor(responses);
      if (ev) item.event = ev;
      const tag = Array.isArray(op.tags) && op.tags.length ? String(op.tags[0]) : null;
      if (tag) { if (!folders.has(tag)) folders.set(tag, { items: [] }); folders.get(tag).items.push(item); } else loose.push(item);
      count++;
    }
  }
  if (!count) throw new Error('This OpenAPI spec has no operations under "paths".');
  const info = isObj(spec.info) ? spec.info : {};
  const col = {
    info: { name: String(info.title || 'Imported API') + (info.version ? ` ${info.version}` : ''), schema: SCHEMA_V21, ...(info.description ? { description: String(info.description) } : {}) },
    item: [...[...folders].filter(([, f]) => f.items.length).map(([name, f]) => ({ name, ...(f.desc ? { description: String(f.desc) } : {}), item: f.items })), ...loose],
    variable,
  };
  if (colAuth && colAuth.type !== 'noauth') col.auth = colAuth;
  return col;
}

// ---------- cURL ----------
function shellSplit(s) {
  const out = [];
  let cur = '', inTok = false;
  s = s.replace(/\\\r?\n/g, ' ').replace(/\^\r?\n/g, ' '); // bash and Windows line continuations
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === "'") {
      inTok = true;
      const j = s.indexOf("'", i + 1);
      if (j === -1) throw new Error('Unclosed single quote in the cURL command.');
      cur += s.slice(i + 1, j);
      i = j;
    } else if (c === '"') {
      inTok = true;
      i++;
      for (; i < s.length && s[i] !== '"'; i++) {
        if (s[i] === '\\' && i + 1 < s.length && '"\\$`'.includes(s[i + 1])) i++;
        cur += s[i];
      }
      if (i >= s.length) throw new Error('Unclosed double quote in the cURL command.');
    } else if (c === '$' && s[i + 1] === "'") {
      inTok = true;
      i += 2;
      for (; i < s.length && s[i] !== "'"; i++) {
        if (s[i] === '\\' && i + 1 < s.length) { i++; cur += { n: '\n', t: '\t', r: '\r' }[s[i]] ?? s[i]; } else cur += s[i];
      }
    } else if (/\s/.test(c)) {
      if (inTok) { out.push(cur); cur = ''; inTok = false; }
    } else if (c === '\\' && i + 1 < s.length) {
      inTok = true;
      cur += s[++i];
    } else {
      inTok = true;
      cur += c;
    }
  }
  if (inTok) out.push(cur);
  return out;
}

function parseCurl(cmd) {
  const tokens = shellSplit(cmd.trim());
  if (!tokens.length || !/^curl(\.exe)?$/i.test(tokens[0])) throw new Error('That doesn\'t look like a cURL command (it should start with curl).');
  const ed = blankEd();
  ed.name = 'Imported from cURL';
  const data = [];
  const form = [];
  let method = '', url = '', getMode = false;
  const takesArg = new Set(['-o', '--output', '-w', '--write-out', '-m', '--max-time', '--connect-timeout', '--retry', '-x', '--proxy', '--cacert', '--cert', '--key', '-T', '--upload-file', '-r', '--range', '--limit-rate', '-c', '--cookie-jar', '--resolve', '--interface']);
  for (let i = 1; i < tokens.length; i++) {
    const tk = tokens[i];
    const next = () => { if (i + 1 >= tokens.length) throw new Error(`${tk} needs a value.`); return tokens[++i]; };
    const long = tk.match(/^(--[\w-]+)=(.*)$/);
    const flag = long ? long[1] : tk;
    const val = () => (long ? long[2] : next());
    if (flag === '-X' || flag === '--request') { method = val().toUpperCase(); if (!/^[A-Z]{1,16}$/.test(method)) throw new Error(`"${method}" isn't a valid HTTP method.`); }
    else if (/^-X[A-Z]+$/.test(tk)) method = tk.slice(2);
    else if (flag === '-H' || flag === '--header') {
      const hv = val();
      const c = hv.indexOf(':');
      if (c > 0) ed.headers.push({ key: hv.slice(0, c).trim(), value: hv.slice(c + 1).trim(), disabled: false });
    } else if (['-d', '--data', '--data-raw', '--data-binary', '--data-ascii'].includes(flag)) data.push(val());
    else if (flag === '--data-urlencode') { const v = val(); const eq = v.indexOf('='); data.push(eq === -1 ? encodeURIComponent(v) : `${v.slice(0, eq)}=${encodeURIComponent(v.slice(eq + 1))}`); }
    else if (flag === '--json') { data.push(val()); ed.headers.push({ key: 'Content-Type', value: 'application/json', disabled: false }, { key: 'Accept', value: 'application/json', disabled: false }); }
    else if (flag === '-F' || flag === '--form' || flag === '--form-string') {
      const v = val();
      const eq = v.indexOf('=');
      const key = eq === -1 ? v : v.slice(0, eq);
      const value = eq === -1 ? '' : v.slice(eq + 1);
      form.push(value.startsWith('@') && flag !== '--form-string'
        ? { key, value: '', type: 'file', src: value.slice(1).split(';')[0], disabled: false, file: null }
        : { key, value, type: 'text', src: '', disabled: false, file: null });
    } else if (flag === '-u' || flag === '--user') {
      const v = val();
      const c = v.indexOf(':');
      ed.auth = { type: 'basic', username: c === -1 ? v : v.slice(0, c), password: c === -1 ? '' : v.slice(c + 1) };
    } else if (flag === '-A' || flag === '--user-agent') ed.headers.push({ key: 'User-Agent', value: val(), disabled: false });
    else if (flag === '-e' || flag === '--referer') ed.headers.push({ key: 'Referer', value: val(), disabled: false });
    else if (flag === '-b' || flag === '--cookie') ed.headers.push({ key: 'Cookie', value: val(), disabled: false });
    else if (flag === '-G' || flag === '--get') getMode = true;
    else if (flag === '-I' || flag === '--head') method = 'HEAD';
    else if (flag === '--url') url = val();
    else if (takesArg.has(flag)) { if (!long) next(); }
    else if (tk.startsWith('-')) { /* -s, -L, -k, -v, --compressed, ...: no value */ }
    else if (!url) url = tk;
  }
  if (!url) throw new Error('No URL found in the cURL command.');
  const userinfo = /^([a-z][a-z0-9+.-]*:\/\/)([^/@?#]*)@/i.exec(url);
  if (userinfo) {
    const [user, ...rest] = userinfo[2].split(':');
    const dec = (x) => { try { return decodeURIComponent(x); } catch { return x; } };
    if (ed.auth.type !== 'basic') ed.auth = { type: 'basic', username: dec(user), password: dec(rest.join(':')) };
    url = userinfo[1] + url.slice(userinfo[0].length);
  }
  if (getMode && data.length) { url += (url.includes('?') ? '&' : '?') + data.join('&'); data.length = 0; }
  ed.method = method || (data.length || form.length ? 'POST' : 'GET');
  ed.url = url;
  ed.params = parseQuery(url);
  if (form.length) { ed.body.mode = 'formdata'; ed.body.formdata = form; }
  else if (data.length) {
    const text = data.join('&');
    const ctHeader = ed.headers.find((x) => x.key.toLowerCase() === 'content-type');
    let json = false;
    try { JSON.parse(text); json = true; } catch { /* not JSON */ }
    if (json) { ed.body.mode = 'raw'; ed.body.lang = 'json'; ed.body.raw = JSON.stringify(JSON.parse(text), null, 2); }
    else if ((!ctHeader || /urlencoded/i.test(ctHeader.value)) && /^[^=&\s]+=[^&]*(&[^=&\s]+=[^&]*)*$/.test(text)) {
      ed.body.mode = 'urlencoded';
      ed.body.urlencoded = text.split('&').map((p) => { const eq = p.indexOf('='); const dec = (x) => { try { return decodeURIComponent(x.replace(/\+/g, ' ')); } catch { return x; } }; return { key: dec(p.slice(0, eq)), value: dec(p.slice(eq + 1)), disabled: false }; });
      if (ctHeader) ed.headers.splice(ed.headers.indexOf(ctHeader), 1);
    } else { ed.body.mode = 'raw'; ed.body.lang = 'text'; ed.body.raw = text; }
  }
  try { ed.name = `${ed.method} ${new URL(url.includes('://') ? url : `http://${url}`).pathname}`; } catch { /* keep default */ }
  return ed;
}

// ---------- code generation ----------
const SECRET_HEADER = /^(authorization|proxy-authorization|cookie|x-api-key|api-key|x-auth-token)$|token|secret|password|session/i;

function codeWire(mask) {
  const t = cur();
  const sc = scopesFor(t.cid);
  const ai = effectiveAuth(t.ed, t.cid, t.itemId);
  if (ai.auth.type === 'oauth2') ai.auth = { ...ai.auth, _token: { accessToken: '<access-token>' } }; // the real one is fetched when sending
  const built = buildWire(t.ed, requestSnapshot(t.ed), merged(sc), ai);
  if (built.error) return built;
  const w = built.wire;
  try { // the URL as the server sends it: spaces and non-ASCII encoded, user:password@ turned into Basic auth
    const u = new URL(w.url);
    if (u.username || u.password) {
      const user = decodeURIComponent(u.username), pw = decodeURIComponent(u.password);
      u.username = ''; u.password = '';
      if (!w.headers.some(([k]) => /^authorization$/i.test(k))) w.headers.push(['Authorization', `Basic ${btoa(unescape(encodeURIComponent(`${user}:${pw}`)))}`]);
    }
    u.hash = '';
    w.url = u.href;
  } catch { /* buildWire checked it */ }
  if (w.method === 'HEAD' || (w.method === 'GET' && backend.mode !== 'local')) { // what send() does with these bodies
    if (w.body.kind !== 'none') w.headers = w.headers.filter(([k]) => k.toLowerCase() !== 'content-type');
    w.body = { kind: 'none' };
  }
  if (mask) {
    const a = effectiveAuth(t.ed, t.cid, t.itemId).auth;
    const vars = merged(sc);
    const apiKeyHeader = a.type === 'apikey' && a.in !== 'query' ? resolve(a.key, vars).toLowerCase() : '';
    w.headers = w.headers.map(([k, v]) => [k, SECRET_HEADER.test(k) || k.toLowerCase() === apiKeyHeader
      ? (/^authorization$/i.test(k) ? v.replace(/^(\w+\s+).+$/, '$1••••••') : '••••••') : v]);
    // values of Secret variables (and auth secrets) are hidden wherever they were substituted
    const secrets = new Set();
    const addSecret = (v) => { if (v && String(v).length >= 3) secrets.add(String(v)); };
    for (const doc of [state.envs[state.activeEnv], state.envs[GLOBALS_ID]]) for (const v of (doc && doc.values) || []) if (v.type === 'secret') addSecret(v.value);
    for (const v of (t.cid && state.cols[t.cid] && state.cols[t.cid].variable) || []) if (v.type === 'secret') addSecret(v.value);
    if (a.type === 'bearer') addSecret(resolve(a.token, vars));
    if (a.type === 'basic') addSecret(resolve(a.password, vars));
    if (a.type === 'apikey') addSecret(resolve(a.value, vars));
    for (const sec of [...secrets]) { secrets.add(encodeURIComponent(sec)); secrets.add(new URLSearchParams({ x: sec }).toString().slice(2)); }
    const hide = (str) => [...secrets].sort((x, y) => y.length - x.length).reduce((acc, sec) => acc.split(sec).join('••••••'), String(str));
    w.url = hide(w.url);
    w.headers = w.headers.map(([k, v]) => [k, hide(v)]);
    if (w.body.kind === 'text') w.body = { ...w.body, text: hide(w.body.text) };
    if (w.body.kind === 'formdata') w.body = { ...w.body, fields: w.body.fields.map((f) => (f.file ? f : { ...f, value: hide(f.value) })) };
    if (a.type === 'apikey' && a.in === 'query') { try { const u = new URL(w.url); u.searchParams.set(resolve(a.key, merged(sc)), '••••••'); w.url = u.toString(); } catch { /* keep */ } }
  }
  return { wire: w };
}

const sq = (s) => `'${String(s).replace(/'/g, `'\\''`)}'`;
const dq = (s) => JSON.stringify(String(s));
// PowerShell single-quoted string: every quote PowerShell treats as a single quote (incl. ‘ ’ ‚ ‛) is doubled
const psq = (s) => `'${String(s).replace(/['‘’‚‛]/g, (c) => c + c)}'`;
// HTTPie request items: backslash-escape the separators (: = @) and backslashes, so names and values are sent
// literally (a value like "@/etc/passwd" must never become "read this local file").
const hie = (s) => String(s).replace(/[\\:=@]/g, (c) => `\\${c}`);
const GENERATORS = {
  curl: { label: 'cURL', gen(w) {
    const lines = [`curl -X ${sq(w.method)} ${sq(w.url)}`];
    for (const [k, v] of w.headers) lines.push(`  -H ${sq(`${k}: ${v}`)}`);
    if (w.body.kind === 'text') lines.push(`  --data-raw ${sq(w.body.text)}`);
    // text fields use --form-string: with -F a value starting with @ or < would upload a local file
    if (w.body.kind === 'formdata') for (const f of w.body.fields) lines.push(f.file ? `  -F ${sq(`${f.key}=@${f.file.name}`)}` : `  --form-string ${sq(`${f.key}=${f.value}`)}`);
    if (w.body.kind === 'file') lines.push(`  --data-binary ${sq('@' + w.body.file.name)}`);
    return lines.join(' \\\n');
  } },
  fetch: { label: 'JavaScript fetch', gen(w) {
    const headers = w.body.kind === 'formdata' ? w.headers.filter(([k]) => k.toLowerCase() !== 'content-type') : w.headers;
    const lines = [];
    if (w.body.kind === 'formdata') {
      lines.push('const form = new FormData();');
      for (const f of w.body.fields) lines.push(f.file ? `form.append(${dq(f.key)}, fileInput.files[0]); // ${f.file.name}` : `form.append(${dq(f.key)}, ${dq(f.value)});`);
      lines.push('');
    }
    lines.push(`const response = await fetch(${dq(w.url)}, {`, `  method: ${dq(w.method)},`);
    if (headers.length) { lines.push('  headers: {'); for (const [k, v] of headers) lines.push(`    ${dq(k)}: ${dq(v)},`); lines.push('  },'); }
    if (w.method === 'GET' && w.body.kind !== 'none') lines.push('  // fetch() can\'t send a body with GET (it throws): ApiMan sends it from its local server');
    else if (w.body.kind === 'text') lines.push(`  body: ${dq(w.body.text)},`);
    else if (w.body.kind === 'formdata') lines.push('  body: form,');
    else if (w.body.kind === 'file') lines.push(`  body: file, // ${w.body.file.name}`);
    lines.push('});', 'console.log(response.status, await response.text());');
    return lines.join('\n');
  } },
  httpie: { label: 'HTTPie', gen(w) {
    const flags = w.body.kind === 'text' ? `--raw ${sq(w.body.text)} ` : w.body.kind === 'formdata' ? '--form ' : '';
    const lines = [`http ${flags}-- ${sq(w.method)} ${sq(w.url)}`]; // "--": nothing after it is read as an option (a header named "-o..." stays a header)
    for (const [k, v] of w.headers) lines.push(`  ${sq(`${hie(k)}:${hie(v)}`)}`);
    if (w.body.kind === 'formdata') for (const f of w.body.fields) lines.push(f.file ? `  ${sq(`${hie(f.key)}@${f.file.name}`)}` : `  ${sq(`${hie(f.key)}=${hie(f.value)}`)}`);
    if (w.body.kind === 'file') lines.push(`  < ${sq(w.body.file.name)}`);
    return lines.join(' \\\n');
  } },
  go: { label: 'Go net/http', gen(w) {
    const text = w.body.kind === 'text';
    return ['package main', '', 'import (', '\t"fmt"', '\t"io"', '\t"net/http"', ...(text ? ['\t"strings"'] : []), ')', '', 'func main() {',
      `\treq, err := http.NewRequest(${dq(w.method)}, ${dq(w.url)}, ${text ? `strings.NewReader(${dq(w.body.text)})` : 'nil'})`,
      '\tif err != nil {', '\t\tpanic(err)', '\t}',
      ...w.headers.map(([k, v]) => `\treq.Header.Set(${dq(k)}, ${dq(v)})`),
      ...(w.body.kind === 'formdata' || w.body.kind === 'file' ? ['\t// form-data / file bodies: build them with mime/multipart or os.Open'] : []),
      '\tres, err := http.DefaultClient.Do(req)', '\tif err != nil {', '\t\tpanic(err)', '\t}', '\tdefer res.Body.Close()',
      '\tbody, _ := io.ReadAll(res.Body)', '\tfmt.Println(res.Status)', '\tfmt.Println(string(body))', '}'].join('\n');
  } },
  powershell: { label: 'PowerShell', gen(w) {
    const lines = [];
    if (w.headers.length) lines.push('$headers = @{', ...w.headers.map(([k, v]) => `    ${psq(k)} = ${psq(v)}`), '}');
    let call = `$response = Invoke-WebRequest -Uri ${psq(w.url)} -Method ${psq(w.method)}${w.headers.length ? ' -Headers $headers' : ''}`;
    if (w.body.kind === 'text') call += ` -Body ${psq(w.body.text)}`;
    if (w.body.kind === 'file') call += ` -InFile ${psq(w.body.file.name)}`;
    if (w.body.kind === 'formdata') { lines.push('$form = @{', ...w.body.fields.map((f) => `    ${psq(f.key)} = ${f.file ? `Get-Item ${psq(f.file.name)}` : psq(f.value)}`), '}'); call += ' -Form $form'; }
    lines.push(call, '$response.StatusCode', '$response.Content');
    return lines.join('\n');
  } },
  python: { label: 'Python requests', gen(w) {
    const lines = ['import requests', '', `url = ${dq(w.url)}`];
    const headers = w.body.kind === 'formdata' ? w.headers.filter(([k]) => k.toLowerCase() !== 'content-type') : w.headers;
    if (headers.length) lines.push('headers = {', ...headers.map(([k, v]) => `    ${dq(k)}: ${dq(v)},`), '}');
    let args = headers.length ? 'headers=headers' : '';
    const add = (a) => { args = args ? `${args}, ${a}` : a; };
    if (w.body.kind === 'text') { lines.push(`payload = ${dq(w.body.text)}`); add('data=payload.encode("utf-8")'); }
    if (w.body.kind === 'formdata') {
      lines.push('data = {', ...w.body.fields.filter((f) => !f.file).map((f) => `    ${dq(f.key)}: ${dq(f.value)},`), '}');
      lines.push('files = {', ...w.body.fields.filter((f) => f.file).map((f) => `    ${dq(f.key)}: open(${dq(f.file.name)}, "rb"),`), '}');
      add('data=data, files=files');
    }
    if (w.body.kind === 'file') { lines.push(`with open(${dq(w.body.file.name)}, "rb") as f:`, '    payload = f.read()'); add('data=payload'); }
    lines.push('', `response = requests.request(${dq(w.method)}, url, ${args ? `${args}, ` : ''}timeout=${Number(state.settings.timeout) || 60})`, 'print(response.status_code)', 'print(response.text)');
    return lines.join('\n');
  } },
  java: { label: 'Java HttpClient', gen(w) {
    const body = w.body.kind === 'text' ? `HttpRequest.BodyPublishers.ofString(${dq(w.body.text)})`
      : w.body.kind === 'file' ? `HttpRequest.BodyPublishers.ofFile(Path.of(${dq(w.body.file.name)}))`
      : 'HttpRequest.BodyPublishers.noBody()';
    const lines = [
      'import java.net.URI;', 'import java.net.http.*;', ...(w.body.kind === 'file' ? ['import java.nio.file.Path;'] : []), '',
      'HttpClient client = HttpClient.newHttpClient();',
      'HttpRequest request = HttpRequest.newBuilder()',
      `        .uri(URI.create(${dq(w.url)}))`,
      ...w.headers.filter(([k]) => !/^(host|content-length|connection)$/i.test(k)).map(([k, v]) => `        .header(${dq(k)}, ${dq(v)})`),
      `        .method(${dq(w.method)}, ${body})`,
      '        .build();',
      'HttpResponse<String> response = client.send(request, HttpResponse.BodyHandlers.ofString());',
      'System.out.println(response.statusCode() + " " + response.body());',
    ];
    if (w.body.kind === 'formdata') lines.splice(3, 0, '// Multipart form data needs a helper library (for example Apache HttpClient MultipartEntityBuilder).');
    return lines.join('\n');
  } },
};

function openCode() {
  const t = cur();
  if (!t) return;
  let lang = ls.get('apiman:codeLang', 'curl');
  const maskCheck = ui.check({ label: 'Hide secrets', help: 'Masks tokens, API keys and cookies, so the code is safe to paste into chats and tickets.', checked: true, cls: 'dlg-after' });
  const mask = maskCheck.input;
  const LANG_MODE = { curl: 'shell', httpie: 'shell', fetch: 'javascript', python: 'python', java: 'java', go: 'go', powershell: 'powershell' };
  const viewer = codeEditor({ readOnly: true, label: 'Generated code', cls: 'codegen' });
  const pre = { set textContent(v) { if (viewer.cm) { viewer.cm.setValue(v); viewer.cm.setOption('mode', CM_MODES[LANG_MODE[lang]] ?? null); } else viewer.querySelector('pre').textContent = v; },
                get textContent() { return viewer.cm ? viewer.cm.getValue() : viewer.querySelector('pre').textContent; } };
  const tabsBar = h('div', { class: 'seg dlg-tabs', role: 'radiogroup', 'aria-label': 'Language' });
  const draw = () => {
    ui.seg(['curl', 'httpie', 'powershell', 'fetch', 'python', 'java', 'go'].filter((k) => GENERATORS[k]).map((k) => [k, GENERATORS[k].label]), lang,
      (k) => { lang = k; ls.set('apiman:codeLang', k); draw(); tabsBar.querySelector('.on')?.focus(); }, { into: tabsBar });
    const r = codeWire(mask.checked);
    pre.textContent = r.error ? `// ${r.error}` : GENERATORS[lang].gen(r.wire);
  };
  mask.addEventListener('change', draw);
  dynMemo = new Map(); // {{$guid}} and friends keep one value while the dialog is open
  draw();
  openDialog({
    title: 'Generate code',
    cancel: 'Close',
    onClose: () => { dynMemo = null; },
    focus: '#dlgFoot .btn.primary',
    wide: true,
    body: [tabsBar, viewer, maskCheck],
    buttons: [{ label: 'Copy', primary: true, onClick: async () => { await navigator.clipboard.writeText(pre.textContent); toast('Code copied'); return false; } }],
  });
}

// ---------- runner: iteration data (data files) ----------
const DATA_ROWS_MAX = 100000; // iterations a data file may drive (as `server.py run -d` allows)
const DATA_FILE_MAX = 20 * 1024 * 1024;
const STEP_MAX = 10000; // requests per run beyond a plain run's count: pm.execution.setNextRequest loops end here

/** A data row as {{variable}} values: strings, like every other scope. */
function dataRowVars(row) {
  if (!row || typeof row !== 'object') return {};
  return Object.fromEntries(Object.entries(row).map(([k, v]) => [k, v == null ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v)]));
}

/** RFC 4180 CSV: a header row, then one row per iteration. Quoted values may hold commas, quotes ("") and line breaks. */
function parseCsv(text) {
  text = String(text).replace(/^\uFEFF/, '');
  const records = []; // { line, cells }
  let cells = [], cell = '', quoted = false, wasQuoted = false, line = 1, start = 1;
  const endCell = () => { cells.push(cell); cell = ''; wasQuoted = false; };
  const endRow = () => { endCell(); if (!(cells.length === 1 && cells[0] === '' )) records.push({ line: start, cells }); cells = []; };
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else quoted = false; }
      else { if (c === '\n') line++; cell += c; }
      continue;
    }
    if (c === '"' && cell === '' && !wasQuoted) { quoted = true; wasQuoted = true; continue; }
    if (c === '"') throw new Error(`Line ${line}: a quote inside a value that isn't quoted. Put the value in quotes and double the quote ("").`);
    if (wasQuoted && c !== ',' && c !== '\r' && c !== '\n') throw new Error(`Line ${line}: text after a closing quote. Put the whole value in quotes.`);
    if (c === ',') { endCell(); continue; }
    if (c === '\r' || c === '\n') { if (c === '\r' && text[i + 1] === '\n') i++; endRow(); line++; start = line; continue; }
    cell += c;
  }
  if (quoted) throw new Error(`Line ${start}: a quoted value is never closed.`);
  if (cell !== '' || cells.length || wasQuoted) endRow();
  if (!records.length) throw new Error('The file is empty.');
  const columns = records[0].cells.map((x) => x.trim());
  columns.forEach((c, i) => {
    if (!c) throw new Error(`The header row (line ${records[0].line}) has an empty column name (column ${i + 1}).`);
    if (columns.indexOf(c) !== i) throw new Error(`The header row has the column "${c}" twice.`);
  });
  const rows = records.slice(1).map(({ line: ln, cells: cs }) => {
    if (cs.length !== columns.length) throw new Error(`Line ${ln} has ${cs.length} value${cs.length === 1 ? '' : 's'}, but the header has ${columns.length} column${columns.length === 1 ? '' : 's'}.`);
    return Object.fromEntries(columns.map((c, i) => [c, cs[i]]));
  });
  return { rows, columns };
}

/** Checks rows (from a JSON file, or sent by `server.py run`): an array of flat objects. */
function normalizeDataRows(data) {
  if (!Array.isArray(data)) throw new Error('A JSON data file must hold an array of objects, one per iteration: [{ "id": 1 }, { "id": 2 }].');
  const columns = [];
  const rows = data.map((row, i) => {
    if (!row || typeof row !== 'object' || Array.isArray(row)) throw new Error(`Item ${i + 1} isn't an object. Each item is one iteration: { "column": value, … }.`);
    for (const [k, v] of Object.entries(row)) {
      if (v && typeof v === 'object') throw new Error(`Item ${i + 1}, "${k}": nested objects and lists aren't supported. Use flat values (text, numbers, true/false, null).`);
      if (!columns.includes(k)) columns.push(k);
    }
    return { ...row };
  });
  return { rows, columns };
}

/** A data file's text → { rows, columns, format }. CSV or JSON, by extension, else by content. Throws a readable error. */
function parseIterationData(text, filename = '') {
  const t = String(text).replace(/^\uFEFF/, '');
  const ext = (String(filename).match(/\.([a-z0-9]+)$/i) || [])[1];
  const isJson = ext ? ext.toLowerCase() === 'json' : /^\s*\[/.test(t);
  let out;
  if (isJson) {
    let data;
    try { data = JSON.parse(t); } catch (e) { throw new Error(`Not valid JSON: ${e.message}`); }
    out = { ...normalizeDataRows(data), format: 'JSON' };
  } else out = { ...parseCsv(t), format: 'CSV' };
  if (!out.rows.length) throw new Error(isJson ? 'The list is empty: add one object per iteration.' : 'There is a header row but no data rows.');
  if (out.rows.length > DATA_ROWS_MAX) throw new Error(`${out.rows.length} rows is more than a run can take (${DATA_ROWS_MAX}).`);
  return out;
}
function dataSummary(d) {
  const cols = d.columns.length > 8 ? `${d.columns.slice(0, 8).join(', ')} and ${d.columns.length - 8} more` : d.columns.join(', ');
  return `${d.rows.length} row${d.rows.length === 1 ? '' : 's'} · columns: ${cols || 'none'}`;
}

// ---------- runner: results and reports ----------
// Reports are built from data by our code: every value (names, URLs, messages, bodies) is escaped, and secret headers are masked.
const REPORT_BODY_MAX = 64 * 1024; // per body kept for "Include headers and bodies"
const REPORT_BODIES_BUDGET = 40 * 1024 * 1024; // per run; later results keep no bodies
const REPORT_MASK = '•••';
const REPORT_SECRET_HEADER = /^(authorization|proxy-authorization|cookie|set-cookie)$|token|secret|password|passwd|api[-_]?key|session/i;
const REPORT_SECRET_PARAM = /token|secret|password|passwd|api[-_]?key|^key$|signature|^sig$|session|^auth/i;
const maskHeaders = (hs) => (Array.isArray(hs) ? hs : []).map(([k, v]) => [String(k), REPORT_SECRET_HEADER.test(String(k)) ? REPORT_MASK : String(v ?? '')]);
/** The URL with the password and secret-looking query values (token, api_key, …) replaced. */
function maskUrl(u) {
  const s = String(u ?? '');
  let x;
  try { x = new URL(s); } catch { return s; }
  let changed = false;
  if (x.password) { x.password = 'x'; changed = true; }
  const parts = x.search.slice(1).split('&').filter(Boolean).map((p) => {
    const [k, ...v] = p.split('=');
    let name = k;
    try { name = decodeURIComponent(k.replace(/\+/g, ' ')); } catch { /* keep the raw name */ }
    if (v.length && REPORT_SECRET_PARAM.test(name)) { changed = true; return `${k}=${REPORT_MASK}`; }
    return p;
  });
  if (!changed) return s;
  const auth = x.username ? `${x.username}${x.password ? `:${REPORT_MASK}` : ''}@` : '';
  return `${x.protocol}//${auth}${x.host}${x.pathname}${parts.length ? `?${parts.join('&')}` : ''}${x.hash}`;
}
function wireBodyText(wire) {
  const b = wire && wire.body;
  if (!b || b.kind === 'none') return '';
  if (b.kind === 'text') return String(b.text ?? '');
  if (b.kind === 'formdata') return (b.fields || []).map((f) => `${f.key}=${f.file ? `@${f.file.name || 'file'}` : f.value}`).join('\n');
  if (b.kind === 'file') return `(file ${b.file ? b.file.name : ''})`;
  return '';
}

/** One finished request of a run, as the reports and `server.py run` see it. budget: { left } bytes for bodies. */
function runResultRecord({ it, dataRow, parents, ed, out }, budget = null) {
  const ok = !!(out.res && !out.error);
  let request = null, response = null;
  if (budget && budget.left > 0 && out.wire) {
    const cut = (t) => (t.length > REPORT_BODY_MAX ? `${t.slice(0, REPORT_BODY_MAX)}\n… (cut at ${fmtSize(REPORT_BODY_MAX)})` : t);
    request = { headers: out.wire.headers.map(([k, v]) => [String(k), String(v)]), body: cut(wireBodyText(out.wire)) };
    if (ok) response = { headers: (out.res.headers || []).map(([k, v]) => [String(k), String(v)]), body: out.res.binary ? `(binary, ${fmtSize(out.res.size || 0)})` : cut(String(out.res.body ?? '')) };
    budget.left -= (request.body.length + (response ? response.body.length : 0)) * 2 + 2048;
  }
  return {
    iteration: it + 1, dataRow: dataRow ?? null, name: ed.name, path: parents.map((p) => p.name),
    method: out.wire ? out.wire.method : ed.method, url: out.wire ? out.wire.url : ed.url,
    status: ok ? out.res.status : null, reason: ok ? (out.res.reason || REASONS[out.res.status] || '') : '',
    timeMs: ok ? out.res.timeMs : null, size: ok ? out.res.size : null, error: out.error || '', skipped: !!out.skipped,
    warnings: out.warnings || [], tests: out.tests.map((x) => ({ name: x.name, passed: x.passed, error: x.error || '' })),
    logs: (out.logs || []).filter((l) => l.level === 'error' || l.level === 'warn').map((l) => `${l.src ? `${l.src}: ` : ''}${l.text}`).slice(0, 20),
    request, response,
  };
}
/** What leaves the app (CLI events, JSON report): URL secrets masked; headers and bodies only with bodies, masked. */
function publicResult(r, bodies = false) {
  const { request, response, ...rest } = r;
  const out = { ...rest, url: maskUrl(r.url) };
  if (bodies) {
    out.request = request ? { headers: maskHeaders(request.headers), body: request.body } : null;
    out.response = response ? { headers: maskHeaders(response.headers), body: response.body } : null;
  }
  return out;
}
function runStats(run) {
  const R = run.results;
  const tests = R.flatMap((r) => r.tests);
  const sent = R.filter((r) => !r.error && !r.skipped && r.status != null);
  const totalMs = sent.reduce((a, r) => a + (r.timeMs || 0), 0);
  const classes = { '2xx': 0, '3xx': 0, '4xx': 0, '5xx': 0, other: 0 };
  for (const r of sent) { const k = `${String(r.status)[0]}xx`; if (k in classes) classes[k]++; else classes.other++; }
  return {
    requests: R.length, sent: sent.length, errors: R.filter((r) => r.error).length, skipped: R.filter((r) => r.skipped).length,
    pass: tests.filter((t) => t.passed === true).length, fail: tests.filter((t) => t.passed === false).length, skippedTests: tests.filter((t) => t.passed === null).length,
    totalMs, avgMs: sent.length ? Math.round(totalMs / sent.length) : null, classes,
  };
}

/** One self-contained HTML file: no scripts, no external assets, a CSP that allows only its own styles. */
function runReportHtml(run, { bodies = false, onlyFailed = false, note = '' } = {}) {
  const e = (x) => escapeHtml(String(x ?? ''));
  const st = runStats(run);
  const when = run.startedAt ? new Date(run.startedAt) : new Date();
  const facts = [
    run.environment ? ['Environment', run.environment] : null,
    run.folder ? ['Folder', run.folder] : null,
    run.dataFile ? ['Data file', `${run.dataFile.name} (${run.dataFile.rows} row${run.dataFile.rows === 1 ? '' : 's'})`] : null,
    ['Iterations', run.iterations ?? 1],
    ['Started', when.toLocaleString()],
    run.durationMs != null ? ['Duration', fmtMs(run.durationMs)] : null,
  ].filter(Boolean);
  const card = (label, big, tone, lines) => `<section data-card${tone ? ` data-tone="${tone}"` : ''}><h3>${e(label)}</h3><p data-big>${e(big)}</p>${lines.map((l) => `<p>${e(l)}</p>`).join('')}</section>`;
  const statusTone = (s) => (s == null ? 'err' : s >= 500 ? 'err' : s >= 400 ? 'warn' : s >= 300 ? 'redirect' : 'ok');
  const kv = (hs) => (hs.length ? `<table>${hs.map(([k, v]) => `<tr><th>${e(k)}</th><td>${e(v)}</td></tr>`).join('')}</table>` : '<p data-muted>No headers</p>');
  const pre = (t) => (t ? `<pre>${e(t)}</pre>` : '<p data-muted>No body</p>');
  const items = run.results.map((r, i) => {
    if (onlyFailed && !(r.error || r.tests.some((t) => t.passed === false))) return '';
    const pr = publicResult(r, bodies);
    const status = r.skipped ? '<span data-pill data-tone="muted">Skipped</span>'
      : r.error ? '<span data-pill data-tone="err">Not sent</span>'
        : `<span data-pill data-tone="${statusTone(r.status)}">${e(`${r.status} ${r.reason || ''}`.trim())}</span>`;
    const where = [`#${i + 1}`, `Iteration ${r.iteration}`, r.dataRow != null ? `Data row ${r.dataRow}` : null,
      r.timeMs != null ? fmtMs(r.timeMs) : null, r.size != null ? fmtSize(r.size) : null].filter(Boolean).join(' · ');
    const tests = r.tests.length ? `<ul>${r.tests.map((t) => {
      const [tone, word] = t.passed === true ? ['ok', 'Pass'] : t.passed === false ? ['err', 'Fail'] : ['muted', 'Skip'];
      return `<li><span data-pill data-tone="${tone}">${word}</span> <span>${e(t.name)}</span>${t.passed === false && t.error ? `<span data-msg>${e(t.error)}</span>` : ''}</li>`;
    }).join('')}</ul>` : '<p data-muted>No tests</p>';
    const notes = [...(r.error ? [['err', r.error]] : []), ...r.warnings.map((w) => ['warn', w]), ...r.logs.map((l) => ['warn', l])]
      .map(([tone, t]) => `<p data-note data-tone="${tone}">${e(t)}</p>`).join('');
    const detail = bodies ? `<details><summary>Request headers and body</summary>${pr.request ? kv(pr.request.headers) + pre(pr.request.body) : '<p data-muted>Not kept</p>'}</details>`
      + `<details><summary>Response headers and body</summary>${pr.response ? kv(pr.response.headers) + pre(pr.response.body) : '<p data-muted>No response</p>'}</details>` : '';
    const failed = r.error || r.tests.some((t) => t.passed === false);
    return `<article${failed ? ' data-failed' : ''}><header><span data-method="${e(r.method)}">${e(r.method)}</span> <h3>${e(r.name)}</h3>${r.path.length ? ` <span data-muted>${e(r.path.join(' / '))}</span>` : ''} ${status}</header>`
      + `<p data-url><code>${e(pr.url)}</code></p><p data-muted>${e(where)}</p>${notes}${tests}${detail}</article>`;
  }).filter(Boolean).join('\n');
  const statusLine = Object.entries(st.classes).filter(([, n]) => n).map(([k, n]) => `${n} × ${k}`).join(' · ') || 'No responses';
  const title = `${run.collection || 'Collection'}: run report`;
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'">
<meta name="generator" content="ApiMan">
<title>${e(title)}</title>
<style>
:root { --bg: #eef1f4; --panel: #fbfcfd; --line: #d6dce2; --ink: #17212b; --muted: #5b6875; --sunken: #e5e9ee;
  --ok: #1b7044; --warn: #a04c00; --err: #c2352b; --redirect: #756000; color-scheme: light dark; }
@media (prefers-color-scheme: dark) { :root { --bg: #12171d; --panel: #181f27; --line: #29333f; --ink: #dce3ea; --muted: #8b99a8; --sunken: #0f141a;
  --ok: #4cc38a; --warn: #f59b45; --err: #ff6b5e; --redirect: #e3c54f; } }
* { box-sizing: border-box; }
body { margin: 0; padding: 24px 16px 48px; background: var(--bg); color: var(--ink); font: 14px/1.5 system-ui, -apple-system, "Segoe UI", sans-serif; }
main { max-width: 1080px; margin: 0 auto; }
h1 { font-size: 24px; margin: 0 0 4px; overflow-wrap: anywhere; }
h2 { font-size: 16px; margin: 32px 0 12px; }
h3 { font-size: 14px; margin: 0; display: inline; overflow-wrap: anywhere; }
code, pre, [data-method] { font-family: ui-monospace, "SF Mono", Menlo, Consolas, monospace; font-size: 12.5px; }
dl { display: flex; flex-wrap: wrap; gap: 4px 20px; margin: 8px 0 0; color: var(--muted); }
dl div { display: flex; gap: 6px; } dt::after { content: ":"; } dd { margin: 0; color: var(--ink); overflow-wrap: anywhere; }
[data-cards] { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 12px; margin-top: 20px; }
[data-card] { background: var(--panel); border: 1px solid var(--line); border-radius: 10px; padding: 12px 16px; }
[data-card] h3 { display: block; font-size: 12px; text-transform: uppercase; letter-spacing: .04em; color: var(--muted); }
[data-card] p { margin: 2px 0 0; color: var(--muted); } [data-card] p[data-big] { font-size: 22px; font-weight: 600; color: var(--ink); }
[data-card][data-tone="err"] p[data-big] { color: var(--err); } [data-card][data-tone="ok"] p[data-big] { color: var(--ok); }
article { background: var(--panel); border: 1px solid var(--line); border-radius: 10px; padding: 12px 16px; margin-bottom: 10px; }
article[data-failed] { border-left: 4px solid var(--err); }
article header { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 8px; }
article p { margin: 6px 0 0; }
[data-url] code { overflow-wrap: anywhere; }
[data-muted] { color: var(--muted); }
[data-method] { font-weight: 600; }
[data-pill] { display: inline-block; border-radius: 999px; padding: 0 8px; font-size: 12px; font-weight: 600; border: 1px solid currentColor; }
[data-tone="ok"] { color: var(--ok); } [data-tone="warn"] { color: var(--warn); } [data-tone="err"] { color: var(--err); }
[data-tone="redirect"] { color: var(--redirect); } [data-tone="muted"] { color: var(--muted); }
[data-card][data-tone] { color: inherit; }
[data-note] { overflow-wrap: anywhere; }
ul { list-style: none; padding: 0; margin: 8px 0 0; }
li { display: flex; flex-wrap: wrap; gap: 2px 8px; padding: 3px 0; border-top: 1px solid var(--line); overflow-wrap: anywhere; }
li [data-msg] { flex-basis: 100%; color: var(--err); font-size: 13px; padding-left: 4px; }
details { margin-top: 8px; } summary { cursor: pointer; color: var(--muted); }
table { border-collapse: collapse; width: 100%; margin-top: 6px; font-size: 12.5px; }
th, td { text-align: left; vertical-align: top; padding: 3px 8px; border-top: 1px solid var(--line); overflow-wrap: anywhere; }
th { width: 30%; font-weight: 600; }
pre { background: var(--sunken); border-radius: 6px; padding: 8px 12px; overflow: auto; max-height: 480px; white-space: pre-wrap; overflow-wrap: anywhere; margin: 6px 0 0; }
footer { margin-top: 32px; color: var(--muted); font-size: 12px; }
</style></head>
<body><main>
<h1>${e(run.collection || 'Collection')}</h1>
<p data-muted>ApiMan run report</p>
<dl>${facts.map(([k, v]) => `<div><dt>${e(k)}</dt><dd>${e(v)}</dd></div>`).join('')}</dl>
${run.error ? `<p data-note data-tone="err">Run stopped: ${e(run.error)}</p>` : run.stopped ? '<p data-note data-tone="warn">The run was stopped before the end.</p>' : ''}
<div data-cards>
${card('Requests', st.requests, st.errors ? 'err' : '', [`${st.sent} sent`, ...(st.errors ? [`${st.errors} not sent`] : []), ...(st.skipped ? [`${st.skipped} skipped`] : [])])}
${card('Assertions', `${st.pass} / ${st.pass + st.fail}`, st.fail ? 'err' : st.pass ? 'ok' : '', [`${st.pass} passed, ${st.fail} failed`, ...(st.skippedTests ? [`${st.skippedTests} skipped`] : [])])}
${card('Time', fmtMs(st.totalMs), '', [`Average ${st.avgMs != null ? fmtMs(st.avgMs) : '–'} per request`])}
${card('Status classes', statusLine, '', [])}
</div>
<h2>Requests</h2>
${note ? `<p data-note data-tone="warn">${e(note)}</p>` : ''}
${items || '<p data-muted>No requests ran.</p>'}
<footer>${bodies ? 'Headers and bodies included; secret headers (Authorization, Cookie, tokens, secrets, passwords, API keys) are masked.' : 'Headers and bodies are not included.'} Secret-looking URL query values are masked.</footer>
</main></body></html>
`;
}
/** The HTML report within maxBytes (UTF-8): without bodies if needed, then only the requests that failed. */
const REPORT_HTML_MAX = 50 * 1024 * 1024;
function reportWithin(run, bodies, maxBytes) {
  const size = (t) => new Blob([t]).size;
  let html = runReportHtml(run, { bodies });
  if (size(html) <= maxBytes) return html;
  if (bodies) { html = runReportHtml(run, { bodies: false, note: 'Headers and bodies were left out: with them the report would be too large.' }); if (size(html) <= maxBytes) return html; }
  return runReportHtml(run, { bodies: false, onlyFailed: true, note: 'Only the requests that failed are listed: the full report would be too large.' });
}
function runReportJson(run, { bodies = false } = {}) {
  const st = runStats(run);
  return JSON.stringify({
    collection: run.collection, environment: run.environment || null, folder: run.folder || null,
    dataFile: run.dataFile || null, iterations: run.iterations, startedAt: run.startedAt, seconds: run.durationMs != null ? run.durationMs / 1000 : null,
    passed: st.pass, failed: st.fail, requestErrors: st.errors, skippedRequests: st.skipped, stopped: !!run.stopped,
    ...(run.error ? { error: run.error } : {}),
    results: run.results.map((r) => publicResult(r, bodies)),
  }, null, 2);
}
/** JUnit XML (CI test tabs): one testsuite per request run, labelled with its iteration and data row. */
function runReportJunit(run) {
  const x = (s) => String(s ?? '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]));
  const tot = { tests: 0, failures: 0, errors: 0, skipped: 0, time: 0 };
  const multi = (run.iterations || 1) > 1;
  const suites = run.results.map((r) => {
    const secs = (r.timeMs || 0) / 1000;
    const label = [...r.path, r.name].join(' / ') + (multi || r.dataRow != null ? ` (iteration ${r.iteration}${r.dataRow != null ? `, data row ${r.dataRow}` : ''})` : '');
    const classname = [...r.path, r.name].map((p) => String(p).replace(/[^\w-]+/g, '_')).join('.') || 'request';
    const cases = [];
    let failures = 0, errors = 0, skipped = 0;
    if (r.error) { errors++; cases.push(`<testcase classname="${x(classname)}" name="${x(`${r.method} request`)}" time="${secs.toFixed(3)}"><error message="${x(r.error.slice(0, 500))}">${x(r.error)}</error></testcase>`); }
    for (const t of r.tests) {
      if (t.passed === false) { failures++; cases.push(`<testcase classname="${x(classname)}" name="${x(t.name)}" time="0"><failure message="${x((t.error || 'failed').slice(0, 500))}">${x(t.error || 'failed')}</failure></testcase>`); }
      else if (t.passed === null) { skipped++; cases.push(`<testcase classname="${x(classname)}" name="${x(t.name)}" time="0"><skipped/></testcase>`); }
      else cases.push(`<testcase classname="${x(classname)}" name="${x(t.name)}" time="0"/>`);
    }
    if (r.skipped && !cases.length) { skipped++; cases.push(`<testcase classname="${x(classname)}" name="${x(`${r.method} request`)}" time="0"><skipped message="pm.execution.skipRequest()"/></testcase>`); }
    if (!cases.length) cases.push(`<testcase classname="${x(classname)}" name="${x(`${r.method} responded ${r.status}`)}" time="${secs.toFixed(3)}"/>`);
    tot.tests += cases.length; tot.failures += failures; tot.errors += errors; tot.skipped += skipped; tot.time += secs;
    const props = `<properties><property name="iteration" value="${r.iteration}"/>${r.dataRow != null ? `<property name="dataRow" value="${r.dataRow}"/>` : ''}<property name="url" value="${x(maskUrl(r.url))}"/></properties>`;
    return `  <testsuite name="${x(label)}" tests="${cases.length}" failures="${failures}" errors="${errors}" skipped="${skipped}" time="${secs.toFixed(3)}">\n    ${props}\n    ${cases.join('\n    ')}\n  </testsuite>`;
  });
  return `<?xml version="1.0" encoding="utf-8"?>\n<testsuites name="${x(run.collection || 'Collection')}" tests="${tot.tests}" failures="${tot.failures}" errors="${tot.errors}" skipped="${tot.skipped}" time="${tot.time.toFixed(3)}">\n${suites.join('\n')}\n</testsuites>\n`;
}
/** The run as the reports describe it; results are added by the caller. */
function newRunRecord({ cid, folderId, iterations, dataFile = null }) {
  const col = state.cols[cid];
  const folder = folderId && col ? locate(col, folderId) : null;
  const env = state.activeEnv && state.envs[state.activeEnv];
  return {
    collection: col ? String(col.info && col.info.name || 'Collection') : 'Collection', folder: folder ? folder.item.name : null,
    environment: env ? env.name : '', dataFile, iterations, startedAt: new Date().toISOString(), results: [], stopped: false, error: '',
  };
}

// ---------- runner ----------
async function openRunner(cid, folderId) {
  if (!state.colList.length) { toast('Create or import a collection first.', 'warn'); return; }
  await Promise.all(state.colList.map((c) => withCol(c.id).catch(() => {})));
  const colSel = ui.select(state.colList.map((c) => [c.id, labelWithFolder(c)]), { value: cid || (cur() && cur().cid) || state.colList[0].id });
  const folderSel = ui.select([]);
  const iterIn = ui.input({ type: 'number', num: true, min: '1', max: '1000', value: '1' });
  const delayIn = ui.input({ type: 'number', num: true, min: '0', max: '60000', value: '0' });
  const stopCheck = ui.check({ label: 'Stop on first failure' });
  const keepCheck = ui.check({ label: 'Save variable changes', help: 'Values set by scripts (like a login token) are saved to the environment and collection.' }); // opt-in: a run doesn't rewrite your files unless you ask
  const stopOnFail = stopCheck.input, keepVars = keepCheck.input;
  const fillFolders = () => {
    const col = state.cols[colSel.value];
    folderSel.replaceChildren(h('option', { value: '' }, 'Whole collection'));
    const walk = (items, depth) => { for (const it of items) if (isFolder(it)) { folderSel.append(h('option', { value: it.id, ...(it.id === folderId ? { selected: true } : {}) }, `${'– '.repeat(depth)}${it.name}`)); walk(it.item, depth + 1); } };
    if (col) walk(col.item, 0);
  };
  colSel.addEventListener('change', () => { folderId = null; fillFolders(); });
  fillFolders();

  // Data file: one iteration per row; its columns are {{variables}} and pm.iterationData
  let data = null; // { name, rows, columns, format }
  const DATA_NONE = 'None: every iteration uses the same values. A CSV or JSON file runs once per row.';
  const dataInfo = h('div', null, ui.hint(DATA_NONE));
  const dataPick = ui.input({ type: 'file', hidden: true, accept: '.csv,.json,text/csv,application/json', 'aria-label': 'Data file' });
  const dataBtn = ui.button({ label: 'Choose file', size: 'small', onClick: () => dataPick.click() });
  const dataClear = ui.button({ label: 'Remove', size: 'small', hidden: true, onClick: () => setData(null) });
  const setData = (d, err = null, name = '') => {
    data = d;
    dataBtn.textContent = d ? 'Change file' : 'Choose file';
    dataClear.hidden = !d && !err;
    iterIn.max = d ? String(d.rows.length) : '1000';
    iterIn.value = d ? String(d.rows.length) : '1';
    dataInfo.replaceChildren(err ? ui.note(`${name}: ${err}`, 'err') : d ? ui.hint(`${d.name} · ${dataSummary(d)}`, { title: d.name }) : ui.hint(DATA_NONE));
    if (!d) dataPick.value = '';
  };
  dataPick.addEventListener('change', async () => {
    const f = dataPick.files[0];
    if (!f) return;
    try {
      if (f.size > DATA_FILE_MAX) throw new Error(`The file is larger than ${fmtSize(DATA_FILE_MAX)}.`);
      setData({ name: f.name, ...parseIterationData(await f.text(), f.name) });
    } catch (e) { setData(null, e.message, f.name); }
  });
  const dataField = ui.field('Data file', h('div', { class: 'field-row' }, dataBtn, dataClear, dataPick));
  dataField.append(dataInfo);

  const summary = ui.meta([]);
  const bar = ui.progress();
  const tbody = h('tbody');
  const head = h('tr');
  let lastRun = null;
  const fmtSel = ui.select([['html', 'HTML report'], ['json', 'JSON'], ['junit', 'JUnit XML']], { size: 'small', 'aria-label': 'Report format' });
  const bodiesCheck = ui.check({ label: 'Include headers and bodies (secrets masked)' });
  fmtSel.addEventListener('change', () => { bodiesCheck.hidden = fmtSel.value === 'junit'; });
  const exportReport = () => {
    if (!lastRun) return;
    const bodies = bodiesCheck.input.checked;
    const base = String(lastRun.collection).replace(/[^\w.-]+/g, '-').replace(/^-+|-+$/g, '') || 'run';
    const [text, ext, type] = fmtSel.value === 'json' ? [runReportJson(lastRun, { bodies }), 'json', 'application/json']
      : fmtSel.value === 'junit' ? [runReportJunit(lastRun), 'xml', 'application/xml'] : [runReportHtml(lastRun, { bodies }), 'html', 'text/html'];
    download(`${base}-report.${ext}`, text, `${type};charset=utf-8`);
    toast(lastRun.bodiesCut && bodies ? 'Report exported. Later requests have no bodies: the run was too large to keep them all.' : 'Report exported', lastRun.bodiesCut && bodies ? 'warn' : 'ok');
  };
  const exportBar = ui.toolbar([fmtSel, bodiesCheck], [ui.button({ label: 'Export report', icon: 'download', variant: 'ghost', size: 'small', onClick: exportReport })], { hidden: true });
  const results = h('div', { id: 'runResults', hidden: true }, summary, bar, exportBar,
    h('table', { class: 'grid' }, h('thead', null, head), tbody));
  let ctrl = null;
  const runErr = h('div');
  /** Iterations: a whole number 1–1000; delay: a whole number of ms 0–60000. Run is off until both are. */
  const checkInputs = () => {
    const it = iterIn.value.trim(), dl = delayIn.value.trim();
    const bad = !/^\d+$/.test(it) || +it < 1 || +it > 1000 ? 'Iterations must be a whole number from 1 to 1000.'
      : dl !== '' && (!/^\d+$/.test(dl) || +dl > 60000) ? 'The delay must be a whole number of milliseconds from 0 to 60000.' : '';
    iterIn.setAttribute('aria-invalid', String(bad.startsWith('Iterations')));
    delayIn.setAttribute('aria-invalid', String(bad.startsWith('The delay')));
    runErr.replaceChildren(bad ? ui.note(bad, 'err') : '');
    const b = $('#dlgFoot .btn.primary');
    if (b && !ctrl) b.disabled = !!bad;
    return !bad;
  };
  iterIn.addEventListener('input', checkInputs);
  delayIn.addEventListener('input', checkInputs);

  openDialog({
    title: 'Collection runner',
    cancel: 'Close',
    body: [
      h('div', { class: 'grid-2' }, ui.field('Collection', colSel), ui.field('Folder', folderSel)),
      h('div', { class: 'grid-2' }, ui.field('Iterations', iterIn), ui.field('Delay between requests (ms)', delayIn)),
      runErr,
      dataField,
      keepCheck,
      stopCheck,
      results,
    ],
    onClose: () => { if (ctrl) ctrl.abort(); },
    // Not awaited, so the button stays clickable as "Stop" while the run is in progress.
    buttons: [{ label: 'Run', primary: true, onClick: () => {
      if (ctrl) { ctrl.abort(); return false; }
      if (!checkInputs()) return false;
      run().catch((e) => { toast(e.message, 'err'); ctrl = null; const b = $('#dlgFoot .btn.primary'); if (b) b.textContent = 'Run again'; });
      return false;
    } }],
  });

  async function run() {
    const runCid = colSel.value;
    const rows = data ? data.rows : null;
    const iterations = Math.max(1, Math.min(rows ? rows.length : 1000, Number(iterIn.value) || (rows ? rows.length : 1)));
    const runBtn = $('#dlgFoot .btn.primary');
    ctrl = new AbortController();
    runBtn.textContent = 'Stop';
    results.hidden = false;
    exportBar.hidden = true;
    tbody.replaceChildren();
    head.replaceChildren(h('th', { class: 'tight' }, '#'), ...(rows ? [h('th', { class: 'tight' }, 'Row')] : []), h('th', null, 'Request'),
      ...['Status', 'Time', 'Tests'].map((x) => h('th', { class: 'num' }, x)));
    const record = newRunRecord({ cid: runCid, folderId: folderSel.value || null, iterations, dataFile: data ? { name: data.name, rows: data.rows.length, columns: data.columns } : null });
    const budget = { left: REPORT_BODIES_BUDGET };
    const started = performance.now();
    let t = null;
    try {
      t = await runCollection({
        cid: runCid, folderId: folderSel.value || null, iterations, delay: Number(delayIn.value) || 0, iterationData: rows,
        stopOnFail: stopOnFail.checked, keepVars: keepVars.checked, signal: ctrl.signal,
        onResult: (r) => {
          const { it, step, dataRow, ed, out, tp, totals } = r;
          record.results.push(runResultRecord(r, budget));
          if (budget.left <= 0) record.bodiesCut = true;
          const { n, pass, fail, errors, skipped, totalMs, ok, c4, c5, total } = totals;
          tbody.append(h('tr', null,
            h('td', { class: 'tight' }, iterations > 1 ? `${it + 1}.${step + 1}` : String(n)),
            ...(rows ? [h('td', { class: 'tight' }, String(dataRow))] : []),
            h('td', null, ui.method(ed.method), ' ', ed.name,
              ...out.tests.filter((x) => x.passed === false).map((x) => ui.result('err', 'Fail', `${x.name}: ${x.error}`, null, { compact: true })),
              out.skipped ? ui.result('muted', 'Skipped', 'pm.execution.skipRequest() in a pre-request script', null, { compact: true }) : null,
              out.error ? ui.result('err', 'Error', out.error, null, { compact: true }) : null),
            h('td', { class: 'num' }, (out.error || out.skipped ? '–' : ui.status(out.res.status))),
            h('td', { class: 'num' }, out.res && !out.error ? fmtMs(out.res.timeMs) : '–'),
            h('td', { class: 'num' }, out.tests.length ? `${tp}/${out.tests.length}` : '–')));
          bar.firstChild.style.width = `${Math.min(100, (n / total) * 100)}%`;
          bar.classList.toggle('err', fail + errors + c5 > 0);
          bar.classList.toggle('warn', !(fail + errors + c5) && c4 > 0);
          const outcome = [`${ok} succeeded`, ...(c4 ? [`${c4} returned 4xx`] : []), ...(c5 ? [`${c5} returned 5xx`] : []), ...(errors ? [`${errors} not sent`] : []), ...(skipped ? [`${skipped} skipped`] : [])].join(', ');
          const sent = n - errors - skipped;
          summary.replaceChildren(
            h('span', null, ui.value(n > total ? String(n) : `${n} of ${total}`), ` requests: ${outcome}`),
            h('span', null, 'Tests: ', ui.value(`${pass} passed`, pass ? 'ok' : 'muted'), ' ', ui.value(`${fail} failed`, fail ? 'err' : 'muted')),
            h('span', null, `Average ${sent ? fmtMs(Math.round(totalMs / Math.max(1, sent))) : '–'}`));
        },
      });
    } finally {
      const ms = Math.round(performance.now() - started);
      if (t && t.error) summary.append(h('span', null, ui.value(t.error, 'err')));
      summary.append(h('span', null, `${t && !t.stopped ? 'Finished' : 'Stopped'} in ${fmtMs(ms)}`));
      Object.assign(record, { durationMs: ms, stopped: !t || t.stopped, error: t ? t.error || '' : '' });
      lastRun = record;
      exportBar.hidden = !record.results.length;
      ctrl = null;
      runBtn.textContent = 'Run again';
      if (state.view === 'environments') renderSidebar();
      renderResolved();
    }
  }
}

/**
 * Runs a collection or folder: the Runner dialog and `python3 server.py run` both use this.
 * Values set by scripts carry through the whole run (like Postman), saved to files only with keepVars.
 * iterationData: rows of a data file, one per iteration (iterations = rows; a given count caps it).
 * Scripts steer the order with pm.execution.setNextRequest(name or id) (null ends the iteration, as in Postman)
 * and skip a request with pm.execution.skipRequest(). totals.error says why a run stopped early.
 */
async function runCollection({ cid, folderId = null, iterations = 1, delay = 0, stopOnFail = false, keepVars = false, iterationData = null, signal, onResult = () => {}, envId = state.activeEnv, casesFor = null, only = null }) {
  // casesFor(item): the cases (rows of Automation test data) to send it with, [{ label, data, expect, bind }]; only(item): run it at all
  const col = state.cols[cid] || await withCol(cid);
  const folder = folderId ? locate(col, folderId) : null;
  if (folderId && !folder) throw new Error('That folder no longer exists.');
  const items = [];
  eachRequest(folder ? folder.item.item : col.item, (item, parents) => { if (!only || only(item)) items.push({ item, parents: [...(folder ? [...folder.parents, folder.item] : []), ...parents] }); });
  if (!items.length) throw new Error('There are no requests to run here.');
  const caseList = items.map(({ item }) => (casesFor ? casesFor(item) : null) || [{}]);
  const rows = iterationData == null ? null : normalizeDataRows(iterationData).rows;
  if (rows && !rows.length) throw new Error('The data file has no rows.');
  if (rows) iterations = Math.min(rows.length, DATA_ROWS_MAX, iterations == null ? rows.length : Math.max(1, iterations | 0 || rows.length));
  else iterations = Math.max(1, Math.min(1000, iterations | 0 || 1));
  delay = Math.max(0, Math.min(60000, delay | 0));
  const perIteration = caseList.reduce((a, c) => a + c.length, 0);
  const totals = { n: 0, pass: 0, fail: 0, errors: 0, skipped: 0, totalMs: 0, ok: 0, c4: 0, c5: 0, total: perIteration * iterations, iterations, stopped: false, error: '' };
  const maxSteps = perIteration * iterations + STEP_MAX;
  let runScopes = scopesFor(cid, envId);
  outer: for (let it = 0; it < iterations; it++) {
    const row = rows ? rows[it] : null;
    let idx = 0, step = 0;
    while (idx < items.length) {
      const { item, parents } = items[idx];
      let next = null; // the request's last case decides where the run goes next
      for (const [ci, testCase] of caseList[idx].entries()) {
      if (signal && signal.aborted) { totals.stopped = true; break outer; }
      if (totals.n >= maxSteps) {
        totals.stopped = true;
        totals.error = `Stopped after ${totals.n} requests: pm.execution.setNextRequest() kept the run going (a loop that never calls setNextRequest(null)?).`;
        break outer;
      }
      const ed = applyBind(fromItem(item), testCase.bind);
      const data = testCase.data ? { ...(row || {}), ...testCase.data } : row;
      const out = await execute({ ed, cid, itemId: item.id, iteration: it, iterationCount: iterations, iterationData: data, inRun: true,
        signal, persist: keepVars, runScopes: keepVars ? null : runScopes, envId });
      next = out.next;
      // a negative case (its test data expects a 4xx/5xx, e.g. a wrong password) never changes what later requests use
      if (!keepVars && out.scopes && !(testCase.expect >= 400)) {
        delete out.scopes.data; // the next iteration brings its own row
        // carry script values to the next request, except ones that decide where requests go (URL/Host)
        // (path and query values like /orders/{{id}} do carry: they can't change the server)
        const written = ['environment', 'collection', 'globals'].flatMap((sc) => Object.entries(out.scopes[sc]).map(([key, value]) => ({ key, value })));
        const { names, complete, urls, headerNames } = await urlVariableNames(written);
        for (const sc of ['environment', 'collection', 'globals']) {
          for (const k of new Set([...Object.keys(runScopes[sc]), ...Object.keys(out.scopes[sc])])) {
            if (!names.has(k) || runScopes[sc][k] === out.scopes[sc][k]) continue;
            if (complete && !headerNames.has(k) && !canMoveOrigin(k, urls, out.scopes, cid)) continue;
            if (Object.hasOwn(runScopes[sc], k)) out.scopes[sc][k] = runScopes[sc][k]; else delete out.scopes[sc][k];
            out.logs.push({ level: 'warn', text: `Not carried to the next request: ${sc} variable "${k}" decides where requests go.`, src: 'ApiMan' });
          }
        }
        runScopes = out.scopes;
      }
      totals.n++;
      const tp = out.tests.filter((x) => x.passed === true).length;
      const tf = out.tests.filter((x) => x.passed === false).length;
      totals.pass += tp; totals.fail += tf;
      if (out.skipped) totals.skipped++;
      else if (out.error) totals.errors++;
      else if (out.res.status >= 500) totals.c5++;
      else if (out.res.status >= 400) totals.c4++;
      else totals.ok++;
      if (out.res && !out.error) totals.totalMs += out.res.timeMs;
      await onResult({ it, idx, step, dataRow: rows ? it + 1 : null, item, parents, ed, out, tp, tf, totals, testCase, caseIndex: ci, cases: caseList[idx].length });
      step++;
      if (stopOnFail && (tf || out.error)) { totals.stopped = true; break outer; }
      if (delay) await new Promise((r) => { const tm = setTimeout(r, delay); if (signal) signal.addEventListener('abort', () => { clearTimeout(tm); r(); }, { once: true }); });
      }
      let nextIdx = idx + 1;
      if (next) {
        if (next.to === null) nextIdx = items.length; // setNextRequest(null): this iteration ends here
        else {
          const to = next.to;
          let j = items.findIndex((x) => x.item.id === to);
          if (j < 0) j = items.findIndex((x) => String(x.item.name ?? '') === to);
          if (j < 0) {
            totals.stopped = true;
            totals.error = `pm.execution.setNextRequest(${JSON.stringify(to)}) in "${item.name}": no request with that name or id in this run.`;
            break outer;
          }
          nextIdx = j;
        }
      }
      idx = nextIdx;
    }
  }
  return totals;
}

/** `python3 server.py run`: run what the server asks for, streaming each result back, then report the end. */
async function headlessRun(job) {
  const post = (body) => api('POST', '/api/run-event', body).catch(() => {});
  try {
    if (job.envId !== undefined) setActiveEnv(job.envId || '');
    let folderId = null;
    if (job.folder) {
      const col = state.cols[job.cid] || await withCol(job.cid);
      const hits = [];
      const walk = (items) => items.forEach((it) => { if (isFolder(it)) { if (it.name === job.folder) hits.push(it); walk(it.item); } });
      walk(col.item);
      if (!hits.length) throw new Error(`No folder named "${job.folder}" in this collection.`);
      folderId = hits[0].id;
    }
    const rows = job.iterationData == null ? null : normalizeDataRows(job.iterationData).rows;
    const report = job.report && typeof job.report === 'object' ? job.report : {};
    const iterations = rows ? (job.iterations == null ? rows.length : Math.min(rows.length, Math.max(1, job.iterations | 0))) : job.iterations;
    const record = newRunRecord({ cid: job.cid, folderId, iterations, dataFile: rows ? { name: String(job.dataFile || 'data'), rows: rows.length, columns: normalizeDataRows(rows).columns } : null });
    const budget = report.html && report.bodies ? { left: REPORT_BODIES_BUDGET } : null;
    const started = performance.now();
    const totals = await runCollection({
      cid: job.cid, folderId, iterations, delay: job.delay, stopOnFail: !!job.bail, keepVars: false, iterationData: rows,
      onResult: (r) => {
        const rec = runResultRecord(r, budget);
        record.results.push(rec);
        return post({ type: 'result', result: publicResult(rec) });
      },
    });
    Object.assign(record, { durationMs: Math.round(performance.now() - started), stopped: totals.stopped, error: totals.error || '' });
    if (report.html) await post({ type: 'report', html: reportWithin(record, !!report.bodies, REPORT_HTML_MAX) });
    if (totals.error) await post({ type: 'fatal', error: totals.error });
    else await post({ type: 'done', totals });
  } catch (e) {
    await post({ type: 'fatal', error: e.message });
  }
}

// =====================================================================================================
// API suites: a Postman collection paired with a Robot Framework project (same APIs), run with its test data
// =====================================================================================================
const slugOf = (s) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '');
const normKey = (k) => String(k ?? '').replace(/[\s_]/g, '').toLowerCase(); // how Robot matches variable names
/** A path segment that stands for a value: {{id}}, ${ID}, :id, {id}, <id>, 42, a UUID or an object id. */
const isWildSeg = (seg) => !seg || /\{\{|\$\{|^:|^\{.*\}$|^<.*>$/.test(seg) || /^\d+$/.test(seg) || /^[0-9a-f]{8}-[0-9a-f]{4}-/i.test(seg) || /^[0-9a-f]{24}$/i.test(seg);
/** The path of a request URL, whatever its host looks like: {{baseUrl}}/x, ${BASE_URL}/x, https://h/x, {{host}}:{{port}}/x. */
function urlPath(raw) {
  let u = String(raw ?? '').trim().split('#')[0].split('?')[0];
  u = u.replace(/^(\{\{[^{}]+\}\}|\$\{[^{}]+\})/, '');
  if (/^:\/\//.test(u)) u = u.replace(/^:\/\/[^/]*/, '');           // {{protocol}}://{{host}}/x
  const m = u.match(/^[a-z][a-z0-9+.-]*:\/\/[^/]*(.*)$/i);
  if (m) u = m[1];
  else if (!u.startsWith('/')) { const i = u.indexOf('/'); u = i < 0 ? '' : u.slice(i); } // host/x, :{{port}}/x
  return u.replace(/\/{2,}/g, '/') || '/';
}
const pathSig = (method, url) => ({ method: String(method || 'GET').toUpperCase(), segs: urlPath(url).split('/').filter(Boolean).map((x) => x.toLowerCase()) });
/** Same endpoint: same method, same number of segments, every fixed segment equal, and at least one fixed segment
 *  in common (so /{{x}} doesn't match every one-segment path, and a bare "/" is no evidence of the same API). */
function sigMatch(a, b) {
  if (a.method !== b.method || a.segs.length !== b.segs.length) return false;
  let fixed = 0;
  for (let i = 0; i < a.segs.length; i++) {
    if (isWildSeg(a.segs[i]) || isWildSeg(b.segs[i])) continue;
    if (a.segs[i] !== b.segs[i]) return false;
    fixed++;
  }
  return fixed > 0;
}
/** Which of a collection's requests the Robot project also calls: { covered: Set(item ids), total }. */
function coverage(endpoints, col) {
  const eps = (endpoints || []).map((e) => pathSig(e.method, e.path));
  const covered = new Set();
  let total = 0;
  eachRequest(col.item || [], (item) => {
    total++;
    const ed = fromItem(item);
    if (!String(ed.url).trim()) return; // a request with no URL calls nothing
    const sig = pathSig(ed.method, ed.url);
    if (eps.some((e) => sigMatch(sig, e))) covered.add(item.id);
  });
  return { covered, total };
}
/** The collection a project's tests call the most (null when none shares a request). A pair someone chose wins;
 *  a collection someone paired with another project isn't picked automatically. */
function pairFor(project, pairs = {}) {
  if (Object.hasOwn(pairs, project.id)) {
    const cid = pairs[project.id];
    return cid && state.cols[cid] ? { cid, auto: false, ...coverage(project.endpoints, state.cols[cid]) } : null;
  }
  const taken = new Set(Object.entries(pairs).filter(([pid, cid]) => pid !== project.id && cid).map(([, cid]) => cid));
  let best = null;
  for (const c of state.colList) {
    const col = state.cols[c.id];
    if (!col || taken.has(c.id)) continue;
    const cov = coverage(project.endpoints, col);
    if (!cov.covered.size) continue;
    const words = (x) => new Set(String(x).toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 2));
    const pw = words(project.name);
    const named = [...words(c.name)].filter((w) => pw.has(w)).length; // a tie goes to the collection named like the project
    if (!best || cov.covered.size > best.covered.size || (cov.covered.size === best.covered.size && named > best.named)) best = { cid: c.id, auto: true, named, ...cov };
  }
  return best;
}

/** CSV/TSV text as rows (objects by header): quotes, "" escapes, newlines in quotes, BOM, ; or tab or | separators. */
function parseDelimited(text) {
  text = String(text).replace(/^﻿/, '');
  const firstLine = text.split(/\r?\n/, 1)[0];
  const delim = [',', ';', '\t', '|'].map((d) => [d, firstLine.split(d).length]).sort((a, b) => b[1] - a[1])[0][0];
  const rows = [];
  let row = [], field = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else quoted = false; } else field += c;
    } else if (c === '"' && field === '') quoted = true;
    else if (c === delim) { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(field); field = ''; rows.push(row); row = []; }
    else field += c;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  const lines = rows.filter((r) => r.some((x) => x.trim() !== ''));
  if (lines.length < 2) return [];
  const head = lines[0].map((x) => x.trim());
  return lines.slice(1).map((r) => Object.fromEntries(head.map((h, i) => [h, String(r[i] ?? '').trim()]).filter(([h]) => h)));
}
const cellText = (v) => (v == null ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v));
/** The test data in one file: [{ name, source, rows }]. JSON: a list of rows, { "request name": [rows] }, or one row. */
function datasetsFrom(path, text) {
  const base = path.split('/').pop().replace(/\.[^.]+$/, '');
  const rowsOf = (list) => list.filter((r) => r && typeof r === 'object' && !Array.isArray(r)).map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, cellText(v)])));
  if (/\.(csv|tsv)$/i.test(path)) { const rows = parseDelimited(text); return rows.length ? [{ name: base, source: path, rows }] : []; }
  if (!/\.json$/i.test(path)) return [];
  let data;
  try { data = JSON.parse(text); } catch { return []; }
  if (Array.isArray(data)) { const rows = rowsOf(data); return rows.length ? [{ name: base, source: path, rows }] : []; }
  if (!data || typeof data !== 'object') return [];
  const lists = Object.entries(data).filter(([, v]) => Array.isArray(v) && v.some((r) => r && typeof r === 'object' && !Array.isArray(r)));
  if (lists.length) return lists.map(([k, v]) => ({ name: k, source: `${path} › ${k}`, rows: rowsOf(v) })).filter((d) => d.rows.length);
  if (Object.values(data).every((v) => v === null || typeof v !== 'object' || !Array.isArray(v))) return [{ name: base, source: path, rows: rowsOf([data]) }];
  return [];
}
const EXPECT_COLS = new Set(['expectedstatus', 'expectstatus', 'expectedstatuscode', 'expectedcode']);
const LABEL_COLS = new Set(['case', 'testcase', 'casename', 'scenario']);
const SKIP_COLS = new Set(['skip']);
const REQUEST_COLS = new Set(['request', 'requestname', 'endpoint', 'api']);
const truthy = (v) => /^(true|yes|y|1|x)$/i.test(String(v).trim());
const MAX_ROWS_PER_REQUEST = 100, MAX_CASES = 5000;

/** A data column's name as a field path: "items[0].Quantity" -> "items.0.quantity" (case, spaces, _ ignored per part). */
const fieldKey = (k) => String(k).replace(/\[(\d+)\]/g, '.$1').split('.').map(normKey).filter(Boolean).join('.');
/** The fields a request already has that a data column of the same name can fill: [{ kind, key, path }]. */
function requestFields(ed) {
  const out = [];
  const q = String(ed.url).split('#')[0];
  const qi = q.indexOf('?');
  if (qi >= 0) for (const pair of q.slice(qi + 1).split('&')) { const k = pair.split('=')[0]; if (k) { let key = k; try { key = decodeURIComponent(k); } catch { /* as written */ } out.push({ kind: 'query', key, match: fieldKey(key) }); } }
  for (const v of ed.pathVars || []) if (v.key) out.push({ kind: 'path', key: v.key, match: fieldKey(v.key) });
  const b = ed.body || {};
  if (b.mode === 'raw' && /^\s*[[{]/.test(b.raw || '')) {
    let json = null;
    try { json = JSON.parse(b.raw); } catch { /* {{x}} outside quotes: its fields can't be filled from data */ }
    const walk = (v, path, depth) => {
      if (depth > 5 || v === null || typeof v !== 'object') return;
      for (const [k, x] of Object.entries(v)) {
        const pth = [...path, k];
        out.push({ kind: 'body', path: pth, key: pth.join('.'), match: pth.map((y) => normKey(y)).join('.') });
        walk(x, pth, depth + 1);
      }
    };
    if (json) walk(json, [], 0);
  }
  if (b.mode === 'urlencoded' || b.mode === 'formdata') for (const f of (b[b.mode] || [])) if (f.key && f.type !== 'file' && !f.disabled) out.push({ kind: 'form', key: f.key, match: fieldKey(f.key) });
  return out;
}
/** A cell as the type the field had: 2 stays a number, true a boolean, {"a":1} an object. */
function typedCell(orig, cell) {
  const c = String(cell);
  if (typeof orig === 'number' && c.trim() !== '' && Number.isFinite(Number(c))) return Number(c);
  if (typeof orig === 'boolean' && /^(true|false)$/i.test(c.trim())) return /^true$/i.test(c.trim());
  if (orig !== null && typeof orig === 'object') { try { return JSON.parse(c); } catch { return c; } }
  if (orig === null && c.trim() === 'null') return null;
  return c;
}
/** Fill a request's own fields from one row of test data (in place); the host is never touched. */
function applyBind(ed, bind) {
  if (!bind || !bind.length) return ed;
  let json = null;
  for (const b of bind) {
    if (b.kind === 'query') {
      const [base, ...hash] = String(ed.url).split('#');
      const qi = base.indexOf('?');
      if (qi < 0) continue;
      const parts = base.slice(qi + 1).split('&').map((pair) => {
        const [k] = pair.split('=');
        let key = k; try { key = decodeURIComponent(k); } catch { /* as written */ }
        return key === b.key ? `${k}=${encodeURIComponent(b.value)}` : pair;
      });
      ed.url = `${base.slice(0, qi)}?${parts.join('&')}${hash.length ? `#${hash.join('#')}` : ''}`;
    } else if (b.kind === 'path') {
      ed.pathVars = (ed.pathVars || []).map((v) => (v.key === b.key ? { ...v, value: b.value } : v));
    } else if (b.kind === 'form') {
      for (const f of ed.body[ed.body.mode] || []) if (f.key === b.key && f.type !== 'file') f.value = b.value;
    } else if (b.kind === 'body') {
      try { json = json ?? JSON.parse(ed.body.raw); } catch { continue; }
      let o = json;
      for (const k of b.path.slice(0, -1)) { if (o == null || typeof o !== 'object') break; o = o[k]; }
      const last = b.path[b.path.length - 1];
      if (o && typeof o === 'object' && Object.hasOwn(o, last)) o[last] = typedCell(o[last], b.value);
    }
  }
  if (json) ed.body.raw = JSON.stringify(json, null, 2);
  return ed;
}

/** The {{variables}} a request needs that the environment and collection don't give, and the one that names its host. */
function requestNeeds(ed, cid, envId, itemId) {
  const auth = effectiveAuth(ed, cid, itemId).auth;
  const text = JSON.stringify({ url: ed.url, headers: (ed.headers || []).filter((x) => !x.disabled), pathVars: ed.pathVars, body: ed.body, auth });
  const have = merged(scopesFor(cid, envId));
  const hostVar = (String(ed.url).trim().match(/^\{\{\s*([^{}]+?)\s*\}\}/) || [])[1] || null;
  const need = unresolved([text]).filter((k) => !k.startsWith('$') && !Object.hasOwn(have, k) && k !== hostVar);
  return { need, hostVar, hostMissing: !!hostVar && !Object.hasOwn(have, hostVar) };
}

/** For every request: the test data rows it's sent with. In order: a file (or JSON key) named after the request or
 *  its folder; rows of a "request" column naming it; else the data whose columns fill most of what it needs. */
function planSuite(cid, envId, datasets, endpoints) {
  const col = state.cols[cid];
  const cov = coverage(endpoints, col);
  const plan = [];
  let cases = 0, capped = false;
  eachRequest(col.item || [], (item, parents) => {
    const ed = fromItem(item);
    const { need, hostVar, hostMissing } = requestNeeds(ed, cid, envId, item.id);
    const names = [ed.name, ...parents.map((x) => x.name).reverse()].map(slugOf).filter(Boolean);
    let ds = null, rows = null, why = '';
    for (const n of names) { // nearest name first: the request, then its folders
      ds = datasets.find((d) => slugOf(d.name) === n);
      if (ds) { rows = ds.rows; why = 'named after it'; break; }
    }
    if (!ds) {
      for (const d of datasets) {
        const rc = Object.keys(d.rows[0] || {}).find((k) => REQUEST_COLS.has(normKey(k)));
        const mine = rc ? d.rows.filter((r) => slugOf(r[rc]) === slugOf(ed.name)) : [];
        if (mine.length) { ds = d; rows = mine; why = 'rows for it'; break; }
      }
    }
    if (!ds && need.length) {
      const wanted = new Set(need.map(normKey));
      const scored = datasets.map((d) => [d, Object.keys(d.rows[0] || {}).filter((k) => wanted.has(normKey(k))).length]).filter(([, n]) => n > 0)
        .sort((a, b) => b[1] - a[1] || slugOf(b[0].name).includes(slugOf(ed.name)) - slugOf(a[0].name).includes(slugOf(ed.name)));
      if (scored.length) { [ds] = scored[0]; rows = ds.rows; why = 'its columns fill what it needs'; }
    }
    if (!String(ed.url).trim()) { plan.push({ item, ed, folder: parents.map((x) => x.name).join(' / '), need: [], hostVar: null, hostMissing: false, source: '', why: '', covered: false, fills: [], missing: [], cases: [], truncated: 0, binds: [], unused: [], bodyNote: '', skipReason: 'it has no URL' }); return; }
    const item0 = { item, ed, folder: parents.map((x) => x.name).join(' / '), need, hostVar, hostMissing, source: ds ? ds.source : '', why, covered: cov.covered.has(item.id), fills: [], missing: [], cases: [], truncated: 0, binds: [], unused: [], bodyNote: '' };
    if (ds) {
      const usable = rows.filter((r) => !Object.entries(r).some(([k, v]) => SKIP_COLS.has(normKey(k)) && truthy(v)));
      item0.truncated = Math.max(0, usable.length - MAX_ROWS_PER_REQUEST);
      const cols = [...new Set((usable.length ? usable : rows).flatMap((r) => Object.keys(r)))]; // JSON rows may differ in keys
      const byNorm = new Map(cols.map((k) => [normKey(k), k]));
      item0.fills = need.filter((k) => byNorm.has(normKey(k)));
      item0.missing = need.filter((k) => !byNorm.has(normKey(k)));
      // the request's own fields of the same name (body, query, path, form): filled too, unless a {{variable}} took the column
      const special = (k) => [EXPECT_COLS, LABEL_COLS, SKIP_COLS, REQUEST_COLS].some((set) => set.has(normKey(k)));
      const varCols = new Set(item0.fills.map((k) => byNorm.get(normKey(k))));
      const fields = requestFields(ed);
      item0.binds = cols.filter((c) => !special(c) && !varCols.has(c)).map((c) => [c, fields.find((f) => f.match === fieldKey(c))]).filter(([, f]) => f);
      item0.unused = cols.filter((c) => !special(c) && !varCols.has(c) && !item0.binds.some(([b]) => b === c) && !(hostVar && normKey(c) === normKey(hostVar)));
      if (/^\s*[[{]/.test((ed.body && ed.body.raw) || '') && ed.body.mode === 'raw' && !fields.some((f) => f.kind === 'body')) item0.bodyNote = 'its body has a {{variable}} outside quotes, so body fields are not filled from data';
      usable.slice(0, MAX_ROWS_PER_REQUEST).forEach((r, i) => {
        const data = {};
        let expect = null, label = '';
        for (const [k, v] of Object.entries(r)) {
          const nk = normKey(k);
          if (EXPECT_COLS.has(nk)) { expect = /^\d{3}$/.test(v) ? Number(v) : null; continue; }
          if (LABEL_COLS.has(nk)) { label = v; continue; }
          if (SKIP_COLS.has(nk) || REQUEST_COLS.has(nk)) continue;
          if (hostVar && nk === normKey(hostVar)) continue; // test data never decides which server a request goes to
          data[k] = v;
        }
        for (const k of item0.fills) { const c = byNorm.get(normKey(k)); if (c !== k && r[c] !== undefined) data[k] = r[c]; } // employee_id fills {{employeeId}}
        const bind = item0.binds.filter(([c]) => r[c] !== undefined).map(([c, f]) => ({ kind: f.kind, key: f.key, path: f.path, value: r[c] })); // a row without that key leaves the field as it is
        item0.cases.push({ label: label || (usable.length > 1 ? `row ${i + 1}` : ''), data, expect, bind });
      });
      if (!item0.cases.length) item0.skipReason = 'every row of its test data is marked skip'; // never sent without its data
    } else {
      item0.missing = need;
      item0.cases.push({ label: '', data: null, expect: null });
    }
    if (cases + item0.cases.length > MAX_CASES) { capped = true; item0.cases = []; }
    cases += item0.cases.length;
    plan.push(item0);
  });
  return { col, plan, cases, capped, covered: cov.covered.size, total: cov.total };
}

/** The {{variables}} a collection's requests use that it doesn't define itself (what an environment must give). */
function collectionVars(cid) {
  const col = state.cols[cid];
  if (!col) return [];
  const own = colObj(col);
  const out = new Set();
  eachRequest(col.item || [], (item) => {
    const ed = fromItem(item);
    const text = JSON.stringify({ url: ed.url, headers: ed.headers, pathVars: ed.pathVars, body: ed.body, auth: effectiveAuth(ed, cid, item.id).auth });
    for (const k of unresolved([text])) if (!k.startsWith('$') && !Object.hasOwn(own, k)) out.add(k);
  });
  return [...out];
}

/** The apps (scheme, host, port) a collection's requests go to by themselves: literal URLs, or its own variables. */
function collectionHosts(cid) {
  const col = state.cols[cid];
  const out = new Set();
  if (!col) return out;
  const own = colObj(col);
  eachRequest(col.item || [], (item) => {
    const url = resolve(fromItem(item).url, own).trim();
    if (/^https?:\/\/[^/{}]+/i.test(url)) out.add(appKey(url));
  });
  return out;
}

/** Pass or fail for one case: an error fails; an expected status (from the data) must match; otherwise the request's
 *  own tests decide, and with no tests a 4xx/5xx fails. */
function caseVerdict(out, testCase) {
  if (out.error) return { status: 'FAIL', message: out.error };
  const failed = out.tests.filter((x) => x.passed === false);
  if (testCase.expect != null) { // the row says what this case must answer (often a 4xx): that decides it, not the request's happy-path tests
    return out.res.status === testCase.expect ? { status: 'PASS', message: '' } : { status: 'FAIL', message: `Expected status ${testCase.expect}, got ${out.res.status}.` };
  }
  if (failed.length) return { status: 'FAIL', message: `${failed[0].name}: ${failed[0].error || 'failed'}${failed.length > 1 ? ` (+${failed.length - 1} more)` : ''}` };
  if (testCase.expect == null && !out.tests.length && out.res.status >= 400) return { status: 'FAIL', message: `HTTP ${out.res.status}${out.res.reason ? ` ${out.res.reason}` : ''}` };
  return { status: 'PASS', message: '' };
}
const headerObj = (h) => Object.fromEntries((h || []).map((x) => (Array.isArray(x) ? x : [x.key, x.value])).filter(([k]) => k));

// =====================================================================================================
// Automation: Robot Framework projects (UI with the Browser library, API with RequestsLibrary), run live
// =====================================================================================================
/** A run file (screenshot, log.html) as a blob URL or text: /api needs the session token, so <img src> can't fetch it. */
async function runFile(runId, name, as = 'url') {
  const r = await fetch(`/api/robot/runs/${encodeURIComponent(runId)}/files/${name.split('/').map(encodeURIComponent).join('/')}`, { headers: API_TOKEN ? { 'X-ApiMan-Token': API_TOKEN } : {} });
  if (!r.ok) throw new Error(`Couldn't open ${name} (${r.status}).`);
  return as === 'text' ? r.text() : URL.createObjectURL(await r.blob());
}

const runTone = (st) => ({ PASS: 'ok', passed: 'ok', FAIL: 'err', failed: 'err', SKIP: 'muted', stopped: 'warn', running: '' }[st] || 'muted');
const fmtWhen = (t) => new Date(t * 1000).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });

/** The http(s) URLs among an environment's enabled values: what its app answers at. */
const envUrls = (doc) => ((doc && doc.values) || []).filter((v) => v.enabled !== false && v.type !== 'secret' && /^https?:\/\/\S+$/i.test(String(v.value || '').trim()))
  .map((v) => ({ key: v.key, url: String(v.value).trim() }));
/** An app's address for comparing: scheme, host, port; localhost and 127.0.0.1 are the same. */
const appKey = (u) => { try { const x = new URL(u); const host = ['127.0.0.1', '[::1]'].includes(x.hostname) ? 'localhost' : x.hostname; return `${x.protocol}//${host}:${x.port || (x.protocol === 'https:' ? 443 : 80)}`; } catch { return u; } };

/** Automation lives in its own window (#automation): open it, or bring it forward when it's already open
 *  (never reloaded: a collection run going there runs in that page). */
function showAutomation() {
  if (automationWin.only) return; // this is that window
  const shell = window.pywebview && window.pywebview.api; // the desktop app: a native window, not a pop-up
  if (shell && shell.open_window) { shell.open_window(`${location.pathname}${location.search}#automation`, 'Automation · ApiMan'); return; }
  const win = window.open('', 'apiman-automation');
  if (win) {
    try { if (win.location.href === 'about:blank') win.location.href = `${location.pathname}${location.search}#automation`; } catch { /* not ours to read */ }
    win.focus();
    return;
  }
  toast('Pop-ups are blocked, so Automation opens here: allow them to give it its own window.', 'warn');
  openAutomation().catch((err) => toast(err.message, 'err'));
}
/** A test's identity across runs: its file and name (newer runs), else suite and name. */
const testKey = (t) => t.key || `${t.suite} › ${t.name}`;
const MAX_HTTP_ROWS = 3000; // API calls a run view keeps in memory
async function openAutomation() {
  let projects = await api('GET', '/api/robot/projects');
  const saved = ls.get('apiman:automation', {});
  const remember = (k, v) => { saved[k] = v; ls.set('apiman:automation', saved); };
  const rememberTags = () => { if (project) remember('includes', { ...(saved.includes || {}), [project.id]: tagsIn.value }); };
  let project = null;      // the open project's details
  let run = null;          // { id, offset, timer, meta } of the run shown
  let shotUrl = null;      // blob URL of the screenshot shown
  let http = [];           // HTTP calls of the run shown
  let dataText = saved.data || '{\n  \n}';

  // ---- controls ----
  saved.envs = saved.envs || {}; // project id -> environment chosen for it
  /** Until one is chosen for a project: the environment that has most of the keys it needs (Robot ignores case, spaces, _). */
  const bestEnv = (keys, { fallback = true, hosts = null } = {}) => {
    // hosts: where the project's APIs live (its paired collection's own URLs): an environment pointing there wins,
    // so the Robot tests and the collection share one environment; keys only break ties
    const norm = (k) => String(k).replace(/[\s_]/g, '').toLowerCase();
    const want = new Set(keys.map(norm));
    const score = (e) => {
      const doc = state.envs[e.id] || {};
      const sameHost = hosts && hosts.size && envUrls(doc).some((u) => hosts.has(appKey(u.url))) ? 100 : 0;
      return sameHost + (doc.values || []).filter((v) => want.has(norm(v.key))).length;
    };
    const best = state.envList.map((e) => [e.id, score(e)]).sort((a, b) => b[1] - a[1])[0];
    if (best && best[1]) return best[0];
    if (!fallback) return null;
    const known = (id) => id && state.envList.some((e) => e.id === id);
    return known(saved.env) ? saved.env : known(state.activeEnv) ? state.activeEnv : null; // what was chosen before
  };
  const projSel = ui.select(projects.map((p) => [p.id, p.name]), { value: projects.some((p) => p.id === saved.project) ? saved.project : (projects[0] || {}).id,
    onChange: () => { remember('project', projSel.value); loadProject().catch((e) => toast(e.message, 'err')); } });
  const targetSel = ui.select([['', 'Everything']], { onChange: () => remember('target', targetSel.value) });
  const envSel = ui.select([], { onChange: () => { saved.envs[projSel.value] = envSel.value; remember('envs', saved.envs); renderKeys(); renderSuite(); } });
  // ApiMan environments, then the project's own variable files (env/qa.yaml, config/prod.py) as "file:<path>"
  const fillEnvs = () => {
    const keep = (project && saved.envs[project.id]) ?? envSel.value ?? '';
    const files = project ? project.varfiles : [];
    envSel.replaceChildren(...ui.select([['', 'No environment'],
      ...(state.envList.length ? [{ group: 'ApiMan environments', options: state.envList.map((e) => [e.id, e.name]) }] : []),
      ...(files.length ? [{ group: 'Project variable files', options: files.map((f) => [`file:${f}`, f]) }] : [])], { value: keep }).childNodes);
    envSel.value = [...envSel.options].some((o) => o.value === keep) ? keep : '';
  };
  fillEnvs();
  const tagsIn = ui.input({ code: true, placeholder: 'e.g. smoke, api (empty: every test)', value: '', spellcheck: 'false', onInput: () => rememberTags() });
  const tagChips = h('div', { class: 'actions' });
  const speedSel = ui.select([['watch', 'Watch: each browser step stays on screen'], ['full', 'Full speed']], { value: saved.speed || 'watch', onChange: () => remember('speed', speedSel.value) });

  // ---- Live tab ----
  const summary = ui.meta([h('span', null, 'Choose what to run, then Run.')]);
  const bar = ui.progress();
  const shotImg = h('img', { class: 'preview', alt: 'The browser as the last UI step left it', hidden: true });
  const shotEmpty = ui.emptyPane({ icon: 'play', title: 'No page yet', text: 'The browser shows here, step by step, once a UI test opens a page.' });
  const shotCaption = ui.hint('', { oneLine: true });
  const steps = h('div', { class: 'console scroll', role: 'log', 'aria-label': 'Steps', tabindex: '0' });
  const failures = h('div', { class: 'dlg-after', hidden: true });
  const browserCol = h('div', null, ui.sectionHead('Browser', null, null), shotEmpty, shotImg, shotCaption);
  const liveGrid = h('div', { class: 'grid-2 lead' }, browserCol, h('div', null, ui.sectionHead('Steps', null, null), steps));
  const live = [summary, bar, liveGrid, failures];
  /** A collection (API) run has no browser: the steps take the whole width. */
  const liveFor = (kind) => { const api = kind === 'collection'; browserCol.hidden = api; liveGrid.classList.toggle('grid-2', !api); liveGrid.classList.toggle('lead', !api); };
  /** A failed test: its error and, for UI tests, the screen at the moment it failed. */
  const addFailure = (e, runId) => {
    if (failures.hidden) { failures.hidden = false; failures.replaceChildren(ui.sectionHead('Failures', run && run.meta && run.meta.kind === 'collection' ? 'what each failed request answered' : 'the screen when each UI test failed', null)); }
    const img = h('img', { class: 'preview', alt: `The browser when "${e.name}" failed`, hidden: true });
    failures.append(ui.result('err', 'Failed', `${e.name}`, `${e.suite ? `${e.suite}: ` : ''}${e.message || 'Failed'}`), img);
    if (e.shot) runFile(runId, e.shot).then((url) => { img.src = url; img.hidden = false; }).catch(() => {});
  };

  // ---- API calls tab ----
  const httpBody = h('tbody');
  const httpDetail = h('div', { class: 'dlg-after' });
  const httpEmpty = ui.emptyPane({ title: 'No API calls yet', text: 'Every HTTP call the tests make (RequestsLibrary, requests) is listed here as it happens.' });
  const apiPane = [httpEmpty, h('table', { class: 'grid boxed', hidden: true }, h('thead', null, h('tr', null,
    h('th', { class: 'tight' }, '#'), h('th', null, 'Request'), h('th', null, 'Test'), ...['Status', 'Time'].map((x) => h('th', { class: 'num' }, x)))), httpBody), httpDetail];
  const showHttp = (e, i) => {
    $$('tr', httpBody).forEach((tr) => tr.classList.toggle('on', tr.dataset.i === String(i)));
    const pretty = (t) => { try { return JSON.stringify(JSON.parse(t), null, 2); } catch { return t || ''; } };
    const heads = (o) => Object.entries(o || {}).map(([k, v]) => `${k}: ${v}`).join('\n');
    httpDetail.replaceChildren(
      ui.sectionHead('Request', `${e.method} ${e.url}`, null),
      codeEditor({ value: [heads(e.reqHeaders), e.reqBody ? `\n${pretty(e.reqBody)}` : ''].join('\n').trim(), mode: e.reqBody && /^\s*[[{]/.test(e.reqBody) ? 'json' : 'text', readOnly: true, label: 'Request', cls: 'short', fold: true }),
      ui.sectionHead('Response', e.error ? e.error : `${e.status} ${e.reason || ''} · ${fmtMs(e.ms)}${e.size != null ? ` · ${fmtSize(e.size)}` : ''}`, null),
      e.error ? ui.note(e.error, 'err') : codeEditor({ value: `${heads(e.resHeaders)}\n\n${pretty(e.resBody)}`, mode: /^\s*[[{]/.test(e.resBody || '') ? 'json' : 'text', readOnly: true, label: 'Response', fold: true }));
  };
  const addHttp = (e) => {
    if (http.length >= MAX_HTTP_ROWS) { // a long run: the run log on disk has every call; the page keeps the first ones
      if (http.length === MAX_HTTP_ROWS) { http.push(null); line('ApiMan', `Showing the first ${MAX_HTTP_ROWS.toLocaleString()} API calls; Robot's log has them all.`, 'muted'); }
      return;
    }
    http.push(e);
    const i = http.length - 1;
    apiPane[1].hidden = false; httpEmpty.hidden = true;
    httpBody.append(h('tr', { tabindex: '0', 'data-i': String(i), onclick: () => showHttp(e, i), onkeydown: (ev) => { if (ev.key === 'Enter') showHttp(e, i); } },
      h('td', { class: 'tight' }, String(i + 1)),
      h('td', { class: 'mono clip', title: e.url }, ui.method(e.method), ' ', e.url),
      h('td', null, e.test || '–'),
      h('td', { class: 'num' }, e.error ? ui.status(null) : ui.status(e.status, { small: true })),
      h('td', { class: 'num' }, e.ms != null ? fmtMs(e.ms) : '–')));
  };

  // ---- Variables tab ----
  const keysPane = h('div');
  function renderKeys() {
    if (!project) return;
    setTimeout(markApps, 0);
    const env = envSel.value && !envSel.value.startsWith('file:') ? state.envs[envSel.value] : null;
    const values = new Map((env ? env.values : []).filter((v) => v.enabled !== false).map((v) => [v.key.replace(/[\s_]/g, '').toLowerCase(), v]));
    const missing = project.keys.filter((k) => !values.has(k.name.replace(/[\s_]/g, '').toLowerCase()));
    const secretish = (k) => /pass|secret|token|key/i.test(k);
    keysPane.replaceChildren(...[ // replaceChildren would print a null as "null"
      ui.hint(`Variables this project uses but never defines. They come from the environment you pick (Robot matches names ignoring case, spaces and underscores, so BASE_URL is baseUrl), and Test data can override them for one run.`),
      project.keys.length ? h('table', { class: 'grid boxed' }, h('thead', null, h('tr', null, h('th', null, 'Variable'), h('th', null, 'Used in'), h('th', null, env ? `Value in ${env.name}` : 'Value'))),
        h('tbody', null, ...project.keys.map((k) => {
          const v = values.get(k.name.replace(/[\s_]/g, '').toLowerCase());
          return h('tr', null, h('td', { class: 'mono' }, `\${${k.name}}`), h('td', null, k.files.join(', ')),
            h('td', { class: 'mono' }, v ? (v.type === 'secret' || secretish(k.name) ? '•••' : String(v.value)) : ui.pill(env ? 'Missing' : 'Not set', 'warn')));
        }))) : ui.note('This project defines every variable it uses: nothing to fill in.', 'ok'),
      project.envVars.length ? ui.hint(`It also reads these operating-system environment variables: ${project.envVars.map((x) => `%{${x}}`).join(', ')}.`) : null,
      ui.actions(...[
        env && missing.length ? ui.button({ label: `Add ${missing.length} missing to ${env.name}`, size: 'small', onClick: () => addKeys(env, missing).catch((e) => toast(e.message, 'err')) }) : null,
        !env && !envSel.value && project.keys.length ? ui.button({ label: 'Create an environment with these keys', size: 'small', onClick: () => createEnv().catch((e) => toast(e.message, 'err')) }) : null,
        env ? ui.button({ label: `Edit ${env.name}`, size: 'small', onClick: () => aside(() => editEnvironment(envSel.value)) }) : null,
      ].filter(Boolean))].filter(Boolean));
  }
  /** A live dot after each URL value in the Variables table: is its app answering? */
  async function markApps() {
    const cells = $$('td.mono', keysPane).filter((td) => /^https?:\/\//i.test(td.textContent));
    if (!cells.length) return;
    const res = await api('POST', '/api/robot/apps/check', { urls: cells.map((td) => td.textContent) }).catch(() => []);
    res.forEach((r, i) => cells[i] && cells[i].append(' ', ui.dot({ tone: r.up ? 'ok' : '', label: r.up ? `Answering (${r.status}, ${fmtMs(r.ms)})` : `Not answering: ${r.error || 'no reply'}` })));
  }

  async function addKeys(env, missing) {
    await mutateDoc('environments', envSel.value, (doc) => { doc.values.push(...missing.map((k) => ({ key: k.name, value: '', type: /pass|secret|token|key/i.test(k.name) ? 'secret' : 'default', enabled: true }))); return true; });
    renderKeys();
    toast(`Added ${missing.length} key${missing.length > 1 ? 's' : ''} to ${env.name}: fill in their values.`, 'ok');
    aside(() => editEnvironment(envSel.value));
  }
  async function createEnv() {
    const pr = suite && suite.pair;
    const need = [...project.keys.map((k) => k.name), ...(pr ? collectionVars(pr.cid) : [])];
    const hosts = pr ? collectionHosts(pr.cid) : new Set();
    const existing = hosts.size ? (state.envList.find((e) => envUrls(state.envs[e.id]).some((u) => hosts.has(appKey(u.url)))) || {}).id : null;
    if (existing && state.envs[existing]) { // never a second environment for the same app: use the one pointing at it
      envSel.value = existing; saved.envs[project.id] = existing; remember('envs', saved.envs);
      renderKeys(); renderSuite();
      toast(`Using ${state.envs[existing].name}: it already points at this project's app.`, 'muted');
      return;
    }
    const norm = (k) => String(k).replace(/[\s_]/g, '').toLowerCase(); // Robot ignores case, spaces and _: one key serves both
    const keys = [...new Map(need.map((k) => [norm(k), k])).values()];
    const doc = { name: project.name, values: keys.map((k) => ({ key: k, value: '', type: /pass|secret|token|key/i.test(k) ? 'secret' : 'default', enabled: true })), _postman_variable_scope: 'environment' };
    const id = await backend.environments.create(doc);
    await refreshEnvironments();
    renderEnvPicker();
    fillEnvs();
    envSel.value = id; saved.envs[project.id] = id; remember('envs', saved.envs);
    renderKeys();
    toast(`Created the ${project.name} environment: fill in its values.`, 'ok');
    aside(() => editEnvironment(id));
  }

  /** Another dialog (the environment editor) over Automation: close Automation, open it, and reopen Automation after. */
  async function aside(open) {
    const dlg = $('#dlg');
    const closed = new Promise((r) => dlg.addEventListener('close', r, { once: true }));
    automationWin.aside = true; // coming back: Automation keeps its page address and window
    dlg.close();
    await closed;
    automationWin.aside = false;
    await open();
    openAutomation().catch((e) => toast(e.message, 'err')); // queued: shown when the editor closes
  }

  // ---- Test data tab ----
  const dataEd = codeEditor({ value: dataText, mode: 'json', label: 'Test data for this run (JSON)', onChange: (v) => { dataText = v; remember('data', v); }, cls: 'short' });
  const filesPane = h('div');
  const fileView = h('div', { class: 'dlg-after' });
  function renderFiles() {
    filesPane.replaceChildren(
      ui.sectionHead('Test data files', project.data.length ? `${project.data.length} in ${project.name}` : null, null),
      project.data.length ? h('table', { class: 'grid boxed' }, h('tbody', null, ...project.data.map((f) => h('tr', null,
        h('td', { class: 'mono' }, f.path), h('td', { class: 'num' }, fmtSize(f.size)),
        h('td', { class: 'tight' }, /\.xlsx?$/i.test(f.path) ? ui.hint('Excel: open it in Excel') : ui.button({ label: 'Open', variant: 'ghost', size: 'small', onClick: () => openFile(f.path).catch((e) => toast(e.message, 'err')) })))))) : ui.hint('No JSON, CSV, YAML or XML files in this project.'));
  }
  async function openFile(path) {
    const f = await api('GET', `/api/robot/projects/${encodeURIComponent(project.id)}/file?path=${encodeURIComponent(path)}`);
    let text = f.text;
    const mode = /\.json$/i.test(path) ? 'json' : /\.xml$/i.test(path) ? 'xml' : 'text';
    fileView.replaceChildren(
      ui.toolbar([ui.sectionHead(path, null, null)], [ui.button({ label: 'Save', variant: 'ghost', size: 'small', onClick: async () => {
        try {
          if (mode === 'json') JSON.parse(text);
          await api('PUT', `/api/robot/projects/${encodeURIComponent(project.id)}/file?path=${encodeURIComponent(path)}`, { text });
          toast(`Saved ${path}.`, 'ok');
        } catch (e) { toast(e instanceof SyntaxError ? `${path} isn't valid JSON: ${e.message}` : e.message, 'err'); }
      } })]),
      codeEditor({ value: text, mode, label: path, onChange: (v) => { text = v; }, fold: true }));
  }

  // ---- History tab ----
  const historyPane = h('div');
  let historyUrls = []; // screenshots shown in History: released when it's drawn again or the dialog closes
  const releaseHistory = () => { historyUrls.forEach((u) => u && URL.revokeObjectURL(u)); historyUrls = []; };
  async function renderHistory() {
    releaseHistory();
    const runs = await api('GET', `/api/robot/runs?project=${encodeURIComponent(project.id)}`);
    const done = runs.filter((r) => r.status !== 'running');
    if (!done.length) { historyPane.replaceChildren(ui.emptyPane({ title: 'No runs yet', text: 'Each run is kept here with its report and log: pass rate, what changed, flaky tests.' })); return; }
    const rate = (r) => { const n = (r.passed || 0) + (r.failed || 0); return n ? r.passed / n : 0; };
    const dur = (r) => (r.ended && r.started ? Math.round((r.ended - r.started) * 1000) : 0);
    const same = (a, b) => a.kind === b.kind && a.target === b.target && (a.test || '') === (b.test || '') && (a.include || '') === (b.include || '');
    // every test across runs (newest first): its results, times, and the screen of its latest failure
    const byTest = new Map();
    for (const r of done) for (const t of r.tests || []) {
      const k = testKey(t);
      const e = byTest.get(k) || { key: k, name: t.name, suite: t.suite, results: [], ms: [], lastFail: null };
      e.results.push({ status: t.status, run: r });
      if (t.ms != null) e.ms.push(t.ms);
      if (t.status === 'FAIL' && !e.lastFail) e.lastFail = { run: r, message: t.message, shot: t.shot };
      byTest.set(k, e);
    }
    // since the last comparable run (same kind and same selection): what broke, what got fixed, what got slower
    const latest = done[0];
    const prev = done.slice(1).find((r) => same(r, latest));
    const now = new Map((latest.tests || []).map((t) => [testKey(t), t]));
    const before = new Map(((prev && prev.tests) || []).map((t) => [testKey(t), t]));
    const broke = [...now.values()].filter((t) => t.status === 'FAIL' && (before.get(testKey(t)) || {}).status === 'PASS');
    const fixed = [...now.values()].filter((t) => t.status === 'PASS' && (before.get(testKey(t)) || {}).status === 'FAIL');
    const slower = [...now.values()].filter((t) => { const b = before.get(testKey(t)); return b && t.status === 'PASS' && t.ms != null && b.ms != null && t.ms > b.ms * 1.5 && t.ms - b.ms > 100; });
    const badge = (e) => {
      const st = e.results.map((x) => x.status).filter((x) => x === 'PASS' || x === 'FAIL');
      if (broke.some((t) => testKey(t) === e.key)) return ui.pill('New failure', 'err');
      if (fixed.some((t) => testKey(t) === e.key)) return ui.pill('Fixed', 'ok');
      if (st.includes('PASS') && st.includes('FAIL')) return ui.pill('Flaky', 'warn');
      if (st.length && st.every((x) => x === 'FAIL')) return ui.pill('Failing', 'err');
      return null;
    };
    const order = (e) => (e.results[0].status === 'FAIL' ? 0 : badge(e) ? 1 : 2);
    const tests = [...byTest.values()].sort((a, b) => order(a) - order(b) || a.suite.localeCompare(b.suite) || a.name.localeCompare(b.name));
    const shownTests = tests.slice(0, 300);
    const flakyN = tests.filter((e) => { const st = e.results.map((x) => x.status); return st.includes('PASS') && st.includes('FAIL'); }).length;
    const total = done.reduce((a, r) => a + (r.passed || 0) + (r.failed || 0), 0);
    const passed = done.reduce((a, r) => a + (r.passed || 0), 0);
    const chartRuns = done.slice(0, 40).reverse();
    const gallery = (latest.tests || []).filter((t) => t.status === 'FAIL').slice(0, 12);
    const runLabel = (r) => `${r.kind === 'collection' ? 'API · ' : ''}${r.target === '.' ? 'Everything' : r.target}${r.test ? ` › ${r.test}` : ''}${r.include ? ` [${r.include}]` : ''}`;
    historyPane.replaceChildren(...[
      ui.meta([
        h('span', null, ui.value(String(done.length)), done.length === 1 ? ' run' : ' runs'),
        h('span', null, 'Pass rate ', ui.value(total ? `${Math.round((passed / total) * 100)}%` : '–', passed === total ? 'ok' : 'warn')),
        h('span', null, 'Average run ', ui.value(fmtMs(Math.round(done.reduce((a, r) => a + dur(r), 0) / done.length)))),
        h('span', null, ui.value(String(tests.length)), ' tests'),
        h('span', null, ui.value(String(flakyN), flakyN ? 'warn' : 'muted'), flakyN === 1 ? ' flaky test' : ' flaky tests'),
        h('span', null, 'API calls ', ui.value(String(done.reduce((a, r) => a + (r.http || 0), 0)))),
      ]),
      ui.sectionHead('Since the last run', prev ? `${runLabel(latest)}, ${fmtWhen(latest.started)} vs ${fmtWhen(prev.started)}` : `${runLabel(latest)}: no earlier run of the same selection to compare with`, null),
      prev ? (broke.length || fixed.length || slower.length ? h('div', null,
        ...broke.map((t) => ui.result('err', 'New failure', t.name, t.suite)),
        ...fixed.map((t) => ui.result('ok', 'Fixed', t.name, t.suite)),
        ...slower.map((t) => ui.result('warn', 'Slower', t.name, `${t.suite}: ${fmtMs(before.get(testKey(t)).ms)} → ${fmtMs(t.ms)}`)))
        : ui.note('Nothing changed: the same tests passed and failed, at about the same speed.', 'ok')) : null,
      gallery.length ? ui.sectionHead('Failures in the last run', gallery.some((t) => t.shot) ? 'the screen when each failed; replay a test step by step' : null, null) : null,
      gallery.length ? h('div', { class: 'cards' }, ...gallery.map((t) => {
        const img = h('img', { class: 'preview', alt: `The screen when "${t.name}" failed`, hidden: true });
        if (t.shot) runFile(latest.id, t.shot).then((url) => { historyUrls.push(url); img.src = url; img.hidden = false; }).catch(() => {});
        return ui.card({ title: t.name, badge: ui.pill('Failed', 'err'), body: [ui.hint(t.suite, { oneLine: true }), img, ui.hint(t.message || 'Failed')],
          actions: latest.kind === 'collection' ? [] : [ // API runs have no screens or Robot log
            ui.button({ label: 'Replay', size: 'small', onClick: () => replay(latest, t).catch((e) => toast(e.message, 'err')) }),
            ui.button({ label: 'Log', size: 'small', onClick: () => showRobotPage(latest.id, 'log.html') })] });
      })) : null,
      ui.sectionHead('Tests', `${tests.length > shownTests.length ? `the first ${shownTests.length} of ${tests.length}; ` : ''}last 10 results, oldest to newest`, null),
      h('table', { class: 'grid boxed' }, h('thead', null, h('tr', null, h('th', null, 'Test'), h('th', null, 'Last 10'), h('th', { class: 'num' }, 'Passed'), h('th', { class: 'num' }, 'Average'), h('th', { class: 'tight' }, ''))),
        h('tbody', null, ...shownTests.map((e) => {
          const runsOf = e.results.slice(0, 10).reverse();
          const n = e.results.filter((x) => x.status === 'PASS' || x.status === 'FAIL');
          const avg = e.ms.length ? Math.round(e.ms.reduce((a, b) => a + b, 0) / e.ms.length) : null;
          return h('tr', null,
            h('td', null, e.name, h('div', { class: 'hint' }, e.suite)),
            h('td', null, ui.dots(runsOf.map((x) => ({ tone: x.status === 'PASS' ? 'ok' : x.status === 'FAIL' ? 'err' : 'muted', label: `${fmtWhen(x.run.started)}: ${x.status}` })), { label: `Last ${runsOf.length} results` })),
            h('td', { class: 'num' }, n.length ? `${Math.round((n.filter((x) => x.status === 'PASS').length / n.length) * 100)}%` : '–'),
            h('td', { class: 'num' }, avg != null ? fmtMs(avg) : '–'),
            h('td', { class: 'tight' }, badge(e)));
        }))),
      ui.sectionHead('Pass rate per run', `last ${chartRuns.length}, oldest first`, null),
      ui.chart(chartRuns.map((r) => ({ value: rate(r) || 0.02, tone: runTone(r.status), title: `${fmtWhen(r.started)} · ${runLabel(r)}: ${r.passed || 0} passed, ${r.failed || 0} failed` })), { label: 'Pass rate per run' }),
      ui.sectionHead('Duration per run', null, null),
      ui.chart(chartRuns.map((r) => ({ value: dur(r) / Math.max(1, ...chartRuns.map(dur)), tone: 'muted', title: `${fmtWhen(r.started)}: ${fmtMs(dur(r))}` })), { label: 'Duration per run' }),
      ui.sectionHead('Runs', null, null),
      h('table', { class: 'grid boxed' }, h('thead', null, h('tr', null, h('th', null, 'Started'), h('th', null, 'Ran'), h('th', { class: 'desktop-only' }, 'Environment'), h('th', null, 'Result'), h('th', { class: 'num desktop-only' }, 'Time'), h('th', { class: 'tight' }, ''))),
        h('tbody', null, ...done.map((r) => h('tr', null,
          h('td', null, fmtWhen(r.started)),
          h('td', { class: 'mono clip', title: runLabel(r) }, r.kind === 'collection' ? ui.pill('API', 'muted') : null, r.kind === 'collection' ? ' ' : null,
            [r.target === '.' ? 'Everything' : r.target, r.test && ` › ${r.test}`, r.include && ` [${r.include}]`].filter(Boolean).join('')),
          h('td', { class: 'desktop-only' }, r.env || '–'),
          h('td', null, ui.pill(r.status === 'stopped' ? 'Stopped' : r.status === 'passed' ? 'Passed' : r.failed ? `${r.failed} failed` : 'Error', runTone(r.status)), ' ', `${r.passed || 0} passed`),
          h('td', { class: 'num desktop-only' }, fmtMs(dur(r))),
          h('td', { class: 'tight' }, ui.button({ label: 'Show', variant: 'ghost', size: 'small', onClick: () => follow(r.id, true) }),
            r.kind === 'collection' ? null : ui.button({ label: 'Report', variant: 'ghost', size: 'small', cls: 'desktop-only', onClick: () => showRobotPage(r.id, 'report.html') }),
            r.kind === 'collection' ? null : ui.button({ label: 'Log', variant: 'ghost', size: 'small', cls: 'desktop-only', onClick: () => showRobotPage(r.id, 'log.html') })))))),
    ].filter(Boolean));
  }
  /** Replay one test of a run, frame by frame: every screen the live view showed, with the step that made it. */
  async function replay(runMeta, t) {
    const res = await api('GET', `/api/robot/runs/${encodeURIComponent(runMeta.id)}?from=0`);
    // by the test's file and name when the run recorded them: two tests with the same name never mix
    const mine = (e) => (t.key && e.tid ? e.tid === t.key : (e.t === 'test_end' ? e.name : e.test) === t.name);
    const frames = res.events.filter((e) => e.shot && mine(e))
      .map((e) => ({ shot: e.shot, step: e.t === 'test_end' ? `${t.name} ended: ${e.status}${e.message ? `, ${e.message}` : ''}` : `${e.lib ? `${e.lib}.` : ''}${e.name}`, fail: e.status === 'FAIL' }));
    if (!frames.length) { toast('No screens were captured for this test (it never opened a page).', 'muted'); return; }
    const urls = new Map();
    const img = h('img', { class: 'preview', alt: `${t.name}, replayed` });
    const caption = ui.hint('');
    const slider = ui.input({ type: 'range', min: '0', max: String(frames.length - 1), step: '1', value: String(frames.length - 1), 'aria-label': 'Step' });
    const show = async (i) => {
      const f = frames[i];
      if (!urls.has(f.shot)) { const u = await runFile(runMeta.id, f.shot).catch(() => ''); urls.set(f.shot, u); historyUrls.push(u); }
      img.src = urls.get(f.shot);
      caption.textContent = `Step ${i + 1} of ${frames.length}: ${f.step}`;
      slider.value = String(i);
    };
    slider.addEventListener('input', () => show(Number(slider.value)));
    const step = (d) => show(Math.max(0, Math.min(frames.length - 1, Number(slider.value) + d)));
    historyPane.replaceChildren(
      ui.toolbar([ui.button({ label: 'Back to history', variant: 'ghost', size: 'small', onClick: () => renderHistory().catch((e) => toast(e.message, 'err')) }),
        ui.sectionHead(`Replay: ${t.name}`, `${fmtWhen(runMeta.started)} · ${frames.length} screens`, null)], [
        ui.button({ label: 'Previous', variant: 'ghost', size: 'small', onClick: () => step(-1) }),
        ui.button({ label: 'Next', variant: 'ghost', size: 'small', onClick: () => step(1) })]),
      ui.field(null, slider), caption, img);
    await show(frames.length - 1); // start on the moment it failed
  }
  async function showRobotPage(runId, name) {
    try {
      const html = await runFile(runId, name, 'text');
      // Robot's own page, here in the History tab and sandboxed: its scripts run, but it can't reach ApiMan's API or storage
      historyPane.replaceChildren(
        ui.toolbar([ui.button({ label: 'Back to history', variant: 'ghost', size: 'small', onClick: () => renderHistory().catch((e) => toast(e.message, 'err')) }),
          ui.sectionHead(name === 'log.html' ? 'Robot log' : 'Robot report', runId, null)], []),
        h('iframe', { class: 'preview tall', sandbox: 'allow-scripts', srcdoc: html, title: name }));
    } catch (e) { toast(e.message, 'err'); }
  }

  // =========================== Dashboard: every project at a glance, the home of Automation ===========================
  const dash = h('div');
  const projectView = h('div', { hidden: true });
  const linkIn = ui.input({ code: true, placeholder: '~/work/office-tests', spellcheck: 'false', autocomplete: 'off' });
  const linkForm = h('div', { hidden: true },
    ui.field('Project folder on this computer', linkIn, { hint: 'Any folder with Robot Framework tests. It runs where it is: nothing is copied.' }),
    ui.actions(ui.button({ label: 'Link folder', size: 'small', onClick: () => linkFolder().catch((e) => toast(e.message, 'err')) }),
      ui.button({ label: 'Cancel', size: 'small', onClick: () => { linkForm.hidden = true; } })));
  linkIn.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); linkFolder().catch((err) => toast(err.message, 'err')); } });
  const zipIn = ui.input({ type: 'file', accept: '.zip,application/zip', hidden: true, 'aria-label': 'Project zip' });
  zipIn.addEventListener('change', () => importZip().catch((e) => toast(e.message, 'err')));
  async function linkFolder() {
    if (!linkIn.value.trim()) { linkIn.focus(); return; }
    await api('POST', '/api/robot/links', { path: linkIn.value.trim() });
    toast('Linked: it runs from its own folder.', 'ok');
    linkIn.value = ''; linkForm.hidden = true;
    await renderDashboard();
  }
  async function importZip() {
    const f = zipIn.files[0];
    zipIn.value = '';
    if (!f) return;
    if (f.size > 36 * 1024 * 1024) throw new Error('That zip is too large (limit 36 MB).');
    const bytes = new Uint8Array(await f.arrayBuffer());
    let bin = '';
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    const res = await api('POST', '/api/robot/import', { name: f.name, data: btoa(bin) });
    toast(`Imported ${res.name} into your data folder.`, 'ok');
    await renderDashboard();
  }
  async function refreshProjects() {
    projects = await api('GET', '/api/robot/projects');
    projSel.replaceChildren(...ui.select(projects.map((x) => [x.id, x.name]), { value: projSel.value }).childNodes);
  }
  const showDashboard = () => { projectView.hidden = true; dash.hidden = false; setRunButton(false); renderDashboard().catch((e) => toast(e.message, 'err')); };
  /** The server refused a run because another is going (from History's Show, another window…): show that one instead. */
  async function showGoing(err) {
    if (!/Another run is going/.test(err.message)) return false;
    const going = (await api('GET', '/api/robot/runs')).find((r) => r.status === 'running');
    if (!going) return false;
    toast('Another run is going: showing it.', 'warn');
    if (going.project !== (project && project.id) && projects.some((x) => x.id === going.project)) await openProject(going.project);
    $$('.seg-btn', tabBar)[0].click();
    follow(going.id).catch(() => {});
    return true;
  }
  async function openProject(id, runNow = false) {
    projSel.value = id; remember('project', id);
    dash.hidden = true; projectView.hidden = false; setRunButton(false);
    requestAnimationFrame(() => fitTabs(tabBar)); // measured now that it's visible: a More menu on a phone
    await loadProject();
    if (runNow) await start();
  }
  async function renderDashboard() {
    const [rows] = await Promise.all([api('GET', '/api/robot/dashboard'), refreshProjects()]);
    const allUrls = [...new Set(state.envList.flatMap((e) => envUrls(state.envs[e.id]).map((u) => u.url)))];
    const [checks, scan] = await Promise.all([
      allUrls.length ? api('POST', '/api/robot/apps/check', { urls: allUrls }).catch(() => []) : [],
      api('GET', '/api/robot/apps/scan').catch(() => [])]);
    const up = new Map(checks.map((c) => [c.url, c]));
    const tests = rows.reduce((a, r) => a + (r.tests || 0), 0);
    const lastRuns = rows.map((r) => r.runs[0]).filter(Boolean);
    const allRuns = rows.flatMap((r) => r.runs).filter((r) => r.status !== 'running');
    const passedRuns = allRuns.filter((r) => r.status === 'passed').length;
    const anyRunning = rows.some((r) => r.runs.some((x) => x.status === 'running'));
    await Promise.all(state.colList.map((c) => withCol(c.id).catch(() => null)));
    const pairs = new Map(rows.filter((r) => !r.error).map((r) => [r.id, pairFor(r, saved.pairs)]));
    const envFor = (r) => {
      const pr = pairs.get(r.id);
      const id = saved.envs[r.id] ?? bestEnv([...(r.keys || []), ...(pr ? collectionVars(pr.cid) : [])], { hosts: pr ? collectionHosts(pr.cid) : null });
      return id && !id.startsWith('file:') ? state.envs[id] : null;
    };
    const runDur = (x) => (x.ended && x.started ? Math.max(0, Math.round((x.ended - x.started) * 1000)) : 0);
    const ago = (ts) => { const sec = Math.max(0, Date.now() / 1000 - (ts || 0)); return sec < 60 ? 'just now' : sec < 3600 ? `${Math.round(sec / 60)} min ago` : sec < 86400 ? `${Math.round(sec / 3600)} h ago` : `${Math.round(sec / 86400)} d ago`; };
    const shareOf = (x) => { const n = (x.passed || 0) + (x.failed || 0); return n ? (x.passed || 0) / n : 0; };
    const rateTone = (f) => (f === 1 ? 'ok' : f >= 0.7 ? 'warn' : 'err');
    const resultPill = (x) => ui.pill(x.status === 'passed' ? 'Passed' : x.status === 'stopped' ? 'Stopped' : x.failed ? `${x.failed} failed` : 'Error', runTone(x.status));
    /** One project as a table row: what it is, its last run, its trend, pass rate, average time, environment, actions. */
    const projectRow = (r) => {
      const last = r.runs.find((x) => x.status !== 'running');
      const running = r.runs.find((x) => x.status === 'running');
      const env = envFor(r);
      const urls = envUrls(env);
      const runs = r.runs.filter((x) => x.status !== 'running').slice(0, 20).reverse();
      const passedN = runs.filter((x) => x.status === 'passed').length;
      const f = runs.length ? passedN / runs.length : 0;
      const avg = runs.length ? Math.round(runs.reduce((a, x) => a + runDur(x), 0) / runs.length) : 0;
      const pr = pairs.get(r.id);
      const envUp = urls.length > 0 && urls.every((u) => (up.get(u.url) || {}).up);
      return h('tr', null,
        h('td', { class: 'clip', title: r.linked ? `${r.name}: ${r.path}` : r.name }, h('div', null, r.name, ' ', ui.pill(r.linked ? 'Linked' : 'Data folder', 'muted')),
          h('div', { class: 'hint' }, r.error || `${r.tests || 0} test${(r.tests || 0) === 1 ? '' : 's'} · ${r.suites || 0} suite${(r.suites || 0) === 1 ? '' : 's'}${r.tags && r.tags.length ? ` · ${r.tags.slice(0, 3).join(', ')}` : ''}`)),
        h('td', { class: 'tight' }, running ? ui.pill('Running', 'warn') : last ? resultPill(last) : ui.pill('Not run', 'muted'),
          last ? h('div', { class: 'hint' }, `${ago(last.started)}${runDur(last) ? ` · ${fmtMs(runDur(last))}` : ''}`) : null),
        h('td', { class: 'wide' }, runs.length > 1 ? ui.spark(runs.map((x) => ({ value: shareOf(x), tone: runTone(x.status), title: `${fmtWhen(x.started)}: ${x.passed || 0} passed, ${x.failed || 0} failed` })),
          { tone: rateTone(f), label: `Pass rate of the last ${runs.length} runs` }) : ui.hint('–')),
        h('td', { class: 'tight' }, runs.length ? ui.ring(f, { tone: rateTone(f), label: `${passedN} of ${runs.length} recent runs passed` }) : ui.hint('–')),
        h('td', { class: 'num wide' }, runs.length ? fmtMs(avg) : '–'),
        h('td', { class: 'tight wide' }, env ? h('div', null, ui.dot({ tone: envUp ? 'ok' : 'err', label: envUp ? 'Answering' : 'Not answering' }), ' ', env.name) : ui.hint('No environment'),
          pr ? h('div', { class: 'hint' }, `API: ${(state.colList.find((c) => c.id === pr.cid) || {}).name || ''} · ${pr.covered.size}/${pr.total}`) : null),
        h('td', { class: 'tight' },
          ui.button({ label: running ? 'Show run' : 'Open', size: 'small', onClick: () => openProject(r.id).then(() => running && follow(running.id)).catch((e) => toast(e.message, 'err')) }),
          ' ',
          ui.iconButton('dots', `More for ${r.name}`, (e) => showMenu(e.currentTarget, [
            running || anyRunning || r.error ? null : { label: 'Run tests', onClick: () => openProject(r.id, true).catch((err) => toast(err.message, 'err')) },
            running || anyRunning || r.error || !pr ? null : { label: 'Run API (the paired collection with this project\'s test data)', onClick: () => openProject(r.id).then(() => loadSuiteDataNow()).then(() => runSuite()).catch((err) => toast(err.message, 'err')) },
            r.linked ? { label: 'Unlink', onClick: async () => {
              try { await api('DELETE', `/api/robot/links/${encodeURIComponent(r.id)}`); } catch (err) { toast(err.message, 'err'); return; }
              toast(`Unlinked ${r.name}: its folder and runs are untouched.`, 'muted');
              await renderDashboard();
            } } : null,
          ].filter(Boolean)), { size: 'small', 'aria-haspopup': 'menu' })));
    };
    const appRows = scan.filter((a) => a.up);
    dash.replaceChildren(...[
      ui.toolbar([ui.sectionHead('Overview', rows.length ? `${rows.length} project${rows.length === 1 ? '' : 's'}` : null, null)], [
        ui.button({ label: 'Link a folder…', variant: 'ghost', size: 'small', onClick: () => { linkForm.hidden = false; linkIn.focus(); } }),
        ui.button({ label: 'Import a zip…', variant: 'ghost', size: 'small', onClick: () => zipIn.click() }),
        ui.button({ label: 'Refresh', variant: 'ghost', size: 'small', onClick: () => renderDashboard().catch((e) => toast(e.message, 'err')) })]),
      linkForm, zipIn,
      rows.length ? (() => {
        const rate = allRuns.length ? passedRuns / allRuns.length : 0;
        const tone = !allRuns.length ? 'muted' : rateTone(rate);
        const failingNow = rows.filter((r) => { const l = r.runs.find((x) => x.status !== 'running'); return l && l.status !== 'passed'; });
        const week = allRuns.filter((x) => Date.now() / 1000 - (x.started || 0) < 7 * 86400).length;
        const avgAll = allRuns.length ? Math.round(allRuns.reduce((a, x) => a + runDur(x), 0) / allRuns.length) : 0;
        return ui.stats(
          ui.stat({ label: 'Pass rate', value: allRuns.length ? `${Math.round(rate * 100)}%` : '–', tone, sub: `${passedRuns} of ${allRuns.length} runs passed`,
            ring: allRuns.length ? ui.ring(rate, { tone, large: true, text: false, label: 'Runs passing' }) : null }),
          ui.stat({ label: 'Runs', value: allRuns.length, sub: `${week} in the last 7 days` }),
          ui.stat({ label: 'Failing now', value: failingNow.length, tone: failingNow.length ? 'err' : 'ok', sub: failingNow.length ? failingNow.map((r) => r.name).join(', ') : "every project's last run passed" }),
          ui.stat({ label: 'Average run', value: allRuns.length ? fmtMs(avgAll) : '–', sub: `${tests} tests in ${rows.length} project${rows.length === 1 ? '' : 's'}` }),
          ui.stat({ label: 'Apps running', value: appRows.length, sub: 'answering on development ports' }));
      })() : null,
      allRuns.length ? (() => {
        const timeline = rows.flatMap((r) => r.runs.filter((x) => x.status !== 'running').map((x) => ({ ...x, project: r.name }))).sort((a, b) => (a.started || 0) - (b.started || 0)).slice(-40);
        const n = (st) => allRuns.filter((x) => (st === 'failed' ? x.status !== 'passed' && x.status !== 'stopped' : x.status === st)).length;
        const rate = passedRuns / allRuns.length;
        return ui.panels(
          ui.panel({ title: 'Pass rate per run', sub: `the last ${timeline.length} runs across every project, oldest to newest`,
            body: ui.area(timeline.map((x) => ({ value: shareOf(x), tone: runTone(x.status), title: `${x.project}, ${fmtWhen(x.started)}: ${x.passed || 0} passed, ${x.failed || 0} failed, ${fmtMs(runDur(x))}` })),
              { tone: rateTone(rate), label: 'Pass rate per run', xLabels: [fmtWhen(timeline[0].started), fmtWhen(timeline[timeline.length - 1].started)] }) }),
          ui.panel({ title: 'Results', sub: `${allRuns.length} runs`, body: ui.donut([
            { value: n('passed'), tone: 'ok', label: 'Passed' }, { value: n('failed'), tone: 'err', label: 'Failed' }, { value: n('stopped'), tone: 'warn', label: 'Stopped' }],
            { center: `${Math.round(rate * 100)}%`, caption: 'passed', label: 'Runs by result' }) }));
      })() : null,
      rows.length ? ui.sectionHead('Projects', 'trend = pass rate of the last runs; ring = share of them that passed', null) : null,
      rows.length ? h('table', { class: 'grid boxed' }, h('thead', null, h('tr', null, h('th', null, 'Project'), h('th', null, 'Last run'), h('th', { class: 'wide' }, 'Trend'),
        h('th', { class: 'tight' }, 'Pass'), h('th', { class: 'num wide' }, 'Avg time'), h('th', { class: 'wide' }, 'Environment'), h('th', { class: 'tight' }, ''))),
        h('tbody', null, ...rows.map(projectRow))) : null,
      allRuns.length ? ui.sectionHead('Recent runs', 'every project, newest first', null) : null,
      allRuns.length ? h('table', { class: 'grid boxed' }, h('tbody', null, ...rows.flatMap((r) => r.runs.filter((x) => x.status !== 'running').map((x) => ({ ...x, pid: r.id, project: r.name })))
        .sort((a, b) => (b.started || 0) - (a.started || 0)).slice(0, 6).map((x) => h('tr', null,
          h('td', { class: 'clip', title: x.project }, ui.dot({ tone: runTone(x.status), label: x.status }), ' ', x.project),
          h('td', null, resultPill(x)),
          h('td', { class: 'tight wide' }, `${x.passed || 0} passed, ${x.failed || 0} failed${x.skipped ? `, ${x.skipped} skipped` : ''}${x.http ? ` · ${x.http} API calls` : ''}`),
          h('td', { class: 'tight wide' }, x.env || ''),
          h('td', { class: 'num' }, fmtMs(runDur(x))),
          h('td', { class: 'num wide' }, ago(x.started)),
          h('td', { class: 'tight' }, ui.button({ label: 'Show', variant: 'ghost', size: 'small', onClick: () => openProject(x.pid).then(() => follow(x.id, true)).catch((e) => toast(e.message, 'err')) })))))) : null,
      rows.length ? null : ui.emptyPane({
        icon: 'folder', title: 'No Robot Framework project yet',
        text: 'Link a project folder from anywhere on this computer, import a zip, or put a project in your data folder. ApiMan finds its suites, tests, tags, test data and the environment keys it needs.',
        actions: [ui.button({ label: 'Link a folder…', size: 'small', onClick: () => { linkForm.hidden = false; linkIn.focus(); } }), ui.button({ label: 'Import a zip…', size: 'small', onClick: () => zipIn.click() })],
      }),
      ...unpairedSection(rows, pairs),
      ui.sectionHead('Apps running on this computer', 'common development ports, answering now', null),
      appRows.length ? h('table', { class: 'grid boxed' }, h('thead', null, h('tr', null, h('th', null, 'App'), h('th', { class: 'desktop-only' }, 'Page'), h('th', { class: 'num' }, 'Status'), h('th', { class: 'desktop-only' }, 'Environments'), h('th', { class: 'tight' }, ''))),
        h('tbody', null, ...appRows.map((a) => {
          const base = a.url.replace(/\/$/, '');
          const using = state.envList.filter((e) => envUrls(state.envs[e.id]).some((u) => appKey(u.url) === appKey(base)));
          return h('tr', null, h('td', { class: 'mono' }, ui.dot({ tone: 'ok', label: 'Answering' }), ' ', base), h('td', { class: 'desktop-only' }, a.title || '–'),
            h('td', { class: 'num' }, ui.status(a.status, { small: true })), h('td', { class: 'desktop-only' }, using.map((e) => e.name).join(', ') || '–'),
            h('td', { class: 'tight' }, ui.iconButton('plus', `Create an environment for ${base}`, () => envForApp(base, a.title).catch((e) => toast(e.message, 'err')), { size: 'small' })));
        }))) : ui.hint('Nothing answering on the usual development ports (3000, 4200, 5173, 8000, 8080…). Start your app and Refresh.'),
      allUrls.length ? ui.sectionHead('Environments', 'is each one\'s app answering?', null) : null,
      allUrls.length ? h('table', { class: 'grid boxed' }, h('tbody', null, ...state.envList.filter((e) => envUrls(state.envs[e.id]).length).map((e) => h('tr', null,
        h('td', null, e.name),
        h('td', { class: 'mono clip' }, ...envUrls(state.envs[e.id]).flatMap((u) => { const c = up.get(u.url); return [h('div', { class: 'one-line', title: c && !c.up ? `${u.url}: ${c.error}` : u.url }, ui.dot({ tone: c && c.up ? 'ok' : 'err', label: c && c.up ? 'Answering' : 'Not answering' }), ` ${u.key} = ${u.url}`)]; })),
        h('td', { class: 'tight' }, ui.button({ label: 'Edit', variant: 'ghost', size: 'small', onClick: () => aside(() => editEnvironment(e.id)) }))))))
        : null,
    ].filter(Boolean));
  }
  /** Collections no project is paired with: pair one in a click (its requests then run with that project's test data). */
  function unpairedSection(rows, pairs) {
    const paired = new Set([...pairs.values()].filter(Boolean).map((x) => x.cid));
    const left = state.colList.filter((c) => !paired.has(c.id));
    const projectsOk = rows.filter((r) => !r.error);
    if (!left.length || !projectsOk.length) return [];
    return [ui.sectionHead('Collections not paired', 'pair one with a project to run its requests with that project\'s test data', null),
      h('table', { class: 'grid boxed' }, h('tbody', null, ...left.map((c) => {
        const sel = ui.select([['', 'Pair with…'], ...projectsOk.map((r) => [r.id, r.name])], { size: 'small', 'aria-label': `Pair ${c.name} with a project`,
          onChange: () => { if (!sel.value) return; saved.pairs[sel.value] = c.id; remember('pairs', saved.pairs); toast(`Paired ${c.name} with ${projectsOk.find((r) => r.id === sel.value).name}.`, 'ok'); renderDashboard().catch((e) => toast(e.message, 'err')); } });
        return h('tr', null, h('td', null, c.name), h('td', { class: 'num' }, state.cols[c.id] ? plural(countRequests(state.cols[c.id].item), 'request') : ''), h('td', { class: 'tight' }, sel));
      })))];
  }
  /** The project's test data is read in the background on load; a Run from a card waits for it. */
  async function loadSuiteDataNow() {
    if (suite && suite.loading) await suite.loading; // the load project open started
  }

  /** One click: an environment whose BASE_URL is a running app. */
  async function envForApp(base, title) {
    const same = state.envList.find((e) => envUrls(state.envs[e.id]).some((u) => appKey(u.url) === appKey(base)));
    if (same) { toast(`${same.name} already points at ${base}: use it (one environment per app).`, 'muted'); return; }
    const name = `${title ? `${title} ` : ''}${base.replace(/^https?:\/\//, '')}`.slice(0, 60);
    await backend.environments.create({ name, values: [{ key: 'BASE_URL', value: base, type: 'default', enabled: true }], _postman_variable_scope: 'environment' });
    await refreshEnvironments();
    renderEnvPicker();
    toast(`Created the "${name}" environment (BASE_URL = ${base}): pick it on a project.`, 'ok');
    await renderDashboard();
  }

  // =========================== Collection: the project's APIs from a Postman collection, run with its test data ===========================
  saved.pairs = saved.pairs || {}; // project id -> collection id ('' = none on purpose); absent: matched automatically
  const suitePane = h('div');
  let suite = null;     // { pair, datasets, unread, read } for the open project
  let starting = false; // a run is being started: a second click waits
  /** The project's test data: every CSV/TSV/JSON file in it (not its variable files), parsed once per project load. */
  async function loadSuiteData() {
    const files = project.data.filter((f) => /\.(csv|tsv|json)$/i.test(f.path) && !project.varfiles.includes(f.path)).slice(0, 80);
    const unread = project.data.filter((f) => /\.(ya?ml|xlsx?|xml|txt)$/i.test(f.path) && !project.varfiles.includes(f.path)).map((f) => f.path);
    const parsed = await Promise.all(files.map((f) => api('GET', `/api/robot/projects/${encodeURIComponent(project.id)}/file?path=${encodeURIComponent(f.path)}`)
      .then((r) => datasetsFrom(f.path, r.text)).catch(() => [])));
    return { datasets: parsed.flat(), unread, read: files.length, skippedFiles: Math.max(0, project.data.filter((f) => /\.(csv|tsv|json)$/i.test(f.path)).length - files.length) };
  }
  const suiteEnvId = () => (envSel.value && !envSel.value.startsWith('file:') ? envSel.value : '');
  function renderSuite() {
    if (!project || !suite) return;
    const pair = suite.pair;
    const overridden = Object.hasOwn(saved.pairs, project.id);
    const pairSel = ui.select([['__auto', 'Match automatically'], ['', 'Not paired'], ...state.colList.map((c) => [c.id, c.name])], {
      value: overridden ? saved.pairs[project.id] || '' : '__auto',
      onChange: () => {
        if (pairSel.value === '__auto') delete saved.pairs[project.id]; else saved.pairs[project.id] = pairSel.value;
        remember('pairs', saved.pairs);
        suite.pair = pairFor(project, saved.pairs);
        renderSuite();
      },
    });
    const head = h('div', { class: 'grid-3' }, ui.field('Postman collection', pairSel, { hint: pair ? (pair.auto ? 'Matched automatically: its requests are the API calls in these tests.' : 'Chosen by you.') : null }));
    if (!pair) {
      suitePane.replaceChildren(head, ui.hint(overridden && state.colList.length
        ? 'Not paired, on purpose. Pick the collection with this project\'s APIs to run its requests with this project\'s test data, as part of this suite.'
        : state.colList.length
        ? 'No collection shares a request with these tests. Pick the one with this project\'s APIs, and its requests run with this project\'s test data, as part of this suite.'
        : 'No Postman collection yet. Import one (Import, in the header) and it\'s matched with this project when its requests are the API calls in these tests.'));
      return;
    }
    const envId = suiteEnvId();
    const env = envId ? state.envs[envId] : null;
    const plan = planSuite(pair.cid, envId, suite.datasets, project.endpoints);
    const withData = plan.plan.filter((x) => x.source).length;
    // what only the environment can give: hosts, and values no test data fills
    const fromEnv = [...new Set(plan.plan.flatMap((x) => [...(x.hostMissing ? [x.hostVar] : []), ...x.missing]))];
    const keys = new Map(((env && env.values) || []).filter((v) => v.enabled !== false).map((v) => [normKey(v.key), v.key]));
    const renames = fromEnv.filter((k) => keys.has(normKey(k)) && keys.get(normKey(k)) !== k).map((k) => [keys.get(normKey(k)), k]);
    const absent = fromEnv.filter((k) => !keys.has(normKey(k)));
    const hostsMissing = [...new Set(plan.plan.filter((x) => x.hostMissing).map((x) => x.hostVar))];
    const shown = plan.plan.slice(0, 300);
    suitePane.replaceChildren(...[
      head,
      ui.meta([
        h('span', null, ui.value(String(plan.total)), ' requests'),
        h('span', null, ui.value(String(plan.covered)), ' also called by these tests'),
        h('span', null, ui.value(String(withData)), ' with test data'),
        h('span', null, ui.value(String(plan.cases)), plan.cases === 1 ? ' case to run' : ' cases to run'),
        h('span', null, ui.value(String(suite.read)), ' data files read'),
      ]),
      suite.unread.length ? ui.hint(`Not read (only CSV, TSV and JSON test data are): ${suite.unread.slice(0, 6).join(', ')}${suite.unread.length > 6 ? `, and ${suite.unread.length - 6} more` : ''}.`) : null,
      plan.capped ? ui.note(`Over ${MAX_CASES.toLocaleString()} cases: the requests past that limit are skipped. Split the test data, or pair a smaller collection.`, 'warn') : null,
      !env ? ui.note(`Pick an environment above: the collection's requests need ${fromEnv.slice(0, 4).map((k) => `{{${k}}}`).join(', ') || 'one for their host'}.`, 'warn') : null,
      env && hostsMissing.length ? ui.note(`${env.name} has no ${hostsMissing.map((k) => `{{${k}}}`).join(', ')}: the requests that use it can't run until it does.`, 'err') : null,
      env && renames.length ? ui.note(`One key for both: the collection needs ${renames.map(([, to]) => `{{${to}}}`).join(', ')}, and ${env.name} has ${renames.map(([from]) => from).join(', ')}. Robot reads either spelling, the collection needs the exact one.`, 'warn') : null,
      env && (renames.length || absent.length) ? ui.actions(...[
        renames.length ? ui.button({ label: `Rename to ${renames.map(([, to]) => to).join(', ')}`, size: 'small', onClick: () => renameKeys(env, renames).catch((e) => toast(e.message, 'err')) }) : null,
        absent.length ? ui.button({ label: `Add ${absent.length} missing to ${env.name}`, size: 'small', onClick: () => addKeys(env, absent.map((name) => ({ name }))).catch((e) => toast(e.message, 'err')) }) : null,
      ].filter(Boolean)) : null,
      ui.sectionHead('Requests and their test data', plan.plan.length > shown.length ? `the first ${shown.length} of ${plan.plan.length}` : null, null),
      h('table', { class: 'grid boxed' }, h('thead', null, h('tr', null, h('th', null, 'Request'), h('th', null, 'Test data'), h('th', { class: 'num' }, 'Cases'), h('th', null, 'Missing'), h('th', { class: 'tight' }, 'In tests'))),
        h('tbody', null, ...shown.map((x) => h('tr', null,
          h('td', null, ui.method(x.ed.method), ' ', x.ed.name, x.folder ? h('div', { class: 'hint' }, x.folder) : null),
          h('td', null, x.source ? [x.source, h('div', { class: 'hint' }, [x.why,
            x.fills.length || x.binds.length ? `fills ${[...x.fills.map((k) => `{{${k}}}`), ...x.binds.map(([, f]) => `${f.kind} ${f.key}`)].join(', ')}` : 'fills nothing in this request',
            x.unused.length ? `unused: ${x.unused.slice(0, 5).join(', ')}` : '', x.bodyNote, x.truncated ? `first ${MAX_ROWS_PER_REQUEST} rows (${x.truncated} more not run)` : ''].filter(Boolean).join('; '))] : ui.hint(x.need.length ? 'none found' : 'needs none')),
          h('td', { class: 'num' }, x.cases.length ? String(x.cases.length) : x.skipReason ? ui.hint(`skipped: ${x.skipReason}`) : '–'),
          h('td', null, x.hostMissing ? ui.pill(`{{${x.hostVar}}}`, 'err') : x.missing.length ? x.missing.slice(0, 4).map((k) => ui.pill(`{{${k}}}`, 'warn')) : '–'),
          h('td', { class: 'tight' }, x.covered ? ui.pill('Yes', 'ok') : '–'))))),
      ui.actions(ui.button({ label: 'Run collection with test data', size: 'small', onClick: () => runSuite().catch((e) => toast(e.message, 'err')) })),
    ].filter(Boolean));
  }
  /** One key that serves both: rename BASE_URL to baseUrl (Robot reads either spelling; a collection needs the exact one). */
  async function renameKeys(env, renames) {
    // a key another collection still uses by its old spelling is copied, not renamed, so that collection keeps working
    const usedElsewhere = (from) => state.colList.some((c) => suite && c.id !== suite.pair.cid && collectionVars(c.id).includes(from));
    const copied = [];
    await mutateDoc('environments', suiteEnvId(), (doc) => {
      for (const [from, to] of renames) {
        if (doc.values.some((v) => v.key === to)) continue;
        const v = doc.values.find((x) => x.key === from);
        if (!v) continue;
        if (usedElsewhere(from)) { doc.values.push({ ...v, key: to }); copied.push(from); } else v.key = to;
      }
      return true;
    });
    toast(copied.length ? `Added ${renames.map(([, to]) => to).join(', ')} to ${env.name} (${copied.join(', ')} kept: another collection uses it).`
      : `Renamed in ${env.name}: one key now serves the collection and the Robot tests.`, 'ok');
    renderKeys();
    renderSuite();
  }
  /** Run the paired collection with the project's test data; it's recorded as a run of this suite. */
  async function runSuite() {
    if (suiteCtrl || starting) { toast('A run is starting or going: wait for it or stop it first.', 'warn'); return; } // a double click starts one run
    starting = true;
    try { await runSuiteNow(); } finally { starting = false; }
  }
  async function runSuiteNow() {
    await loading;
    if (run && run.meta && run.meta.status === 'running') { toast(`${run.meta.projectName} is still running: wait for it or stop it first.`, 'warn'); return; }
    if (!suite || !suite.pair) throw new Error('Pair a Postman collection with this project first (Collection tab).');
    const cid = suite.pair.cid;
    const col = await withCol(cid);
    const envId = suiteEnvId();
    const plan = planSuite(cid, envId, suite.datasets, project.endpoints);
    const runnable = plan.plan.filter((x) => x.cases.length && !x.hostMissing);
    if (!runnable.length) throw new Error(plan.plan.some((x) => x.hostMissing) ? `Nothing can run: the environment has no {{${plan.plan.find((x) => x.hostMissing).hostVar}}}.` : 'This collection has no requests to run.');
    let meta;
    try {
      meta = await api('POST', '/api/robot/runs/collection', { project: project.id, projectName: project.name, collection: cid, collectionName: col.info.name,
        env: envId ? state.envs[envId].name : '', cases: plan.cases });
    } catch (e) { if (!(await showGoing(e))) throw e; return; }
    let buf = [], posting = Promise.resolve(), failedPost = null, lastPost = Date.now();
    const flush = (done) => {
      const events = buf; buf = []; lastPost = Date.now();
      posting = posting.then(() => api('POST', `/api/robot/runs/${encodeURIComponent(meta.id)}/events`, { events, ...(done ? { done } : {}) })).catch((e) => { failedPost = e; });
      return posting;
    };
    const suiteName = (parents) => [col.info.name, ...parents.map((x) => x.name)].join(' › ');
    buf.push({ t: 'suite_start', name: col.info.name, longname: col.info.name, tests: plan.cases + plan.plan.filter((y) => y.hostMissing || !y.cases.length).length });
    // the requests that can't run are results too: the suite says why
    for (const x of plan.plan.filter((y) => y.hostMissing || !y.cases.length)) {
      const name = x.ed.name;
      buf.push({ t: 'test_start', name, suite: [col.info.name, x.folder].filter(Boolean).join(' › '), tags: ['api'] },
        { t: 'test_end', name, suite: [col.info.name, x.folder].filter(Boolean).join(' › '), tags: ['api'],
          status: x.hostMissing ? 'FAIL' : 'SKIP', message: x.hostMissing ? `Not sent: the environment has no {{${x.hostVar}}}.` : x.skipReason ? `Skipped: ${x.skipReason}.` : `Skipped: over the ${MAX_CASES.toLocaleString()}-case limit.`, ms: 0 });
    }
    const byId = new Map(plan.plan.map((x) => [x.item.id, x]));
    suiteCtrl = new AbortController();
    // events as they come; and while one request takes long, a heartbeat so the run isn't taken for an abandoned one
    const timer = setInterval(() => { if (buf.length || Date.now() - lastPost > 20000) flush(); }, 400);
    $$('.seg-btn', tabBar)[0].click();
    summary.scrollIntoView({ block: 'start', behavior: 'smooth' });
    follow(meta.id).catch(() => {});
    try {
      await runCollection({
        cid, envId, signal: suiteCtrl.signal,
        only: (item) => { const x = byId.get(item.id); return !!x && x.cases.length > 0 && !x.hostMissing; },
        casesFor: (item) => byId.get(item.id).cases,
        onResult: ({ ed, parents, out, testCase }) => {
          if (failedPost) throw failedPost;
          if (suiteCtrl && suiteCtrl.signal.aborted) return; // cut off by Stop: not a result
          const name = ed.name + (testCase.label ? ` · ${testCase.label}` : '');
          const v = caseVerdict(out, testCase);
          const ms = out.res && !out.error ? out.res.timeMs : 0;
          const wire = out.wire || {};
          buf.push({ t: 'test_start', name, suite: suiteName(parents), tags: ['api'] });
          buf.push({ t: 'http', method: wire.method || ed.method, url: wire.url || ed.url, test: name, reqHeaders: headerObj(wire.headers),
            reqBody: wire.body && wire.body.kind === 'text' ? String(wire.body.text || '').slice(0, 65536) : '',
            ...(out.error ? { error: out.error, ms } : { status: out.res.status, reason: out.res.reason || '', ms, resHeaders: headerObj(out.res.headers),
              resBody: out.res.binary ? '(binary)' : String(out.res.body ?? '').slice(0, 65536), size: out.res.size }) });
          for (const tst of out.tests) buf.push({ t: 'kw_end', name: testCase.expect != null ? `${tst.name} (not deciding: this row expects ${testCase.expect})` : tst.name, lib: 'pm.test',
            status: testCase.expect != null ? 'NOT RUN' : tst.passed === false ? 'FAIL' : 'PASS', ms: 0, depth: 2, test: name });
          buf.push({ t: 'test_end', name, suite: suiteName(parents), status: v.status, message: v.message, ms, tags: ['api'] });
        },
      });
      buf.push({ t: 'suite_end', name: col.info.name, longname: col.info.name, status: 'PASS' });
      await flush(suiteCtrl.signal.aborted ? 'stopped' : 'done');
    } catch (e) {
      buf.push({ t: 'log', level: 'ERROR', text: e.message });
      await flush(suiteCtrl && suiteCtrl.signal.aborted ? 'stopped' : 'error'); // cut short: failed, never "passed"
      throw e;
    } finally {
      clearInterval(timer);
      suiteCtrl = null;
    }
    if (failedPost) throw new Error(`Couldn't record the run: ${failedPost.message}`);
  }

  let loading = null; // the project being loaded: Run waits for it
  const [tabBar, ...panes] = ui.tabs([
    { key: 'live', label: 'Live', content: live },
    { key: 'api', label: 'API calls', content: apiPane },
    { key: 'keys', label: 'Variables', content: keysPane },
    { key: 'data', label: 'Test data', content: [ui.field('Data for this run (JSON)', dataEd, { hint: 'Each key becomes a ${variable} for the run, over the environment\'s value. Saved with the run.' }), filesPane, fileView] },
    { key: 'history', label: 'History', content: historyPane },
    { key: 'collection', label: 'Collection', content: suitePane },
  ], (k) => { if (k === 'history') renderHistory().catch((e) => toast(e.message, 'err')); }, { cls: 'dlg-tabs' });
  const pythonNote = h('div');

  function loadProject() { loading = loadProjectNow(); return loading; }
  async function loadProjectNow() {
    project = await api('GET', `/api/robot/projects/${encodeURIComponent(projSel.value)}`);
    const tests = project.suites.reduce((a, s) => a + s.tests.length, 0);
    targetSel.replaceChildren(...ui.select([['', `Everything (${tests} tests)`], ...project.suites.map((s) => ({ group: s.path, options: [
      [s.path, `All of ${s.name} (${s.tests.length})`], ...s.tests.map((t) => [`${s.path}::${t.name}`, `${t.name}${t.tags.length ? `  [${t.tags.join(', ')}]` : ''}`])] }))], { value: saved.target || '' }).childNodes);
    targetSel.value = [...targetSel.options].some((o) => o.value === saved.target) ? saved.target : '';
    const tags = [...new Set(project.suites.flatMap((x) => x.tests.flatMap((t) => t.tags)))].sort((x, y) => x.localeCompare(y)).slice(0, 12);
    // this project's own remembered tags, and only ones it still has (another project's matched nothing: Robot exit 252)
    tagsIn.value = String((saved.includes || {})[project.id] || '').split(',').map((x) => x.trim()).filter((x) => x && tags.includes(x)).join(', ');
    const toggleTag = (tg) => {
      const cur = tagsIn.value.split(',').map((x) => x.trim()).filter(Boolean);
      tagsIn.value = (cur.includes(tg) ? cur.filter((x) => x !== tg) : [...cur, tg]).join(', ');
      rememberTags();
      drawChips();
    };
    const drawChips = () => {
      const on = tagsIn.value.split(',').map((x) => x.trim());
      tagChips.replaceChildren(...tags.map((tg) => ui.button({ label: tg, variant: 'ghost', size: 'small', pressed: on.includes(tg), title: `Only tests tagged ${tg} (click again to remove)`, onClick: () => toggleTag(tg) })));
    };
    drawChips();
    pythonNote.replaceChildren(project.python.error ? ui.note(project.python.error, 'err')
      : h('div', null, ui.hint(project.python.version ? `Robot Framework ${project.python.version}` : 'Python, checked when you run'), ui.path(project.python.path)));
    await Promise.all(state.colList.map((c) => withCol(c.id).catch(() => null)));
    suite = { pair: pairFor(project, saved.pairs), datasets: [], unread: [], read: 0 };
    fillEnvs();
    envSel.value = saved.envs[project.id] ?? '';
    // first time: the environment with most of what both the tests and the paired collection need (never a second one)
    if (saved.envs[project.id] == null) envSel.value = bestEnv([...project.keys.map((k) => k.name), ...(suite.pair ? collectionVars(suite.pair.cid) : [])], { hosts: suite.pair ? collectionHosts(suite.pair.cid) : null }) || '';
    renderKeys();
    renderFiles();
    fileView.replaceChildren();
    suitePane.replaceChildren(ui.emptyPane({ title: 'Reading the test data…' }));
    const mine = suite; // a slower load for a project you've left must not land on this one
    mine.loading = loadSuiteData().then((d) => { if (suite === mine) { Object.assign(mine, d); renderSuite(); } }).catch((e) => { if (suite === mine) suitePane.replaceChildren(ui.note(e.message, 'err')); });
  }

  // ---- running and following a run ----
  const resetLive = () => {
    http = []; httpBody.replaceChildren(); httpDetail.replaceChildren(); apiPane[1].hidden = true; httpEmpty.hidden = false;
    steps.replaceChildren(); failures.hidden = true; failures.replaceChildren(); shotImg.hidden = true; shotEmpty.hidden = false; shotCaption.textContent = '';
    if (shotUrl) URL.revokeObjectURL(shotUrl), (shotUrl = null);
    bar.firstChild.style.width = '0%'; bar.classList.remove('err', 'warn');
  };
  const counts = { tests: 0, done: 0, pass: 0, fail: 0, skip: 0 };
  const line = (src, text, tone = '') => {
    const atEnd = steps.scrollTop + steps.clientHeight >= steps.scrollHeight - 24;
    steps.append(ui.logLine(src, text, tone));
    while (steps.childElementCount > 1500) steps.firstChild.remove();
    if (atEnd) steps.scrollTop = steps.scrollHeight;
  };
  let latestShot = null, shotSeq = 0, lastHttpError = '';
  function apply(e) {
    if (e.t === 'suite_start' && !counts.tests) counts.tests = e.tests || 0;
    else if (e.t === 'suite_start') line('Suite', e.longname, 'muted');
    else if (e.t === 'test_start') line('Test', e.name);
    else if (e.t === 'kw_end' && e.depth <= 3 && e.kind !== 'SETUP' || e.t === 'kw_end' && e.status === 'FAIL' && e.depth <= 3) {
      line(e.ms ? fmtMs(e.ms) : '', `${'  '.repeat(Math.max(0, e.depth - 1))}${e.lib ? `${e.lib}.` : ''}${e.name}`, e.status === 'FAIL' ? 'err' : e.status === 'PASS' ? '' : 'muted');
    } else if (e.t === 'test_end') {
      counts.done++; if (e.status === 'PASS') counts.pass++; else if (e.status === 'FAIL') counts.fail++; else counts.skip++;
      const word = { PASS: 'Passed', FAIL: 'Failed', SKIP: 'Skipped' }[e.status] || e.status;
      const msg = e.message && e.message !== lastHttpError ? `: ${e.message}` : ''; // 43: an HTTP error already shown above isn't repeated
      line(word, `${e.name}${msg}`, runTone(e.status));
      if (e.status === 'FAIL' && run) addFailure(e, run.id);
    } else if (e.t === 'log') line(e.level, e.text, e.level === 'WARN' ? 'warn' : 'err');
    else if (e.t === 'http') { lastHttpError = e.error || ''; addHttp(e); line(e.error ? 'HTTP error' : String(e.status), `${e.method} ${e.url}${e.error ? `: ${e.error}` : ''}`, e.error || e.status >= 500 ? 'err' : e.status >= 400 ? 'warn' : 'muted'); }
    if (e.shot) latestShot = { name: e.shot, step: e.name };
  }
  function renderSummary(meta, console) {
    const running = meta.status === 'running';
    const total = counts.tests || (meta.passed || 0) + (meta.failed || 0) + (meta.skipped || 0);
    bar.firstChild.style.width = `${total ? Math.min(100, (counts.done / total) * 100) : running ? 5 : 100}%`;
    bar.classList.toggle('err', counts.fail > 0 || meta.status === 'failed');
    bar.classList.toggle('warn', meta.status === 'stopped');
    const elapsed = Math.round(((meta.ended || Date.now() / 1000) - meta.started) * 1000);
    summary.replaceChildren(...[
      h('span', null, ui.pill(running ? 'Running' : meta.status === 'stopped' ? 'Stopped' : meta.status === 'failed' ? 'Failed' : 'Passed', runTone(meta.status))),
      h('span', null, ui.value(`${counts.done}${total ? ` of ${total}` : ''}`), ' tests'),
      h('span', null, ui.value(`${counts.pass} passed`, counts.pass ? 'ok' : 'muted'), ' ', ui.value(`${counts.fail} failed`, counts.fail ? 'err' : 'muted'), counts.skip ? ' ' : null, counts.skip ? ui.value(`${counts.skip} skipped`, 'muted') : null),
      h('span', null, ui.value(String(http.length)), ' API calls'),
      h('span', null, running ? 'for ' : 'in ', fmtMs(elapsed)),
      meta.env ? h('span', null, 'Environment ', ui.value(meta.env)) : null].filter(Boolean));
    if (!running && !counts.done && meta.exitCode) line('Robot', (console || '').trim().split('\n').slice(-12).join('\n') || `Robot exited with code ${meta.exitCode}.`, 'err');
  }
  async function follow(runId, replay = false) {
    if (run && run.timer) clearTimeout(run.timer);
    resetLive();
    Object.assign(counts, { tests: 0, done: 0, pass: 0, fail: 0, skip: 0 });
    run = { id: runId, offset: 0, timer: null, meta: null };
    if (replay) $$('.seg-btn', tabBar)[0].click();
    const tick = async () => {
      if (!run || run.id !== runId || !$('#dlg').open) return;
      let res;
      try { res = await api('GET', `/api/robot/runs/${encodeURIComponent(runId)}?from=${run.offset}`); } catch (e) {
        if (!run.failedOnce) toast(`Lost track of the run for a moment: ${e.message}`, 'warn');
        run.failedOnce = true;
        run.timer = setTimeout(tick, 1000); // try again: the run goes on regardless
        return;
      }
      if (!run || run.id !== runId) return;
      latestShot = null;
      res.events.forEach(apply);
      run.offset = res.next; run.meta = res.meta;
      liveFor(res.meta.kind);
      if (latestShot) {
        const shot = latestShot, seq = ++shotSeq;
        runFile(runId, shot.name).then((url) => {
          if (!run || run.id !== runId || seq !== shotSeq) return URL.revokeObjectURL(url); // a newer screen is already up
          if (shotUrl) URL.revokeObjectURL(shotUrl);
          shotUrl = url; shotImg.src = url; shotImg.hidden = false; shotEmpty.hidden = true;
          shotCaption.textContent = `After: ${shot.step}`;
        }).catch(() => {});
      }
      renderSummary(res.meta, res.console);
      const running = res.meta.status === 'running';
      setRunButton(running);
      if (running || res.events.length) run.timer = setTimeout(tick, running ? 250 : 50);
      else if (!replay) {
        const st = res.meta.status;
        toast(st === 'passed' ? `All ${counts.pass} tests passed.` : st === 'stopped' ? 'Run stopped.'
          : counts.done ? `${counts.fail} of ${counts.done} tests failed.` : 'The run ended before any test ran: see Steps for why.', st === 'passed' ? 'ok' : st === 'stopped' ? 'muted' : 'err');
      }
    };
    await tick();
  }
  /** The footer's Run (Stop while a run goes); hidden on the dashboard, where each project has its own Run. */
  const setRunButton = (running) => { const b = $('#dlgFoot .btn.primary'); if (b) { b.textContent = running ? 'Stop' : 'Run tests'; b.hidden = !dash.hidden; } };
  async function start() {
    if (suiteCtrl) { suiteCtrl.abort(); return; } // Stop: a collection run going here stops, whatever else is happening
    if (starting) return; // a double click starts one run
    starting = true;
    try { await startNow(); } finally { starting = false; }
  }
  async function startNow() {
    if (run && run.meta && run.meta.status === 'running' && run.meta.project !== project.id) {
      toast(`${run.meta.projectName} is still running: wait for it or stop it first.`, 'warn');
      return;
    }
    if (run && run.meta && run.meta.status === 'running' && run.meta.kind === 'collection') {
      if (suiteCtrl) { suiteCtrl.abort(); return; } // it runs here, in this page
      // started in a page that's gone (reloaded, closed): Stop marks it stopped, it never starts another run
      await api('POST', `/api/robot/runs/${encodeURIComponent(run.id)}/events`, { events: [], done: 'stopped' }).catch(() => {});
      run.meta.status = 'stopped';
      return;
    }
    if (run && run.meta && run.meta.status === 'running') {
      const { stopped } = await api('POST', `/api/robot/runs/${encodeURIComponent(run.id)}/stop`);
      if (stopped) return;
      run.meta.status = 'stopped'; // the server isn't running it any more: start a new run
    }
    await loading;
    if (!project || project.id !== projSel.value) { toast('Still opening that project: try again in a moment.', 'muted'); return; }
    let data = null;
    if (dataText.trim()) {
      try { data = JSON.parse(dataText); } catch (e) { throw new Error(`Test data isn't valid JSON: ${e.message}`); }
      if (data === null || typeof data !== 'object' || Array.isArray(data)) throw new Error('Test data must be a JSON object: each key becomes a ${variable}.');
    }
    const cut = targetSel.value.indexOf('::');
    const [suite, test] = cut < 0 ? [targetSel.value, ''] : [targetSel.value.slice(0, cut), targetSel.value.slice(cut + 2)];
    const file = envSel.value.startsWith('file:') ? envSel.value.slice(5) : '';
    let meta;
    try {
      meta = await api('POST', '/api/robot/runs', { project: project.id, suite: suite || '.', test: test || '', include: tagsIn.value, envId: file ? '' : envSel.value, varfile: file, data, speed: speedSel.value });
    } catch (e) { if (!(await showGoing(e))) throw e; return; }
    $$('.seg-btn', tabBar)[0].click();
    summary.scrollIntoView({ block: 'start', behavior: 'smooth' }); // the live browser and steps fill the view
    await follow(meta.id);
  }

  projectView.append(
    ui.toolbar([ui.button({ label: 'All projects', variant: 'ghost', size: 'small', onClick: showDashboard })], []),
    h('div', { class: 'grid-3' }, ui.field('Project', projSel), ui.field('Run', targetSel), ui.field('Environment', envSel)),
    h('div', { class: 'grid-3' }, h('div', null, ui.field('Only tests tagged', tagsIn), tagChips), ui.field('Speed', speedSel), h('div', { class: 'field' }, pythonNote)),
    tabBar, ...panes);
  openDialog({
    title: 'Automation', full: true, page: automationWin.only, tall: true,
    body: [dash, projectView],
    // Automation's own window: the whole window, nothing to close (the API client is in the other window).
    // Opened here only when the browser blocked that window: then it closes like any dialog.
    cancel: automationWin.only ? false : 'Close', closable: !automationWin.only,
    onClose: () => {
      if (run && run.timer) clearTimeout(run.timer); run = null; if (shotUrl) URL.revokeObjectURL(shotUrl); releaseHistory();
      if (automationWin.aside || automationWin.only) return;
      document.title = 'ApiMan';
      if (location.hash === '#automation') history.replaceState(null, '', location.pathname + location.search);
    },
    buttons: [{ label: 'Run tests', primary: true, onClick: () => { start().catch((e) => toast(e.message, 'err')); return false; } }],
  });
  setRunButton(false);
  document.title = 'Automation · ApiMan';
  // files changed on disk (a project added, tests edited): the dashboard shows it; an open project waits for Refresh
  document.addEventListener('apiman:datachanged', () => { if ($('#dlg').open && !dash.hidden) renderDashboard().catch(() => {}); });
  // only Automation's own window carries the address: the pop-up fallback over the API client must not, or a reload locks it in
  if (automationWin.only && location.hash !== '#automation') history.replaceState(null, '', `${location.pathname}${location.search}#automation`);
  // a run still going (started before this window opened): show it; otherwise the dashboard
  const going = (await api('GET', '/api/robot/runs')).find((r) => r.status === 'running');
  if (going && projects.some((x) => x.id === going.project)) {
    try { await openProject(going.project); follow(going.id).catch(() => {}); return; } catch (e) { toast(e.message, 'err'); showDashboard(); return; }
  }
  await renderDashboard();
}

// ---------- cookies (local mode): the data folder's jar ----------
async function openCookies() {
  const box = h('div');
  const draw = async () => {
    let list;
    try { list = await api('GET', '/api/cookies'); } catch (e) { box.replaceChildren(ui.note(e.message, 'err')); return; }
    const del = (q, what) => api('DELETE', `/api/cookies${q}`).then(() => { toast(`Deleted ${what}`, 'muted'); draw(); }, (e) => toast(e.message, 'err'));
    const domains = [...new Set(list.map((c) => c.domain))].sort();
    box.replaceChildren(list.length ? h('table', { class: 'grid boxed' },
      h('thead', null, h('tr', null, h('th', null, 'Name'), h('th', null, 'Value'), h('th', { class: 'desktop-only' }, 'Domain'), h('th', { class: 'desktop-only' }, 'Path'), h('th', { class: 'desktop-only' }, 'Expires'), h('th', { class: 'tight' }, ''))),
      h('tbody', null, ...domains.flatMap((d) => list.filter((c) => c.domain === d).map((c) => h('tr', null,
        h('td', null, c.name), h('td', { class: 'mono clip', title: c.value }, c.value),
        h('td', { class: 'desktop-only' }, c.domain), h('td', { class: 'desktop-only' }, c.path),
        h('td', { class: 'desktop-only' }, c.expires ? fmtWhen(c.expires) : 'Session'),
        h('td', { class: 'tight' }, ui.iconButton('trash', `Delete cookie ${c.name}`, () => del(`?${new URLSearchParams({ domain: c.domain, path: c.path, name: c.name })}`, c.name), { size: 'small' })))))))
      : ui.emptyPane({ title: 'No cookies', text: 'Cookies that responses set show here, by site.' }));
  };
  const domainIn = ui.input({ placeholder: 'api.example.com', spellcheck: 'false' });
  const nameIn = ui.input({ placeholder: 'session', spellcheck: 'false' });
  const valueIn = ui.input({ code: true, placeholder: 'value', spellcheck: 'false' });
  await draw();
  openDialog({
    title: 'Cookies', wide: true, cancel: 'Close',
    body: [ui.hint('Kept in the data folder and sent with requests to the matching site. Turn them off in Settings → Requests.'), box,
      ui.sectionHead('Add a cookie', null, null), h('div', { class: 'grid-3' }, ui.field('Domain', domainIn), ui.field('Name', nameIn), ui.field('Value', valueIn))],
    buttons: [
      { label: 'Delete all', danger: true, left: true, onClick: async () => { if (await ask({ title: 'Delete every cookie?', message: 'Logins that use a session cookie will need to sign in again.', ok: 'Delete all', danger: true })) { await api('DELETE', '/api/cookies'); toast('Cookies deleted', 'muted'); } openCookies(); return true; } },
      { label: 'Add', primary: true, onClick: async () => {
        await api('PUT', '/api/cookies', { domain: domainIn.value.trim(), name: nameIn.value.trim(), value: valueIn.value, path: '/' });
        nameIn.value = ''; valueIn.value = ''; toast('Cookie added', 'ok'); await draw(); return false;
      } },
    ],
  });
}

// ---------- settings ----------
function openSettings(initial = null, layoutSnap = null) {
  const s = state.settings;
  const snap = layoutSnap || initResizers.snapshot(); // panel sizes when Settings opened: Cancel goes back to these
  const draft = { ...s, ...(initial || {}) };
  let saved = false, reopening = false;
  let syncSizesRef = null;
  const preview = () => { applyAppearance(draft); requestAnimationFrame(() => requestAnimationFrame(() => syncSizesRef && syncSizesRef())); };
  const seg = (key, options, label) => ui.seg(options, draft[key], (v) => { draft[key] = v; if (key === 'theme') previewTheme(); else preview(); }, { label });
  const previewTheme = () => {
    if (draft.theme === 'light' || draft.theme === 'dark') document.documentElement.dataset.theme = draft.theme;
    else delete document.documentElement.dataset.theme;
    drawSwatches();
    preview();
  };
  // Every size is a slider AND an exact number field, kept in sync.
  const slider = (key, min, max, step, unit, label, scale = 1) => {
    const shown = (v) => String(Math.round(v * scale * 100) / 100);
    const num = ui.input({ type: 'number', size: 'small', num: true, min: String(min * scale), max: String(max * scale), step: String(step * scale), value: shown(draft[key]), 'aria-label': `${label} (${unit})` });
    const range = ui.input({ type: 'range', min: String(min), max: String(max), step: String(step), value: String(draft[key]), 'aria-label': label });
    range.addEventListener('input', () => { draft[key] = Number(range.value); num.value = shown(draft[key]); preview(); });
    num.addEventListener('change', () => { draft[key] = clampNum(Number(num.value) / scale, min, max, draft[key]); range.value = String(draft[key]); num.value = shown(draft[key]); preview(); });
    return h('div', { class: 'field' }, h('span', { class: 'label' }, label), h('div', { class: 'slider-row' }, range, num, h('span', { class: 'unit' }, unit)));
  };
  const select = (key, options, label) => ui.field(label, ui.select(Object.entries(options).map(([v, [l]]) => [v, l]), { value: draft[key], onChange: (e) => { draft[key] = e.target.value; preview(); } }));
  if (draft.densityScale == null) draft.densityScale = DENSITY[draft.density] || 1;
  if (initial) setTimeout(() => { if (initial.theme === 'light' || initial.theme === 'dark') document.documentElement.dataset.theme = initial.theme; else delete document.documentElement.dataset.theme; applyAppearance(draft); }, 0);
  // exact panel sizes (applied immediately, like dragging)
  // Exact sizes, in the unit you prefer (96 px = 1 inch). Every field always shows the size actually rendered.
  let unit = ls.get('apiman:sizeUnit', 'px');
  const PER = { px: 1, in: 96, cm: 96 / 2.54 };
  const show = (px) => (unit === 'px' ? String(Math.round(px)) : String(Math.round((px / PER[unit]) * 100) / 100));
  const sideNum = ui.input({ type: 'number', size: 'small', num: true, step: 'any', 'aria-label': 'Sidebar width' });
  const reqNum = ui.input({ type: 'number', size: 'small', num: true, step: 'any', 'aria-label': 'Request pane size' });
  const splitNum = ui.input({ type: 'number', size: 'small', num: true, min: '15', max: '85', step: '0.5', 'aria-label': 'Request pane share in percent' });
  const unitSel = ui.select([['px', 'px'], ['in', 'in'], ['cm', 'cm']], { value: unit, size: 'small', 'aria-label': 'Size unit' });
  const unitTxt = () => { const el = $('#reqSizeUnit'); if (el) el.textContent = unit; };
  const syncSizes = () => {
    const z = initResizers.sizes();
    sideNum.value = show($('.side').getBoundingClientRect().width || z.side);
    reqNum.value = show(initResizers.paneSize());
    splitNum.value = String(z.split);
    const lbl = $('#reqSizeLabel');
    if (lbl) lbl.textContent = initResizers.isStacked() ? 'Request pane height' : 'Request pane width';
    const auto = $('#autoStackNote');
    if (auto) auto.hidden = document.documentElement.dataset.autoStack !== 'true';
  };
  syncSizesRef = syncSizes;
  sideNum.addEventListener('change', () => { initResizers.setSide(Number(sideNum.value) * PER[unit]); syncSizes(); });
  reqNum.addEventListener('change', () => { initResizers.setSplit(((Number(reqNum.value) * PER[unit]) / initResizers.splitTotal()) * 100); syncSizes(); });
  splitNum.addEventListener('change', () => { initResizers.setSplit(Number(splitNum.value)); syncSizes(); });
  unitSel.addEventListener('change', () => { unit = unitSel.value; ls.set('apiman:sizeUnit', unit); syncSizes(); unitTxt(); });
  setTimeout(syncSizes, 0);
  const swatches = h('div', { class: 'swatches', role: 'radiogroup', 'aria-label': 'Accent colour' });
  const drawSwatches = () => ui.swatches(swatches, Object.entries(ACCENTS).map(([k, [light, darkC]]) => [k, effectiveTheme(draft) === 'dark' ? darkC : light]), draft.accent,
    (k) => { draft.accent = k; drawSwatches(); preview(); },
    { customValue: draft.accentCustom || '#2560cf', onCustom: (v) => { draft.accent = 'custom'; draft.accentCustom = v; drawSwatches(); preview(); } });
  drawSwatches();
  const timeout = ui.input({ type: 'number', num: true, min: '1', max: '600', value: String(s.timeout) });
  const followCheck = ui.check({ label: 'Follow redirects', help: 'Credentials are never forwarded to a different site, and HTTPS never downgrades to HTTP.', checked: s.followRedirects });
  const maxRedirectsIn = ui.input({ type: 'number', num: true, min: '1', max: '50', value: String(s.maxRedirects || 10), 'aria-label': 'Most redirects to follow' });
  const cookiesCheck = ui.check({ label: 'Keep cookies', help: 'Cookies a response sets are sent with later requests to the same site, like Postman. Stored in the data folder.', checked: s.cookies !== false });
  const histCheck = ui.check({ label: 'Keep request history', help: 'Stored only in this browser. It includes request details as you typed them.', checked: s.history });
  const insecureCheck = ui.check({ label: 'Skip TLS certificate checks', help: ['Last resort for internal servers with self-signed certificates: it lets an attacker on the network read your traffic. Prefer starting the server with ', h('code', { class: 'inline' }, '--ca-file'), '.'], checked: s.insecure });
  const wrapCheck = ui.check({ label: 'Wrap long lines (responses and request bodies)', checked: draft.wrap !== false, cls: 'align-end', onChange: (e) => { draft.wrap = e.target.checked; preview(); } });
  const follow = followCheck.input, hist = histCheck.input, insecure = insecureCheck.input;

  const appearance = [
    h('div', { class: 'grid-2' },
      h('div', { class: 'field' }, h('span', { class: 'label' }, 'Theme'), seg('theme', [['system', 'Match system'], ['light', 'Light'], ['dark', 'Dark']], 'Theme')),
      h('div', { class: 'field' }, h('span', { class: 'label' }, 'Accent colour'), swatches)),
    h('div', { class: 'grid-2' },
      h('div', { class: 'field' }, h('span', { class: 'label' }, 'Active tab'), seg('tabStyle', [['subtle', 'Subtle'], ['accent', 'Accent tint']], 'Active tab style')),
      h('div', { class: 'field' }, h('span', { class: 'label' }, 'Send button'), seg('sendStyle', [['method', 'Method colour'], ['accent', 'Accent']], 'Send button colour'))),
    h('div', { class: 'grid-2' }, select('uiFont', UI_FONTS, 'Interface font'), select('codeFont', CODE_FONTS, 'Code font')),
    h('div', { class: 'grid-2' },
      slider('textScale', 0.8, 1.5, 0.05, '%', 'Interface text size', 100),
      slider('codeSize', 10, 24, 1, 'px', 'Code and body text size')),
    h('div', { class: 'grid-2' },
      slider('densityScale', 0.75, 1.4, 0.05, '%', 'Density (spacing and control height)', 100),
      slider('lineHeight', 1.3, 1.9, 0.05, '×', 'Code line height')),
    h('div', { class: 'grid-2' },
      h('div', { class: 'field' }, h('span', { class: 'label' }, 'Tab width in editors'), seg('tabSize', [[2, '2 spaces'], [4, '4 spaces'], [8, '8 spaces']], 'Tab width')),
      wrapCheck),
    h('div', { class: 'grid-2 desktop-only' },
      h('div', { class: 'field' }, h('span', { class: 'label' }, 'Request and response'), seg('layout', [['auto', 'Side by side'], ['stacked', 'Stacked']], 'Layout'),
        ui.hint('Stacked automatically right now: side by side, each pane would be too narrow.', { id: 'autoStackNote', hidden: document.documentElement.dataset.autoStack !== 'true' })),
      h('div', { class: 'field' }, h('span', { class: 'label' }, 'Sidebar'), seg('sidePosition', [['left', 'Left'], ['right', 'Right']], 'Sidebar position'))),
    h('div', { class: 'grid-3 desktop-only' },
      h('div', { class: 'field' }, h('span', { class: 'label' }, 'Sidebar width'), h('div', { class: 'slider-row' }, sideNum, unitSel)),
      h('div', { class: 'field' }, h('span', { class: 'label', id: 'reqSizeLabel' }, initResizers.isStacked() ? 'Request pane height' : 'Request pane width'), h('div', { class: 'slider-row' }, reqNum, h('span', { class: 'unit', id: 'reqSizeUnit' }, unit))),
      h('div', { class: 'field' }, h('span', { class: 'label' }, 'Request pane share'), h('div', { class: 'slider-row' }, splitNum, h('span', { class: 'unit' }, '%')))),
    h('div', { class: 'field-row desktop-only' },
      ui.button({ label: 'Reset panel sizes', size: 'small', onClick: () => { initResizers.reset(); syncSizes(); toast('Panel sizes reset'); } }),
      ui.hint('Drag the lines between panels to resize them (sizes show while dragging). Double-click a line to reset it. Cmd/Ctrl+B hides the sidebar.')),
  ];
  const requests = [
    ui.field('Request timeout (seconds)', timeout, { narrow: true }),
    followCheck,
    backend.mode === 'local' ? ui.field('Most redirects to follow', maxRedirectsIn, { narrow: true }) : null,
    backend.mode === 'local' ? h('div', { class: 'field-row' }, cookiesCheck, ui.button({ label: 'Manage cookies…', size: 'small', onClick: () => openCookies() })) : null,
    histCheck,
    backend.mode === 'local' ? insecureCheck
      : ui.hint('Website mode: the browser sends requests, so certificate and CORS rules apply. Run ApiMan locally (python3 server.py) to call any API, including internal ones over VPN.'),
    backend.mode === 'local'
      ? h('div', { class: 'field-row' }, ui.hint(`Data folder: ${state.dataDir}`, { title: state.dataDir }), ui.button({ label: 'Change…', size: 'small', onClick: () => changeDataFolder().catch((e) => toast(e.message, 'err')) }))
      : ui.hint($('#dataDir').textContent),
  ];
  openDialog({
    title: 'Settings',
    tall: true, drawer: true, focus: '#dlgBody .dlg-tabs .on',
    body: dlgTabs([{ key: 'appearance', label: 'Appearance', content: appearance }, { key: 'requests', label: 'Requests', content: requests }]),
    onClose: () => { if (!saved && !reopening) { applyTheme(); applyAppearance(); initResizers.restore(snap); } }, // Cancel undoes everything, panel sizes included
    buttons: [
      { label: 'Restore defaults', left: true, onClick: () => {
        // Only the form is reset and previewed; nothing is stored until Save, and Cancel brings everything back.
        const defaults = { ...draft, theme: DEFAULT_SETTINGS.theme, textScale: 1, codeSize: 13, density: 'comfortable', densityScale: 1, layout: 'auto', wrap: true, tabStyle: 'subtle', sendStyle: 'method',
          lineHeight: 1.6, tabSize: 2, uiFont: 'geist', codeFont: 'geist-mono', accent: 'blue', sidePosition: 'left', sideHidden: false };
        reopening = true;
        applyAppearance(defaults);                             // defaults first, so minimums use the default text size
        initResizers.setSide(288); initResizers.setSplit(50); // previewed like everything else; Cancel restores
        setTimeout(() => { openSettings(defaults, snap); toast('Defaults loaded. Save to keep them, or Cancel to go back.', 'muted'); }, 0);
        return true;
      } },
      { label: 'Save', primary: true, onClick: () => {
        Object.assign(s, {
          theme: draft.theme, textScale: draft.textScale, codeSize: draft.codeSize, density: draft.density, layout: draft.layout, wrap: draft.wrap,
          densityScale: draft.densityScale, lineHeight: draft.lineHeight, tabSize: Number(draft.tabSize) || 2, uiFont: draft.uiFont, codeFont: draft.codeFont,
          accent: draft.accent, accentCustom: draft.accentCustom, tabStyle: draft.tabStyle, sendStyle: draft.sendStyle, sidePosition: draft.sidePosition, sideHidden: !!draft.sideHidden,
          timeout: Math.max(1, Math.min(600, Number(timeout.value) || 60)),
          followRedirects: follow.checked, history: hist.checked, insecure: backend.mode === 'local' && insecure.checked,
          maxRedirects: Math.max(1, Math.min(50, Math.round(Number(maxRedirectsIn.value)) || 10)), cookies: cookiesCheck.input.checked,
        });
        saved = true;
        saveSettings();
        applyTheme();
        applyAppearance();
        renderSidebar();
        toast('Settings saved');
        return true;
      } },
    ],
  });
}

// =====================================================================================================
// Wiring
// =====================================================================================================
/** Unsaved requests named after their method and path ("GET /anything", from a cURL import or the default) keep
 *  that name in step with the URL; a name you typed yourself is never touched. */
function autoTitle(t) {
  if (!t || t.cid) return;
  const name = t.ed.name || '';
  if (name && name !== 'Untitled request' && !/^[A-Z]{1,16} \/\S*$/.test(name)) return;
  let path = '/';
  try { path = new URL(t.ed.url.includes('://') ? t.ed.url : `http://${t.ed.url}`).pathname; } catch { return; }
  t.ed.name = `${t.ed.method} ${decodeURIComponent(path)}`;
  if ($('#reqName') && document.activeElement !== $('#reqName')) $('#reqName').value = t.ed.name;
  renderTabs();
}
function bindEditor() {
  const ed = () => cur().ed;
  $('#reqName').addEventListener('input', (e) => { ed().name = e.target.value; markDirty(); renderTabs(); });
  $('#method').addEventListener('change', (e) => { ed().method = e.target.value; $('#reqbar').dataset.method = e.target.value; autoTitle(cur()); markDirty(); renderTabs(); if (cur().reqTab === 'body') renderBody(); });
  $('#url').addEventListener('input', (e) => {
    const t = cur();
    t.ed.url = e.target.value;
    autoTitle(t);
    t.ed.params = [...parseQuery(t.ed.url), ...t.ed.params.filter((p) => p.disabled)];
    t.ed.pathVars = syncPathVars(t.ed.url, t.ed.pathVars || []);
    if (t.reqTab === 'params') renderParams();
    renderResolved();
    renderCounts();
    markDirty();
  });
  ['scroll', 'keyup', 'click', 'select', 'focus', 'input'].forEach((ev) => $('#url').addEventListener(ev, () => { $('#urlHl').scrollLeft = $('#url').scrollLeft; }));
  $('#url').addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.metaKey && !e.ctrlKey) { e.preventDefault(); send(); } }); // Cmd/Ctrl+Enter is the global shortcut
  $('#url').addEventListener('paste', (e) => {
    const text = e.clipboardData.getData('text');
    if (/^\s*curl\s/i.test(text)) {
      e.preventDefault();
      try {
        const parsed = parseCurl(text);
        const t = cur();
        Object.assign(t.ed, { method: parsed.method, url: parsed.url, params: parsed.params, headers: parsed.headers, body: parsed.body,
          ...(parsed.auth.type !== 'inherit' ? { auth: parsed.auth } : {}),
          name: t.ed.name === 'Untitled request' ? parsed.name : t.ed.name,
          pathVars: syncPathVars(parsed.url, t.ed.pathVars || []) });
        markDirty();
        renderEditor();
        toast('Filled in from the pasted cURL command');
      } catch (err) { toast(err.message, 'err'); }
    }
  });
  $('#btnSend').addEventListener('click', send);
  $('#btnSave').addEventListener('click', () => save().catch((e) => toast(e.message, 'err')));
  $('#btnCode').addEventListener('click', openCode);
  $('#reqTabs').addEventListener('click', (e) => {
    const b = e.target.closest('.tab');
    if (!b) return;
    cur().reqTab = b.dataset.tab;
    switchPane('#reqTabs', b.dataset.tab);
    if (b.dataset.tab === 'params') renderParams(); // the URL may have changed the params while hidden
  });
  $('#respTabs').addEventListener('click', (e) => {
    const b = e.target.closest('.tab');
    if (!b) return;
    cur().respTab = b.dataset.tab;
    switchPane('#respTabs', b.dataset.tab);
  });
  $('#respTools').addEventListener('click', (e) => {
    const b = e.target.closest('.seg-btn');
    if (!b) return;
    if (b.getAttribute('aria-disabled') === 'true') { toast(b.title); return; } // reachable by keyboard, says why
    cur().bodyView = b.dataset.view;
    renderResponse();
  });
  $('#btnCopyBody').addEventListener('click', () => {
    const res = cur() && cur().out && cur().out.res;
    if (!res || res.binary) return;
    let text = res.body;
    const shown = $('#respTools .seg-btn.on')?.dataset.view || 'pretty';
    if (shown !== 'raw') { try { JSON.parse(text); text = prettyJson(text, Number(state.settings.tabSize) || 2); } catch { /* not JSON: exact text */ } } // Raw: exact bytes
    const btn = $('#btnCopyBody'), lbl = btn.querySelector('.lbl');
    navigator.clipboard.writeText(text).then(() => { // confirm where you clicked
      btn.classList.add('done'); if (lbl) lbl.textContent = 'Copied'; btn.setAttribute('aria-label', 'Copied');
      clearTimeout(btn.doneTimer); btn.doneTimer = setTimeout(() => { btn.classList.remove('done'); if (lbl) lbl.textContent = 'Copy'; btn.setAttribute('aria-label', 'Copy'); }, 1500);
    }, () => toast('Copy failed', 'err'));
  });
  $('#btnSaveBody').addEventListener('click', saveBody);
  $('#btnFindBody').addEventListener('click', () => openFind());
  $('#findInput').addEventListener('input', () => runFind(0));
  $('#findInput').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); stepFind(e.shiftKey ? -1 : 1); }
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeFind(); }
  });
  $('#findPrev').addEventListener('click', () => stepFind(-1));
  $('#findNext').addEventListener('click', () => stepFind(1));
  $('#findCase').addEventListener('click', (e) => { e.currentTarget.setAttribute('aria-pressed', String(e.currentTarget.getAttribute('aria-pressed') !== 'true')); runFind(0); });
  $('#findClose').addEventListener('click', closeFind);
  $$('#editor [data-script]').forEach((c) => c.addEventListener('click', () => { cur().scriptKind = c.dataset.script; renderScripts(); }));

  $('#btnSnippets').addEventListener('click', (e) => {
    const t = cur();
    showMenu(e.currentTarget, SNIPPETS[t.scriptKind].map(([label, code]) => ({ label, onClick: () => {
      const tt = cur();
      const key = tt.scriptKind === 'pre' ? 'pre' : 'test';
      tt.ed[key] = tt.ed[key] ? `${tt.ed[key].replace(/\s*$/, '')}\n\n${code}\n` : `${code}\n`;
      renderScripts();
      renderCounts();
      markDirty();
      if (scriptEditor && scriptEditor.cm) { scriptEditor.cm.focus(); scriptEditor.cm.setCursor(scriptEditor.cm.lineCount(), 0); }
    } })));
  });
  $('#docsText').addEventListener('input', (e) => { cur().ed.docs = e.target.value; markDirty(); });
  $$('[data-docs]').forEach((b) => b.addEventListener('click', () => {
    const preview = b.dataset.docs === 'preview';
    $$('[data-docs]').forEach((x) => { x.classList.toggle('on', x === b); x.setAttribute('aria-checked', String(x === b)); });
    $('#docsText').hidden = preview;
    $('#docsPreview').hidden = !preview;
    if (preview) $('#docsPreview').replaceChildren(...renderMarkdown(cur().ed.docs));
  }));
}

function bindChrome() {
  $$('.side .seg-btn').forEach((b) => b.addEventListener('click', async () => {
    state.view = b.dataset.view;
    if (state.view === 'environments') await refreshEnvironments().catch(() => {});
    renderSidebar();
  }));
  $('#search').addEventListener('input', debounce(async (e) => {
    state.filter = e.target.value.trim().toLowerCase();
    if (state.filter && state.view === 'collections') await Promise.all(state.colList.map((c) => withCol(c.id).catch(() => {})));
    renderSidebar();
  }, 120));
  $('#btnNew').addEventListener('click', (e) => showMenu(e.currentTarget, [
    { label: 'Request', onClick: () => openTab(newTab()) },
    { label: 'Collection', onClick: () => newCollection().catch((err) => toast(err.message, 'err')) },
    { label: 'Environment', onClick: () => editEnvironment(null) },
    { label: 'Request from cURL', onClick: () => openImport('curl') },
  ]));
  $('#btnImport').addEventListener('click', () => openImport());
  // Run: the collection runner, and in local mode Automation (Robot Framework projects)
  $('#btnRunner').addEventListener('click', (e) => {
    if (!backend || backend.mode !== 'local') { openRunner(cur() && cur().cid, null); return; }
    showMenu(e.currentTarget, [
      { label: 'Collection runner', onClick: () => openRunner(cur() && cur().cid, null) },
      { label: 'Automation (Robot Framework)', onClick: showAutomation },
    ]);
  });
  $('#btnSettings').addEventListener('click', () => openSettings());
  $('#btnTheme').addEventListener('click', () => {
    state.settings.theme = effectiveTheme() === 'dark' ? 'light' : 'dark';
    saveSettings();
    applyTheme();
  });
  $('#envSelect').addEventListener('change', (e) => {
    if (e.target.value === '__new') { e.target.value = state.activeEnv || ''; editEnvironment(null); return; }
    setActiveEnv(e.target.value);
    if (state.view === 'environments') renderSidebar();
  });
  $('#btnEnvPeek').addEventListener('click', (e) => peekVariables(e.currentTarget));
  $('#welcome').addEventListener('click', (e) => {
    const act = e.target.closest('[data-act]');
    if (!act) return;
    if (act.dataset.act === 'new-request') openTab(newTab());
    if (act.dataset.act === 'import') openImport();
    if (act.dataset.act === 'import-curl') openImport('curl');
    if (act.dataset.act === 'automation') showAutomation();
  });

  document.addEventListener('keydown', (e) => {
    const mod = e.metaKey || e.ctrlKey;
    if (e.key === 'Escape' && !$('#popover').hidden) { hideMenu(); return; }
    if ($('#dlg').open) return; // never send/save the request behind a dialog
    if (mod && e.key === 'Enter') { e.preventDefault(); if (cur()) send(); return; }
    if (mod && e.key.toLowerCase() === 's') { e.preventDefault(); if (cur()) save().catch((err) => toast(err.message, 'err')); return; }
    if (mod && e.key.toLowerCase() === 'b') { e.preventDefault(); toggleSidebar(); return; }
    const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName);
    if (!typing && e.key === '/') { e.preventDefault(); $('#search').focus(); }
  });
  // Unsaved edits are kept and restored. Write synchronously: a debounced write never runs once the page unloads.
  window.addEventListener('pagehide', writeTabs);
  window.addEventListener('beforeunload', writeTabs);
  document.addEventListener('dragover', (e) => { if ([...e.dataTransfer.types].includes('Files')) e.preventDefault(); });
  document.addEventListener('drop', (e) => {
    if (e.target.closest('dialog') || e.target.closest('input[type=file]')) return;
    const files = [...e.dataTransfer.files].filter((f) => /\.(json|ya?ml)$/i.test(f.name));
    if (files.length) { e.preventDefault(); importFiles(files); }
  });
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', applyTheme);
}

// ---------- browser-mode folder ----------
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
/** The side-foot line and button once a folder holds the data. */
function showFolder(dir) {
  $('#dataDir').textContent = `Folder "${dir.name}" on this computer`;
  $('#dataDir').title = 'Collections, environments, open tabs and settings are saved in this folder.';
  const btn = $('#btnFolder');
  btn.hidden = false;
  btn.textContent = 'Change folder';
  btn.onclick = () => pickFolder().catch((e) => e.name !== 'AbortError' && toast(e.message, 'err'));
}
/** Switches the data to this folder: its workspace state wins; a folder used for the first time is offered this browser's data. */
async function useFolder(dir, { starting = false } = {}) {
  if (!starting) { writeTabs(); await workspace.flush(); } // the old place keeps your latest tabs
  backend = makeBackend('browser', dir);
  showFolder(dir);
  const fresh = await workspace.load();
  if (fresh) await offerCopyIn(dir);
  if (starting) return;
  if (!fresh) { try { sessionStorage.removeItem('apiman:outs'); } catch { /* none */ } } // kept responses belonged to the old tabs
  state.cols = {};
  state.envs = {};
  state.tabs = [];
  state.active = -1;
  await Promise.all([refreshCollections(), refreshEnvironments()]);
  await restoreTabs();
  renderEnvPicker();
  renderAll();
}
async function pickFolder() {
  if (state.tabs.some((t) => t.dirty && t.cid) && !(await ask({ title: 'Switch folder?', message: 'Tabs from the current collections will close, and their unsaved changes will be lost.', ok: 'Switch folder', danger: true }))) return;
  const dir = await window.showDirectoryPicker({ id: 'apiman', mode: 'readwrite' });
  await idbHandle('set', dir);
  await useFolder(dir);
  toast(`Saving to the "${dir.name}" folder`, 'ok');
}
/** Start-up question in website mode: where your data lives. Resolves to a usable folder handle, or null to keep
 *  it in this browser for now (remembered until this browser session ends, so the next visit asks again). */
function askDataFolder(remembered) {
  return new Promise((resolve) => {
    let done = false;
    const settle = (v) => { if (!done) { done = true; resolve(v); } };
    const keepHere = () => { try { sessionStorage.setItem('apiman:browserOnly', '1'); } catch { /* asks again */ } settle(null); return true; };
    const choose = () => {
      // Called straight from the click, so the browser lets the folder picker / permission prompt open.
      const p = remembered
        ? remembered.requestPermission({ mode: 'readwrite' }).then((r) => (r === 'granted' ? remembered : null))
        : window.showDirectoryPicker({ id: 'apiman', mode: 'readwrite' });
      return p.then(async (dir) => {
        if (!dir) { toast('ApiMan needs permission to use the folder. Choose Reconnect and allow it.', 'warn'); return false; }
        if (!remembered) await idbHandle('set', dir).catch(() => {});
        settle(dir);
        return true;
      }, (e) => { if (e.name !== 'AbortError') toast(e.message, 'err'); return false; });
    };
    openDialog({
      title: remembered ? `Reconnect the “${remembered.name}” folder?` : 'Where should ApiMan keep your data?',
      body: ui.hint(remembered
        ? 'Your collections, environments, open tabs and settings are saved in this folder. The browser asks for permission again after it restarts.'
        : 'Choose a folder on this computer for your collections, environments, open tabs and settings. They are saved there as plain files you can back up. If you keep them in this browser instead, ApiMan asks again on your next visit.'),
      confirm: true,
      cancel: false,
      buttons: [
        { label: 'Keep in this browser for now', onClick: keepHere },
        { label: remembered ? 'Reconnect' : 'Choose folder…', primary: true, onClick: choose },
      ],
      onClose: () => settle(null), // closed with Esc or the close button: this browser, and ask again next time
    });
  });
}
/** A folder used for the first time: copy this browser's collections and environments in (never deletes, never
 *  overwrites: a clashing name gets a new file name). The workspace state was already written by workspace.load(). */
async function offerCopyIn(dir) {
  const src = { collections: browserStore('collections'), environments: browserStore('environments') };
  const lists = { collections: await src.collections.list(), environments: await src.environments.list() };
  const what = [lists.collections.length && plural(lists.collections.length, 'collection'), lists.environments.length && plural(lists.environments.length, 'environment')].filter(Boolean).join(' and ');
  if (!what) return;
  if (!(await ask({
    title: `Copy your browser data into “${dir.name}”?`,
    message: `This browser holds ${what}. Copy them into the folder? Nothing is deleted from this browser, and files already in the folder are kept.`,
    ok: 'Copy into folder', cancel: 'Not now',
  }))) return;
  try {
    const moved = { collections: new Map(), environments: new Map() };
    for (const kind of ['collections', 'environments']) {
      const dest = backend[kind];
      const have = new Set((await dest.list()).map((d) => d.id.toLowerCase()));
      for (const { id } of lists[kind]) {
        const doc = await src[kind].get(id);
        if (kind === 'environments' && id === GLOBALS_ID && have.has(GLOBALS_ID)) { // one Globals: add the variables it lacks
          const g = await dest.get(GLOBALS_ID);
          const keys = new Set((g.values || []).map((v) => v.key));
          g.values = [...(g.values || []), ...(doc.values || []).filter((v) => !keys.has(v.key))];
          await dest.put(GLOBALS_ID, g);
          continue;
        }
        let nid = id;
        if (have.has(id.toLowerCase())) nid = await dest.create(doc); else await dest.put(id, doc);
        have.add(nid.toLowerCase());
        if (nid !== id) moved[kind].set(id, nid);
      }
    }
    // Tabs, open folders and the chosen environment follow a copy that got a new file name.
    const col = (id) => moved.collections.get(id) || id;
    const tabs = ls.get('apiman:tabs', null);
    if (tabs && Array.isArray(tabs.tabs) && moved.collections.size) ls.set('apiman:tabs', { ...tabs, tabs: tabs.tabs.map((t) => (t && t.cid ? { ...t, cid: col(t.cid) } : t)) });
    if (moved.collections.size) {
      state.open = new Set([...state.open].map((k) => { const i = String(k).indexOf(':'); return i === -1 ? col(k) : col(k.slice(0, i)) + k.slice(i); }));
      saveOpen();
    }
    if (moved.environments.has(state.activeEnv)) { state.activeEnv = moved.environments.get(state.activeEnv); ls.set('apiman:activeEnv', state.activeEnv); }
    toast(`Copied ${what} into "${dir.name}"`, 'ok');
  } catch (e) {
    toast(`Couldn't copy everything into the folder: ${e.message}`, 'err');
  }
}

// =====================================================================================================
// Start
// =====================================================================================================
/** Drag handles for the sidebar and the request/response split (mouse, touch and arrow keys); sizes are remembered. */
function initResizers() {
  const root = document.documentElement;
  const layout = ls.get('apiman:layout', {});
  if (!layout.v2) { if (!layout.reqH || layout.reqH === 50) layout.reqH = 35; layout.v2 = true; ls.set('apiman:layout', layout); }
  const save = (k, v) => { layout[k] = v; ls.set('apiman:layout', layout); };
  const stacked = () => document.documentElement.dataset.layout === 'stacked' || document.documentElement.dataset.autoStack === 'true' || matchMedia('(max-width: 600px)').matches;
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  const side = $('#sideResizer'), split = $('#splitResizer');
  const sideMin = () => Math.ceil(Math.min(260 * cssScale(), innerWidth <= 900 ? innerWidth * 0.35 : Infinity)); // matches --side-eff in app.css
  // Width each pane needs side by side: its full tab row (tabs + maximise + padding), never less than 320px.
  // Each pane can shrink to 320px (x text size); tabs that don't fit then move into a "More tabs" menu.
  const paneNeeds = () => [320 * cssScale(), 320 * cssScale()];
  const setSideW = (px, persist = true) => {
    px = clamp(Math.round(px), sideMin(), 640);
    root.style.setProperty('--side-w', `${px}px`);
    Object.assign(side.dataset, { now: px });
    side.setAttribute('aria-valuenow', String(px)); side.setAttribute('aria-valuetext', `${px} pixels`); side.setAttribute('aria-valuemin', String(sideMin())); side.setAttribute('aria-valuemax', '640');
    if (persist) save('side', px);
    if (initResizers.autoStack) requestAnimationFrame(() => initResizers.autoStack()); // the work area just changed width
  };
  // The share can never go below what each pane's minimum allows, so the number shown is the real size.
  const splitBounds = () => {
    const r = $('.split').getBoundingClientRect();
    const total = stacked() ? r.height : r.width;
    if (!(total > 0)) return [15, 85];
    // Each pane's minimum is what its own content needs: side by side, the whole tab row; stacked, the
    // request bars + a few rows, the response bars + 120px of body.
    const body = $('#respBody'), col = $('.resp-col');
    const respBars = body && body.offsetHeight ? col.offsetHeight - body.offsetHeight : $('#respTabs').offsetHeight + 40 * cssScale();
    const [reqMin, respMin] = stacked() ? [120 * cssScale(), respBars + 128] : paneNeeds(); // stacked: each side keeps a usable area
    const lo = Math.max(15, (reqMin / total) * 100), hi = Math.min(85, 100 - (respMin / total) * 100);
    if (lo <= hi) return [lo, hi];
    const give = Math.max(15, 100 - (respMin / total) * 100); // both minimums can't fit: the request gives way, the response keeps its room
    return [Math.min(lo, give), Math.min(lo, give)];
  };
  const setSplit = (pct, persist = true) => {
    const [lo, hi] = splitBounds();
    pct = Math.round(clamp(pct, lo, hi) * 10) / 10;
    const key = stacked() ? 'reqH' : 'req';
    root.style.setProperty(stacked() ? '--req-h' : '--req-w', `${pct}%`);
    split.dataset.now = pct;
    split.setAttribute('aria-orientation', stacked() ? 'horizontal' : 'vertical');
    split.setAttribute('aria-valuenow', String(Math.round(pct))); split.setAttribute('aria-valuetext', `${Math.round(pct)} percent`); split.setAttribute('aria-valuemin', String(Math.round(lo))); split.setAttribute('aria-valuemax', String(Math.round(hi))); // the real limits
    if (persist) save(key, pct);
    requestAnimationFrame(() => requestAnimationFrame(() => fitTabs.resp && fitTabs.resp())); // re-fold for the new width
  };
  setSideW(layout.side || 288, false);
  setSplit((stacked() ? layout.reqH || 35 : layout.req || 50), false);
  if (layout.req) root.style.setProperty('--req-w', `${layout.req}%`);
  if (layout.reqH) root.style.setProperty('--req-h', `${layout.reqH}%`);
  matchMedia('(max-width: 600px)').addEventListener('change', () => setSplit((stacked() ? layout.reqH || 35 : layout.req || 50), false));
  window.addEventListener('resize', () => requestAnimationFrame(() => setSplit(Number(split.dataset.now) || 50, false))); // re-clamp to the new window

  const drag = (el, onMove) => el.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    el.setPointerCapture(e.pointerId);
    el.classList.add('dragging');
    document.body.classList.add('resizing');
    document.body.classList.toggle('rows', el === split && stacked());
    const end = () => {
      el.classList.remove('dragging');
      document.body.classList.remove('resizing', 'rows');
      el.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointerup', end);
      el.removeEventListener('pointercancel', end);
    };
    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);
  });
  const tip = h('div', { class: 'drag-tip', hidden: true });
  document.body.append(tip);
  const showTip = (e, text) => {
    tip.hidden = false; tip.textContent = text;
    const r = e.currentTarget && e.currentTarget.getBoundingClientRect ? e.currentTarget.getBoundingClientRect() : null;
    const rows = r && r.width > r.height; // a horizontal divider (stacked layout)
    tip.style.left = `${r && !rows ? r.right + 10 : e.clientX + 14}px`;
    tip.style.top = `${r && rows ? r.bottom + 10 : e.clientY + 14}px`;
  };
  document.addEventListener('pointerup', () => { tip.hidden = true; });
  drag(side, (e) => {
    const right = document.documentElement.dataset.side === 'right';
    setSideW(right ? innerWidth - e.clientX : e.clientX);
    showTip(e, `Sidebar ${side.dataset.now} px`);
  });
  drag(split, (e) => {
    const r = $('.split').getBoundingClientRect();
    setSplit(stacked() ? ((e.clientY - r.top) / r.height) * 100 : ((e.clientX - r.left) / r.width) * 100);
    const reqPx = Math.round((stacked() ? r.height : r.width) * Number(split.dataset.now) / 100);
    showTip(e, `${stacked() ? 'Request height' : 'Request width'} ${reqPx} px (${Math.round(split.dataset.now)}%)`);
  });
  side.addEventListener('keydown', (e) => {
    if (e.key === 'Home' || e.key === 'End') { e.preventDefault(); setSideW(e.key === 'Home' ? 0 : 640); return; } // clamped to the limits
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    e.preventDefault();
    setSideW(Number(side.dataset.now) + (e.key === 'ArrowRight' ? 1 : -1) * (e.shiftKey ? 16 : 1));
  });
  split.addEventListener('keydown', (e) => {
    const [less, more] = stacked() ? ['ArrowUp', 'ArrowDown'] : ['ArrowLeft', 'ArrowRight'];
    if (e.key === 'Home' || e.key === 'End') { e.preventDefault(); setSplit(e.key === 'Home' ? 0 : 100); return; }
    if (e.key !== less && e.key !== more) return;
    e.preventDefault();
    setSplit(Number(split.dataset.now) + (e.key === more ? 1 : -1) * (e.shiftKey ? 5 : 0.5));
  });
  side.addEventListener('dblclick', () => setSideW(288));   // double-click resets
  split.addEventListener('dblclick', () => setSplit(stacked() ? 35 : 50));
  side.title = split.title = 'Drag to resize, double-click to reset';
  initResizers.refresh = () => setSplit((stacked() ? layout.reqH || 35 : layout.req || 50), false);
  initResizers.setSide = (px) => setSideW(px);
  initResizers.showSide = () => setSideW(ls.get('apiman:layout', {}).side || 288, false);
  initResizers.snapshot = () => ({ ...ls.get('apiman:layout', {}) });
  initResizers.load = () => { // the data folder's layout replaced localStorage's
    for (const k of Object.keys(layout)) delete layout[k];
    Object.assign(layout, ls.get('apiman:layout', {}));
    if (!layout.v2) { if (!layout.reqH || layout.reqH === 50) layout.reqH = 35; layout.v2 = true; ls.set('apiman:layout', layout); }
    setSideW(layout.side || 288, false);
    root.style.setProperty('--req-w', `${layout.req || 50}%`);
    root.style.setProperty('--req-h', `${layout.reqH || 35}%`);
    initResizers.refresh();
  };
  initResizers.restore = (snap) => {
    Object.assign(layout, { side: snap.side, req: snap.req, reqH: snap.reqH });
    ls.set('apiman:layout', layout);
    setSideW(snap.side || 288, false);
    root.style.setProperty('--req-w', `${snap.req || 50}%`);
    root.style.setProperty('--req-h', `${snap.reqH || 35}%`);
    initResizers.refresh();
  };
  initResizers.paneSize = () => { const r = $('.req-col').getBoundingClientRect(); return stacked() ? r.height : r.width; };
  initResizers.splitTotal = () => { const r = $('.split').getBoundingClientRect(); return stacked() ? r.height : r.width; };
  initResizers.isStacked = stacked;
  // #6: auto-stack whenever side-by-side panes would be narrower than their content needs (text-size aware)
  const autoStack = () => {
    // Stack before any tab would be cut off: both panes' needs must fit side by side.
    const [a, b] = paneNeeds();
    const on = document.documentElement.dataset.layout !== 'stacked' && $('.work').clientWidth - 1 < a + b && !matchMedia('(max-width: 600px)').matches;
    if ((document.documentElement.dataset.autoStack === 'true') !== on) {
      if (on) document.documentElement.dataset.autoStack = 'true'; else delete document.documentElement.dataset.autoStack;
      if ($('#autoStackNote')) $('#autoStackNote').hidden = !on;
      setSplit((stacked() ? layout.reqH || 35 : layout.req || 50), false);
      refreshEditors(document);
    }
  };
  new ResizeObserver(() => requestAnimationFrame(autoStack)).observe($('.work'));
  window.addEventListener('resize', () => requestAnimationFrame(autoStack));
  requestAnimationFrame(autoStack);
  initResizers.autoStack = autoStack;
  initResizers.setSplit = (pct) => setSplit(pct);
  initResizers.sizes = () => ({ side: Number(side.dataset.now), split: Number(split.dataset.now) });
  initResizers.reset = () => { setSideW(288); layout.req = 50; layout.reqH = 35; ls.set('apiman:layout', layout); root.style.setProperty('--req-w', '50%'); root.style.setProperty('--req-h', '35%'); setSplit(stacked() ? 35 : 50); };
}

async function start() {
  applyTheme();
  initResizers();
  applyAppearance();
  bindEditor();
  bindChrome();
  $('#btnSide').addEventListener('click', () => (isPhone() ? setSide(!$('.app').classList.contains('side-open')) : toggleSidebar()));
  $$('.pane-max').forEach((b) => b.addEventListener('click', () => {
    const split = $('.split');
    const on = split.dataset.max === b.dataset.max;
    if (on) delete split.dataset.max; else split.dataset.max = b.dataset.max;
    $$('.pane-max').forEach((x) => { x.setAttribute('aria-pressed', String(!on && x === b)); x.title = !on && x === b ? 'Restore both panes' : `Maximise the ${x.dataset.max === 'req' ? 'request' : 'response'} pane`; });
    refreshEditors(document);
  }));
  // The response row measures itself: if tabs + status + button don't fit, the status gets its own line, so no tab is hidden.
  const respRow = $('#respTabs');
  const fitResp = () => {
    // One row, degrading in a fixed order: drop the reason text ("OK"), then actions become icons, then the
    // view toggle keeps only the active view (others in its More menu). Only then does the bar wrap.
    const seg = respRow.querySelector('.seg'), meta = $('#respStatus'), alt = $('#respMetaAlt'), tools = $('#respTools');
    const view = tools.querySelector(':scope > .seg');
    alt.replaceChildren(...[...meta.children].map((el) => el.cloneNode(true)));
    tools.classList.remove('wrap', 'icons', 'no-reason', 'squeeze', 'no-size', 'no-time');
    view.querySelectorAll('.ovf').forEach((b) => b.classList.remove('ovf'));
    const over = () => { // anything past the content edge (into the padding) counts as overflow
      const edge = tools.getBoundingClientRect().right - parseFloat(getComputedStyle(tools).paddingRight) + 0.5;
      return tools.scrollWidth > tools.clientWidth + 1 || [...tools.querySelectorAll(':scope > *, .tool-group > *')].some((el) => el.getClientRects().length && el.getBoundingClientRect().right > edge);
    };
    for (const step of ['no-reason', 'icons', 'no-size', 'no-time']) if (over()) tools.classList.add(step);
    if (over()) { tools.classList.add('squeeze'); fitTabs(view); tools.classList.remove('squeeze'); } // last: hide extra views, keep the rest whole
    else fitTabs(view);
    if (over()) tools.classList.add('wrap');
    fitTabs(seg);
  };
  // Toolbar actions carry an icon and a label; the label is also their accessible name when only the icon shows.
  [['#btnFindBody', 'search'], ['#btnCopyBody', 'copy'], ['#btnSaveBody', 'download']].forEach(([sel, name]) => {
    const b = $(sel), text = b.textContent.trim();
    b.setAttribute('aria-label', text);
    b.replaceChildren(icon(name), h('span', { class: 'lbl' }, text));
  });
  fitTabs.resp = fitResp;
  new ResizeObserver(fitResp).observe(respRow);
  { let w = 0; new ResizeObserver(() => { const nw = $('#respTools').clientWidth; if (nw !== w) { w = nw; requestAnimationFrame(fitResp); } }).observe($('#respTools')); }
  new MutationObserver(fitResp).observe($('#respStatus'), { childList: true, subtree: true, characterData: true });
  // Tab rows that don't fit fade at whichever edge has more tabs (and scroll), so no tab is ever silently cut off.
  const watchOverflow = (el) => {
    const update = () => {
      const over = el.scrollWidth > el.clientWidth + 1;
      el.classList.toggle('fade-right', over && el.scrollLeft + el.clientWidth < el.scrollWidth - 1);
      el.classList.toggle('fade-left', over && el.scrollLeft > 1);
    };
    new ResizeObserver(update).observe(el);
    el.addEventListener('scroll', update, { passive: true });
    update();
  };
  ['#reqTabs > .seg', '#respTabs > .seg', '.side .seg.block'].forEach((sel) => watchOverflow($(sel)));
  { const sideSeg = $('.side .seg.block'); const run = () => requestAnimationFrame(() => fitTabs(sideSeg));
    new ResizeObserver(run).observe(sideSeg.parentElement); new MutationObserver(run).observe(sideSeg, { subtree: true, attributes: true, attributeFilter: ['aria-selected'] }); }
  // Request tab row and the request sub-tab rows (body type, auth type...) collapse into a More menu.
  [$('#reqTabs > .seg'), ...$$('.req-col .pane-tools > .seg')].forEach((seg) => {
    const run = () => requestAnimationFrame(() => fitTabs(seg));
    new ResizeObserver(run).observe(seg.parentElement);
    new MutationObserver(run).observe(seg, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['aria-selected', 'aria-checked'] });
    run();
  });
  new MutationObserver(() => requestAnimationFrame(fitResp)).observe($('#respTabs > .seg'), { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['aria-selected'] });
  $$('.pane-tools .seg').forEach(watchOverflow);
  new MutationObserver(() => {
    const rows = $$('#sideBody .row');
    const keep = rows.find((r) => r.dataset.key && r.dataset.key === state.focusKey) || rows.find((r) => r.classList.contains('on')) || rows[0];
    rows.forEach((r) => { if (r.tabIndex !== (r === keep ? 0 : -1)) r.tabIndex = r === keep ? 0 : -1; });
  }).observe($('#sideBody'), { childList: true, subtree: true });
  // Sidebar tree keyboard: Up/Down move, Right/Left open/close, Space activates (Enter is handled per row).
  $('#sideBody').addEventListener('focusin', (e) => {
    const row = e.target.closest('.row');
    if (!row) return;
    state.focusKey = row.dataset.key;
    $$('#sideBody .row').forEach((r) => { r.tabIndex = r === row ? 0 : -1; });
  });
  $('#sideBody').addEventListener('keydown', (e) => {
    const row = e.target.closest('.row');
    if (!row || e.target !== row) return;
    const rows = $$('#sideBody .row');
    const i = rows.indexOf(row);
    const level = Number(row.getAttribute('aria-level') || 0);
    const expanded = row.getAttribute('aria-expanded');
    const go = (r) => { if (r) { e.preventDefault(); r.focus(); } };
    if (e.key === 'ArrowDown') go(rows[i + 1]);
    else if (e.key === 'ArrowUp') go(rows[i - 1]);
    else if (e.key === 'Home') go(rows[0]);
    else if (e.key === 'End') go(rows[rows.length - 1]);
    else if (e.key === 'ArrowRight' && expanded === 'true') go(rows[i + 1]);                      // into the first child
    else if (e.key === 'ArrowLeft' && expanded !== 'true' && level > 1) {                          // up to the parent
      go(rows.slice(0, i).reverse().find((r) => Number(r.getAttribute('aria-level')) === level - 1));
    } else if (e.key === ' ' || (e.key === 'ArrowRight' && expanded === 'false') || (e.key === 'ArrowLeft' && expanded === 'true')) {
      e.preventDefault();
      state.refocus = row.dataset.key;
      row.click();
    } else if (e.key === 'ContextMenu' || (e.key === 'F10' && e.shiftKey)) {                      // row actions menu
      const more = $$('.acts .btn', row).pop();
      if (more) { e.preventDefault(); more.click(); }
    }
  });
  document.addEventListener('keydown', (e) => {
    const tab = e.target.closest && e.target.closest('[role="tab"], [role="radio"]');
    if (!tab || !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(e.key)) return;
    const list = tab.closest('[role="tablist"], [role="radiogroup"]');
    if (!list) return;
    const tabs = $$('[role="tab"], [role="radio"]', list).filter((t) => t.closest('[role="tablist"], [role="radiogroup"]') === list && !t.hidden);
    const i = tabs.indexOf(tab);
    const fwd = e.key === 'ArrowRight' || e.key === 'ArrowDown';
    const next = e.key === 'Home' ? tabs[0] : e.key === 'End' ? tabs[tabs.length - 1] : tabs[(i + (fwd ? 1 : -1) + tabs.length) % tabs.length];
    if (!next) return;
    e.preventDefault();
    const listId = list.id;
    next.click();
    // some lists re-render on switch (the open-request strip): focus the newly selected tab in the fresh DOM
    const live = next.isConnected ? next : (listId && $(`#${listId} [aria-selected="true"], #${listId} [aria-checked="true"]`));
    if (live) live.focus();
  });
  const rovingTabs = () => $$('[role="tablist"], [role="radiogroup"]').forEach((list) => {
    const tabs = $$('[role="tab"], [role="radio"]', list).filter((t) => t.closest('[role="tablist"], [role="radiogroup"]') === list);
    const on = tabs.find((t) => t.getAttribute('aria-selected') === 'true' || t.getAttribute('aria-checked') === 'true') || tabs[0];
    tabs.forEach((t) => { t.tabIndex = t === on ? 0 : -1; });
  });
  new MutationObserver(rovingTabs).observe(document.body, { subtree: true, attributes: true, attributeFilter: ['aria-selected', 'aria-checked'], childList: true });
  rovingTabs();
  document.addEventListener('keydown', (e) => {
    if (!(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== 'f' || e.altKey || $('#dlg').open) return;
    if (e.target.closest && e.target.closest('.CodeMirror') && !e.target.closest('#respBody')) return; // request editors keep their own find
    if ($('#respTools').hidden || $('#respTools').classList.contains('no-body')) return;
    e.preventDefault();
    if ($('.resp-col .tab.on')?.dataset.tab !== 'rbody') $('#tab-rbody').click();
    openFind();
  });
  $('#tabstrip').addEventListener('contextmenu', (e) => {
    const tab = e.target.closest('.rtab');
    if (!tab) return;
    e.preventDefault();
    const i = [...$$('#tabstrip .rtab')].indexOf(tab);
    showMenu(tab, [
      { label: 'Duplicate tab', onClick: () => { const t = state.tabs[i]; openTab(newTab({ ed: { ...JSON.parse(JSON.stringify(t.ed)), name: `${t.ed.name} copy` }, dirty: true })); } },
      ...(state.tabs[i].cid ? [{ label: 'Reveal in sidebar', onClick: () => { const t = state.tabs[i]; state.view = 'collections'; state.open.add(t.cid); openCategory(folderOf(state.colList, t.cid)); renderSidebar(); requestAnimationFrame(() => { const row = $(`#sideBody [data-key="r:${t.cid}:${t.itemId}"]`) || $$('#sideBody .row.on')[0]; if (row) { row.scrollIntoView({ block: 'nearest' }); row.focus(); } }); } }] : []),
      '-',
      { label: 'Close tab', onClick: () => closeTab(i) },
      { label: 'Close other tabs', onClick: async () => { const keep = state.tabs[i]; for (let j = state.tabs.length - 1; j >= 0; j--) if (state.tabs[j] !== keep) await closeTab(j); } },
      { label: 'Close all tabs', onClick: async () => { for (let j = state.tabs.length - 1; j >= 0; j--) await closeTab(j); } },
    ]);
  });
  $('#tabstrip').addEventListener('keydown', (e) => { // Shift+F10 / the menu key open the same menu
    const tab = e.target.closest('.rtab');
    if (!tab || !(e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10'))) return;
    e.preventDefault();
    const r = tab.getBoundingClientRect();
    tab.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: r.left + 8, clientY: r.bottom }));
  });
  $('#sideBody').addEventListener('contextmenu', (e) => {
    const btn = e.target.closest('.row')?.querySelector('.acts button[aria-label="More actions"]');
    if (!btn) return;
    e.preventDefault();
    btn.click(); // same menu as the row's More actions button
    showMenu.anchor = e.target.closest('.row'); // Escape returns focus to the row, not the hidden button
  });
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || $('#findBar').hidden || $('#dlg').open || !$('#popover').hidden || e.defaultPrevented) return;
    if (!e.target.closest || !e.target.closest('.resp-col')) return;
    e.preventDefault(); closeFind();
  });
  document.addEventListener('keydown', (e) => {
    const dlg = $('#dlg');
    if (e.key !== 'Escape' || !dlg.open || !dlg.classList.contains('docked') || !$('#popover').hidden) return;
    if (e.target.closest && e.target.closest('.CodeMirror')) return;
    e.preventDefault(); closeDialog();
  });
  // Phones: Escape closes the open sidebar drawer.
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || $('#dlg').open || !$('#popover').hidden || !$('.app').classList.contains('side-open')) return;
    setSide(false); $('#btnSide').focus();
  });
  { const strip = $('#tabstrip'), upd = () => {
      strip.classList.toggle('fade-left', strip.scrollLeft > 1);
      const sr = strip.getBoundingClientRect(), pinned = [...strip.querySelectorAll('.newtab')].reduce((w, b) => w + b.offsetWidth, 0);
      strip.querySelectorAll('.rtab').forEach((t) => { const r = t.getBoundingClientRect(); t.classList.toggle('clipped', r.left < sr.left - 1 || r.right > sr.right - pinned + 1); });
    };
    new MutationObserver(upd).observe(strip, { childList: true });
    strip.addEventListener('scroll', upd, { passive: true }); new ResizeObserver(upd).observe(strip); }
  // The active request tab stays in view when the strip or the text size changes.
  new ResizeObserver(() => { const on = $('#tabstrip .rtab.on'); if (on) on.scrollIntoView({ block: 'nearest', inline: 'nearest' }); }).observe($('#tabstrip'));
  // Maximised pane: Escape restores both panes.
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || $('#dlg').open || !$('.split').dataset.max) return;
    if (e.target.closest && e.target.closest('.CodeMirror')) return; // Esc there leaves the editor first
    const btn = $(`.pane-max[data-max="${$('.split').dataset.max}"]`);
    if (btn) btn.click();
  });
  // Menus: Up/Down between items, Escape closes and returns focus.
  $('#popover').addEventListener('keydown', (e) => {
    const items = $$('#popover .mi');
    const i = items.indexOf(document.activeElement);
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const next = items[(i + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length];
      if (next) next.focus();
    } else if (e.key === 'Escape') { e.preventDefault(); hideMenu(true); }
  });
  // The close event fires a moment after close(); remember WHICH dialog was closing, so a dialog
  // opened in between never receives the previous one's close (and never gets cancelled by it).
  const dlgEl = $('#dlg');
  const nativeClose = dlgEl.close.bind(dlgEl);
  dlgEl.close = (...a) => { closingSeq = dialogSeq; nativeClose(...a); };
  dlgEl.addEventListener('cancel', (e) => { if (dlgEl.dataset.locked) { e.preventDefault(); return; } closingSeq = dialogSeq; });
  dlgEl.addEventListener('submit', (e) => { if (e.submitter && e.submitter.value === 'cancel') closingSeq = dialogSeq; });
  $('#dlg').addEventListener('close', () => {
    if ($('#dlg').dataset.reshowing) { delete $('#dlg').dataset.reshowing; return; } // switching between docked and overlay, not closing (the event fires later)
    document.documentElement.classList.remove('drawer-open', 'drawer-over'); // the app takes the full width again
    $('#dlg').classList.remove('docked');
    requestAnimationFrame(() => initResizers.refresh && initResizers.refresh());
    requestAnimationFrame(() => requestAnimationFrame(() => fitTabs.resp && fitTabs.resp()));
    const seq = closingSeq ?? dialogSeq;
    closingSeq = null;
    const cb = dialogCloses.get(seq);
    dialogCloses.delete(seq);
    if (cb) cb();
    if (dialogQueue.length) setTimeout(() => { if (!$('#dlg').open && dialogQueue.length) renderDialog(dialogQueue.shift()); }, 0);
  });
  // Enter inside a dialog field must not submit (and close) the dialog; only the ✕ button closes it.
  $('#dlg form').addEventListener('submit', (e) => { if (!e.submitter || e.submitter.value !== 'cancel') e.preventDefault(); });
  let local = false;
  if (isLocalHost(location.hostname)) { // only the local server has an API; don't probe e.g. github.io
    try { local = !!(await api('GET', '/api/info')).dataDir; } catch { /* static copy served locally: website mode */ }
  }

  const badge = $('#modeBadge');
  if (local) {
    backend = makeBackend('local');
    badge.textContent = 'Local';
    badge.className = 'pill ok';
    badge.title = 'Requests go out from this computer, through your VPN, with no CORS limits.';
    const info = await api('GET', '/api/info');
    state.dataDir = info.dataDir;
    $('#btnRunner').setAttribute('aria-haspopup', 'menu'); // local mode: Run opens a menu with Automation
    // one line: "Data folder: …/end/of/the/path", the whole path in the tooltip
    $('#dataDir').replaceChildren(h('span', null, 'Data folder:'), ' ', h('span', { class: 'dd-path', title: info.dataDir }, h('bdi', null, info.dataDir)));
  } else {
    backend = makeBackend('browser');
    badge.textContent = 'Browser';
    badge.className = 'pill';
    badge.title = 'Requests are sent by this browser, so the API must allow CORS. Run ApiMan locally to call any API.';
    state.settings.insecure = false;
    const shared = /\.github\.io$/.test(location.hostname)
      ? ` Note: every site on ${location.hostname} can read this browser storage, so keep real secrets in local mode (python3 server.py) or a folder.` : '';
    $('#dataDir').textContent = window.showDirectoryPicker
      ? `Saved in this browser.${shared}`
      : `Saved in this browser. To keep your data in a folder on this computer, open ApiMan in Chrome or Edge, or run it locally (python3 server.py).${shared}`;
    if (window.showDirectoryPicker) {
      const btn = $('#btnFolder');
      btn.hidden = false;
      btn.onclick = () => pickFolder().catch((e) => e.name !== 'AbortError' && toast(e.message, 'err'));
      let dir = await idbHandle('get').catch(() => null);
      renderAll(); // the app is drawn (empty) behind the question below, not a blank page
      let browserOnly = false;
      try { browserOnly = sessionStorage.getItem('apiman:browserOnly') === '1'; } catch { /* ask */ }
      if (dir && (await dir.queryPermission({ mode: 'readwrite' }).catch(() => 'denied')) !== 'granted') {
        const remembered = dir;
        btn.textContent = `Reconnect folder "${remembered.name}"`;
        btn.onclick = async () => { if ((await remembered.requestPermission({ mode: 'readwrite' })) === 'granted') await useFolder(remembered); };
        dir = browserOnly ? null : await askDataFolder(remembered);
      } else if (!dir && !browserOnly) {
        dir = await askDataFolder(null);
      }
      if (dir) await useFolder(dir, { starting: true });
    }
  }
  if (!backend.dir) await workspace.load(); // local mode: the server's data folder; browser storage: nothing to read
  window.addEventListener('pagehide', () => workspace.flush({ unloading: true })); // after writeTabs (bindChrome)
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') workspace.flush({ unloading: true }); });
  try {
    await Promise.all([refreshCollections(), refreshEnvironments()]);
    await restoreTabs();
  } catch (e) {
    toast(`Couldn't load your data: ${e.message}`, 'err');
  }
  renderEnvPicker();
  renderAll();
  if (local) {
    const info = await api('GET', '/api/info').catch(() => ({}));
    if (info.run) headlessRun(info.run); // started by `python3 server.py run`
    watchDataFolder();
    // Automation's own page: opened from "Open in new window", a bookmark or a reload; typing #automation opens it too
    const openAuto = () => { if (location.hash === '#automation' && !$('#dlg').open) openAutomation().catch((e) => toast(e.message, 'err')); };
    window.addEventListener('hashchange', openAuto);
    openAuto();
  }
}

start();
