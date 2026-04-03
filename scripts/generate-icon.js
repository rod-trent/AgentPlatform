"use strict";

/**
 * scripts/generate-icon.js
 *
 * Generates assets/icon.ico (16, 32, 48, 256 px) from the same robot-face
 * design used by the running app.  Runs automatically as the "prebuild"
 * npm script — no external dependencies, only Node built-ins.
 */

const fs   = require("fs");
const path = require("path");
const zlib = require("zlib");

// ── PNG generator (mirrors src/main/index.js buildRobotIconPng) ───────────────

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xFFFFFFFF;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}

function pngChunk(type, data) {
  const len = Buffer.allocUnsafe(4); len.writeUInt32BE(data.length, 0);
  const tp  = Buffer.from(type, "ascii");
  const crc = Buffer.allocUnsafe(4);
  crc.writeUInt32BE(crc32(Buffer.concat([tp, data])), 0);
  return Buffer.concat([len, tp, data, crc]);
}

function buildRobotIconPng(size) {
  const raw = Buffer.alloc(size * (1 + size * 4)); // RGBA scanlines
  const cr  = Math.max(2, Math.round(size * 0.15));

  for (let y = 0; y < size; y++) {
    const row = y * (1 + size * 4);
    raw[row] = 0; // filter: None
    for (let x = 0; x < size; x++) {
      const i = row + 1 + x * 4;

      // Rounded corners
      const edgeX = Math.max(0, cr - x, x - (size - 1 - cr));
      const edgeY = Math.max(0, cr - y, y - (size - 1 - cr));
      if (edgeX > 0 && edgeY > 0 && edgeX * edgeX + edgeY * edgeY > cr * cr) {
        raw[i + 3] = 0; continue;
      }

      // Diagonal gradient #60cdff → #8e64ff
      const t    = (x + y) / (2 * (size - 1));
      raw[i]     = Math.round(0x60 + t * (0x8e - 0x60));
      raw[i + 1] = Math.round(0xcd + t * (0x64 - 0xcd));
      raw[i + 2] = 0xff;
      raw[i + 3] = 0xff;

      const fx = x / size, fy = y / size;

      // Eyes
      if (Math.hypot(fx - 0.33, fy - 0.44) < 0.085 ||
          Math.hypot(fx - 0.67, fy - 0.44) < 0.085) {
        raw[i] = raw[i + 1] = raw[i + 2] = 0xff; continue;
      }
      // Mouth
      if (fx >= 0.27 && fx <= 0.73 && fy >= 0.63 && fy <= 0.70) {
        raw[i] = raw[i + 1] = raw[i + 2] = 0xff; continue;
      }
      // Antenna (≥ 24 px only)
      if (size >= 24) {
        if (Math.hypot(fx - 0.5, fy - 0.10) < 0.055) {
          raw[i] = raw[i + 1] = raw[i + 2] = 0xff; continue;
        }
        if (Math.abs(fx - 0.5) < 0.028 && fy > 0.13 && fy < 0.24) {
          raw[i] = raw[i + 1] = raw[i + 2] = 0xff; continue;
        }
      }
    }
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6; // RGBA

  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", zlib.deflateSync(raw)),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

// ── ICO packer ────────────────────────────────────────────────────────────────
// Modern Windows ICO files can embed PNG data directly (Vista+).

function buildIco(sizes) {
  const pngs   = sizes.map(s => buildRobotIconPng(s));
  const count  = sizes.length;

  // ICONDIR header (6 bytes)
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type: 1 = ICO
  header.writeUInt16LE(count, 4);

  // ICONDIRENTRY array (16 bytes each)
  const dirEntries = [];
  let offset = 6 + count * 16; // data starts after header + directory

  for (let idx = 0; idx < count; idx++) {
    const entry = Buffer.alloc(16);
    const sz    = sizes[idx];
    entry[0] = sz === 256 ? 0 : sz; // 0 signals 256 in the ICO spec
    entry[1] = sz === 256 ? 0 : sz;
    entry[2] = 0;  // color count (0 = truecolor)
    entry[3] = 0;  // reserved
    entry.writeUInt16LE(1,  4); // color planes
    entry.writeUInt16LE(32, 6); // bits per pixel
    entry.writeUInt32LE(pngs[idx].length, 8);
    entry.writeUInt32LE(offset, 12);
    dirEntries.push(entry);
    offset += pngs[idx].length;
  }

  return Buffer.concat([header, ...dirEntries, ...pngs]);
}

// ── Write output ──────────────────────────────────────────────────────────────

const assetsDir = path.join(__dirname, "..", "assets");
fs.mkdirSync(assetsDir, { recursive: true });

const icoPath = path.join(assetsDir, "icon.ico");
fs.writeFileSync(icoPath, buildIco([16, 32, 48, 256]));
console.log(`Generated ${icoPath}  (16 / 32 / 48 / 256 px)`);
