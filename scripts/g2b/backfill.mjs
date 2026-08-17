// 과거 공고를 월 단위로 거슬러 올라가며 수집합니다 (원본 저장소에만 누적).
//
// 개발계정은 오퍼레이션당 하루 1,000회 제한이 있어 1년치는 한 번에 안 끝납니다.
// 그래서 진행 상태를 파일에 남기고, 다시 실행하면 멈춘 달부터 이어받습니다.
// 며칠에 걸쳐 여러 번 실행하시면 됩니다.
//
// 사용법:
//   node scripts\g2b\backfill.mjs            ← 2025-01 부터 (기본)
//   node scripts\g2b\backfill.mjs 2024-01    ← 시작 월 지정
//   node scripts\g2b\backfill.mjs --reset    ← 진행 상태 초기화 후 처음부터
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { fetchAll } from "./lib/api.mjs";
import { normalizeBid, normalizePrespec } from "./lib/normalize.mjs";

const DATA_DIR = new URL("../../data/g2b/", import.meta.url);
const RAW_BID = new URL("raw/bid.json", DATA_DIR);
const RAW_PRE = new URL("raw/prespec.json", DATA_DIR);
const STATE = new URL("backfill-state.json", DATA_DIR);

const BID_OP = "getBidPblancListInfoServcPPSSrch";
const PRE_OP = "getPublicPrcureThngInfoServcPPSSrch";
const REGIONS = ["00", "11"]; // 전국(지역제한 없음) + 서울
const DEFAULT_START = "2025-01";

// 하루 한도(오퍼레이션당 1,000회)에 여유를 두고 멈춥니다.
const CALL_BUDGET = 850;

let callsUsed = 0;

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

// "2025-01" → { bgn:"202501010000", end:"202501312359", label:"2025-01" }
function monthWindow(ym) {
  const [y, m] = ym.split("-").map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const p = (n) => String(n).padStart(2, "0");
  return { bgn: `${y}${p(m)}010000`, end: `${y}${p(m)}${p(last)}2359`, label: ym };
}

// 시작 월부터 이번 달까지의 목록 (오래된 순)
function monthsFrom(startYm) {
  const [sy, sm] = startYm.split("-").map(Number);
  const now = new Date();
  const out = [];
  let y = sy;
  let m = sm;
  while (y < now.getFullYear() || (y === now.getFullYear() && m <= now.getMonth() + 1)) {
    out.push(`${y}-${String(m).padStart(2, "0")}`);
    m += 1;
    if (m > 12) { m = 1; y += 1; }
  }
  return out;
}

function isQuotaError(err) {
  return /LIMITED_NUMBER_OF_SERVICE_REQUESTS|트래픽|초과/i.test(err.message ?? "");
}

async function collectMonth(ym, bidStore, preStore) {
  const w = monthWindow(ym);
  const seenAt = new Date().toISOString();
  let added = 0;

  for (const region of REGIONS) {
    const items = await fetchAll("BID", BID_OP, {
      inqryDiv: 1,
      inqryBgnDt: w.bgn,
      inqryEndDt: w.end,
      prtcptLmtRgnCd: region,
    }, {
      label: `${ym} 공고·지역${region}`,
      maxPages: 400,
      onPage: () => { callsUsed += 1; },
    });

    for (const raw of items) {
      const it = normalizeBid(raw, "용역");
      if (!it.bidNo || !it.title) continue;
      const prev = bidStore[it.bidNo];
      bidStore[it.bidNo] = { ...prev, ...it, firstSeenAt: prev?.firstSeenAt ?? seenAt };
      if (!prev) added += 1;
    }
  }

  const pres = await fetchAll("PRESPEC", PRE_OP, {
    inqryDiv: 1,
    inqryBgnDt: w.bgn,
    inqryEndDt: w.end,
  }, {
    label: `${ym} 사전규격`,
    maxPages: 400,
    onPage: () => { callsUsed += 1; },
  });

  for (const raw of pres) {
    const it = normalizePrespec(raw);
    if (!it.bidNo || !it.title) continue;
    const prev = preStore[it.bidNo];
    preStore[it.bidNo] = { ...prev, ...it, firstSeenAt: prev?.firstSeenAt ?? seenAt };
    if (!prev) added += 1;
  }

  return added;
}

async function main() {
  const arg = process.argv[2];
  const reset = arg === "--reset";
  const startYm = !arg || reset ? DEFAULT_START : arg;

  if (!/^\d{4}-\d{2}$/.test(startYm)) {
    throw new Error(`시작 월 형식이 잘못됐습니다: ${startYm} (예: 2025-01)`);
  }

  const state = reset ? { done: [] } : await loadJson(STATE, { done: [] });
  const bidStore = await loadJson(RAW_BID, {});
  const preStore = await loadJson(RAW_PRE, {});

  const months = monthsFrom(startYm);
  const todo = months.filter((m) => !state.done.includes(m));

  console.log(`[백필] ${startYm} ~ ${months[months.length - 1]} · 전체 ${months.length}개월`);
  console.log(`[진행] 완료 ${state.done.length}개월 · 남은 ${todo.length}개월`);
  if (!todo.length) {
    console.log(`\n모든 기간을 이미 받았습니다. 다시 받으시려면 --reset 을 붙여 실행하세요.`);
    return;
  }
  console.log(`[보관] 현재 원본 ${Object.keys(bidStore).length + Object.keys(preStore).length}건\n`);

  let quotaHit = false;
  for (const ym of todo) {
    if (callsUsed >= CALL_BUDGET) {
      console.log(`\n[중단] 오늘 사용량이 한도에 가까워 여기서 멈춥니다.`);
      quotaHit = true;
      break;
    }
    try {
      process.stdout.write(`  ${ym} … `);
      const added = await collectMonth(ym, bidStore, preStore);
      state.done.push(ym);
      await saveJson(RAW_BID, bidStore);
      await saveJson(RAW_PRE, preStore);
      await saveJson(STATE, state);
      console.log(`신규 ${added}건 (누적 호출 ${callsUsed}회)`);
    } catch (err) {
      console.log(`실패`);
      if (isQuotaError(err)) {
        console.log(`\n[중단] 오늘 API 사용 한도를 다 썼습니다.`);
        quotaHit = true;
        break;
      }
      console.error(`  [오류] ${err.message}`);
      console.log(`  이 달은 건너뛰고 계속합니다.`);
    }
  }

  const total = Object.keys(bidStore).length + Object.keys(preStore).length;
  const left = months.filter((m) => !state.done.includes(m));
  console.log(`\n[완료] 원본 ${total.toLocaleString()}건 보관 · ${state.done.length}/${months.length}개월`);

  if (left.length) {
    console.log(`\n남은 기간: ${left.length}개월 (${left[0]} ~ ${left[left.length - 1]})`);
    if (quotaHit) {
      console.log(`API 한도는 매일 자정에 초기화됩니다. 내일 1년치-수집.bat 을 다시 실행하시면`);
      console.log(`멈춘 달부터 이어받습니다.`);
    } else {
      console.log(`1년치-수집.bat 을 다시 실행하시면 이어받습니다.`);
    }
  } else {
    console.log(`\n전체 기간 수집이 끝났습니다. 키워드-검증.bat 을 실행해 보세요.`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
}
