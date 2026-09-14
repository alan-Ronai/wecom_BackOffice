/**
 * Generates the favicon set in `public/` from one description of the mark.
 *
 * Committing three opaque binaries with no way to regenerate them is how an icon set drifts from
 * the brand it is supposed to carry: the next person to change the navy has no idea these files
 * encode it. So the mark lives here as geometry — a rounded navy tile and a red `w` polyline, the
 * two values from `app.css`'s brand DNA line — and the binaries are build output of this file.
 *
 *   node scripts/make-icons.mjs
 *
 * Deliberately dependency-free. It rasterizes with a signed-distance function and encodes PNG with
 * node's own zlib, so regenerating the icons never depends on a toolchain someone has to install
 * first (and `sharp`/`canvas` are native builds this repo has no other reason to carry).
 *
 * `icon.svg` is written from the same numbers, so the vector and the raster cannot disagree.
 */
import { deflateSync } from 'node:zlib';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const PUBLIC = join(dirname(fileURLToPath(import.meta.url)), '..', 'public');

/** `--navy` and `--red` in `src/styles/app.css`. */
const NAVY = [0x1f, 0x2e, 0x3b];
const RED = [0xff, 0x3d, 0x00];

/** The `w`, in unit coordinates. Four strokes, drawn as one round-joined polyline. */
const W = [
  [0.2, 0.33],
  [0.345, 0.72],
  [0.5, 0.46],
  [0.655, 0.72],
  [0.8, 0.33],
];
const STROKE = 0.115;
const RADIUS = 0.22;

/** Distance from p to segment ab — the standard clamped projection. */
const segDist = (px, py, [ax, ay], [bx, by]) => {
  const vx = bx - ax;
  const vy = by - ay;
  const wx = px - ax;
  const wy = py - ay;
  const t = Math.max(0, Math.min(1, (wx * vx + wy * vy) / (vx * vx + vy * vy)));
  return Math.hypot(px - (ax + t * vx), py - (ay + t * vy));
};

/** Signed distance to a rounded square centred on the tile — negative inside. */
const roundedRectDist = (px, py, r) => {
  const qx = Math.abs(px - 0.5) - (0.5 - r);
  const qy = Math.abs(py - 0.5) - (0.5 - r);
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r;
};

/**
 * Renders the mark at `size`, returning raw RGBA.
 *
 * Coverage is taken from the distance field across one pixel's width rather than by supersampling,
 * which is what keeps the 16 px rendering legible: the `w` is barely two pixels thick there, and a
 * hard threshold turns it into an unreadable smudge.
 */
const render = (size, maskable = false) => {
  const px = new Uint8Array(size * size * 4);
  const unit = 1 / size;
  // A maskable icon is cropped to whatever shape the launcher likes, and only the middle 80% is
  // guaranteed to survive. So that variant is full-bleed (no rounded corners of our own to be
  // clipped raggedly) with the glyph shrunk into the safe circle.
  const scale = maskable ? 0.8 : 1;
  const at = (t) => 0.5 + (t - 0.5) * scale;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = (x + 0.5) / size;
      const v = (y + 0.5) / size;

      const tile = maskable ? 1 : 1 - smoothstep(-unit, unit, roundedRectDist(u, v, RADIUS));

      let d = Infinity;
      for (let i = 0; i < W.length - 1; i++) {
        const a = W[i].map(at);
        const b = W[i + 1].map(at);
        d = Math.min(d, segDist(u, v, a, b));
      }
      const w = (STROKE * scale) / 2;
      const glyph = 1 - smoothstep(w - unit, w + unit, d);

      // Glyph over tile, tile over transparency.
      const a = tile;
      const o = (x + y * size) * 4;
      for (let c = 0; c < 3; c++) px[o + c] = Math.round(NAVY[c] * (1 - glyph) + RED[c] * glyph);
      px[o + 3] = Math.round(a * 255);
    }
  }
  return px;
};

const smoothstep = (e0, e1, x) => {
  const t = Math.max(0, Math.min(1, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};

// ---- PNG ----------------------------------------------------------------------------------

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
};

const png = (size, rgba) => {
  // One filter byte (0 = None) per scanline.
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    Buffer.from(rgba.buffer, y * size * 4, size * 4).copy(raw, y * (size * 4 + 1) + 1);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // colour type: RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
};

// ---- ICO ----------------------------------------------------------------------------------

/** PNG-compressed entries, which every browser this app supports has read since IE11. */
const ico = (images) => {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2); // type: icon
  header.writeUInt16LE(images.length, 4);
  let offset = 6 + images.length * 16;
  const dir = [];
  for (const { size, data } of images) {
    const e = Buffer.alloc(16);
    e[0] = size >= 256 ? 0 : size;
    e[1] = size >= 256 ? 0 : size;
    e[4] = 1; // colour planes
    e[6] = 32; // bits per pixel
    e.writeUInt32LE(data.length, 8);
    e.writeUInt32LE(offset, 12);
    dir.push(e);
    offset += data.length;
  }
  return Buffer.concat([header, ...dir, ...images.map((i) => i.data)]);
};

// ---- SVG ----------------------------------------------------------------------------------

const svg = () => {
  const pts = W.map(([x, y]) => `${(x * 32).toFixed(2)},${(y * 32).toFixed(2)}`).join(' ');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" role="img" aria-label="wecom">
  <rect width="32" height="32" rx="${(RADIUS * 32).toFixed(2)}" fill="#1F2E3B"/>
  <polyline points="${pts}" fill="none" stroke="#FF3D00" stroke-width="${(STROKE * 32).toFixed(2)}"
    stroke-linecap="round" stroke-linejoin="round"/>
</svg>
`;
};

// ---- write --------------------------------------------------------------------------------

const sizes = [16, 32, 48];
writeFileSync(
  join(PUBLIC, 'favicon.ico'),
  ico(sizes.map((size) => ({ size, data: png(size, render(size)) }))),
);
writeFileSync(join(PUBLIC, 'apple-touch-icon.png'), png(180, render(180)));
writeFileSync(join(PUBLIC, 'icon-512.png'), png(512, render(512)));
writeFileSync(join(PUBLIC, 'icon-512-maskable.png'), png(512, render(512, true)));
writeFileSync(join(PUBLIC, 'icon.svg'), svg());
console.log(
  'wrote favicon.ico (16/32/48), apple-touch-icon.png (180), icon-512.png,' +
    ' icon-512-maskable.png, icon.svg',
);
