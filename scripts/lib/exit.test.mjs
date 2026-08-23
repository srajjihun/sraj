// 실패 분류 테스트.  실행:  node scripts/lib/exit.test.mjs
//
// 이 분류가 틀리면 둘 중 하나가 된다.
//   너무 관대 -> 파싱이 깨져도 경고로 지나가 아무도 모른다
//   너무 엄격 -> 간헐적 차단으로 워크플로가 늘 빨간색이라 진짜 고장이 묻힌다
import { isTransient } from "./exit.mjs";

const fetchFailed = (code) =>
  Object.assign(new TypeError("fetch failed"), {
    cause: Object.assign(new Error(code), { code }),
  });

const httpError = (status) =>
  Object.assign(new Error(`검색 요청 실패: HTTP ${status}`), { status });

const CASES = [
  // [에러, 일시적인가, 설명]

  // ── 일시적: 다음 회차에 저절로 회수된다 ──
  [fetchFailed("UND_ERR_CONNECT_TIMEOUT"), true, "연결 타임아웃 (해외 IP 차단의 전형)"],
  [fetchFailed("ENOTFOUND"), true, "DNS 미해결 (부팅 직후)"],
  [fetchFailed("EAI_AGAIN"), true, "DNS 일시 실패"],
  [fetchFailed("ECONNRESET"), true, "연결 끊김"],
  [fetchFailed("ETIMEDOUT"), true, "시간 초과"],
  [httpError(403), true, "접근 거부 — 타임아웃 대신 403을 주는 사이트가 있다"],
  [httpError(429), true, "요청 과다"],
  [httpError(500), true, "서버 오류"],
  [httpError(503), true, "서비스 불가"],

  // ── 고장: 사람이 봐야 한다 ──
  [httpError(404), false, "주소가 바뀜"],
  [httpError(400), false, "잘못된 요청"],
  [new TypeError("Cannot read properties of undefined (reading 'match')"), false, "파싱 깨짐"],
  [new Error("모든 지역 조회 실패 - 저장하지 않음"), false, "전 지역 실패"],
  [new SyntaxError("Unexpected token < in JSON"), false, "응답 형식이 바뀜"],
  [new Error("그냥 오류"), false, "분류 불가 — 기본은 고장 취급"],
];

let pass = 0;
const failures = [];
for (const [err, expected, label] of CASES) {
  const got = isTransient(err);
  if (got === expected) pass += 1;
  else failures.push(`  ${label}\n     기대 ${expected ? "일시적" : "고장"} / 실제 ${got ? "일시적" : "고장"}`);
}

// cause 가 여러 겹으로 감싸여도 찾아낸다
const nested = new Error("wrap", { cause: fetchFailed("UND_ERR_CONNECT_TIMEOUT") });
if (isTransient(nested)) pass += 1;
else failures.push("  중첩된 cause 안의 타임아웃을 못 찾음");

// cause 가 자기 자신을 가리켜도 무한 루프에 빠지지 않는다
const loop = new Error("loop");
loop.cause = loop;
try {
  isTransient(loop);
  pass += 1;
} catch {
  failures.push("  순환 cause 에서 터짐");
}

const total = CASES.length + 2;
console.log(`실패 분류: ${pass}/${total} 통과`);
if (failures.length) {
  console.error("\n실패:\n" + failures.join("\n"));
  process.exit(1);
}
