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
const PROGRESS = new URL("raw/progress.json", DATA_DIR);
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
//
// 짧은 기간(매일 아침 실행)은 오늘 기준으로 거슬러 올라가는 창 하나면 됩니다.
// 긴 백필은 다릅니다. 개발계정은 오퍼레이션당 하루 1,000회까지만 부를 수 있어
// 1년치를 하루에 다 받을 수 없고, 며칠에 나눠 받아야 합니다. 그래서 창 경계를
// "오늘 기준"이 아니라 달력의 월 경계에 맞춥니다 — 그래야 어제 받은 구간과
// 오늘 받을 구간의 이름이 같아져서 "이미 받은 달"을 건너뛸 수 있습니다.
//
// resumable=false 인 창은 아직 끝나지 않은 이번 달이라 매번 다시 받습니다.
export function windows(days, now = new Date()) {
  if (days <= WINDOW_DAYS) {
    const begin = new Date(now.getTime() - days * 86400000);
    return [{ bgn: stamp(begin), end: stamp(now, true), resumable: false }];
  }

  const out = [];
  const earliest = new Date(now.getTime() - days * 86400000);
  let y = now.getFullYear();
  let m = now.getMonth();
  for (;;) {
    const first = new Date(y, m, 1);
    const last = new Date(y, m + 1, 0); // 그 달의 말일
    const end = last > now ? now : last;
    out.push({ bgn: stamp(first), end: stamp(end, true), resumable: last <= now });
    if (first <= earliest) break;
    m -= 1;
    if (m < 0) {
      m = 11;
      y -= 1;
    }
  }
  return out;
}

function daysSince(dateStr, now) {
  const t = Date.parse(dateStr);
  if (Number.isNaN(t)) return null;
  return (now.getTime() - t) / 86400000;
}

// nkoneps resultCode "07" = 입력범위값 초과. 과거로 갈수록 반복해서 나면
// (창 크기가 아니라) 이 오퍼레이션이 조회를 허용하는 과거 기간의 한계에
// 도달했다는 뜻이다. 재시도해도 소용없고, 그 뒤로 더 과거 구간도 계속
// 같은 오류가 나므로 그 지점에서 멈추는 게 맞다.
function isRangeLimit(err) {
  return err.g2bCode === "07";
}

// 창 하나를 다 받았는지 기록하는 열쇠. 이미 끝난 달은 다시 부르지 않습니다.
function windowKey(op, region, w) {
  return `${op}|${region}|${w.bgn}`;
}

function windowDate(w) {
  return `${w.bgn.slice(0, 4)}-${w.bgn.slice(4, 6)}-${w.bgn.slice(6, 8)}`;
}

async function collectBids(days, progress) {
  const store = await loadJson(RAW_BID, {});
  let added = 0;
  let skipped = 0;
  let earliestReached = null; // 실제로 받아낸 가장 오래된 날짜 (YYYY-MM-DD)

  const note = (w) => {
    const d = windowDate(w);
    if (!earliestReached || d < earliestReached) earliestReached = d;
  };

  // 건너뛸 구간은 먼저 알립니다 — 중간에 한도가 걸려 멈춰도 보이도록.
  for (const [kind, op] of Object.entries(BID_OPS)) {
    void kind;
    for (const region of REGIONS) {
      for (const w of windows(days)) {
        if (w.resumable && progress[windowKey(op, region, w)]) skipped += 1;
      }
    }
  }
  if (skipped) console.log(`  (이미 받아둔 구간 ${skipped}개는 건너뜁니다)`);

  for (const [kind, op] of Object.entries(BID_OPS)) {
    for (const region of REGIONS) {
      for (const w of windows(days)) {
        const label = `${kind}·지역${region} ${w.bgn.slice(4, 8)}`;
        const key = windowKey(op, region, w);
        if (w.resumable && progress[key]) {
          note(w);
          continue;
        }
        let items;
        try {
          items = await fetchAll("BID", op, {
            inqryDiv: 1, // 공고게시일시 기준
            inqryBgnDt: w.bgn,
            inqryEndDt: w.end,
            prtcptLmtRgnCd: region,
          }, { label });
        } catch (err) {
          if (isRangeLimit(err)) {
            console.log(`  ${label}: 조회 가능 기간의 한계에 도달해 더 과거는 건너뜁니다`);
            break; // 이 kind·region 의 남은(더 과거) 구간은 시도해도 계속 같은 오류다
          }
          throw err; // 그 외 오류는 main()의 안전장치로 넘긴다
        }

        for (const raw of items) {
          const it = normalizeBid(raw, kind);
          if (!it.bidNo || !it.title) continue;
          const prev = store[it.bidNo];
          // 정정공고로 값이 바뀌면 갱신하되 firstSeenAt 은 유지합니다.
          store[it.bidNo] = { ...prev, ...it, firstSeenAt: prev?.firstSeenAt ?? new Date().toISOString() };
          if (!prev) added += 1;
        }
        console.log(`  ${label}: ${items.length}건`);

        // 구간마다 저장합니다. 다음 구간에서 오류가 나도 지금까지 받은 건 남습니다.
        await saveJson(RAW_BID, store);
        if (w.resumable) {
          progress[key] = new Date().toISOString();
          await saveJson(PROGRESS, progress);
        }
        note(w);
      }
    }
  }

  return { store, added, earliestReached };
}

async function collectPrespecs(days, progress) {
  const store = await loadJson(RAW_PRE, {});
  let added = 0;
  let skipped = 0;
  let earliestReached = null;

  const note = (w) => {
    const d = windowDate(w);
    if (!earliestReached || d < earliestReached) earliestReached = d;
  };

  for (const w of windows(days)) {
    if (w.resumable && progress[windowKey(PRE_OP, "-", w)]) skipped += 1;
  }
  if (skipped) console.log(`  (이미 받아둔 구간 ${skipped}개는 건너뜁니다)`);

  for (const w of windows(days)) {
    const label = `사전규격 ${w.bgn.slice(4, 8)}`;
    const key = windowKey(PRE_OP, "-", w);
    if (w.resumable && progress[key]) {
      note(w);
      continue;
    }
    let items;
    try {
      items = await fetchAll("PRESPEC", PRE_OP, {
        inqryDiv: 1, // 접수일시 기준
        inqryBgnDt: w.bgn,
        inqryEndDt: w.end,
      }, { label });
    } catch (err) {
      if (isRangeLimit(err)) {
        console.log(`  ${label}: 조회 가능 기간의 한계에 도달해 더 과거는 건너뜁니다`);
        break;
      }
      throw err;
    }

    for (const raw of items) {
      const it = normalizePrespec(raw);
      if (!it.bidNo || !it.title) continue;
      const prev = store[it.bidNo];
      store[it.bidNo] = { ...prev, ...it, firstSeenAt: prev?.firstSeenAt ?? new Date().toISOString() };
      if (!prev) added += 1;
    }
    console.log(`  ${label}: ${items.length}건`);

    await saveJson(RAW_PRE, store);
    if (w.resumable) {
      progress[key] = new Date().toISOString();
      await saveJson(PROGRESS, progress);
    }
    note(w);
  }

  return { store, added, earliestReached };
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
  const progress = await loadJson(PROGRESS, {});
  let bidStore = await loadJson(RAW_BID, {});
  let preStore = await loadJson(RAW_PRE, {});
  let earliestBid = null;
  let earliestPre = null;
  let quotaHit = false;

  // 중단되더라도 지금까지 받은 것은 이미 저장돼 있으므로 "실패"가 아니다.
  // 다만 원인에 따라 안내가 달라진다:
  //   dailyQuota — 오늘 호출 한도를 다 썼다. 자정이 지나야 풀린다.
  //   429        — 순간 속도 제한. 잠시 뒤 다시 하면 된다.
  const dailyQuota = (err) => err.dailyQuota === true;
  const rateLimited = (err) => String(err.message).includes("HTTP 429");

  const explain = (what, err) => {
    if (dailyQuota(err)) {
      quotaHit = true;
      console.log(`[안내] ${what}: 오늘 나라장터 호출 한도를 모두 사용하셨습니다.`);
      console.log(`       한도는 자정에 초기화됩니다. 내일 다시 실행하시면 받은 지점부터 이어집니다.`);
    } else if (rateLimited(err)) {
      console.log(`[안내] ${what}: 나라장터 호출 속도 제한에 걸려 여기까지 받았습니다.`);
      console.log(`       받은 데이터는 저장돼 있습니다. 잠시 뒤 다시 실행하면 이어서 받습니다.`);
    } else {
      console.error(`[경고] ${what} 수집 실패: ${err.message}`);
      failures.push(what);
    }
  };

  try {
    ({ store: bidStore, earliestReached: earliestBid } = await collectBids(days, progress));
  } catch (err) {
    explain("입찰공고", err);
    bidStore = await loadJson(RAW_BID, bidStore);
  }
  try {
    ({ store: preStore, earliestReached: earliestPre } = await collectPrespecs(days, progress));
  } catch (err) {
    explain("사전규격", err);
    preStore = await loadJson(RAW_PRE, preStore);
  }

  // 요청한 기간보다 덜 받았으면(조회 가능 기간의 한계) 정직하게 알립니다.
  const requestedFrom = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
  if (earliestBid) {
    console.log(`[범위] 입찰공고 실제 수집 범위: ${earliestBid} ~ 오늘`);
    if (earliestBid > requestedFrom) {
      const why = quotaHit
        ? "오늘 호출 한도를 다 썼습니다. 내일 다시 실행하시면 이어집니다"
        : "나라장터가 그 이전 데이터를 제공하지 않습니다";
      console.log(`       (요청한 ${requestedFrom} 까지는 못 받았습니다 — ${why})`);
    }
  }
  if (earliestPre) console.log(`[범위] 사전규격 실제 수집 범위: ${earliestPre} ~ 오늘`);

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
