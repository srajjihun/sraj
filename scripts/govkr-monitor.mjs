// 정부24 "지자체 소식"에서 서울특별시 전역의 모집/신청 글을 찾아
// data/govkr-posts.json에 누적 저장한다.
// 검색이 날짜범위(srchStDtFmt~srchEdDtFmt)를 지원해서, 매일 최근 며칠치만
// 좁혀서 검색하면 페이지를 많이 넘길 필요가 없다.
import { readFile, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { pruneByAge } from "./lib/prune.mjs";
import { filterExcluded } from "./lib/exclude.mjs";
import { extractDeadline } from "./lib/deadline.mjs";

const DATA_PATH = new URL("../data/govkr-posts.json", import.meta.url);
const KEYWORDS = ["모집", "신청"];
const SIDO = "1100000000"; // 서울특별시
const LOOKBACK_DAYS = 30; // 보존기간(RETENTION_DAYS)과 맞춰 그 기간 글은 항상 채워지도록
const MIN_PAGES = 3; // 기존 글만 나와도 최소 이만큼은 스캔 (과거 글 채우기용)
const MAX_PAGES = 25; // 20일치면 페이지가 꽤 되므로 넉넉히
const RETENTION_DAYS = 30; // 등록일 기준 30일이 지난 글은 정리

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

function toAbsolute(href) {
  if (!href) return href;
  if (/^https?:\/\//i.test(href)) return href;
  if (href.startsWith("//")) return `https:${href}`;
  return new URL(href, "https://www.gov.kr/").href;
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
    // href는 절대주소(브라우저 저장본)와 상대주소(실제 서버 응답) 둘 다 올 수 있다
    const linkMatch = chunk.match(/<a href="[^"]*locgovNews\/(\d+)[^"]*"[^>]*>([\s\S]*?)<\/a>/);
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
      url: sourceMatch
        ? toAbsolute(decodeEntities(sourceMatch[1]))
        : `https://www.gov.kr/portal/locgovNews/${id}`,
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
          // 방금 받은 원문에서 다시 뽑은 값으로 덮는다. 예전에는
          // `item.deadline ?? prev.deadline` 이라, 추출기를 고쳐도 과거
          // 오답이 영구히 남았다 - "운영기간"·"활동기간" 종료일을 신청
          // 마감으로 잡아 둔 값들이 그대로 박혀 있었다.
          seen.set(item.id, { ...prev, ...item });
          continue;
        }
        seen.set(item.id, { ...item, firstSeenAt: now });
        addedCount += 1;
        pageHadNew = true;
      }

      // 최소 페이지 전에는 기존 글만 나와도 계속 (초기 백필 및 누락분 보완)
      if (!pageHadNew && pageIndex >= MIN_PAGES) break;
    }
  }

  const merged = [...seen.values()].sort((a, b) => (a.date < b.date ? 1 : -1));
  // 마감일은 매번 저장된 원문에서 다시 계산한다. 값을 보존하지 않으므로
  // 추출기를 고치면 이미 저장된 글도 다음 수집에서 같이 고쳐진다.
  for (const it of merged) {
    it.deadline = extractDeadline(it.date, it.summary, it.title);
  }
  const filtered = filterExcluded(merged, "govkr");
  const pruned = pruneByAge(filtered, "date", RETENTION_DAYS);
  await writeFile(DATA_PATH, JSON.stringify(pruned, null, 2) + "\n", "utf8");

  console.log(`총 ${pruned.length}건 저장 (신규 ${addedCount}건, 제외 ${merged.length - filtered.length}건, 정리 ${filtered.length - pruned.length}건)`);
}

// 직접 실행됐을 때만 main() 호출 (Windows 경로도 처리되도록 pathToFileURL 사용)
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

export { parseItems, listUrl, stripTags };
