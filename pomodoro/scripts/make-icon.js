'use strict';

/**
 * 트레이용 금빛 보름달 아이콘(assets/tray.png)을 만든다.
 * 외부 이미지 의존성을 두지 않으려고 PNG를 직접 써넣는다.
 *   node scripts/make-icon.js
 */

const zlib = require('zlib');
const fs = require('fs');
const path = require('path');

const SIZE = 64;
const SS = 4; // 계단 현상을 줄이려고 4배로 그린 뒤 평균낸다

/* ── PNG 인코더 ──────────────────────────────────────────── */

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
    raw[y * (stride + 1)] = 0; // 필터 없음
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;  // 채널당 8비트
  ihdr[9] = 6;  // RGBA
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/* ── 달 그리기 ───────────────────────────────────────────── */

const big = SIZE * SS;
const c = big / 2;
const rOuter = big * 0.44; // 달 반지름
const acc = new Float64Array(SIZE * SIZE * 4);

for (let y = 0; y < big; y++) {
  for (let x = 0; x < big; x++) {
    const dx = x + 0.5 - c;
    const dy = y + 0.5 - c;
    const d = Math.hypot(dx, dy);

    let r = 0, g = 0, b = 0, a = 0;

    if (d <= rOuter) {
      // 왼쪽 위가 밝은 금색, 가장자리로 갈수록 가라앉는다
      const t = Math.min(1, d / rOuter);
      const lit = Math.max(0, 1 - Math.hypot(dx + rOuter * 0.22, dy + rOuter * 0.26) / (rOuter * 1.5));
      const k = 0.55 + 0.45 * lit - 0.18 * t * t;
      r = 247 * k + 8;
      g = 200 * k + 6;
      b = 108 * k;
      a = 255;
    } else if (d <= rOuter * 1.22) {
      // 은은한 달무리
      const halo = 1 - (d - rOuter) / (rOuter * 0.22);
      r = 227; g = 180; b = 95;
      a = 255 * halo * halo * 0.28;
    }

    const px = ((y / SS) | 0) * SIZE + ((x / SS) | 0);
    acc[px * 4]     += r * a;
    acc[px * 4 + 1] += g * a;
    acc[px * 4 + 2] += b * a;
    acc[px * 4 + 3] += a;
  }
}

const samples = SS * SS;
const out = Buffer.alloc(SIZE * SIZE * 4);
for (let i = 0; i < SIZE * SIZE; i++) {
  const aSum = acc[i * 4 + 3];
  const alpha = aSum / samples;
  if (alpha > 0.5) {
    out[i * 4]     = Math.min(255, Math.round(acc[i * 4] / aSum));
    out[i * 4 + 1] = Math.min(255, Math.round(acc[i * 4 + 1] / aSum));
    out[i * 4 + 2] = Math.min(255, Math.round(acc[i * 4 + 2] / aSum));
  }
  out[i * 4 + 3] = Math.min(255, Math.round(alpha));
}

const dest = path.join(__dirname, '..', 'assets', 'tray.png');
fs.mkdirSync(path.dirname(dest), { recursive: true });
fs.writeFileSync(dest, encodePng(SIZE, SIZE, out));
console.log(`wrote ${dest} (${SIZE}x${SIZE})`);
