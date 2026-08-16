// 나라장터 입찰공고 + 사전규격 수집기.
//
// 흐름:
//   ① API에서 최근 N일 공고를 받아 원본 저장소(data/g2b/raw/)에 누적
//      — 키워드와 무관하게 전부 저장하므로, 나중에 키워드를 바꿔도
//        재수집 없이 과거분에 소급 적용됩니다.
//   ② 키워드(config/g2b-keywords.md)로 걸러 data/g2b/posts.json 생성
//   ③ build-page.mjs 가 이 파일을 g2b.html 에 심어 g2b-live.html 을 만듭니다.
//
// 사용법 (PC, 한국 IP 필요):
//   set G2B_SERVICE_KEY=공공데이터포털_일반인증키
//   node scripts\g2b\collect.mjs        ← 최근 3일 (매일 아침용)
//   node scripts\g2b\collect.mjs 30     ← 최근 30일 (첫 실행·백필용)
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { fetchAll, stamp } from "./lib/api.mjs";
import { normalizeBid, normalizePrespec } from "./lib/normalize.mjs";
import { loadKeywords, matchGroups, isExcluded } from "./lib/keywords.mjs";

const DATA_DIR = new URL("../../data/g2b/", import.meta.url);
const RAW_BID = new URL("raw/bid.json", DATA_DIR);
const RAW_PRE = new URL("raw/prespec.json", DATA_DIR);
const OUT = new URL("posts.json", DATA_DIR);

// 수집 대상 업무구분. 물품·공사를 추가하려면 주석을 해제하세요.
const BID_OPS = {
  용역: "getBidPblancListInfoServcPPSSrch",
  // 물품: "getBidPblancListInfoThngPPSSrch",
  // 공사: "getBidPblancListInfoCnstwkPPSSrch",
};
const PRE_OP = "getPublicPrcureThngInfoServcPPSSrch"; // 사전규격 · 용역

// 참가제한지역: 00=전국(지역제한 없음), 11=서울특별시 — 서버에서 걸러 받습니다.
const REGIONS = ["00", "11"];

const DEFAULT_DAYS = 3;
const WINDOW_DAYS = 30; // 조회범위 제한(1개월)에 맞춰 창을 쪼갭니다
const DEADLINE_GRACE_DAYS = 1; // 마감 후 이만큼 지나면 목록에서 정리
const MAX_AGE_DAYS = 30; // 마감일을 모르는 건 등록일 기준으로 정리
const PRE_LINGER_DAYS = 7; // 의견마감 후 이만큼 지난 사전규격은 정리

async function loadJson(url, fallback) {
  try {
    return JSON.parse(await readFile(url, "utf8"));
  } catch (err) {
    if (err.code === "ENOENT") return fallback;
    throw err;
  }
}

async function saveJson(url, value) {
  await mkdir(new URL("./", url), { recursive: true });
  await writeFile(url, JSON.stringify(value) + "\n", "utf8");
}

// 조회 기간을 30일 이하 창으로 쪼갭니다 (API의 1개월 제한 대응).
function windows(days, now = new Date()) {
  const out = [];
  let end = now;
  let remain = days;
  while (remain > 0) {
    const span = Math.min(remain, WINDOW_DAYS);
    const begin = new Date(end.getTime() - span * 86400000);
    out.push({ bgn: stamp(begin), end: stamp(end, true) });
    end = begin;
    remain -= span;
  }
  return out;
}

function daysSince(dateStr, now) {
  const t = Date.parse(dateStr);
  if (Number.isNaN(t)) return null;
  return (now.getTime() - t) / 86400000;
}

async function collectBids(days) {
  const store = await loadJson(RAW_BID, {});
  let added = 0;

  for (const [kind, op] of Object.entries(BID_OPS)) {
    for (const region of REGIONS) {
      for (const w of windows(days)) {
        const label = `${kind}·지역${region} ${w.bgn.slice(4, 8)}`;
        const items = await fetchAll("BID", op, {
          inqryDiv: 1, // 공고게시일시 기준
          inqryBgnDt: w.bgn,
          inqryEndDt: w.end,
          prtcptLmtRgnCd: region,
        }, { label });

        for (const raw of items) {
          const it = normalizeBid(raw, kind);
          if (!it.bidNo || !it.title) continue;
          const prev = store[it.bidNo];
          // 정정공고로 값이 바뀌면 갱신하되 firstSeenAt 은 유지합니다.
          store[it.bidNo] = { ...prev, ...it, firstSeenAt: prev?.firstSeenAt ?? new Date().toISOString() };
          if (!prev) added += 1;
        }
        console.log(`  ${label}: ${items.length}건`);
      }
    }
  }

  await saveJson(RAW_BID, store);
  return { store, added };
}

async function collectPrespecs(days) {
  const store = await loadJson(RAW_PRE, {});
  let added = 0;

  for (const w of windows(days)) {
    const items = await fetchAll("PRESPEC", PRE_OP, {
      inqryDiv: 1, // 접수일시 기준
      inqryBgnDt: w.bgn,
      inqryEndDt: w.end,
    }, { label: `사전규격 ${w.bgn.slice(4, 8)}` });

    for (const raw of items) {
      const it = normalizePrespec(raw);
      if (!it.bidNo || !it.title) continue;
      const prev = store[it.bidNo];
      store[it.bidNo] = { ...prev, ...it, firstSeenAt: prev?.firstSeenAt ?? new Date().toISOString() };
      if (!prev) added += 1;
    }
    console.log(`  사전규격: ${items.length}건`);
  }

  await saveJson(RAW_PRE, store);
  return { store, added };
}

// 원본 저장소 → 키워드 필터 → 화면용 posts.json
export function buildPosts(bidStore, preStore, config, now = new Date()) {
  const posts = [];
  for (const it of Object.values(bidStore)) {
    if (isExcluded(it, config)) continue;
    const kw = matchGroups(it, config);
    if (!kw.length) continue;

    // 마감 지난 공고 정리 (마감을 모르면 등록일 기준)
    const ref = it.deadline || null;
    const age = ref ? daysSince(ref, now) : daysSince(it.date, now);
    if (age !== null && age > (ref ? DEADLINE_GRACE_DAYS : MAX_AGE_DAYS)) continue;

    posts.push({ ...it, kw });
  }

  const prespecs = [];
  for (const it of Object.values(preStore)) {
    if (isExcluded(it, config)) continue;
    const kw = matchGroups(it, config);
    if (!kw.length) continue;
    if (it.bidNtceNoList.length) continue; // 정식 공고로 전환된 건은 공고 쪽에서 보임
    const age = daysSince(it.deadline || it.date, now);
    if (age !== null && age > PRE_LINGER_DAYS) continue;
    prespecs.push({ ...it, kw });
  }

  posts.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  prespecs.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  return { posts, prespecs };
}

async function main() {
  const days = Number(process.argv[2]) || DEFAULT_DAYS;
  console.log(`[수집] 최근 ${days}일 · 업무구분 ${Object.keys(BID_OPS).join(",")} · 지역 전국+서울`);

  const config = await loadKeywords();
  const groupNames = Object.keys(config.groups);
  console.log(`[키워드] ${groupNames.map((g) => `${g}(${config.groups[g].length})`).join(" · ")}`);

  const failures = [];
  let bidStore = await loadJson(RAW_BID, {});
  let preStore = await loadJson(RAW_PRE, {});

  try {
    ({ store: bidStore } = await collectBids(days));
  } catch (err) {
    console.error(`[경고] 입찰공고 수집 실패: ${err.message}`);
    failures.push("입찰공고");
  }
  try {
    ({ store: preStore } = await collectPrespecs(days));
  } catch (err) {
    console.error(`[경고] 사전규격 수집 실패: ${err.message}`);
    failures.push("사전규격");
  }

  // 이전 posts.json 의 firstSeenAt 보존은 raw 저장소가 담당하므로 여기선 그대로 씁니다.
  const { posts, prespecs } = buildPosts(bidStore, preStore, config);

  await saveJson(OUT, {
    generatedAt: new Date().toISOString(),
    keywordGroups: groupNames,
    failures,
    posts,
    prespecs,
  });

  console.log(
    `[완료] 공고 ${posts.length}건 · 사전규격 ${prespecs.length}건 ` +
      `(원본 보관 ${Object.keys(bidStore).length + Object.keys(preStore).length}건)`
  );
  if (failures.length) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
