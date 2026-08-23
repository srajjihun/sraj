// 영등포구청 "우리구소식" 게시판(bbsNo=40)에서 "모집"/"신청" 키워드가 포함된
// 새 글을 찾아 data/ydp-posts.json에 누적 저장한다.
import { readFile, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { runMain } from "./lib/exit.mjs";
import { pruneByAge } from "./lib/prune.mjs";
import { filterExcluded } from "./lib/exclude.mjs";
import { extractDeadline } from "./lib/deadline.mjs";

const KEYWORDS = ["모집", "신청"];
const BOARD_KEY = "2848";
const BBS_NO = "40";
const RETENTION_DAYS = 30; // 등록일 기준 30일이 지난 글은 정리
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
      deadline: extractDeadline(date, title),
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
      throw Object.assign(new Error(`검색 요청 실패 (keyword=${keyword}): HTTP ${res.status}`), { status: res.status });
    }
    const html = await res.text();
    const items = parseRows(html, keyword);

    for (const item of items) {
      const prev = seen.get(item.nttNo);
      if (prev) {
        // 재수집 시 제목/마감일이 바뀌었으면 갱신 (연장 공고 등), firstSeenAt은 유지
        // 방금 받은 원문에서 다시 뽑은 값으로 덮는다. 예전에는
        // `item.deadline ?? prev.deadline` 이라, 추출기를 고쳐도 과거
        // 오답이 영구히 남았다 - "운영기간"·"활동기간" 종료일을 신청
        // 마감으로 잡아 둔 값들이 그대로 박혀 있었다.
        seen.set(item.nttNo, { ...prev, ...item });
        continue;
      }
      seen.set(item.nttNo, { ...item, firstSeenAt: now });
      addedCount += 1;
    }
  }

  const merged = [...seen.values()].sort((a, b) => Number(b.nttNo) - Number(a.nttNo));
  // 마감일은 매번 저장된 원문에서 다시 계산한다. 값을 보존하지 않으므로
  // 추출기를 고치면 이미 저장된 글도 다음 수집에서 같이 고쳐진다.
  for (const it of merged) {
    it.deadline = extractDeadline(it.date, it.title);
  }
  const filtered = filterExcluded(merged, "ydp");
  const pruned = pruneByAge(filtered, "date", RETENTION_DAYS);
  await writeFile(DATA_PATH, JSON.stringify(pruned, null, 2) + "\n", "utf8");

  console.log(`총 ${pruned.length}건 저장 (신규 ${addedCount}건, 제외 ${merged.length - filtered.length}건, 정리 ${filtered.length - pruned.length}건)`);
}

// 직접 실행됐을 때만 main() 호출 (Windows 경로도 처리되도록 pathToFileURL 사용)
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runMain(main);
}

export { parseRows, searchUrl, stripTags };
