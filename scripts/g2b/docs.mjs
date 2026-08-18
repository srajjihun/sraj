// 공고문 분석기 — 첨부파일을 내려받아 참가자격과 배점표를 뽑습니다.
//
// 왜 필요한가:
//   목록 API 는 "지역제한 있음(Y)" 까지만 알려주고 어느 지역인지는 안 줍니다.
//   그 내용은 공고문 안에만 있습니다. 그걸 읽어야 "우리가 들어갈 수 있는가"를
//   추측이 아니라 확정으로 말할 수 있습니다.
//
// 무엇을 하는가:
//   ① 예산 큰 순으로 N건을 고른다 (전부 받을 필요가 없습니다)
//   ② 첨부파일을 내려받아 형식을 판별한다 (PDF / HWPX / HWP)
//   ③ 형식별로 직접 읽는다 — 한글(한컴오피스)이 없어도 됩니다
//   ④ 참가자격·배점표를 뽑아 data/g2b/docs.json 에 쌓는다
//
// 한 번 읽은 공고는 다시 읽지 않습니다 — 해석기가 좋아진 경우(VERSION)만 예외입니다.
// 원본 파일은 남기지 않고 뽑아낸 것만 보관합니다.
//
// 사용법:
//   node scripts\g2b\docs.mjs         ← 상위 20건
//   node scripts\g2b\docs.mjs 50      ← 상위 50건
//   node scripts\g2b\docs.mjs --all   ← 전부 (오래 걸립니다)
import { readFile, writeFile, mkdir, rm } from "node:fs/promises";
import { pathToFileURL, fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { download, readDocument, sniff } from "./lib/doc.mjs";
import { extractRequirements } from "./lib/require.mjs";
import { loadCompany } from "./lib/company.mjs";

const DATA_DIR = new URL("../../data/g2b/", import.meta.url);
const POSTS = new URL("posts.json", DATA_DIR);
const OUT = new URL("docs.json", DATA_DIR);

// 해석기 판(版). 해석 방식이 좋아지면 이 숫자를 올립니다. 그러면 예전에
// 읽어 둔 공고도 다시 읽습니다 — 안 그러면 "이미 읽음"으로 남아서 개선된
// 결과가 영원히 반영되지 않습니다. 실제로 그 일이 있었습니다: 한글 자동화가
// 막혀 HWP 를 못 읽은 100건이 전부 "읽음"으로 저장돼 있었습니다.
//   1 → 최초
//   2 → HWP 를 한글 없이 직접 읽음 / 업종 오탐(나라장터 상투문구) 제거
const VERSION = 2;

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

  // 예산 큰 순으로 (규모가 큰 건부터 확인하는 편이 이득입니다).
  // 아직 안 읽은 것을 먼저, 그다음 해석기가 좋아져서 다시 읽어야 하는 것.
  const byBudget = (a, b) => (b.budget ?? b.price ?? 0) - (a.budget ?? a.price ?? 0);
  const withFiles = items.filter((it) => it.bidNo && (it.files ?? []).length);
  const fresh = withFiles.filter((it) => !store[it.bidNo]).sort(byBudget);
  const stale = withFiles.filter((it) => store[it.bidNo] && (store[it.bidNo].v ?? 0) < VERSION).sort(byBudget);
  const todo = [...fresh, ...stale].slice(0, limit === Infinity ? undefined : limit);

  console.log(
    `[공고문] 전체 ${items.length}건 · 이미 읽음 ${Object.keys(store).length}건 · 이번에 ${todo.length}건` +
      (stale.length ? ` (그중 다시 읽기 ${Math.min(stale.length, Math.max(0, todo.length - fresh.length))}건)` : "")
  );
  if (stale.length && fresh.length < todo.length) {
    console.log(`         해석기가 좋아져서 예전에 읽은 ${stale.length}건도 다시 읽습니다.`);
  }
  if (!todo.length) {
    console.log("새로 읽을 공고가 없습니다.");
    return;
  }

  const workDir = `${tmpdir()}/g2b-doc-${process.pid}`;
  let ok = 0;
  let fail = 0;

  for (const it of todo) {
    process.stdout.write(`  ${String(it.title).slice(0, 34).padEnd(34)} … `);
    try {
      const r = await analyze(it, workDir);
      store[it.bidNo] = { ...r, v: VERSION, title: it.title, org: it.org, at: new Date().toISOString() };
      if (r.ok) {
        ok += 1;
        const bits = [];
        if (r.region) bits.push(`지역 ${r.region.value}`);
        if (r.industry?.length) bits.push(`업종 ${r.industry[0].value}`);
        if (r.record?.amount) bits.push(`실적 ${Math.round(r.record.amount / 1e6)}백만`);
        if (r.rate) bits.push(`기술${r.rate.tech}:가격${r.rate.price}`);
        if (r.scoreTable) bits.push(`배점표 ${r.scoreTable.items.length}항목`);
        if (r.credits?.length) bits.push(`신인도 ${r.credits.map((c) => c.term).join("·")}`);
        console.log(bits.length ? bits.join(" · ") : "읽었으나 자격·배점 문구를 못 찾음");
      } else {
        fail += 1;
        console.log(r.note);
      }
    } catch (err) {
      fail += 1;
      store[it.bidNo] = { ok: false, v: VERSION, note: err.message, title: it.title, at: new Date().toISOString() };
      console.log(`실패: ${err.message}`);
    }
    await saveJson(OUT, store); // 중간에 멈춰도 읽은 것은 남습니다
  }

  await rm(workDir, { recursive: true, force: true }).catch(() => {});
  console.log(`\n[완료] 읽음 ${ok}건 · 못 읽음 ${fail}건 · 누적 ${Object.keys(store).length}건`);

  // 어떤 형식이 실제로 읽히고 있는지. HWP 가 0 이면 뭔가 잘못된 것입니다.
  const byKind = new Map();
  for (const d of Object.values(store)) {
    for (const k of d?.kinds ?? []) {
      const key = k.kind ?? "?";
      const cur = byKind.get(key) ?? { ok: 0, no: 0 };
      if (k.note) cur.no += 1; else cur.ok += 1;
      byKind.set(key, cur);
    }
  }
  if (byKind.size) {
    const parts = [...byKind.entries()]
      .sort((a, b) => b[1].ok - a[1].ok)
      .map(([k, v]) => `${k} ${v.ok}건${v.no ? `(못 읽음 ${v.no})` : ""}`);
    console.log(`       읽은 첨부 형식 — ${parts.join(" · ")}`);
  }
  console.log(`       화면-새로고침.bat 을 실행하면 공고 카드에 반영됩니다.`);
  if (!company.filled) {
    console.log(`       config/회사정보.md 를 채우면 "우리가 들어갈 수 있는가"까지 판정합니다.`);
  }

  // 지금까지 읽은 전체(누적)에서 신인도 인증이 몇 번 나왔는지.
  // "인증서류 뭐가 더 필요해?"에 추측이 아니라 실제 빈도로 답하기 위한 것입니다.
  const tally = new Map();
  let scored = 0;
  for (const d of Object.values(store)) {
    if (!d?.ok) continue;
    scored += 1;
    for (const c of d.credits ?? []) tally.set(c.term, (tally.get(c.term) ?? 0) + 1);
  }
  if (tally.size) {
    const rows = [...tally.entries()].sort((a, b) => b[1] - a[1]);
    console.log(`\n[신인도] 지금까지 읽은 공고문 ${scored}건 중 언급된 인증 (많은 순):`);
    for (const [term, n] of rows) console.log(`       ${term} — ${n}건`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(`\n[오류] ${err.message}`);
    process.exitCode = 1;
  });
}

export { analyze, rankFiles };
