// The browser scripts must at least parse: a syntax error stops the whole site.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {join} from 'node:path';
import {root} from './helpers.js';

for (const file of ['public/app.js', 'public/theme.js']) {
  test(`${file} parses`, () => {
    const r = spawnSync(process.execPath, ['--check', join(root, file)], {encoding: 'utf8'});
    assert.equal(r.status, 0, r.stderr);
  });
}

// Themes and first-find auras share one stylesheet, so their names must not collide.
import {readFileSync} from 'node:fs';
const css = readFileSync(join(root, 'public/style.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
const app = readFileSync(join(root, 'public/app.js'), 'utf8');
const selectors = [...css.matchAll(/([^{}]+)\{/g)].map(m => m[1].trim()).filter(s => !s.startsWith('@') && !/^(from|to|\d)/.test(s));

test('keyframe names are unique', () => {
  const names = [...css.matchAll(/@keyframes\s+([\w-]+)/g)].map(m => m[1]);
  assert.deepEqual(names.filter((n, i) => names.indexOf(n) !== i), []);
});

test('theme effect styles never reach the first-find auras', () => {
  // The aura effects (AURA_FX in app.js) are classes on the first-find span; a page-wide rule for
  // the same class name (say, an item effect's burst) would restyle the item itself.
  const fxBlock = app.slice(app.indexOf('const AURA_FX = {'), app.indexOf('};', app.indexOf('const AURA_FX = {')));
  const auraClasses = new Set([...css.matchAll(/\.first-find\.(fx-[\w-]+)/g)].map(m => m[1])
    .concat([...fxBlock.matchAll(/^\s+(\w+): \{label/gm)].map(m => `fx-${m[1]}`), 'fx-sparks'));
  const leaks = selectors.flatMap(s => s.split(',')).map(s => s.trim())
    .filter(s => [...s.matchAll(/\.(fx-[\w-]+)/g)].some(m => auraClasses.has(m[1])) && !s.includes('.first-find') && !s.includes('#theme-fx')
      && !/^\.fx-[\w-]+( \.p|::)/.test(s));
  assert.deepEqual(leaks, []);
});

test('every inventory theme has a palette', () => {
  const block = name => app.slice(app.indexOf(`const ${name} = [`), app.indexOf('\n];', app.indexOf(`const ${name} = [`)));
  const keys = ['THEMES', 'KEYS', 'BREWS'].flatMap(n => [...block(n).matchAll(/\['([a-z]+)', ['"]/g)].map(m => m[1]));
  assert.ok(keys.length >= 24, `found ${keys.length} theme keys`);
  for (const key of keys) assert.match(css, new RegExp(`:root\\[data-theme="${key}"\\] \\{`), key);
});
