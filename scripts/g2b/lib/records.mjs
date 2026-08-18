// 수행실적 DB 읽기 — config/실적DB.md 의 건별 실적을 씁니다.
//
// 왜 건별로 두는가:
//   예전에는 "최대단일실적 8억" 같은 요약 숫자 몇 개만 들고 있었습니다.
//   그러면 심사표가 "최근 3년 3억 이상 2건 이상" 을 요구할 때 답할 수가
//   없습니다. 가장 큰 한 건만 알아서는 건수를 셀 수 없기 때문입니다.
//   또 "이 공고 분야에 우리 실적이 몇 건인가" 도 말할 수 없었습니다.
//
// 분야는 여기 적어 두지 않고 읽을 때마다 다시 매깁니다. 공고를 분류하는
// 그 엔진(config/g2b-keywords.md)을 그대로 쓰기 때문에, 키워드를 고치면
// 우리 실적 분류도 같이 따라옵니다. 잣대가 어긋나면 "같은 분야"라는 말이
// 뜻을 잃습니다.
import { readFile } from "node:fs/promises";
import { loadKeywords, matchGroups } from "./keywords.mjs";

const DB = new URL("../../../config/실적DB.md", import.meta.url);

/** 표 부분(``` 로 감싼 블록)만 뽑아 한 줄씩 읽습니다. */
function parseLines(text) {
  const block = /```\s*\n([\s\S]*?)```/.exec(text)?.[1] ?? "";
  const out = [];
  for (const line of block.split("\n")) {
    if (!line.trim()) continue;
    const [year, amount, org, title, type] = line.split("\t");
    const y = Number(year);
    const a = Number(amount);
    if (!Number.isFinite(y) || !title) continue;
    out.push({ year: y, amount: Number.isFinite(a) ? a : 0, org: org ?? "", title, type: type ?? "" });
  }
  return out;
}

/**
 * @returns {{
 *   ok:boolean, count:number, all:Array,
 *   maxRecord:number, since(years):Array,
 *   countAtLeast(minAmount, years):number,
 *   fieldCount(group, years):number,
 *   sum(years):number,
 * }}
 */
export async function loadRecords(now = new Date()) {
  let text;
  try {
    text = await readFile(DB, "utf8");
  } catch (err) {
    if (err.code !== "ENOENT") throw err;
    return empty();
  }
  const rows = parseLines(text);
  if (!rows.length) return empty();

  const cfg = await loadKeywords();
  for (const r of rows) {
    r.kw = matchGroups({ title: r.title }, cfg).filter((g) => g !== "분류");
  }

  const thisYear = now.getFullYear();
  // "최근 N년" 은 올해를 포함해 뒤로 N년을 봅니다(2026 · 3년 → 2023 이후).
  const since = (years) => rows.filter((r) => r.year >= thisYear - years);

  return {
    ok: true,
    count: rows.length,
    all: rows,
    maxRecord: Math.max(0, ...rows.map((r) => r.amount)),
    since,
    sum: (years) => since(years).reduce((a, r) => a + r.amount, 0),
    countAtLeast: (minAmount, years) => since(years).filter((r) => r.amount >= minAmount).length,
    fieldCount: (group, years) => since(years).filter((r) => (r.kw ?? []).includes(group)).length,
  };
}

function empty() {
  return {
    ok: false, count: 0, all: [], maxRecord: 0,
    since: () => [], sum: () => 0, countAtLeast: () => 0, fieldCount: () => 0,
  };
}
