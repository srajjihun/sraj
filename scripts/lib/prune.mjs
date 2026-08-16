// 오래된/기간이 지난 글을 데이터 파일에서 정리하기 위한 공통 헬퍼.

function daysSince(dateStr, now) {
  const d = new Date(dateStr);
  if (isNaN(d)) return null; // 날짜를 못 읽으면 지우지 않고 보존
  return (now.getTime() - d.getTime()) / 86400000;
}

// 등록일 기준으로 너무 오래된 글을 정리 (신청기간 같은 명시적 마감일이 없는 소스용).
export function pruneByAge(items, dateField, maxAgeDays, now = new Date()) {
  return items.filter((item) => {
    const age = daysSince(item[dateField], now);
    return age === null || age <= maxAgeDays;
  });
}

// "YYYY-MM-DD ~ YYYY-MM-DD" 형식의 기간 문자열에서 종료일을 기준으로 정리.
export function pruneByPeriodEnd(items, periodField, graceDays, now = new Date()) {
  return items.filter((item) => {
    const match = String(item[periodField] || "").match(/~\s*(\d{4}-\d{2}-\d{2})/);
    if (!match) return true; // 종료일을 못 읽으면 보존
    const age = daysSince(match[1], now);
    return age === null || age <= graceDays;
  });
}
