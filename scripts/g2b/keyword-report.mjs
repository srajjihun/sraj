// 제안 키워드를 PC에 저장된 원본 공고 전체에 적용해 보는 검증 리포트입니다.
//
// config/g2b-keywords.md 를 건드리지 않고, 아래 PROPOSED(제안안)를
// data/g2b/raw/ 의 실제 수집 원본에 돌려 결과를 보여줍니다.
//   - 그룹별로 몇 건이 잡히는지 + 실제 제목 샘플
//   - 제외어가 몇 건을 걸러내는지 + 아깝게 죽은 것이 있는지
//   - 아무 키워드에도 안 걸린 공고 샘플 (놓친 시장 후보)
//
// 실행: 키워드-검증.bat 더블클릭 (또는 node scripts\g2b\keyword-report.mjs)
import { readFile } from "node:fs/promises";

const RAW_BID = new URL("../../data/g2b/raw/bid.json", import.meta.url);
const RAW_PRE = new URL("../../data/g2b/raw/prespec.json", import.meta.url);

/* ── 제안안 (2026-08-17 · 회사소개서·이력서·추진계획 기반) ── */
const PROPOSED = {
  groups: {
    "창업지원": ["창업","스타트업","벤처","소셜벤처","액셀러","엑셀러","인큐베이","보육","데모데이","멘토링","IR"],
    "크라우드펀딩·시제품": ["크라우드펀딩","펀딩","시제품"],
    "판로·커머스": ["판로","입점","라이브커머스","이커머스","쇼핑몰","온라인몰","셀러","수출바우처","해외진출","상세페이지","소상공인","소상인","상권","전통시장","팝업스토어","플리마켓"],
    "마케팅·홍보": ["홍보","마케팅","서포터즈","공모전","바이럴","인플루언서","SNS","브랜드"],
    "콘텐츠·영상": ["영상","콘텐츠","촬영","중계","송출","크리에이터","숏폼"],
    "행사·포럼": ["대행","박람회","전시회","페스티벌","축제","포럼","세미나","컨퍼런스","심포지엄","설명회","상담회","해커톤","캠프","시상식"],
    "교육·일자리": ["아카데미","양성","교육과정","특강","부트캠프","일자리","취업","진로"],
    "AX·디지털": ["인공지능","생성형","AX","디지털전환","디지털 전환"],
  },
  exclude: [
    "청소용역","청소 용역","환경미화",
    "경비","급식","방역","폐기물","시설관리",
    "시설","공사","설계","감리","유지보수","유지관리","개선",
    "조경","전기","통신","소방","건축","토목","도로",
    "정비","보수","철거","임차","구매","납품",
    "CCTV","영상정보","관제","영상감시",
    "인쇄","시스템",
  ],
};

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

  line("═");
  console.log(`이 결과를 캡처하거나 파일(logs/keyword-report.txt)을 올려 주시면`);
  console.log(`키워드를 다듬어 확정하겠습니다.`);
}

main().catch((e) => { console.error(e); process.exit(1); });
