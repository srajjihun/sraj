// DOCX(워드 문서)에서 글자와 표를 뽑습니다.
//
// 왜 필요한가:
//   공고 첨부의 대부분은 HWP·HWPX·PDF 지만 워드로 올리는 기관이 가끔 있습니다.
//   실측으로 지금까지 3건이 "DOCX 는 아직 읽지 않습니다"로 버려졌습니다.
//   속이 ZIP + XML 이라 HWPX 와 구조가 같고, 이미 있는 zip 리더를 그대로
//   쓰면 되므로 굳이 남겨 둘 이유가 없습니다.
//
// 구조: word/document.xml
//   <w:p>   문단      <w:t> 안에 글자
//   <w:tbl> 표 → <w:tr> 행 → <w:tc> 칸
//   <w:br>, <w:tab> 은 줄바꿈·탭
import { readZip } from "./zip.mjs";

const ENT = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

function unescapeXml(s) {
  return s.replace(/&(#x?[0-9a-fA-F]+|[a-z]+);/g, (m, e) => {
    if (e[0] === "#") {
      const code = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : m;
    }
    return ENT[e] ?? m;
  });
}

/** <w:t>…</w:t> 안의 글자만 모읍니다. 그 밖의 태그는 서식이라 버립니다. */
function textOf(xml) {
  let out = "";
  const re = /<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>|<w:tab\b[^>]*\/?>|<w:br\b[^>]*\/?>/g;
  let m;
  while ((m = re.exec(xml))) {
    if (m[1] !== undefined) out += unescapeXml(m[1]);
    else if (m[0].startsWith("<w:tab")) out += "\t";
    else out += "\n";
  }
  return out;
}

/** 짝이 맞는 닫는 태그의 위치. 같은 이름이 중첩(표 안의 표)돼도 맞게 셉니다. */
function matchEnd(xml, name, from) {
  const re = new RegExp(`<${name}\\b[^>]*?(/?)>|</${name}>`, "g");
  re.lastIndex = from;
  let depth = 0;
  let m;
  while ((m = re.exec(xml))) {
    if (m[0].startsWith("</")) {
      depth -= 1;
      if (depth === 0) return { end: m.index, next: re.lastIndex };
    } else if (!m[1]) {
      depth += 1;
    }
  }
  return null;
}

function parseTable(xml) {
  const rows = [];
  const trRe = /<w:tr\b[^>]*>/g;
  let m;
  while ((m = trRe.exec(xml))) {
    const span = matchEnd(xml, "w:tr", m.index);
    if (!span) break;
    const inner = xml.slice(m.index, span.end);
    const cells = [];
    const tcRe = /<w:tc\b[^>]*>/g;
    let c;
    while ((c = tcRe.exec(inner))) {
      const cs = matchEnd(inner, "w:tc", c.index);
      if (!cs) break;
      cells.push(textOf(inner.slice(c.index, cs.end)).replace(/\s+/g, " ").trim());
      tcRe.lastIndex = cs.next;
    }
    if (cells.length) rows.push(cells);
    trRe.lastIndex = span.next;
  }
  return rows;
}

/**
 * @param {Buffer} buf
 * @returns {{ ok:boolean, text:string, tables:Array, note:string }}
 */
export function parseDocx(buf) {
  let entries;
  try {
    entries = readZip(buf);
  } catch (err) {
    return { ok: false, text: "", tables: [], note: `DOCX 를 열지 못했습니다: ${err.message}` };
  }
  const doc = entries.find((e) => /^word\/document\.xml$/i.test(e.name));
  if (!doc) return { ok: false, text: "", tables: [], note: "word/document.xml 을 찾지 못했습니다" };

  const xml = doc.read().toString("utf8");
  const lines = [];
  const tables = [];

  // 문단과 표를 나온 순서대로 훑습니다. 표 안의 문단이 본문에 두 번 들어가지
  // 않도록, 표를 만나면 그 구간을 통째로 건너뜁니다.
  const re = /<w:(tbl|p)\b[^>]*?(\/?)>/g;
  let m;
  while ((m = re.exec(xml))) {
    const name = `w:${m[1]}`;
    if (m[2]) continue; // 빈 태그
    const span = matchEnd(xml, name, m.index);
    if (!span) break;
    const chunk = xml.slice(m.index, span.end);
    if (m[1] === "tbl") {
      const rows = parseTable(chunk);
      if (rows.length) {
        tables.push({ grid: rows });
        for (const r of rows) lines.push(r.join("\t"));
      }
    } else {
      const t = textOf(chunk).replace(/[ \t]+/g, " ").trim();
      if (t) lines.push(t);
    }
    re.lastIndex = span.next;
  }

  const text = lines.join("\n");
  if (!text.trim()) return { ok: false, text: "", tables, note: "본문에서 글자를 뽑지 못했습니다" };
  return { ok: true, text, tables, note: "" };
}
