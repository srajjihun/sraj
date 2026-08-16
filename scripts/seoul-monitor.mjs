// 서울특별시 "분야별 새소식"에서 모집/신청 카테고리로 분류된 새 글을 찾아
// data/seoul-posts.json에 누적 저장한다.
import { readFile, writeFile } from "node:fs/promises";
import { pruneByDeadlineOrAge } from "./lib/prune.mjs";
import { extractDeadline } from "./lib/deadline.mjs";

const DATA_PATH = new URL("../data/seoul-posts.json", import.meta.url);
const PAGE_SIZE = 10;
const MAX_PAGES = 5; // 한 번 실행에 최대 50건까지 확인
const MAX_AGE_DAYS = 20; // 마감일을 못 찾은 글은 등록일 기준으로 정리
const GRACE_DAYS = 14; // 마감일을 찾은 글은 마감 후 14일 지나면 정리

function listUrl(fetchStart) {
  const params = new URLSearchParams({
    fetchStart: String(fetchStart),
    siteId: "",
    detailChktxt: "모집|신청",
    sDate: "",
    eDate: "",
    searchWord: "",
  });
  // detailChk는 같은 키로 두 번 필요해서 URLSearchParams에 append로 추가
  params.append("detailChk", "모집");
  params.append("detailChk", "신청");
  return `https://www.seoul.go.kr/realmnews/in/list.do?${params}`;
}

function stripTags(html) {
  return html
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function parseItems(html) {
  const blocks = html.split('<div class="item">').slice(1);
  const items = [];

  for (const block of blocks) {
    const hrefMatch = block.match(/<a href="(https:\/\/[^"]+)"/);
    const subjectMatch = block.match(/<em class="subject">([\s\S]*?)<\/em>/);
    const dateMatch = block.match(/<em class="date">\s*([\d-]{10})/);
    if (!hrefMatch || !subjectMatch || !dateMatch) continue;

    const catMatch = block.match(/<i class="p_work">\[([^\]]+)\]<\/i>/);
    const summaryMatch = block.match(/<span class="ais-cont">([\s\S]*?)<\/span>/);
    const summary = summaryMatch ? stripTags(summaryMatch[1]) : "";
    const title = stripTags(subjectMatch[1]);
    const date = dateMatch[1];

    items.push({
      url: hrefMatch[1],
      title,
      date,
      category: catMatch ? catMatch[1] : "",
      summary,
      deadline: extractDeadline(date, summary, title),
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
  const seen = new Map(existing.map((item) => [item.url, item]));
  const now = new Date().toISOString();
  let addedCount = 0;

  for (let page = 0; page < MAX_PAGES; page += 1) {
    const fetchStart = page * PAGE_SIZE + 1;
    const res = await fetch(listUrl(fetchStart), {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; seoul-monitor-bot/1.0)" },
    });
    if (!res.ok) {
      throw new Error(`검색 요청 실패 (fetchStart=${fetchStart}): HTTP ${res.status}`);
    }
    const html = await res.text();
    const items = parseItems(html);
    if (!items.length) break;

    let pageHadNew = false;
    for (const item of items) {
      const prev = seen.get(item.url);
      if (prev) {
        // AI 요약이 늦게 붙거나 마감이 연장된 경우 갱신, firstSeenAt은 유지
        seen.set(item.url, { ...prev, ...item, deadline: item.deadline ?? prev.deadline ?? null });
        continue;
      }
      seen.set(item.url, { ...item, firstSeenAt: now });
      addedCount += 1;
      pageHadNew = true;
    }

    if (!pageHadNew) break; // 이 페이지가 전부 기존 글이면 더 이전 페이지도 다 본 것으로 간주
  }

  const merged = [...seen.values()].sort((a, b) => (a.date < b.date ? 1 : -1));
  // 추출기가 개선되면 기존 저장분에도 소급 적용
  for (const it of merged) {
    if (it.deadline === undefined || it.deadline === null) {
      it.deadline = extractDeadline(it.date, it.summary, it.title);
    }
  }
  const pruned = pruneByDeadlineOrAge(merged, {
    deadlineField: "deadline",
    dateField: "date",
    graceDays: GRACE_DAYS,
    maxAgeDays: MAX_AGE_DAYS,
  });
  await writeFile(DATA_PATH, JSON.stringify(pruned, null, 2) + "\n", "utf8");

  console.log(`총 ${pruned.length}건 저장 (신규 ${addedCount}건, 정리 ${merged.length - pruned.length}건)`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

export { parseItems, listUrl, stripTags, extractDeadline };
