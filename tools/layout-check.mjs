// ApiMan layout check: drives the real app through every width / sidebar / layout / text / density /
// divider combination and asserts the layout rules a reviewer checks by hand. Read-only: it never saves.
//
//   PLAYWRIGHT=/path/to/node_modules/playwright CHROMIUM=/path/to/Chromium node tools/layout-check.mjs
//
// Needs ApiMan running (python3 server.py) and a large JSON served somewhere (BIG_URL) to test scrolling.
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT || 'playwright');
const APP = process.env.APP || 'http://127.0.0.1:5577/';
const BIG_URL = process.env.BIG_URL || 'http://127.0.0.1:18765/big.json';
const ONLY = process.env.ONLY; // e.g. ONLY=1280 to run one width

const WIDTHS = [[1440, 900], [1366, 768], [1280, 800], [1024, 768], [390, 844]].filter(([w]) => !ONLY || String(w) === ONLY);
const SIDES = ['left', 'right'];
const LAYOUTS = ['auto', 'stacked'];
const SCALES = [[1, 1], [0.8, 0.75], [1.5, 1.4], [1.5, 0.75], [0.8, 1.4]]; // [text, density] at the Settings extremes
const SPLITS = ['default', 'Home', 'End'];

const browser = await chromium.launch(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {});
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const pageErrors = [];
page.on('pageerror', (e) => pageErrors.push(e.message));
await page.goto(APP);
await page.waitForSelector('button.newtab');

// One unsaved scratch tab with a large JSON response (never saved).
await page.click('button.newtab');
await page.fill('#url', BIG_URL);
await page.click('#btnSend');
await page.waitForFunction(() => /\d{3}/.test(document.querySelector('#respStatus').textContent), null, { timeout: 15000 });
await page.waitForTimeout(300);

// Every rule runs in the page and returns a list of failure strings.
const measure = () => page.evaluate(() => {
  const fails = [];
  const vis = (el) => el && el.getClientRects().length && getComputedStyle(el).visibility !== 'hidden';
  const R = (el) => el.getBoundingClientRect();
  const name = (el) => (el.id ? `#${el.id}` : `${el.tagName.toLowerCase()}.${[...el.classList].join('.')}`) + (el.textContent.trim() ? ` "${el.textContent.trim().slice(0, 18)}"` : '');
  const phone = innerWidth <= 820;
  const stacked = document.documentElement.dataset.layout === 'stacked' || document.documentElement.dataset.autoStack === 'true' || innerWidth <= 1180;
  const de = document.documentElement;

  // 1. page never scrolls sideways; desktop never scrolls at all
  if (de.scrollWidth > innerWidth + 1) fails.push(`page scrolls sideways (${de.scrollWidth} > ${innerWidth})`);
  if (!phone && de.scrollHeight > innerHeight + 1) fails.push(`page scrolls vertically (${de.scrollHeight} > ${innerHeight})`);

  // 2. controls are never cut off (text wider than the control, or the control outside the viewport)
  for (const el of document.querySelectorAll('.btn, .tab, .seg-btn, .send, select, .mtag, label, .crumb, h1, h2')) {
    if (!vis(el) || el.matches('.sr-only') || el.closest('.tabstrip, .CodeMirror, dialog:not([open]), [hidden], .side-body, table')) continue;
    const r = R(el);
    if (el.scrollWidth > el.clientWidth + 1 && getComputedStyle(el).overflow !== 'visible' && !el.matches('select, .crumb')) fails.push(`text cut in ${name(el)} (${el.scrollWidth}>${el.clientWidth})`);
    if (r.right > innerWidth + 0.5 || r.left < -0.5) fails.push(`${name(el)} outside viewport (${Math.round(r.left)}..${Math.round(r.right)})`);
  }
  // 3. tab groups and segmented controls show every option
  for (const seg of document.querySelectorAll('.seg')) {
    if (!vis(seg) || seg.closest('dialog:not([open])')) continue;
    if (seg.scrollWidth > seg.clientWidth + 1) fails.push(`segmented control clipped ${seg.closest('[id]')?.id || ''} (${seg.scrollWidth}>${seg.clientWidth})`);
  }
  // 4. no overlapping siblings in the bars
  for (const bar of document.querySelectorAll('.top, .titlebar, #reqTabs, #respTabs, #respTools, .pane-tools, .reqbar, .tool-group')) {
    if (!vis(bar)) continue;
    const kids = [...bar.children].filter((k) => vis(k) && R(k).width > 1 && !k.matches('.spacer'));
    for (let i = 0; i < kids.length; i++) for (let j = i + 1; j < kids.length; j++) {
      const a = R(kids[i]), b = R(kids[j]);
      const ox = Math.min(a.right, b.right) - Math.max(a.left, b.left), oy = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
      if (ox > 1 && oy > 1) fails.push(`overlap in ${name(bar)}: ${name(kids[i])} / ${name(kids[j])}`);
    }
    // children never spill out of their bar
    const br = R(bar);
    // ...and stay inside its content box: crossing into the padding breaks the alignment with the content below
    const pad = parseFloat(getComputedStyle(bar).paddingRight) || 0;
    const inner = bar.matches('#respTools, .pane-tools') ? [...kids, ...bar.querySelectorAll('.tool-group > *')].filter((k) => vis(k) && R(k).width > 1) : kids;
    for (const k of inner) { const r = R(k); if (r.right > br.right - pad + 1 || r.bottom > br.bottom + 1) fails.push(`${name(k)} spills out of ${name(bar)}`); }
  }
  // 5. side by side: both tab rows share one height, and the maximise buttons sit at the same inset
  if (!stacked && !phone) {
    const a = R(document.querySelector('#reqTabs')).height, b = R(document.querySelector('#respTabs')).height;
    if (Math.abs(a - b) > 0.5) fails.push(`tab rows differ: ${a} vs ${b}`);
  }
  const gaps = ['.req-col', '.resp-col'].map((c) => { const col = document.querySelector(c), m = col && col.querySelector('.pane-max'); return m && vis(m) ? Math.round(R(col).right - R(m).right) : null; }).filter((x) => x != null);
  if (gaps.length === 2 && gaps[0] !== gaps[1]) fails.push(`maximise insets differ: ${gaps.join(' vs ')}`);
  // 6. the response scrolls inside its own panel and keeps a usable height
  const body = document.querySelector('#respBody'), rb = R(body);
  const scroller = body.querySelector('.CodeMirror-scroll') || body;
  if (!phone && rb.bottom > innerHeight + 1) fails.push(`response body runs past the window (${Math.round(rb.bottom)})`);
  if (phone && rb.height > innerHeight * 0.7 + 2) fails.push(`phone response not capped (${Math.round(rb.height)})`);
  if (scroller.scrollHeight <= scroller.clientHeight && body.scrollHeight <= body.clientHeight) fails.push('large response does not scroll inside its panel');
  if (rb.height < 120) fails.push(`response body only ${Math.round(rb.height)}px tall`);
  // 7. readable text and clickable targets
  // the divider really resizes: a sane range, never inverted
  const sp = document.querySelector('#splitResizer'), mn = +sp.getAttribute('aria-valuemin'), mx = +sp.getAttribute('aria-valuemax');
  if (mn > mx) fails.push(`divider range inverted ${mn}>${mx}`);
  if (!phone && !stacked && innerWidth >= 1280 && parseFloat(getComputedStyle(de).getPropertyValue('--text-scale')) <= 1 && mx - mn < 25) fails.push(`divider range only ${mn}-${mx}%`);
  for (const el of document.querySelectorAll('.btn, .tab, .seg-btn, .rtab, button.x, .pane-max')) {
    if (!vis(el) || el.closest('dialog:not([open]), [hidden]')) continue;
    const r = R(el);
    if (r.height < 23.5) fails.push(`small target ${name(el)} ${Math.round(r.width)}x${Math.round(r.height)}`);
  }
  for (const el of document.querySelectorAll('.app *')) {
    if (!el.childNodes.length || ![...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim()) || !vis(el)) continue;
    const fs = parseFloat(getComputedStyle(el).fontSize);
    if (fs < 9.5) { fails.push(`tiny text ${fs}px in ${name(el)}`); break; }
  }
  return fails;
});

const apply = (side, layout, [text, density]) => page.evaluate(([side, layout, text, density]) => {
  Object.assign(state.settings, { sidePosition: side, layout, textScale: text, densityScale: density, theme: 'dark' });
  applyAppearance(state.settings);
}, [side, layout, text, density]);

const results = new Map(); // failure text -> combos
let combos = 0;
for (const [w, h] of WIDTHS) {
  await page.setViewportSize({ width: w, height: h });
  for (const side of SIDES) for (const layout of LAYOUTS) for (const sc of SCALES) for (const split of SPLITS) {
    if (w <= 820 && (layout === 'stacked' || split !== 'default')) continue; // phones are always one column
    await apply(side, layout, sc);
    await page.evaluate(() => document.querySelector('#splitResizer').dispatchEvent(new MouseEvent('dblclick', { bubbles: true })));
    if (split !== 'default') { await page.focus('#splitResizer'); await page.keyboard.press(split); }
    await page.waitForTimeout(120);
    const fails = await measure();
    combos++;
    const tag = `${w} ${side} ${layout} text${sc[0]} dens${sc[1]} ${split}`;
    for (const f of fails) { const key = f.replace(/\d+(\.\d+)?/g, '#'); if (!results.has(key)) results.set(key, { example: f, combos: [] }); results.get(key).combos.push(tag); }
  }
}

// Settings dialog at every width and the extreme text sizes: nothing cut, nothing overlapping.
for (const [w, h] of WIDTHS) for (const sc of [[1, 1], [1.3, 1.25]]) {
  await page.setViewportSize({ width: w, height: h });
  await apply('left', 'auto', sc);
  await page.click('#btnSettings');
  await page.waitForSelector('#dlg[open]');
  const fails = await page.evaluate(() => {
    const out = [], dlg = document.querySelector('#dlg'), d = dlg.getBoundingClientRect();
    if (d.right > innerWidth + 0.5 || d.bottom > innerHeight + 0.5) out.push('dialog larger than the window');
    for (const row of dlg.querySelectorAll('.slider-row, .field-row, .grid-2, .grid-3, .seg, .dlg-foot, #dlgFoot')) {
      const kids = [...row.children].filter((k) => k.getClientRects().length);
      const rr = row.getBoundingClientRect();
      for (const k of kids) { const r = k.getBoundingClientRect(); if (r.right > rr.right + 1) out.push(`settings: ${k.tagName.toLowerCase()}.${k.className} spills out of ${row.className || row.id}`); }
      for (let i = 0; i < kids.length; i++) for (let j = i + 1; j < kids.length; j++) {
        const a = kids[i].getBoundingClientRect(), b = kids[j].getBoundingClientRect();
        if (Math.min(a.right, b.right) - Math.max(a.left, b.left) > 1 && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 1) out.push(`settings overlap in ${row.className || row.id}`);
      }
    }
    for (const el of dlg.querySelectorAll('.btn, .seg-btn, label, .label')) if (el.getClientRects().length && el.scrollWidth > el.clientWidth + 1 && getComputedStyle(el).overflow !== 'visible') out.push(`settings: text cut in "${el.textContent.trim().slice(0, 20)}"`);
    return out;
  });
  await page.keyboard.press('Escape');
  await page.waitForTimeout(100);
  combos++;
  for (const f of fails) { const key = f; if (!results.has(key)) results.set(key, { example: f, combos: [] }); results.get(key).combos.push(`${w} settings text${sc[0]}`); }
}

// Contrast of every visible text node against its effective background, light and dark, default settings.
const contrast = (theme) => page.evaluate((theme) => {
  Object.assign(state.settings, { theme, textScale: 1, densityScale: 1, sidePosition: 'left', layout: 'auto' });
  applyAppearance(state.settings);
  document.documentElement.dataset.theme = theme;
  const parse = (c) => { const m = c.match(/[\d.]+/g); return m ? m.map(Number) : [0, 0, 0, 0]; };
  const ctx = document.createElement('canvas').getContext('2d');
  const rgb = (c) => { ctx.fillStyle = '#000'; ctx.fillStyle = c; const s = ctx.fillStyle; if (s.startsWith('#')) return [parseInt(s.slice(1, 3), 16), parseInt(s.slice(3, 5), 16), parseInt(s.slice(5, 7), 16), 1]; const v = parse(s); return [v[0], v[1], v[2], v[3] ?? 1]; };
  const lum = ([r, g, b]) => { const f = (x) => { x /= 255; return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
  const bgOf = (el) => { for (let e = el; e; e = e.parentElement) { const c = rgb(getComputedStyle(e).backgroundColor); if (c[3] > 0.5) return c; } return rgb(getComputedStyle(document.body).backgroundColor); };
  const out = [];
  for (const el of document.querySelectorAll('body *')) {
    if (!el.getClientRects().length || el.closest('[hidden], dialog:not([open]), [aria-hidden="true"]') || el.matches(':disabled, [aria-disabled="true"]')) continue;
    if (![...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())) continue;
    const cs = getComputedStyle(el);
    if (cs.visibility === 'hidden' || Number(cs.opacity) < 0.5) continue;
    const fg = rgb(cs.color), bg = bgOf(el);
    const a = fg[3] < 1 ? fg.map((v, i) => (i < 3 ? v * fg[3] + bg[i] * (1 - fg[3]) : 1)) : fg;
    const [L1, L2] = [lum(a), lum(bg)].sort((x, y) => y - x);
    const ratio = (L1 + 0.05) / (L2 + 0.05);
    const large = parseFloat(cs.fontSize) >= 18.6 || (parseFloat(cs.fontSize) >= 14 && Number(cs.fontWeight) >= 700);
    if (ratio < (large ? 3 : 4.5)) out.push(`${theme}: contrast ${ratio.toFixed(2)} "${el.textContent.trim().slice(0, 20)}" (${el.className || el.tagName})`);
  }
  return [...new Set(out)].slice(0, 30);
}, theme);
await page.setViewportSize({ width: 1440, height: 900 });
for (const theme of ['light', 'dark']) for (const f of await contrast(theme)) results.set(f, { example: f, combos: ['contrast'] });

// Keyboard focus is always visible: Tab through the first 60 stops and compare focused vs unfocused look.
const focusFails = await page.evaluate(async () => {
  const out = [];
  const stops = [...document.querySelectorAll('a[href], button, input, select, textarea, [tabindex="0"]')].filter((el) => el.getClientRects().length && !el.disabled && !el.closest('[hidden], dialog:not([open])')).slice(0, 80);
  for (const el of stops) {
    const before = (() => { const c = getComputedStyle(el); return [c.outlineStyle, c.outlineWidth, c.boxShadow, c.borderColor, c.backgroundColor].join('|'); })();
    el.focus({ focusVisible: true });
    const host = el.closest('.reqbar') || el;
    const c = getComputedStyle(el), hc = getComputedStyle(host);
    const after = [c.outlineStyle, c.outlineWidth, c.boxShadow, c.borderColor, c.backgroundColor].join('|');
    const ring = (c.outlineStyle !== 'none' && parseFloat(c.outlineWidth) >= 1.5) || hc.boxShadow !== 'none' && host !== el || c.boxShadow !== 'none';
    if (!ring && before === after && !el.closest('.CodeMirror') && !el.matches('.resizer')) /* resizers draw their focus line in ::after */ out.push(`no visible focus on ${el.id ? '#' + el.id : el.tagName.toLowerCase() + '.' + el.className}`);
  }
  return out;
}).catch((e) => [`focus check failed: ${e.message}`]);
for (const f of focusFails) results.set(f, { example: f, combos: ['focus'] });

await browser.close();
console.log(`${combos} combinations checked`);
if (pageErrors.length) console.log('PAGE ERRORS:\n  ' + [...new Set(pageErrors)].join('\n  '));
if (!results.size && !pageErrors.length) { console.log('PASS: no layout failures'); process.exit(0); }
for (const [, { example, combos: c }] of [...results].sort((a, b) => b[1].combos.length - a[1].combos.length)) {
  console.log(`FAIL x${c.length}: ${example}\n    e.g. ${c.slice(0, 4).join(' | ')}`);
}
process.exit(1);
