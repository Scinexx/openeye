// Killers are named the way the game shows them, on the way in and for deaths already on record.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {setup} from './helpers.js';
import {killerName} from '../src/core/collector.js';
import {KILLER_NAMES} from '../src/core/killer-names.js';

test('object ids become the names the game shows', () => {
  assert.equal(killerName('Lava Blend'), 'Lava');
  assert.equal(killerName('Rock Bot'), 'Rock Construct');
  assert.equal(killerName('Red Gas Spawner LL'), 'Dr Terrible', 'Mad Lab traps are the boss’s doing');
  assert.equal(killerName('Medusa'), 'Medusa');
  assert.equal(killerName(undefined), null);
});

test('deaths already on record are renamed once', async () => {
  const t = await setup({ticking: false});
  try {
    await t.collector().syncHiscores();
    const {results: [p]} = await t.db.prepare('SELECT account FROM players LIMIT 1').all();
    const at = Math.floor(Date.now() / 1000);
    for (const [id, k] of [[1, 'Lava Blend'], [2, 'Turret Attack'], [3, 'Medusa']]) {
      await t.db.prepare(`INSERT INTO deaths(account, char_id, name, class, tex1, tex2, equipment, total_fame, base_fame, level, died_at, killed_by, discovered_at)
        VALUES(?, ?, 'x', 768, 0, 0, '[-1,-1,-1,-1]', 10, 5, 20, ?, ?, ?)`).bind(p.account, id, at, k, at).run();
    }
    await t.collector().syncKillerNames();
    const {results} = await t.db.prepare('SELECT char_id, killed_by FROM deaths WHERE char_id IN (1, 2, 3) ORDER BY char_id').all();
    assert.deepEqual(results.map(r => r.killed_by), ['Lava', 'Dr Terrible', 'Medusa']);
    const deadliest = (await t.api.deadliest()).enemies.map(e => e.name);
    assert.ok(deadliest.includes('Lava') && !deadliest.includes('Lava Blend'));
    assert.ok(Object.keys(KILLER_NAMES).length > 50);
  } finally { t.close(); }
});
