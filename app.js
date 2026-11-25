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
  toast.timer = setTimeout(() => t.classList.remove('show'), 3600);
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
const SCHEMA_V21 = 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json';
const isLocalHost = (host) => ['localhost', '127.0.0.1', '[::1]'].includes(host);

// =====================================================================================================
// Settings & state
// =====================================================================================================
const DEFAULT_SETTINGS = { theme: 'system', timeout: 60, followRedirects: true, history: true, insecure: false };

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
}
function effectiveTheme() {
  const t = state.settings.theme;
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
  const base = String(name).replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^[-.]+|[-.]+$/g, '').slice(0, 80) || 'untitled';
  let id = `${base}.json`;
  for (let n = 2; exists(id); n++) id = `${base}-${n}.json`;
  return id;
}

async function api(method, path, body) {
  const r = await fetch(path, {
    method,
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : {},
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error || r.statusText);
  return data;
}

function serverStore(kind) {
  const base = `/api/${kind}`;
  return {
    list: () => api('GET', base),
    get: (id) => api('GET', `${base}/${encodeURIComponent(id)}`),
    put: (id, d) => api('PUT', `${base}/${encodeURIComponent(id)}`, d),
    create: async (d) => (await api('POST', base, { document: d })).id,
    remove: (id) => api('DELETE', `${base}/${encodeURIComponent(id)}`),
  };
}

function browserStore(kind) {
  const key = `apiman:${kind}`;
  const { validate, nameOf } = KINDS[kind];
  const read = () => ls.get(key, {});
  const write = (all) => {
    if (!ls.set(key, all)) throw new Error('Browser storage is full or blocked. Use a folder (Chrome/Edge) or run ApiMan locally.');
  };
  return {
    async list() { return Object.entries(read()).map(([id, d]) => ({ id, name: nameOf(d) })).sort((a, b) => a.name.localeCompare(b.name)); },
    async get(id) { const d = read()[id]; if (!d) throw new Error('Not found'); return d; },
    async put(id, d) { validate(d); const all = read(); all[id] = d; write(all); },
    async create(d) { validate(d); const all = read(); const id = newDocId(nameOf(d), (x) => x in all); all[id] = d; write(all); return id; },
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
    async create(d) { validate(d); const names = new Set(await files()); const id = newDocId(nameOf(d), (x) => names.has(x)); await write(id, d); return id; },
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

async function serverSend(wire) {
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
  return api('POST', '/api/send', spec);
}

async function browserSend(wire, signal) {
  const target = new URL(wire.url);
  if (location.protocol === 'https:' && target.protocol === 'http:' && !isLocalHost(target.hostname)) {
    return { error: 'Browsers block plain http:// APIs from a secure page. Use https://, or run ApiMan locally (python3 server.py).' };
  }
  const { payload, isForm } = await materializeBody(wire.body);
  const noBody = ['GET', 'HEAD'].includes(wire.method);
  const headers = wire.headers.filter(([k]) => !(isForm && k.toLowerCase() === 'content-type'));
  const timeout = AbortSignal.timeout ? AbortSignal.timeout(state.settings.timeout * 1000) : null;
  const sig = signal && timeout && AbortSignal.any ? AbortSignal.any([signal, timeout]) : (signal || timeout);
  const start = performance.now();
  let r;
  try {
    r = await fetch(wire.url, {
      method: wire.method, headers, body: noBody ? undefined : payload,
      credentials: 'omit', redirect: state.settings.followRedirects ? 'follow' : 'manual', signal: sig,
    });
  } catch (e) {
    if (e.name === 'TimeoutError') return { error: `No response within ${state.settings.timeout} s.` };
    if (e.name === 'AbortError') return { error: 'Request cancelled.' };
    return { error: `The browser couldn't complete this request. Either ${target.host} doesn't allow cross-site requests (CORS), `
      + 'or it isn\'t reachable from here. Run ApiMan locally (python3 server.py) to call any API without CORS limits.' };
  }
  if (r.type === 'opaqueredirect') {
    return { error: 'The API answered with a redirect. Browsers hide redirect details; turn on "Follow redirects" in Settings or run ApiMan locally.' };
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
    body.formdata = (Array.isArray(b.formdata) ? b.formdata : []).map((x) => ({
      key: String(x.key ?? ''), value: x.type === 'file' ? '' : String(x.value ?? ''), type: x.type === 'file' ? 'file' : 'text',
      src: Array.isArray(x.src) ? x.src.join(', ') : (x.src || ''), disabled: !!x.disabled, file: null,
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
        ? { key: r.key, type: 'file', src: r.file ? r.file.name : r.src, ...(r.disabled ? { disabled: true } : {}) }
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
  if (!u) return { raw: '', disabled: [] };
  if (typeof u === 'string') return { raw: u, disabled: [] };
  const disabled = kvIn(u.query).filter((q) => q.disabled);
  if (u.raw) return { raw: String(u.raw), disabled };
  const host = Array.isArray(u.host) ? u.host.join('.') : (u.host || '');
  const path = Array.isArray(u.path) ? u.path.join('/') : (u.path || '');
  const q = kvIn(u.query).filter((x) => !x.disabled).map((x) => `${x.key}=${x.value}`).join('&');
  return { raw: `${u.protocol ? u.protocol + '://' : ''}${host}${u.port ? ':' + u.port : ''}${path ? '/' + path : ''}${q ? '?' + q : ''}`, disabled };
}
/** Same split Postman uses, so files stay readable by Postman. */
function urlOut(raw, params) {
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
  return out;
}

function parseQuery(url) {
  const q = url.split('#')[0];
  const i = q.indexOf('?');
  if (i === -1) return [];
  return q.slice(i + 1).split('&').filter((p) => p !== '').map((p) => {
    const eq = p.indexOf('=');
    return { key: eq === -1 ? p : p.slice(0, eq), value: eq === -1 ? '' : p.slice(eq + 1), disabled: false };
  });
}
function withQuery(url, params) {
  const hashAt = url.indexOf('#');
  const hash = hashAt === -1 ? '' : url.slice(hashAt);
  const base = (hashAt === -1 ? url : url.slice(0, hashAt)).split('?')[0];
  const q = params.filter((p) => !p.disabled && (p.key || p.value)).map((p) => (p.value === '' && !p.keepEq ? p.key : `${p.key}=${p.value}`)).join('&');
  return base + (q ? '?' + q : '') + hash;
}

function blankEd() {
  return {
    name: 'Untitled request', method: 'GET', url: '', params: [], headers: [],
    auth: { type: 'inherit' }, body: blankBody(), pre: '', test: '', docs: '',
  };
}
function fromItem(item) {
  const req = typeof item.request === 'string' ? { url: item.request, method: 'GET' } : (item.request || {});
  const ed = blankEd();
  ed.name = item.name || 'Untitled request';
  const method = String(req.method || 'GET').toUpperCase();
  ed.method = /^[A-Z]{1,16}$/.test(method) ? method : 'GET'; // imported files are untrusted: no "GET; rm -rf ~"
  const u = urlIn(req.url);
  ed.url = u.raw;
  ed.params = [...parseQuery(u.raw), ...u.disabled];
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
  const req = { ...origReq, method: ed.method, header: kvOut(ed.headers), url: urlOut(ed.url, ed.params) };
  const auth = authOut(ed.auth);
  if (auth) req.auth = auth; else delete req.auth;
  const body = bodyOut(ed.body);
  if (body) req.body = body; else delete req.body;
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
function ensureIds(items) {
  let changed = false;
  for (const it of items) {
    if (!it || typeof it !== 'object') continue;
    if (!it.id) { it.id = uid(); changed = true; }
    if (Array.isArray(it.item)) changed = ensureIds(it.item) || changed;
  }
  return changed;
}
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
function eachRequest(items, fn, parents = []) {
  for (const it of items) {
    if (Array.isArray(it.item)) eachRequest(it.item, fn, [...parents, it]);
    else fn(it, parents);
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
    const next = s.replace(VAR_RE, (m, k) => (k in vars ? vars[k] : (dynamicVar(k) ?? m)));
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
  const logs = [], tests = [], pending = [];
  const show = (v) => { if (typeof v === 'string') return v; try { return JSON.stringify(v); } catch (_) { return String(v); } };
  const cons = {};
  for (const level of ['log', 'info', 'warn', 'error', 'debug']) cons[level] = (...a) => { if (logs.length < 500) logs.push({ level, text: a.map(show).join(' ').slice(0, 5000) }); };

  const V = ctx.vars;
  const str = (v) => (v == null ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v));
  const VAR_RE = /{{\s*([^{}]+?)\s*}}/g;
  const all = () => Object.assign({}, V.globals, V.collection, V.environment, V.local);
  const replaceIn = (s) => String(s).replace(VAR_RE, (m, k) => { const a = all(); return k in a ? a[k] : m; });
  const scope = (o, extra) => Object.assign({
    get: (k) => o[k], set: (k, v) => { o[k] = str(v); }, unset: (k) => { delete o[k]; }, has: (k) => k in o,
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
      has: (k) => k in all(), toObject: all, replaceIn,
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
  let url = r(req.url).trim();
  if (url && !/^[a-z][\w+.-]*:\/\//i.test(url)) url = 'http://' + url;
  const headers = req.headers.map(([k, v]) => [r(k).trim(), r(v)]).filter(([k]) => k);
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
async function persistScopes(cid, before, after, logs) {
  const sync = (values, b, a, mk) => {
    let changed = false;
    for (const [k, v] of Object.entries(a)) {
      if (b[k] === v) continue;
      const entry = values.find((x) => x.key === k);
      if (entry) { entry.value = v; if ('enabled' in entry) entry.enabled = true; delete entry.disabled; } else values.push(mk(k, v));
      changed = true;
    }
    for (const k of Object.keys(b)) {
      if (!(k in a)) { const i = values.findIndex((x) => x.key === k); if (i !== -1) { values.splice(i, 1); changed = true; } }
    }
    return changed;
  };
  const envMk = (key, value) => ({ key, value, type: 'default', enabled: true });

  if (state.activeEnv && state.envs[state.activeEnv]) {
    const doc = state.envs[state.activeEnv];
    if (sync(doc.values, before.environment, after.environment, envMk)) await backend.environments.put(state.activeEnv, doc);
  } else if (JSON.stringify(before.environment) !== JSON.stringify(after.environment)) {
    logs.push({ level: 'warn', text: 'pm.environment changes were ignored because no environment is selected.', src: 'ApiMan' });
  }
  if (JSON.stringify(before.globals) !== JSON.stringify(after.globals)) {
    const doc = await ensureGlobals();
    if (sync(doc.values, before.globals, after.globals, envMk)) await backend.environments.put(GLOBALS_ID, doc);
  }
  const col = cid && state.cols[cid];
  if (col) {
    col.variable = col.variable || [];
    if (sync(col.variable, before.collection, after.collection, (key, value) => ({ key, value }))) await backend.collections.put(cid, col);
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
 * Scripts can't make network calls, but they can change (or delete) variables, and a variable can
 * decide where a later request goes. So instead of guessing from names, resolve the URL of every
 * saved request in every collection (environments and globals are shared) with the variables
 * before and after the script ran. If any destination would change, the user must approve; in
 * the runner (no one to ask) all of the script's variable changes are dropped. Because no saved
 * variable can move a destination without approval, the saved variables are a trusted baseline
 * for the per-request check in execute().
 */
async function guardVarChanges(cid, ed, before, after, ask, logs) {
  const changed = [];
  for (const scope of ['environment', 'collection', 'globals']) {
    const b = before[scope], a = after[scope];
    for (const k of new Set([...Object.keys(b), ...Object.keys(a)])) {
      if (b[k] === a[k]) continue;
      changed.push(`${scope}.${k}`);
      logs.push({ level: 'info', text: `Script ${k in a ? 'set' : 'removed'} ${scope} variable "${k}"`, src: 'ApiMan' });
    }
  }
  if (!changed.length) return after;

  await Promise.all(state.colList.map((c) => withCol(c.id).catch(() => {})));
  const varsFor = (sc, colId) => merged({ globals: sc.globals, environment: sc.environment, local: {},
    collection: colId === cid ? sc.collection : colObj(state.cols[colId]) });
  const moved = [];
  const check = (name, rawUrl, colId) => {
    const from = originOf(resolve(rawUrl, varsFor(before, colId)));
    const to = originOf(resolve(rawUrl, varsFor(after, colId)));
    if (from !== to) moved.push(`  ${name}: ${from || '(unresolved)'} → ${to || '(unresolved)'}`);
  };
  for (const c of state.colList) {
    const col = state.cols[c.id];
    if (col) eachRequest(col.item, (it) => check(`${c.name} / ${it.name || 'Untitled'}`, urlIn(it.request && it.request.url).raw, c.id));
  }
  if (!cid) check(ed.name, ed.url, null);
  if (!moved.length) return after;

  const shown = moved.slice(0, 6).join('\n') + (moved.length > 6 ? `\n  …and ${moved.length - 6} more` : '');
  const ok = ask ? await ask(`A script changed variables (${changed.join(', ')}) so that these requests would go to a different server:\n\n${shown}\n\nSave the changes? Only allow this if you trust the scripts in this collection.`) : false;
  if (ok) return after;
  logs.push({ level: 'warn', text: `Not saved: the script's variable changes (${changed.join(', ')}) would change where ${moved.length} request${moved.length > 1 ? 's' : ''} go${ask ? '' : '. Send the request on its own to approve them'}.`, src: 'ApiMan' });
  return JSON.parse(JSON.stringify(before));
}

/**
 * Runs the whole pipeline for an editor model. Used by Send (ask = confirm dialog) and by the
 * collection runner (ask = null: anything that needs approval is blocked).
 */
async function execute({ ed, cid, itemId, iteration = 0, signal, persist = true, ask = null }) {
  const logs = [], tests = [], warnings = [];
  const before = scopesFor(cid);
  let scopes = JSON.parse(JSON.stringify(before));
  let req = requestSnapshot(ed);
  const plannedOrigin = originOf(resolve(ed.url, merged(before)));
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
  const approvalKey = `${cid || 'scratch'}:${itemId || ed.name} -> ${finalOrigin}`;
  if (preScripts.length && finalOrigin !== plannedOrigin && !approvedOrigins.has(approvalKey)) {
    const msg = `A pre-request script changed where this request goes:\n\n  from ${plannedOrigin || '(unresolved URL)'}\n  to   ${finalOrigin}\n\nSend it there, including your auth headers? Only allow this if you trust the scripts in this collection.`;
    if (!(ask && await ask(msg))) {
      logs.push({ level: 'warn', text: `Blocked: a script redirected the request to ${finalOrigin}.`, src: 'ApiMan' });
      return { error: `Not sent: a pre-request script changed the destination to ${finalOrigin}${ask ? '' : '. Send this request on its own to approve it'}.`, logs, tests, warnings };
    }
    approvedOrigins.add(approvalKey);
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
    res = { error: backend.mode === 'local' ? `ApiMan's local server isn't reachable. Is "python3 server.py" still running? (${e.message})` : e.message };
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
      await persistScopes(cid, before, scopes, logs);
    } catch (e) { logs.push({ level: 'error', text: `Couldn't save variable changes: ${e.message}`, src: 'ApiMan' }); }
  }
  return { res, wire, tests, logs, warnings, error: res.error || '' };
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
async function saveCol(id) { await backend.collections.put(id, state.cols[id]); }

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
}

async function ensureGlobals() {
  if (!state.envs[GLOBALS_ID]) {
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

function openTab(tab) {
  state.tabs.push(tab);
  state.active = state.tabs.length - 1;
  persistTabs();
  renderAll();
}

function openItem(cid, itemId) {
  const existing = state.tabs.findIndex((t) => t.cid === cid && t.itemId === itemId);
  if (existing !== -1) { state.active = existing; persistTabs(); renderAll(); return; }
  const loc = locate(state.cols[cid], itemId);
  if (!loc) return;
  openTab(newTab({ cid, itemId, ed: fromItem(loc.item) }));
}

function closeTab(i) {
  const t = state.tabs[i];
  if (t.dirty && !confirm(`Close "${t.ed.name}" without saving your changes?`)) return;
  if (t.sending) t.sending.abort();
  state.tabs.splice(i, 1);
  if (state.active >= state.tabs.length) state.active = state.tabs.length - 1;
  else if (i < state.active) state.active--;
  persistTabs();
  renderAll();
}

const persistTabs = debounce(() => {
  ls.set('apiman:tabs', {
    active: state.active,
    tabs: state.tabs.map((t) => (t.cid ? { cid: t.cid, itemId: t.itemId, ed: t.dirty ? edForStorage(t.ed) : null } : { ed: edForStorage(t.ed) })),
  });
}, 300);

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
        state.tabs.push(newTab({ ed: { ...blankEd(), ...s.ed, body: { ...blankBody(), ...s.ed.body } }, dirty: false }));
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
  if (state.view === 'environments') body.replaceChildren(...renderEnvList());
  else if (state.view === 'history') body.replaceChildren(...renderHistoryList());
  else body.replaceChildren(...renderCollectionTree());
}

function rowActs(...btns) { return h('span', { class: 'acts' }, ...btns); }
function iconBtn(name, title, onclick) {
  return h('button', { class: 'btn icon', title, 'aria-label': title, onclick: (e) => { e.stopPropagation(); onclick(e); } }, icon(name));
}
const matches = (it) => {
  const f = state.filter;
  if (!f) return true;
  if ((it.name || '').toLowerCase().includes(f)) return true;
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
      class: 'row collection', tabindex: '0', title: c.id,
      onclick: () => toggleCollection(c.id), onkeydown: (e) => { if (e.key === 'Enter') toggleCollection(c.id); },
    },
      h('span', { class: `caret ${open ? 'open' : ''}` }, icon('chevron')),
      h('span', { class: 'name' }, c.name),
      col ? h('span', { class: 'sub' }, String(countRequests(col.item))) : null,
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
      const pad = `padding-left:${depth * 14}px`;
      if (isFolder(it)) {
        const key = `${cid}:${it.id}`;
        const fopen = state.filter ? true : state.open.has(key);
        const kids = fopen ? itemsNodes(cid, it.item, depth + 1) : [];
        if (state.filter && !kids.length && !matches(it)) continue;
        nodes.push(h('div', {
          class: 'row', style: pad, tabindex: '0',
          onclick: () => { toggleOpen(key); renderSidebar(); }, onkeydown: (e) => { if (e.key === 'Enter') { toggleOpen(key); renderSidebar(); } },
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
          class: `row ${active ? 'active' : ''}`, style: `padding-left:${depth * 14 + 14}px`, tabindex: '0',
          onclick: () => openItem(cid, it.id), onkeydown: (e) => { if (e.key === 'Enter') openItem(cid, it.id); },
        },
          h('span', { class: `mtag ${m}` }, m),
          h('span', { class: 'name' }, it.name || 'Untitled'),
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
    rows.push(h('div', { class: 'row', tabindex: '0', onclick: () => editEnvironment(GLOBALS_ID), onkeydown: (e) => { if (e.key === 'Enter') editEnvironment(GLOBALS_ID); } },
      h('span', { class: 'caret' }),
      h('span', { class: 'name' }, 'Globals'),
      h('span', { class: 'sub' }, `${g ? g.values.length : 0} vars`)));
  }
  for (const e of state.envList) {
    if (f && !e.name.toLowerCase().includes(f)) continue;
    const doc = state.envs[e.id];
    const active = e.id === state.activeEnv;
    rows.push(h('div', { class: `row ${active ? 'active' : ''}`, tabindex: '0', onclick: () => editEnvironment(e.id), onkeydown: (ev) => { if (ev.key === 'Enter') editEnvironment(e.id); } },
      h('span', { class: 'caret' }, h('span', { class: `env-dot ${active ? 'on' : ''}`, title: active ? 'Active' : '' })),
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
    const sc = e.status ? `s${String(e.status)[0]}` : 'err';
    out.push(h('div', {
      class: 'row', tabindex: '0', title: `${e.method} ${e.url}\n${new Date(e.at).toLocaleString()}`,
      onclick: () => openFromHistory(e), onkeydown: (ev) => { if (ev.key === 'Enter') openFromHistory(e); },
    },
      h('span', { class: `mtag ${e.method}` }, e.method),
      h('span', { class: 'name' }, e.url || e.name),
      h('span', { class: `status-code sm ${e.status ? sc : 's-err'}` }, e.status || 'Error')));
  }
  return out;
}

function openFromHistory(e) {
  const ed = { ...blankEd(), ...e.ed, body: { ...blankBody(), ...(e.ed && e.ed.body) } };
  openTab(newTab({ ed }));
}
function clearHistory() {
  if (!confirm('Clear all request history?')) return;
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
  pop.replaceChildren(...items.map((it) => (it === '-' ? h('div', { class: 'sep' })
    : h('button', { class: `mi ${it.danger ? 'danger' : ''}`, onclick: () => { hideMenu(); it.onClick(); } }, it.label))));
  placePopover(pop, anchor);
  if (row) { row.classList.add('menu-open'); pop.dataset.row = '1'; showMenu.row = row; }
  const first = pop.querySelector('button');
  if (first) first.focus();
}
function placePopover(pop, anchor) {
  pop.hidden = false;
  const r = anchor.getBoundingClientRect();
  const pw = pop.offsetWidth, ph = pop.offsetHeight;
  pop.style.left = `${Math.max(8, Math.min(r.left, innerWidth - pw - 8))}px`;
  pop.style.top = `${r.bottom + ph + 8 > innerHeight ? Math.max(8, r.top - ph - 4) : r.bottom + 4}px`;
}
function hideMenu() {
  $('#popover').hidden = true;
  if (showMenu.row) { showMenu.row.classList.remove('menu-open'); showMenu.row = null; }
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
  const name = prompt('Folder name');
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
  const name = prompt('New name', loc.item.name || '');
  if (!name) return;
  loc.item.name = name;
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

async function deleteItem(cid, id) {
  const loc = locate(state.cols[cid], id);
  const n = isFolder(loc.item) ? countRequests(loc.item.item) : 0;
  if (!confirm(`Delete "${loc.item.name}"${n ? ` and the ${n} request${n > 1 ? 's' : ''} in it` : ''}?`)) return;
  loc.list.splice(loc.index, 1);
  await saveCol(cid);
  const gone = new Set();
  const collect = (it) => { gone.add(it.id); if (Array.isArray(it.item)) it.item.forEach(collect); };
  collect(loc.item);
  state.tabs = state.tabs.filter((t) => !(t.cid === cid && gone.has(t.itemId)));
  state.active = Math.min(state.active, state.tabs.length - 1);
  persistTabs();
  renderAll();
}

async function newCollection() {
  const name = prompt('Collection name');
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
  if (!confirm(`Delete the collection "${name}"? This deletes ${cid}${backend.mode === 'local' ? ' from your data folder' : ''}.`)) return;
  await backend.collections.remove(cid);
  delete state.cols[cid];
  state.tabs = state.tabs.filter((t) => t.cid !== cid);
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
        style: `--cable: var(${cable})`, title: t.ed.url || t.ed.name,
        onclick: () => { state.active = i; persistTabs(); renderAll(); },
        onauxclick: (e) => { if (e.button === 1) closeTab(i); },
        onkeydown: (e) => { if (e.key === 'Enter') { state.active = i; renderAll(); } },
      },
        h('span', { class: `mtag ${t.ed.method}` }, t.ed.method),
        h('span', { class: 'tname' }, t.ed.name),
        t.dirty ? h('span', { class: 'dot', title: 'Unsaved changes' }) : null,
        h('button', { class: 'x', title: 'Close tab', 'aria-label': `Close ${t.ed.name}`, onclick: (e) => { e.stopPropagation(); closeTab(i); } }, icon('x')));
    }),
    h('button', { class: 'newtab', title: 'New request tab', 'aria-label': 'New request tab', onclick: () => openTab(newTab()) }, icon('plus')));
  const on = strip.querySelector('.rtab.on');
  if (on) on.scrollIntoView({ block: 'nearest', inline: 'nearest' });
}

function renderEditor() {
  const t = cur();
  $('#welcome').hidden = !!t;
  $('#editor').hidden = !t;
  if (!t) return;
  const ed = t.ed;
  $('#reqName').value = ed.name;
  $('#method').value = METHODS.includes(ed.method) ? ed.method : 'GET';
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
  if (!t || !t.ed.url.includes('{{')) { el.replaceChildren(); return; }
  const vars = merged(scopesFor(t.cid));
  const parts = [];
  let last = 0;
  for (const m of t.ed.url.matchAll(VAR_RE)) {
    parts.push(t.ed.url.slice(last, m.index));
    const v = m[1] in vars ? vars[m[1]] : dynamicVar(m[1]);
    parts.push(v === undefined ? h('span', { class: 'bad', title: 'Not defined in the environment, collection or Globals' }, m[0]) : (m[1].startsWith('$') ? `‹${m[1]}›` : v));
    last = m.index + m[0].length;
  }
  parts.push(t.ed.url.slice(last));
  el.replaceChildren('Resolves to ', ...parts);
}

function renderCounts() {
  const t = cur();
  if (!t) return;
  const ed = t.ed;
  const n = (x) => (x ? String(x) : '');
  $('#cntParams').textContent = n(ed.params.filter((p) => !p.disabled && p.key).length);
  $('#cntHeaders').textContent = n(ed.headers.filter((p) => !p.disabled && p.key).length);
  // Numbers count things; a dot means "configured".
  $('#cntAuth').classList.toggle('dot', ['bearer', 'basic', 'apikey'].includes(ed.auth.type));
  $('#cntAuth').textContent = $('#cntAuth').classList.contains('dot') ? 'set' : '';
  $('#cntBody').classList.toggle('dot', ed.body.mode !== 'none');
  $('#cntBody').textContent = ed.body.mode !== 'none' ? 'set' : '';
  $('#cntScripts').textContent = n((ed.pre.trim() ? 1 : 0) + (ed.test.trim() ? 1 : 0));
}

function switchPane(tabsSel, name) {
  const tabs = $(tabsSel);
  $$('.tab', tabs).forEach((b) => { const on = b.dataset.tab === name; b.classList.toggle('on', on); b.setAttribute('aria-selected', String(on)); });
  $$(':scope > .pane', tabs.parentElement).forEach((p) => { p.hidden = p.dataset.pane !== name; });
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
  const wrap = h('div');
  const draw = () => {
    const field = (label, key, { secret, placeholder } = {}) => {
      let reveal = false;
      const input = h('input', {
        type: secret ? 'password' : 'text', value: model[key] || '', placeholder: placeholder || '', spellcheck: 'false', autocomplete: 'off',
        oninput: (e) => { model[key] = e.target.value; onChange(); },
      });
      return h('div', { class: 'field' }, h('label', null, label),
        secret ? h('div', { class: 'field-row' }, input,
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
    if (b.lang === 'json') extras.push(h('button', { class: 'btn small ghost', onclick: () => {
      try { b.raw = JSON.stringify(JSON.parse(b.raw), null, 2); renderBody(); markDirty(); } catch (e) { toast(`Not valid JSON: ${e.message}`); }
    } }, 'Beautify'));
  }
  $('#bodyExtras').replaceChildren(...extras);

  const box = $('#bodyEditor');
  const area = (key, placeholder, rows = 14) => h('textarea', {
    class: 'code', spellcheck: 'false', placeholder, rows, value: b[key],
    oninput: (e) => { b[key] = e.target.value; markDirty(); },
    onkeydown: tabIndent,
  });
  if (b.mode === 'none') box.replaceChildren(h('p', { class: 'hint' }, 'This request has no body.'));
  else if (b.mode === 'raw') box.replaceChildren(area('raw', b.lang === 'json' ? '{\n  "name": "{{$randomFirstName}}"\n}' : ''));
  else if (b.mode === 'urlencoded') { box.replaceChildren(); kvTable(box, b.urlencoded, { onChange: markDirty }); }
  else if (b.mode === 'formdata') { box.replaceChildren(); kvTable(box, b.formdata, { file: true, onChange: markDirty }); }
  else if (b.mode === 'file') {
    const pick = h('input', { type: 'file', hidden: true, onchange: (e) => { b.fileObj = e.target.files[0] || null; if (b.fileObj) b.fileSrc = b.fileObj.name; markDirty(); renderBody(); } });
    box.replaceChildren(h('div', { class: 'drop' },
      h('p', null, b.fileObj ? `${b.fileObj.name} (${fmtSize(b.fileObj.size)})` : b.fileSrc ? `${b.fileSrc}: choose it again to send (files aren't stored)` : 'Send a file as the raw request body.'),
      h('button', { class: 'btn', onclick: () => pick.click() }, b.fileObj ? 'Change file' : 'Choose file'), pick));
  } else if (b.mode === 'graphql') {
    box.replaceChildren(
      h('div', { class: 'field' }, h('label', null, 'Query'), area('gqlQuery', 'query {\n  users { id name }\n}', 10)),
      h('div', { class: 'field' }, h('label', null, 'Variables (JSON)'), area('gqlVars', '{ "id": 1 }', 5)));
  } else box.replaceChildren(h('p', { class: 'note warn' }, `The "${b.unsupported.mode}" body from Postman isn't supported. It's kept in the file but not sent. Pick another body type to replace it.`));
}

function tabIndent(e) {
  if (e.key !== 'Tab' || e.shiftKey) return; // Shift+Tab still moves focus, so keyboard users are never trapped
  e.preventDefault();
  const ta = e.target;
  const { selectionStart: s, selectionEnd: en } = ta;
  ta.setRangeText('  ', s, en, 'end');
  ta.dispatchEvent(new Event('input'));
}

function renderScripts() {
  const t = cur();
  $$('[data-script]').forEach((c) => { const on = c.dataset.script === t.scriptKind; c.classList.toggle('on', on); c.setAttribute('aria-checked', String(on)); });
  $('#scriptText').value = t.scriptKind === 'pre' ? t.ed.pre : t.ed.test;
  $('#scriptText').placeholder = t.scriptKind === 'pre'
    ? '// Runs before the request is sent\npm.environment.set("requestId", pm.variables.replaceIn("{{$guid}}"));'
    : '// Runs after the response arrives\npm.test("Status is 200", () => pm.response.to.have.status(200));';
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
    $('#respTools').hidden = true;
    $('#respBody').replaceChildren(h('div', { class: 'empty-state' }, t.sending
      ? h('p', { class: 'hint' }, `Waiting for the response to ${t.ed.method} ${t.ed.url || 'this request'}…`)
      : [h('p', { class: 'hint' }, 'Send the request to see its response here.'),
        h('p', { class: 'hint' }, h('kbd', null, 'Ctrl'), ' / ', h('kbd', null, '⌘'), ' + ', h('kbd', null, 'Enter'), ' sends, ',
          h('kbd', null, 'Ctrl'), ' / ', h('kbd', null, '⌘'), ' + ', h('kbd', null, 'S'), ' saves.')]));
    return;
  }
  const res = out.res;
  const hasRes = res && !out.error;
  status.replaceChildren(...(hasRes ? [
    h('span', null, h('span', { class: `status-code s${String(res.status)[0]}` }, String(res.status)), res.reason ? ` ${res.reason}` : ''),
    h('span', null, h('b', null, fmtMs(res.timeMs))),
    h('span', null, h('b', null, fmtSize(res.size)), res.truncated ? ' (truncated)' : ''),
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
  $('#respTools').hidden = !hasRes;
  $$('#respTools .seg-btn').forEach((b) => b.classList.toggle('on', b.dataset.view === t.bodyView));
  $('#respBody').replaceChildren(...notes, ...(notes.length && hasRes ? [h('div', { class: 'gap' })] : []), ...(hasRes ? [bodyView(res, t.bodyView)] : []));
  // headers
  $('#respHeaders').replaceChildren(...(hasRes ? res.headers.map(([k, v]) => h('tr', null, h('td', null, k), h('td', { class: 'mono' }, v))) : []));
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
    : h('p', { class: 'hint' }, 'No tests ran. Add some in Scripts → Tests, for example pm.test("Status is 200", () => pm.response.to.have.status(200)).'));
  // console
  $('#respConsole').replaceChildren(...(out.logs && out.logs.length
    ? out.logs.map((l) => h('div', { class: `line ${l.level}` }, h('span', { class: 'src' }, l.src || ''), l.text))
    : [h('p', { class: 'hint' }, 'console.log() output from scripts appears here.')]));
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
      frame.srcdoc = `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:">${res.body}`;
      return frame;
    }
    return h('p', { class: 'hint' }, 'Preview works for HTML and images. Use Pretty or Raw for this response.');
  }
  if (res.binary) {
    return h('div', { class: 'drop' }, h('p', null, `Binary response (${ct || 'unknown type'}, ${fmtSize(res.size)}).`),
      h('button', { class: 'btn', onclick: saveBody }, 'Save to file'));
  }
  const text = res.body ?? '';
  if (!text) return h('p', { class: 'hint' }, 'The response body is empty.');
  if (view === 'pretty') {
    try {
      const pretty = JSON.stringify(JSON.parse(text), null, 2);
      const pre = h('pre', { class: 'out' });
      if (pretty.length < 400000) pre.innerHTML = highlightJson(pretty); // escaped before highlighting
      else pre.textContent = pretty;
      return pre;
    } catch { /* not JSON */ }
  }
  return h('pre', { class: 'out' }, text);
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
  const out = await execute({ ed: t.ed, cid: t.cid, itemId: t.itemId, signal: ctrl.signal, ask: async (m) => confirm(m) });
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
  loc.list[loc.index] = toItem(t.ed, loc.item);
  try {
    await saveCol(t.cid);
  } catch (e) { toast(`Couldn't save: ${e.message}`); return; }
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
    if (!confirm('You have no collections yet. Create one now to save this request?')) return;
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
      const list = target.folderId ? locate(col, target.folderId).item.item : col.item;
      const item = toItem(t.ed);
      list.push(item);
      await saveCol(target.cid);
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
function openDialog({ title, body, buttons = [], wide = false, onClose }) {
  const dlg = $('#dlg');
  dlg.classList.toggle('wide', wide);
  $('#dlgTitle').textContent = title;
  $('#dlgBody').replaceChildren(...[body].flat().filter((x) => x != null && x !== false));
  $('#dlgFoot').replaceChildren(...buttons.map((b) => h('button', {
    type: 'button', class: `btn ${b.primary ? 'primary' : ''} ${b.danger ? 'danger' : ''}`,
    onclick: async (e) => {
      const btn = e.currentTarget;
      btn.disabled = true;
      try { if (await b.onClick()) dlg.close(); } catch (err) { toast(err.message); } finally { btn.disabled = false; }
    },
  }, b.label)));
  dlg.onclose = () => { if (onClose) onClose(); };
  if (!dlg.open) dlg.showModal();
  // Start on the first field, not on the close button.
  const first = $('#dlgBody').querySelector('input:not([type=checkbox]):not([type=file]):not([disabled]), select, textarea');
  if (first) first.focus();
}
function closeDialog() { $('#dlg').close(); }

function dlgTabs(defs) {
  const bar = h('div', { class: 'seg dlg-tabs', role: 'tablist' });
  const panes = defs.map((d) => h('div', { 'data-pane': d.key, hidden: d !== defs[0] }, d.content));
  defs.forEach((d, i) => bar.append(h('button', {
    type: 'button', class: `seg-btn ${i === 0 ? 'on' : ''}`, role: 'tab',
    onclick: (e) => { $$('.seg-btn', bar).forEach((b) => b.classList.toggle('on', b === e.currentTarget)); panes.forEach((p) => { p.hidden = p.dataset.pane !== d.key; }); },
  }, d.label)));
  return [bar, ...panes];
}

function scriptsPair(model) {
  const mk = (key, label, ph) => h('div', { class: 'field' }, h('label', null, label),
    h('textarea', { class: 'code', rows: 8, spellcheck: 'false', placeholder: ph, value: model[key], oninput: (e) => { model[key] = e.target.value; }, onkeydown: tabIndent }));
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
    body: [h('div', { class: 'field' }, h('label', null, 'Name'), nameIn), ...dlgTabs(defs)],
    buttons: [{ label: 'Save', primary: true, onClick: async () => {
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
        doc.name = name;
        doc.values = rows.filter((r) => r.key).map((r) => ({ key: r.key, value: r.value, type: r.type === 'secret' ? 'secret' : 'default', enabled: !r.disabled }));
        let envId = id;
        if (id) await backend.environments.put(id, doc);
        else envId = await backend.environments.create(doc);
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
  if (!confirm(`Delete the environment "${state.envs[id].name}"?`)) return;
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
    peek.append(h('table', { class: 'grid' }, h('tbody', null, on.map((v) => h('tr', null, h('td', null, v.key),
      h('td', { class: 'v' }, v.type === 'secret' ? '••••••••' : String(v.value ?? '').slice(0, 120)))))));
  }
  peek.append(h('div', { class: 'actions' },
    h('button', { class: 'btn small', onclick: () => { hideMenu(); if (state.activeEnv) editEnvironment(state.activeEnv); else editEnvironment(null); } }, state.activeEnv ? 'Edit environment' : 'New environment'),
    h('button', { class: 'btn small ghost', onclick: () => { hideMenu(); editEnvironment(GLOBALS_ID); } }, 'Edit Globals')));
  pop.replaceChildren(peek);
  placePopover(pop, anchor);
}

// ---------- import ----------
function openImport(start = 'file') {
  const fileIn = h('input', { type: 'file', accept: '.json,application/json', multiple: true, hidden: true, onchange: (e) => importFiles([...e.target.files]) });
  const drop = h('div', {
    class: 'drop',
    ondragover: (e) => { e.preventDefault(); },
    ondrop: (e) => { e.preventDefault(); importFiles([...e.dataTransfer.files]); },
  }, h('p', null, 'Drop Postman collection or environment files here (v2.1 JSON).'),
    h('button', { type: 'button', class: 'btn', onclick: () => fileIn.click() }, 'Choose files'), fileIn);
  const curlIn = h('textarea', { class: 'code', rows: 10, spellcheck: 'false', placeholder: "curl -X POST 'https://api.example.com/items' \\\n  -H 'Authorization: Bearer …' \\\n  -H 'Content-Type: application/json' \\\n  --data-raw '{\"name\":\"x\"}'" });
  const pasteIn = h('textarea', { class: 'code', rows: 10, spellcheck: 'false', placeholder: 'Paste a Postman collection or environment JSON' });
  const defs = [
    { key: 'file', label: 'File', content: [drop, h('p', { class: 'hint' }, 'In Postman: ⋯ on a collection → Export → Collection v2.1. Environments: ⋯ → Export.')] },
    { key: 'curl', label: 'cURL', content: [curlIn, h('div', { class: 'dlg-inline-actions' }, h('button', { type: 'button', class: 'btn primary', onclick: () => {
      try { const ed = parseCurl(curlIn.value); closeDialog(); openTab(newTab({ ed, dirty: true })); toast('Imported from cURL'); } catch (e) { toast(e.message); }
    } }, 'Import cURL'))] },
    { key: 'paste', label: 'Paste JSON', content: [pasteIn, h('div', { class: 'dlg-inline-actions' }, h('button', { type: 'button', class: 'btn primary', onclick: async () => {
      try { await importJson(JSON.parse(pasteIn.value), 'pasted JSON'); closeDialog(); } catch (e) { toast(e.message); }
    } }, 'Import'))] },
  ];
  openDialog({ title: 'Import', body: dlgTabs(defs) });
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
    w.headers = w.headers.map(([k, v]) => [k, SECRET_HEADER.test(k) ? (/^authorization$/i.test(k) ? v.replace(/^(\w+\s+).+$/, '$1••••••') : '••••••') : v]);
    const a = effectiveAuth(t.ed, t.cid, t.itemId).auth;
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
    if (w.body.kind === 'formdata') for (const f of w.body.fields) lines.push(`  -F ${sq(f.file ? `${f.key}=@${f.file.name}` : `${f.key}=${f.value}`)}`);
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
  const pre = h('pre', { class: 'codegen' });
  const tabsBar = h('div', { class: 'seg dlg-tabs', role: 'tablist' });
  const draw = () => {
    tabsBar.replaceChildren(...Object.entries(GENERATORS).map(([k, g]) => h('button', {
      type: 'button', class: `seg-btn ${k === lang ? 'on' : ''}`, onclick: () => { lang = k; ls.set('apiman:codeLang', k); draw(); },
    }, g.label)));
    const r = codeWire(mask.checked);
    pre.textContent = r.error ? `// ${r.error}` : GENERATORS[lang].gen(r.wire);
  };
  mask.addEventListener('change', draw);
  draw();
  openDialog({
    title: 'Generate code',
    wide: true,
    body: [tabsBar, pre,
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
  const keepVars = h('input', { type: 'checkbox', checked: true });
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
    h('table', { class: 'grid' }, h('thead', null, h('tr', null, ...['#', 'Request', 'Status', 'Time', 'Tests'].map((x) => h('th', null, x)))), tbody));
  let ctrl = null;

  openDialog({
    title: 'Collection runner',
    wide: true,
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
      run().catch((e) => { toast(e.message); ctrl = null; });
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
      let n = 0, pass = 0, fail = 0, errors = 0, totalMs = 0;
      const total = items.length * iterations;
      const started = performance.now();
      outer: for (let it = 0; it < iterations; it++) {
        for (const item of items) {
          if (ctrl.signal.aborted) break outer;
          const ed = fromItem(item);
          const out = await execute({ ed, cid: runCid, itemId: item.id, iteration: it, signal: ctrl.signal, persist: keepVars.checked });
          n++;
          const tp = out.tests.filter((x) => x.passed === true).length;
          const tf = out.tests.filter((x) => x.passed === false).length;
          pass += tp; fail += tf;
          if (out.error) errors++;
          if (out.res && !out.error) totalMs += out.res.timeMs;
          const sc = out.error ? 'err' : `s${String(out.res.status)[0]}`;
          tbody.append(h('tr', null,
            h('td', null, iterations > 1 ? `${it + 1}.${items.indexOf(item) + 1}` : String(n)),
            h('td', null, h('span', { class: `mtag ${ed.method}` }, ed.method), ' ', ed.name,
              ...out.tests.filter((x) => x.passed === false).map((x) => h('div', { class: 'runner-fail' }, h('span', { class: 'pill err' }, 'Fail'), `${x.name}: ${x.error}`)),
              out.error ? h('div', { class: 'runner-fail' }, h('span', { class: 'pill err' }, 'Error'), out.error) : null),
            h('td', null, h('span', { class: `status-code ${out.error ? 's-err' : sc}` }, out.error ? 'Error' : String(out.res.status))),
            h('td', null, out.res && !out.error ? fmtMs(out.res.timeMs) : ''),
            h('td', null, out.tests.length ? `${tp}/${out.tests.length}` : '')));
          bar.firstChild.style.width = `${(n / total) * 100}%`;
          bar.classList.toggle('has-fail', fail + errors > 0);
          summary.replaceChildren(
            h('span', { class: 'big pass' }, `${pass} passed`), h('span', { class: `big ${fail ? 'fail' : ''}` }, `${fail} failed`),
            ...(errors ? [h('span', { class: 'big fail' }, `${errors} errors`)] : []),
            h('span', { class: 'metric' }, `${n} of ${total} requests, average ${n - errors ? fmtMs(Math.round(totalMs / Math.max(1, n - errors))) : '–'}`));
          if (stopOnFail.checked && (tf || out.error)) break outer;
          if (delay) await new Promise((r) => setTimeout(r, delay));
        }
      }
      summary.append(h('span', { class: 'metric' }, `${ctrl.signal.aborted ? 'Stopped' : 'Finished'} in ${fmtMs(Math.round(performance.now() - started))}`));
      ctrl = null;
      runBtn.textContent = 'Run again';
      if (state.view === 'environments') renderSidebar();
      renderResolved();
  }
}

// ---------- settings ----------
function openSettings() {
  const s = state.settings;
  const theme = h('select', null, ...[['system', 'Match the system'], ['light', 'Light'], ['dark', 'Dark']].map(([v, l]) => h('option', { value: v, ...(s.theme === v ? { selected: true } : {}) }, l)));
  const timeout = h('input', { type: 'number', min: '1', max: '600', value: String(s.timeout) });
  const follow = h('input', { type: 'checkbox', checked: s.followRedirects });
  const hist = h('input', { type: 'checkbox', checked: s.history });
  const insecure = h('input', { type: 'checkbox', checked: s.insecure });
  openDialog({
    title: 'Settings',
    body: [
      h('div', { class: 'grid-2' }, h('div', { class: 'field' }, h('label', null, 'Theme'), theme), h('div', { class: 'field' }, h('label', null, 'Request timeout (seconds)'), timeout)),
      h('label', { class: 'check' }, follow, h('span', null, 'Follow redirects', h('small', null, 'Credentials are never forwarded to a different site, and HTTPS never downgrades to HTTP.'))),
      h('label', { class: 'check' }, hist, h('span', null, 'Keep request history', h('small', null, 'Stored only in this browser. It includes request details as you typed them.'))),
      backend.mode === 'local'
        ? h('label', { class: 'check' }, insecure, h('span', null, 'Skip TLS certificate checks', h('small', null, 'Last resort for internal servers with self-signed certificates: it lets an attacker on the network read your traffic. Prefer starting the server with --ca-file.')))
        : h('p', { class: 'hint' }, 'Website mode: the browser sends requests, so certificate and CORS rules apply. Run ApiMan locally (python3 server.py) to call any API, including internal ones over VPN.'),
      h('p', { class: 'hint' }, `Data: ${$('#dataDir').textContent}`),
    ],
    buttons: [{ label: 'Save', primary: true, onClick: () => {
      s.theme = theme.value;
      s.timeout = Math.max(1, Math.min(600, Number(timeout.value) || 60));
      s.followRedirects = follow.checked;
      s.history = hist.checked;
      s.insecure = backend.mode === 'local' && insecure.checked;
      saveSettings();
      applyTheme();
      renderSidebar();
      toast('Settings saved');
      return true;
    } }],
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
    if (t.reqTab === 'params') renderParams();
    renderResolved();
    renderCounts();
    markDirty();
  });
  $('#url').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); send(); } });
  $('#url').addEventListener('paste', (e) => {
    const text = e.clipboardData.getData('text');
    if (/^\s*curl\s/i.test(text)) {
      e.preventDefault();
      try {
        const parsed = parseCurl(text);
        const t = cur();
        Object.assign(t.ed, { ...parsed, name: t.ed.name === 'Untitled request' ? parsed.name : t.ed.name });
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
  $$('#editor [data-script]').forEach((c) => c.addEventListener('click', () => { cur().scriptKind = c.dataset.script; renderScripts(); }));
  $('#scriptText').addEventListener('input', (e) => { const t = cur(); t.ed[t.scriptKind === 'pre' ? 'pre' : 'test'] = e.target.value; renderCounts(); markDirty(); });
  $('#scriptText').addEventListener('keydown', tabIndent);
  $('#btnSnippets').addEventListener('click', (e) => {
    const t = cur();
    showMenu(e.currentTarget, SNIPPETS[t.scriptKind].map(([label, code]) => ({ label, onClick: () => {
      const ta = $('#scriptText');
      ta.value = ta.value ? `${ta.value.replace(/\s*$/, '')}\n\n${code}\n` : `${code}\n`;
      ta.dispatchEvent(new Event('input'));
      ta.focus();
    } })));
  });
  $('#docsText').addEventListener('input', (e) => { cur().ed.docs = e.target.value; markDirty(); });
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
  $('#btnSettings').addEventListener('click', openSettings);
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
    if (mod && e.key === 'Enter') { e.preventDefault(); if (cur()) send(); return; }
    if (mod && e.key.toLowerCase() === 's') { e.preventDefault(); if (cur()) save().catch((err) => toast(err.message)); return; }
    const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName);
    if (!typing && e.key === '/') { e.preventDefault(); $('#search').focus(); }
  });
  window.addEventListener('beforeunload', (e) => { if (state.tabs.some((t) => t.dirty)) persistTabs(); }); // unsaved edits are kept and restored
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
  if (state.tabs.some((t) => t.dirty && t.cid) && !confirm('Switching folders closes tabs from the current collections. Unsaved changes in them will be lost. Continue?')) return;
  const dir = await window.showDirectoryPicker({ id: 'apiman', mode: 'readwrite' });
  await idbHandle('set', dir);
  await useFolder(dir);
  toast(`Saving to the "${dir.name}" folder`);
}

// =====================================================================================================
// Start
// =====================================================================================================
async function start() {
  applyTheme();
  bindEditor();
  bindChrome();
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
    $('#dataDir').textContent = 'Saved in this browser.';
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
