// 이미 받아둔 원본에 키워드를 다시 적용합니다. API 를 부르지 않습니다.
//
// 왜 따로 있어야 하는가:
//   수집은 두 단계입니다.
//     ① API → data/g2b/raw/  (키워드와 무관하게 전부 보관)
//     ② raw → posts.json     (키워드로 걸러 화면에 쓸 목록을 만듦)
//   그런데 화면-새로고침.bat 은 ③ posts.json → g2b-live.html 만 했습니다.
//   그래서 키워드를 고쳐도 ②가 다시 돌지 않아 화면이 그대로였습니다.
//   실제로 "한국수출입은행 디자인업무 아웃소싱 용역"이 제외어에 걸리는데도
//   화면에 계속 남아 있었습니다.
//
//   이 파일이 ②만 다시 합니다. 나라장터를 부르지 않으므로 하루 호출 한도와
//   무관하고 몇 초면 끝납니다.
//
// 사용법:
//   node scripts\g2b\reclassify.mjs
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { loadKeywords } from "./lib/keywords.mjs";
import { buildPosts } from "./collect.mjs";

const DATA_DIR = new URL("../../data/g2b/", import.meta.url);
const RAW_BID = new URL("raw/bid.json", DATA_DIR);
const RAW_PRE = new URL("raw/prespec.json", DATA_DIR);
const AWARDS = new URL("awards.json", DATA_DIR);
const OUT = new URL("posts.json", DATA_DIR);

async function loadJson(url, fallback) {
  try {
    return JSON.parse(await readFile(url, "utf8"));
  } catch (err) {
    if (err.code === "ENOENT") return fallback;
    throw err;
  }
}

async function main() {
  const bidStore = await loadJson(RAW_BID, {});
  const preStore = await loadJson(RAW_PRE, {});
  const rawCount = Object.keys(bidStore).length + Object.keys(preStore).length;
  if (!rawCount) {
    console.log("[재분류] 보관된 원본이 없습니다 — 먼저 collect-g2b.bat 으로 수집해 주세요.");
    return;
  }

  const config = await loadKeywords();
  const groupNames = Object.keys(config.groups);
  console.log(`[재분류] 원본 ${rawCount}건에 지금 키워드를 다시 적용합니다`);
  console.log(`[키워드] ${groupNames.map((g) => `${g}(${config.groups[g].length})`).join(" · ")}`);

  const before = await loadJson(OUT, null);
  const beforeN = (before?.posts?.length ?? 0) + (before?.prespecs?.length ?? 0);

  const awardFile = await loadJson(AWARDS, null);
  const awards = Array.isArray(awardFile?.awards) ? awardFile.awards : [];

  const { posts, prespecs } = buildPosts(bidStore, preStore, config, new Date(), awards);
  const matched = [...posts, ...prespecs].filter((it) => it.last).length;

  await mkdir(new URL("./", OUT), { recursive: true });
  await writeFile(
    OUT,
    JSON.stringify({
      generatedAt: before?.generatedAt ?? new Date().toISOString(), // 수집 시각은 그대로 둡니다
      reclassifiedAt: new Date().toISOString(),
      keywordGroups: groupNames,
      failures: before?.failures ?? [],
      posts,
      prespecs,
    }) + "\n",
    "utf8"
  );

  const afterN = posts.length + prespecs.length;
  const diff = afterN - beforeN;
  console.log(
    `[완료] 공고 ${posts.length}건 · 사전규격 ${prespecs.length}건` +
      (beforeN ? ` (이전 ${beforeN}건에서 ${diff > 0 ? "+" : ""}${diff}건)` : "") +
      ` · 작년 수행업체 확인 ${matched}건`
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(`[오류] ${err.message}`);
    process.exitCode = 1;
  });
}
