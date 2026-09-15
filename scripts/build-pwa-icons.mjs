// BEACON — deterministic PWA icon generator (ADR-047). Zero dependencies: rasterises the beacon glyph
// (a dark navy tile, a light ring, a lit centre) straight into PNG with node:zlib. Run once when the mark
// changes: `node scripts/build-pwa-icons.mjs` → public/icons/*.png (committed; the runtime never runs this).
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';

const BG = [0x0b, 0x0f, 0x14]; // --bg
const RING = [0x69, 0xb3, 0xff]; // --primary
const CORE = [0xe8, 0xee, 0xf5]; // --fg
const WARM = [0xe2, 0xb5, 0x3d]; // --warn

function crc32(buf) {
  let c;
  const table = [];
  for (let n = 0; n < 256; n += 1) {
    c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  let crc = 0xffffffff;
  for (const b of buf) crc = table[(crc ^ b) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function png(size, pixel) {
  const raw = Buffer.alloc((size * 3 + 1) * size);
  for (let y = 0; y < size; y += 1) {
    raw[y * (size * 3 + 1)] = 0; // filter: none
    for (let x = 0; x < size; x += 1) {
      const [r, g, b] = pixel(x + 0.5, y + 0.5, size);
      const o = y * (size * 3 + 1) + 1 + x * 3;
      raw[o] = r;
      raw[o + 1] = g;
      raw[o + 2] = b;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // colour type RGB
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const mix = (a, b, t) => a.map((v, i) => Math.round(v + (b[i] - v) * t));

/** The mark: a ring (the beacon's sweep) around a lit core, with a warm notch at 12 o'clock. */
function glyph(x, y, size, inset) {
  const c = size / 2;
  const r = Math.hypot(x - c, y - c) / (size / 2);
  const usable = 1 - inset;
  const ring = 0.62 * usable;
  const ringW = 0.09 * usable;
  const core = 0.3 * usable;
  const ang = Math.atan2(y - c, x - c);
  const notch =
    Math.abs(ang + Math.PI / 2) < 0.28 && r > ring - ringW * 1.6 && r < ring + ringW * 1.6;
  if (notch) return WARM;
  if (Math.abs(r - ring) < ringW) {
    const edge = 1 - Math.abs(r - ring) / ringW;
    return mix(BG, RING, Math.min(1, edge * 3));
  }
  if (r < core) {
    const edge = 1 - r / core;
    return mix(RING, CORE, Math.min(1, edge * 1.4));
  }
  return BG;
}

mkdirSync('public/icons', { recursive: true });
writeFileSync(
  'public/icons/beacon-192.png',
  png(192, (x, y, s) => glyph(x, y, s, 0.04)),
);
writeFileSync(
  'public/icons/beacon-512.png',
  png(512, (x, y, s) => glyph(x, y, s, 0.04)),
);
// Maskable: the safe zone is the inner 80 %, so the mark is inset further and the tile fills the rest.
writeFileSync(
  'public/icons/beacon-maskable-512.png',
  png(512, (x, y, s) => glyph(x, y, s, 0.24)),
);
process.stdout.write('pwa icons → public/icons/ (beacon-192, beacon-512, beacon-maskable-512)\n');
