// 제목에 아래 단어가 들어간 글은 수집/보관에서 제외한다.
//
// ── 수정 방법 ──
// 빼고 싶은 단어를 따옴표로 감싸 한 줄 추가하고, 되살리고 싶으면 그 줄을 지운다.
// 다음 수집(collect.bat 실행)부터 이미 저장된 글에도 소급 적용된다.
//
// 목록은 두 종류다.
//   COMMON  : 4개 소스 전부에 적용
//   BY_SOURCE: 특정 소스에만 적용 (넓은 단어를 한 소스에만 쓰고 싶을 때)

// ── 모든 소스 공통: 행정 절차성 공고 ──
export const COMMON_EXCLUDE_KEYWORDS = [
  "통장",          // 동 통장 공개모집 (분기마다 각 동에서 대량 등록)
  "평가위원",      // 제안서 평가위원 위촉
  "심사위원",      // 채용 면접 심사위원 위촉
  "위원회 위원",   // 도시계획위원회 등 각종 위원회 위원 위촉
  "수행기관",      // 건설공사 안전점검 수행기관 선정
  "안전점검",      // 건설공사 안전점검 관련
  "회계감사인",    // 회계감사인 선정
  "수의계약",      // 계약 공고
  "입찰",          // 입찰 공고
  "민간위탁",      // 민간위탁 사업자 선정
];

// ── 소스별 추가 제외 ──
// govkr(정부24)은 서울 25개구 전체를 수집해 양이 많아 더 넓게 거른다.
// 여기 단어들은 다른 소스에 적용하면 정상 공고까지 사라지므로 govkr에만 둔다.
export const BY_SOURCE_EXCLUDE_KEYWORDS = {
  govkr: [
    "결과",        // 선정 결과 공고
    "지정",        // 지정 신청/지정 공고
    "기업",
    "기관",
    "장애인",
    "어린이집",
    "수행",
    "어르신",
    "플러스센터",
    "담배",        // 담배소매업 지정 공고 (대량)
    "장학생",
    "보조사업자",
    "주민",
    "여성",
    "계량기",
    "반려동물",
  ],
  ydp: [],
  seoul: [],
  bizinfo: [],
};

function keywordsFor(source) {
  return [...COMMON_EXCLUDE_KEYWORDS, ...(BY_SOURCE_EXCLUDE_KEYWORDS[source] ?? [])];
}

export function isExcluded(title, source) {
  if (!title) return false;
  return keywordsFor(source).some((kw) => title.includes(kw));
}

// 제외 대상이 아닌 항목만 남긴다.
export function filterExcluded(items, source, titleField = "title") {
  const keywords = keywordsFor(source);
  return items.filter((item) => {
    const title = item[titleField];
    return !title || !keywords.some((kw) => title.includes(kw));
  });
}
