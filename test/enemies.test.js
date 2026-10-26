// The Enemies catalog: stats and projectiles from objects.xml, drops from the loot export, sprites from the client.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {inflateSync} from 'node:zlib';
import {buildEnemies, literalDrops} from '../tools/codex/enemies.mjs';
import {encodePng} from '../tools/codex/swf.mjs';

// A 56x16 animated sheet: two 8x8 characters of 7 frames each, first frames red and blue.
const sheet = {width: 56, height: 16, rgba: Buffer.alloc(56 * 16 * 4)};
const paint = (x0, y0, rgb) => { for (let y = y0; y < y0 + 8; y++) for (let x = x0; x < x0 + 8; x++) sheet.rgba.set([...rgb, 255], (y * 56 + x) * 4); };
paint(0, 0, [255, 0, 0]);
paint(0, 8, [0, 0, 255]);
const sheets = new Map([['Embeds_chars8x8rEncountersEmbed_', sheet]]);

const objects = [
  {type: 0x100, src: `<Object type="0x100" id="Boss Thing"><Enemy/><Class>Character</Class><DisplayId>Boss</DisplayId><Quest/><God/>
    <AnimatedTexture><File>chars8x8rEncounters</File><Index>1</Index></AnimatedTexture>
    <MaxHitPoints>5000</MaxHitPoints><Defense>10</Defense><Size>120</Size>
    <Projectile id="0"><ObjectId>Bolt</ObjectId><Damage>40</Damage><Speed>80</Speed><LifetimeMS>2200</LifetimeMS><MultiHit/>
      <ConditionEffect duration="2">Slowed</ConditionEffect></Projectile>
    <Projectile id="1"><ObjectId>Big</ObjectId><MinDamage>10</MinDamage><MaxDamage>20</MaxDamage><Speed>100</Speed><LifetimeMS>1000</LifetimeMS></Projectile>
  </Object>`},
  {type: 0x101, src: `<Object type="0x101" id="Rat"><Enemy/><Class>Character</Class><Texture><File>invisible</File><Index>0</Index></Texture><MaxHitPoints>10</MaxHitPoints></Object>`},
  {type: 0x102, src: `<Object type="0x102" id="Chest"><Class>Container</Class></Object>`},
  {type: 0x103, src: `<Object type="0x103" id="Wall"><Class>Wall</Class></Object>`},
  {type: 0x200, src: `<Object type="0x200" id="Sword"><Item/><Class>Equipment</Class></Object>`}
];
const loot = {drops: {[0x100]: [0x200, 0x999], [0x102]: [0x200]}};
const {enemies, sheet: out} = buildEnemies({objects, loot, sheets, isItem: id => id === 0x200, warn() {}});
const byId = new Map(enemies.map(e => [e.id, e]));

test('enemies and objects that drop items are included; items and scenery are not', () => {
  assert.deepEqual([...byId.keys()].sort(), [0x100, 0x101, 0x102]);
  assert.equal(byId.get(0x102).enemy, false);
});

test('stats, flags and projectiles come from objects.xml', () => {
  const boss = byId.get(0x100);
  assert.equal(boss.name, 'Boss');
  assert.equal(boss.internal, 'Boss Thing');
  assert.equal(boss.hp, 5000);
  assert.equal(boss.def, 10);
  assert.deepEqual(boss.flags, ['Quest', 'God']);
  assert.deepEqual(boss.projectiles[0], {id: 0, damage: 40, speed: 80, lifetime: 2200, range: 17.6, size: null, flags: ['MultiHit'], effects: [{name: 'Slowed', duration: 2}]});
  assert.deepEqual(boss.projectiles[1].damage, [10, 20]);
  assert.equal(boss.projectiles[1].range, 10);
  assert.equal(byId.get(0x101).def, 0);
});

test('drops list only catalog items, exactly as exported', () => {
  assert.deepEqual(byId.get(0x100).drops, [0x200]);
  assert.deepEqual(byId.get(0x101).drops, []);
});

test('sprites use the first frame of the right block and invisible ones are skipped', () => {
  const s = byId.get(0x100).sprite;
  assert.deepEqual({w: s.w, h: s.h}, {w: 8, h: 8});
  assert.equal(byId.get(0x101).sprite, null);
  // Decode the packed sheet and check the boss's sprite is the blue (second) character.
  const png = out.png;
  assert.deepEqual([...png.subarray(1, 4)].map(c => String.fromCharCode(c)).join(''), 'PNG');
  const idat = png.subarray(png.indexOf('IDAT') + 4, png.indexOf('IEND') - 8);
  const raw = inflateSync(idat);
  const row = raw.subarray(s.y * (out.width * 4 + 1) + 1);
  assert.deepEqual([...row.subarray(s.x * 4, s.x * 4 + 4)], [0, 0, 255, 255]);
});

test('hand-written drops in the world code are found', () => {
  const ids = literalDrops([
    'self.loot_bags(defeated.pos, None, &[0xc25])?;',
    'rewards.push(0xa35);',
    'crate::dungeon::trench::HERMIT => Some([0xa34, 0xa4c]),',
    'let x = 0x123;'
  ]);
  assert.deepEqual([...ids].sort(), [0xa34, 0xa35, 0xa4c, 0xc25]);
});

test('PNG encoder writes a valid header', () => {
  const png = encodePng(1, 1, Buffer.from([1, 2, 3, 4]));
  assert.deepEqual([...png.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
});
