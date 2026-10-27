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
