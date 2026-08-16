// 기업마당(bizinfo.go.kr) 행사정보 게시판에서 수도권(area=cap) 새 글을
// data/bizinfo-posts.json에 누적 저장한다.
import { readFile, writeFile } from "node:fs/promises";

const DATA_PATH = new URL("../data/bizinfo-posts.json", import.meta.url);
const ROWS = 15;
const MAX_PAGES = 5; // 한 번 실행에 최대 75건까지 확인

function listUrl(cpage) {
  const params = new URLSearchParams({
    condition: "TITLE",
    schJrsdCodeTy: "",
    schEndAt: "",
    orderGb: "",
    sort: "",
    keyword: "",
    area: "cap",
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

async function main() {
  const existing = await loadExisting();
  const seen = new Map(existing.map((item) => [item.eventId, item]));
  const now = new Date().toISOString();
  let addedCount = 0;

  for (let cpage = 1; cpage <= MAX_PAGES; cpage += 1) {
    const res = await fetch(listUrl(cpage), {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; bizinfo-monitor-bot/1.0)" },
    });
    if (!res.ok) {
      throw new Error(`검색 요청 실패 (cpage=${cpage}): HTTP ${res.status}`);
    }
    const html = await res.text();
    const items = parseRows(html);
    if (!items.length) break;

    let pageHadNew = false;
    for (const item of items) {
      if (seen.has(item.eventId)) continue;
      seen.set(item.eventId, { ...item, firstSeenAt: now });
      addedCount += 1;
      pageHadNew = true;
    }

    if (!pageHadNew) break;
  }

  const merged = [...seen.values()].sort((a, b) => (a.date < b.date ? 1 : -1));
  await writeFile(DATA_PATH, JSON.stringify(merged, null, 2) + "\n", "utf8");

  console.log(`총 ${merged.length}건 저장 (신규 ${addedCount}건)`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

export { parseRows, listUrl, stripTags };
