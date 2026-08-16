// 한국어 공고 문구에서 신청/접수 마감일을 best-effort로 추출하는 공통 헬퍼.
// 지원 형식:
//   "7월 27일부터 8월 23일까지" / "8월 7~23일" / "8월 23일까지"
//   "2026. 8. 14.(금) ~ 8. 27.(목)" / "~ 8. 28.(금)" / "(~8.18.)"
// 못 찾으면 null. 연도가 없으면 등록일 기준으로 추정(해 넘김 보정).

function resolveYear(postDate, month) {
  let year = postDate.getUTCFullYear();
  // 마감월이 등록월보다 2달 넘게 이전이면 해를 넘긴 것으로 간주
  if (month < postDate.getUTCMonth() + 1 - 2) year += 1;
  return year;
}

function toIso(year, month, day) {
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const d = new Date(Date.UTC(year, month - 1, day));
  if (isNaN(d) || d.getUTCMonth() !== month - 1) return null;
  return d.toISOString().slice(0, 10);
}

// "N월 N일 ... ~/부터 ... N월 N일" | "N월 N~N일" | "N월 N일까지"
function fromKoreanUnits(text, postDate) {
  const range = text.match(
    /(\d{1,2})\s*월\s*(\d{1,2})\s*일[^0-9월]{0,6}(?:부터|~|-)[^0-9]{0,6}(\d{1,2})\s*월\s*(\d{1,2})\s*일/
  );
  if (range) {
    const month = Number(range[3]);
    return toIso(resolveYear(postDate, month), month, Number(range[4]));
  }
  const sameMonth = text.match(/(\d{1,2})\s*월\s*(\d{1,2})\s*[~\-]\s*(\d{1,2})\s*일/);
  if (sameMonth) {
    const month = Number(sameMonth[1]);
    return toIso(resolveYear(postDate, month), month, Number(sameMonth[3]));
  }
  const single = text.match(/(\d{1,2})\s*월\s*(\d{1,2})\s*일\s*(?:까지|마감)/);
  if (single) {
    const month = Number(single[1]);
    return toIso(resolveYear(postDate, month), month, Number(single[2]));
  }
  return null;
}

// "~ 2026. 8. 28." | "~ 8. 28.(금)" | "(~8.18.)" — 물결표 뒤의 점 표기 날짜
function fromDottedRange(text, postDate) {
  const m = text.match(/~\s*(?:(\d{4})\s*\.\s*)?(\d{1,2})\s*\.\s*(\d{1,2})\s*\.?/);
  if (!m) return null;
  const month = Number(m[2]);
  const day = Number(m[3]);
  const year = m[1] ? Number(m[1]) : resolveYear(postDate, month);
  return toIso(year, month, day);
}

export function extractDeadline(postDateStr, ...texts) {
  const postDate = new Date(postDateStr);
  if (isNaN(postDate)) return null;
  for (const text of texts) {
    if (!text) continue;
    const s = String(text);
    const found = fromKoreanUnits(s, postDate) ?? fromDottedRange(s, postDate);
    if (found) return found;
  }
  return null;
}
