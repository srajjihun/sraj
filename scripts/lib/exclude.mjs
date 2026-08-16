// 제목에 아래 단어가 들어간 글은 수집/보관에서 제외한다.
// 주민이 참여할 만한 공고가 아니라 행정 절차성 공고(통장·위원 위촉·
// 용역 수행기관 선정 등)를 걸러내기 위한 목록이다.
//
// ── 수정 방법 ──
// 빼고 싶은 단어를 따옴표로 감싸 한 줄 추가하고, 되살리고 싶으면 그 줄을 지우면 된다.
// 다음 수집(collect.bat 실행)부터 이미 저장된 글에도 소급 적용된다.
//
// 주의: 너무 흔한 단어(예: "업체", "위원")를 넣으면 정상 공고까지 사라진다.
//       실제로 "업체"는 '소상공인 홍보관 참여 업체 모집' 같은 정상 공고를
//       걸러내서 제외 목록에서 뺐다.
export const EXCLUDE_KEYWORDS = [
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

export function isExcluded(title) {
  if (!title) return false;
  return EXCLUDE_KEYWORDS.some((kw) => title.includes(kw));
}

// 제외 대상이 아닌 항목만 남긴다.
export function filterExcluded(items, titleField = "title") {
  return items.filter((item) => !isExcluded(item[titleField]));
}
