// 나라장터(g2b.go.kr) 입찰공고를 조달청 OpenAPI로 수집해 data/g2b-posts.json에 누적 저장한다.
//
// 사용하는 API: 조달청_나라장터 입찰공고정보서비스 (BidPublicInfoService)
//   오퍼레이션: get...PPSSrch = "나라장터 검색조건에 의한 입찰공고조회"
//   나라장터 검색화면의 조건(공고명/지역/업종/추정가격)을 서버에서 걸러 받을 수 있어,
//   전량을 받아 로컬에서 거르는 것보다 호출 수를 크게 아낀다.
//   (개발계정은 오퍼레이션당 하루 1,000회 제한)
//
// ── 인증키 ──
// 커밋하면 안 되므로 환경변수로 받는다. collect.bat 에서 설정하거나:
//   set G2B_SERVICE_KEY=공공데이터포털_일반인증키
//   node scripts\g2b-monitor.mjs
//
// ── 백필 ──
// 과거 공고를 채우려면 조회 일수를 인자로 넘긴다 (API 제한상 최대 1개월):
//   node scripts\g2b-monitor.mjs 30
import { readFile, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { pruneByDeadlineOrAge } from "./lib/prune.mjs";
import { filterExcluded } from "./lib/exclude.mjs";

const DATA_PATH = new URL("../data/g2b-posts.json", import.meta.url);
const BASE = "https://apis.data.go.kr/1230000/ad/BidPublicInfoService";

// ── 수집 대상 업무구분 ──
// 빼고 싶으면 해당 줄을 지운다. (외자는 기본 제외)
const KINDS = {
  용역: "getBidPblancListInfoServcPPSSrch",
  물품: "getBidPblancListInfoThngPPSSrch",
  공사: "getBidPblancListInfoCnstwkPPSSrch",
};

// ── 제목 키워드 필터 ──
// 비워두면(=[]) 전부 수집한다. 단어를 넣으면 공고명에 그 단어가 있는 건만 남긴다.
// 예: ["행사", "축제", "박람회", "홍보", "컨설팅"]
const KEYWORDS = [];

const LOOKBACK_DAYS = 3; // 기본 조회 기간 (인자로 덮어쓸 수 있음)
const ROWS = 100; // 한 페이지 결과 수
const MAX_PAGES = 60; // 업무구분당 최대 페이지 (안전장치)
const DEADLINE_GRACE_DAYS = 1; // 입찰마감 후 이만큼 지나면 정리
const MAX_AGE_DAYS = 30; // 마감일을 못 읽은 건은 등록일 기준으로 정리

// 인증키에는 Encoding/Decoding 두 종류가 있고 섞어 쓰면 SERVICE_KEY_IS_NOT_REGISTERED_ERROR
// 가 난다. 이미 %2B 같은 이스케이프가 있으면 Encoding 키이므로 그대로,
// 아니면 Decoding 키이므로 여기서 인코딩한다.
function encodeKey(key) {
  return /%[0-9A-Fa-f]{2}/.test(key) ? key : encodeURIComponent(key);
}

// "YYYYMMDDHHMM" — API가 요구하는 조회일시 형식
function stamp(date) {
  const p = (n) => String(n).padStart(2, "0");
  return `${date.getFullYear()}${p(date.getMonth() + 1)}${p(date.getDate())}${p(date.getHours())}${p(date.getMinutes())}`;
}

function listUrl(operation, key, bgn, end, pageNo) {
  // serviceKey는 인코딩 상태를 직접 제어해야 해서 URLSearchParams를 쓰지 않는다.
  const params = [
    `serviceKey=${encodeKey(key)}`,
    `pageNo=${pageNo}`,
    `numOfRows=${ROWS}`,
    "inqryDiv=1", // 1 = 공고게시일시 기준
    `inqryBgnDt=${bgn}`,
    `inqryEndDt=${end}`,
    "type=json",
  ];
  return `${BASE}/${operation}?${params.join("&")}`;
}

// items는 배열이거나 { item: [...] } 이거나 { item: {...} } 일 수 있다.
function extractItems(body) {
  const items = body?.items;
  if (Array.isArray(items)) return items;
  if (Array.isArray(items?.item)) return items.item;
  if (items?.item) return [items.item];
  return [];
}

function text(v) {
  const s = v === null || v === undefined ? "" : String(v).trim();
  return s;
}

function num(v) {
  const s = text(v).replace(/,/g, "");
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

// "2026-08-25 11:00:00" -> { date: "2026-08-25", time: "11:00" }
function splitDt(v) {
  const m = /^(\d{4}-\d{2}-\d{2})(?:[ T](\d{2}:\d{2}))?/.exec(text(v));
  return m ? { date: m[1], time: m[2] ?? "" } : { date: "", time: "" };
}

// 첨부파일: ntceSpecFileNm1~10 / ntceSpecDocUrl1~10 을 짝지어 모은다.
function collectFiles(raw) {
  const files = [];
  for (let i = 1; i <= 10; i += 1) {
    const name = text(raw[`ntceSpecFileNm${i}`]);
    const url = text(raw[`ntceSpecDocUrl${i}`]);
    if (name && url) files.push({ name, url });
  }
  return files;
}

// API 원본 레코드(113개 필드)에서 화면과 평가에 쓰는 것만 추린다.
function normalize(raw, kind) {
  const notice = splitDt(raw.bidNtceDt);
  const close = splitDt(raw.bidClseDt);
  const opening = splitDt(raw.opengDt);

  return {
    bidNo: `${text(raw.bidNtceNo)}-${text(raw.bidNtceOrd) || "000"}`,
    kind,
    title: text(raw.bidNtceNm),
    org: text(raw.dminsttNm) || text(raw.ntceInsttNm), // 수요기관 우선
    noticeOrg: text(raw.ntceInsttNm),
    date: notice.date,
    deadline: close.date,
    deadlineTime: close.time,
    opening: opening.date ? `${opening.date} ${opening.time}`.trim() : "",
    qlfctRgstDt: text(raw.bidQlfctRgstDt), // 입찰참가자격 등록마감일시

    price: num(raw.presmptPrce), // 추정가격
    budget: num(raw.asignBdgtAmt), // 배정예산

    method: text(raw.cntrctCnclsMthdNm), // 일반경쟁 / 제한경쟁 / 수의계약
    winnerMethod: text(raw.sucsfbidMthdNm), // 협상에의한계약 / 적격심사제 …
    techRate: num(raw.techAbltEvlRt), // 기술능력평가 배점비율
    priceRate: num(raw.bidPrceEvlRt), // 입찰가격평가 배점비율

    arsltCmpt: text(raw.arsltCmptYn) === "Y", // 실적경쟁 여부
    indstrytyLmt: text(raw.indstrytyLmtYn) === "Y", // 업종(면허)제한 여부
    prtcptLmt: text(raw.bidPrtcptLmtYn) === "Y", // 참가제한 여부

    // 조달 표준 분류 — 공고명 키워드보다 정확한 분야 매칭에 쓴다
    categoryNo: text(raw.pubPrcrmntClsfcNo),
    category: text(raw.pubPrcrmntClsfcNm),
    categoryLarge: text(raw.pubPrcrmntLrgClsfcNm),

    files: collectFiles(raw),
    url: text(raw.bidNtceDtlUrl) || text(raw.bidNtceUrl),
  };
}

function matchesKeyword(item) {
  if (!KEYWORDS.length) return true;
  const haystack = `${item.title} ${item.category} ${item.categoryLarge}`;
  return KEYWORDS.some((kw) => haystack.includes(kw));
}

async function loadExisting() {
  try {
    return JSON.parse(await readFile(DATA_PATH, "utf8"));
  } catch (err) {
    if (err.code === "ENOENT") return [];
    throw err;
  }
}

// 한 업무구분을 끝까지 훑어 정규화된 항목 배열을 돌려준다.
async function fetchKind(kind, operation, key, bgn, end) {
  const collected = [];

  for (let pageNo = 1; pageNo <= MAX_PAGES; pageNo += 1) {
    const res = await fetch(listUrl(operation, key, bgn, end, pageNo), {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; g2b-monitor-bot/1.0)" },
    });
    if (!res.ok) throw new Error(`${kind} 요청 실패 (page=${pageNo}): HTTP ${res.status}`);

    const body = await res.text();
    let json;
    try {
      json = JSON.parse(body);
    } catch {
      // 인증 오류 등은 type=json 을 줘도 XML로 돌아온다.
      throw new Error(`${kind} 응답을 JSON으로 읽지 못했습니다: ${body.slice(0, 200)}`);
    }

    const gwErr = json.OpenAPI_ServiceResponse?.cmmMsgHeader;
    if (gwErr) {
      throw new Error(`${kind} 인증 오류: ${gwErr.errMsg} (${gwErr.returnAuthMsg})`);
    }

    const header = json.response?.header ?? {};
    if (text(header.resultCode) !== "00") {
      throw new Error(`${kind} API 오류: ${header.resultCode} ${header.resultMsg}`);
    }

    const items = extractItems(json.response?.body);
    if (!items.length) break;

    for (const raw of items) collected.push(normalize(raw, kind));

    const total = num(json.response?.body?.totalCount) ?? 0;
    if (pageNo * ROWS >= total) break;
  }

  return collected;
}

async function main() {
  const key = process.env.G2B_SERVICE_KEY?.trim();
  if (!key) {
    throw new Error(
      "인증키가 없습니다. 공공데이터포털 일반 인증키를 환경변수로 설정하세요:\n" +
        "  set G2B_SERVICE_KEY=여기에인증키"
    );
  }

  const days = Number(process.argv[2]) || LOOKBACK_DAYS;
  const now = new Date();
  const end = stamp(now);
  const bgn = stamp(new Date(now.getTime() - days * 86400000));

  const existing = await loadExisting();
  const seen = new Map(existing.map((item) => [item.bidNo, item]));
  const seenAt = new Date().toISOString();
  let addedCount = 0;
  let fetchedCount = 0;
  const failed = [];

  for (const [kind, operation] of Object.entries(KINDS)) {
    let items;
    try {
      items = await fetchKind(kind, operation, key, bgn, end);
    } catch (err) {
      // 한 업무구분이 실패해도 나머지는 계속 수집한다.
      console.error(`[경고] ${err.message}`);
      failed.push(kind);
      continue;
    }
    fetchedCount += items.length;

    for (const item of items) {
      if (!item.bidNo || !item.title) continue;
      if (!matchesKeyword(item)) continue;

      const prev = seen.get(item.bidNo);
      if (prev) {
        // 정정공고로 마감일·금액이 바뀌면 갱신하되 firstSeenAt은 유지
        seen.set(item.bidNo, { ...prev, ...item });
        continue;
      }
      seen.set(item.bidNo, { ...item, firstSeenAt: seenAt });
      addedCount += 1;
    }
  }

  const merged = [...seen.values()].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  const filtered = filterExcluded(merged, "g2b");
  const pruned = pruneByDeadlineOrAge(filtered, {
    deadlineField: "deadline",
    dateField: "date",
    graceDays: DEADLINE_GRACE_DAYS,
    maxAgeDays: MAX_AGE_DAYS,
  });

  await writeFile(DATA_PATH, JSON.stringify(pruned, null, 2) + "\n", "utf8");

  console.log(
    `총 ${pruned.length}건 저장 ` +
      `(조회 ${fetchedCount}건, 신규 ${addedCount}건, ` +
      `제외 ${merged.length - filtered.length}건, 정리 ${filtered.length - pruned.length}건)`
  );
  if (failed.length) {
    console.error(`[경고] 실패한 업무구분: ${failed.join(", ")}`);
    process.exitCode = 1;
  }
}

// 직접 실행됐을 때만 main() 호출 (Windows 경로도 처리되도록 pathToFileURL 사용)
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
}

export { normalize, extractItems, collectFiles, splitDt, encodeKey };
