// 문서 해석기 자체 점검.
//
// 왜 필요한가:
//   HWP 해석기는 남의 라이브러리 없이 형식 문서만 보고 만들었습니다. 그런데
//   이 작업 환경에서는 나라장터에 접속할 수 없어 진짜 공고문으로 시험해 볼
//   수가 없습니다. 그래서 규격대로 HWP 파일을 직접 만들어 넣고, 넣은 내용이
//   그대로 나오는지 봅니다. 이러면 적어도 "껍데기를 여는 부분"과 "글자를
//   꺼내는 부분"이 맞는지는 확인됩니다.
//
//   확인되지 않는 것: 한컴이 실제로 쓰는 세부 관행. 그건 진짜 공고문으로만
//   알 수 있어서, 못 읽으면 못 읽었다고 말하도록 만들어 두었습니다.
//
// 사용법: node scripts\g2b\selftest.mjs
import { deflateRawSync } from "node:zlib";
import { parseHwp } from "./lib/hwp.mjs";
import { openCfb } from "./lib/cfb.mjs";

const SEC = 512;
const MINI = 64;
const FREE = 0xffffffff;
const EOC = 0xfffffffe;
const FATSECT = 0xfffffffd;

/* ────────── HWP 기록 만들기 ────────── */

function record(tag, level, data) {
  const big = data.length >= 0xfff;
  const head = Buffer.alloc(big ? 8 : 4);
  head.writeUInt32LE((tag & 0x3ff) | ((level & 0x3ff) << 10) | ((big ? 0xfff : data.length) << 20), 0);
  if (big) head.writeUInt32LE(data.length, 4);
  return Buffer.concat([head, data]);
}

const utf16 = (s) => Buffer.from(s, "utf16le");

function paraRecords(text, level = 0) {
  return [record(66, level, Buffer.alloc(22)), record(67, level + 1, utf16(text))];
}

/** 표 하나를 기록들로. cells 는 [{row,col,text}] */
function tableRecords(rows, cols, cells, level = 1) {
  const ctrl = Buffer.alloc(4);
  // 컨트롤 종류는 파일에 거꾸로 들어갑니다.
  ctrl.write([..."tbl "].reverse().join(""), 0, "latin1");
  const out = [record(71, level, ctrl)];

  const tbl = Buffer.alloc(16);
  tbl.writeUInt32LE(0, 0);
  tbl.writeUInt16LE(rows, 4);
  tbl.writeUInt16LE(cols, 6);
  out.push(record(76, level + 1, tbl));

  for (const c of cells) {
    const lh = Buffer.alloc(32);
    lh.writeInt32LE(1, 0);
    lh.writeUInt32LE(0, 4);
    lh.writeUInt16LE(c.col, 8);
    lh.writeUInt16LE(c.row, 10);
    lh.writeUInt16LE(c.colSpan ?? 1, 12);
    lh.writeUInt16LE(c.rowSpan ?? 1, 14);
    out.push(record(72, level + 1, lh));
    out.push(...paraRecords(c.text, level + 2));
  }
  return out;
}

/* ────────── 복합 문서 껍데기 만들기 ────────── */

function buildCfb(streams) {
  // streams: [{ path, data }] — path 는 "FileHeader" 또는 "BodyText/Section0"
  const sectors = [];
  const addSectors = (buf) => {
    const start = sectors.length;
    for (let o = 0; o < buf.length; o += SEC) {
      const s = Buffer.alloc(SEC);
      buf.copy(s, 0, o, Math.min(buf.length, o + SEC));
      sectors.push(s);
    }
    return start;
  };

  const big = streams.filter((s) => s.data.length >= 4096);
  const small = streams.filter((s) => s.data.length < 4096);

  // 큰 스트림은 일반 구역에
  const placed = new Map();
  for (const s of big) placed.set(s.path, { start: addSectors(s.data), size: s.data.length });

  // 작은 스트림은 미니 구역에 모아서
  const miniParts = [];
  let miniIdx = 0;
  for (const s of small) {
    const need = Math.ceil(s.data.length / MINI) || 1;
    const chunk = Buffer.alloc(need * MINI);
    s.data.copy(chunk, 0);
    miniParts.push(chunk);
    placed.set(s.path, { start: miniIdx, size: s.data.length, mini: true });
    miniIdx += need;
  }
  const miniStream = Buffer.concat(miniParts);
  const miniStart = miniStream.length ? addSectors(miniStream) : EOC;

  // 미니 FAT — 미니 구역들의 사슬
  const miniFat = Buffer.alloc(SEC, 0xff);
  for (const s of small) {
    const p = placed.get(s.path);
    const need = Math.ceil(s.data.length / MINI) || 1;
    for (let i = 0; i < need; i += 1) {
      miniFat.writeUInt32LE(i === need - 1 ? EOC : p.start + i + 1, (p.start + i) * 4);
    }
  }
  const miniFatStart = addSectors(miniFat);

  // 디렉터리
  const order = ["Root Entry", "BodyText", "FileHeader", "Section0"];
  const dir = Buffer.alloc(SEC, 0);
  const put = (i, name, type, { left = FREE, right = FREE, child = FREE, start = 0, size = 0 }) => {
    const off = i * 128;
    const nb = Buffer.from(`${name}\0`, "utf16le");
    nb.copy(dir, off);
    dir.writeUInt16LE(nb.length, off + 64);
    dir[off + 66] = type;
    dir[off + 67] = 1;
    dir.writeUInt32LE(left, off + 68);
    dir.writeUInt32LE(right, off + 72);
    dir.writeUInt32LE(child, off + 76);
    dir.writeUInt32LE(start, off + 116);
    dir.writeBigUInt64LE(BigInt(size), off + 120);
  };
  const fh = placed.get("FileHeader");
  const sec0 = placed.get("BodyText/Section0");
  put(0, order[0], 5, { child: 1, start: miniStart, size: miniStream.length });
  put(1, order[1], 1, { right: 2, child: 3 });                       // BodyText 폴더
  put(2, order[2], 2, { start: fh.start, size: fh.size });           // FileHeader
  put(3, order[3], 2, { start: sec0.start, size: sec0.size });       // BodyText/Section0
  const dirStart = addSectors(dir);

  // FAT — 자기 자신도 구역을 차지하므로 몇 장이 필요한지 먼저 셉니다.
  // (한 장이 128 구역을 가리킵니다. 압축을 안 한 문서는 금방 넘깁니다)
  const dataSectors = sectors.length;
  let fatCount = 1;
  while (dataSectors + fatCount > fatCount * (SEC / 4)) fatCount += 1;
  const fatStart = dataSectors;

  const fat = Buffer.alloc(SEC * fatCount, 0xff);
  const setChain = (start, byteLen) => {
    const n = Math.max(1, Math.ceil(byteLen / SEC));
    for (let i = 0; i < n; i += 1) fat.writeUInt32LE(i === n - 1 ? EOC : start + i + 1, (start + i) * 4);
  };
  for (const s of big) setChain(placed.get(s.path).start, s.data.length);
  if (miniStream.length) setChain(miniStart, miniStream.length);
  setChain(miniFatStart, SEC);
  setChain(dirStart, SEC);
  for (let i = 0; i < fatCount; i += 1) fat.writeUInt32LE(FATSECT, (fatStart + i) * 4);
  for (let i = 0; i < fatCount; i += 1) sectors.push(fat.subarray(i * SEC, (i + 1) * SEC));

  const header = Buffer.alloc(SEC, 0);
  Buffer.from("d0cf11e0a1b11ae1", "hex").copy(header, 0);
  header.writeUInt16LE(0x003e, 24);
  header.writeUInt16LE(3, 26);
  header.writeUInt16LE(0xfffe, 28);
  header.writeUInt16LE(9, 30);   // 구역 512
  header.writeUInt16LE(6, 32);   // 미니 구역 64
  header.writeUInt32LE(fatCount, 44);
  header.writeUInt32LE(dirStart, 48);
  header.writeUInt32LE(4096, 56);
  header.writeUInt32LE(miniFatStart, 60);
  header.writeUInt32LE(1, 64);
  header.writeUInt32LE(EOC, 68);
  header.writeUInt32LE(0, 72);
  header.fill(0xff, 76, 512);
  if (fatCount > 109) throw new Error("점검용 파일이 너무 큽니다");
  for (let i = 0; i < fatCount; i += 1) header.writeUInt32LE(fatStart + i, 76 + i * 4);

  return Buffer.concat([header, ...sectors]);
}

function buildHwp(bodyRecords, { compress = true } = {}) {
  const fileHeader = Buffer.alloc(256);
  fileHeader.write("HWP Document File", 0, "latin1");
  fileHeader.writeUInt32LE(0x05000300, 32);
  fileHeader.writeUInt32LE(compress ? 1 : 0, 36);
  const body = Buffer.concat(bodyRecords);
  return buildCfb([
    { path: "FileHeader", data: fileHeader },
    { path: "BodyText/Section0", data: compress ? deflateRawSync(body) : body },
  ]);
}

/* ────────── 점검 ────────── */

let pass = 0;
let fail = 0;
const check = (name, ok, detail = "") => {
  if (ok) { pass += 1; console.log(`  OK   ${name}`); }
  else { fail += 1; console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ""}`); }
};

console.log("[자체점검] HWP 해석기\n");

// 진짜 공고문에 나오는 문장들로 만듭니다. 뽑아낸 뒤 require.mjs 가
// 이걸 실제로 알아보는지까지 봐야 의미가 있습니다.
const LINES = [
  "2026년 창업지원 행사 대행 용역 입찰공고",
  "가. 본 입찰은 공고일 전일부터 계약 체결일까지 본점의 소재지를 서울특별시로 하며 제한합니다.",
  "나. 기타자유업(행사대행업, 업종코드 9901)으로 등록을 필한 업체",
  "다. 최근 3년 이내 유사용역 1억5천만원 이상 수행실적을 보유한 업체",
  "※ 협상에 의한 계약 배점은 기술능력평가",
  "90 점 (정량적 평가 20, 정성적 평가 70 점 ), 입찰가격평가 10 점임",
  "신인도 가점: 여성기업 2점, 벤처기업 1점, 이노비즈 1점을 가점한다.",
];
// 큰 문서에서도 되는지 보려고 부풀립니다(일반 구역 사슬을 타게 됩니다).
const filler = Array.from({ length: 3000 }, (_, i) => `제${i}조 세부 과업 내용은 과업지시서에 따른다.`);

const body = [
  ...LINES.flatMap((l) => paraRecords(l)),
  ...filler.flatMap((l) => paraRecords(l)),
  ...tableRecords(4, 2, [
    { row: 0, col: 0, text: "평가항목" },
    { row: 0, col: 1, text: "배점" },
    { row: 1, col: 0, text: "사업수행능력" },
    { row: 1, col: 1, text: "40" },
    { row: 2, col: 0, text: "사업이해도" },
    { row: 2, col: 1, text: "35" },
    { row: 3, col: 0, text: "신인도" },
    { row: 3, col: 1, text: "15" },
  ]),
  ...paraRecords("이상 끝."),
];

// ① 압축된 문서
{
  const buf = buildHwp(body);
  const r = parseHwp(buf);
  check("압축 문서를 읽는다", r.ok, r.note);
  for (const l of LINES) {
    check(`문장이 그대로 나온다: ${l.slice(0, 22)}…`, r.text.includes(l));
  }
  check("표를 1개 찾는다", r.tables.length === 1, `${r.tables.length}개`);
  const g = r.tables[0]?.grid ?? [];
  check("표 크기 4행 2열", g.length === 4 && g[0]?.length === 2, `${g.length}행 ${g[0]?.length}열`);
  check("표 내용이 맞다", g[3]?.[0] === "신인도" && g[3]?.[1] === "15", JSON.stringify(g));
  check("큰 문서도 끝까지 읽는다", r.text.includes("제2999조"));
  check("본문 끝이 잘리지 않는다", r.text.includes("이상 끝."));
}

// ② 압축 안 한 문서
{
  const r = parseHwp(buildHwp(body, { compress: false }));
  check("압축 안 된 문서도 읽는다", r.ok && r.text.includes("이상 끝."), r.note);
}

// ③ 뽑은 글자를 require.mjs 가 실제로 알아보는가 — 여기까지 돼야 값이 있습니다
{
  const { extractRequirements } = await import("./lib/require.mjs");
  const r = parseHwp(buildHwp(body));
  const req = extractRequirements(r.text, r.tables);
  check("지역제한을 찾는다", req.region?.value === "서울특별시", JSON.stringify(req.region));
  check("업종을 찾는다", req.industry.some((i) => i.value.includes("9901")), JSON.stringify(req.industry));
  check("실적요건을 찾는다", req.record?.amount === 150000000, JSON.stringify(req.record));
  check("배점을 찾는다", req.rate?.tech === 90 && req.rate?.price === 10, JSON.stringify(req.rate));
  check("배점표를 찾는다", req.scoreTable?.items?.length === 3, JSON.stringify(req.scoreTable?.items));
  check(
    "신인도 인증을 찾는다",
    ["여성기업", "벤처기업", "이노비즈"].every((t) => req.credits.some((c) => c.term === t)),
    JSON.stringify(req.credits.map((c) => c.term))
  );
}

// ④ 이상한 파일을 조용히 통과시키지 않는가
{
  check("HWP 가 아니면 거절한다", !parseHwp(Buffer.alloc(600)).ok);
  const notHwp = buildCfb([
    { path: "FileHeader", data: Buffer.alloc(256) },
    { path: "BodyText/Section0", data: Buffer.alloc(8000) },
  ]);
  check("서명이 없으면 거절한다", !parseHwp(notHwp).ok);
}

// ⑤ 껍데기 자체
{
  const cfb = openCfb(buildHwp(body));
  check("스트림 목록이 맞다", cfb.has("FileHeader") && cfb.has("BodyText/Section0"), cfb.names().join(", "));
}

console.log(`\n[자체점검] 통과 ${pass} · 실패 ${fail}`);
if (fail) process.exitCode = 1;
