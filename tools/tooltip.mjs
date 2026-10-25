// Item tooltips, ported line for line from the 2012 client that Open RotMG runs
// (client 123.5.1: EquipmentToolTip.as, SlotComparisonFactory.as and the
// slotcomparisons/*.as classes). The website has no logged-in character, so this is
// the client's "no player" path: the item is compared with itself (every value in the
// neutral yellow), and the "Double-Click to equip" style hints are not shown.
//
// Output, per item:
//   {t: title, r: 'T12' | 'UT' | null, d: description,
//    e: effect lines, x: restriction lines}
// where each effect line is a list of [text] or [text, colour] runs, and each
// restriction line is [text, colour, bold].

// ---------- a small XML reader (just enough for objects.xml) ----------
const unescapeXml = s => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCharCode(n)).replace(/&amp;/g, '&');

/** Parse one element's source into {tag, attrs, text, children}. */
export function parseElement(src) {
  const tokens = src.replace(/<!--[\s\S]*?-->/g, '').match(/<[^>]+>|[^<]+/g) ?? [];
  const root = {tag: '#root', attrs: {}, text: '', children: []};
  const stack = [root];
  for (const t of tokens) {
    if (t.startsWith('</')) { stack.pop(); continue; }
    if (t.startsWith('<?')) continue;
    if (t.startsWith('<')) {
      const m = t.match(/^<([\w:.-]+)([\s\S]*?)(\/?)>$/);
      if (!m) continue;
      const el = {tag: m[1], attrs: {}, text: '', children: []};
      for (const [, k, v] of m[2].matchAll(/([\w:.-]+)\s*=\s*"([^"]*)"/g)) el.attrs[k] = unescapeXml(v);
      stack.at(-1).children.push(el);
      if (!m[3]) stack.push(el);
      continue;
    }
    stack.at(-1).text += unescapeXml(t);
  }
  const trim = e => { e.text = e.text.trim(); e.children.forEach(trim); return e; };
  return trim(root.children[0]);
}

// Stand-in for toXMLString(): the client keys "already shown" tags by their XML text,
// so two identical tags count as the same tag. Same here.
const key = e => `<${e.tag}${Object.entries(e.attrs).map(([k, v]) => ` ${k}="${v}"`).join('')}>${e.text}${e.children.map(key).join('')}</${e.tag}>`;
const listKey = list => list.map(key).join('\n');
const kids = (e, tag) => (e ? e.children.filter(c => c.tag === tag) : []);
const has = (e, tag) => kids(e, tag).length > 0;
const val = (e, tag) => kids(e, tag).map(c => c.text).join('');
const at = (e, name) => e?.attrs[name] ?? '';
const acts = (e, type, tag = 'Activate') => kids(e, tag).filter(a => a.text === type);
// ActionScript int() and Number() on XML text.
const num = v => Number(String(v).trim());
const int = v => { const n = num(v); return Number.isFinite(n) ? Math.trunc(n) : 0; };

// ---------- constants (TooltipHelper.as, SlotComparison.as, StatData.as) ----------
const BETTER = '#00ff00', WORSE = '#ff0000', NO_DIFF = '#FFFF8F', LABEL = '#B3B3B3', UNTIERED = '#8a2be2';
export const BASE_COLOR = '#B3B3B3';
const font = (text, color = NO_DIFF) => `<font color="${color}">${text}</font>`;
const diffColor = d => (d < 0 ? WORSE : d > 0 ? BETTER : NO_DIFF);
const rangeString = r => (Math.trunc((r - Math.trunc(r)) * 10) === 0 ? String(Math.trunc(r)) : r.toFixed(1));
const STAT_NAMES = {0: 'Maximum HP', 1: 'HP', 2: 'Size', 3: 'Maximum MP', 4: 'MP', 6: 'XP', 7: 'Level', 20: 'Attack', 21: 'Defense', 22: 'Speed', 26: 'Vitality', 27: 'Wisdom', 28: 'Dexterity'};
const statName = s => STAT_NAMES[s] ?? 'Unknown Stat';

// ---------- slot comparisons (slotcomparisons/*.as) ----------
const result = () => ({text: '', tags: new Map(), onEquip: new Map()});

function generalProjectile(item, cur) {
  const r = result();
  if (has(item, 'NumProjectiles')) {
    const n = int(val(item, 'NumProjectiles')), other = int(val(cur, 'NumProjectiles'));
    const text = font('Shots: ', LABEL) + font(String(n), diffColor(n - other)) + '\n';
    r.text += text;
    r.tags.set(listKey(kids(item, 'NumProjectiles')), text);
  }
  if (has(item, 'Projectile')) {
    const p = kids(item, 'Projectile')[0], o = kids(cur, 'Projectile')[0];
    const minD = int(val(p, 'MinDamage')), maxD = int(val(p, 'MaxDamage'));
    const oMin = int(val(o, 'MinDamage')), oMax = int(val(o, 'MaxDamage'));
    let html = font('Damage: ', LABEL) + font(minD === maxD ? String(minD) : `${minD} - ${maxD}`, diffColor((maxD + minD) / 2 - (oMax + oMin) / 2)) + '\n';
    const range = num(val(p, 'Speed')) * num(val(p, 'LifetimeMS')) / 10000;
    const oRange = num(val(o, 'Speed')) * num(val(o, 'LifetimeMS')) / 10000;
    html += font('Range: ', LABEL) + font(rangeString(range) + '\n', diffColor(range - oRange));
    if (has(p, 'MultiHit')) html += font('Shots hit multiple targets\n', NO_DIFF);
    if (has(p, 'PassesCover')) html += font('Shots pass through obstacles\n', NO_DIFF);
    r.text += html;
    r.tags.set(listKey(kids(item, 'Projectile')), html);
  }
  if (has(item, 'RateOfFire') && has(cur, 'RateOfFire')) {
    const delta = Math.trunc(num(kids(item, 'RateOfFire')[0].text) / num(kids(cur, 'RateOfFire')[0].text) * 100) - 100;
    if (delta !== 0) r.text += `Rate of Fire: ${font(`${delta > 0 ? '+' : ''}${delta}%`, diffColor(delta))}\n`;
  }
  return r;
}

function withProjectile(item, cur) {
  const r = result(), p = generalProjectile(item, cur);
  r.text = p.text;
  for (const [k, v] of p.tags) r.tags.set(k, v);
  return r;
}

const COMPARISONS = {
  tome(item, cur) {
    const r = result();
    const nova = acts(item, 'HealNova'), other = acts(cur, 'HealNova');
    // The client reads range and amount from *all* Activate tags here (XMLList attributes).
    const all = (e, a) => kids(e, 'Activate').map(x => x.attrs[a]).filter(v => v !== undefined).join('');
    if (nova.length === 1 && other.length === 1) {
      let range = int(all(item, 'range'));
      const amount = int(all(item, 'amount'));
      const avg = 0.5 * range + 0.5 * amount, oAvg = 0.5 * int(all(cur, 'range')) + 0.5 * int(all(cur, 'amount'));
      if (item.attrs.id === 'Tome of Purification') range = 6;
      r.text += 'Party Heal: ' + font(`${amount} HP within ${range} sqrs\n`, diffColor(avg - oAvg));
      r.tags.set(listKey(nova), true);
    }
    if (item.attrs.id === 'Tome of Purification') {
      const tag = acts(item, 'RemoveNegativeConditions')[0];
      r.text += font('Removes negative conditions\n', UNTIERED);
      r.tags.set(key(tag), true);
    } else if (item.attrs.id === 'Tome of Holy Protection') {
      const tag = acts(item, 'ConditionEffectSelf')[0];
      r.text += 'Effect on Self:\n' + font(`Armored for ${at(tag, 'duration')} secs\n`, UNTIERED);
      r.tags.set(key(tag), true);
    }
    return r;
  },
  shield(item, cur) {
    const r = withProjectile(item, cur);
    if (item.attrs.id === 'Shield of Ogmur') {
      const tag = kids(item, 'ConditionEffect').find(c => c.text === 'Armor Broken');
      const str = 'Party Effect: ' + font(`Armor Broken for ${at(tag, 'duration')} secs\n`, UNTIERED);
      r.text += str;
      r.tags.set(key(tag), str);
    }
    return r;
  },
  armor(item, cur) {
    const r = result();
    const def = kids(item, 'ActivateOnEquip').filter(a => a.attrs.stat === '21');
    const other = kids(cur, 'ActivateOnEquip').filter(a => a.attrs.stat === '21');
    if (def.length === 1 && other.length === 1) {
      const d = int(at(def[0], 'amount')), o = int(at(other[0], 'amount'));
      r.onEquip.set(key(def[0]), font(`+${d} Defense`, diffColor(d - o)));
    }
    return r;
  },
  spell(item, cur) {
    const r = result();
    const p = kids(item, 'Projectile')[0], o = kids(cur, 'Projectile')[0];
    const minD = int(val(p, 'MinDamage')), maxD = int(val(p, 'MaxDamage'));
    const avg = (minD + maxD) / 2, oAvg = (int(val(o, 'MinDamage')) + int(val(o, 'MaxDamage'))) / 2;
    r.text = `Damage: <font color="${diffColor(avg - oAvg)}">${minD === maxD ? maxD : `${minD} - ${maxD}`}</font>\n`;
    const range = num(val(p, 'Speed')) * num(val(p, 'LifetimeMS')) / 10000;
    const oRange = num(val(o, 'Speed')) * num(val(o, 'LifetimeMS')) / 10000;
    r.text += `Range: <font color="${diffColor(range - oRange)}">${range}</font>\n`;
    r.tags.set(key(p), true);
    return r;
  },
  seal(item, cur) {
    const r = result();
    const aura = (e, effect) => acts(e, 'ConditionEffectAura').find(a => a.attrs.effect === effect) ?? null;
    const heal = aura(item, 'Healing'), dmg = aura(item, 'Damaging'), oHeal = aura(cur, 'Healing'), oDmg = aura(cur, 'Damaging');
    if (heal && dmg && oHeal && oDmg) {
      for (const [tag, other, word] of [[heal, oHeal, 'Healing'], [dmg, oDmg, 'Damaging']]) {
        const d = int(at(tag, 'duration'));
        const avg = 0.5 * d * 0.5 * num(at(tag, 'range')), oAvg = 0.5 * int(at(other, 'duration')) * 0.5 * num(at(other, 'range'));
        r.text += 'Party Effect: ' + font(`Within ${at(tag, 'range')} sqrs\n${word} for ${d} seconds\n`, diffColor(avg - oAvg));
        r.tags.set(key(tag), true);
      }
      if (item.attrs.id === 'Seal of Blasphemous Prayer') {
        const tag = acts(item, 'ConditionEffectSelf')[0];
        r.text += 'Effect on Self:\n' + font(`Invulnerable for ${at(tag, 'duration')} secs\n`, UNTIERED);
        r.tags.set(key(tag), true);
      }
    }
    return r;
  },
  cloak(item, cur) {
    const r = result();
    const invisible = e => acts(e, 'ConditionEffectSelf').find(a => a.attrs.effect === 'Invisible') ?? null;
    const inv = invisible(item), other = invisible(cur);
    if (inv && other) {
      const d = num(at(inv, 'duration'));
      r.text += 'Effect on Self:\n' + font(`Invisible for ${d} secs\n`, diffColor(d - num(at(other, 'duration'))));
      r.tags.set(key(inv), true);
    }
    if (item.attrs.id === 'Cloak of the Planewalker') {
      r.text += font('Teleport to Target\n', UNTIERED);
      r.tags.set(key(acts(item, 'Teleport')[0]), true);
    }
    return r;
  },
  quiver(item, cur) {
    const r = result(), p = generalProjectile(item, cur);
    const slow = e => kids(kids(e, 'Projectile')[0], 'ConditionEffect').filter(c => ['Slowed', 'Paralyzed', 'Dazed'].includes(c.text));
    const cond = slow(item), other = slow(cur);
    r.text = p.text;
    for (const k of p.tags.keys()) r.tags.set(k, true);
    if (cond.length === 1 && other.length === 1) {
      const html = 'Shot Effect:\n' + font(` ${cond[0].text} for ${num(at(cond[0], 'duration'))} secs\n`, NO_DIFF);
      r.text += html;
      r.tags.set(key(cond[0]), html);
    }
    return r;
  },
  helm(item, cur) {
    const r = result();
    const find = (e, type, effect) => acts(e, type).find(a => a.attrs.effect === effect) ?? null;
    const berserk = find(item, 'ConditionEffectAura', 'Berserk'), oBerserk = find(cur, 'ConditionEffectAura', 'Berserk');
    const speedy = find(item, 'ConditionEffectSelf', 'Speedy'), oSpeedy = find(cur, 'ConditionEffectSelf', 'Speedy');
    const armored = find(item, 'ConditionEffectSelf', 'Armored');
    if (berserk && oBerserk) {
      const range = num(at(berserk, 'range')), d = num(at(berserk, 'duration'));
      const avg = 0.5 * range + 0.5 * d, oAvg = 0.5 * num(at(oBerserk, 'range')) + 0.5 * num(at(oBerserk, 'duration'));
      r.text += 'Party Effect: ' + font(`Within ${range} sqrs\nBerserk for ${d} secs\n`, diffColor(avg - oAvg));
      r.tags.set(key(berserk), true);
    }
    if (speedy && oSpeedy) {
      const d = num(at(speedy, 'duration'));
      r.text += 'Effect on Self:\n' + font(`Speedy for ${d} secs\n`, diffColor(d - num(at(oSpeedy, 'duration'))));
      r.tags.set(key(speedy), true);
    } else if (speedy) {
      r.text += 'Effect on Self:\n' + font(`Speedy for ${at(speedy, 'duration')} secs\n`, BETTER);
      r.tags.set(key(speedy), true);
    }
    if (armored) {
      r.text += 'Effect on Self:\n' + font(`Armored for ${at(armored, 'duration')} secs\n`, UNTIERED);
      r.tags.set(key(armored), true);
    }
    return r;
  },
  poison(item, cur) {
    const r = result();
    const a = acts(item, 'PoisonGrenade'), o = acts(cur, 'PoisonGrenade');
    if (a.length === 1 && o.length === 1) {
      const dmg = int(at(a[0], 'totalDamage')), radius = num(at(a[0], 'radius')), d = num(at(a[0], 'duration'));
      const avg = 0.33 * dmg + 0.33 * radius + 0.33 * d;
      const oAvg = 0.33 * int(at(o[0], 'totalDamage')) + 0.33 * num(at(o[0], 'radius')) + 0.33 * num(at(o[0], 'duration'));
      r.text += 'Poison Grenade: ' + font(`${dmg} HP over ${d} secs within ${radius} sqrs\n`, diffColor(avg - oAvg));
      r.tags.set(key(a[0]), true);
    }
    return r;
  },
  skull(item, cur) {
    const r = result();
    const blast = acts(item, 'VampireBlast')[0], other = acts(cur, 'VampireBlast')[0];
    if (blast && other) {
      const radius = num(at(blast, 'radius')), dmg = int(at(blast, 'totalDamage'));
      const avg = 0.5 * radius + 0.5 * dmg, oAvg = 0.5 * num(at(other, 'radius')) + 0.5 * int(at(other, 'totalDamage'));
      r.text += 'Steal: ' + font(`${dmg} HP within ${radius} sqrs\n`, diffColor(avg - oAvg));
      r.tags.set(key(blast), true);
    }
    return r;
  },
  trap(item, cur) {
    const r = result();
    const trap = acts(item, 'Trap')[0], other = acts(cur, 'Trap')[0];
    if (trap && other) {
      if (item.attrs.id === 'Coral Venom Trap') {
        r.text += 'Trap: ' + font(`${at(trap, 'totalDamage')} HP within ${at(trap, 'radius')} sqrs\nParalyzed for ${at(trap, 'condDuration')} seconds\n`, UNTIERED);
      } else {
        const radius = num(at(trap, 'radius')), dmg = int(at(trap, 'totalDamage')), d = int(at(trap, 'condDuration'));
        const avg = 0.33 * radius + 0.33 * dmg + 0.33 * d;
        const oAvg = 0.33 * num(at(other, 'radius')) + 0.33 * int(at(other, 'totalDamage')) + 0.33 * int(at(other, 'condDuration'));
        r.text += 'Trap: ' + font(`${dmg} HP within ${radius} sqrs\n Slowed for ${d} seconds\n`, diffColor(avg - oAvg));
      }
      r.tags.set(key(trap), true);
    }
    return r;
  },
  orb(item, cur) {
    const r = result();
    const one = e => { const m = acts(e, 'StasisBlast'); return m.length === 1 ? m[0] : null; };
    const blast = one(item), other = one(cur);
    if (blast && other) {
      const d = int(at(blast, 'duration'));
      r.text += 'Stasis on group: ' + font(`${d} secs\n`, diffColor(d - int(at(other, 'duration'))));
      r.tags.set(key(blast), true);
      if (item.attrs.id === 'Orb of Conflict') {
        const self = acts(item, 'ConditionEffectSelf');
        const speedy = self.find(a => a.attrs.effect === 'Speedy'), damaging = self.find(a => a.attrs.effect === 'Damaging');
        r.text += 'Effect on Self:\n' + font(`Speedy for ${at(speedy, 'duration')} secs\n`, UNTIERED);
        // The missing space before "secs" is in the original client.
        r.text += 'Effect on Self:\n' + font(`Damaging for ${at(damaging, 'duration')}secs\n`, UNTIERED);
        r.tags.set(key(speedy), true);
        r.tags.set(key(damaging), true);
      }
    }
    return r;
  },
  prism(item, cur) {
    const r = result();
    const decoy = acts(item, 'Decoy'), other = acts(cur, 'Decoy');
    if (decoy.length === 1 && other.length === 1) {
      const d = num(at(decoy[0], 'duration'));
      r.text += 'Decoy: ' + font(`${d} secs\n`, diffColor(d - num(at(other[0], 'duration'))));
      r.tags.set(key(decoy[0]), true);
    }
    return r;
  },
  scepter(item, cur) {
    const r = result();
    const l = acts(item, 'Lightning'), o = acts(cur, 'Lightning');
    if (l.length === 1 && o.length === 1) {
      const dmg = int(at(l[0], 'totalDamage')), targets = int(at(l[0], 'maxTargets'));
      r.text += 'Lightning: ' + font(`${dmg} to ${targets} targets\n`, diffColor(dmg - int(at(o[0], 'totalDamage'))));
      r.tags.set(key(l[0]), true);
      if ('condEffect' in l[0].attrs) r.text += 'Shot Effect:\n' + font(` ${l[0].attrs.condEffect} for ${num(at(l[0], 'condDuration'))} secs\n`, NO_DIFF);
    }
    return r;
  }
};
// SlotComparisonFactory: slot type -> comparison.
const BY_SLOT = {
  1: generalProjectile, 2: generalProjectile, 3: generalProjectile, 4: COMPARISONS.tome, 5: COMPARISONS.shield,
  6: COMPARISONS.armor, 7: COMPARISONS.armor, 8: generalProjectile, 11: COMPARISONS.spell, 12: COMPARISONS.seal,
  13: COMPARISONS.cloak, 14: COMPARISONS.armor, 15: COMPARISONS.quiver, 16: COMPARISONS.helm, 17: generalProjectile,
  18: COMPARISONS.poison, 19: COMPARISONS.skull, 20: COMPARISONS.trap, 21: COMPARISONS.orb, 22: COMPARISONS.prism,
  23: COMPARISONS.scepter, 24: generalProjectile, 25: generalProjectile
};

// ---------- EquipmentToolTip ----------
/**
 * @param x       the item's <Object> element
 * @param classes [{name, slotTypes: number[]}] in objects.xml order
 * @param displayName  (element) => DisplayId or id
 */
export function equipmentTooltip(x, {classes, displayName}) {
  const cur = x; // no player: the client compares the item with itself
  const slotType = int(val(x, 'SlotType'));
  const cmp = BY_SLOT[slotType] ? BY_SLOT[slotType](x, cur) : result();
  const effects = [];
  const add = (name, value) => effects.push([name, value]);

  // addTierText
  const isPet = acts(x, 'PermaPet').length >= 1;
  const tier = has(x, 'Consumable') || isPet ? null : has(x, 'Tier') ? `T${val(x, 'Tier')}` : 'UT';

  // addNumProjectilesTagsToEffectsList
  if (has(x, 'NumProjectiles') && !cmp.tags.has(listKey(kids(x, 'NumProjectiles')))) add('Shots', val(x, 'NumProjectiles'));
  // addProjectileTagsToEffectsList
  if (has(x, 'Projectile') && !cmp.tags.has(listKey(kids(x, 'Projectile')))) {
    const p = kids(x, 'Projectile')[0];
    const minD = int(val(p, 'MinDamage')), maxD = int(val(p, 'MaxDamage'));
    add('Damage', minD === maxD ? String(minD) : `${minD} - ${maxD}`);
    add('Range', rangeString(num(val(p, 'Speed')) * num(val(p, 'LifetimeMS')) / 10000));
    if (has(p, 'MultiHit')) add('', 'Shots hit multiple targets');
    if (has(p, 'PassesCover')) add('', 'Shots pass through obstacles');
    const conds = kids(p, 'ConditionEffect');
    for (const c of conds) {
      if (cmp.tags.get(key(c)) == null) add('Shot Effect', `${conds.map(e => e.text).join('')} for ${conds.map(e => at(e, 'duration')).join('')} secs`);
    }
  }
  // addActivateTagsToEffectsList
  for (const a of kids(x, 'Activate')) {
    if (cmp.tags.get(key(a)) === true) continue;
    const A = n => at(a, n);
    switch (a.text) {
      case 'ConditionEffectAura': add('Party Effect', `Within ${A('range')} sqrs`); add('', `  ${A('effect')} for ${A('duration')} secs`); break;
      case 'ConditionEffectSelf': add('Effect on Self', ''); add('', `  ${A('effect')} for ${A('duration')} secs`); break;
      case 'Heal': add('', `+${A('amount')} HP`); break;
      case 'HealNova': add('Party Heal', `${A('amount')} HP at ${A('range')} sqrs`); break;
      case 'Magic': add('', `+${A('amount')} MP`); break;
      case 'MagicNova': add('Fill Party Magic', `${A('amount')} MP at ${A('range')} sqrs`); break;
      case 'Teleport': add('', 'Teleport to Target'); break;
      case 'VampireBlast': add('Steal', `${A('totalDamage')} HP within ${A('radius')} sqrs`); break;
      case 'Trap':
        add('Trap', `${A('totalDamage')} HP within ${A('radius')} sqrs`);
        add('', `  ${'condEffect' in a.attrs ? A('condEffect') : 'Slowed'} for ${'condDuration' in a.attrs ? A('condDuration') : '5'} secs`);
        break;
      case 'StasisBlast': add('Stasis on Group', `${A('duration')} secs`); break;
      case 'Decoy': add('Decoy', `${A('duration')} secs`); break;
      case 'Lightning': add('Lightning', ''); add('', ` ${A('totalDamage')} to ${A('maxTargets')} targets`); break;
      case 'PoisonGrenade': add('Poison Grenade', ''); add('', ` ${A('totalDamage')} HP over ${A('duration')} secs within ${A('radius')} sqrs\n`); break;
      case 'RemoveNegativeConditions':
      case 'RemoveNegativeConditionsSelf': add('', 'Removes negative conditions'); break;
      case 'IncrementStat': {
        const stat = int(A('stat'));
        add('', stat !== 1 && stat !== 4 ? `Permanently increases ${statName(stat)}` : `+${int(A('amount'))} ${statName(stat)}`);
        break;
      }
    }
  }
  // addActivateOnEquipTagsToEffectsList
  kids(x, 'ActivateOnEquip').forEach((a, i) => {
    if (i === 0) add('On Equip', '');
    const custom = cmp.onEquip.get(key(a));
    if (custom != null) add('', ` ${custom}`);
    else if (a.text === 'IncrementStat') {
      const stat = int(at(a, 'stat')), amount = int(at(a, 'amount'));
      const others = kids(cur, 'ActivateOnEquip').filter(o => int(at(o, 'stat')) === stat);
      let color = others.length === 1 ? diffColor(amount - int(at(others[0], 'amount'))) : NO_DIFF;
      let text = `+${amount}`;
      if (amount <= -1) { text = String(amount); color = '#FF0000'; }
      add('', font(`${text} ${statName(stat)}`, color));
    }
  });
  // addDoseTagsToEffectsList, addMpCostTagToEffectsList, addFameBonusTagToEffectsList
  if (has(x, 'Doses')) add('Doses', val(x, 'Doses'));
  if (has(x, 'MpCost') && !cmp.tags.get(key(kids(x, 'MpCost')[0]))) add('MP Cost', val(x, 'MpCost'));
  if (has(x, 'FameBonus')) add('Fame Bonus', font(`${int(val(x, 'FameBonus'))}%`, NO_DIFF));

  // makeEffectsList / BuildEffectsHTML
  const effectsHtml = effects.map(([name, value]) => (name ? `${name}: ` : '') + font(value, '#FFFF8F')).join('\n');
  const html = effects.length || cmp.text ? cmp.text + effectsHtml : '';

  // makeRestrictionList (no player and no container, so only these apply)
  const restrictions = [];
  if (has(x, 'Soulbound')) restrictions.push(['Soulbound', BASE_COLOR, false]);
  if (slotType !== 10 && slotType !== 9) {
    const usable = classes.filter(c => c.slotTypes.includes(slotType)).map(c => c.name);
    restrictions.push([`Usable by: ${usable.join(', ')}`, BASE_COLOR, false]);
  }

  return {t: displayName(x), r: tier, d: val(x, 'Description'), e: toLines(html), x: restrictions};
}

/** Turn the client's htmlText (font tags and newlines) into lines of [text, colour] runs. */
export function toLines(html) {
  const lines = [[]];
  const colors = [BASE_COLOR];
  for (const [tok, open, close, text] of html.matchAll(/<font color="([^"]+)">|(<\/font>)|([^<]+|<)/g)) {
    if (open) { colors.push(open); continue; }
    if (close) { if (colors.length > 1) colors.pop(); continue; }
    (text ?? tok).split('\n').forEach((part, i) => {
      if (i > 0) lines.push([]);
      if (!part) return;
      const color = colors.at(-1);
      const line = lines.at(-1), last = line.at(-1);
      const same = last && (last[1] ?? BASE_COLOR).toLowerCase() === color.toLowerCase();
      if (same) last[0] += part;
      else line.push(color.toLowerCase() === BASE_COLOR.toLowerCase() ? [part] : [part, color]);
    });
  }
  while (lines.length && !lines.at(-1).length) lines.pop();
  return lines;
}
