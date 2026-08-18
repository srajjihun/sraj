// 신인도 인증 리포트 — "어떤 인증을 실제로 받아야 하는가"에 답합니다.
//
// 왜 필요한가:
//   공고문-분석이 찍어 주는 건 "인증별 언급 건수"뿐입니다. 그것만으로는
//   판단이 안 됩니다. 인증 하나 받는 데 드는 시간과 비용을 쓸 값어치가
//   있으려면, 그 인증이 걸린 공고가 "몇 건"인지보다 "얼마짜리"인지가
//   중요하기 때문입니다. 그래서 예산을 붙여 셉니다.
//
// 무엇을 보여주는가:
//   ① 우리가 가진 인증이 실제로 몇 건·얼마짜리 공고에서 인정되는가
//   ② 우리가 없는 인증 때문에 얼마짜리 시장에서 감점되는가
//   ③ 배점표에 적혀 있으나 우리 목록에 없는 인증 후보 (놓치고 있는 것)
//   ④ 아직 못 읽은 공고문의 사유
//
// 아무것도 새로 받지 않습니다. 이미 읽어 둔 것만 세므로 몇 초면 끝납니다.
//
// 사용법: node scripts\g2b\credits.mjs
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { loadCompany } from "./lib/company.mjs";

const DATA = new URL("../../data/g2b/", import.meta.url);

async function loadJson(url, fallback) {
  try {
    return JSON.parse(await readFile(url, "utf8"));
  } catch (err) {
    if (err.code === "ENOENT") return fallback;
    throw err;
  }
}

const won = (n) =>
  n >= 1e8 ? `${(n / 1e8).toFixed(1)}억` : n >= 1e4 ? `${Math.round(n / 1e4)}만` : `${n}`;

const norm = (s) => String(s ?? "").replace(/\s+/g, "").toUpperCase();

/* 배점표에서 "인증처럼 생긴 항목"을 찾습니다. 우리 목록에 아직 없는 인증을
   발견하려는 것입니다 — 목록에 없으면 영원히 세어지지 않으니, 목록 자체가
   맞는지 확인할 방법이 있어야 합니다.
   처음에는 "신인도|가점|우대|인증" 이 든 줄만 봤는데, 실제 배점표는
   "신인도" 를 부모 줄에 한 번 쓰고 아래에 인증 이름만 늘어놓습니다
   (예: 일자리창출 우수기업). 그래서 이름 생김새로 찾습니다. */
const CREDIT_ROW = /(기업|조합|단체|협회|인증|확인서?|ISO\s?\d{4,5}|가점|우대|신인도)/;
const NOT_CREDIT = /평가|점수|배점|합계|소계|항목|구분|계$|^계|총점|비고/;

async function main() {
  const posts = await loadJson(new URL("posts.json", DATA), null);
  const docs = await loadJson(new URL("docs.json", DATA), null);
  if (!posts) throw new Error("data/g2b/posts.json 이 없습니다. 먼저 수집을 실행하세요.");
  if (!docs) throw new Error("data/g2b/docs.json 이 없습니다. 먼저 공고문-분석.bat 을 실행하세요.");

  const company = await loadCompany();
  const held = new Set([
    ...(company.certs ?? []),
    ...((company.directProduce ?? []).length ? ["직접생산확인"] : []),
  ].map(norm));

  // 공고번호 → 예산. 예산이 비어 오는 공고가 있어 추정가격으로 보완합니다.
  const budget = new Map();
  for (const it of [...(posts.posts ?? []), ...(posts.prespecs ?? [])]) {
    if (it.bidNo) budget.set(it.bidNo, it.budget ?? it.price ?? 0);
  }

  const read = Object.entries(docs).filter(([, d]) => d?.ok);
  const stat = new Map(); // term → { n, sum }
  for (const [bidNo, d] of read) {
    const b = budget.get(bidNo) ?? 0;
    for (const c of d.credits ?? []) {
      const cur = stat.get(c.term) ?? { n: 0, sum: 0 };
      cur.n += 1;
      cur.sum += b;
      stat.set(c.term, cur);
    }
  }

  const rows = [...stat.entries()]
    .map(([term, v]) => ({ term, ...v, have: held.has(norm(term)) }))
    .sort((a, b) => b.n - a.n);

  const pct = (n) => (read.length ? Math.round((n / read.length) * 100) : 0);
  const line = (r) =>
    `  ${r.term.padEnd(16)} ${String(r.n).padStart(4)}건 ${String(pct(r.n) + "%").padStart(5)}` +
    `   공고 예산 합계 ${won(r.sum)}`;

  console.log(`\n[신인도 인증 리포트]  읽은 공고문 ${read.length}건 기준\n`);
  console.log(`보유: ${[...held].join(", ") || "(없음)"}\n`);

  const have = rows.filter((r) => r.have);
  const miss = rows.filter((r) => !r.have);

  console.log("── 우리가 가진 인증이 인정되는 공고 ──");
  if (have.length) have.forEach((r) => console.log(line(r)));
  else console.log("  (없음)");

  console.log("\n── 없어서 감점되는 인증 (많은 순) ──");
  if (miss.length) miss.forEach((r) => console.log(line(r)));
  else console.log("  (없음)");

  // 한 번도 안 나온 인증 — 받을 이유가 없다는 근거가 됩니다.
  const zero = [...held].filter((h) => !rows.some((r) => norm(r.term) === h));
  if (zero.length) {
    console.log(`\n── 보유하고 있으나 ${read.length}건 중 한 번도 안 나온 인증 ──`);
    console.log(`  ${zero.join(", ")}`);
    console.log("  (입찰 가점으로는 쓸모가 없다는 뜻입니다. 다른 용도는 별개입니다)");
  }

  // 배점표에 적혀 있는데 우리가 세지 않는 항목 — 목록을 넓힐 단서
  const unknown = new Map();
  for (const [, d] of read) {
    for (const row of d.scoreTable?.rows ?? []) {
      const name = (row[0] ?? "").trim();
      if (!name || name.length > 30) continue;
      if (!CREDIT_ROW.test(name) || NOT_CREDIT.test(name)) continue;
      if (rows.some((r) => name.includes(r.term))) continue;
      unknown.set(name, (unknown.get(name) ?? 0) + 1);
    }
  }
  const cand = [...unknown.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15);
  if (cand.length) {
    console.log("\n── 배점표에 있으나 아직 세지 않는 항목 (목록을 넓힐 단서) ──");
    for (const [name, n] of cand) console.log(`  ${String(n).padStart(3)}건  ${name}`);
  }

  // 못 읽은 공고문의 사유
  const why = new Map();
  for (const d of Object.values(docs)) {
    if (d?.ok) continue;
    const k = d?.note || "(사유 없음)";
    why.set(k, (why.get(k) ?? 0) + 1);
  }
  if (why.size) {
    console.log("\n── 아직 못 읽은 공고문 ──");
    for (const [k, n] of [...why.entries()].sort((a, b) => b[1] - a[1])) {
      console.log(`  ${String(n).padStart(3)}건  ${k}`);
    }
  }
  console.log("");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(`\n[오류] ${err.message}\n`);
    process.exitCode = 1;
  });
}
