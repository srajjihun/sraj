// HWPX(한글 표준 문서) → 본문 텍스트 + 표
//
// HWPX 는 속이 ZIP 이고 본문이 XML 이라 한컴 없이 읽을 수 있습니다.
//   Contents/section0.xml, section1.xml, …   ← 본문
//
// 왜 표를 따로 뽑는가:
//   우리가 정말 필요한 것은 배점표입니다. 본문을 한 줄로 이어 붙이면
//   "기술능력 80 가격 20" 이 "기술능력80가격20" 처럼 뭉개져 어느 숫자가
//   어느 항목인지 알 수 없게 됩니다. 표는 행·열 구조를 그대로 살립니다.
import { readZip } from "./zip.mjs";

const ENT = { lt: "<", gt: ">", amp: "&", quot: '"', apos: "'" };

function unescapeXml(s) {
  return s.replace(/&(#x?[0-9a-fA-F]+|[a-z]+);/g, (m, e) => {
    if (e[0] === "#") {
      const code = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : m;
    }
    return ENT[e] ?? m;
  });
}

/** 태그 하나하나를 훑습니다. 완전한 XML 파서는 필요 없습니다 — 여는/닫는 태그와 글자만 봅니다. */
function* tokens(xml) {
  const re = /<(\/?)([A-Za-z_][\w.:-]*)((?:[^>"']|"[^"]*"|'[^']*')*?)(\/?)>/g;
  let last = 0;
  let m;
  while ((m = re.exec(xml))) {
    if (m.index > last) {
      const text = xml.slice(last, m.index);
      if (text) yield { type: "text", value: unescapeXml(text) };
    }
    last = re.lastIndex;
    const [, closing, name, attrStr, selfClose] = m;
    if (closing) yield { type: "close", name };
    else {
      yield { type: "open", name, attrStr };
      if (selfClose) yield { type: "close", name };
    }
  }
  if (last < xml.length) {
    const text = xml.slice(last);
    if (text) yield { type: "text", value: unescapeXml(text) };
  }
}

function attr(attrStr, key) {
  const m = new RegExp(`\\b${key}\\s*=\\s*"([^"]*)"`).exec(attrStr || "");
  return m ? m[1] : null;
}

/** 네임스페이스 접두어를 뗍니다. hp:tbl → tbl */
const local = (name) => name.replace(/^[^:]*:/, "");

/**
 * 병합된 칸을 펴서 직사각형 격자로 만듭니다.
 *
 * 배점표는 "평가부문"이 세로로 두 줄 합쳐진 식이 흔합니다. 그대로 두면
 * 어느 행에 칸이 몇 개인지 들쭉날쭉해서 "이 항목의 배점"을 못 읽습니다.
 * 합쳐진 칸의 글자를 덮이는 모든 자리에 복사해 두면 행마다 열 수가 같아집니다.
 */
function toGrid(cells) {
  const grid = [];
  const put = (r, c, v) => {
    while (grid.length <= r) grid.push([]);
    grid[r][c] = v;
  };
  for (const row of cells) {
    for (const cell of row) {
      // cellAddr 이 없는 문서도 있어, 그럴 때는 순서대로 채웁니다.
      const r0 = Number.isFinite(cell.row) ? cell.row : grid.length ? grid.length - 1 : 0;
      let c0 = cell.col;
      if (!Number.isFinite(c0)) {
        c0 = 0;
        while (grid[r0]?.[c0] !== undefined) c0 += 1;
      }
      for (let dr = 0; dr < (cell.rowSpan || 1); dr += 1) {
        for (let dc = 0; dc < (cell.colSpan || 1); dc += 1) {
          put(r0 + dr, c0 + dc, cell.text);
        }
      }
    }
  }
  const width = Math.max(0, ...grid.map((r) => r.length));
  return grid.map((r) => Array.from({ length: width }, (_, i) => r[i] ?? ""));
}

/**
 * section XML 한 편을 해석합니다.
 * @returns {{blocks: Array<{type:"p",text:string}|{type:"table",rows:string[][],spans:object[][]}>}}
 */
export function parseSection(xml) {
  const blocks = [];
  const tableStack = [];
  let para = []; // 현재 문단에 쌓이는 글자
  let inText = false;

  const cur = () => tableStack[tableStack.length - 1];

  function flushPara() {
    const t = para.join("").replace(/[ \t]+/g, " ").trim();
    para = [];
    if (!t) return;
    const tbl = cur();
    if (tbl && tbl.cell) tbl.cell.lines.push(t);
    else blocks.push({ type: "p", text: t });
  }

  for (const tk of tokens(xml)) {
    const name = tk.type === "text" ? null : local(tk.name);

    if (tk.type === "text") {
      if (inText) para.push(tk.value);
      continue;
    }

    if (tk.type === "open") {
      switch (name) {
        case "t":
          inText = true;
          break;
        case "tbl":
          flushPara();
          tableStack.push({ rows: [], row: null, cell: null });
          break;
        case "tr":
          if (cur()) cur().row = [];
          break;
        case "tc":
          if (cur()) cur().cell = { lines: [], col: null, row: null, colSpan: 1, rowSpan: 1 };
          break;
        case "cellAddr": {
          const c = cur()?.cell;
          if (c) {
            c.col = Number(attr(tk.attrStr, "colAddr"));
            c.row = Number(attr(tk.attrStr, "rowAddr"));
          }
          break;
        }
        case "cellSpan": {
          const c = cur()?.cell;
          if (c) {
            c.colSpan = Number(attr(tk.attrStr, "colSpan")) || 1;
            c.rowSpan = Number(attr(tk.attrStr, "rowSpan")) || 1;
          }
          break;
        }
        case "lineBreak":
        case "linesegarray":
          break;
        default:
          break;
      }
      continue;
    }

    // close
    switch (name) {
      case "t":
        inText = false;
        break;
      case "p":
        flushPara();
        break;
      case "tc": {
        const tbl = cur();
        if (tbl?.cell) {
          flushPara();
          tbl.row?.push(tbl.cell);
          tbl.cell = null;
        }
        break;
      }
      case "tr": {
        const tbl = cur();
        if (tbl?.row) {
          tbl.rows.push(tbl.row);
          tbl.row = null;
        }
        break;
      }
      case "tbl": {
        const tbl = tableStack.pop();
        if (tbl && tbl.rows.length) {
          const cells = tbl.rows.map((r) =>
            r.map((c) => ({
              text: c.lines.join(" ").trim(),
              col: c.col, row: c.row, colSpan: c.colSpan, rowSpan: c.rowSpan,
            }))
          );
          const table = {
            type: "table",
            rows: cells.map((r) => r.map((c) => c.text)),
            spans: cells.map((r) => r.map((c) => ({ colSpan: c.colSpan, rowSpan: c.rowSpan }))),
            grid: toGrid(cells),
          };
          const parent = cur();
          // 표 안의 표는 바깥 칸의 글자로 흘려 넣습니다(구조까지 살리지는 않습니다).
          if (parent?.cell) parent.cell.lines.push(table.rows.map((r) => r.join(" ")).join(" / "));
          else blocks.push(table);
        }
        break;
      }
      default:
        break;
    }
  }
  flushPara();
  return { blocks };
}

/**
 * HWPX 파일(Buffer) → { text, tables, blocks }
 * text 는 사람이 읽는 순서대로, tables 는 배점표를 찾기 위한 원본 구조입니다.
 */
export function parseHwpx(buf) {
  const entries = readZip(buf);
  const sections = entries
    .filter((e) => /^Contents\/section\d+\.xml$/i.test(e.name))
    .sort((a, b) => {
      const n = (s) => Number(/section(\d+)/i.exec(s.name)?.[1] ?? 0);
      return n(a) - n(b);
    });
  if (!sections.length) throw new Error("HWPX 본문(Contents/section0.xml)을 찾지 못했습니다");

  const blocks = [];
  for (const s of sections) blocks.push(...parseSection(s.read().toString("utf8")).blocks);

  const text = blocks
    .map((b) => (b.type === "p" ? b.text : b.rows.map((r) => r.join("\t")).join("\n")))
    .join("\n");

  return { text, tables: blocks.filter((b) => b.type === "table"), blocks };
}
