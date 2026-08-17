// 공고문 분석기 — 첨부파일을 내려받아 참가자격과 배점표를 뽑습니다.
//
// 왜 필요한가:
//   목록 API 는 "지역제한 있음(Y)" 까지만 알려주고 어느 지역인지는 안 줍니다.
//   그 내용은 공고문 안에만 있습니다. 그걸 읽어야 "우리가 들어갈 수 있는가"를
//   추측이 아니라 확정으로 말할 수 있습니다.
//
// 무엇을 하는가:
//   ① 예측점수 높은 순으로 N건을 고른다 (전부 받을 필요가 없습니다)
//   ② 첨부파일을 내려받아 형식을 판별한다 (PDF / HWPX / HWP)
//   ③ HWP 는 한글에게 HWPX 로 저장시킨다 (표가 안 깨집니다)
//   ④ 참가자격·배점표를 뽑아 data/g2b/docs.json 에 쌓는다
//
// 한 번 읽은 공고는 다시 읽지 않습니다. 원본은 남기지 않고 뽑은 것만 보관합니다.
//
// 사용법:
//   node scripts\g2b\docs.mjs         ← 상위 20건
//   node scripts\g2b\docs.mjs 50      ← 상위 50건
//   node scripts\g2b\docs.mjs --all   ← 전부 (오래 걸립니다)
import { readFile, writeFile, mkdir, rm } from "node:fs/promises";
import { pathToFileURL, fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { download, readDocument, hancomReady, sniff } from "./lib/doc.mjs";
import { extractRequirements } from "./lib/require.mjs";
import { loadCompany } from "./lib/company.mjs";

const DATA_DIR = new URL("../../data/g2b/", import.meta.url);
const POSTS = new URL("posts.json", DATA_DIR);
const OUT = new URL("docs.json", DATA_DIR);

const DEFAULT_LIMIT = 20;
// 공고문은 보통 첫 두어 개 첨부에 들어 있습니다. 전부 받으면 시간만 걸립니다.
const MAX_FILES_PER_NOTICE = 3;
const MAX_BYTES = 30 * 1024 * 1024;

async function loadJson(url, fallback) {
  try {
    return JSON.parse(await readFile(url, "utf8"));
  } catch (err) {
    if (err.code === "ENOENT") return fallback;
    throw err;
  }
}

async function saveJson(url, value) {
  await mkdir(new URL("./", url), { recursive: true });
  await writeFile(url, JSON.stringify(value) + "\n", "utf8");
}

/**
 * 공고문일 가능성이 높은 첨부부터 봅니다.
 * 산출내역서·청렴서약서 같은 것보다 제안요청서·공고문에 우리가 찾는 내용이 있습니다.
 */
function rankFiles(files) {
  const score = (name) => {
    const n = String(name ?? "");
    if (/제안요청|과업지시|과업내용|입찰공고|공고문|규격서/.test(n)) return 0;
    if (/산출|내역|서약|청렴|양식|서식|위임|증명/.test(n)) return 3;
    return 1;
  };
  return [...(files ?? [])].sort((a, b) => score(a.name) - score(b.name));
}

/** 공고 1건 처리 */
async function analyze(item, workDir) {
  const files = rankFiles(item.files).slice(0, MAX_FILES_PER_NOTICE);
  if (!files.length) {
    return { ok: false, note: "첨부파일이 없습니다", kinds: [] };
  }

  const kinds = [];
  let best = null;

  for (const f of files) {
    let buf;
    try {
      buf = await download(f.url);
    } catch (err) {
      kinds.push({ name: f.name, kind: "?", note: `내려받기 실패: ${err.message}` });
      continue;
    }
    if (buf.length > MAX_BYTES) {
      kinds.push({ name: f.name, kind: sniff(buf), note: "파일이 너무 큽니다" });
      continue;
    }

    const doc = await readDocument(buf, { workDir });
    kinds.push({ name: f.name, kind: doc.kind, note: doc.note });
    if (!doc.ok || !doc.text) continue;

    const req = extractRequirements(doc.text, doc.tables);
    const filled = Object.values(req.found).filter(Boolean).length;
    // 여러 첨부 중 가장 많이 알아낸 것을 씁니다.
    if (!best || filled > best.filled) {
      best = { filled, req, source: f.name, chars: doc.text.length };
    }
    // 자격·배점을 다 찾았으면 나머지 첨부는 볼 필요가 없습니다.
    if (req.found.region && req.found.score) break;
  }

  if (!best) return { ok: false, note: "읽을 수 있는 공고문이 없습니다", kinds };
  return {
    ok: true,
    note: "",
    kinds,
    source: best.source,
    chars: best.chars,
    ...best.req,
  };
}

async function main() {
  const arg = process.argv[2];
  const all = arg === "--all";
  const limit = all ? Infinity : Number(arg) > 0 ? Number(arg) : DEFAULT_LIMIT;

  const payload = await loadJson(POSTS, null);
  if (!payload) throw new Error("data/g2b/posts.json 이 없습니다. 먼저 수집을 실행하세요.");

  const company = await loadCompany();
  const store = await loadJson(OUT, {});
  const items = [...(payload.posts ?? []), ...(payload.prespecs ?? [])];

  // 아직 안 읽은 것만, 예산 큰 순으로 (규모가 큰 건부터 확인하는 편이 이득입니다)
  const todo = items
    .filter((it) => it.bidNo && !store[it.bidNo])
    .filter((it) => (it.files ?? []).length)
    .sort((a, b) => (b.budget ?? b.price ?? 0) - (a.budget ?? a.price ?? 0))
    .slice(0, limit === Infinity ? undefined : limit);

  console.log(`[공고문] 전체 ${items.length}건 · 이미 읽음 ${Object.keys(store).length}건 · 이번에 ${todo.length}건`);
  if (!todo.length) {
    console.log("새로 읽을 공고가 없습니다.");
    return;
  }

  const needHancom = todo.length > 0;
  if (needHancom && process.platform === "win32") {
    const ready = await hancomReady();
    console.log(
      ready
        ? "[한글] 자동화 준비됨 — HWP 도 읽습니다"
        : "[한글] 보안 설정이 안 돼 있어 HWP 는 건너뜁니다 (공고문-분석.bat 이 안내합니다)"
    );
  } else if (needHancom) {
    console.log("[한글] Windows 가 아니라 HWP 는 건너뜁니다 (PDF·HWPX 는 읽습니다)");
  }

  const workDir = `${tmpdir()}/g2b-doc-${process.pid}`;
  let ok = 0;
  let fail = 0;

  for (const it of todo) {
    process.stdout.write(`  ${String(it.title).slice(0, 34).padEnd(34)} … `);
    try {
      const r = await analyze(it, workDir);
      store[it.bidNo] = { ...r, title: it.title, org: it.org, at: new Date().toISOString() };
      if (r.ok) {
        ok += 1;
        const bits = [];
        if (r.region) bits.push(`지역 ${r.region.value}`);
        if (r.industry?.length) bits.push(`업종 ${r.industry[0].value}`);
        if (r.record?.amount) bits.push(`실적 ${Math.round(r.record.amount / 1e6)}백만`);
        if (r.rate) bits.push(`기술${r.rate.tech}:가격${r.rate.price}`);
        if (r.scoreTable) bits.push(`배점표 ${r.scoreTable.items.length}항목`);
        console.log(bits.length ? bits.join(" · ") : "읽었으나 자격·배점 문구를 못 찾음");
      } else {
        fail += 1;
        console.log(r.note);
      }
    } catch (err) {
      fail += 1;
      store[it.bidNo] = { ok: false, note: err.message, title: it.title, at: new Date().toISOString() };
      console.log(`실패: ${err.message}`);
    }
    await saveJson(OUT, store); // 중간에 멈춰도 읽은 것은 남습니다
  }

  await rm(workDir, { recursive: true, force: true }).catch(() => {});
  console.log(`\n[완료] 읽음 ${ok}건 · 못 읽음 ${fail}건 · 누적 ${Object.keys(store).length}건`);
  console.log(`       화면-새로고침.bat 을 실행하면 공고 카드에 반영됩니다.`);
  if (!company.filled) {
    console.log(`       config/회사정보.md 를 채우면 "우리가 들어갈 수 있는가"까지 판정합니다.`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(`\n[오류] ${err.message}`);
    process.exitCode = 1;
  });
}

export { analyze, rankFiles };
