// 공고문 본문에서 "참가 자격"과 "배점표"를 뽑습니다.
//
// 목록 API 는 "지역제한 있음(Y)" 까지만 알려주고 어느 지역인지는 안 줍니다.
// 그 내용은 공고문 안에만 있습니다. 실측 예:
//
//   가. …공고일 전일부터 계약 체결일까지 본점의 소재지를 부산광역시로 하며…
//   나. …기타자유업(행사대행업, 업종코드 9901)으로 등록을 필한 업체
//
// 원칙: 못 찾으면 못 찾았다고 합니다. 추정하지 않습니다.
//       찾은 것에는 반드시 원문 한 줄(evidence)을 붙입니다.
//       근거 없는 숫자는 시스템 전체의 신뢰를 무너뜨립니다.

const SIDO = [
  "서울특별시", "부산광역시", "대구광역시", "인천광역시", "광주광역시", "대전광역시",
  "울산광역시", "세종특별자치시", "경기도", "강원특별자치도", "강원도",
  "충청북도", "충청남도", "전북특별자치도", "전라북도", "전라남도",
  "경상북도", "경상남도", "제주특별자치도",
];

/** 문장 단위로 자릅니다. 근거로 보여줄 때 너무 길지 않게. */
function lines(text) {
  return String(text ?? "")
    .split(/\n+/)
    .map((s) => s.replace(/\s+/g, " ").trim())
    .filter(Boolean);
}

const clip = (s, n = 140) => (s.length > n ? `${s.slice(0, n)}…` : s);

/** 지역제한 — 본점 소재지를 어디로 요구하는가 */
function findRegion(ls) {
  for (const l of ls) {
    if (!/소재지|본점|주된 영업소|사업자등록/.test(l)) continue;
    const hit = SIDO.find((s) => l.includes(s));
    if (!hit) continue;
    // "부산광역시 소재 업체" 처럼 제한을 거는 문장인지 확인합니다.
    if (!/제한|로 하[며는]|소재|둔 자|둔 업체|등록.*업체|한정/.test(l)) continue;
    return { value: hit, evidence: clip(l) };
  }
  return null;
}

/**
 * 업종·면허 — 업종코드가 있으면 그것까지.
 *
 * 모든 공고에 똑같이 붙는 상투 문구는 걸러야 합니다. 실측 오탐:
 *   "국가종합전자조달시스템 입찰참가자격등록규정에 의하여 반드시 나라장터
 *    시스템에 입찰일 전일까지 입찰참가 등록을 필한 자"
 * 이건 업종 제한이 아니라 나라장터를 쓰라는 안내입니다. 그런데 "등록을 필한"
 * 이 걸려서 업종 요건으로 잡혔고, 카드에 140자짜리 문장이 붙었습니다.
 */
const NOT_INDUSTRY = /입찰참가자격등록|전자조달시스템|국가종합전자조달|나라장터\s*시스템|공동인증서|지문인식|청렴계약|부정당업자/;

function findIndustry(ls) {
  const out = [];
  const seen = new Set();
  const add = (value, evidence) => {
    if (seen.has(value)) return;
    seen.add(value);
    out.push({ value, evidence: clip(evidence) });
  };

  for (const l of ls) {
    if (NOT_INDUSTRY.test(l)) continue;

    // "기타자유업(행사대행업, 업종코드 9901)" / "업종코드: 9901"
    const code = /업종\s*코드\s*[:：]?\s*(\d{3,5})/.exec(l);
    if (code) {
      const name = /([가-힣]{2,12}업)\s*[,，(（]?\s*업종\s*코드/.exec(l);
      add(name ? `${name[1]}(${code[1]})` : `업종코드 ${code[1]}`, l);
      continue;
    }

    // "[창업기획자(6883)] 업종을 등록한 업체"
    const bracket = /([가-힣]{2,12})\s*[(（]\s*(\d{3,5})\s*[)）]\s*\]?\s*업종/.exec(l);
    if (bracket) {
      add(`${bracket[1]}(${bracket[2]})`, l);
      continue;
    }

    // 코드가 없는 경우. 문장을 통째로 담지 않고 "○○업" 한 낱말만 뽑습니다 —
    // 카드에 붙는 값이라 길면 읽을 수가 없고, 회사 보유 업종과 대조도 안 됩니다.
    if (!/(등록|면허|신고)를?을?\s*(필한|받은|한)/.test(l)) continue;
    const word = /([가-힣]{2,12}(?:업|업자|공사업|서비스업))\s*(?:등록|면허|신고|을|를|으로|로)/.exec(l);
    if (word) add(word[1], l);
  }
  // 같은 내용이 여러 번 나오므로 앞의 둘만 씁니다.
  return out.slice(0, 2);
}

/** 금액 표기를 숫자로. "5천만원" "50,000,000원" "1억5천만원" */
export function parseWon(s) {
  const t = String(s ?? "").replace(/[\s,]/g, "");
  let total = 0;
  let matched = false;
  const eok = /([\d.]+)억/.exec(t);
  if (eok) { total += Number(eok[1]) * 1e8; matched = true; }
  const chun = /([\d.]+)천만/.exec(t);
  if (chun) { total += Number(chun[1]) * 1e7; matched = true; }
  const baek = /([\d.]+)백만/.exec(t);
  if (baek) { total += Number(baek[1]) * 1e6; matched = true; }
  if (matched) return Math.round(total);
  const plain = /(\d{6,})원/.exec(t);
  return plain ? Number(plain[1]) : null;
}

/** 실적 요건 — "최근 3년 이내 유사용역 5천만원 이상" */
function findRecord(ls) {
  for (const l of ls) {
    if (!/실적/.test(l)) continue;
    if (!/이상|충족|보유|증명/.test(l)) continue;
    const years = /최근\s*(\d+)\s*년/.exec(l);
    const amount = parseWon(l);
    if (!years && amount === null) continue;
    return {
      years: years ? Number(years[1]) : null,
      amount,
      evidence: clip(l),
    };
  }
  return null;
}

/**
 * 기술:가격 배점 — 본문에 글로 적혀 있는 경우.
 *
 * 한 줄에 안 들어갑니다. 실측 예(두 줄에 걸침):
 *   ※ … 배점은 기술능력평가
 *     90 점 (정량적 평가 20, 정성적 평가 70 점 ), 입찰가격평가 10 점임
 * 그래서 두 줄씩 붙여 보고, 기술과 가격을 따로 찾은 뒤 합이 100 근처인지 확인합니다.
 * (그 사이 괄호 안에도 숫자가 있어서 "가까이 붙은 숫자" 규칙으로는 잘못 잡힙니다)
 */
function findRateLine(ls) {
  for (let i = 0; i < ls.length; i += 1) {
    const win = [ls[i], ls[i + 1] ?? ""].join(" ");
    const t = /기술(?:능력)?평가\s*([\d.]+)\s*점/.exec(win);
    const p = /(?:입찰)?가격평가\s*([\d.]+)\s*점/.exec(win);
    if (!t || !p) continue;
    const tech = Number(t[1]);
    const price = Number(p[1]);
    if (!Number.isFinite(tech) || !Number.isFinite(price)) continue;
    if (Math.abs(tech + price - 100) > 2) continue; // 합이 100 이 아니면 배점 문장이 아닙니다
    const detail = {};
    const q = /정량(?:적)?\s*평가\s*([\d.]+)/.exec(win);
    const s = /정성(?:적)?\s*평가\s*([\d.]+)/.exec(win);
    if (q) detail.정량 = Number(q[1]);
    if (s) detail.정성 = Number(s[1]);
    return { tech, price, detail, evidence: clip(win, 170) };
  }
  return null;
}

/**
 * 배점표 — 표에서 찾습니다.
 * "평가항목 / 배점" 처럼 숫자 열이 있는 표를 배점표로 봅니다.
 * 배점 합이 100 근처면 신뢰도가 높습니다.
 */
function findScoreTable(tables) {
  let best = null;
  for (const t of tables ?? []) {
    const grid = t.grid ?? t.rows;
    if (!grid || grid.length < 2) continue;
    const width = Math.max(...grid.map((r) => r.length));
    if (width < 2) continue;

    // 배점처럼 보이는 열을 찾습니다 — 숫자만 든 칸이 많은 열
    for (let c = 1; c < width; c += 1) {
      const vals = grid.slice(1).map((r) => (r[c] ?? "").trim());
      const nums = vals.map((v) => (/^\d{1,3}(\.\d+)?$/.test(v) ? Number(v) : null));
      const filled = nums.filter((n) => n !== null);
      if (filled.length < 2) continue;
      const sum = filled.reduce((a, b) => a + b, 0);
      const header = (grid[0][c] ?? "").trim();
      const looksLikeScore = /배점|점수|평점|가중치/.test(header) || (sum >= 90 && sum <= 110);
      if (!looksLikeScore) continue;

      const items = grid
        .slice(1)
        .map((r, i) => ({
          name: (r.slice(0, c).filter(Boolean).join(" / ") || "").trim(),
          score: nums[i],
        }))
        .filter((x) => x.name && x.score !== null);
      if (!items.length) continue;

      const cand = { items, total: sum, column: header || "배점", rows: grid };
      // 합이 100 에 가까운 쪽을 고릅니다.
      if (!best || Math.abs(sum - 100) < Math.abs(best.total - 100)) best = cand;
    }
  }
  return best;
}

// 신인도 가점으로 쓰이는 인증들.
// "인증서류 뭐가 더 필요해?"에 추측 대신 실제 공고문 빈도로 답하기 위한
// 목록입니다. 공고문을 여러 건 읽으면 어떤 인증이 몇 번 나왔는지 쌓입니다.
//
// 이름 하나에 여러 표기를 묶습니다. 예전에는 "ISO9001" 과 "ISO 9001" 을
// 따로 세어서 같은 인증이 둘로 갈라졌습니다. 대표 이름으로 모읍니다.
const CREDIT_TERMS = [
  { term: "직접생산확인", re: /직접생산확인/ },
  { term: "벤처기업", re: /벤처기업/ },
  { term: "여성기업", re: /여성기업/ },
  { term: "장애인기업", re: /장애인기업/ },
  { term: "중증장애인생산품", re: /중증장애인\s?생산(품|시설)/ },
  { term: "사회적기업", re: /사회적기업/ },
  { term: "사회적경제기업", re: /사회적경제\s?기업/ },
  { term: "사회적협동조합", re: /사회적\s?협동조합/ },
  { term: "마을기업", re: /마을기업/ },
  { term: "자활기업", re: /자활기업/ },
  { term: "이노비즈", re: /이노비즈|INNO-?BIZ/i },
  { term: "메인비즈", re: /메인비즈|MAIN-?BIZ/i },
  { term: "소기업", re: /소기업/ },
  { term: "소상공인", re: /소상공인\s?확인/ },
  { term: "가족친화인증", re: /가족친화/ },
  { term: "고용우수기업", re: /고용우수기업|고용창출\s?우수/ },
  { term: "청년친화강소기업", re: /청년친화\s?강소기업/ },
  { term: "노사문화우수기업", re: /노사문화\s?우수/ },
  { term: "기업부설연구소", re: /기업부설\s?연구소/ },
  { term: "지식재산경영인증", re: /지식재산경영\s?인증/ },
  { term: "우수조달물품", re: /우수조달\s?(물품|기업)/ },
  { term: "성과공유기업", re: /성과공유\s?기업/ },
  { term: "ISO9001", re: /ISO\s?9001/i },
  { term: "ISO14001", re: /ISO\s?14001/i },
  { term: "ISO27001", re: /ISO\s?27001|정보보호\s?경영/i },
  { term: "ISO45001", re: /ISO\s?45001|안전보건\s?경영/i },
];

/** 공고문에 언급된 신인도 가점 인증들. 근거 문장을 같이 남깁니다. */
function findCredits(ls) {
  const found = [];
  const seen = new Set();
  for (const l of ls) {
    for (const { term, re } of CREDIT_TERMS) {
      if (seen.has(term)) continue;
      if (re.test(l)) {
        found.push({ term, evidence: clip(l) });
        seen.add(term);
      }
    }
  }
  return found;
}

/**
 * 공고문 하나에서 뽑아낼 수 있는 것을 전부 뽑습니다.
 * @param {string} text   본문
 * @param {Array}  tables 표(HWPX 에서만 나옵니다)
 */
export function extractRequirements(text, tables) {
  const ls = lines(text);
  const region = findRegion(ls);
  const industry = findIndustry(ls);
  const record = findRecord(ls);
  const rate = findRateLine(ls);
  const scoreTable = findScoreTable(tables);
  const credits = findCredits(ls);

  return {
    region,        // { value:"부산광역시", evidence } | null
    industry,      // [{ value, evidence }]
    record,        // { years, amount, evidence } | null
    rate,          // { tech, price, evidence } | null
    scoreTable,    // { items:[{name,score}], total } | null
    credits,       // [{ term, evidence }] — 언급된 신인도 인증
    found: {
      region: !!region,
      industry: industry.length > 0,
      record: !!record,
      score: !!scoreTable || !!rate,
    },
  };
}

/**
 * 회사 정보와 대조해 "들어갈 수 있는가"를 판정합니다.
 * 판정은 셋뿐입니다: 가능 / 불가 / 확인필요. 애매하면 확인필요입니다.
 */
export function judgeEligibility(req, company) {
  const checks = [];

  if (req.region) {
    if (!company?.region) {
      checks.push({ key: "지역", verdict: "확인필요", detail: `${req.region.value} 제한 · 우리 소재지 미입력`, evidence: req.region.evidence });
    } else {
      const ok = company.region.includes(req.region.value.slice(0, 2)) || req.region.value.includes(company.region.slice(0, 2));
      checks.push({
        key: "지역",
        verdict: ok ? "가능" : "불가",
        detail: `${req.region.value} 제한 · 우리 ${company.region}`,
        evidence: req.region.evidence,
      });
    }
  }

  for (const ind of req.industry) {
    const have = (company?.licenses ?? []).some((l) => ind.value.includes(l) || l.includes(ind.value.split("(")[0]));
    checks.push({
      key: "업종",
      verdict: have ? "가능" : (company?.licenses ?? []).length ? "불가" : "확인필요",
      detail: ind.value,
      evidence: ind.evidence,
    });
  }

  if (req.record?.amount) {
    if (!company?.maxRecord) {
      checks.push({ key: "실적", verdict: "확인필요", detail: `${Math.round(req.record.amount / 1e6)}백만원 이상 요구 · 우리 실적 미입력`, evidence: req.record.evidence });
    } else {
      const ok = company.maxRecord >= req.record.amount;
      checks.push({
        key: "실적",
        verdict: ok ? "가능" : "불가",
        detail: `${Math.round(req.record.amount / 1e6)}백만원 이상 요구 · 우리 최대 ${Math.round(company.maxRecord / 1e6)}백만원`,
        evidence: req.record.evidence,
      });
    }
  }

  const verdict = checks.some((c) => c.verdict === "불가")
    ? "불가"
    : checks.some((c) => c.verdict === "확인필요")
      ? "확인필요"
      : checks.length
        ? "가능"
        : "정보없음";

  return { verdict, checks };
}
