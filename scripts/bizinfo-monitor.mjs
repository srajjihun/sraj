// 기업마당(bizinfo.go.kr) 행사정보 게시판의 새 글을
// data/bizinfo-posts.json에 누적 저장한다.
import { readFile, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { runMain } from "./lib/exit.mjs";
import { pruneByAge } from "./lib/prune.mjs";
import { filterExcluded } from "./lib/exclude.mjs";

const DATA_PATH = new URL("../data/bizinfo-posts.json", import.meta.url);
const ROWS = 15;
const MIN_PAGES = 5; // 기존 글만 나와도 최소 이만큼은 스캔 (과거 글 채우기용)
const MAX_PAGES = 40; // 첫 백필용 상한. 평소엔 MIN_PAGES 근처에서 멈춘다
const RETENTION_DAYS = 30; // 등록일 기준 30일이 지난 글은 정리

// 지역 탭을 하나씩 훑어 eventId로 합친다.
//
// cou(전국)와 cap(수도권)을 모두 돈다. 기업마당의 "전국"은 대개 전국 단위로
// 열리는 행사를 따로 묶은 탭이지 모든 지역의 합집합이 아니라서, 둘 중 하나만
// 보면 나머지가 통째로 빠진다. 중복은 eventId로 걸러지므로 겹쳐도 무해하다.
//
// 아래 로그에 지역별 건수가 찍히니 어느 탭이 무엇을 물어오는지는 collect.log
// 한 줄로 확인된다. 이미 본 글만 나오는 탭은 MIN_PAGES에서 멈춰 비용이 거의
// 없다.
const AREAS = [
  { code: "cou", label: "전국" },
  { code: "cap", label: "수도권" },
];

function listUrl(cpage, area) {
  const params = new URLSearchParams({
    condition: "TITLE",
    schJrsdCodeTy: "",
    schEndAt: "",
    orderGb: "",
    sort: "",
    keyword: "",
    area,
    rows: String(ROWS),
    cpage: String(cpage),
  });
  return `https://www.bizinfo.go.kr/sie/siea/selectSIEA430View.do?${params}`;
}

function stripTags(html) {
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function parseRows(html) {
  const tbodyMatch = html.match(/<tbody>([\s\S]*?)<\/tbody>/);
  if (!tbodyMatch) return [];

  const rows = [...tbodyMatch[1].matchAll(/<tr>([\s\S]*?)<\/tr>/g)].map((m) => m[1]);
  const items = [];

  for (const row of rows) {
    const tds = [...row.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((m) => m[1]);
    if (tds.length < 6) continue;

    const [, regionHtml, titleHtml, periodHtml, orgHtml, dateHtml] = tds;
    const idMatch = titleHtml.match(/eventInfoId=(EVEN_\d+)/);
    if (!idMatch) continue;

    const periodMatch = periodHtml.match(/<span class="day">([\s\S]*?)<\/span>/);

    items.push({
      eventId: idMatch[1],
      title: stripTags(titleHtml),
      region: stripTags(regionHtml),
      period: periodMatch ? stripTags(periodMatch[1]) : "",
      org: stripTags(orgHtml),
      date: stripTags(dateHtml),
      url: `https://www.bizinfo.go.kr/sie/siea/selectSIEA430Detail.do?eventInfoId=${idMatch[1]}`,
    });
  }

  return items;
}

async function loadExisting() {
  try {
    const raw = await readFile(DATA_PATH, "utf8");
    return JSON.parse(raw);
  } catch (err) {
    if (err.code === "ENOENT") return [];
    throw err;
  }
}

// 한 지역을 훑어 seen에 합치고, 새로 추가된 건수를 돌려준다.
async function collectArea(area, seen, now) {
  let added = 0;

  for (let cpage = 1; cpage <= MAX_PAGES; cpage += 1) {
    const res = await fetch(listUrl(cpage, area.code), {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; bizinfo-monitor-bot/1.0)" },
    });
    if (!res.ok) {
      throw Object.assign(new Error(`검색 요청 실패 (cpage=${cpage}): HTTP ${res.status}`), { status: res.status });
    }
    const html = await res.text();
    const items = parseRows(html);
    if (!items.length) break;

    let pageHadNew = false;
    for (const item of items) {
      const prev = seen.get(item.eventId);
      if (prev) {
        // 행사 연기 등으로 기간이 바뀌면 갱신, firstSeenAt은 유지
        seen.set(item.eventId, { ...prev, ...item });
        continue;
      }
      seen.set(item.eventId, { ...item, firstSeenAt: now });
      added += 1;
      pageHadNew = true;
    }

    // 최소 페이지 전에는 기존 글만 나와도 계속 (초기 백필 및 누락분 보완)
    if (!pageHadNew && cpage >= MIN_PAGES) break;
  }

  return added;
}

function regionSummary(items) {
  const counts = new Map();
  for (const item of items) {
    const key = item.region || "미상";
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([region, n]) => `${region} ${n}`)
    .join(" · ");
}

async function main() {
  const existing = await loadExisting();
  const seen = new Map(existing.map((item) => [item.eventId, item]));
  const now = new Date().toISOString();

  let addedCount = 0;
  const perArea = [];
  let failed = 0;
  let lastError = null;

  for (const area of AREAS) {
    try {
      const added = await collectArea(area, seen, now);
      addedCount += added;
      perArea.push(`${area.label} +${added}`);
    } catch (err) {
      // 한 지역이 실패해도 나머지는 계속한다. 전국 조회가 막히더라도
      // 수도권까지 같이 날아가면 안 된다.
      failed += 1;
      lastError = err;
      perArea.push(`${area.label} 실패`);
      console.error(`[${area.label}] ${err.message}`);
    }
  }

  // 전부 실패했으면 저장하지 않는다 (빈손으로 파일을 건드리지 않기 위해).
  // cause 로 원인을 물려줘야 한다 - 안 그러면 연결이 안 된 것뿐인데도
  // 파싱이 깨진 것과 구분되지 않아 워크플로가 빨간불이 된다.
  if (failed === AREAS.length) {
    throw new Error("모든 지역 조회 실패 - 저장하지 않음", { cause: lastError });
  }

  const merged = [...seen.values()].sort((a, b) => (a.date < b.date ? 1 : -1));
  const filtered = filterExcluded(merged, "bizinfo");
  const pruned = pruneByAge(filtered, "date", RETENTION_DAYS);
  await writeFile(DATA_PATH, JSON.stringify(pruned, null, 2) + "\n", "utf8");

  console.log(`총 ${pruned.length}건 저장 (신규 ${addedCount}건, 제외 ${merged.length - filtered.length}건, 정리 ${filtered.length - pruned.length}건) [${perArea.join(", ")}]`);
  console.log(`  지역: ${regionSummary(pruned)}`);
}

// 직접 실행됐을 때만 main() 호출 (Windows 경로도 처리되도록 pathToFileURL 사용)
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runMain(main);
}

export { parseRows, listUrl, stripTags, AREAS };
