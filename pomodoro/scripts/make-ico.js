'use strict';

/**
 * Windows용 앱 아이콘(assets/icon.ico)을 만든다.
 * 16/32/48/256px 각각을 PNG로 그려서 하나의 ICO로 묶는다(Vista+ PNG-in-ICO 방식).
 *   node scripts/make-ico.js
 */

const zlib = require('zlib');
const fs = require('fs');
const path = require('path');

const SIZES = [16, 24, 32, 48, 256];
const SS = 4; // 안티앨리어싱용 슈퍼샘플링

/* ── PNG 인코더 (make-icon.js와 동일) ───────────────────── */

const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}

function encodePng(width, height, rgba) {
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0;
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/* ── 달 그리기 (해상도만 바뀜) ───────────────────────────── */

function drawMoon(size) {
  const big = size * SS;
  const c = big / 2;
  const rOuter = big * 0.44;
  const acc = new Float64Array(size * size * 4);

  for (let y = 0; y < big; y++) {
    for (let x = 0; x < big; x++) {
      const dx = x + 0.5 - c;
      const dy = y + 0.5 - c;
      const d = Math.hypot(dx, dy);

      let r = 0, g = 0, b = 0, a = 0;

      if (d <= rOuter) {
        const t = Math.min(1, d / rOuter);
        const lit = Math.max(0, 1 - Math.hypot(dx + rOuter * 0.22, dy + rOuter * 0.26) / (rOuter * 1.5));
        const k = 0.55 + 0.45 * lit - 0.18 * t * t;
        r = 247 * k + 8;
        g = 200 * k + 6;
        b = 108 * k;
        a = 255;
      } else if (d <= rOuter * 1.22) {
        const halo = 1 - (d - rOuter) / (rOuter * 0.22);
        r = 227; g = 180; b = 95;
        a = 255 * halo * halo * 0.28;
      }

      const px = ((y / SS) | 0) * size + ((x / SS) | 0);
      acc[px * 4] += r * a;
      acc[px * 4 + 1] += g * a;
      acc[px * 4 + 2] += b * a;
      acc[px * 4 + 3] += a;
    }
  }

  const samples = SS * SS;
  const out = Buffer.alloc(size * size * 4);
  for (let i = 0; i < size * size; i++) {
    const aSum = acc[i * 4 + 3];
    const alpha = aSum / samples;
    if (alpha > 0.5) {
      out[i * 4] = Math.min(255, Math.round(acc[i * 4] / aSum));
      out[i * 4 + 1] = Math.min(255, Math.round(acc[i * 4 + 1] / aSum));
      out[i * 4 + 2] = Math.min(255, Math.round(acc[i * 4 + 2] / aSum));
    }
    out[i * 4 + 3] = Math.min(255, Math.round(alpha));
  }
  return out;
}

/* ── ICO 컨테이너 (PNG를 그대로 담는 Vista+ 방식) ───────── */

function buildIco(images) {
  // images: [{ size, png: Buffer }]
  const HEADER = 6;
  const ENTRY = 16;
  const header = Buffer.alloc(HEADER);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2); // 아이콘
  header.writeUInt16LE(images.length, 4);

  let offset = HEADER + ENTRY * images.length;
  const entries = [];
  const blobs = [];

  for (const { size, png } of images) {
    const entry = Buffer.alloc(ENTRY);
    entry.writeUInt8(size >= 256 ? 0 : size, 0);
    entry.writeUInt8(size >= 256 ? 0 : size, 1);
    entry.writeUInt8(0, 2);
    entry.writeUInt8(0, 3);
    entry.writeUInt16LE(1, 4);  // 색 플레인
    entry.writeUInt16LE(32, 6); // 비트 깊이
    entry.writeUInt32LE(png.length, 8);
    entry.writeUInt32LE(offset, 12);
    entries.push(entry);
    blobs.push(png);
    offset += png.length;
  }

  return Buffer.concat([header, ...entries, ...blobs]);
}

const images = SIZES.map((size) => ({
  size,
  png: encodePng(size, size, drawMoon(size)),
}));

const dest = path.join(__dirname, '..', 'assets', 'icon.ico');
fs.mkdirSync(path.dirname(dest), { recursive: true });
fs.writeFileSync(dest, buildIco(images));
console.log(`wrote ${dest} (${SIZES.join(', ')}px)`);
