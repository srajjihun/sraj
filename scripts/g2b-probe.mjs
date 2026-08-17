// 나라장터 입찰공고정보서비스(BidPublicInfoService) 응답 구조 확인용 진단 스크립트.
//
// 이 저장소의 수집기를 짜려면 API가 실제로 어떤 필드명으로 응답하는지 알아야 한다.
// GitHub 서버(해외 IP)에서는 apis.data.go.kr 접속이 차단되므로 이 PC에서 한 번 돌려
// 필드 목록과 샘플 1건을 확인한다.
//
// ── 사용법 ──
//   1) 공공데이터포털 마이페이지에서 "일반 인증키(Decoding)" 를 복사
//   2) 명령 프롬프트에서:
//        set G2B_SERVICE_KEY=여기에인증키
//        node scripts\g2b-probe.mjs
//   3) 화면에 나온 요약을 그대로 붙여넣으면 된다.
//      전체 응답은 logs\g2b-probe.json 에 저장된다 (logs/ 는 git에 안 올라감).
//
//   업무구분을 바꿔서 보고 싶으면 인자로 넘긴다:
//        node scripts\g2b-probe.mjs 물품
//        node scripts\g2b-probe.mjs 공사

import { mkdir, writeFile } from "node:fs/promises";

const BASE = "https://apis.data.go.kr/1230000/ad/BidPublicInfoService";

// 업무구분별 "나라장터 검색조건에 의한 입찰공고조회" 오퍼레이션
const OPERATIONS = {
  용역: "getBidPblancListInfoServcPPSSrch",
  물품: "getBidPblancListInfoThngPPSSrch",
  공사: "getBidPblancListInfoCnstwkPPSSrch",
  외자: "getBidPblancListInfoFrgcptPPSSrch",
};

const OUT_PATH = new URL("../logs/g2b-probe.json", import.meta.url);

// 인증키에는 Encoding/Decoding 두 종류가 있고 섞어 쓰면 SERVICE_KEY_IS_NOT_REGISTERED_ERROR
// 가 난다. 이미 %2B 같은 이스케이프가 들어 있으면 Encoding 키이므로 그대로 쓰고,
// 아니면 Decoding 키이므로 여기서 인코딩해준다.
function encodeKey(key) {
  const looksEncoded = /%[0-9A-Fa-f]{2}/.test(key);
  return looksEncoded ? key : encodeURIComponent(key);
}

// "YYYYMMDDHHMM" — API가 요구하는 조회일시 형식
function stamp(date) {
  const p = (n) => String(n).padStart(2, "0");
  return `${date.getFullYear()}${p(date.getMonth() + 1)}${p(date.getDate())}${p(date.getHours())}${p(date.getMinutes())}`;
}

function buildUrl(operation, key, bgn, end) {
  // serviceKey 는 인코딩 상태를 직접 제어해야 해서 URLSearchParams 를 쓰지 않는다.
  const params = [
    `serviceKey=${encodeKey(key)}`,
    "pageNo=1",
    "numOfRows=10",
    "inqryDiv=1", // 1 = 공고게시일시 기준
    `inqryBgnDt=${bgn}`,
    `inqryEndDt=${end}`,
    "type=json",
  ];
  return `${BASE}/${operation}?${params.join("&")}`;
}

// 응답의 items 는 배열이거나 { item: [...] } 이거나 { item: {...} } 일 수 있다.
function extractItems(body) {
  const items = body?.items;
  if (Array.isArray(items)) return items;
  if (Array.isArray(items?.item)) return items.item;
  if (items?.item) return [items.item];
  return [];
}

// 값이 있는 필드만 남겨서 보여준다 (빈 문자열 필드가 많아 그대로 찍으면 읽기 어렵다)
function nonEmpty(item) {
  return Object.fromEntries(
    Object.entries(item).filter(([, v]) => v !== null && v !== undefined && String(v).trim() !== "")
  );
}

async function main() {
  const key = process.env.G2B_SERVICE_KEY?.trim();
  if (!key) {
    console.error("[오류] 인증키가 없습니다.");
    console.error("       공공데이터포털 마이페이지의 '일반 인증키(Decoding)' 를 복사한 뒤:");
    console.error("         set G2B_SERVICE_KEY=여기에인증키");
    console.error("         node scripts\\g2b-probe.mjs");
    process.exit(1);
  }

  const kind = process.argv[2] || "용역";
  const operation = OPERATIONS[kind];
  if (!operation) {
    console.error(`[오류] 알 수 없는 업무구분: ${kind} (가능: ${Object.keys(OPERATIONS).join(", ")})`);
    process.exit(1);
  }

  const now = new Date();
  const end = stamp(now);
  const bgn = stamp(new Date(now.getTime() - 3 * 86400000)); // 최근 3일
  const url = buildUrl(operation, key, bgn, end);

  console.log(`[조회] ${kind} · ${operation}`);
  console.log(`[기간] ${bgn} ~ ${end}`);

  const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0 (compatible; g2b-probe/1.0)" } });
  const text = await res.text();

  await mkdir(new URL("../logs/", import.meta.url), { recursive: true });
  await writeFile(OUT_PATH, text, "utf8");
  console.log(`[저장] logs/g2b-probe.json (${text.length.toLocaleString()} bytes)\n`);

  let json;
  try {
    json = JSON.parse(text);
  } catch {
    // 인증 오류 등은 type=json 을 줘도 XML 로 돌아오는 경우가 많다.
    console.log("── JSON 파싱 실패 · 원문 앞부분 ──");
    console.log(text.slice(0, 800));
    return;
  }

  // 게이트웨이 레벨 오류 (인증키 문제 등)
  const gwErr = json.OpenAPI_ServiceResponse?.cmmMsgHeader;
  if (gwErr) {
    console.log("── 인증/게이트웨이 오류 ──");
    console.log(`  ${gwErr.errMsg} (${gwErr.returnAuthMsg})`);
    console.log("\n  키를 방금 발급받았다면 반영에 1시간 정도 걸립니다.");
    console.log("  계속 같은 오류면 Decoding 키가 맞는지, 해당 서비스가 승인됐는지 확인하세요.");
    return;
  }

  const header = json.response?.header ?? {};
  const body = json.response?.body ?? {};
  console.log(`── 응답 헤더 ──`);
  console.log(`  resultCode: ${header.resultCode}  resultMsg: ${header.resultMsg}`);
  console.log(`  totalCount: ${body.totalCount}\n`);

  const items = extractItems(body);
  if (!items.length) {
    console.log("조회된 공고가 0건입니다. 기간을 늘려서 다시 시도해보세요.");
    return;
  }

  const first = items[0];
  const keys = Object.keys(first);
  console.log(`── 필드 ${keys.length}개 ──`);
  console.log(keys.join(", "));

  // 3단계(공고문·과업지시서 채점)가 가능한지 여기서 판가름난다.
  const fileKeys = keys.filter((k) => /url|file|doc|atch/i.test(k));
  console.log(`\n── 첨부파일/URL 로 보이는 필드 ${fileKeys.length}개 ──`);
  console.log(fileKeys.length ? fileKeys.join(", ") : "(없음)");

  console.log(`\n── 샘플 1건 (값이 있는 필드만) ──`);
  console.log(JSON.stringify(nonEmpty(first), null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
