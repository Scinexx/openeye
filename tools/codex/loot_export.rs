
// ---- appended by OpenEye (tools/codex/loot_export.rs) ----
// Lists every item each object can drop, straight from this file's own loot tables.
// Run with: OPENEYE_LOOT_OUT=loot.json cargo test openeye_export -- --nocapture
#[cfg(test)]
mod openeye_export {
    use super::*;
    use std::collections::{BTreeMap, BTreeSet};

    #[test]
    fn openeye_export() {
        let Ok(out) = std::env::var("OPENEYE_LOOT_OUT") else { return };
        let content = Content::load(std::path::Path::new("data")).expect("load data");
        let mut drops = BTreeMap::<u16, BTreeSet<u16>>::new();
        for &kind in content.objects.keys() {
            let mut items = BTreeSet::new();
            // table() only answers for objects with an encounter profile, as in collectibles().
            if crate::encounter::profile(kind).is_some() {
                for (_, pick) in table(kind).iter().chain(fauna_private_table(kind)) {
                    items.extend(candidates(&content, *pick));
                }
                items.extend(bonus(kind).iter().map(|(_, item)| *item));
            }
            // chest_table() panics for objects that are not chests, so try it quietly for every object.
            let hook = std::panic::take_hook();
            std::panic::set_hook(Box::new(|_| {}));
            let chest = std::panic::catch_unwind(|| chest_table(kind));
            std::panic::set_hook(hook);
            if let Ok(chest) = chest {
                for (_, pick) in chest {
                    items.extend(candidates(&content, pick));
                }
            }
            if !items.is_empty() {
                drops.insert(kind, items);
            }
        }
        // Drops written by hand in the world's loot code rather than in these tables.
        let extras: &[(u16, &[u16], &str)] = &[
            (0xe37, &[0xc25], "world.rs: rum"),
            (crate::dungeon::beach::BUM, &[0xc2e], "world.rs: beach bum key"),
            (crate::dungeon::trench::THESSAL, &[0xaea], "world.rs: Thessal"),
            (crate::dungeon::trench::HERMIT, &[0xa34, 0xa4c], "world.rs: required potions"),
            (crate::dungeon::tomb::SPHINX, &[0xa34, 0xa35], "world.rs: required potions"),
            (crate::dungeon::lab::BOSS, &[0xa35], "world/lab.rs"),
            (crate::dungeon::spider::BOSS, &[0x707], "world/spider.rs"),
        ];
        let mut extra_list = Vec::new();
        for (kind, items, source) in extras {
            drops.entry(*kind).or_default().extend(items.iter().copied());
            extra_list.push(serde_json::json!({"kind": kind, "items": items, "source": source}));
        }
        let json = serde_json::json!({
            "drops": drops.iter().map(|(k, v)| (k.to_string(), v.iter().collect::<Vec<_>>())).collect::<BTreeMap<_, _>>(),
            "extras": extra_list,
            "extraItems": extras.iter().flat_map(|(_, items, _)| items.iter()).collect::<BTreeSet<_>>(),
        });
        std::fs::write(out, serde_json::to_string(&json).unwrap()).expect("write export");
    }
}
