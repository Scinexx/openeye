// Just enough of the SWF format to pull embedded bitmaps out of the Open RotMG client,
// plus a tiny PNG encoder. No dependencies.
import {inflateSync, deflateSync} from 'node:zlib';

/** Map of embedded class name (e.g. "Embeds_lofiObj3Embed_") -> {width, height, rgba}. */
export function swfBitmaps(file) {
  let body;
  const sig = file.subarray(0, 3).toString('latin1');
  if (sig === 'FWS') body = file.subarray(8);
  else if (sig === 'CWS') body = inflateSync(file.subarray(8));
  else throw new Error(`Unsupported SWF signature ${sig}`);
  const nbits = body[0] >> 3;
  let p = Math.ceil((5 + 4 * nbits) / 8) + 4;
  const bitmaps = new Map(), symbols = new Map();
  while (p < body.length) {
    const head = body.readUInt16LE(p); p += 2;
    const code = head >> 6;
    let len = head & 0x3f;
    if (len === 0x3f) { len = body.readUInt32LE(p); p += 4; }
    const tag = body.subarray(p, p + len);
    p += len;
    if (code === 0) break;
    if (code === 20 || code === 36) bitmaps.set(tag.readUInt16LE(0), {code, tag});
    if (code === 76) {
      let q = 2;
      for (let n = tag.readUInt16LE(0); n > 0; n--) {
        const id = tag.readUInt16LE(q); q += 2;
        const end = tag.indexOf(0, q);
        symbols.set(tag.subarray(q, end).toString('utf8'), id);
        q = end + 1;
      }
    }
  }
  const out = new Map();
  for (const [name, id] of symbols) {
    const b = bitmaps.get(id);
    if (!b || b.tag[2] !== 5) continue; // only 32-bit lossless bitmaps are used for sprite sheets
    const width = b.tag.readUInt16LE(3), height = b.tag.readUInt16LE(5);
    const argb = inflateSync(b.tag.subarray(7));
    const rgba = Buffer.alloc(width * height * 4);
    for (let i = 0; i < width * height; i++) {
      const a = b.code === 36 ? argb[i * 4] : 255;
      const un = c => (b.code === 36 && a > 0 && a < 255 ? Math.min(255, Math.round(c * 255 / a)) : c);
      rgba[i * 4] = un(argb[i * 4 + 1]);
      rgba[i * 4 + 1] = un(argb[i * 4 + 2]);
      rgba[i * 4 + 2] = un(argb[i * 4 + 3]);
      rgba[i * 4 + 3] = a;
    }
    out.set(name, {width, height, rgba});
  }
  return out;
}

const CRC = new Int32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c; });
const crc32 = buf => { let c = -1; for (const b of buf) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ -1) >>> 0; };
const chunk = (type, data) => {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
};
/** Encode RGBA pixels as a PNG file. */
export function encodePng(width, height, rgba) {
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) rgba.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, {level: 9})), chunk('IEND', Buffer.alloc(0))]);
}
