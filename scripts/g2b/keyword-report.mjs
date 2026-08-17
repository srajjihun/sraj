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
import { loadKeywords } from "./lib/keywords.mjs";

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

function matchedGroups(it) {
  const h = hay(it);
  return Object.entries(PROPOSED.groups)
    .filter(([, ws]) => ws.some((w) => h.includes(w)))
    .map(([g]) => g);
}

function excludedBy(it) {
  const t = it.title ?? "";
  return PROPOSED.exclude.filter((w) => t.includes(w));
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

  console.log(`키워드 제안안 검증 리포트`);
  console.log(`원본: 입찰공고 ${bids.length}건 + 사전규격 ${pres.length}건 = ${all.length}건`);
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

  console.log(`\n■ 수집 예상: ${kept.length}건  (지금 1,285건 → 제안안 적용 시)`);
  line();
  for (const g of Object.keys(PROPOSED.groups)) {
    const rows = kept.filter((k) => k.groups[0] === g); // 첫 매칭 그룹 기준
    const total = kept.filter((k) => k.groups.includes(g)).length;
    console.log(`\n[${g}] ${total}건`);
    for (const { it } of sample(rows, 6)) console.log(`   · ${(it.title ?? "").slice(0, 46)}`);
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

  /* ── 단어 발굴: 공고명에 실제로 자주 나오는 단어를 데이터에서 셉니다 ── */
  const STOP = new Set([
    "용역","사업","운영","지원","위탁","선정","공고","입찰","제안","계약","협상",
    "관련","위한","대상","대한","통한","기반","활용","연간","단가","재공고","긴급",
    "제작","개발","조사","연구","평가","분석","계획","수립","실시","추진","업무",
    "협상에","의한","의하","일반","제한","경쟁","전자","방식","분야","기타",
  ]);
  const tokenize = (t) =>
    String(t ?? "")
      .replace(/[\[\]()「」『』『·,~〈〉<>‘’'"“”]/g, " ")
      .split(/\s+/)
      .map((w) => w.replace(/^[0-9]{1,4}년?도?$|^제?[0-9]+[차회기]$/g, ""))
      .filter((w) => w.length >= 2 && !/^[0-9.]+$/.test(w) && !STOP.has(w));

  const covered = (word) =>
    Object.values(PROPOSED.groups).some((ws) => ws.some((k) => word.includes(k)));

  const freqAll = new Map();
  const freqUn = new Map();
  for (const it of all) for (const w of tokenize(it.title)) freqAll.set(w, (freqAll.get(w) ?? 0) + 1);
  for (const it of unmatched) for (const w of tokenize(it.title)) freqUn.set(w, (freqUn.get(w) ?? 0) + 1);

  console.log(`\n\n■ 단어 발굴 — 공고명에 실제로 자주 나오는 단어`);
  line();
  console.log(`   (✓ = 제안 키워드에 이미 걸림)`);
  const topAll = [...freqAll.entries()].sort((a, b) => b[1] - a[1]).slice(0, 40);
  console.log(`\n   [전체 공고 기준 상위 40]`);
  console.log("   " + topAll.map(([w, n]) => `${covered(w) ? "✓" : " "}${w}(${n})`).join("  "));

  const cand = [...freqUn.entries()]
    .filter(([w]) => !covered(w))
    .sort((a, b) => b[1] - a[1])
    .slice(0, 25);
  console.log(`\n   [미수집 공고에서만 자주 나오는 단어 — 키워드 추가 후보]`);
  for (const [w, n] of cand) {
    const ex = unmatched.find((it) => (it.title ?? "").includes(w));
    console.log(`   · ${w} (${n}건)  예: ${(ex?.title ?? "").slice(0, 34)}`);
  }

  line("═");
  console.log(`이 결과를 캡처하거나 파일(logs/keyword-report.txt)을 올려 주시면`);
  console.log(`키워드를 다듬어 확정하겠습니다.`);
}

main().catch((e) => { console.error(e); process.exit(1); });
