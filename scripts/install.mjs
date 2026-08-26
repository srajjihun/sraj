// 새 PC 최초 설치.  모집신청-설치.bat 이 이 파일을 부른다.
//
// 왜 배치 파일이 아니라 여기서 하는가:
// cmd.exe 는 .bat 을 조각내어 읽으면서 다음 위치를 바이트 오프셋으로 기억한다.
// chcp 65001 에서 여러 바이트짜리 한글이 조각 경계에 걸리면 그 오프셋이 어긋나
// 다음 줄을 글자 중간부터 읽는다. 그러면 한글 조각이 명령어로 실행되면서
//   '창을' is not recognized as an internal or external command
// 같은 오류가 난다. 실제로 이 설치 파일의 한글 버전에서 그렇게 됐다.
// Node 는 소스를 UTF-8 로 통째 읽으므로 그런 문제가 없다.
//
// 배치 쪽에는 준비물 확인만 남기고, 나머지는 전부 여기서 한다.

import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { createInterface } from "node:readline";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = dirname(dirname(fileURLToPath(import.meta.url)));
const VBS = join(REPO, "collect-silent.vbs");
const BAT = join(REPO, "collect.bat");
const LOG = join(REPO, "logs", "collect.log");

// GitHub 쪽 자동 수집(.github/workflows/ydp-monitor.yml)과 맞춘 시각.
// PC 가 이 중 한 시각에 켜져 있으면, 그날 GitHub 러너가 해외 IP 차단으로
// 놓친 소스를 국내 IP 인 PC 가 대신 주워 온다.
const TIMES = ["09:40", "13:00", "17:00"];

// 작업 이름에는 콜론을 쓸 수 없다. 작업 스케줄러는 각 작업을
// C:\Windows\System32\Tasks 아래 파일로 저장하므로 이름이 유효한 파일명이어야
// 하고, 파일명 금지문자( \ / : * ? " < > | )가 들어가면 생성이 실패한다.
// "모집신청 수집 (09:40)" 으로 만들었다가 세 개 모두 실패했다. 콜론이 없던
// "(로그온)" 만 성공해서 원인이 드러났다.
const TASK = (suffix) => `모집신청 수집 (${String(suffix).replace(/[\\/:*?"<>|]/g, "-")})`;

// 예전 버전이 만들던 작업들. 남겨 두면 시간대가 뒤섞여 헷갈린다.
const OBSOLETE = ["모집신청 수집 (매일)", "모집신청 수집 (10-00)"];

function line(s = "") {
  console.log(s);
}

// 한글은 화면에서 두 칸을 먹으므로 padEnd 로는 줄이 안 맞는다.
function pad(s, width) {
  let w = 0;
  for (const ch of s) w += /[\u1100-\u11FF\u3000-\u303F\uAC00-\uD7AF\uFF00-\uFF60]/.test(ch) ? 2 : 1;
  return s + " ".repeat(Math.max(0, width - w));
}

// 실패해도 죽지 않는 실행. 성공 여부와 함께 오류 메시지를 돌려준다.
//
// 처음엔 stdio: "ignore" 로 오류를 통째로 버렸는데, 그 탓에 작업 등록이
// 왜 실패했는지 화면에 아무것도 안 남아 원인을 짐작으로 좁혀야 했다.
// 실패했을 때만이라도 사유가 보여야 한다.
function run(cmd, args) {
  try {
    execFileSync(cmd, args, { stdio: ["ignore", "ignore", "pipe"] });
    return { ok: true, err: "" };
  } catch (e) {
    const err = String(e.stderr || e.message || "").trim().split(/\r?\n/).filter(Boolean)[0] || "";
    return { ok: false, err };
  }
}

function gitConfig(key) {
  try {
    return execFileSync("git", ["config", "--global", key], { encoding: "utf8" }).trim();
  } catch {
    return "";
  }
}

async function ensureAuthor() {
  line("  [1/3] 커밋 작성자를 확인합니다.");

  let name = gitConfig("user.name");
  let email = gitConfig("user.email");

  if (!name || !email) {
    line();
    line("        GitHub 에 올릴 때 쓸 이름과 이메일이 필요합니다.");
    line("        이걸 빼먹으면 수집은 되는데 업로드에서만 조용히 멈춥니다.");
    line();

    // readline/promises 의 question() 은 두 번째 호출부터 입력을 놓치는
    // 경우가 있다(파이프 입력에서 재현됨 - 약속이 영영 안 풀려 설치가 멈춘다).
    // 비동기 이터레이터로 한 줄씩 당겨오면 그런 일이 없고, 입력이 끊겨도
    // 빈 문자열로 끝나 멈추지 않는다.
    const rl = createInterface({ input: process.stdin });
    const lines = rl[Symbol.asyncIterator]();
    const ask = async (prompt) => {
      process.stdout.write(prompt);
      const { value, done } = await lines.next();
      process.stdout.write("\n");
      return done ? "" : String(value).trim();
    };

    try {
      // 세 번까지만 다시 묻는다. 입력이 아예 없는 환경에서 무한히 돌지 않도록.
      for (let i = 0; i < 3 && !name; i += 1) name = await ask("        이름   : ");
      for (let i = 0; i < 3 && !email; i += 1) email = await ask("        이메일 : ");
    } finally {
      rl.close();
    }

    if (!name || !email) {
      line();
      line("        이름·이메일을 받지 못했습니다. 아래 두 줄을 직접 실행한 뒤");
      line("        이 설치 파일을 다시 실행해 주세요.");
      line();
      line('          git config --global user.name "이름"');
      line('          git config --global user.email "메일주소"');
      line();
      return false;
    }

    run("git", ["config", "--global", "user.name", name]);
    run("git", ["config", "--global", "user.email", email]);
  }

  line(`        ${name} <${email}>`);
  line();
  return true;
}

// schtasks 를 셸을 거치지 않고 직접 부른다. 배치에서 하던 따옴표 중첩
// (\"%VBS%\") 이 필요 없어져 인용 실수가 원천적으로 사라진다.
function registerTasks() {
  line(`  [2/3] 자동 실행을 등록합니다 (매일 ${TIMES.join(" · ")}, 켤 때).`);

  if (!existsSync(VBS)) {
    line("        [오류] collect-silent.vbs 를 찾을 수 없습니다.");
    line("               저장소가 제대로 받아졌는지 확인해 주세요.");
    return false;
  }

  for (const name of OBSOLETE) run("schtasks", ["/Delete", "/TN", name, "/F"]);

  const target = `wscript.exe "${VBS}"`;
  let ok = 0;

  const create = (suffix, extra) => {
    const name = TASK(suffix);
    const made = run("schtasks", ["/Create", "/TN", name, "/TR", target, ...extra, "/F"]);
    // errorlevel 을 믿지 않고 실제로 조회해 확인한다.
    if (run("schtasks", ["/Query", "/TN", name]).ok) {
      line(`        ${pad(suffix, 8)} - 등록했습니다.`);
      ok += 1;
    } else {
      line(`        ${pad(suffix, 8)} - [경고] 등록에 실패했습니다.`);
      if (made.err) line(`                   ${made.err}`);
    }
  };

  create("로그온", ["/SC", "ONLOGON"]);
  for (const t of TIMES) create(t, ["/SC", "DAILY", "/ST", t]);

  if (ok === 0) {
    line();
    line('        자동 등록이 안 됐습니다. SETUP.md 의 "직접 하려면" 을 보고');
    line("        작업 스케줄러에서 직접 등록해 주세요.");
  }
  line();
  return ok > 0;
}

function testRun() {
  line("  [3/3] 한 번 실행해 봅니다. 1~2분 걸립니다.");
  line("        GitHub 로그인 창이 뜨면 로그인해 주세요. 처음 한 번만입니다.");
  line("        (창이 다른 창 뒤에 숨어 있을 수 있습니다)");
  line();

  // 창 없이 도는 vbs 가 아니라 bat 을 직접 부른다. 그래야 로그인 창과
  // 진행 상황이 이 화면에 보인다.
  const r = spawnSync("cmd", ["/c", BAT], { stdio: "inherit" });
  return r.status === 0;
}

function showTail(n = 14) {
  if (!existsSync(LOG)) {
    line("  [경고] logs\\collect.log 가 만들어지지 않았습니다.");
    line("         수집이 한 번도 돌지 않은 것입니다.");
    return;
  }
  const lines = readFileSync(LOG, "utf8").split(/\r?\n/).filter(Boolean);
  line("  ─ 수집 기록 마지막 " + n + "줄 ─");
  for (const l of lines.slice(-n)) line("    " + l);
}

async function main() {
  line();
  line("  ==============================================");
  line("    모집 신청 시스템 · 최초 설치");
  line("  ==============================================");
  line();
  line("  이 창은 처음 한 번만 실행하시면 됩니다.");
  line("  끝나면 PC를 켤 때마다 알아서 돌아갑니다.");
  line();
  line(`  설치 위치: ${REPO}`);
  line();

  if ((await ensureAuthor()) === false) return;
  registerTasks();
  testRun();

  line();
  line("  ==============================================");
  line("    설치가 끝났습니다.");
  line("  ==============================================");
  line();
  showTail();
  line();
  line("  총 NN건 저장  줄들과  HEAD -> ...  push 줄이 보이면 정상입니다.");
  line();
  line("  보는 곳 : https://srajjihun.github.io/sraj/ydp.html");
  line("  전체기록: logs\\collect.log");
  line("  설명서  : SETUP.md");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
