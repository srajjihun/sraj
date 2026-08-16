// 정부24 "지자체 소식"에서 서울특별시 전역의 모집/신청 글을 찾아
// data/govkr-posts.json에 누적 저장한다.
// 검색이 날짜범위(srchStDtFmt~srchEdDtFmt)를 지원해서, 매일 최근 며칠치만
// 좁혀서 검색하면 페이지를 많이 넘길 필요가 없다.
import { readFile, writeFile } from "node:fs/promises";
import { pruneByDeadlineOrAge } from "./lib/prune.mjs";
import { extractDeadline } from "./lib/deadline.mjs";

const DATA_PATH = new URL("../data/govkr-posts.json", import.meta.url);
const KEYWORDS = ["모집", "신청"];
const SIDO = "1100000000"; // 서울특별시
const LOOKBACK_DAYS = 5; // 매일 실행되지만 여유를 두고 최근 5일치를 재확인
const MAX_PAGES = 10; // 좁은 날짜범위라 보통 1~2페이지면 끝나지만 안전장치로 넉넉히
const MAX_AGE_DAYS = 20; // 마감일을 못 찾은 글은 등록일 기준으로 정리
const GRACE_DAYS = 14; // 마감일을 찾은 글은 마감 후 14일 지나면 정리

function fmtDate(d) {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}.${m}.${day}`;
}

function listUrl(keyword, pageIndex, startDate, endDate) {
  const params = new URLSearchParams({
    srchOrder: "",
    sido: SIDO,
    signgu: "0000000000",
    srchArea: SIDO,
    srchSidoArea: "",
    srchStDtFmt: fmtDate(startDate),
    srchEdDtFmt: fmtDate(endDate),
    srchTxt: keyword,
    initSrch: "false",
    pageIndex: String(pageIndex),
  });
  return `https://www.gov.kr/portal/locgovNews?${params}`;
}

function decodeEntities(str) {
  return str.replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'");
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

function parseItems(html, keyword) {
  const chunks = html.split('<dt class="pcb">').slice(1);
  const items = [];

  for (const chunk of chunks) {
    const linkMatch = chunk.match(/<a href="https:\/\/www\.gov\.kr\/portal\/locgovNews\/(\d+)\?[^"]*"[^>]*>([\s\S]*?)<\/a>/);
    if (!linkMatch) continue;

    const summaryMatch = chunk.match(/<dd class="cont">([\s\S]*?)<\/dd>/);
    const orgMatch = chunk.match(/<div class="sorting-area">\s*<span>\s*([\s\S]*?)<\/span>/);
    const dateMatch = chunk.match(/등록일\s*([\d.]{10})/);
    const sourceMatch = chunk.match(/<a href="([^"]+)"[^>]*>\s*원문보기/);

    const id = linkMatch[1];
    const title = stripTags(linkMatch[2]);
    const date = dateMatch ? dateMatch[1].replace(/\./g, "-") : "";
    const summary = summaryMatch ? stripTags(summaryMatch[1]) : "";

    items.push({
      id,
      title,
      org: orgMatch ? stripTags(orgMatch[1]) : "",
      date,
      summary,
      deadline: extractDeadline(date, summary, title),
      url: sourceMatch ? decodeEntities(sourceMatch[1]) : `https://www.gov.kr/portal/locgovNews/${id}`,
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
  const seen = new Map(existing.map((item) => [item.id, item]));
  const now = new Date().toISOString();
  let addedCount = 0;

  const endDate = new Date();
  const startDate = new Date(endDate.getTime() - LOOKBACK_DAYS * 86400000);

  for (const keyword of KEYWORDS) {
    for (let pageIndex = 1; pageIndex <= MAX_PAGES; pageIndex += 1) {
      const res = await fetch(listUrl(keyword, pageIndex, startDate, endDate), {
        headers: { "User-Agent": "Mozilla/5.0 (compatible; govkr-monitor-bot/1.0)" },
      });
      if (!res.ok) {
        throw new Error(`검색 요청 실패 (keyword=${keyword}, page=${pageIndex}): HTTP ${res.status}`);
      }
      const html = await res.text();
      const items = parseItems(html, keyword);
      if (!items.length) break;

      let pageHadNew = false;
      for (const item of items) {
        const prev = seen.get(item.id);
        if (prev) {
          // 재수집 시 요약/마감일 갱신, firstSeenAt은 유지
          seen.set(item.id, { ...prev, ...item, deadline: item.deadline ?? prev.deadline ?? null });
          continue;
        }
        seen.set(item.id, { ...item, firstSeenAt: now });
        addedCount += 1;
        pageHadNew = true;
      }

      if (!pageHadNew) break;
    }
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

export { parseItems, listUrl, stripTags };
