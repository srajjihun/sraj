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
import { extractPdfText } from "./pdf.mjs";

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

  if (kind === "hwpx") {
    try {
      const r = parseHwpx(buf);
      return { kind, ok: true, text: r.text, tables: r.tables, note: "" };
    } catch (err) {
      return { kind, ok: false, text: "", tables: [], note: `HWPX 해석 실패: ${err.message}` };
    }
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
    const dir = opts.workDir;
    if (!dir) return { kind, ok: false, text: "", tables: [], note: "HWP 변환용 작업 폴더가 없습니다" };
    await mkdir(dir, { recursive: true });
    const src = `${dir}/in.hwp`;
    const dst = `${dir}/out.hwpx`;
    await writeFile(src, buf);
    const r = await hancom(["-In", src, "-Out", dst]);
    if (r.code !== 0) {
      const why =
        r.code === 2
          ? "한글(HWP)이 설치돼 있지 않거나 자동화를 쓸 수 없습니다"
          : r.code === 4
            ? "한글 보안 팝업 설정이 필요합니다 (공고문-분석.bat 이 안내합니다)"
            : `변환 실패: ${r.out}`;
      return { kind, ok: false, text: "", tables: [], note: why };
    }
    try {
      const conv = parseHwpx(await readFile(dst));
      return { kind, ok: true, text: conv.text, tables: conv.tables, note: "한글로 변환해 읽었습니다" };
    } catch (err) {
      return { kind, ok: false, text: "", tables: [], note: `변환본 해석 실패: ${err.message}` };
    }
  }

  return {
    kind,
    ok: false,
    text: "",
    tables: [],
    note:
      kind === "docx" ? "DOCX 는 아직 읽지 않습니다"
      : kind === "ole" ? "한글 문서가 아닌 옛 오피스 파일입니다"
      : "형식을 알 수 없습니다",
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
