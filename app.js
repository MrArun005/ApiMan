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

const uid = () => (crypto.randomUUID ? crypto.randomUUID()
  : 'id-' + Math.random().toString(36).slice(2) + Date.now().toString(36));

function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => t.classList.remove('show'), 2200);
}

const ls = {
  get(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch { return false; } },
};

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
  theme: 'system', timeout: 60, followRedirects: true, history: true, insecure: false,
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
    if (el.closest('.code-editor.fill')) cm.setOption('lineWrapping', s.wrap !== false);
  });
  document.querySelectorAll('.CodeMirror').forEach((el) => el.CodeMirror && el.CodeMirror.refresh());
  root.dataset.layout = s.layout === 'stacked' ? 'stacked' : 'auto';
  root.dataset.wrap = s.wrap === false ? 'off' : 'on';
  if (initResizers.autoStack) initResizers.autoStack();
  if (initResizers.refresh) initResizers.refresh();
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
    create: async (d) => (await api('POST', base, { document: d })).id,
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
    async list() { return Object.entries(read()).map(([id, d]) => ({ id, name: nameOf(d) })).sort((a, b) => a.name.localeCompare(b.name)); },
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

function folderStore(rootDir, kind) {
  const { validate, nameOf } = KINDS[kind];
  const dirP = kind === 'collections' ? Promise.resolve(rootDir) : rootDir.getDirectoryHandle('environments', { create: true });
  const files = async () => {
    const dir = await dirP;
    const out = [];
    for await (const [name, handle] of dir.entries()) if (handle.kind === 'file' && name.endsWith('.json')) out.push(name);
    return out;
  };
  const read = async (id) => JSON.parse(await (await (await (await dirP).getFileHandle(id)).getFile()).text());
  const write = async (id, d) => {
    const w = await (await (await dirP).getFileHandle(id, { create: true })).createWritable();
    await w.write(JSON.stringify(d, null, 2));
    await w.close();
  };
  return {
    async list() {
      const out = [];
      for (const id of await files()) {
        try { out.push({ id, name: nameOf(await read(id)) }); } catch { out.push({ id, name: `${id} (unreadable)` }); }
      }
      return out.sort((a, b) => a.name.localeCompare(b.name));
    },
    get: read,
    async put(id, d) { validate(d); await write(id, d); },
    async create(d) { validate(d); const names = new Set((await files()).map((f) => f.toLowerCase())); const id = newDocId(nameOf(d), (x) => names.has(x)); await write(id, d); return id; },
    remove: async (id) => (await dirP).removeEntry(id),
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
    timeout: state.settings.timeout, followRedirects: state.settings.followRedirects, insecure: state.settings.insecure,
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
      credentials: 'omit', redirect: state.settings.followRedirects && !carriesSecrets ? 'follow' : 'manual', signal: sig,
    });
  } catch (e) {
    if (e.name === 'TimeoutError') return { error: `No response within ${state.settings.timeout} s.` };
    if (e.name === 'AbortError') return { error: 'Request cancelled.' };
    return { error: `The browser couldn't complete this request. Either ${target.host} doesn't allow cross-site requests (CORS), `
      + 'or it isn\'t reachable from here. Run ApiMan locally (python3 server.py) to call any API without CORS limits.' };
  }
  if (r.type === 'opaqueredirect') {
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

let backend = null; // { mode, collections, environments, send }

function makeBackend(mode, dir) {
  if (mode === 'local') return { mode, collections: serverStore('collections'), environments: serverStore('environments'), send: serverSend };
  if (dir) return { mode, dir, collections: folderStore(dir, 'collections'), environments: folderStore(dir, 'environments'), send: browserSend };
  return { mode, collections: browserStore('collections'), environments: browserStore('environments'), send: browserSend };
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

function scopesFor(cid) {
  return {
    globals: envObj(state.envs[GLOBALS_ID]),
    collection: colObj(cid && state.cols[cid]),
    environment: envObj(state.activeEnv && state.envs[state.activeEnv]),
    local: {},
  };
}
const merged = (sc) => ({ ...sc.globals, ...sc.collection, ...sc.environment, ...sc.local });

const FIRST = ['Ada', 'Lin', 'Sam', 'Ravi', 'Mia', 'Noah', 'Zoe', 'Omar'];
function dynamicVar(name) {
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
  for (let pass = 0; pass < 4 && s.includes('{{'); pass++) {
    const next = s.replace(VAR_RE, (m, k) => (Object.hasOwn(vars, k) ? vars[k] : (dynamicVar(k) ?? m)));
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

const PM_WORKER = String.raw`
'use strict';
self.onmessage = async (e) => {
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
  const all = () => Object.assign({}, V.globals, V.collection, V.environment, V.local);
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

  const pm = {
    environment: scope(V.environment, { name: ctx.envName }),
    collectionVariables: scope(V.collection),
    globals: scope(V.globals),
    variables: {
      get: (k) => { const a = all(); return a[k]; }, set: (k, v) => { V.local[k] = str(v); }, unset: (k) => { delete V.local[k]; },
      has: (k) => own(all(), k), toObject: all, replaceIn,
    },
    request, response,
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
    sendRequest: () => { throw new Error('pm.sendRequest is disabled: scripts in ApiMan cannot make network requests of their own.'); },
  };
  pm.test.skip = (name) => tests.push({ name: String(name), passed: null, error: 'skipped' });

  const legacyTests = {};
  const postman = {
    setEnvironmentVariable: pm.environment.set, getEnvironmentVariable: pm.environment.get, clearEnvironmentVariable: pm.environment.unset,
    setGlobalVariable: pm.globals.set, getGlobalVariable: pm.globals.get, clearGlobalVariable: pm.globals.unset,
  };
  const req2 = (m) => { throw new Error("require('" + m + "') isn't available in ApiMan scripts."); };

  let error = '';
  try {
    const fn = new Function('pm', 'console', 'postman', 'tests', 'responseBody', 'responseCode', 'responseTime', 'require', '"use strict";\n' + code);
    const r = fn(pm, cons, postman, legacyTests, ctx.response ? ctx.response.body : undefined,
      ctx.response ? { code: ctx.response.code, name: ctx.response.status } : undefined, ctx.response ? ctx.response.responseTime : undefined, req2);
    if (r && typeof r.then === 'function') await r;
    await Promise.all(pending);
  } catch (err) {
    error = String(err && err.message || err);
  }
  for (const [name, ok] of Object.entries(legacyTests)) tests.push({ name, passed: !!ok, error: ok ? '' : 'failed' });
  postMessage({ vars: V, request: req, tests, logs, error });
};`;

const SANDBOX_FRAME = `<!doctype html><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval'; worker-src data:">
<script>
onmessage = (e) => {
  if (e.source !== parent) return;
  const { workerSrc, code, ctx, timeoutMs } = e.data;
  let w;
  try { w = new Worker('data:text/javascript,' + encodeURIComponent(workerSrc)); }
  catch (err) { parent.postMessage({ fatal: 'Could not start the script sandbox: ' + err.message }, '*'); return; }
  const timer = setTimeout(() => { w.terminate(); parent.postMessage({ fatal: 'Script stopped after ' + (timeoutMs / 1000) + ' s (possible infinite loop).' }, '*'); }, timeoutMs);
  w.onmessage = (m) => { clearTimeout(timer); w.terminate(); parent.postMessage(m.data, '*'); };
  w.onerror = (m) => { clearTimeout(timer); w.terminate(); parent.postMessage({ fatal: 'Script error: ' + m.message }, '*'); m.preventDefault(); };
  w.postMessage({ code, ctx });
};
<\/script>`;

const cleanStrMap = (o) => Object.fromEntries(Object.entries(o && typeof o === 'object' ? o : {})
  .filter(([k]) => typeof k === 'string' && k.length < 300).map(([k, v]) => [k, String(v ?? '').slice(0, 100000)]));

/** Runs one script in the sandbox. Everything coming back is treated as untrusted data. */
function runScript(code, ctx) {
  return new Promise((resolve) => {
    const frame = h('iframe', { sandbox: 'allow-scripts', hidden: true, title: 'script sandbox' });
    frame.srcdoc = SANDBOX_FRAME;
    let done = false;
    const finish = (data) => {
      if (done) return;
      done = true;
      window.removeEventListener('message', onMsg);
      frame.remove();
      if (!data || data.fatal) {
        resolve({ vars: ctx.vars, request: ctx.request, tests: [], logs: [], error: (data && String(data.fatal)) || 'Script sandbox failed.' });
        return;
      }
      const vars = data.vars || {};
      const rq = data.request && typeof data.request === 'object' ? data.request : ctx.request;
      resolve({
        vars: { globals: cleanStrMap(vars.globals), collection: cleanStrMap(vars.collection), environment: cleanStrMap(vars.environment), local: cleanStrMap(vars.local) },
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
      });
    };
    const onMsg = (e) => { if (e.source === frame.contentWindow) finish(e.data); };
    window.addEventListener('message', onMsg);
    frame.addEventListener('load', () => frame.contentWindow.postMessage({ workerSrc: PM_WORKER, code, ctx, timeoutMs: SCRIPT_TIMEOUT_MS }, '*'));
    setTimeout(() => finish({ fatal: 'Script sandbox did not respond.' }), SCRIPT_TIMEOUT_MS + 2000);
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
  const auth = authInfo.auth;

  if (auth.type === 'bearer' && auth.token && !has('authorization')) { headers.push(['Authorization', 'Bearer ' + r(auth.token)]); checks.push(auth.token); }
  if (auth.type === 'basic' && (auth.username || auth.password) && !has('authorization')) {
    headers.push(['Authorization', 'Basic ' + utf8b64(`${r(auth.username)}:${r(auth.password)}`)]);
    checks.push(auth.username, auth.password);
  }
  if (auth.type === 'apikey' && auth.key) {
    if (auth.in === 'query') {
      try { const u = new URL(url); u.searchParams.append(r(auth.key), r(auth.value)); url = u.toString(); } catch { /* reported below */ }
    } else if (!has(r(auth.key).toLowerCase())) headers.push([r(auth.key), r(auth.value)]);
    checks.push(auth.key, auth.value);
  }

  const b = ed.body;
  let body = { kind: 'none' };
  const setCT = (ct) => { if (!has('content-type')) headers.push(['Content-Type', ct]); };
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
  if (missingVars.length) {
    return { error: `Unknown variable${missingVars.length > 1 ? 's' : ''} ${missingVars.map((v) => `{{${v}}}`).join(', ')}. Define ${missingVars.length > 1 ? 'them' : 'it'} in the environment, the collection, or Globals.` };
  }
  try { new URL(url); } catch { return { error: `"${url}" isn't a valid URL.` }; }
  return { wire: { method: req.method, url, headers, body } };
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
      }, [], (parents) => parents.forEach((f) => hostHeaders.push(...authParts(f.auth))));
      hostHeaders.push(...authParts(col.auth));
    } catch (e) {
      if (!/Not a Postman v2 collection/.test(e.message)) complete = false; // a stray non-collection .json isn't a gap
    }
  }
  for (const t of state.tabs) {
    urls.push({ label: `${t.ed.name} (open tab)`, url: t.ed.url, colId: t.cid });
    hostHeaders.push(...(t.ed.pathVars || []).map((v) => v.value));
    hostHeaders.push(...t.ed.headers.flatMap((x) => [x.key, x.value]), ...authParts(authOut(t.ed.auth)));
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
  for (let grew = true; grew;) {
    const n = names.size;
    for (const p of pairs) if (p && names.has(p.key)) add(p.value);
    grew = names.size > n;
  }
  return { names, complete, urls };
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
async function execute({ ed, cid, itemId, iteration = 0, signal, persist = true, ask = null, runScopes = null }) {
  const logs = [], tests = [], warnings = [];
  const envId = state.activeEnv; // variable changes go to the environment that was active when the request started
  const before = runScopes ? JSON.parse(JSON.stringify(runScopes)) : scopesFor(cid);
  let scopes = JSON.parse(JSON.stringify(before));
  scopes.local = {};
  let req = requestSnapshot(ed);
  // The destination baseline always comes from the SAVED (user-approved) variables, never from values
  // scripts carried over in memory during a run.
  const trusted = merged(scopesFor(cid));
  const plannedOrigin = originOf(resolve(ed.url, trusted));
  const preScripts = scriptChain(cid, itemId, ed, 'prerequest');
  const info = { requestName: ed.name, requestId: itemId || '', iteration, eventName: 'prerequest' };
  const envName = state.activeEnv && state.envs[state.activeEnv] ? state.envs[state.activeEnv].name : '';

  for (const s of preScripts) {
    const out = await runScript(s.code, { vars: scopes, request: req, response: null, info, envName });
    scopes = out.vars;
    req = out.request;
    logs.push(...out.logs.map((l) => ({ ...l, src: `pre-request (${s.src})` })));
    tests.push(...out.tests);
    if (out.error) {
      logs.push({ level: 'error', text: out.error, src: `pre-request (${s.src})` });
      return { error: `Pre-request script (${s.src}) failed: ${out.error.replace(/\.$/, '')}. The request was not sent.`, logs, tests, warnings };
    }
  }
  if (signal && signal.aborted) return { error: 'Request cancelled.', logs, tests, warnings };

  const vars = merged(scopes);
  const authInfo = effectiveAuth(ed, cid, itemId);
  const built = buildWire(ed, req, vars, authInfo);
  if (built.error) return { error: built.error, logs, tests, warnings };
  const wire = built.wire;

  // A pre-request script may not silently send this request (and its auth) to a different server.
  const finalOrigin = originOf(wire.url);
  if (!itemId && !ed._approvalId) ed._approvalId = uid();
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

  if (!res.error) {
    info.eventName = 'test';
    const response = { code: res.status, status: res.reason || '', headers: res.headers || [], body: res.body ?? '', responseTime: res.timeMs, size: res.size };
    for (const s of scriptChain(cid, itemId, ed, 'test')) {
      const out = await runScript(s.code, { vars: scopes, request: req, response, info, envName });
      scopes = out.vars;
      logs.push(...out.logs.map((l) => ({ ...l, src: `tests (${s.src})` })));
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
  return { res, wire, tests, logs, warnings, error: res.error || '', scopes };
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

function writeTabs() {
  ls.set('apiman:tabs', {
    active: state.active,
    tabs: state.tabs.map((t) => (t.cid ? { cid: t.cid, itemId: t.itemId, ed: t.dirty ? edForStorage(t.ed) : null } : { ed: edForStorage(t.ed) })),
  });
}
const persistTabs = debounce(writeTabs, 300);

async function restoreTabs() {
  const saved = ls.get('apiman:tabs', null);
  if (!saved || !Array.isArray(saved.tabs)) return;
  for (const s of saved.tabs) {
    try {
      if (s.cid) {
        if (!state.colList.some((c) => c.id === s.cid)) continue;
        if (!state.cols[s.cid]) await loadCol(s.cid);
        const loc = locate(state.cols[s.cid], s.itemId);
        if (!loc) continue;
        state.tabs.push(newTab({ cid: s.cid, itemId: s.itemId, ed: s.ed ? { ...blankEd(), ...s.ed, body: { ...blankBody(), ...s.ed.body } } : fromItem(loc.item), dirty: !!s.ed }));
      } else if (s.ed) {
        const ed = { ...blankEd(), ...s.ed, body: { ...blankBody(), ...s.ed.body } };
        state.tabs.push(newTab({ ed, dirty: !!(ed.url || ed.headers.length || ed.body.mode !== 'none' || ed.pre || ed.test) }));
      }
    } catch { /* skip broken entries */ }
  }
  state.active = Math.min(Math.max(0, saved.active | 0), state.tabs.length - 1);
}

function markDirty() {
  const t = cur();
  if (!t) return;
  if (!t.dirty) { t.dirty = true; renderTabs(); }
  $('#dirtyDot').hidden = false;
  persistTabs();
}

// =====================================================================================================
// Rendering: sidebar
// =====================================================================================================
function renderSidebar() {
  $$('.side .seg-btn').forEach((b) => { const on = b.dataset.view === state.view; b.classList.toggle('on', on); b.setAttribute('aria-selected', on); });
  $('#search').placeholder = state.view === 'history' ? 'Filter history  /' : state.view === 'environments' ? 'Filter environments  /' : 'Filter requests  /';
  const body = $('#sideBody');
  body.setAttribute('role', state.view === 'collections' ? 'tree' : 'list');
  body.setAttribute('aria-label', { collections: 'Collections', environments: 'Environments', history: 'History' }[state.view]);
  if (state.view === 'environments') body.replaceChildren(...renderEnvList());
  else if (state.view === 'history') body.replaceChildren(...renderHistoryList());
  else body.replaceChildren(...renderCollectionTree());
  // Roving tabindex: the tree is ONE tab stop; arrows move inside it. Row action buttons are reached with the menu key.
  const rows = $$('.row', body);
  rows.forEach((r) => { r.tabIndex = -1; $$('button', r).forEach((b) => { b.tabIndex = -1; }); });
  const want = state.refocus || state.focusKey;
  const current = (want && rows.find((r) => r.dataset.key === want)) || rows.find((r) => r.classList.contains('active')) || rows[0];
  if (current) current.tabIndex = 0;
  if (state.refocus && current) current.focus();
  state.refocus = null;
}
const indent = (depth) => `padding-left: calc(var(--s2) + ${depth} * 20px)`; // 20px = caret + gap, so children sit under their parent's name

function rowActs(...btns) { return h('span', { class: 'acts' }, ...btns); }
function iconBtn(name, title, onclick) {
  return h('button', { class: 'btn icon', title, 'aria-label': title, onclick: (e) => { e.stopPropagation(); onclick(e); } }, icon(name));
}
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

function renderCollectionTree() {
  if (!state.colList.length) {
    return [h('div', { class: 'empty-side' },
      h('p', null, 'No collections yet.'),
      h('p', null, 'Create one to save requests, or import an export from Postman.'),
      h('div', { class: 'actions' },
        h('button', { class: 'btn small', onclick: () => newCollection() }, 'New collection'),
        h('button', { class: 'btn small', onclick: () => openImport() }, 'Import')))];
  }
  const t = cur();
  const out = [];
  for (const c of state.colList) {
    const col = state.cols[c.id];
    const open = state.filter ? true : state.open.has(c.id);
    const kids = open && col ? itemsNodes(c.id, col.item, 1) : [];
    if (state.filter && !kids.length && !c.name.toLowerCase().includes(state.filter)) continue;
    out.push(h('div', {
      class: 'row collection', tabindex: '0', title: c.id, role: 'treeitem', 'aria-level': '1', 'aria-expanded': String(open), 'data-key': `c:${c.id}`,
      onclick: () => toggleCollection(c.id), onkeydown: (e) => { if (e.key === 'Enter') toggleCollection(c.id); },
    },
      h('span', { class: `caret ${open ? 'open' : ''}` }, icon('chevron')),
      h('span', { class: 'name' }, c.name),
      col ? h('span', { class: 'sub' }, state.filter ? `${countMatches(col.item)} / ${countRequests(col.item)}` : String(countRequests(col.item))) : null,
      rowActs(
        iconBtn('plus', 'Add request', () => addRequest(c.id, null)),
        iconBtn('dots', 'More actions', (e) => collectionMenu(e.currentTarget, c.id)))));
    out.push(...kids);
  }
  if (!out.length) out.push(h('div', { class: 'empty-side' }, `Nothing matches "${state.filter}".`));
  return out;
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
          class: `row ${active ? 'active' : ''}`, style: indent(depth), tabindex: '0', role: 'treeitem', 'aria-level': String(depth + 1),
          'aria-selected': String(!!active), 'data-key': `r:${cid}:${it.id}`,
          onclick: () => openItem(cid, it.id), onkeydown: (e) => { if (e.key === 'Enter') openItem(cid, it.id); },
        },
          h('span', { class: 'caret' }),
          h('span', { class: `mtag ${m}` }, m),
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
  if (!state.cols[id]) { try { await loadCol(id); } catch (e) { toast(e.message); } }
  renderSidebar();
}

function renderEnvList() {
  const f = state.filter;
  const rows = [h('div', { class: 'side-section' }, 'Environments',
    h('button', { class: 'btn small ghost', onclick: () => editEnvironment(null) }, '+ New'))];
  const g = state.envs[GLOBALS_ID];
  if (!f || 'globals'.includes(f)) {
    rows.push(h('div', { class: 'row', tabindex: '0', role: 'button', 'data-key': 'e:globals', onclick: () => editEnvironment(GLOBALS_ID), onkeydown: (e) => { if (e.key === 'Enter') editEnvironment(GLOBALS_ID); } },
      h('span', { class: 'caret' }),
      h('span', { class: 'name' }, 'Globals'),
      h('span', { class: 'sub' }, `${g ? g.values.length : 0} vars`)));
  }
  for (const e of state.envList) {
    if (f && !e.name.toLowerCase().includes(f)) continue;
    const doc = state.envs[e.id];
    const active = e.id === state.activeEnv;
    rows.push(h('div', { class: `row ${active ? 'active' : ''}`, tabindex: '0', role: 'button', 'data-key': `e:${e.id}`, 'aria-label': `${e.name}${active ? ' (active)' : ''}`, onclick: () => editEnvironment(e.id), onkeydown: (ev) => { if (ev.key === 'Enter') editEnvironment(e.id); } },
      h('span', { class: 'caret' }, h('span', { class: `env-dot ${active ? 'on' : ''}`, role: active ? 'img' : null, 'aria-label': active ? 'Active' : null })),
      h('span', { class: 'name' }, e.name),
      h('span', { class: 'sub' }, `${doc ? doc.values.length : 0} vars`),
      rowActs(iconBtn('dots', 'More actions', (ev) => envMenu(ev.currentTarget, e.id)))));
  }
  if (!state.envList.length) {
    rows.push(h('div', { class: 'empty-side' }, h('p', null, 'Environments hold values that change between setups, like baseUrl and token for local, staging and production.')));
  }
  return rows;
}

function renderHistoryList() {
  if (!state.settings.history) return [h('div', { class: 'empty-side' }, 'History is turned off in Settings.')];
  const f = state.filter;
  const list = state.history.filter((e) => !f || `${e.method} ${e.url} ${e.name}`.toLowerCase().includes(f));
  const out = [h('div', { class: 'side-section' }, `${state.history.length} requests`,
    state.history.length ? h('button', { class: 'btn small ghost', onclick: clearHistory }, 'Clear') : null)];
  if (!list.length) out.push(h('div', { class: 'empty-side' }, state.history.length ? 'Nothing matches.' : 'Requests you send appear here.'));
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
    h('span', { class: `mtag ${e.method}` }, e.method),
    h('span', { class: 'name' }, path),
    h('span', { class: 'time' }, time),
    h('span', { class: `status-code sm ${e.status ? `s${String(e.status)[0]}` : 's-err'}` }, e.status ? String(e.status) : 'Error'));
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
  const name = anchor.getAttribute('aria-label') || anchor.textContent.trim();
  if (name) pop.setAttribute('aria-label', name); else pop.removeAttribute('aria-label');
  pop.replaceChildren(...items.map((it) => (it === '-' ? h('div', { class: 'sep', role: 'separator' })
    : h('button', { class: `mi ${it.danger ? 'danger' : ''} ${it.current ? 'cur' : ''}`, role: 'menuitem', 'aria-current': it.current ? 'true' : null, onclick: () => { hideMenu(); it.onClick(); } }, it.label))));
  placePopover(pop, anchor);
  anchor.setAttribute('aria-expanded', 'true');
  showMenu.anchor = anchor;
  if (row) { row.classList.add('menu-open'); pop.dataset.row = '1'; showMenu.row = row; }
  const first = pop.querySelector('button');
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
    more = h('button', { type: 'button', class: 'btn icon small seg-more', title: what, 'aria-label': what, 'aria-haspopup': 'menu', 'aria-expanded': 'false' }, icon('dots'));
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
}
function placePopover(pop, anchor) {
  pop.hidden = false;
  const r = anchor.getBoundingClientRect();
  const pw = pop.offsetWidth, ph = pop.offsetHeight;
  pop.style.left = `${Math.max(8, Math.min(r.left, innerWidth - pw - 8))}px`;
  pop.style.top = `${r.bottom + ph + 8 > innerHeight ? Math.max(8, r.top - ph - 4) : r.bottom + 4}px`;
}
function hideMenu(refocus = false) {
  $('#popover').hidden = true;
  if (showMenu.row) { showMenu.row.classList.remove('menu-open'); showMenu.row = null; }
  if (showMenu.anchor) {
    showMenu.anchor.setAttribute('aria-expanded', 'false');
    if (refocus && showMenu.anchor.isConnected) showMenu.anchor.focus();
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
    { label: 'Export', onClick: () => download(id, JSON.stringify(state.envs[id], null, 2)) },
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
  if (!fresh) { toast('That item no longer exists.'); return; }
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
  if (kept) toast(`${kept} tab${kept > 1 ? 's' : ''} with unsaved changes ${kept > 1 ? 'were' : 'was'} kept as unsaved draft${kept > 1 ? 's' : ''}.`);
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

async function newCollection() {
  const name = await ask({ title: 'New collection', input: { label: 'Collection name', placeholder: 'e.g. Payments API' }, ok: 'Create collection' });
  if (!name) return;
  const doc = { info: { name, schema: SCHEMA_V21, _postman_id: uid() }, item: [] };
  const id = await backend.collections.create(doc);
  state.open.add(id);
  saveOpen();
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
  await backend.collections.create(col);
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
  download(cid, JSON.stringify(col, null, 2));
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
        h('span', { class: `mtag ${t.ed.method}` }, t.ed.method),
        h('span', { class: 'tname' }, t.ed.name),
        h('span', { class: `dot ${t.dirty ? '' : 'off'}`, role: t.dirty ? 'img' : null, 'aria-label': t.dirty ? 'Unsaved changes' : null, title: t.dirty ? 'Unsaved changes' : null }),
        h('button', { class: 'x', title: 'Close tab', 'aria-label': `Close ${t.ed.name}`, tabindex: i === state.active ? '0' : '-1', onclick: (e) => { e.stopPropagation(); closeTab(i); } }, icon('x')));
    }),
    h('button', { class: 'newtab', title: 'New request tab', 'aria-label': 'New request tab', onclick: () => { openTab(newTab()); $('#url').focus(); } }, icon('plus')),
    h('button', { class: 'newtab alltabs', title: 'All open tabs', 'aria-label': 'All open tabs', 'aria-haspopup': 'menu', 'aria-expanded': 'false',
      onclick: (e) => showMenu(e.currentTarget, state.tabs.map((t, i) => ({
        label: h('span', { class: 'mi-tab' }, h('span', { class: `mtag ${t.ed.method}` }, t.ed.method), h('span', { class: 'mi-name' }, t.ed.name, t.dirty ? h('span', { class: 'dirty-dot', 'aria-label': ' (unsaved)' }) : null),
          h('span', { class: 'mi-sub' }, (t.ed.url || '').replace(/^[a-z]+:\/\//i, '') || 'no URL yet')),
        current: i === state.active,
        onClick: () => { state.active = i; persistTabs(); renderAll(); requestAnimationFrame(() => $('#tabstrip .rtab.on')?.focus()); },
      }))) }, icon('chevron')));
  const on = strip.querySelector('.rtab.on');
  if (on) on.scrollIntoView({ block: 'nearest', inline: 'nearest' });
}

function renderWelcome() {
  const hasData = state.colList.length > 0 || state.history.length > 0;
  const where = backend && backend.mode === 'local' ? 'on this computer' : 'in this browser';
  const kbd = (k) => h('kbd', null, k);
  const cols = [];
  if (state.history.length) {
    const seen = new Set();
    const recent = state.history.filter((e) => { const k = `${e.method} ${e.url}`; if (seen.has(k)) return false; seen.add(k); return true; }).slice(0, 8);
    cols.push(h('section', null, h('span', { class: 'label' }, 'Recent requests'), ...recent.map(historyRow)));
  }
  if (state.colList.length) {
    cols.push(h('section', null, h('span', { class: 'label' }, 'Collections'), ...state.colList.map((c) => h('div', {
      class: 'row', tabindex: '0', role: 'button',
      onclick: () => { state.view = 'collections'; setSide(true); if (!state.open.has(c.id)) toggleCollection(c.id); else renderSidebar(); },
      onkeydown: (e) => { if (e.key === 'Enter') e.currentTarget.click(); },
    },
      h('span', { class: 'folder-ico' }, icon('folder')),
      h('span', { class: 'name' }, c.name),
      state.cols[c.id] ? h('span', { class: 'sub' }, `${countRequests(state.cols[c.id].item)} requests`) : null))));
  }
  $('#welcomeInner').replaceChildren(
    h('h1', null, hasData ? 'No request open' : 'Send your first request'),
    h('p', null, hasData
      ? 'Pick up a recent request, open one from a collection, or start a new one.'
      : `Paste a URL, import a Postman collection, or start from a cURL command. Everything stays ${where}.`),
    h('div', { class: 'welcome-actions' },
      h('button', { class: 'btn primary', 'data-act': 'new-request' }, 'New request'),
      h('button', { class: 'btn', 'data-act': 'import' }, 'Import collection'),
      h('button', { class: 'btn', 'data-act': 'import-curl' }, 'Paste cURL')),
    h('p', { class: 'hint shortcuts empty-state' }, h('span', null, kbd('/'), ' filter requests, ', kbd(MOD), ' + ', kbd('Enter'), ' send, ', kbd(MOD), ' + ', kbd('S'), ' save, ', kbd(MOD), ' + ', kbd('B'), ' sidebar')),
    cols.length ? h('div', { class: 'welcome-cols' }, ...cols) : null);
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

function renderResolved() {
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
    const v = Object.hasOwn(vars, m[1]) ? vars[m[1]] : dynamicVar(m[1]);
    parts.push(v === undefined ? h('span', { class: 'bad', title: 'Not defined in the environment, collection or Globals' }, m[0]) : (m[1].startsWith('$') ? `‹${m[1]}›` : v));
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
function setDot(sel, on) {
  const el = $(sel);
  el.classList.add('dot');
  el.classList.toggle('off', !on);
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
    const input = (col, placeholder) => h('input', {
      type: col === 'value' && secret && !row.reveal ? 'password' : 'text', value: row[col] ?? '', placeholder: ghost ? placeholder : '',
      spellcheck: 'false', autocomplete: 'off', 'data-col': col, 'aria-label': placeholder,
      oninput: (e) => { if (ghost) promote(col, e.target.value); else { row[col] = e.target.value; onChange(); } },
    });
    let valueCell;
    if (opts.file && row.type === 'file' && !ghost) {
      const pick = h('input', { type: 'file', hidden: true, onchange: (e) => { row.file = e.target.files[0] || null; row.src = row.file ? row.file.name : row.src; onChange(); render(); } });
      valueCell = h('td', null, h('div', { class: 'file-pick' },
        h('button', { class: 'btn small', type: 'button', onclick: () => pick.click() }, row.file ? 'Change file' : 'Choose file'),
        h('span', { class: 'fname' }, row.file ? `${row.file.name} (${fmtSize(row.file.size)})` : row.src ? `${row.src}: choose it again to send` : 'No file chosen'),
        pick));
    } else valueCell = h('td', null, input('value', ph[1]));
    const typeCell = opts.secret || opts.file ? h('td', { class: 'type' }, ghost ? null : h('select', {
      'aria-label': 'Type',
      onchange: (e) => { row.type = e.target.value; onChange(); render(); },
    }, ...(opts.secret ? [['default', 'Default'], ['secret', 'Secret']] : [['text', 'Text'], ['file', 'File']])
      .map(([v, l]) => h('option', { value: v, ...(row.type === v || (!row.type && v === (opts.secret ? 'default' : 'text')) ? { selected: true } : {}) }, l)))) : null;
    return h('tr', { 'data-i': i, class: `${ghost ? 'ghost' : ''} ${row.disabled ? 'off' : ''}` },
      h('td', { class: 'chk' }, ghost ? null : h('input', {
        type: 'checkbox', checked: !row.disabled, title: 'Enabled', 'aria-label': 'Enabled',
        onchange: (e) => { row.disabled = !e.target.checked; onChange(); render(); },
      })),
      h('td', null, input('key', ph[0])),
      valueCell,
      typeCell,
      h('td', { class: 'act' }, ghost ? null : [
        secret ? h('button', { class: 'btn icon', type: 'button', title: row.reveal ? 'Hide' : 'Show', 'aria-label': row.reveal ? 'Hide value' : 'Show value', onclick: () => { row.reveal = !row.reveal; render(); } }, icon(row.reveal ? 'eyeOff' : 'eye')) : null,
        h('button', { class: 'btn icon', type: 'button', title: 'Remove', 'aria-label': 'Remove row', onclick: () => { rows.splice(i, 1); onChange(); render(); } }, icon('trash')),
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
    pv.replaceChildren(h('div', { class: 'label section-label' }, 'Path variables'),
      h('table', { class: 'kv kv-path' }, h('thead', null, h('tr', null, h('th', { class: 'chk' }), h('th', null, 'Path variable'), h('th', null, 'Value'), h('th', { class: 'act' }))),
        h('tbody', null, t.ed.pathVars.map((v) => h('tr', null,
          h('td', { class: 'chk' }),
          h('td', null, h('input', { type: 'text', value: `:${v.key}`, readonly: true, tabindex: '-1', 'aria-label': 'Path variable' })),
          h('td', null, h('input', { type: 'text', value: v.value, placeholder: 'Value', spellcheck: 'false', 'aria-label': `Value for :${v.key}`,
            oninput: (e) => { v.value = e.target.value; markDirty(); } })),
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
function authForm(model, { allowInherit, inheritText, onChange }) {
  const wrap = h('div', { class: 'auth-form' });
  const draw = () => {
    const field = (label, key, { secret, placeholder } = {}) => {
      let reveal = false;
      const input = h('input', {
        type: secret ? 'password' : 'text', value: model[key] || '', placeholder: placeholder || '', spellcheck: 'false', autocomplete: 'off',
        oninput: (e) => { model[key] = e.target.value; onChange(); },
      });
      return h('div', { class: 'field' }, h('label', null, label),
        secret ? h('div', { class: 'secret-field' }, input,
          h('button', { class: 'btn icon', type: 'button', title: 'Show / hide', 'aria-label': 'Show or hide', onclick: (e) => { reveal = !reveal; input.type = reveal ? 'text' : 'password'; e.currentTarget.replaceChildren(icon(reveal ? 'eyeOff' : 'eye')); } }, icon('eye')))
          : input);
    };
    const types = [...(allowInherit ? [['inherit', 'Inherit from parent']] : []), ['noauth', 'No auth'], ['bearer', 'Bearer token'], ['basic', 'Basic auth'], ['apikey', 'API key']];
    if (model.type === 'unsupported') types.push(['unsupported', `${model.raw.type} (not supported)`]);
    const sel = h('select', {
      'aria-label': 'Auth type',
      onchange: (e) => {
        const type = e.target.value;
        for (const k of Object.keys(model)) delete model[k];
        Object.assign(model, { type }, type === 'apikey' ? { in: 'header', key: '', value: '' } : {});
        onChange();
        draw();
      },
    }, ...types.map(([v, l]) => h('option', { value: v, ...(model.type === v ? { selected: true } : {}) }, l)));
    const kids = [h('div', { class: 'field narrow' }, h('label', null, 'Type'), sel)];
    if (model.type === 'inherit') kids.push(h('p', { class: 'note' }, inheritText ? inheritText() : 'Uses the auth of the folder or collection this request is saved in.'));
    if (model.type === 'noauth') kids.push(h('p', { class: 'hint' }, 'No Authorization header is added.'));
    if (model.type === 'bearer') kids.push(field('Token', 'token', { secret: true, placeholder: 'eyJhbGciOi… or {{token}}' }));
    if (model.type === 'basic') kids.push(h('div', { class: 'grid-2' }, field('Username', 'username'), field('Password', 'password', { secret: true })));
    if (model.type === 'apikey') {
      kids.push(h('div', { class: 'grid-2' }, field('Key', 'key', { placeholder: 'X-Api-Key' }), field('Value', 'value', { secret: true, placeholder: '{{apiKey}}' })));
      kids.push(h('div', { class: 'field narrow' }, h('label', null, 'Add to'),
        h('select', { onchange: (e) => { model.in = e.target.value; onChange(); } },
          h('option', { value: 'header', ...(model.in !== 'query' ? { selected: true } : {}) }, 'Header'),
          h('option', { value: 'query', ...(model.in === 'query' ? { selected: true } : {}) }, 'Query parameter'))));
    }
    if (model.type === 'unsupported') kids.push(h('p', { class: 'note warn' }, `The "${model.raw.type}" auth from Postman isn't supported yet. It stays in the file unchanged but isn't sent. Pick another type to replace it.`));
    if (['bearer', 'basic', 'apikey'].includes(model.type)) kids.push(h('p', { class: 'hint' }, 'Tip: keep secrets in an environment as Secret variables and reference them like {{token}}.'));
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
      const label = { noauth: 'no auth', bearer: 'a Bearer token', basic: 'Basic auth', apikey: 'an API key' }[auth.type] || auth.type;
      return `Inherits ${label} from ${from}. Change it in the collection or folder settings.`;
    },
    onChange: () => { renderCounts(); markDirty(); },
  }));
}

const BODY_MODES = [['none', 'None'], ['raw', 'Raw'], ['formdata', 'Form data'], ['urlencoded', 'URL-encoded'], ['file', 'Binary'], ['graphql', 'GraphQL']];

function renderBody() {
  const t = cur();
  const b = t.ed.body;
  $('#bodyModes').replaceChildren(...BODY_MODES.map(([m, label]) => h('button', {
    class: `seg-btn ${b.mode === m ? 'on' : ''}`, role: 'radio', 'aria-checked': String(b.mode === m),
    onclick: () => { b.mode = m; renderBody(); renderCounts(); markDirty(); },
  }, label)));
  const extras = [];
  if (b.mode === 'raw') {
    extras.push(h('select', { 'aria-label': 'Raw format', onchange: (e) => { b.lang = e.target.value; markDirty(); renderBody(); } },
      ...[['json', 'JSON'], ['text', 'Text'], ['xml', 'XML'], ['html', 'HTML'], ['javascript', 'JavaScript']]
        .map(([v, l]) => h('option', { value: v, ...(b.lang === v ? { selected: true } : {}) }, l))));
  }
  if (b.mode === 'raw' && b.lang === 'json') extras.push(h('button', { class: 'btn small ghost', onclick: () => {
    try { b.raw = JSON.stringify(JSON.parse(b.raw), null, Number(state.settings.tabSize) || 2); renderBody(); markDirty(); } catch (e) { toast(`Not valid JSON: ${e.message}`); }
  } }, 'Beautify'));
  $('#bodyExtras').replaceChildren(...extras);

  const box = $('#bodyEditor');
  const area = (key, placeholder, rows = 14) => h('textarea', {
    class: 'code', spellcheck: 'false', wrap: 'off', placeholder, rows, value: b[key], 'aria-label': key === 'raw' ? 'Request body' : key === 'gqlQuery' ? 'GraphQL query' : 'GraphQL variables',
    oninput: (e) => { b[key] = e.target.value; markDirty(); },
    onkeydown: tabIndent,
  });
  if (b.mode === 'none') box.replaceChildren(h('p', { class: 'hint' }, 'This request has no body.'));
  else if (b.mode === 'raw') {
    box.replaceChildren(codeEditor({ value: b.raw, mode: b.lang, label: 'Request body', placeholder: b.lang === 'json' ? '{ "name": "{{$randomFirstName}}" }' : 'Request body',
      onChange: (v) => { b.raw = v; renderCounts(); markDirty(); } }));
  }
  else if (b.mode === 'urlencoded') { box.replaceChildren(); kvTable(box, b.urlencoded, { onChange: markDirty }); }
  else if (b.mode === 'formdata') { box.replaceChildren(); kvTable(box, b.formdata, { file: true, onChange: markDirty }); }
  else if (b.mode === 'file') {
    const pick = h('input', { type: 'file', hidden: true, onchange: (e) => { b.fileObj = e.target.files[0] || null; if (b.fileObj) b.fileSrc = b.fileObj.name; markDirty(); renderBody(); } });
    box.replaceChildren(h('div', { class: 'drop' },
      h('p', null, b.fileObj ? `${b.fileObj.name} (${fmtSize(b.fileObj.size)})` : b.fileSrc ? `${b.fileSrc}: choose it again to send (files aren't stored)` : 'Send a file as the raw request body.'),
      h('button', { class: 'btn', onclick: () => pick.click() }, b.fileObj ? 'Change file' : 'Choose file'), pick));
  } else if (b.mode === 'graphql') {
    box.replaceChildren(
      h('div', { class: 'field grow' }, h('label', null, 'Query'), codeEditor({ value: b.gqlQuery, mode: 'graphql', label: 'GraphQL query', placeholder: 'query { users { id name } }', onChange: (v) => { b.gqlQuery = v; renderCounts(); markDirty(); } })),
      h('div', { class: 'field' }, h('label', null, 'Variables (JSON)'), codeEditor({ value: b.gqlVars, mode: 'json', label: 'GraphQL variables', placeholder: '{ "id": 1 }', cls: 'short', onChange: (v) => { b.gqlVars = v; markDirty(); } })));
  } else box.replaceChildren(h('p', { class: 'note warn' }, `The "${b.unsupported.mode}" body from Postman isn't supported. It's kept in the file but not sent. Pick another body type to replace it.`));
}

const CM_MODES = {
  json: { name: 'javascript', json: true }, javascript: 'javascript', xml: 'xml', html: 'htmlmixed', text: null,
  graphql: 'javascript', shell: 'shell', python: 'python', java: 'text/x-java',
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
  const out = t.out;
  $('#btnSend').textContent = t.sending ? 'Cancel' : 'Send';
  $('#btnSend').classList.toggle('busy', !!t.sending);
  const clearCounts = () => { for (const id of ['#cntRHeaders', '#cntRCookies', '#cntRTests', '#cntRConsole']) $(id).textContent = ''; };
  if (t.sending || !out) {
    status.replaceChildren(t.sending ? h('span', null, 'Sending…') : '');
    clearCounts();
    t.respTab = 'rbody';
    switchPane('#respTabs', 'rbody');
    $('#respTools').hidden = !t.sending; // "Sending..." shows where the status will appear
    $('#respTools').classList.add('no-body');
    $('#respBody').replaceChildren(h('div', { class: 'empty-state' }, t.sending
      ? h('p', { class: 'hint' }, `Waiting for the response to ${t.ed.method} ${t.ed.url || 'this request'}…`)
      : [h('p', { class: 'hint' }, 'Send the request to see its response here.'),
        h('p', { class: 'hint' }, h('kbd', null, MOD), ' + ', h('kbd', null, 'Enter'), ' sends, ',
          h('kbd', null, MOD), ' + ', h('kbd', null, 'S'), ' saves, ', h('kbd', null, MOD), ' + ', h('kbd', null, 'F'), ' searches a response.')]));
    return;
  }
  const res = out.res;
  const hasRes = res && !out.error;
  status.replaceChildren(...(hasRes ? [
    h('span', { title: `${res.status} ${res.reason || REASONS[res.status] || ''}, ${fmtMs(res.timeMs)}, ${fmtSize(res.size)}` }, h('span', { class: `status-code s${String(res.status)[0]}` }, String(res.status),
      h('span', { class: 'm-reason' }, ` ${res.reason || REASONS[res.status] || ''}`))),
    h('span', { class: 'm-time', title: 'Time' }, h('b', null, fmtMs(res.timeMs))),
    h('span', { class: 'm-size', title: 'Size' }, h('b', null, fmtSize(res.size)), res.truncated ? ' (truncated)' : ''),
    ...(out.wire && res.finalUrl && res.finalUrl !== out.wire.url ? [h('span', { class: 'pill', title: res.finalUrl }, 'Redirected')] : []),
  ] : [h('span', { class: 'status-code s-err' }, 'Error')]));
  const notes = [
    ...(out.error ? [h('p', { class: 'note err' }, out.error)] : []),
    ...(out.warnings || []).map((w) => h('p', { class: 'note warn' }, w)),
  ];
  const tests = out.tests || [];
  const failed = tests.filter((x) => x.passed === false).length;
  const passed = tests.filter((x) => x.passed === true).length;
  $('#cntRHeaders').textContent = hasRes ? String(res.headers.length) : '';
  const cookies = hasRes ? parseCookies(res.headers) : [];
  $('#cntRCookies').textContent = cookies.length ? String(cookies.length) : '';
  const ct = $('#cntRTests');
  ct.textContent = tests.length ? `${passed}/${tests.length}` : '';
  ct.className = `count ${failed ? 'fail' : tests.length ? 'pass' : ''}`;
  $('#cntRConsole').textContent = out.logs && out.logs.length ? String(out.logs.length) : '';
  switchPane('#respTabs', t.respTab);

  // body
  $('#respTools').hidden = false;
  $('#respTools').classList.toggle('no-body', !hasRes);
  const previewable = hasRes && (/html|xml|svg/.test(contentType(res)) || (res.binary && /^image\//.test(contentType(res))));
  const view = t.bodyView === 'preview' && !previewable ? 'pretty' : t.bodyView; // nothing to preview: show Pretty, keep the choice for HTML
  $$('#respTools .seg-btn').forEach((b) => { const on = b.dataset.view === view; b.classList.toggle('on', on); b.setAttribute('aria-checked', String(on)); });
  const pv = $('#respTools [data-view="preview"]');
  pv.disabled = false;
  pv.setAttribute('aria-disabled', String(!previewable));
  pv.title = previewable ? '' : 'Preview shows HTML and images; this response is neither.';
  clearFind();
  if (!$('#findBar').hidden) setTimeout(() => runFind(0), 0); // keep the open Find bar in sync with the new response
  $('#respBody').replaceChildren(...notes, ...(notes.length && hasRes ? [h('div', { class: 'gap' })] : []), ...(hasRes ? [bodyView(res, view)] : []));
  // headers
  $('#respHeaders').replaceChildren(...(hasRes ? [h('thead', null, h('tr', null, h('th', null, 'Name'), h('th', null, 'Value'))),
    h('tbody', null, res.headers.map(([k, v]) => h('tr', null, h('td', null, k), h('td', { class: 'mono' }, v))))] : []));
  // cookies
  $('#respCookies').replaceChildren(cookies.length
    ? h('table', { class: 'grid' }, h('thead', null, h('tr', null, ...['Name', 'Value', 'Domain', 'Path', 'Expires', 'Flags'].map((x) => h('th', null, x)))),
      h('tbody', null, cookies.map((c) => h('tr', null, h('td', null, c.name), h('td', { class: 'mono' }, c.value), h('td', null, c.domain || ''), h('td', null, c.path || ''), h('td', null, c.expires || ''), h('td', null, c.flags.join(', '))))))
    : h('p', { class: 'hint' }, backend.mode === 'local' ? 'The response set no cookies.' : 'The response set no cookies that browsers let pages read (run ApiMan locally to see Set-Cookie headers).'));
  // tests
  $('#respTests').replaceChildren(tests.length
    ? h('div', null, h('p', { class: 'hint' }, `${passed} passed, ${failed} failed${tests.length - passed - failed ? `, ${tests.length - passed - failed} skipped` : ''}`),
      ...tests.map((x) => h('div', { class: 'test-row' },
        h('span', { class: `pill ${x.passed === false ? 'err' : x.passed === null ? '' : 'ok'}` }, x.passed === false ? 'Fail' : x.passed === null ? 'Skip' : 'Pass'),
        h('div', null, h('div', null, x.name), x.error && x.passed === false ? h('div', { class: 'msg' }, x.error) : null))))
    : h('div', { class: 'empty-state' }, h('p', { class: 'hint' }, 'No tests ran. Add them in Scripts, then Tests. For example:'),
      h('pre', { class: 'hint-code' }, 'pm.test("Status is 200", () => {\n  pm.response.to.have.status(200);\n});')));
  // console
  $('#respConsole').replaceChildren(...(out.logs && out.logs.length
    ? out.logs.map((l) => h('div', { class: `line ${l.level}` }, h('span', { class: 'src' }, l.src || ''), l.text))
    : [h('p', { class: 'hint' }, 'console.log() output from scripts appears here.')]));
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
      blocks.push(h('pre', { class: 'hint-code' }, code.join('\n')));
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
    setTimeout(openFind, 0);
    return;
  }
  if (!findCm()) { toast(t && t.out && t.out.res ? 'This response has no text to search.' : 'Send the request first: Find searches the response body.'); return; }
  $('#findBar').hidden = false;
  refreshEditors($('#pane-rbody'));
  $('#findInput').focus();
  $('#findInput').select();
  if ($('#findInput').value) runFind(0);
}
function clearFind() { find.marks.forEach((m) => m.clear()); if (find.current) find.current.clear(); find.current = null; find.marks = []; find.hits = []; find.i = -1; }
function closeFind() {
  clearFind(); $('#findBar').hidden = true; $('#findCount').textContent = '';
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
  cm.scrollIntoView({ from: hit.from, to: hit.to }, 60);
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
    if (!res.binary && /html|xml|svg/.test(ct)) {
      // No scripts, no network: sandbox="" plus a CSP that only allows inline styles and data: images.
      const frame = h('iframe', { class: 'preview', sandbox: '', title: 'Response preview', referrerpolicy: 'no-referrer' });
      frame.srcdoc = `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:">${inertHtml(res.body)}`;
      return frame;
    }
    return h('p', { class: 'hint' }, 'Preview works for HTML and images. Use Pretty or Raw for this response.');
  }
  if (res.binary) {
    return h('div', { class: 'drop' }, h('p', null, `Binary response (${ct || 'unknown type'}, ${fmtSize(res.size)}).`),
      h('button', { class: 'btn', onclick: saveBody }, 'Download'));
  }
  const text = res.body ?? '';
  if (!text) return h('p', { class: 'hint' }, 'The response body is empty.');
  const wrap = state.settings.wrap !== false;
  const langOf = () => (/json/.test(ct) ? 'json' : /html/.test(ct) ? 'html' : /xml|svg/.test(ct) ? 'xml' : /javascript/.test(ct) ? 'javascript' : 'text');
  if (view === 'pretty') {
    try {
      JSON.parse(text); // valid JSON only
      const pretty = prettyJson(text, Number(state.settings.tabSize) || 2);
      if (pretty.length > 2_000_000) return h('pre', { class: 'out' }, pretty); // keep very large bodies fast
      return codeEditor({ value: pretty, mode: 'json', readOnly: true, fold: true, wrap, label: 'Response body', cls: 'fill' });
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
async function send() {
  const t = cur();
  if (!t) return;
  if (t.sending) {
    // Cancel: show it immediately; a late answer from the server is ignored below.
    t.sending.abort();
    t.sending = null;
    t.out = { error: 'Request cancelled.', tests: [], logs: [], warnings: [] };
    renderResponse();
    return;
  }
  const ctrl = new AbortController();
  t.sending = ctrl;
  t.out = null;
  renderResponse();
  const out = await execute({ ed: t.ed, cid: t.cid, itemId: t.itemId, signal: ctrl.signal, ask: (m) => ask({ title: 'Review this script change', message: m, ok: 'Allow', danger: true, pre: true }) });
  if (t.sending !== ctrl) return; // superseded
  t.sending = null;
  t.out = out;
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
    toast(`Couldn't save: ${e.message}`);
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
  const nameIn = h('input', { value: t.ed.name, spellcheck: 'false' });
  const targets = [];
  for (const c of state.colList) {
    const col = state.cols[c.id];
    if (!col) continue;
    targets.push({ label: c.name, cid: c.id, folderId: null });
    const walk = (items, depth) => { for (const it of items) if (isFolder(it)) { targets.push({ label: `${'  '.repeat(depth)}${c.name} / ${it.name}`, cid: c.id, folderId: it.id }); walk(it.item, depth + 1); } };
    walk(col.item, 1);
  }
  const sel = h('select', null, ...targets.map((x, i) => h('option', { value: String(i), ...(t.cid === x.cid && !x.folderId ? { selected: true } : {}) }, x.label)));
  openDialog({
    title: 'Save request',
    body: [h('div', { class: 'field' }, h('label', null, 'Name'), nameIn), h('div', { class: 'field' }, h('label', null, 'Save to'), sel)],
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
const dialogCloses = new Map(); // dialog number -> its onClose
/** Opens the dialog, or queues it if one is already open, so a background prompt never replaces your open dialog. */
function openDialog(opts) {
  if ($('#dlg').open) { dialogQueue.push(opts); return; }
  renderDialog(opts);
}
function renderDialog({ title, body, buttons = [], wide = false, confirm = false, tall = false, drawer = false, cancel = 'Cancel', onClose, focus, onOpen }) {
  const dlg = $('#dlg');
  dlg.classList.toggle('wide', wide);
  dlg.classList.toggle('confirm', confirm);
  $('#dlgBody').classList.toggle('tall', tall); // dialogs with tabs keep one height, so nothing jumps under the cursor
  $('#dlg').classList.toggle('drawer', drawer); // docked at the side: the app shrinks beside it, so previews stay visible
  document.documentElement.classList.toggle('drawer-open', drawer);
  // Every dialog gets the same footer: [destructive/left actions]  ...  Cancel  Primary
  if (cancel && !buttons.some((b) => b.label === 'Cancel')) {
    const at = buttons.findIndex((b) => b.primary || b.solid);
    buttons = [...buttons];
    buttons.splice(at === -1 ? buttons.length : at, 0, { label: cancel, onClick: () => true });
  }
  $('#dlgTitle').textContent = title;
  $('#dlgBody').replaceChildren(...[body].flat().filter((x) => x != null && x !== false));
  linkLabels($('#dlgBody'));
  $('#dlgFoot').replaceChildren(...buttons.map((b) => h('button', {
    type: 'button', class: `btn ${b.primary ? 'primary' : ''} ${b.danger ? 'danger' : ''} ${b.solid ? 'solid' : ''} ${b.left ? 'push-left' : ''}`,
    onclick: async (e) => {
      const btn = e.currentTarget;
      btn.disabled = true;
      const mine = dialogSeq;
      try { if (await b.onClick() && dialogSeq === mine && dlg.open) dlg.close(); } catch (err) { toast(err.message); } finally { btn.disabled = false; }
    },
  }, b.label)));
  dialogSeq += 1;
  dialogCloses.set(dialogSeq, onClose || null);
  if (!dlg.open) dlg.showModal();
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
function ask({ title, message, input, ok = 'OK', danger = false, pre = false }) {
  return new Promise((resolve) => {
    let settled = false;
    const settle = (v) => { if (!settled) { settled = true; resolve(v); } };
    const field = input ? h('input', { value: input.value || '', placeholder: input.placeholder || '', spellcheck: 'false', autocomplete: 'off' }) : null;
    const submit = () => {
      if (field && !field.value.trim()) { field.focus(); return false; }
      settle(field ? field.value.trim() : true);
      return true;
    };
    if (field) field.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); if (submit()) closeDialog(); } });
    openDialog({
      title,
      body: [
        message ? h('p', { class: `hint field ${pre ? 'pre-line' : ''}` }, message) : null,
        field ? h('div', { class: 'field' }, h('label', null, input.label), field) : null,
      ],
      confirm: true,
      buttons: [
        { label: 'Cancel', onClick: () => { settle(field ? null : false); return true; } },
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

function dlgTabs(defs, onChange) {
  const bar = h('div', { class: 'seg dlg-tabs', role: 'tablist' });
  const panes = defs.map((d) => h('div', { 'data-pane': d.key, hidden: d !== defs[0] }, d.content));
  defs.forEach((d, i) => bar.append(h('button', {
    type: 'button', class: `seg-btn ${i === 0 ? 'on' : ''}`, role: 'tab', 'aria-selected': String(i === 0),
    onclick: (e) => {
      $$('.seg-btn', bar).forEach((b) => { const on = b === e.currentTarget; b.classList.toggle('on', on); b.setAttribute('aria-selected', String(on)); });
      panes.forEach((p) => { p.hidden = p.dataset.pane !== d.key; if (!p.hidden) refreshEditors(p); });
      if (onChange) onChange(d.key);
    },
  }, d.label)));
  return [bar, ...panes];
}

function scriptsPair(model) {
  const mk = (key, label, ph) => h('div', { class: 'field' }, h('label', null, label),
    codeEditor({ value: model[key], mode: 'javascript', label, placeholder: ph.split('\n')[0], cls: 'short', onChange: (v) => { model[key] = v; } }));
  return [
    mk('pre', 'Pre-request: runs before every request inside', '// e.g. refresh a timestamp\npm.collectionVariables.set("now", Date.now());'),
    mk('test', 'Tests: run after every request inside', 'pm.test("No server errors", () => pm.expect(pm.response.code).to.be.below(500));'),
    h('p', { class: 'hint' }, 'Scripts run sandboxed: they can\'t make network calls of their own or read your stored data, and ApiMan asks before a script changes which server a request goes to.'),
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
  const nameIn = h('input', { value: model.name, spellcheck: 'false', oninput: (e) => { model.name = e.target.value; } });
  const varsBox = h('div');
  if (isCol) kvTable(varsBox, model.vars, { secret: true, placeholders: ['Variable', 'Value'] });
  const defs = [
    { key: 'auth', label: 'Auth', content: authForm(model.auth, { allowInherit: !isCol, inheritText: () => 'Uses the auth of the parent folder or collection.', onChange: () => {} }) },
    ...(isCol ? [{ key: 'vars', label: 'Variables', content: [varsBox, h('p', { class: 'hint' }, 'Use as {{name}} anywhere in this collection. Environment values win over these when both exist.')] }] : []),
    { key: 'scripts', label: 'Scripts', content: scriptsPair(model) },
    { key: 'docs', label: 'Docs', content: h('textarea', { class: 'prose', rows: 8, value: model.docs, oninput: (e) => { model.docs = e.target.value; } }) },
  ];
  openDialog({
    title: isCol ? 'Collection settings' : 'Folder settings',
    wide: true,
    tall: true,
    body: [h('div', { class: 'field' }, h('label', null, 'Name'), nameIn), ...dlgTabs(defs)],
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

async function editEnvironment(id) {
  const isGlobals = id === GLOBALS_ID;
  const doc = id ? (isGlobals ? await ensureGlobals() : state.envs[id]) : { name: '', values: [], _postman_variable_scope: 'environment' };
  if (!doc) return;
  const rows = doc.values.map((v) => ({ key: v.key || '', value: String(v.value ?? ''), disabled: v.enabled === false, type: v.type === 'secret' ? 'secret' : 'default' }));
  const openedKeys = new Set(rows.map((r) => r.key)); // to tell variables added elsewhere from ones deleted here
  const nameIn = h('input', { value: isGlobals ? 'Globals' : doc.name, placeholder: 'e.g. Local, Staging, Production', disabled: isGlobals, spellcheck: 'false' });
  const box = h('div');
  kvTable(box, rows, { secret: true, placeholders: ['Variable', 'Value'] });
  const activate = h('input', { type: 'checkbox', checked: !id || id === state.activeEnv });
  openDialog({
    title: isGlobals ? 'Globals' : id ? 'Edit environment' : 'New environment',
    wide: true,
    body: [
      isGlobals ? h('p', { class: 'hint field' }, 'Globals apply everywhere, with the lowest priority: environment and collection values win.') : h('div', { class: 'field' }, h('label', null, 'Name'), nameIn),
      box,
      h('p', { class: 'hint' }, 'Secret values are hidden on screen. Like everything in ApiMan they are stored only on this computer.'),
      isGlobals ? null : h('label', { class: 'check' }, activate, h('span', null, 'Use this environment')),
    ],
    buttons: [
      ...(id && !isGlobals ? [{ label: 'Delete', danger: true, onClick: async () => { closeDialog(); await deleteEnvironment(id); return false; } }] : []),
      { label: 'Save', primary: true, onClick: async () => {
        const name = isGlobals ? 'Globals' : nameIn.value.trim();
        if (!name) { toast('Give the environment a name.'); return false; }
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
        else { doc.name = name; doc.values = values; envId = await backend.environments.create(doc); }
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
  await backend.environments.create(copy);
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
    ...state.envList.map((e) => h('option', { value: e.id, ...(e.id === state.activeEnv ? { selected: true } : {}) }, e.name)),
    h('option', { value: '__new' }, '+ New environment…'));
  sel.value = state.activeEnv || '';
  $('#envDot').classList.toggle('on', !!state.activeEnv);
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
    peek.append(h('div', { class: 'label' }, name ? `${label}: ${name}` : label));
    if (!values) { peek.append(h('div', { class: 'hint' }, label === 'Environment' ? 'No environment selected.' : 'Open a saved request to see its collection variables.')); continue; }
    const on = values.filter((v) => v.key && v.enabled !== false && !v.disabled);
    if (!on.length) { peek.append(h('div', { class: 'hint' }, 'No variables.')); continue; }
    peek.append(h('table', { class: 'grid' }, h('tbody', null, on.map((v) => {
      const secret = v.type === 'secret' || SECRET_HEADER.test(v.key) || /key$/i.test(v.key);
      const value = String(v.value ?? '');
      const cell = h('td', { class: 'v', title: secret ? '' : value }, secret ? '••••••••' : value);
      let shown = false;
      return h('tr', null, h('td', { title: v.key }, v.key), cell,
        h('td', { class: 'r' }, secret ? h('button', {
          class: 'btn icon small', title: 'Show value', 'aria-label': `Show ${v.key}`,
          onclick: (e) => { shown = !shown; cell.textContent = shown ? value : '••••••••'; cell.title = shown ? value : ''; e.currentTarget.replaceChildren(icon(shown ? 'eyeOff' : 'eye')); },
        }, icon('eye')) : null));
    }))));
  }
  peek.append(h('div', { class: 'actions' },
    h('button', { class: 'btn small', onclick: () => { hideMenu(); if (state.activeEnv) editEnvironment(state.activeEnv); else editEnvironment(null); } }, state.activeEnv ? 'Edit environment' : 'New environment'),
    h('button', { class: 'btn small', onclick: () => { hideMenu(); editEnvironment(GLOBALS_ID); } }, 'Edit globals')));
  pop.replaceChildren(peek);
  pop.setAttribute('role', 'dialog'); // a table and buttons, not a menu
  pop.setAttribute('aria-label', 'Variables in use');
  placePopover(pop, anchor);
  showMenu.anchor = anchor;
  (peek.querySelector('button') || pop).focus();
}

// ---------- import ----------
function openImport(start = 'file') {
  const fileIn = h('input', { type: 'file', 'aria-label': 'Postman files to import', accept: '.json,application/json', multiple: true, hidden: true, onchange: (e) => importFiles([...e.target.files]) });
  const drop = h('div', {
    class: 'drop',
    ondragover: (e) => { e.preventDefault(); },
    ondrop: (e) => { e.preventDefault(); importFiles([...e.dataTransfer.files]); },
  }, h('p', null, 'Drop Postman collection or environment files here (v2.1 JSON).'),
    h('button', { type: 'button', class: 'btn', onclick: () => fileIn.click() }, 'Choose files'), fileIn);
  const curlIn = h('textarea', { class: 'code', 'aria-label': 'cURL command', rows: 10, spellcheck: 'false', placeholder: "curl -X POST 'https://api.example.com/items' \\\n  -H 'Authorization: Bearer …' \\\n  -H 'Content-Type: application/json' \\\n  --data-raw '{\"name\":\"x\"}'" });
  const pasteIn = h('textarea', { class: 'code', 'aria-label': 'Postman collection or environment JSON', rows: 10, spellcheck: 'false', placeholder: 'Paste a Postman collection or environment JSON' });
  const defs = [
    { key: 'file', label: 'File', content: [drop, h('p', { class: 'hint' }, 'In Postman: ⋯ on a collection → Export → Collection v2.1. Environments: ⋯ → Export.')] },
    { key: 'curl', label: 'cURL', content: [curlIn, h('div', { hidden: true }, h('button', { type: 'button', class: 'btn primary', 'data-import': 'curl', onclick: () => {
      try { const ed = parseCurl(curlIn.value); closeDialog(); openTab(newTab({ ed, dirty: true })); toast('Imported from cURL'); } catch (e) { toast(e.message); }
    } }, 'Import cURL'))] },
    { key: 'paste', label: 'Paste JSON', content: [pasteIn, h('div', { hidden: true }, h('button', { type: 'button', class: 'btn primary', 'data-import': 'paste', onclick: async () => {
      try { await importJson(JSON.parse(pasteIn.value), 'pasted JSON'); closeDialog(); } catch (e) { toast(e.message); }
    } }, 'Import'))] },
  ];
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
    title: 'Import', body: tabsAndPanes, onOpen: updateImport, focus: '#dlgBody .dlg-tabs .on',
    buttons: [{ label: 'Import', primary: true, onClick: () => {
      const active = [...tabsAndPanes[0].children].findIndex((b) => b.classList.contains('on'));
      if (active === 0) fileIn.click();
      else $(`#dlgBody [data-import="${active === 1 ? 'curl' : 'paste'}"]`).click();
      return false;
    } }],
  });
  if (start !== 'file') $$('#dlgBody .dlg-tabs .seg-btn')[start === 'curl' ? 1 : 2].click();
  setTimeout(() => { if (start === 'curl') curlIn.focus(); }, 50);
}

async function importFiles(files) {
  let ok = 0;
  for (const f of files) {
    try { await importJson(JSON.parse(await f.text()), f.name); ok++; } catch (e) { toast(`${f.name}: ${e.message}`); }
  }
  if (ok) closeDialog();
}

async function importJson(data, label) {
  if (data && data.info && Array.isArray(data.item)) {
    ensureIds(data.item);
    data.info.schema = data.info.schema || SCHEMA_V21;
    const id = await backend.collections.create(data);
    state.open.add(id);
    saveOpen();
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
      const id = await backend.environments.create(data);
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
  throw new Error(`${label} isn't a Postman collection or environment.`);
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
  const built = buildWire(t.ed, requestSnapshot(t.ed), merged(sc), effectiveAuth(t.ed, t.cid, t.itemId));
  if (built.error) return built;
  const w = built.wire;
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
    if (w.body.kind === 'text') lines.push(`  body: ${dq(w.body.text)},`);
    if (w.body.kind === 'formdata') lines.push('  body: form,');
    if (w.body.kind === 'file') lines.push(`  body: file, // ${w.body.file.name}`);
    lines.push('});', 'console.log(response.status, await response.text());');
    return lines.join('\n');
  } },
  python: { label: 'Python requests', gen(w) {
    const lines = ['import requests', '', `url = ${dq(w.url)}`];
    const headers = w.body.kind === 'formdata' ? w.headers.filter(([k]) => k.toLowerCase() !== 'content-type') : w.headers;
    lines.push('headers = {', ...headers.map(([k, v]) => `    ${dq(k)}: ${dq(v)},`), '}');
    let args = 'headers=headers';
    if (w.body.kind === 'text') { lines.push(`payload = ${dq(w.body.text)}`); args += ', data=payload.encode("utf-8")'; }
    if (w.body.kind === 'formdata') {
      lines.push('data = {', ...w.body.fields.filter((f) => !f.file).map((f) => `    ${dq(f.key)}: ${dq(f.value)},`), '}');
      lines.push('files = {', ...w.body.fields.filter((f) => f.file).map((f) => `    ${dq(f.key)}: open(${dq(f.file.name)}, "rb"),`), '}');
      args += ', data=data, files=files';
    }
    if (w.body.kind === 'file') { lines.push(`with open(${dq(w.body.file.name)}, "rb") as f:`, '    payload = f.read()'); args += ', data=payload'; }
    lines.push('', `response = requests.request(${dq(w.method)}, url, ${args}, timeout=30)`, 'print(response.status_code)', 'print(response.text)');
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
  const mask = h('input', { type: 'checkbox', checked: true });
  const LANG_MODE = { curl: 'shell', fetch: 'javascript', python: 'python', java: 'java' };
  const viewer = codeEditor({ readOnly: true, label: 'Generated code', cls: 'codegen' });
  const pre = { set textContent(v) { if (viewer.cm) { viewer.cm.setValue(v); viewer.cm.setOption('mode', CM_MODES[LANG_MODE[lang]] ?? null); } else viewer.querySelector('pre').textContent = v; },
                get textContent() { return viewer.cm ? viewer.cm.getValue() : viewer.querySelector('pre').textContent; } };
  const tabsBar = h('div', { class: 'seg dlg-tabs', role: 'tablist' });
  const draw = () => {
    tabsBar.replaceChildren(...Object.entries(GENERATORS).map(([k, g]) => h('button', {
      type: 'button', class: `seg-btn ${k === lang ? 'on' : ''}`, role: 'tab', 'aria-selected': String(k === lang), onclick: () => { lang = k; ls.set('apiman:codeLang', k); draw(); tabsBar.querySelector('.on')?.focus(); },
    }, g.label)));
    const r = codeWire(mask.checked);
    pre.textContent = r.error ? `// ${r.error}` : GENERATORS[lang].gen(r.wire);
  };
  mask.addEventListener('change', draw);
  draw();
  openDialog({
    title: 'Generate code',
    focus: '#dlgFoot .btn.primary',
    wide: true,
    body: [tabsBar, viewer,
      h('label', { class: 'check dlg-after' }, mask, h('span', null, 'Hide secrets', h('small', null, 'Masks tokens, API keys and cookies, so the code is safe to paste into chats and tickets.')))],
    buttons: [{ label: 'Copy', primary: true, onClick: async () => { await navigator.clipboard.writeText(pre.textContent); toast('Code copied'); return false; } }],
  });
}

// ---------- runner ----------
async function openRunner(cid, folderId) {
  if (!state.colList.length) { toast('Create or import a collection first.'); return; }
  await Promise.all(state.colList.map((c) => withCol(c.id).catch(() => {})));
  const colSel = h('select');
  const folderSel = h('select');
  const iterIn = h('input', { type: 'number', min: '1', max: '1000', value: '1' });
  const delayIn = h('input', { type: 'number', min: '0', max: '60000', value: '0' });
  const stopOnFail = h('input', { type: 'checkbox' });
  const keepVars = h('input', { type: 'checkbox' }); // opt-in: a run doesn't rewrite your files unless you ask
  for (const c of state.colList) colSel.append(h('option', { value: c.id, ...(c.id === (cid || (cur() && cur().cid)) ? { selected: true } : {}) }, c.name));
  const fillFolders = () => {
    const col = state.cols[colSel.value];
    folderSel.replaceChildren(h('option', { value: '' }, 'Whole collection'));
    const walk = (items, depth) => { for (const it of items) if (isFolder(it)) { folderSel.append(h('option', { value: it.id, ...(it.id === folderId ? { selected: true } : {}) }, `${'– '.repeat(depth)}${it.name}`)); walk(it.item, depth + 1); } };
    if (col) walk(col.item, 0);
  };
  colSel.addEventListener('change', () => { folderId = null; fillFolders(); });
  fillFolders();

  const summary = h('div', { class: 'runner-summary' });
  const bar = h('div', { class: 'bar' }, h('div', { style: 'width:0%' }));
  const tbody = h('tbody');
  const results = h('div', { hidden: true }, summary, bar,
    h('table', { class: 'grid' }, h('thead', null, h('tr', null, h('th', { class: 'tight' }, '#'), h('th', null, 'Request'), ...['Status', 'Time', 'Tests'].map((x) => h('th', { class: 'num' }, x)))), tbody));
  let ctrl = null;

  openDialog({
    title: 'Collection runner',
    cancel: 'Close',
    body: [
      h('div', { class: 'grid-2' }, h('div', { class: 'field' }, h('label', null, 'Collection'), colSel), h('div', { class: 'field' }, h('label', null, 'Folder'), folderSel)),
      h('div', { class: 'grid-2' }, h('div', { class: 'field' }, h('label', null, 'Iterations'), iterIn), h('div', { class: 'field' }, h('label', null, 'Delay between requests (ms)'), delayIn)),
      h('label', { class: 'check' }, keepVars, h('span', null, 'Save variable changes', h('small', null, 'Values set by scripts (like a login token) are saved to the environment and collection.'))),
      h('label', { class: 'check' }, stopOnFail, h('span', null, 'Stop on first failure')),
      results,
    ],
    onClose: () => { if (ctrl) ctrl.abort(); },
    // Not awaited, so the button stays clickable as "Stop" while the run is in progress.
    buttons: [{ label: 'Run', primary: true, onClick: () => {
      if (ctrl) { ctrl.abort(); return false; }
      run().catch((e) => { toast(e.message); ctrl = null; const b = $('#dlgFoot .btn.primary'); if (b) b.textContent = 'Run again'; });
      return false;
    } }],
  });

  async function run() {
      const runCid = colSel.value;
      const col = state.cols[runCid];
      const root = folderSel.value ? locate(col, folderSel.value).item.item : col.item;
      const items = [];
      eachRequest(root, (it) => items.push(it));
      if (!items.length) { toast('There are no requests to run here.'); return; }
      const iterations = Math.max(1, Math.min(1000, Number(iterIn.value) || 1));
      const delay = Math.max(0, Math.min(60000, Number(delayIn.value) || 0));
      const runBtn = $('#dlgFoot .btn.primary');
      ctrl = new AbortController();
      runBtn.textContent = 'Stop';
      results.hidden = false;
      tbody.replaceChildren();
      let n = 0, pass = 0, fail = 0, errors = 0, totalMs = 0, ok = 0, c4 = 0, c5 = 0;
      let runScopes = scopesFor(runCid);
      const total = items.length * iterations;
      const started = performance.now();
      outer: for (let it = 0; it < iterations; it++) {
        for (const item of items) {
          if (ctrl.signal.aborted) break outer;
          const ed = fromItem(item);
          // Values set by scripts carry through the whole run (like Postman), saved or not.
          const out = await execute({ ed, cid: runCid, itemId: item.id, iteration: it, signal: ctrl.signal, persist: keepVars.checked, runScopes: keepVars.checked ? null : runScopes });
          if (!keepVars.checked && out.scopes) {
            // carry script values to the next request, except ones that decide where requests go (URL/Host)
            const { names } = await urlVariableNames();
            for (const sc of ['environment', 'collection', 'globals']) {
              for (const k of new Set([...Object.keys(runScopes[sc]), ...Object.keys(out.scopes[sc])])) {
                if (!names.has(k) || runScopes[sc][k] === out.scopes[sc][k]) continue;
                if (Object.hasOwn(runScopes[sc], k)) out.scopes[sc][k] = runScopes[sc][k]; else delete out.scopes[sc][k];
                out.logs.push({ level: 'warn', text: `Not carried to the next request: ${sc} variable "${k}" decides where requests go.`, src: 'ApiMan' });
              }
            }
            runScopes = out.scopes;
          }
          n++;
          const tp = out.tests.filter((x) => x.passed === true).length;
          const tf = out.tests.filter((x) => x.passed === false).length;
          pass += tp; fail += tf;
          if (out.error) errors++;
          else if (out.res.status >= 500) c5++;
          else if (out.res.status >= 400) c4++;
          else ok++;
          if (out.res && !out.error) totalMs += out.res.timeMs;
          const sc = out.error ? 'err' : `s${String(out.res.status)[0]}`;
          tbody.append(h('tr', null,
            h('td', { class: 'tight' }, iterations > 1 ? `${it + 1}.${items.indexOf(item) + 1}` : String(n)),
            h('td', null, h('span', { class: `mtag ${ed.method}` }, ed.method), ' ', ed.name,
              ...out.tests.filter((x) => x.passed === false).map((x) => h('div', { class: 'runner-fail' }, h('span', { class: 'pill err' }, 'Fail'), `${x.name}: ${x.error}`)),
              out.error ? h('div', { class: 'runner-fail' }, h('span', { class: 'pill err' }, 'Error'), out.error) : null),
            h('td', { class: 'num' }, (out.error ? '–' : h('span', { class: `status-code ${sc}` }, String(out.res.status)))),
            h('td', { class: 'num' }, out.res && !out.error ? fmtMs(out.res.timeMs) : '–'),
            h('td', { class: 'num' }, out.tests.length ? `${tp}/${out.tests.length}` : '–')));
          bar.firstChild.style.width = `${(n / total) * 100}%`;
          bar.classList.toggle('has-fail', fail + errors + c5 > 0);
          bar.classList.toggle('has-warn', !(fail + errors + c5) && c4 > 0);
          const outcome = [`${ok} succeeded`, ...(c4 ? [`${c4} returned 4xx`] : []), ...(c5 ? [`${c5} returned 5xx`] : []), ...(errors ? [`${errors} not sent`] : [])].join(', ');
          summary.replaceChildren(
            h('span', null, h('b', null, `${n} of ${total}`), ` requests: ${outcome}`),
            h('span', null, 'Tests: ', h('span', { class: `big ${pass ? 'pass' : 'zero'}` }, `${pass} passed`), ' ', h('span', { class: `big ${fail ? 'fail' : 'zero'}` }, `${fail} failed`)),
            h('span', null, `Average ${n - errors ? fmtMs(Math.round(totalMs / Math.max(1, n - errors))) : '–'}`));
          if (stopOnFail.checked && (tf || out.error)) break outer;
          if (delay) await new Promise((r) => { const tm = setTimeout(r, delay); ctrl.signal.addEventListener('abort', () => { clearTimeout(tm); r(); }, { once: true }); });
        }
      }
      summary.append(h('span', null, `${ctrl.signal.aborted ? 'Stopped' : 'Finished'} in ${fmtMs(Math.round(performance.now() - started))}`));
      ctrl = null;
      runBtn.textContent = 'Run again';
      if (state.view === 'environments') renderSidebar();
      renderResolved();
  }
}

// ---------- settings ----------
function openSettings(initial = null, layoutSnap = null) {
  const s = state.settings;
  const snap = layoutSnap || initResizers.snapshot(); // panel sizes when Settings opened: Cancel goes back to these
  const draft = { ...s, ...(initial || {}) };
  let saved = false, reopening = false;
  let syncSizesRef = null;
  const preview = () => { applyAppearance(draft); requestAnimationFrame(() => requestAnimationFrame(() => syncSizesRef && syncSizesRef())); };
  const seg = (key, options, label) => {
    const bar = h('div', { class: 'seg', role: 'radiogroup', 'aria-label': label });
    const draw = () => bar.replaceChildren(...options.map(([v, l]) => h('button', {
      type: 'button', class: `seg-btn ${draft[key] === v ? 'on' : ''}`, role: 'radio', 'aria-checked': String(draft[key] === v),
      onclick: () => { draft[key] = v; draw(); bar.querySelector('[aria-checked="true"]')?.focus(); if (key === 'theme') previewTheme(); else preview(); },
    }, l)));
    draw();
    return bar;
  };
  const previewTheme = () => {
    if (draft.theme === 'light' || draft.theme === 'dark') document.documentElement.dataset.theme = draft.theme;
    else delete document.documentElement.dataset.theme;
    drawSwatches();
    preview();
  };
  // Every size is a slider AND an exact number field, kept in sync.
  const slider = (key, min, max, step, unit, label, scale = 1) => {
    const shown = (v) => String(Math.round(v * scale * 100) / 100);
    const num = h('input', { type: 'number', class: 'num-input', min: String(min * scale), max: String(max * scale), step: String(step * scale), value: shown(draft[key]), 'aria-label': `${label} (${unit})` });
    const range = h('input', { type: 'range', min: String(min), max: String(max), step: String(step), value: String(draft[key]), 'aria-label': label });
    range.addEventListener('input', () => { draft[key] = Number(range.value); num.value = shown(draft[key]); preview(); });
    num.addEventListener('change', () => { draft[key] = clampNum(Number(num.value) / scale, min, max, draft[key]); range.value = String(draft[key]); num.value = shown(draft[key]); preview(); });
    return h('div', { class: 'field' }, h('span', { class: 'label' }, label), h('div', { class: 'slider-row' }, range, num, h('span', { class: 'unit' }, unit)));
  };
  const select = (key, options, label) => h('div', { class: 'field' }, h('label', null, label),
    h('select', { onchange: (e) => { draft[key] = e.target.value; preview(); } },
      ...Object.entries(options).map(([v, [l]]) => h('option', { value: v, ...(draft[key] === v ? { selected: true } : {}) }, l))));
  if (draft.densityScale == null) draft.densityScale = DENSITY[draft.density] || 1;
  if (initial) setTimeout(() => { if (initial.theme === 'light' || initial.theme === 'dark') document.documentElement.dataset.theme = initial.theme; else delete document.documentElement.dataset.theme; applyAppearance(draft); }, 0);
  // exact panel sizes (applied immediately, like dragging)
  // Exact sizes, in the unit you prefer (96 px = 1 inch). Every field always shows the size actually rendered.
  let unit = ls.get('apiman:sizeUnit', 'px');
  const PER = { px: 1, in: 96, cm: 96 / 2.54 };
  const show = (px) => (unit === 'px' ? String(Math.round(px)) : String(Math.round((px / PER[unit]) * 100) / 100));
  const sideNum = h('input', { type: 'number', class: 'num-input', step: 'any', 'aria-label': 'Sidebar width' });
  const reqNum = h('input', { type: 'number', class: 'num-input', step: 'any', 'aria-label': 'Request pane size' });
  const splitNum = h('input', { type: 'number', class: 'num-input', min: '15', max: '85', step: '0.5', 'aria-label': 'Request pane share in percent' });
  const unitSel = h('select', { class: 'unit-select', 'aria-label': 'Size unit' }, ...['px', 'in', 'cm'].map((u) => h('option', { value: u, ...(u === unit ? { selected: true } : {}) }, u)));
  const unitTxt = () => $$('.size-unit', unitSel.closest('.dlg-body') || document).forEach((el) => { el.textContent = unit; });
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
  const custom = h('input', { type: 'color', value: draft.accentCustom || '#2560cf', 'aria-label': 'Custom accent colour', title: 'Custom colour',
    oninput: (e) => { draft.accent = 'custom'; draft.accentCustom = e.target.value; drawSwatches(); preview(); } });
  const drawSwatches = () => swatches.replaceChildren(...Object.entries(ACCENTS).map(([k, [light, darkC]]) => h('button', {
    type: 'button', class: `swatch ${draft.accent === k ? 'on' : ''}`, role: 'radio', 'aria-checked': String(draft.accent === k), 'aria-label': k, title: k,
    style: `--sw: ${effectiveTheme(draft) === 'dark' ? darkC : light}`, onclick: () => { draft.accent = k; drawSwatches(); preview(); },
  })), h('label', { class: `swatch custom ${draft.accent === 'custom' ? 'on' : ''}`, title: 'Custom colour' }, custom));
  drawSwatches();
  const timeout = h('input', { type: 'number', min: '1', max: '600', value: String(s.timeout) });
  const follow = h('input', { type: 'checkbox', checked: s.followRedirects });
  const hist = h('input', { type: 'checkbox', checked: s.history });
  const insecure = h('input', { type: 'checkbox', checked: s.insecure });
  const wrap = h('input', { type: 'checkbox', checked: draft.wrap !== false, onchange: (e) => { draft.wrap = e.target.checked; preview(); } });

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
      h('label', { class: 'check align-end' }, wrap, h('span', null, 'Wrap long lines in responses'))),
    h('div', { class: 'grid-2 desktop-only' },
      h('div', { class: 'field' }, h('span', { class: 'label' }, 'Request and response'), seg('layout', [['auto', 'Side by side'], ['stacked', 'Stacked']], 'Layout'),
        h('span', { class: 'hint', id: 'autoStackNote', hidden: document.documentElement.dataset.autoStack !== 'true' }, 'Stacked automatically right now: side by side, each pane would be too narrow.')),
      h('div', { class: 'field' }, h('span', { class: 'label' }, 'Sidebar'), seg('sidePosition', [['left', 'Left'], ['right', 'Right']], 'Sidebar position'))),
    h('div', { class: 'grid-3 desktop-only' },
      h('div', { class: 'field' }, h('span', { class: 'label' }, 'Sidebar width'), h('div', { class: 'slider-row' }, sideNum, unitSel)),
      h('div', { class: 'field' }, h('span', { class: 'label', id: 'reqSizeLabel' }, initResizers.isStacked() ? 'Request pane height' : 'Request pane width'), h('div', { class: 'slider-row' }, reqNum, h('span', { class: 'unit size-unit' }, unit))),
      h('div', { class: 'field' }, h('span', { class: 'label' }, 'Request pane share'), h('div', { class: 'slider-row' }, splitNum, h('span', { class: 'unit' }, '%')))),
    h('div', { class: 'field-row desktop-only' },
      h('button', { type: 'button', class: 'btn small', onclick: () => { initResizers.reset(); syncSizes(); toast('Panel sizes reset'); } }, 'Reset panel sizes'),
      h('span', { class: 'hint' }, 'Drag the lines between panels to resize them (sizes show while dragging). Double-click a line to reset it. Cmd/Ctrl+B hides the sidebar.')),
  ];
  const requests = [
    h('div', { class: 'field narrow' }, h('label', null, 'Request timeout (seconds)'), timeout),
    h('label', { class: 'check' }, follow, h('span', null, 'Follow redirects', h('small', null, 'Credentials are never forwarded to a different site, and HTTPS never downgrades to HTTP.'))),
    h('label', { class: 'check' }, hist, h('span', null, 'Keep request history', h('small', null, 'Stored only in this browser. It includes request details as you typed them.'))),
    backend.mode === 'local'
      ? h('label', { class: 'check' }, insecure, h('span', null, 'Skip TLS certificate checks', h('small', null, 'Last resort for internal servers with self-signed certificates: it lets an attacker on the network read your traffic. Prefer starting the server with ', h('code', { class: 'inline' }, '--ca-file'), '.')))
      : h('p', { class: 'hint' }, 'Website mode: the browser sends requests, so certificate and CORS rules apply. Run ApiMan locally (python3 server.py) to call any API, including internal ones over VPN.'),
    h('p', { class: 'hint' }, $('#dataDir').textContent),
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
        setTimeout(() => { openSettings(defaults, snap); toast('Defaults loaded. Save to keep them, or Cancel to go back.'); }, 0);
        return true;
      } },
      { label: 'Save', primary: true, onClick: () => {
        Object.assign(s, {
          theme: draft.theme, textScale: draft.textScale, codeSize: draft.codeSize, density: draft.density, layout: draft.layout, wrap: draft.wrap,
          densityScale: draft.densityScale, lineHeight: draft.lineHeight, tabSize: Number(draft.tabSize) || 2, uiFont: draft.uiFont, codeFont: draft.codeFont,
          accent: draft.accent, accentCustom: draft.accentCustom, tabStyle: draft.tabStyle, sendStyle: draft.sendStyle, sidePosition: draft.sidePosition, sideHidden: !!draft.sideHidden,
          timeout: Math.max(1, Math.min(600, Number(timeout.value) || 60)),
          followRedirects: follow.checked, history: hist.checked, insecure: backend.mode === 'local' && insecure.checked,
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
function bindEditor() {
  const ed = () => cur().ed;
  $('#reqName').addEventListener('input', (e) => { ed().name = e.target.value; markDirty(); renderTabs(); });
  $('#method').addEventListener('change', (e) => { ed().method = e.target.value; $('#reqbar').dataset.method = e.target.value; markDirty(); renderTabs(); });
  $('#url').addEventListener('input', (e) => {
    const t = cur();
    t.ed.url = e.target.value;
    t.ed.params = [...parseQuery(t.ed.url), ...t.ed.params.filter((p) => p.disabled)];
    t.ed.pathVars = syncPathVars(t.ed.url, t.ed.pathVars || []);
    if (t.reqTab === 'params') renderParams();
    renderResolved();
    renderCounts();
    markDirty();
  });
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
      } catch (err) { toast(err.message); }
    }
  });
  $('#btnSend').addEventListener('click', send);
  $('#btnSave').addEventListener('click', () => save().catch((e) => toast(e.message)));
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
    try { text = JSON.stringify(JSON.parse(text), null, 2); } catch { /* raw */ }
    navigator.clipboard.writeText(text).then(() => toast('Response copied'), () => toast('Copy failed'));
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
    { label: 'Collection', onClick: () => newCollection().catch((err) => toast(err.message)) },
    { label: 'Environment', onClick: () => editEnvironment(null) },
    { label: 'Request from cURL', onClick: () => openImport('curl') },
  ]));
  $('#btnImport').addEventListener('click', () => openImport());
  $('#btnRunner').addEventListener('click', () => openRunner(cur() && cur().cid, null));
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
  });

  document.addEventListener('keydown', (e) => {
    const mod = e.metaKey || e.ctrlKey;
    if (e.key === 'Escape' && !$('#popover').hidden) { hideMenu(); return; }
    if ($('#dlg').open) return; // never send/save the request behind a dialog
    if (mod && e.key === 'Enter') { e.preventDefault(); if (cur()) send(); return; }
    if (mod && e.key.toLowerCase() === 's') { e.preventDefault(); if (cur()) save().catch((err) => toast(err.message)); return; }
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
    const files = [...e.dataTransfer.files].filter((f) => f.name.endsWith('.json'));
    if (files.length) { e.preventDefault(); importFiles(files); }
  });
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', applyTheme);
}

// ---------- browser-mode folder ----------
async function useFolder(dir) {
  backend = makeBackend('browser', dir);
  state.cols = {};
  state.envs = {};
  state.tabs = state.tabs.filter((t) => !t.cid);
  state.active = state.tabs.length - 1;
  $('#dataDir').textContent = `Folder "${dir.name}" on this computer`;
  const btn = $('#btnFolder');
  btn.textContent = 'Change folder';
  btn.onclick = () => pickFolder().catch((e) => e.name !== 'AbortError' && toast(e.message));
  await Promise.all([refreshCollections(), refreshEnvironments()]);
  renderEnvPicker();
  renderAll();
}
async function pickFolder() {
  if (state.tabs.some((t) => t.dirty && t.cid) && !(await ask({ title: 'Switch folder?', message: 'Tabs from the current collections will close, and their unsaved changes will be lost.', ok: 'Switch folder', danger: true }))) return;
  const dir = await window.showDirectoryPicker({ id: 'apiman', mode: 'readwrite' });
  await idbHandle('set', dir);
  await useFolder(dir);
  toast(`Saving to the "${dir.name}" folder`);
}

// =====================================================================================================
// Start
// =====================================================================================================
/** Drag handles for the sidebar and the request/response split (mouse, touch and arrow keys); sizes are remembered. */
function initResizers() {
  const root = document.documentElement;
  const layout = ls.get('apiman:layout', {});
  const save = (k, v) => { layout[k] = v; ls.set('apiman:layout', layout); };
  const stacked = () => document.documentElement.dataset.layout === 'stacked' || document.documentElement.dataset.autoStack === 'true' || matchMedia('(max-width: 1180px)').matches;
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
    const [reqMin, respMin] = stacked() ? [120 * cssScale(), respBars + 180] : paneNeeds(); // stacked: response keeps 180px of body
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
  };
  setSideW(layout.side || 288, false);
  setSplit((stacked() ? layout.reqH || 35 : layout.req || 50), false);
  if (layout.req) root.style.setProperty('--req-w', `${layout.req}%`);
  if (layout.reqH) root.style.setProperty('--req-h', `${layout.reqH}%`);
  matchMedia('(max-width: 1180px)').addEventListener('change', () => setSplit((stacked() ? layout.reqH || 35 : layout.req || 50), false));
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
  initResizers.snapshot = () => ({ ...ls.get('apiman:layout', {}) });
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
    tools.classList.remove('wrap', 'icons', 'short', 'squeeze', 'no-size', 'no-time');
    view.querySelectorAll('.ovf').forEach((b) => b.classList.remove('ovf'));
    const over = () => { // anything past the content edge (into the padding) counts as overflow
      const edge = tools.getBoundingClientRect().right - parseFloat(getComputedStyle(tools).paddingRight) + 0.5;
      return tools.scrollWidth > tools.clientWidth + 1 || [...tools.querySelectorAll(':scope > *, .tool-group > *')].some((el) => el.getClientRects().length && el.getBoundingClientRect().right > edge);
    };
    for (const step of ['short', 'icons']) if (over()) tools.classList.add(step);
    if (over()) { tools.classList.add('squeeze'); fitTabs(view); tools.classList.remove('squeeze'); } // hide extra views, then keep the rest whole
    else fitTabs(view);
    for (const step of ['no-size', 'no-time']) if (over()) tools.classList.add(step);
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
  dlgEl.addEventListener('cancel', () => { closingSeq = dialogSeq; });
  dlgEl.addEventListener('submit', (e) => { if (e.submitter && e.submitter.value === 'cancel') closingSeq = dialogSeq; });
  $('#dlg').addEventListener('close', () => {
    document.documentElement.classList.remove('drawer-open'); // the app takes the full width again
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
    $('#dataDir').textContent = `Data folder: ${info.dataDir}`;
  } else {
    backend = makeBackend('browser');
    badge.textContent = 'Browser';
    badge.className = 'pill';
    badge.title = 'Requests are sent by this browser, so the API must allow CORS. Run ApiMan locally to call any API.';
    state.settings.insecure = false;
    $('#dataDir').textContent = /\.github\.io$/.test(location.hostname)
      ? `Saved in this browser. Note: every site on ${location.hostname} can read this browser storage, so keep real secrets in local mode (python3 server.py) or a folder.`
      : 'Saved in this browser.';
    if (window.showDirectoryPicker) {
      const btn = $('#btnFolder');
      btn.hidden = false;
      btn.onclick = () => pickFolder().catch((e) => e.name !== 'AbortError' && toast(e.message));
      const dir = await idbHandle('get').catch(() => null);
      if (dir) {
        if ((await dir.queryPermission({ mode: 'readwrite' })) === 'granted') {
          backend = makeBackend('browser', dir);
          $('#dataDir').textContent = `Folder "${dir.name}" on this computer`;
          btn.textContent = 'Change folder';
        } else {
          btn.textContent = `Reconnect folder "${dir.name}"`;
          btn.onclick = async () => { if ((await dir.requestPermission({ mode: 'readwrite' })) === 'granted') await useFolder(dir); };
        }
      }
    }
  }
  try {
    await Promise.all([refreshCollections(), refreshEnvironments()]);
    await restoreTabs();
  } catch (e) {
    toast(`Couldn't load your data: ${e.message}`);
  }
  renderEnvPicker();
  renderAll();
}

start();
