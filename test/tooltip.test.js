// Item tooltips match what the 2012 client shows when you hover an item.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {root, catalogItems} from './helpers.js';
import {parseElement, equipmentTooltip, toLines} from '../tools/tooltip.mjs';

const tips = JSON.parse(readFileSync(join(root, 'public/catalog/tooltips.json'), 'utf8'));
const byName = name => tips[catalogItems.find(i => i.name === name).id];
const text = line => line.map(r => r[0]).join('');
const classes = [
  {name: 'Archer', slotTypes: [3, 15, 6, 9, 0, 0]},
  {name: 'Huntress', slotTypes: [3, 20, 6, 9, 0, 0]},
  {name: 'Wizard', slotTypes: [17, 11, 14, 9, 0, 0]}
];
const build = xml => equipmentTooltip(parseElement(xml), {classes, displayName: e => e.attrs.id});

test('every catalog item has a tooltip', () => {
  for (const it of catalogItems) assert.ok(tips[it.id], it.name);
});

test('a bow shows shots, damage, range and who can use it', () => {
  const t = build(`<Object type="0xc02" id="Doom Bow"><Item/><SlotType>3</SlotType><Description>Heavy.</Description>
    <RateOfFire>0.33</RateOfFire><Projectile><Speed>140</Speed><MinDamage>400</MinDamage><MaxDamage>500</MaxDamage><LifetimeMS>503</LifetimeMS><MultiHit/></Projectile>
    <FameBonus>6</FameBonus><NumProjectiles>1</NumProjectiles></Object>`);
  assert.equal(t.t, 'Doom Bow');
  assert.equal(t.r, 'UT');
  assert.deepEqual(t.e.map(text), ['Shots: 1', 'Damage: 400 - 500', 'Range: 7', 'Shots hit multiple targets', 'Fame Bonus: 6%']);
  assert.deepEqual(t.e[1], [['Damage: '], ['400 - 500', '#FFFF8F']]);
  assert.deepEqual(t.x, [['Usable by: Archer, Huntress', '#B3B3B3', false]]);
});

test('armor, rings and potions follow the client rules', () => {
  const robe = build(`<Object type="0x1" id="Robe"><Item/><SlotType>14</SlotType><Tier>13</Tier><Description>d</Description>
    <ActivateOnEquip stat="20" amount="4">IncrementStat</ActivateOnEquip><ActivateOnEquip stat="21" amount="13">IncrementStat</ActivateOnEquip>
    <ActivateOnEquip stat="3" amount="-5">IncrementStat</ActivateOnEquip></Object>`);
  assert.equal(robe.r, 'T13');
  // The armour comparison writes Defense with a leading space, and negative bonuses are red.
  assert.deepEqual(robe.e.map(text), ['On Equip: ', '+4 Attack', ' +13 Defense', '-5 Maximum MP']);
  assert.equal(robe.e[3][0][1], '#FF0000');
  assert.deepEqual(robe.x, [['Usable by: Wizard', '#B3B3B3', false]]);
  const potion = build(`<Object type="0x2" id="Potion of Life"><Item/><SlotType>10</SlotType><Description>d</Description>
    <Activate stat="0" amount="5">IncrementStat</Activate><Consumable/><Soulbound/></Object>`);
  assert.equal(potion.r, null, 'consumables have no tier');
  assert.deepEqual(potion.e.map(text), ['Permanently increases Maximum HP']);
  assert.deepEqual(potion.x, [['Soulbound', '#B3B3B3', false]], 'no "Usable by" line for consumables');
});

test('the built catalog matches the client for special items', () => {
  assert.deepEqual(byName('Shield of Ogmur').e.map(text), [
    'Shots: 5', 'Damage: 300 - 400', 'Range: 3.2', 'Shots hit multiple targets', 'Shots pass through obstacles',
    'Party Effect: Armor Broken for 4 secs', 'On Equip: ', '+14 Defense', '+60 Maximum HP', 'MP Cost: 100', 'Fame Bonus: 6%'
  ]);
  assert.deepEqual(byName('Orb of Conflict').e.slice(0, 5).map(text), [
    'Stasis on group: 5 secs', 'Effect on Self:', 'Speedy for 2.5 secs', 'Effect on Self:', 'Damaging for 2.5secs'
  ]);
  assert.equal(byName('Orb of Conflict').e[2][0][1], '#8a2be2');
});

test('font tags become coloured runs', () => {
  assert.deepEqual(toLines('A: <font color="#FFFF8F">1</font>\n<font color="#8a2be2">x\ny</font>\n'), [
    [['A: '], ['1', '#FFFF8F']], [['x', '#8a2be2']], [['y', '#8a2be2']]
  ]);
});
