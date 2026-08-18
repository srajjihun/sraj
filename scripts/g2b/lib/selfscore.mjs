// 심사표 자가채점 — "이 공고에서 우리가 몇 점 받나"를 공고의 실제 심사표로 계산합니다.
//
// 왜 바꾸는가:
//   예전 예측점수는 참가가능성 40 / 유사실적 35 / 평가유리도 25 라는 가중치를
//   제가 정해서 썼습니다. 근거가 없는 숫자였습니다. 이제 공고문에서 심사표를
//   뽑아낼 수 있으니, 남의 기준이 아니라 그 공고가 실제로 쓰는 채점표로 셉니다.
//
// 무엇을 채점하고 무엇을 안 하는가:
//   채점함   실적 · 신인도 · 지역   — 지금 확인 가능하고, 회사마다 다른 항목
//   채점 안 함 정성평가(사업이해도·제안내용) — 제안서를 써봐야 아는 것이고,
//              어차피 공고끼리 차이가 없어 넣으면 변별력만 사라집니다
//   채점 안 함 가격평가 — 우리가 얼마를 쓰느냐에 달린 것이라 공고 비교값이 아닙니다
//   채점 못 함 경영상태·인력 — 신용등급과 인력 명단이 회사정보에 없습니다.
//              모르는 것을 아는 척하지 않고 "미확인"으로 따로 셉니다.
//
// 그래서 나오는 값은 "총점 예상"이 아니라 "정량 항목 득점률"입니다.
// 총점처럼 보이게 만들 수도 있었지만, 그러면 정성 배점이 큰 공고일수록
// 점수가 다 비슷해져서 무엇을 먼저 볼지 가려낼 수 없습니다.
import { itemKey } from "./require.mjs";

/** 우리가 지금 채점할 수 있는 항목들 */
const SCORABLE = new Set(["실적", "신인도", "지역"]);
/** 채점 대상에서 아예 빼는 항목들 (위 설명 참고) */
const EXCLUDED = new Set(["정성", "가격"]);

const norm = (s) => String(s ?? "").replace(/\s+/g, "").toUpperCase();

/** 실적 항목 채점. 심사표에 등급이 적혀 있으면 그것을 그대로 씁니다. */
function scoreRecord(item, company, budget) {
  const mine = company?.maxRecord ?? null;
  if (!mine) return { got: null, why: "우리 실적 미입력" };

  if (item.tiers?.length) {
    const hit = item.tiers.find((t) => mine >= t.min);
    const got = hit ? Math.min(hit.score, item.score) : 0;
    const need = item.tiers[item.tiers.length - 1].min;
    return {
      got,
      why: hit
        ? `${Math.round(hit.min / 1e8 * 10) / 10}억 이상 등급 — ${got}점`
        : `최저 등급 ${Math.round(need / 1e8 * 10) / 10}억에 미달`,
    };
  }

  // 등급을 못 읽었으면 사업 규모 대비 비율로 봅니다.
  if (!budget) return { got: null, why: "사업금액 미상" };
  const r = mine / budget;
  const ratio = r >= 3 ? 1 : r >= 1.5 ? 0.9 : r >= 1 ? 0.8 : r >= 0.7 ? 0.65 : r >= 0.5 ? 0.5 : 0.3;
  return { got: Math.round(item.score * ratio * 10) / 10, why: `사업금액의 ${Math.round(r * 100)}% 수준 실적` };
}

/** 신인도 항목 채점. 이 공고가 인정하는 인증 중 우리가 가진 비율입니다. */
function scoreCredit(item, company, credits) {
  const asked = (credits ?? []).map((c) => c.term);
  if (!asked.length) return { got: null, why: "인정 인증 목록을 못 읽음" };
  const held = new Set([
    ...(company?.certs ?? []),
    ...((company?.directProduce ?? []).length ? ["직접생산확인"] : []),
  ].map(norm));
  const hit = asked.filter((t) => held.has(norm(t)));
  // 신인도는 해당 항목을 합산하는 방식이라, 인정 항목 중 보유 비율로 봅니다.
  const ratio = hit.length / asked.length;
  return {
    got: Math.round(item.score * ratio * 10) / 10,
    why: hit.length ? `${asked.length}개 중 ${hit.join("·")} 보유` : `${asked.length}개 중 보유 없음`,
  };
}

/** 지역 항목 채점. 어느 지역을 요구하는지 읽힌 공고만 채점합니다. */
function scoreRegion(item, company, region) {
  if (!region?.value || !company?.region) return { got: null, why: "요구 지역 또는 우리 소재지 미상" };
  const ok = company.region.slice(0, 2) === region.value.slice(0, 2);
  return { got: ok ? item.score : 0, why: `${region.value} 기준 · 우리 ${company.region}` };
}

/**
 * 참가 자격 판정. 여기서 "불가"가 나오면 목록에서 뺍니다.
 * 뺀다는 건 되돌리기 어려운 일이라, 확실한 근거가 있을 때만 불가로 봅니다.
 * 애매하면 불가로 하지 않습니다 — 놓친 기회는 눈에 보이지도 않습니다.
 */
export function judgeBlocked(doc, company) {
  const why = [];

  // ① 공고문에서 읽어낸 지역·업종·실적 판정
  for (const c of doc?.eligibility?.checks ?? []) {
    if (c.verdict === "불가") why.push(`${c.key}: ${c.detail}`);
  }

  // ② 직접생산확인은 품목이 맞아야 합니다. 품목이 다르면 증명서가 있어도 못 냅니다.
  const need = doc?.directItems ?? [];
  if (need.length && (company?.directProduce ?? []).length) {
    const ours = new Set(company.directProduce.map(itemKey));
    const missing = need.filter((i) => !ours.has(itemKey(i.name)));
    // 요구 품목을 하나도 못 맞추면 참가 불가입니다.
    if (missing.length === need.length) {
      why.push(`직접생산확인 품목: ${missing.map((i) => i.name).join("·")} 미보유`);
    }
  }

  return { blocked: why.length > 0, why };
}

/**
 * 공고 하나를 자가채점합니다.
 * @returns {{mode, pct, got, max, unknown, items, blocked, blockWhy}|null}
 */
export function selfScore(doc, company, budget) {
  const table = doc?.scoreTable;
  const { blocked, why: blockWhy } = judgeBlocked(doc, company);
  if (!table?.items?.length) {
    return blocked ? { mode: "없음", blocked, blockWhy } : null;
  }

  const items = [];
  let got = 0;
  let max = 0;
  let unknown = 0;
  // 무엇을 못 채점했는지도 남깁니다. 화면에 "경영상태·인력" 이라고 고정으로
  // 박아 두었더니 지역이 미확인일 때도 그 문구가 나왔습니다 — 사실이 아닙니다.
  const unknownKinds = new Set();

  for (const it of table.items) {
    if (EXCLUDED.has(it.kind)) continue;
    if (!SCORABLE.has(it.kind)) { unknown += it.score; unknownKinds.add(it.kind); continue; }

    const r =
      it.kind === "실적" ? scoreRecord(it, company, budget)
      : it.kind === "신인도" ? scoreCredit(it, company, doc.credits)
      : scoreRegion(it, company, doc.region);

    if (r.got === null) { unknown += it.score; unknownKinds.add(it.kind); continue; }
    got += r.got;
    max += it.score;
    items.push({ name: it.name, kind: it.kind, score: it.score, got: r.got, why: r.why });
  }

  if (!max) return blocked ? { mode: "없음", blocked, blockWhy } : null;

  return {
    mode: "심사표",
    pct: Math.round((got / max) * 100),
    got: Math.round(got * 10) / 10,
    max,
    unknown,
    unknownKinds: [...unknownKinds],
    items,
    blocked,
    blockWhy,
  };
}
