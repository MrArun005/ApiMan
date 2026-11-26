// ApiMan UI lint: the UI may only be built from the design system (DESIGN.md, tools/design-system.json).
//   node tools/ui-lint.mjs
// Fails (exit 1) on:
//   1. a class in app.js, index.html or app.css that isn't in the registry
//   2. a button, input, select or textarea created outside a component function (use ui.*)
//   3. a button style outside the Button variants, or a primary button outside a dialog footer / the welcome screen
//   4. a colour literal in app.css outside a token (custom property) definition
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => readFileSync(join(ROOT, f), 'utf8');
const reg = JSON.parse(read('tools/design-system.json'));
const known = new Set([...Object.values(reg.vocabulary).flat(), ...Object.values(reg.components).flat(), ...reg.regions]);
const vendor = (c) => reg.vendor.prefixes.some((p) => c.startsWith(p));
const fails = [];
const fail = (where, msg) => fails.push(`${where}  ${msg}`);
const checkClass = (where, c) => { if (!known.has(c) && !vendor(c)) fail(where, `"${c}" isn't a design-system class (DESIGN.md / tools/design-system.json)`); };

// Classes in a class string; for templates, the literal parts and the quoted strings inside ${…}.
const classTokens = (raw) => {
  const lit = raw
    .replace(/[\w-]+(?=\$\{)/g, ' ') // s${status}: a computed name; its possible values are registered
    .replace(/\$\{([^{}]*(\{[^{}]*\}[^{}]*)*)\}/g, (m, expr) => ` ${[...expr
      .replace(/(?:===|!==|==|!=)\s*'[^']*'|'[^']*'\s*(?:===|!==|==|!=)/g, ' ') // compared values aren't classes
      .matchAll(/'([^']*)'|"([^"]*)"/g)].map((x) => x[1] ?? x[2]).join(' ')} `);
  return lit.split(/\s+/).filter((t) => /^[A-Za-z][\w-]*$/.test(t));
};

// ---- 1 + 3: classes in markup and code
const BUTTON_STYLES = new Set(['btn', 'btn primary', 'btn ghost', 'btn small', 'btn ghost small', 'btn icon', 'btn icon small', 'btn danger', 'btn danger solid', 'btn danger small']);
const BUTTON_HOOKS = new Set(['seg-more', 'pane-max', 'busy', 'done', 'x', 'newtab', 'alltabs', 'push-left', 'lbl']);
// Primary buttons: the dialog footer (renderDialog) and the welcome screen's first action, nowhere else.
const PRIMARY_OK = [/'data-act': 'new-request'/, /b\.primary && 'primary'/];
for (const file of ['app.js', 'index.html']) {
  read(file).split('\n').forEach((line, i) => {
    const where = `${file}:${i + 1}`;
    for (const m of line.matchAll(/\bclass(?:Name)?\s*[:=]\s*(?:'([^']*)'|"([^"]*)"|`([^`]*)`)/g)) {
      const toks = classTokens(m[1] ?? m[2] ?? m[3]);
      toks.forEach((c) => checkClass(where, c));
      if (toks.includes('btn') && m[3] === undefined) {
        const style = toks.filter((t) => !BUTTON_HOOKS.has(t)).sort().join(' ');
        if (!BUTTON_STYLES.has(style)) fail(where, `"${toks.join(' ')}" isn't a Button variant`);
        if (toks.includes('primary') && !PRIMARY_OK.some((re) => re.test(line))) fail(where, 'primary button outside a dialog footer or the welcome screen');
      }
    }
    if (/variant:\s*'[^']*\bprimary\b/.test(line) && !PRIMARY_OK.some((re) => re.test(line))) fail(where, 'primary button outside a dialog footer or the welcome screen');
    // class values that are expressions (class: ok ? 'v' : 'v err') and every cx('…', cond && '…') call
    const literals = (expr) => [...expr.replace(/(?:===|!==|==|!=)\s*'[^']*'|'[^']*'\s*(?:===|!==|==|!=)/g, ' ').matchAll(/'([^']*)'/g)].flatMap((x) => x[1].split(/\s+/)).filter((t) => /^[A-Za-z][\w-]*$/.test(t));
    for (const m of line.matchAll(/\bclass(?:Name)?\s*:\s*(?!['"`]|cx\()([^,}]*\?[^,}]*:[^,}]*)/g)) literals(m[1]).forEach((c) => checkClass(where, c));
    for (const m of line.matchAll(/\bcx\(([^()]*(?:\([^()]*\)[^()]*)*)\)/g)) literals(m[1]).forEach((c) => checkClass(where, c));
    for (const m of line.matchAll(/classList\.(?:add|remove|toggle|contains)\(\s*'([\w-]+)'/g)) checkClass(where, m[1]);
    for (const m of line.matchAll(/(?:\$\$?|querySelector(?:All)?|closest|matches)\(\s*'([^']*)'/g)) for (const c of m[1].matchAll(/\.([A-Za-z][\w-]*)/g)) checkClass(where, c[1]);
  });
}

// ---- 2: raw controls only inside component functions
const allowed = new Set(reg.componentFunctions);
let fn = null;
read('app.js').split('\n').forEach((line, i) => {
  const top = line.match(/^(?:async\s+)?function\s+(\w+)|^const\s+(\w+)\s*=/);
  if (top) fn = top[1] || top[2];
  if (/\bh\(\s*'(button|input|select|textarea)'/.test(line) && !allowed.has(fn)) {
    fail(`app.js:${i + 1}`, `raw <${line.match(/h\(\s*'(\w+)'/)[1]}> in ${fn || 'top level'}(): build it with ui.* (DESIGN.md §3)`);
  }
});

// ---- 1 + 4: the stylesheet
const css = read('app.css').replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '));
css.split('\n').forEach((line, i) => {
  const where = `app.css:${i + 1}`;
  const selectorPart = line.replace(/\{[^}]*\}?/g, ' ').replace(/url\([^)]*\)/g, '');
  for (const m of selectorPart.matchAll(/(?<![\w-])\.([A-Za-z][\w-]*)/g)) if (!/^\d/.test(m[1])) checkClass(where, m[1]);
  for (const decl of line.matchAll(/(--[\w-]+|[a-z-]+)\s*:\s*([^;{}]*)/g)) {
    if (decl[1].startsWith('--')) continue; // token definitions may hold colours
    const v = decl[2].replace(/url\([^)]*\)/g, '');
    if (/#[0-9a-fA-F]{3,8}\b|\b(rgb|rgba|hsl|hsla)\(/.test(v)) fail(where, `colour literal in "${decl[1]}": use a token`);
  }
});

if (fails.length) {
  console.log(fails.join('\n'));
  console.log(`\n${fails.length} design-system violation${fails.length > 1 ? 's' : ''}. See DESIGN.md.`);
  process.exit(1);
}
console.log('UI lint: everything is built from the design system');
