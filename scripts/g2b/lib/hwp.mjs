// 구형 HWP(.hwp) 를 한글 없이 직접 읽습니다.
//
// 지금까지는 한글(한컴오피스)에게 HWPX 로 바꿔 달라고 시켰습니다. 그러려면
// 한글의 보안 팝업을 없애는 DLL 이 필요한데, 그 파일이 설치본에 없는 PC 가
// 많습니다(실제로 이 PC 에서 못 찾았습니다). 그래서 껍데기부터 우리가 엽니다.
//
// 왜 이게 중요한가:
//   신인도 가점표(여성기업·벤처기업 등 몇 점)는 대부분 제안요청서 안에 있고,
//   제안요청서는 거의 HWP 입니다. 이게 읽혀야 "인증서류 뭐가 더 필요한가"에
//   추측이 아니라 실제 빈도로 답할 수 있습니다.
//
// 구조:
//   .hwp = 복합 문서(cfb.mjs 가 엽니다)
//     FileHeader          서명과 압축 여부
//     BodyText/Section0…  본문. 보통 압축돼 있습니다(머리말 없는 deflate).
//   본문은 "기록(record)"이 줄줄이 이어진 형태입니다. 기록 하나는
//   4바이트 머리말(종류·깊이·길이) + 내용입니다.
//
// 원칙: 확실하지 않으면 내놓지 않습니다. 표는 칸 주소가 앞뒤가 맞을 때만
//       씁니다. 틀린 배점표는 없느니만 못합니다.
import { inflateRawSync, inflateSync } from "node:zlib";
import { openCfb } from "./cfb.mjs";

const TAG = {
  PARA_HEADER: 66,
  PARA_TEXT: 67,
  CTRL_HEADER: 71,
  LIST_HEADER: 72,
  TABLE: 76,
};

// 글자 코드 0~31 은 글자가 아니라 표시용 제어 부호입니다. 종류마다 차지하는
// 칸 수가 달라서, 이걸 틀리면 그 뒤 글자가 전부 밀려 깨집니다.
const CTRL_WIDE = new Set([
  1, 2, 3, 11, 12, 14, 15, 16, 17, 18, 21, 22, 23, // 확장: 8칸
  4, 5, 6, 7, 8, 9, 19, 20,                        // 인라인: 8칸
]);

/** 압축된 스트림을 풉니다. 머리말 없는 deflate 가 표준이지만 아닌 파일도 있습니다. */
function unpack(buf, compressed) {
  if (!compressed) return buf;
  try {
    return inflateRawSync(buf);
  } catch {
    try {
      return inflateSync(buf);
    } catch {
      return null;
    }
  }
}

/** 기록들을 차례로 훑습니다. */
function* records(buf) {
  let p = 0;
  while (p + 4 <= buf.length) {
    const head = buf.readUInt32LE(p);
    const tag = head & 0x3ff;
    const level = (head >> 10) & 0x3ff;
    let size = (head >> 20) & 0xfff;
    p += 4;
    // 길이가 4095 를 넘으면 뒤에 4바이트로 따로 적혀 있습니다.
    if (size === 0xfff) {
      if (p + 4 > buf.length) return;
      size = buf.readUInt32LE(p);
      p += 4;
    }
    if (size < 0 || p + size > buf.length) return; // 잘린 파일
    yield { tag, level, data: buf.subarray(p, p + size) };
    p += size;
  }
}

/** 문단 하나의 글자들. 제어 부호는 건너뛰고 줄바꿈·탭만 살립니다. */
function paraText(data) {
  let out = "";
  const n = Math.floor(data.length / 2);
  for (let i = 0; i < n; i += 1) {
    const c = data.readUInt16LE(i * 2);
    if (c >= 32) {
      out += String.fromCharCode(c);
      continue;
    }
    if (c === 9) { out += "\t"; i += 7; continue; }   // 탭 — 8칸을 차지합니다
    if (c === 10 || c === 13) { out += "\n"; continue; }
    if (c === 30 || c === 31) { out += " "; continue; } // 묶음/고정폭 빈칸
    if (CTRL_WIDE.has(c)) { i += 7; continue; }         // 그림·표 같은 개체 자리
    // 0 과 나머지(24~29)는 버립니다
  }
  return out;
}

/** 컨트롤 종류 4바이트를 글자로. 파일마다 바이트 순서가 반대인 경우가 있어 둘 다 봅니다. */
function ctrlName(data) {
  if (data.length < 4) return "";
  const a = data.toString("latin1", 0, 4);
  const b = [...a].reverse().join("");
  return a === "tbl " || b === "tbl " ? "tbl " : a;
}

/** 칸 주소로 표를 다시 짭니다. hwpx.mjs 의 toGrid 와 같은 결과를 냅니다. */
function toGrid(table) {
  const { rows, cols, cells } = table;
  const grid = Array.from({ length: rows }, () => Array(cols).fill(""));
  for (const c of cells) {
    for (let r = c.row; r < Math.min(rows, c.row + c.rowSpan); r += 1) {
      for (let k = c.col; k < Math.min(cols, c.col + c.colSpan); k += 1) {
        // 병합된 칸은 같은 글자를 채워 둡니다. 배점 열을 찾을 때 빈칸이면
        // 열이 통째로 어긋납니다.
        if (!grid[r][k]) grid[r][k] = c.text;
      }
    }
  }
  return grid;
}

/**
 * 표가 앞뒤가 맞는지 봅니다. 형식을 잘못 읽으면 칸 주소가 터무니없이 나오는데,
 * 그걸 그대로 배점표라고 내놓으면 없느니만 못합니다.
 */
function sane(t) {
  if (!(t.rows >= 1 && t.rows <= 300)) return false;
  if (!(t.cols >= 1 && t.cols <= 60)) return false;
  if (!t.cells.length) return false;
  for (const c of t.cells) {
    if (!Number.isInteger(c.row) || !Number.isInteger(c.col)) return false;
    if (c.row < 0 || c.col < 0 || c.row >= t.rows || c.col >= t.cols) return false;
    if (c.rowSpan < 1 || c.colSpan < 1) return false;
    if (c.row + c.rowSpan > t.rows || c.col + c.colSpan > t.cols) return false;
  }
  // 칸이 격자 크기보다 많으면 다른 표의 칸을 섞어 읽은 것입니다.
  return t.cells.length <= t.rows * t.cols;
}

/** 본문 한 구역(Section)에서 글자와 표를 뽑습니다. */
function readSection(buf) {
  const lines = [];
  const tables = [];
  const stack = []; // 표 안에 표가 들어가는 경우가 있어 쌓아 둡니다

  for (const r of records(buf)) {
    // 열려 있는 표 중 이 기록보다 깊지 않은 것은 끝난 것입니다.
    while (stack.length && r.level <= stack[stack.length - 1].base) {
      const done = stack.pop();
      if (sane(done)) tables.push({ grid: toGrid(done) });
    }
    const top = stack[stack.length - 1];

    if (r.tag === TAG.CTRL_HEADER) {
      if (ctrlName(r.data) === "tbl ") {
        stack.push({ base: r.level, rows: 0, cols: 0, cells: [], cur: null });
      }
      continue;
    }

    if (r.tag === TAG.TABLE && top && r.data.length >= 8) {
      top.rows = r.data.readUInt16LE(4);
      top.cols = r.data.readUInt16LE(6);
      continue;
    }

    if (r.tag === TAG.LIST_HEADER && top) {
      // 문단수(4) 속성(4) 칸주소 열(2) 행(2) 열병합(2) 행병합(2) …
      if (r.data.length >= 16) {
        top.cur = {
          col: r.data.readUInt16LE(8),
          row: r.data.readUInt16LE(10),
          colSpan: Math.max(1, r.data.readUInt16LE(12)),
          rowSpan: Math.max(1, r.data.readUInt16LE(14)),
          text: "",
        };
        top.cells.push(top.cur);
      } else {
        top.cur = null;
      }
      continue;
    }

    if (r.tag === TAG.PARA_TEXT) {
      const t = paraText(r.data);
      if (!t) continue;
      // 표 안의 글자도 본문에 넣습니다 — 지역제한·실적요건 문구가 표 안에
      // 들어 있는 공고가 많습니다.
      lines.push(t);
      if (top?.cur) top.cur.text = `${top.cur.text} ${t}`.trim();
    }
  }

  while (stack.length) {
    const done = stack.pop();
    if (sane(done)) tables.push({ grid: toGrid(done) });
  }

  return { text: lines.join("\n"), tables };
}

/**
 * HWP 파일 하나를 읽습니다.
 * @param {Buffer} buf
 * @returns {{ ok:boolean, text:string, tables:Array, note:string }}
 */
export function parseHwp(buf) {
  let cfb;
  try {
    cfb = openCfb(buf);
  } catch (err) {
    return { ok: false, text: "", tables: [], note: `HWP 껍데기를 열지 못했습니다: ${err.message}` };
  }

  const header = cfb.read("FileHeader");
  if (!header || header.length < 40) {
    return { ok: false, text: "", tables: [], note: "HWP 파일이 아닙니다(FileHeader 없음)" };
  }
  if (!header.toString("latin1", 0, 17).startsWith("HWP Document File")) {
    return { ok: false, text: "", tables: [], note: "HWP 서명이 없습니다" };
  }

  const flags = header.readUInt32LE(36);
  const compressed = (flags & 0x01) !== 0;
  if (flags & 0x02) {
    return { ok: false, text: "", tables: [], note: "암호가 걸린 문서라 읽을 수 없습니다" };
  }
  if (flags & 0x04) {
    // 배포용 문서는 본문이 따로 암호화돼 있어 우리가 풀 수 없습니다.
    return { ok: false, text: "", tables: [], note: "배포용 문서라 본문을 읽을 수 없습니다" };
  }

  const texts = [];
  const tables = [];
  let sections = 0;
  for (let i = 0; i < 256; i += 1) {
    const name = `BodyText/Section${i}`;
    if (!cfb.has(name)) break;
    const raw = cfb.read(name);
    if (!raw) break;
    const body = unpack(raw, compressed);
    if (!body) continue; // 이 구역만 못 풀면 나머지는 계속합니다
    sections += 1;
    const r = readSection(body);
    if (r.text) texts.push(r.text);
    tables.push(...r.tables);
  }

  if (!sections) {
    return { ok: false, text: "", tables: [], note: "본문(BodyText)을 찾지 못했습니다" };
  }
  const text = texts.join("\n");
  if (!text.trim()) {
    return { ok: false, text: "", tables, note: "본문에서 글자를 뽑지 못했습니다" };
  }
  return { ok: true, text, tables, note: "" };
}

export { records, paraText, toGrid, sane };
