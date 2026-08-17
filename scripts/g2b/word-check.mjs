// 단어 하나가 키워드로 쓸 만한지 PC에 저장된 원본 전체에서 세어봅니다.
//
// "이 단어 넣어야 되나?" 를 추측이 아니라 숫자로 답하기 위한 도구입니다.
// 수집 데이터도 화면도 바꾸지 않고, API도 부르지 않습니다.
//
// 실행: 단어확인.bat 더블클릭
//       또는 node scripts\g2b\word-check.mjs 판촉 광고 유통
import { readFile } from "node:fs/promises";
import { loadKeywords, excludedBy as excludedByConfig } from "./lib/keywords.mjs";

const RAW_BID = new URL("../../data/g2b/raw/bid.json", import.meta.url);
const RAW_PRE = new URL("../../data/g2b/raw/prespec.json", import.meta.url);

const CONFIG = await loadKeywords();

async function loadStore(url, name) {
  try {
    return Object.values(JSON.parse(await readFile(url, "utf8")));
  } catch {
    console.log(`[안내] ${name} 원본이 없습니다. G2B-설치.bat 을 먼저 실행해 주세요.`);
    return [];
  }
}

function hay(it) {
  return `${it.title ?? ""} ${it.category ?? ""} ${it.categoryMid ?? ""} ${it.categoryLarge ?? ""}`;
}

// 검사 중인 단어는 빼고 매칭합니다.
// 이미 설정에 든 단어를 검사할 때 자기 자신이 잡은 걸 "다른 키워드가 이미 잡음"
// 으로 세면 증가분이 항상 0이 되어 버립니다. 그러면 "이 단어를 빼면 무엇을
// 잃는가"라는 진짜 질문에 답할 수 없습니다.
function matchedGroups(it, ignore) {
  const h = hay(it);
  return Object.entries(CONFIG.groups)
    .filter(([, ws]) => ws.some((w) => w !== ignore && h.includes(w)))
    .map(([g]) => g);
}

// 제외 예외(기관명 등)까지 반영하려면 수집기와 같은 판정을 써야 합니다.
function excludedBy(it) {
  return excludedByConfig(it, CONFIG);
}

function sample(arr, n) {
  if (arr.length <= n) return arr;
  const step = arr.length / n;
  return Array.from({ length: n }, (_, i) => arr[Math.floor(i * step)]);
}

const line = (c = "─") => console.log(c.repeat(64));

// 이미 설정에 들어 있는 단어인지
function whereUsed(word) {
  for (const [g, ws] of Object.entries(CONFIG.groups)) {
    if (ws.includes(word)) return `수집 키워드 [${g}]`;
  }
  if (CONFIG.exclude.includes(word)) return "제외 키워드";
  return null;
}

function report(word, all) {
  const hits = all.filter((it) => hay(it).includes(word));

  console.log(`\n\n■ "${word}"`);
  line("═");

  const used = whereUsed(word);
  if (used) {
    console.log(`   ※ 지금 ${used} 에 들어 있습니다`);
    console.log(`     — 아래 "이 단어라야 잡힘"은 이 단어를 빼면 잃게 될 공고입니다`);
  }

  if (!hits.length) {
    console.log(`   전체 ${all.length}건 중 0건. 넣어도 아무것도 안 잡힙니다.`);
    return;
  }

  // 이 단어가 나온 공고를 셋으로 나눕니다.
  //   지금도 잡힘 — 다른 키워드가 이미 잡고 있어 추가해도 새로 늘지 않음
  //   제외어에 걸림 — 넣어도 어차피 버려짐
  //   새로 잡힘   — 이 단어를 넣어야만 들어오는 진짜 증가분
  const excluded = [];
  const already = [];
  const fresh = [];
  for (const it of hits) {
    const ex = excludedBy(it);
    if (ex.length) excluded.push({ it, ex });
    else if (matchedGroups(it, word).length) already.push(it);
    else fresh.push(it);
  }

  const pct = (n) => `${Math.round((n / hits.length) * 100)}%`;
  console.log(`   전체 ${all.length}건 중 ${hits.length}건에 등장`);
  console.log(`     · 제외어에 걸려 버려짐 : ${String(excluded.length).padStart(5)}건 (${pct(excluded.length)})`);
  console.log(`     · 다른 키워드가 이미 잡음: ${String(already.length).padStart(5)}건 (${pct(already.length)})`);
  console.log(`     · 이 단어라야 잡힘      : ${String(fresh.length).padStart(5)}건 (${pct(fresh.length)})  ← 실제 증가분`);

  if (fresh.length) {
    console.log(`\n   ▼ 이 단어를 넣으면 새로 들어올 공고 — 우리 일이 맞는지 봐 주세요`);
    for (const it of sample(fresh, 12)) console.log(`   · ${(it.title ?? "").slice(0, 52)}`);
  } else {
    console.log(`\n   새로 들어올 공고가 없습니다. 넣을 이유가 없습니다.`);
  }

  if (excluded.length) {
    const why = new Map();
    for (const { ex } of excluded) why.set(ex[0], (why.get(ex[0]) ?? 0) + 1);
    const top = [...why.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6);
    console.log(`\n   버려진 이유: ${top.map(([w, n]) => `${w}(${n})`).join(" · ")}`);
  }
}

async function main() {
  const words = process.argv.slice(2).filter(Boolean);
  if (!words.length) {
    console.log("사용법: node scripts\\g2b\\word-check.mjs 판촉 광고 유통");
    return;
  }

  const bids = await loadStore(RAW_BID, "입찰공고");
  const pres = await loadStore(RAW_PRE, "사전규격");
  const all = [...bids, ...pres];
  if (!all.length) return;

  console.log(`단어 검사 · 원본 입찰공고 ${bids.length}건 + 사전규격 ${pres.length}건 = ${all.length}건`);
  for (const w of words) report(w, all);

  console.log();
  line("═");
  console.log("증가분이 적거나 새로 들어온 게 우리 일이 아니면 넣지 마세요.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
