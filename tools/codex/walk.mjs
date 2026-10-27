// Walking frames for every class, as the client's map loading screen shows them: facing
// right, AnimatedChar.imageFromDir(RIGHT, WALK, 0) then (RIGHT, WALK, 0.5).
// The client's "players" sheet has 7 frames of 8x8 per direction and 3 directions per class
// (24 rows); in this build its embed name is obfuscated.
import {encodePng} from './swf.mjs';

const PLAYERS = '_-U0';

/** @param classes [{id}] @param objects [{type, body}] @param sheets Map from swfBitmaps */
export function buildWalk({classes, objects, sheets}) {
  const sheet = sheets.get(PLAYERS);
  if (!sheet || sheet.width !== 56 || sheet.height % 24) throw new Error(`players sheet ${PLAYERS} not found in client.swf`);
  const W = 16, H = classes.length * 8, rgba = Buffer.alloc(W * H * 4), rows = {};
  classes.forEach((c, row) => {
    const o = objects.find(x => x.type === c.id);
    const index = Number(o?.body.match(/<AnimatedTexture>\s*<File>players<\/File>\s*<Index>([^<]+)<\/Index>/)?.[1]);
    if (!Number.isFinite(index)) throw new Error(`class ${c.id} has no players texture`);
    // AnimatedChar.loadDir: walk = [walk1, walk2], and when walk2 is empty (it is, facing
    // right) the standing frame takes its place.
    const opaque = col => { for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) if (sheet.rgba[((index * 24 + y) * sheet.width + col * 8 + x) * 4 + 3]) return true; return false; };
    const cols = [1, opaque(2) ? 2 : 0];
    cols.forEach((col, f) => {
      for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) {
        const si = ((index * 24 + y) * sheet.width + col * 8 + x) * 4, di = ((row * 8 + y) * W + f * 8 + x) * 4;
        sheet.rgba.copy(rgba, di, si, si + 4);
      }
    });
    rows[c.id] = row;
  });
  return {rows, sheet: {width: W, height: H, png: encodePng(W, H, rgba)}};
}
