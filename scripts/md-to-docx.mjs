// 마크다운 문서를 워드(.docx) 파일로 만듭니다. 남의 라이브러리를 쓰지 않습니다.
//
// 왜 직접 만드는가:
//   .docx 는 그냥 ZIP 안에 든 XML 입니다. 우리는 이미 ZIP 읽기(lib/zip.mjs)와
//   DOCX 읽기(lib/docx.mjs)를 만들어 뒀으니, 쓰는 쪽도 같은 규격을 따르면
//   됩니다. 한글·워드가 깔려 있지 않은 PC 에서도 node 만 있으면 돌아갑니다.
//
// 사용법:
//   node scripts\md-to-docx.mjs docs\키워드-기준.md
//   node scripts\md-to-docx.mjs docs\키워드-기준.md 원하는이름.docx
//
// 다루는 문법: # ## ### 제목 · 표 · ``` 코드블록 · - 목록 · 1. 목록 ·
//              **굵게** · `코드` · --- 구분선 · 문단
import { readFile, writeFile } from "node:fs/promises";
import { basename } from "node:path";
import { pathToFileURL } from "node:url";
import { deflateRawSync, crc32 } from "node:zlib";

/* ────────── ZIP 쓰기 ────────── */

function zip(files) {
  const locals = [];
  const central = [];
  let offset = 0;
  for (const f of files) {
    const name = Buffer.from(f.name, "utf8");
    const raw = Buffer.isBuffer(f.data) ? f.data : Buffer.from(f.data, "utf8");
    const packed = deflateRawSync(raw);
    // 압축이 오히려 커지면 그냥 담습니다(작은 XML 에서 실제로 생깁니다).
    const useDeflate = packed.length < raw.length;
    const data = useDeflate ? packed : raw;
    const method = useDeflate ? 8 : 0;
    const crc = crc32(raw);

    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0);
    lh.writeUInt16LE(20, 4);
    lh.writeUInt16LE(method, 8);
    lh.writeUInt32LE(crc, 14);
    lh.writeUInt32LE(data.length, 18);
    lh.writeUInt32LE(raw.length, 22);
    lh.writeUInt16LE(name.length, 26);
    locals.push(lh, name, data);

    const cd = Buffer.alloc(46);
    cd.writeUInt32LE(0x02014b50, 0);
    cd.writeUInt16LE(20, 4);
    cd.writeUInt16LE(20, 6);
    cd.writeUInt16LE(method, 10);
    cd.writeUInt32LE(crc, 16);
    cd.writeUInt32LE(data.length, 20);
    cd.writeUInt32LE(raw.length, 24);
    cd.writeUInt16LE(name.length, 28);
    cd.writeUInt32LE(offset, 42);
    central.push(cd, name);
    offset += 30 + name.length + data.length;
  }
  const cdBuf = Buffer.concat(central);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(files.length, 8);
  eocd.writeUInt16LE(files.length, 10);
  eocd.writeUInt32LE(cdBuf.length, 12);
  eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cdBuf, eocd]);
}

/* ────────── 글자 ────────── */

const FONT = "맑은 고딕";
const MONO = "D2Coding";

const esc = (s) =>
  String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

const fonts = (name) =>
  `<w:rFonts w:ascii="${name}" w:hAnsi="${name}" w:eastAsia="${name}" w:cs="${name}"/>`;

// 한 줄 안의 **굵게** 와 `코드` 를 run 으로 쪼갭니다.
function runs(text, base = {}) {
  const out = [];
  const re = /(\*\*[^*]+\*\*|`[^`]+`)/g;
  let last = 0;
  let m;
  const push = (t, opt) => {
    if (!t) return;
    const o = { ...base, ...opt };
    // 워드는 rPr 안의 순서를 규격대로 지키지 않으면 파일을 열지 않습니다.
    // 순서: rFonts → b → color → sz → szCs → shd
    const rpr =
      `<w:rPr>${fonts(o.mono ? MONO : FONT)}` +
      (o.bold ? "<w:b/>" : "") +
      (o.color ? `<w:color w:val="${o.color}"/>` : "") +
      `<w:sz w:val="${o.sz ?? 21}"/><w:szCs w:val="${o.sz ?? 21}"/>` +
      (o.mono ? `<w:shd w:val="clear" w:fill="F0F0F0"/>` : "") +
      `</w:rPr>`;
    out.push(`<w:r>${rpr}<w:t xml:space="preserve">${esc(t)}</w:t></w:r>`);
  };
  while ((m = re.exec(text))) {
    push(text.slice(last, m.index));
    const tok = m[0];
    if (tok.startsWith("**")) push(tok.slice(2, -2), { bold: true });
    else push(tok.slice(1, -1), { mono: true, sz: 19 });
    last = m.index + tok.length;
  }
  push(text.slice(last));
  return out.join("");
}

// 워드는 pPr 안의 순서도 규격대로여야 엽니다. 조각을 이름으로 받아
// 아래 정해진 순서로 늘어놓습니다 (이 순서가 틀리면 "읽을 수 없는 내용"이 됩니다).
const PPR_ORDER = ["keepNext", "numPr", "pBdr", "shd", "spacing", "ind", "jc"];
const pPr = (parts) => {
  const xml = PPR_ORDER.map((k) => parts[k] ?? "").join("");
  return xml ? `<w:pPr>${xml}</w:pPr>` : "";
};
const para = (content, parts = {}) => `<w:p>${pPr(parts)}${content}</w:p>`;
const spacing = (before, after, line = 276) =>
  `<w:spacing w:before="${before}" w:after="${after}" w:line="${line}" w:lineRule="auto"/>`;

/* ────────── 마크다운 → 워드 본문 ────────── */

export function convert(src) {
  const lines = src.split("\n");
  const body = [];
  const numIds = []; // 번호 목록마다 새 numId (앞 목록에 이어 세지 않도록)
  let i = 0;

  const heading = (level, text) => {
    const size = [36, 26, 23][level - 1] ?? 21;
    const border = level <= 2
      ? `<w:pBdr><w:bottom w:val="single" w:sz="${level === 1 ? 12 : 4}" w:space="3" w:color="${level === 1 ? "333333" : "BBBBBB"}"/></w:pBdr>`
      : "";
    body.push(para(runs(text, { bold: true, sz: size }), {
      keepNext: "<w:keepNext/>",
      pBdr: border,
      spacing: spacing(level === 1 ? 0 : 360, 140),
    }));
  };

  while (i < lines.length) {
    const raw = lines[i];
    const line = raw.trim();

    if (line.startsWith("```")) {                    // 코드 블록
      const buf = [];
      i += 1;
      while (i < lines.length && !lines[i].trim().startsWith("```")) buf.push(lines[i++]);
      i += 1;
      const inner = buf
        .map((l) => `<w:r><w:rPr>${fonts(MONO)}<w:sz w:val="17"/></w:rPr><w:t xml:space="preserve">${esc(l)}</w:t></w:r>`)
        .join('<w:r><w:br/></w:r>');
      body.push(para(inner, {
        pBdr:
          `<w:pBdr><w:top w:val="single" w:sz="4" w:color="DDDDDD"/><w:left w:val="single" w:sz="4" w:color="DDDDDD"/>` +
          `<w:bottom w:val="single" w:sz="4" w:color="DDDDDD"/><w:right w:val="single" w:sz="4" w:color="DDDDDD"/></w:pBdr>`,
        shd: `<w:shd w:val="clear" w:fill="F4F4F4"/>`,
        spacing: spacing(120, 160, 240),
        ind: `<w:ind w:left="120" w:right="120"/>`,
      }));
      continue;
    }

    if (line.startsWith("|")) {                      // 표
      const rows = [];
      while (i < lines.length && lines[i].trim().startsWith("|")) {
        rows.push(lines[i].trim().replace(/^\||\|$/g, "").split("|").map((c) => c.trim()));
        i += 1;
      }
      const data = rows.filter((r) => !r.every((c) => /^:?-{2,}:?$/.test(c)));
      if (!data.length) continue;
      const cols = Math.max(...data.map((r) => r.length));
      const width = Math.floor(9360 / cols);
      const border = (w) => `<w:${w} w:val="single" w:sz="4" w:color="999999"/>`;
      const tblPr =
        `<w:tblPr><w:tblW w:w="5000" w:type="pct"/>` +
        `<w:tblBorders>${["top", "left", "bottom", "right", "insideH", "insideV"].map(border).join("")}</w:tblBorders>` +
        `<w:tblCellMar><w:top w:w="60" w:type="dxa"/><w:left w:w="90" w:type="dxa"/>` +
        `<w:bottom w:w="60" w:type="dxa"/><w:right w:w="90" w:type="dxa"/></w:tblCellMar></w:tblPr>`;
      const grid = `<w:tblGrid>${Array.from({ length: cols }, () => `<w:gridCol w:w="${width}"/>`).join("")}</w:tblGrid>`;
      const cell = (text, head) =>
        `<w:tc><w:tcPr><w:tcW w:w="${width}" w:type="dxa"/>` +
        (head ? `<w:shd w:val="clear" w:fill="EAEAEA"/>` : "") +
        `<w:vAlign w:val="top"/></w:tcPr>` +
        para(runs(text, { bold: !!head, sz: 19 }), { spacing: spacing(20, 20, 252) }) +
        `</w:tc>`;
      const tr = (r, head) =>
        `<w:tr>${head ? `<w:trPr><w:tblHeader/></w:trPr>` : ""}` +
        Array.from({ length: cols }, (_, k) => cell(r[k] ?? "", head)).join("") + `</w:tr>`;
      body.push(`<w:tbl>${tblPr}${grid}${tr(data[0], true)}${data.slice(1).map((r) => tr(r, false)).join("")}</w:tbl>`);
      body.push(para("", { spacing: spacing(0, 120, 120) })); // 표 뒤 여백
      continue;
    }

    if (!line) { i += 1; continue; }

    if (/^---+$/.test(line)) {                       // 구분선
      body.push(para("", {
        pBdr: `<w:pBdr><w:bottom w:val="single" w:sz="6" w:space="1" w:color="DDDDDD"/></w:pBdr>`,
        spacing: spacing(160, 160),
      }));
      i += 1;
      continue;
    }

    const h = /^(#{1,4})\s+(.*)$/.exec(line);
    if (h) { heading(h[1].length, h[2]); i += 1; continue; }

    const li = /^(\s*)([-*]|\d+\.)\s+(.*)$/.exec(raw);
    if (li) {                                        // 목록
      const ordered = /^\d/.test(li[2]);
      const level = li[1].length >= 2 ? 1 : 0;
      // 번호 목록은 덩어리마다 새 numId 를 만들어 1 부터 다시 셉니다.
      const prevWasSameList = body.length && body[body.length - 1].includes("__LIST__");
      let numId;
      if (ordered) {
        if (!prevWasSameList || !numIds.length) numIds.push(numIds.length + 2);
        numId = numIds[numIds.length - 1];
      } else numId = 1;

      let text = li[3];
      i += 1;
      while (i < lines.length && /^\s+\S/.test(lines[i]) && !/^\s*([-*]|\d+\.)\s+/.test(lines[i])) {
        text += " " + lines[i].trim();
        i += 1;
      }
      body.push(para(runs(text), {
        numPr: `<w:numPr><w:ilvl w:val="${level}"/><w:numId w:val="${numId}"/></w:numPr>`,
        spacing: spacing(40, 40, 264),
        ind: `<w:ind w:left="${360 + level * 300}" w:hanging="300"/><!--__LIST__-->`,
      }));
      continue;
    }

    // 문단 — 이어지는 줄을 하나로 합칩니다(마크다운은 줄바꿈을 공백으로 봅니다)
    let text = line;
    i += 1;
    while (i < lines.length) {
      const nx = lines[i];
      if (!nx.trim() || /^(#|\||```|---+$)/.test(nx.trim()) || /^\s*([-*]|\d+\.)\s+/.test(nx)) break;
      text += " " + nx.trim();
      i += 1;
    }
    body.push(para(runs(text), { spacing: spacing(60, 60) }));
  }

  return { body: body.join("").replace(/<!--__LIST__-->/g, ""), orderedCount: numIds.length };
}

/* ────────── 파일 묶기 ────────── */

export function docx(bodyXml, orderedCount) {
  const NS =
    'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" ' +
    'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';

  const sect =
    `<w:sectPr><w:pgSz w:w="11906" w:h="16838"/>` +
    `<w:pgMar w:top="1200" w:right="1100" w:bottom="1200" w:left="1100" w:header="720" w:footer="720" w:gutter="0"/></w:sectPr>`;

  const document =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<w:document ${NS}><w:body>${bodyXml}${sect}</w:body></w:document>`;

  const styles =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<w:styles ${NS}><w:docDefaults><w:rPrDefault><w:rPr>${fonts(FONT)}` +
    `<w:sz w:val="21"/><w:szCs w:val="21"/><w:lang w:val="ko-KR" w:eastAsia="ko-KR"/></w:rPr></w:rPrDefault>` +
    `<w:pPrDefault><w:pPr><w:spacing w:after="60" w:line="276" w:lineRule="auto"/></w:pPr></w:pPrDefault>` +
    `</w:docDefaults>` +
    `<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/>` +
    `<w:rPr>${fonts(FONT)}<w:sz w:val="21"/></w:rPr></w:style></w:styles>`;

  // 글머리표 하나 + 번호 목록은 덩어리마다 하나씩(각각 1 부터 다시 셉니다)
  const bulletLvl = (ilvl, ch) =>
    `<w:lvl w:ilvl="${ilvl}"><w:start w:val="1"/><w:numFmt w:val="bullet"/><w:lvlText w:val="${ch}"/>` +
    `<w:lvlJc w:val="left"/><w:pPr><w:ind w:left="${360 + ilvl * 300}" w:hanging="300"/></w:pPr>` +
    `<w:rPr>${fonts(FONT)}</w:rPr></w:lvl>`;
  const decimalLvl = (ilvl) =>
    `<w:lvl w:ilvl="${ilvl}"><w:start w:val="1"/><w:numFmt w:val="decimal"/><w:lvlText w:val="%${ilvl + 1}."/>` +
    `<w:lvlJc w:val="left"/><w:pPr><w:ind w:left="${360 + ilvl * 300}" w:hanging="300"/></w:pPr>` +
    `<w:rPr>${fonts(FONT)}</w:rPr></w:lvl>`;

  const nums = Array.from({ length: orderedCount }, (_, k) => `<w:num w:numId="${k + 2}"><w:abstractNumId w:val="1"/></w:num>`).join("");
  const numbering =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<w:numbering ${NS}>` +
    `<w:abstractNum w:abstractNumId="0"><w:multiLevelType w:val="hybridMultilevel"/>` +
    `${bulletLvl(0, "·")}${bulletLvl(1, "-")}${bulletLvl(2, "·")}</w:abstractNum>` +
    `<w:abstractNum w:abstractNumId="1"><w:multiLevelType w:val="hybridMultilevel"/>` +
    `${decimalLvl(0)}${decimalLvl(1)}${decimalLvl(2)}</w:abstractNum>` +
    `<w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num>${nums}</w:numbering>`;

  const types =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
    `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
    `<Default Extension="xml" ContentType="application/xml"/>` +
    `<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>` +
    `<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>` +
    `<Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/>` +
    `</Types>`;

  const rels =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
    `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>` +
    `</Relationships>`;

  const docRels =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
    `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>` +
    `<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering" Target="numbering.xml"/>` +
    `</Relationships>`;

  return zip([
    { name: "[Content_Types].xml", data: types },
    { name: "_rels/.rels", data: rels },
    { name: "word/document.xml", data: document },
    { name: "word/_rels/document.xml.rels", data: docRels },
    { name: "word/styles.xml", data: styles },
    { name: "word/numbering.xml", data: numbering },
  ]);
}

/** 마크다운 문자열 하나를 .docx 버퍼로. */
export function mdToDocx(md) {
  const { body, orderedCount } = convert(md);
  return docx(body, orderedCount);
}

// 직접 실행했을 때만 파일을 만듭니다 (자체점검에서 불러 쓸 수 있도록).
if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
const input = process.argv[2];
if (!input) {
  console.log("사용법: node scripts\\md-to-docx.mjs docs\\키워드-기준.md [출력.docx]");
  process.exit(1);
}
const output = process.argv[3] ?? input.replace(/\.md$/i, "") + ".docx";
const md = await readFile(input, "utf8");
await writeFile(output, mdToDocx(md));
console.log(`[완료] ${basename(output)} 만들었습니다`);
}
