// 수집 실패를 두 종류로 갈라 종료 코드로 알린다.
//
//   1  진짜 고장 — 사이트 구조가 바뀌어 파싱이 깨졌거나, 코드가 터졌거나,
//      HTTP 4xx/5xx 가 왔다. 사람이 봐야 한다.
//   75 일시적 — 연결이 안 됐다. (EX_TEMPFAIL 관례)
//
// 이 구분이 필요한 이유: 대상 사이트들이 해외 IP를 간헐적으로 막는다.
// GitHub 러너에서 영등포구청·정부24가 번갈아 타임아웃 나는데, 이걸 고장으로
// 치면 워크플로가 늘 빨간색이라 진짜 고장이 묻힌다. 반대로 전부 경고로 낮추면
// 파싱이 깨져도 아무도 모른다.
//
// 일시적 실패는 저절로 복구된다. 수집은 하루 세 번 돌고 매번 최근 30일치를
// 통째로 다시 훑으므로, 한 회차를 걸러도 다음 회차에 그대로 들어온다.

const TRANSIENT_CODES = new Set([
  "UND_ERR_CONNECT_TIMEOUT", // 연결 시도 자체가 시간 초과 (차단 시 전형적)
  "UND_ERR_HEADERS_TIMEOUT",
  "UND_ERR_BODY_TIMEOUT",
  "UND_ERR_SOCKET",
  "ENOTFOUND", // DNS 미해결 (부팅 직후 등)
  "EAI_AGAIN", // DNS 일시 실패
  "ECONNRESET",
  "ECONNREFUSED",
  "ETIMEDOUT",
  "EHOSTUNREACH",
  "ENETUNREACH",
]);

// HTTP 상태로도 가른다. 차단이 항상 타임아웃으로 나타나지는 않는다 -
// 해외 IP에 403 을 돌려주는 사이트도 있고, 그러면 이름만 다를 뿐 같은 상황이다.
//   403 접근 거부(차단 가능성) · 408 요청 시간초과 · 429 과다요청 · 5xx 서버 문제
// 404 같은 나머지 4xx 는 주소가 바뀌었다는 뜻이라 코드를 고쳐야 한다.
function isTransientStatus(status) {
  if (!status) return false;
  return status === 403 || status === 408 || status === 429 || status >= 500;
}

export function isTransient(err) {
  for (let e = err, depth = 0; e && depth < 5; e = e.cause, depth += 1) {
    if (e.code && TRANSIENT_CODES.has(e.code)) return true;
    if (isTransientStatus(e.status)) return true;
  }
  return false;
}

// 수집 스크립트의 공통 진입점. 실패 종류에 따라 종료 코드를 정한다.
export function runMain(main) {
  main().catch((err) => {
    console.error(err);
    process.exit(isTransient(err) ? 75 : 1);
  });
}
