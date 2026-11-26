// ApiMan UI lint: keeps buttons to the house vocabulary (see DESIGN.md). Run: node tools/ui-lint.mjs
// Exits 1 and lists every button whose classes aren't one of the allowed styles, and every primary button
// placed outside the places primary buttons belong.
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
// Styles, as sorted class sets. Hooks that only identify a button (seg-more, pane-max…) are stripped first.
const STYLES = new Set(['btn', 'btn primary', 'btn small', 'btn ghost', 'btn ghost small', 'btn icon', 'btn icon small']);
const HOOKS = new Set(['seg-more', 'pane-max', 'busy']);
// Primary buttons: dialog footers (made by openDialog) and these places only.
const PRIMARY_OK = [/'data-act': 'new-request'/, /'data-import': '(curl|paste)'/];

const fails = [];
const check = (file, line, no, classes) => {
  const toks = classes.split(/\s+/).filter(Boolean);
  if (!toks.includes('btn')) return;
  const style = toks.filter((t) => !HOOKS.has(t)).sort().join(' ');
  if (!STYLES.has(style)) fails.push(`${file}:${no}  "${classes}" isn't a button style. Use one of: ${[...STYLES].join(' | ')}`);
  if (toks.includes('primary') && !PRIMARY_OK.some((re) => re.test(line))) {
    fails.push(`${file}:${no}  primary button outside a dialog footer or the welcome screen: use "btn small" (in content) or "btn small ghost" (in a toolbar)`);
  }
};
for (const file of ['app.js', 'index.html']) {
  readFileSync(join(ROOT, file), 'utf8').split('\n').forEach((line, i) => {
    for (const m of line.matchAll(/class(?:Name)?\s*[:=]\s*(['"])([^'"`]*\bbtn\b[^'"`]*)\1/g)) check(file, line, i + 1, m[2]);
  });
}
if (fails.length) { console.log(fails.join('\n')); console.log(`\n${fails.length} UI lint problem${fails.length > 1 ? 's' : ''}. See DESIGN.md.`); process.exit(1); }
console.log('UI lint: buttons OK');
