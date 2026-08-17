// 현재 키워드 설정을 PC에 저장된 원본 공고 전체에 적용해 보는 검증 리포트입니다.
//
// config/g2b-keywords.md 를 읽어 data/g2b/raw/ 의 실제 수집 원본에 돌린 뒤
//   - 그룹별로 몇 건이 잡히는지 + 실제 제목 샘플
//   - 제외어가 몇 건을 걸러내는지 + 아깝게 죽은 것이 있는지
//   - 아무 키워드에도 안 걸린 공고 샘플 (놓친 시장 후보)
//   - 공고명에 실제로 자주 나오는 단어 (키워드 추가 후보 발굴)
// 를 보여줍니다. 수집 데이터나 화면은 바꾸지 않습니다.
//
// 실행: 키워드-검증.bat 더블클릭 (또는 node scripts\g2b\keyword-report.mjs)
import { readFile } from "node:fs/promises";
import { loadKeywords, excludedBy as excludedByConfig, matchGroups } from "./lib/keywords.mjs";

const RAW_BID = new URL("../../data/g2b/raw/bid.json", import.meta.url);
const RAW_PRE = new URL("../../data/g2b/raw/prespec.json", import.meta.url);

// 설정 파일만 고치면 이 리포트도 같이 따라옵니다.
const PROPOSED = await loadKeywords();

async function loadStore(url, name) {
  try {
    return Object.values(JSON.parse(await readFile(url, "utf8")));
  } catch {
    console.log(`[안내] ${name} 원본이 없습니다. G2B-설치.bat 또는 collect-g2b.bat 을 먼저 실행해 주세요.`);
    return [];
  }
}

function hay(it) {
  return `${it.title ?? ""} ${it.category ?? ""} ${it.categoryMid ?? ""} ${it.categoryLarge ?? ""}`;
}

// 수집 예외(직무역량 안의 "무역" 등)까지 반영하려면 수집기와 같은 판정을 써야 합니다.
function matchedGroups(it) {
  return matchGroups(it, PROPOSED);
}

// 어떤 단어 때문에 잡혔는지. 제목에 없으면 조달분류명에서 걸린 것이므로
// 그 사실까지 알려줍니다 — 제목만 보면 왜 잡혔는지 알 수 없는 건이 있습니다.
function matchedWord(it, group) {
  const title = it.title ?? "";
  const words = PROPOSED.groups[group] ?? [];
  const inTitle = words.find((w) => title.includes(w));
  if (inTitle) return inTitle;
  const inCat = words.find((w) => hay(it).includes(w));
  return inCat ? `${inCat}·분류명` : "?";
}

// 제외 예외(기관명 등)까지 반영하려면 수집기와 같은 판정을 써야 합니다.
function excludedBy(it) {
  return excludedByConfig(it, PROPOSED);
}

function sample(arr, n) {
  // 고르게 뽑기 (앞쪽 편향 방지)
  if (arr.length <= n) return arr;
  const step = arr.length / n;
  return Array.from({ length: n }, (_, i) => arr[Math.floor(i * step)]);
}

const line = (c = "─") => console.log(c.repeat(64));

async function main() {
  const bids = await loadStore(RAW_BID, "입찰공고");
  const pres = await loadStore(RAW_PRE, "사전규격");
  const all = [...bids, ...pres];
  if (!all.length) return;

  console.log(`키워드 검증 리포트`);
  console.log(`원본: 입찰공고 ${bids.length}건 + 사전규격 ${pres.length}건 = ${all.length}건`);

  // 어느 설정으로 돌렸는지 반드시 남깁니다. 이게 없으면 코드를 안 받은 채
  // 예전 설정으로 돌린 결과를 새 결과로 착각합니다.
  const gnames = Object.keys(PROPOSED.groups);
  const kcount = Object.values(PROPOSED.groups).flat().length;
  console.log(`설정: ${gnames.length}개 그룹 · 수집 ${kcount}개 · 제외 ${PROPOSED.exclude.length}개`);
  for (const g of gnames) console.log(`      [${g}] ${PROPOSED.groups[g].join(" ")}`);
  line("═");

  const kept = [];       // 수집될 것
  const killed = [];     // 키워드에 걸렸으나 제외어로 차단
  const unmatched = [];  // 아무 키워드에도 안 걸림
  const killCount = new Map();

  for (const it of all) {
    const groups = matchedGroups(it);
    const ex = excludedBy(it);
    if (ex.length) {
      for (const w of ex) killCount.set(w, (killCount.get(w) ?? 0) + 1);
      if (groups.length) killed.push({ it, groups, ex });
      continue;
    }
    if (groups.length) kept.push({ it, groups });
    else unmatched.push(it);
  }

  console.log(`\n■ 수집 예상: ${kept.length}건`);
  line();
  for (const g of Object.keys(PROPOSED.groups)) {
    const rows = kept.filter((k) => k.groups[0] === g); // 첫 매칭 그룹 기준
    const total = kept.filter((k) => k.groups.includes(g)).length;
    console.log(`\n[${g}] ${total}건`);
    for (const { it } of sample(rows, 8))
      console.log(`   · [${matchedWord(it, g)}] ${(it.title ?? "").slice(0, 44)}`);
  }

  console.log(`\n\n■ 제외어가 걸러낸 것 (키워드에는 걸렸던 건): ${killed.length}건`);
  line();
  const topKills = [...killCount.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12);
  console.log(`   많이 걸러낸 제외어: ${topKills.map(([w, n]) => `${w}(${n})`).join(" · ")}`);
  console.log(`   ▼ 아깝게 죽은 게 있는지 확인해 주세요`);
  for (const { it, ex } of sample(killed, 14))
    console.log(`   · [${ex[0]}] ${(it.title ?? "").slice(0, 44)}`);

  console.log(`\n\n■ 아무 키워드에도 안 걸린 것: ${unmatched.length}건`);
  line();
  console.log(`   ▼ 우리가 할 수 있는 일인데 놓친 게 있는지 확인해 주세요`);
  for (const it of sample(unmatched, 20))
    console.log(`   · ${(it.title ?? "").slice(0, 48)}`);

  /* ══════════════════════════════════════════════════════════════
     키워드 발굴 — 우리 사업분야에서 "유독" 자주 쓰이는 단어를 찾습니다.

     단순 빈도로는 "운영·지원" 같은 일반어만 나옵니다. 그래서 특이도를 씁니다.
       특이도 = (그 단어가 나온 우리 분야 공고 수) ÷ (그 단어가 나온 전체 공고 수)
     특이도가 높다 = 그 단어가 나오면 대체로 우리 분야다 = 좋은 키워드 후보
     ══════════════════════════════════════════════════════════════ */
  const STOP = new Set([
    "용역","사업","운영","지원","위탁","선정","공고","입찰","제안","계약","협상",
    "관련","위한","대상","대한","통한","기반","활용","연간","단가","재공고","긴급",
    "제작","개발","조사","연구","평가","분석","계획","수립","실시","추진","업무",
    "협상에","의한","의하","일반","제한","경쟁","전자","방식","분야","기타",
    "지역","전국","국내","해외","공동","통합","종합","신규","기존","우수","주요",
    "이하","이상","외","및","등","제","년","년도","차","회","기","호","안","내",
  ]);
  // 꼬리말을 뗀 어간도 후보에 넣습니다. "육성사업" → "육성사업", "육성"
  const TAILS = ["사업","용역","운영","지원","관리","계획","서비스","프로그램","구축","제작","개발","교육","사업자","기관"];
  function variants(word) {
    const out = [word];
    for (const t of TAILS) {
      if (word.length > t.length + 1 && word.endsWith(t)) out.push(word.slice(0, -t.length));
    }
    return out;
  }
  const tokenize = (t) => {
    const raw = String(t ?? "")
      .replace(/[\[\]()「」『』·,~〈〉<>‘’'"“”\/|:;!?&#*+=_%]/g, " ")
      .split(/\s+/)
      .map((w) => w.replace(/^[0-9]{1,4}년?도?$|^제?[0-9]+[차회기]$/g, ""))
      .filter((w) => w.length >= 2 && !/^[0-9.]+$/.test(w));
    const set = new Set();
    for (const w of raw) for (const v of variants(w)) if (v.length >= 2 && !STOP.has(v)) set.add(v);
    return set; // 한 공고 안에서 같은 단어는 1회로 셉니다
  };

  const isKeyword = (w) =>
    Object.values(PROPOSED.groups).some((ws) => ws.some((k) => w.includes(k) || k.includes(w)));

  // 제외어를 통과한 공고만 후보 발굴 대상으로 삼습니다 (노이즈에서 단어를 배우지 않도록)
  const pool = all.filter((it) => !excludedBy(it).length);
  const poolTokens = pool.map((it) => ({ it, ws: tokenize(it.title) }));

  const freqPool = new Map();
  for (const { ws } of poolTokens) for (const w of ws) freqPool.set(w, (freqPool.get(w) ?? 0) + 1);

  console.log(`\n\n■ 키워드 발굴 — 우리 사업분야에서 유독 자주 쓰이는 단어`);
  line();
  console.log(`   특이도 = 그 단어가 나온 공고 중 우리 분야가 차지하는 비율`);
  console.log(`   높을수록 그 단어만 넣어도 우리 분야가 잡힌다는 뜻입니다.`);
  console.log(`   추가하려면 config/g2b-keywords.md 의 해당 그룹에 한 줄 넣으면 됩니다.`);

  const MIN_HITS = Math.max(3, Math.round(pool.length / 2000)); // 데이터가 커지면 기준도 올라갑니다
  for (const [g, words] of Object.entries(PROPOSED.groups)) {
    const seed = poolTokens.filter(({ it }) => {
      const h = hay(it);
      return words.some((w) => h.includes(w));
    });
    if (!seed.length) { console.log(`\n   [${g}] 수집 0건 — 발굴할 표본이 없습니다`); continue; }

    const freqSeed = new Map();
    for (const { ws } of seed) for (const w of ws) freqSeed.set(w, (freqSeed.get(w) ?? 0) + 1);

    const cands = [...freqSeed.entries()]
      .filter(([w, n]) => n >= MIN_HITS && !isKeyword(w))
      .map(([w, n]) => ({ w, n, all: freqPool.get(w) ?? n, lift: n / (freqPool.get(w) ?? n) }))
      .filter((c) => c.lift >= 0.4)
      .sort((a, b) => b.lift * Math.log(1 + b.n) - a.lift * Math.log(1 + a.n))
      .slice(0, 12);

    console.log(`\n   [${g}] 수집 ${seed.length}건에서 발굴`);
    if (!cands.length) { console.log(`      추가할 만한 단어가 없습니다 (현재 키워드로 충분)`); continue; }
    for (const c of cands) {
      const ex = seed.find(({ it }) => (it.title ?? "").includes(c.w))?.it;
      const pct = Math.round(c.lift * 100);
      console.log(
        `      · ${c.w.padEnd(12)} 우리 ${String(c.n).padStart(4)}건 / 전체 ${String(c.all).padStart(5)}건` +
        ` · 특이도 ${String(pct).padStart(3)}%`
      );
      console.log(`        예: ${(ex?.title ?? "").slice(0, 44)}`);
    }
  }

  /* ── 미수집 공고에서만 자주 나오는 단어 (놓친 시장 후보) ── */
  const unTokens = unmatched.map((it) => ({ it, ws: tokenize(it.title) }));
  const freqUn = new Map();
  for (const { ws } of unTokens) for (const w of ws) freqUn.set(w, (freqUn.get(w) ?? 0) + 1);
  const missed = [...freqUn.entries()]
    .filter(([w, n]) => n >= MIN_HITS * 2 && !isKeyword(w))
    .map(([w, n]) => ({ w, n, lift: n / (freqPool.get(w) ?? n) }))
    .filter((c) => c.lift >= 0.7)
    .sort((a, b) => b.n - a.n)
    .slice(0, 20);

  console.log(`\n\n■ 미수집 공고에만 나오는 단어 — 놓친 시장이 있는지`);
  line();
  if (!missed.length) console.log(`   눈에 띄는 단어가 없습니다.`);
  for (const c of missed) {
    const ex = unmatched.find((it) => (it.title ?? "").includes(c.w));
    console.log(`   · ${c.w.padEnd(12)} ${String(c.n).padStart(4)}건  예: ${(ex?.title ?? "").slice(0, 40)}`);
  }

  line("═");
  console.log(`이 결과를 캡처하거나 파일(logs/keyword-report.txt)을 올려 주시면`);
  console.log(`키워드를 다듬어 확정하겠습니다.`);
}

main().catch((e) => { console.error(e); process.exit(1); });
