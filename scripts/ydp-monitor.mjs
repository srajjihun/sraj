// 영등포구청 "우리구소식" 게시판(bbsNo=40)에서 "모집"/"신청" 키워드가 포함된
// 새 글을 찾아 data/ydp-posts.json에 누적 저장한다.
import { readFile, writeFile } from "node:fs/promises";
import { pruneByAge } from "./lib/prune.mjs";

const KEYWORDS = ["모집", "신청"];
const BOARD_KEY = "2848";
const BBS_NO = "40";
const MAX_AGE_DAYS = 20; // 신청기간 정보가 없어 등록일 기준으로 오래된 글 정리
const DATA_PATH = new URL("../data/ydp-posts.json", import.meta.url);

function searchUrl(keyword) {
  const params = new URLSearchParams({
    key: BOARD_KEY,
    bbsNo: BBS_NO,
    searchCnd: "SJ",
    searchKrwd: keyword,
    pageUnit: "50",
  });
  return `https://www.ydp.go.kr/www/selectBbsNttList.do?${params}`;
}

function stripTags(html) {
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function parseRows(html, keyword) {
  const tbodyMatch = html.match(/<tbody class="text_center">([\s\S]*?)<\/tbody>/);
  if (!tbodyMatch) return [];

  const rows = [...tbodyMatch[1].matchAll(/<tr>([\s\S]*?)<\/tr>/g)].map((m) => m[1]);
  const items = [];

  for (const row of rows) {
    const tds = [...row.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((m) => m[1]);
    if (tds.length < 4) continue;

    const [, subjectHtml, deptHtml, dateHtml] = tds;
    const linkMatch = subjectHtml.match(/nttNo=(\d+)/);
    if (!linkMatch) continue;

    const nttNo = linkMatch[1];
    const title = stripTags(subjectHtml.replace(/<span[^>]*>\s*NEW\s*<\/span>/i, ""));
    const dept = stripTags(deptHtml);
    const dateMatch = dateHtml.match(/datetime="([^"]+)"/);
    const date = dateMatch ? dateMatch[1] : stripTags(dateHtml);

    items.push({
      nttNo,
      title,
      dept,
      date,
      url: `https://www.ydp.go.kr/www/selectBbsNttView.do?bbsNo=${BBS_NO}&key=${BOARD_KEY}&nttNo=${nttNo}`,
      matchedKeyword: keyword,
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
  const seen = new Map(existing.map((item) => [item.nttNo, item]));
  const now = new Date().toISOString();
  let addedCount = 0;

  for (const keyword of KEYWORDS) {
    const res = await fetch(searchUrl(keyword), {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; ydp-monitor-bot/1.0)" },
    });
    if (!res.ok) {
      throw new Error(`검색 요청 실패 (keyword=${keyword}): HTTP ${res.status}`);
    }
    const html = await res.text();
    const items = parseRows(html, keyword);

    for (const item of items) {
      if (seen.has(item.nttNo)) continue;
      seen.set(item.nttNo, { ...item, firstSeenAt: now });
      addedCount += 1;
    }
  }

  const merged = [...seen.values()].sort((a, b) => Number(b.nttNo) - Number(a.nttNo));
  const pruned = pruneByAge(merged, "date", MAX_AGE_DAYS);
  await writeFile(DATA_PATH, JSON.stringify(pruned, null, 2) + "\n", "utf8");

  console.log(`총 ${pruned.length}건 저장 (신규 ${addedCount}건, 정리 ${merged.length - pruned.length}건)`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

export { parseRows, searchUrl, stripTags };
