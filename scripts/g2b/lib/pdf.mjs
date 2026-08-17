// PDF → 본문 텍스트 (외부 패키지 없이)
//
// 한글 PDF 는 글자를 그대로 담지 않습니다. 폰트 안의 글리프 번호로 담고,
// 그 번호가 어느 글자인지는 폰트마다 붙어 있는 ToUnicode 표에 적혀 있습니다.
// 그래서 "폰트별" 표를 따라가야 글자가 안 깨집니다.
// (모든 ToUnicode 표를 하나로 합치면 폰트끼리 번호가 겹쳐 글자가 뒤섞입니다)
//
// ToUnicode 가 아예 없는 PDF(스캔본 등)는 읽을 수 없습니다. 그때는 지어내지 않고
// ok:false 로 정직하게 돌려줍니다.
import { inflateSync } from "node:zlib";

/* ── 아주 작은 PDF 객체 읽기 ───────────────────────────────── */

/** "<< /A 1 /B (x) >>" 같은 사전에서 키 하나를 꺼냅니다(중첩 괄호 고려). */
function dictGet(dict, key) {
  const re = new RegExp(`/${key}\\s*`, "g");
  let m;
  while ((m = re.exec(dict))) {
    let i = m.index + m[0].length;
    if (dict[i] === "<" && dict[i + 1] === "<") {
      let depth = 0;
      const start = i;
      for (; i < dict.length; i += 1) {
        if (dict[i] === "<" && dict[i + 1] === "<") { depth += 1; i += 1; }
        else if (dict[i] === ">" && dict[i + 1] === ">") { depth -= 1; i += 1; if (!depth) return dict.slice(start, i + 1); }
      }
      return dict.slice(start);
    }
    if (dict[i] === "[") {
      let depth = 0;
      const start = i;
      for (; i < dict.length; i += 1) {
        if (dict[i] === "[") depth += 1;
        else if (dict[i] === "]") { depth -= 1; if (!depth) return dict.slice(start, i + 1); }
      }
      return dict.slice(start);
    }
    const rest = dict.slice(i);
    // 값이 이름인 경우: /Filter /FlateDecode → "/FlateDecode"
    // (여러 개면 /Filter [/FlateDecode /DCTDecode] 로 오는데 그건 위 배열 분기가 받습니다)
    if (rest[0] === "/") {
      const name = /^(\/[^\s/<>[\]()]+)/.exec(rest);
      if (name) return name[1];
    }
    const val = /^([^/>\]\s]+(?:\s+\d+\s+R)?)/.exec(rest);
    if (val) return val[1].trim();
  }
  return null;
}

const refNum = (v) => {
  const m = /^(\d+)\s+\d+\s+R$/.exec(String(v ?? "").trim());
  return m ? Number(m[1]) : null;
};

/** 파일 전체에서 "N G obj … endobj" 를 훑어 번호별로 담아 둡니다. */
function scanObjects(buf) {
  const objs = new Map();
  const s = buf.toString("latin1");
  const re = /(\d+)\s+(\d+)\s+obj\b/g;
  let m;
  while ((m = re.exec(s))) {
    const num = Number(m[1]);
    const start = m.index + m[0].length;
    const end = s.indexOf("endobj", start);
    if (end < 0) continue;
    const body = s.slice(start, end);
    const sIdx = body.indexOf("stream");
    let dict = body;
    let stream = null;
    if (sIdx >= 0) {
      dict = body.slice(0, sIdx);
      let p = start + sIdx + 6;
      if (s[p] === "\r") p += 1;
      if (s[p] === "\n") p += 1;
      // /Length 가 간접참조인 경우가 있어, 표식으로 끝을 찾는 편이 안전합니다.
      let e = s.indexOf("endstream", p);
      if (e < 0) e = end;
      let raw = buf.subarray(p, e);
      while (raw.length && (raw[raw.length - 1] === 0x0a || raw[raw.length - 1] === 0x0d)) {
        raw = raw.subarray(0, raw.length - 1);
      }
      stream = raw;
    }
    objs.set(num, { dict, stream });
    re.lastIndex = end;
  }
  return objs;
}

/**
 * 압축 객체 묶음(ObjStm)을 풀어 넣습니다.
 *
 * PDF 1.5 부터는 페이지·폰트 같은 객체를 스트림 안에 몰아넣고 통째로 압축합니다.
 * 실제 나라장터 공고문 PDF 가 이 방식이었고, 그래서 파일을 겉으로만 훑으면
 * 페이지가 "0개"로 보입니다. 여기서 풀어 주지 않으면 글자를 하나도 못 뽑습니다.
 */
function expandObjectStreams(objs) {
  for (const [, o] of [...objs]) {
    if (!/\/Type\s*\/ObjStm/.test(o.dict)) continue;
    const data = decodeStream(o);
    if (!data) continue;
    const n = Number(dictGet(o.dict, "N"));
    const first = Number(dictGet(o.dict, "First"));
    if (!Number.isFinite(n) || !Number.isFinite(first)) continue;
    const text = data.toString("latin1");
    const header = text.slice(0, first).trim().split(/\s+/).map(Number);
    for (let i = 0; i < n; i += 1) {
      const num = header[i * 2];
      const off = header[i * 2 + 1];
      if (!Number.isFinite(num) || !Number.isFinite(off)) continue;
      const end = i + 1 < n && Number.isFinite(header[i * 2 + 3])
        ? first + header[i * 2 + 3]
        : text.length;
      // 묶음 안의 객체는 스트림을 가질 수 없습니다(사전만 들어 있습니다).
      if (!objs.has(num)) objs.set(num, { dict: text.slice(first + off, end), stream: null });
    }
  }
  return objs;
}

/** 스트림을 풉니다. Flate 만 다룹니다(공고문 PDF 는 대부분 이것입니다). */
function decodeStream(obj) {
  if (!obj?.stream) return null;
  const filter = dictGet(obj.dict, "Filter") ?? "";
  if (filter.includes("FlateDecode")) {
    try {
      return inflateSync(obj.stream);
    } catch {
      try {
        return inflateSync(obj.stream.subarray(1)); // 앞에 잡바이트가 붙는 경우
      } catch {
        return null;
      }
    }
  }
  if (!filter.trim()) return obj.stream;
  return null; // DCT(이미지) 등은 글자가 아닙니다
}

/* ── ToUnicode CMap ────────────────────────────────────────── */

const hexToStr = (h) => {
  const clean = h.replace(/[^0-9a-fA-F]/g, "");
  let out = "";
  for (let i = 0; i + 3 < clean.length + 1; i += 4) {
    const code = parseInt(clean.slice(i, i + 4), 16);
    if (Number.isFinite(code)) out += String.fromCharCode(code);
  }
  return out;
};

/** ToUnicode 스트림 → { 코드: 글자 } */
function parseCMap(text) {
  const map = new Map();
  for (const blk of text.match(/beginbfchar([\s\S]*?)endbfchar/g) ?? []) {
    const re = /<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>/g;
    let m;
    while ((m = re.exec(blk))) map.set(parseInt(m[1], 16), hexToStr(m[2]));
  }
  for (const blk of text.match(/beginbfrange([\s\S]*?)endbfrange/g) ?? []) {
    const re = /<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>\s*(?:<([0-9a-fA-F]+)>|\[([\s\S]*?)\])/g;
    let m;
    while ((m = re.exec(blk))) {
      const lo = parseInt(m[1], 16);
      const hi = parseInt(m[2], 16);
      if (m[3] !== undefined) {
        const base = hexToStr(m[3]);
        const tail = base.charCodeAt(base.length - 1);
        for (let c = lo; c <= hi && c - lo < 65536; c += 1) {
          map.set(c, base.slice(0, -1) + String.fromCharCode(tail + (c - lo)));
        }
      } else {
        const items = m[4].match(/<([0-9a-fA-F]+)>/g) ?? [];
        items.forEach((it, i) => map.set(lo + i, hexToStr(it)));
      }
    }
  }
  return map;
}

/* ── 내용 스트림에서 글자 뽑기 ─────────────────────────────── */

/** PDF 문자열 리터럴 (…) 을 바이트로 (이스케이프 처리) */
function literalBytes(src, start) {
  const out = [];
  let depth = 1;
  let i = start;
  for (; i < src.length; i += 1) {
    const ch = src[i];
    if (ch === "\\") {
      const n = src[i + 1];
      const oct = /^[0-7]{1,3}/.exec(src.slice(i + 1, i + 4));
      if (oct) { out.push(parseInt(oct[0], 8) & 0xff); i += oct[0].length; continue; }
      const esc = { n: 10, r: 13, t: 9, b: 8, f: 12, "(": 40, ")": 41, "\\": 92 }[n];
      if (esc !== undefined) { out.push(esc); i += 1; continue; }
      i += 1;
      continue;
    }
    if (ch === "(") depth += 1;
    if (ch === ")") { depth -= 1; if (!depth) break; }
    out.push(src.charCodeAt(i) & 0xff);
  }
  return { bytes: out, end: i };
}

/** 바이트열 → 글자 (폰트의 ToUnicode 와 1/2바이트 여부에 따라) */
function decodeBytes(bytes, font) {
  const map = font?.map;
  const two = font?.twoByte;
  let out = "";
  if (two) {
    for (let i = 0; i + 1 < bytes.length; i += 2) {
      const code = (bytes[i] << 8) | bytes[i + 1];
      const u = map?.get(code);
      out += u ?? "";
    }
    return out;
  }
  for (const b of bytes) {
    const u = map?.get(b);
    if (u !== undefined) out += u;
    else if (b >= 32 && b < 127) out += String.fromCharCode(b);
  }
  return out;
}

/**
 * 한 페이지 내용 스트림에서 글자를 순서대로 뽑습니다.
 *
 * PDF 에는 "줄"이라는 개념이 없습니다. 글자를 좌표에 하나씩 찍을 뿐입니다.
 * 한글에서 내보낸 PDF 는 글자 몇 개마다 문자행렬(Tm)로 위치를 다시 잡기 때문에,
 * "Tm 이 나오면 새 줄"로 처리하면 단어마다 줄이 바뀌어 버립니다.
 * 그래서 y 좌표를 실제로 추적해서, 세로로 내려갔을 때만 줄을 바꿉니다.
 */
function textFromContent(content, fonts) {
  const s = content.toString("latin1");
  const parts = [];
  let font = null;
  let nums = [];
  let x = 0, y = 0;          // 현재 글자를 찍을 위치
  let lastX = null, lastY = null; // 마지막으로 글자를 찍은 위치
  let size = 10;

  const pushNum = (v) => { nums.push(v); if (nums.length > 8) nums.shift(); };

  function put(str) {
    if (!str) return;
    if (lastY !== null) {
      const dy = Math.abs(y - lastY);
      if (dy > Math.max(2, size * 0.4)) parts.push("\n");
      else {
        // 같은 줄인데 가로로 벌어졌으면 띄어쓰기로 봅니다.
        const gap = x - lastX;
        if (gap > size * 0.4) parts.push(" ");
      }
    }
    parts.push(str);
    lastX = x;
    lastY = y;
  }

  for (let i = 0; i < s.length; i += 1) {
    const ch = s[i];

    if (ch === "-" || ch === "." || (ch >= "0" && ch <= "9")) {
      const m = /^-?\d*\.?\d+/.exec(s.slice(i, i + 24));
      if (m) { pushNum(Number(m[0])); i += m[0].length - 1; continue; }
    }

    if (ch === "/") {
      const m = /^\/([^\s/<>[\]()]+)\s+([\d.-]+)\s+Tf/.exec(s.slice(i, i + 80));
      if (m) {
        font = fonts.get(m[1]) ?? null;
        const sz = Number(m[2]);
        if (Number.isFinite(sz) && sz > 0) size = sz;
        i += m[0].length - 1;
        nums = [];
        continue;
      }
      continue;
    }

    if (ch === "(") {
      const { bytes, end } = literalBytes(s, i + 1);
      put(decodeBytes(bytes, font));
      i = end;
      nums = [];
      continue;
    }

    if (ch === "<" && s[i + 1] !== "<") {
      const e = s.indexOf(">", i);
      if (e > 0) {
        const hex = s.slice(i + 1, e).replace(/\s/g, "");
        const bytes = [];
        for (let k = 0; k + 1 < hex.length; k += 2) bytes.push(parseInt(hex.substr(k, 2), 16) || 0);
        put(decodeBytes(bytes, font));
        i = e;
        nums = [];
        continue;
      }
    }

    if (ch === "B" && s.startsWith("BT", i)) {
      x = 0; y = 0; nums = []; i += 1; continue;
    }
    if (ch === "E" && s.startsWith("ET", i)) {
      nums = []; i += 1; continue;
    }

    if (ch === "T") {
      const op = s.slice(i, i + 2);
      if (op === "Tm" && nums.length >= 6) {
        x = nums[nums.length - 2];
        y = nums[nums.length - 1];
        // 행렬의 세로 배율이 글자 크기 구실을 합니다(Tf 가 1로 오는 문서 대비)
        const d = nums[nums.length - 3];
        if (Number.isFinite(d) && Math.abs(d) > 1) size = Math.abs(d);
        i += 1; nums = []; continue;
      }
      if ((op === "Td" || op === "TD") && nums.length >= 2) {
        x += nums[nums.length - 2];
        y += nums[nums.length - 1];
        i += 1; nums = []; continue;
      }
      if (op === "T*") { y -= size * 1.2; i += 1; nums = []; continue; }
      nums = [];
      continue;
    }
    if (ch === "'" || ch === '"') { y -= size * 1.2; nums = []; continue; }
  }

  return parts.join("");
}

/* ── 바깥에서 쓰는 함수 ────────────────────────────────────── */

/**
 * PDF 버퍼 → { ok, text, note }
 * 글자를 하나도 못 뽑으면 ok:false 입니다(스캔본이거나 ToUnicode 가 없는 PDF).
 */
export function extractPdfText(buf) {
  let objs;
  try {
    objs = expandObjectStreams(scanObjects(buf));
  } catch (err) {
    return { ok: false, text: "", note: err.message };
  }
  if (!objs.size) return { ok: false, text: "", note: "PDF 객체를 찾지 못했습니다" };

  // 폰트 객체 → ToUnicode 표
  const fontCache = new Map();
  const fontOf = (num) => {
    if (fontCache.has(num)) return fontCache.get(num);
    const o = objs.get(num);
    let font = null;
    if (o) {
      const subtype = dictGet(o.dict, "Subtype") ?? "";
      const tuRef = refNum(dictGet(o.dict, "ToUnicode"));
      let map = null;
      if (tuRef !== null) {
        const data = decodeStream(objs.get(tuRef));
        if (data) map = parseCMap(data.toString("latin1"));
      }
      font = { map, twoByte: subtype.includes("Type0") };
    }
    fontCache.set(num, font);
    return font;
  };

  // 페이지별로 자원(폰트) 을 묶어 내용 스트림을 읽습니다.
  const chunks = [];
  let sawFontMap = false;
  for (const [, o] of objs) {
    if (!/\/Type\s*\/Page\b/.test(o.dict)) continue;

    const fonts = new Map();
    let res = dictGet(o.dict, "Resources");
    const resRef = refNum(res);
    if (resRef !== null) res = objs.get(resRef)?.dict ?? "";
    const fontDict = dictGet(res ?? "", "Font") ?? "";
    const fre = /\/([^\s/<>[\]()]+)\s+(\d+)\s+\d+\s+R/g;
    let fm;
    while ((fm = fre.exec(fontDict))) {
      const f = fontOf(Number(fm[2]));
      if (f?.map?.size) sawFontMap = true;
      fonts.set(fm[1], f);
    }

    const contents = dictGet(o.dict, "Contents") ?? "";
    const nums = [...contents.matchAll(/(\d+)\s+\d+\s+R/g)].map((x) => Number(x[1]));
    for (const n of nums) {
      const data = decodeStream(objs.get(n));
      if (data) chunks.push(textFromContent(data, fonts));
    }
  }

  const text = chunks
    .join("\n")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  if (!text) {
    return {
      ok: false,
      text: "",
      note: sawFontMap
        ? "글자를 뽑지 못했습니다"
        : "글자 정보가 없는 PDF 입니다(스캔본이거나 ToUnicode 표가 없습니다)",
    };
  }
  return { ok: true, text, note: "" };
}
