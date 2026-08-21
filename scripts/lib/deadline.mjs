// 한국어 공고 문구에서 신청/접수 마감일을 best-effort로 추출하는 공통 헬퍼.
//
// 동작 방식: 텍스트 전체에서 날짜 후보를 전부 수집한 뒤(첫 매치가 무효여도
// 계속 스캔), 신청/접수 문맥이 붙은 후보를 우선해 가장 늦은 날짜를 고른다.
//
// 지원 형식:
//   "7월 27일부터 8월 23일까지" / "8월 7~23일" / "8월 7일~23일" / "8월 23일까지"
//   "2026. 8. 14.(금) ~ 8. 27.(목)" / "~ 8. 28.(금)" / "(~8.18.)"   ← 점 표기
//   "(접수 8/1~8/31)"                                                ← 슬래시 표기
//
// 오인 방지:
//   - 점 표기는 공문 관례상 일(day) 뒤에 마침표가 오는 형태만 인정한다.
//     ("연 2.5~4.5%", "1~2.5억원", "만족도 4.0~4.8점" 같은 소수 범위 배제)
//   - "13~16시" 같은 시간 표기는 '일' 단위 요구 때문에 매치되지 않는다.
//   - "활동기간"/"운영기간" 등 신청과 무관한 기간은 후보에서 제외한다.
//   - 게시일로부터 400일을 넘는 날짜는 오인으로 보고 버린다.
//
// 연도 추정: 연도가 명시되지 않으면 게시일 기준 [-60일, +370일] 창 안에서
// 가장 가까운 연도를 고른다. (1월 게시 + 12월 마감 → 직전 해로 정확히 해석)

const WEEKDAY_PAREN = /\(\s*(?:월|화|수|목|금|토|일)\s*\)/g;
const CONTEXT_WINDOW = 24;

// 문맥 등급. 앞쪽 CONTEXT_WINDOW 글자를 보고 정한다.
//   2 = 신청 마감으로 보이는 문맥      1 = 애매한 문맥      0 = 문맥 없음
// APPLY 가 WEAK 보다 먼저 판정되므로, 창 안에 둘 다 있으면 APPLY 로 친다.
const APPLY_CTX = /(?:신청|접수|모집|공모|응모|원서|등록)/;
const WEAK_CTX = /(?:공고|판매|기간)/;

// "기간"이라고 다 신청기간이 아니다. 이것들은 후보에서 아예 뺀다.
// 실제 사고: "활동기간: 2026. 9. ~ 2028. 3." 을 마감일로 잡아 신청일자가
// 2028-03-04 로 찍혔다(진짜 마감은 접수기간의 2026-07-29).
const NOT_APPLY_CTX = /(?:활동|운영|사업|근무|교육|계약|행사|공연|전시|사용|이용|임기|수행|공사|보관|지원)\s*기간/;

// 게시일 기준 이 창을 벗어난 날짜는 오인으로 본다. 연도가 명시된 후보에도
// 적용된다 - pickYear 의 창은 이보다 좁으므로 서로 어긋나지 않는다.
// 위 사고에서 2028-03-04 는 게시일(2026-07-23)로부터 590일 뒤였다.
const MAX_AHEAD_DAYS = 400;
const MAX_BEHIND_DAYS = 60;

function toIso(year, month, day) {
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const d = new Date(Date.UTC(year, month - 1, day));
  if (isNaN(d) || d.getUTCMonth() !== month - 1) return null;
  return d.toISOString().slice(0, 10);
}

// 연도 미상 날짜: 게시일 기준 -60일~+370일 창에서 가장 가까운 연도를 선택
function pickYear(postDate, month, day) {
  const base = postDate.getTime();
  const y0 = postDate.getUTCFullYear();
  let best = null;
  for (const y of [y0 - 1, y0, y0 + 1]) {
    const iso = toIso(y, month, day);
    if (!iso) continue;
    const diff = (Date.parse(iso) - base) / 86400000;
    if (diff < -60 || diff > 370) continue;
    if (!best || Math.abs(diff) < Math.abs(best.diff)) best = { iso, diff };
  }
  return best ? best.iso : null;
}

// 각 패턴은 [매치 시작 index, {year|null, month, day}] 목록을 내놓는다.
const PATTERNS = [
  { // "N월 N일 ... ~/부터 ... N월 N일"
    rx: /(\d{1,2})\s*월\s*(\d{1,2})\s*일[^0-9월]{0,8}(?:부터|~|-)[^0-9]{0,8}(\d{1,2})\s*월\s*(\d{1,2})\s*일/g,
    pick: m => ({ year: null, month: +m[3], day: +m[4] }),
  },
  { // "N월 N[일]~N일" (같은 달 범위)
    rx: /(\d{1,2})\s*월\s*(\d{1,2})\s*(?:일\s*)?[~\-]\s*(\d{1,2})\s*일/g,
    pick: m => ({ year: null, month: +m[1], day: +m[3] }),
  },
  { // "N월 N일까지/마감"
    rx: /(\d{1,2})\s*월\s*(\d{1,2})\s*일\s*(?:까지|마감)/g,
    pick: m => ({ year: null, month: +m[1], day: +m[2] }),
  },
  { // "~ [YYYY.] M. D." — 일 뒤 마침표 필수(소수 범위 오인 방지)
    rx: /~\s*(?:(\d{4})\s*\.\s*)?(\d{1,2})\s*\.\s*(\d{1,2})\s*\./g,
    pick: m => ({ year: m[1] ? +m[1] : null, month: +m[2], day: +m[3] }),
  },
  { // "~ M/D" 슬래시 표기
    rx: /~\s*(\d{1,2})\s*\/\s*(\d{1,2})(?!\d|\s*\/)/g,
    pick: m => ({ year: null, month: +m[1], day: +m[2] }),
  },
];

function tierOf(ctx) {
  if (APPLY_CTX.test(ctx)) return 2;
  if (NOT_APPLY_CTX.test(ctx)) return -1; // 후보에서 제외
  if (WEAK_CTX.test(ctx)) return 1;
  return 0;
}

function collectCandidates(text, postDate) {
  const candidates = [];
  for (const { rx, pick } of PATTERNS) {
    rx.lastIndex = 0;
    for (const m of text.matchAll(rx)) {
      const { year, month, day } = pick(m);
      const iso = year !== null ? toIso(year, month, day) : pickYear(postDate, month, day);
      if (!iso) continue; // 무효 매치는 버리고 계속 스캔

      const days = (Date.parse(iso) - postDate.getTime()) / 86400000;
      if (days < -MAX_BEHIND_DAYS || days > MAX_AHEAD_DAYS) continue;

      const tier = tierOf(text.slice(Math.max(0, m.index - CONTEXT_WINDOW), m.index));
      if (tier < 0) continue;
      candidates.push({ iso, tier });
    }
  }
  return candidates;
}

export function extractDeadline(postDateStr, ...texts) {
  const postDate = new Date(postDateStr);
  if (isNaN(postDate)) return null;
  for (const raw of texts) {
    if (!raw) continue;
    const text = String(raw).replace(WEEKDAY_PAREN, "");
    const candidates = collectCandidates(text, postDate);
    if (!candidates.length) continue;
    // 가장 높은 문맥 등급만 남기고, 그 안에서 가장 늦은 날짜를 고른다.
    const top = Math.max(...candidates.map(c => c.tier));
    const pool = candidates.filter(c => c.tier === top);
    return pool.reduce((a, b) => (a.iso >= b.iso ? a : b)).iso;
  }
  return null;
}
