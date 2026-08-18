// 첨부파일 하나를 "읽을 수 있는 글자"로 바꿉니다.
//
// 흐름:
//   내려받기 → 앞 4바이트로 형식 판별 → 형식별 처리 → { text, tables }
//
// 파일명이 없거나 확장자가 틀린 경우가 실제로 있어서 이름을 믿지 않고
// 내용의 시그니처로 판별합니다.
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { parseHwpx } from "./hwpx.mjs";
import { parseHwp } from "./hwp.mjs";
import { parseDocx } from "./docx.mjs";
import { extractPdfText } from "./pdf.mjs";
import { readZip } from "./zip.mjs";

const PS1 = fileURLToPath(new URL("../hancom.ps1", import.meta.url));

/** 앞부분 바이트로 형식을 알아냅니다. */
export function sniff(buf) {
  if (buf.length < 8) return "unknown";
  if (buf.toString("latin1", 0, 4) === "%PDF") return "pdf";
  // ZIP — HWPX/DOCX/그냥 zip. mimetype 으로 갈라봅니다.
  if (buf[0] === 0x50 && buf[1] === 0x4b) {
    const head = buf.toString("latin1", 0, Math.min(buf.length, 4096));
    if (head.includes("hwp+zip") || head.includes("Contents/section")) return "hwpx";
    if (head.includes("word/document.xml")) return "docx";
    return "zip";
  }
  // OLE 복합문서 — 구형 HWP(또는 DOC/XLS). HWP 는 뒤에 "HWP Document File" 표시가 있습니다.
  if (buf.readUInt32BE(0) === 0xd0cf11e0) {
    return buf.toString("latin1", 0, Math.min(buf.length, 8192)).includes("HWP Document")
      ? "hwp"
      : "ole";
  }
  return "unknown";
}

const isWindows = process.platform === "win32";

/** 한글에게 HWP → HWPX 변환을 시킵니다. Windows + 한글 설치 PC 에서만 됩니다. */
export function hancom(args) {
  return new Promise((resolve) => {
    if (!isWindows) return resolve({ code: 2, out: "Windows 가 아닙니다" });
    const p = spawn(
      "powershell.exe",
      ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", PS1, ...args],
      { windowsHide: true }
    );
    let out = "";
    p.stdout.on("data", (d) => (out += d));
    p.stderr.on("data", (d) => (out += d));
    p.on("error", () => resolve({ code: 2, out: "powershell 을 실행하지 못했습니다" }));
    p.on("close", (code) => resolve({ code: code ?? 3, out: out.trim() }));
  });
}

/** 보안 팝업 설정이 돼 있는지 (최초 1회 필요) */
export async function hancomReady() {
  const r = await hancom(["-Check"]);
  return r.code === 0;
}

/**
 * 버퍼 하나를 해석합니다.
 * @param {Buffer} buf
 * @param {object} opts  { workDir } — HWP 변환에 임시 파일이 필요합니다
 * @returns {{kind:string, ok:boolean, text:string, tables:any[], note:string}}
 */
export async function readDocument(buf, opts = {}) {
  const kind = sniff(buf);

  if (kind === "zip") {
    // 나라장터에는 공고문 여러 개를 압축해 하나로 올리는 기관이 있습니다.
    // 실측으로 13건이 "형식을 알 수 없습니다"로 버려지고 있었습니다.
    // 압축을 풀어 안에 든 문서를 그대로 같은 방법으로 읽습니다.
    if ((opts.depth ?? 0) >= 2) {
      return { kind, ok: false, text: "", tables: [], note: "압축 안에 또 압축이 겹쳐 있습니다" };
    }
    let inner;
    try {
      inner = readZip(buf).filter((e) => !e.name.endsWith("/"));
    } catch (err) {
      return { kind, ok: false, text: "", tables: [], note: `압축을 풀지 못했습니다: ${err.message}` };
    }
    if (!inner.length) return { kind, ok: false, text: "", tables: [], note: "압축이 비어 있습니다" };

    // 공고문일 가능성이 높은 것부터 봅니다(docs.mjs 의 rankFiles 와 같은 기준).
    const rank = (n) =>
      /제안요청|과업지시|과업내용|입찰공고|공고문|규격서/.test(n) ? 0
      : /산출|내역|서약|청렴|양식|서식|위임|증명/.test(n) ? 3
      : 1;
    inner.sort((a, b) => rank(a.name) - rank(b.name));

    let best = null;
    for (const e of inner.slice(0, 5)) {
      let sub;
      try {
        sub = await readDocument(e.read(), { ...opts, depth: (opts.depth ?? 0) + 1 });
      } catch {
        continue;
      }
      if (!sub.ok || !sub.text) continue;
      if (!best || sub.text.length > best.text.length) best = sub;
    }
    if (!best) {
      return { kind, ok: false, text: "", tables: [], note: "압축 안에서 읽을 수 있는 문서를 못 찾았습니다" };
    }
    return { kind: `zip>${best.kind}`, ok: true, text: best.text, tables: best.tables, note: "" };
  }

  if (kind === "hwpx") {
    try {
      const r = parseHwpx(buf);
      return { kind, ok: true, text: r.text, tables: r.tables, note: "" };
    } catch (err) {
      return { kind, ok: false, text: "", tables: [], note: `HWPX 해석 실패: ${err.message}` };
    }
  }

  if (kind === "docx") {
    const r = parseDocx(buf);
    return { kind, ok: r.ok, text: r.text, tables: r.tables, note: r.note };
  }

  if (kind === "pdf") {
    const r = extractPdfText(buf);
    return {
      kind,
      ok: r.ok,
      text: r.text,
      tables: [],
      note: r.ok ? "" : `PDF 글자 추출 실패: ${r.note}`,
    };
  }

  if (kind === "hwp") {
    // 먼저 우리가 직접 읽습니다. 한글(한컴오피스)이 없어도, Windows 가 아니어도
    // 됩니다. 한글에 기대던 방식은 보안 팝업을 없애는 DLL 이 필요한데 그 파일이
    // 설치본에 없는 PC 가 많아 계속 막혔습니다.
    const direct = parseHwp(buf);
    if (direct.ok) {
      return { kind, ok: true, text: direct.text, tables: direct.tables, note: "" };
    }

    // 우리가 못 읽는 경우(배포용·암호 문서 등)에만 한글에게 부탁합니다.
    const dir = opts.workDir;
    if (!dir) return { kind, ok: false, text: "", tables: [], note: direct.note };
    await mkdir(dir, { recursive: true });
    const src = `${dir}/in.hwp`;
    const dst = `${dir}/out.hwpx`;
    await writeFile(src, buf);
    const r = await hancom(["-In", src, "-Out", dst]);
    if (r.code !== 0) {
      // 한글 쪽 실패 사유보다 우리가 왜 못 읽었는지가 더 쓸모 있습니다.
      // 한글은 어차피 있으면 좋고 없어도 되는 보조 수단이 됐습니다.
      return { kind, ok: false, text: "", tables: [], note: direct.note };
    }
    try {
      const conv = parseHwpx(await readFile(dst));
      return { kind, ok: true, text: conv.text, tables: conv.tables, note: "한글로 변환해 읽었습니다" };
    } catch (err) {
      return { kind, ok: false, text: "", tables: [], note: `변환본 해석 실패: ${err.message}` };
    }
  }

  if (kind === "ole") {
    // 시그니처만으로는 HWP 인지 옛 워드·엑셀인지 확실치 않은 경우가 있습니다
    // (판별은 앞 8KB 만 봅니다). 일단 HWP 로 읽어 보고, 되면 HWP 입니다.
    const direct = parseHwp(buf);
    if (direct.ok) return { kind: "hwp", ok: true, text: direct.text, tables: direct.tables, note: "" };
    return { kind, ok: false, text: "", tables: [], note: "한글 문서가 아닌 옛 오피스 파일입니다" };
  }

  return {
    kind,
    ok: false,
    text: "",
    tables: [],
    note: "형식을 알 수 없습니다",
  };
}

/** 첨부파일 URL 하나를 내려받습니다. 나라장터 첨부는 로그인 없이 GET 으로 받힙니다. */
export async function download(url, { timeoutMs = 60000 } = {}) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: ctl.signal,
      headers: { "User-Agent": "Mozilla/5.0 (compatible; g2b-radar/1.0)" },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return Buffer.from(await res.arrayBuffer());
  } finally {
    clearTimeout(timer);
  }
}
