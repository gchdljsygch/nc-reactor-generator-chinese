#!/usr/bin/env node
/**
 * R5.3 — generates the two PNG app icons for the PWA manifest.
 *
 * Why a generator instead of "some PNGs someone drew": the icon has to be
 * *reproducible*. Committing a binary without the recipe makes it impossible to
 * re-derive when the palette in `packages/app/src/styles/theme.css` changes —
 * and this repository's rule is that every artifact has a command (docs/r3/README.md).
 *
 * No dependency is used or added: the PNG is written by hand with `node:zlib`
 * (`deflateSync`) plus the four required chunks (IHDR / IDAT / IEND + CRC32).
 *
 * The motif mirrors `packages/app/public/icons/icon.svg`: a 3×3 block grid on the
 * dark theme background, casing in `--casing`, the centre block in `--accent`.
 * The artwork is inset to ~62 % of the canvas so the same file is safe as a
 * `maskable` icon (the maskable safe zone is a centred circle of 80 % diameter).
 *
 * Usage:
 *
 *   node tools/ts/make-icons.mjs          # (re)write the two PNGs
 *
 * Output (checked in, because a build must not need a code-generation step):
 *
 *   packages/app/public/icons/icon-192.png
 *   packages/app/public/icons/icon-512.png
 *
 * The output is deterministic: same source, same bytes (asserted by re-running
 * the script and comparing SHA256, see docs/r5/offline.md).
 */
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT_DIR = fileURLToPath(new URL('../../packages/app/public/icons/', import.meta.url));

/** Colours copied from `[data-theme="dark"]` in packages/app/src/styles/theme.css. */
const BACKGROUND = [0x14, 0x16, 0x1b];
const CASING = [0x3a, 0x3f, 0x4b];
const ACCENT = [0x7f, 0xd1, 0xff];

// ------------------------------------------------------------------ PNG writing

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buffer) {
  let c = 0xffffffff;
  for (const byte of buffer) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([length, body, crc]);
}

/** Truecolour+alpha (8-bit RGBA), filter 0 on every scanline: the simplest valid PNG. */
function encodePng(size, pixels) {
  const stride = size * 4 + 1;
  const raw = Buffer.alloc(stride * size);
  for (let y = 0; y < size; y++) {
    raw[y * stride] = 0;
    for (let x = 0; x < size; x++) {
      const [r, g, b, a] = pixels(x, y);
      const at = y * stride + 1 + x * 4;
      raw[at] = r;
      raw[at + 1] = g;
      raw[at + 2] = b;
      raw[at + 3] = a;
    }
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
}

// ---------------------------------------------------------------------- artwork

/**
 * The same geometry as `icon.svg`, expressed in fractions of the canvas so the
 * 192 px and 512 px files are the same picture at two resolutions.
 */
const INSET = 0.19; // artwork starts here; spans 1 - 2*INSET = 62 % of the canvas
const GAP = 0.031; // gap between blocks
const RADIUS = 0.023; // corner radius of a block

function isRing(row, column) {
  return !(row === 1 && column === 1);
}

function colourFor(row, column) {
  return isRing(row, column) ? CASING : ACCENT;
}

function makePaint(size) {
  const inset = INSET * size;
  const gap = GAP * size;
  const radius = RADIUS * size;
  const block = (size - 2 * inset - 2 * gap) / 3;
  return (x, y) => {
    const px = x + 0.5;
    const py = y + 0.5;
    if (px < inset || py < inset) return [...BACKGROUND, 255];
    const column = Math.floor((px - inset) / (block + gap));
    const row = Math.floor((py - inset) / (block + gap));
    if (column > 2 || row > 2) return [...BACKGROUND, 255];
    const left = inset + column * (block + gap);
    const top = inset + row * (block + gap);
    const dx = px - left;
    const dy = py - top;
    if (dx < 0 || dy < 0 || dx > block || dy > block) return [...BACKGROUND, 255];
    // Rounded corners: only the pixels inside the corner circle count as block.
    const cornerX = dx < radius ? radius - dx : dx > block - radius ? dx - (block - radius) : 0;
    const cornerY = dy < radius ? radius - dy : dy > block - radius ? dy - (block - radius) : 0;
    if (cornerX > 0 && cornerY > 0 && cornerX * cornerX + cornerY * cornerY > radius * radius) {
      return [...BACKGROUND, 255];
    }
    return [...colourFor(row, column), 255];
  };
}

// -------------------------------------------------------------------------- run

mkdirSync(OUT_DIR, { recursive: true });
for (const size of [192, 512]) {
  const file = join(OUT_DIR, `icon-${size}.png`);
  const png = encodePng(size, makePaint(size));
  writeFileSync(file, png);
  console.log(`make-icons: wrote ${file} (${png.length} bytes, ${size}x${size})`);
}
