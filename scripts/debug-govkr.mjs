// 정부24 수집 진단용: 실제 응답 HTML을 저장하고 파싱 결과를 출력한다.
// 파싱이 0건이면 어느 단계에서 실패했는지까지 보여준다.
// 사용법: node scripts/debug-govkr.mjs
import { writeFile, mkdir } from "node:fs/promises";
import { parseItems, listUrl } from "./govkr-monitor.mjs";

const endDate = new Date();
const startDate = new Date(endDate.getTime() - 20 * 86400000);
const url = listUrl("모집", 1, startDate, endDate);

console.log("요청 URL:", url);
const res = await fetch(url, {
  headers: { "User-Agent": "Mozilla/5.0 (compatible; govkr-monitor-bot/1.0)" },
});
console.log("HTTP 상태:", res.status);

const html = await res.text();
console.log("응답 길이:", html.length, "바이트");
await mkdir("logs", { recursive: true });
await writeFile("logs/govkr-response.html", html, "utf8");
console.log("→ logs/govkr-response.html 로 저장했습니다");

const chunks = html.split('<dt class="pcb">').slice(1);
console.log("게시글 블록 수:", chunks.length);

const items = parseItems(html, "모집");
console.log("파싱된 항목 수:", items.length);

if (items.length) {
  console.log("\n샘플 3건:");
  for (const it of items.slice(0, 3)) {
    console.log(` - [${it.date}] ${it.title.slice(0, 40)} / ${it.org} / 마감 ${it.deadline ?? "-"}`);
  }
} else if (chunks.length) {
  // 어느 항목 추출이 실패했는지 표시
  const c = chunks[0];
  const checks = {
    "링크(id·제목)": /<a href="[^"]*locgovNews\/(\d+)[^"]*"[^>]*>([\s\S]*?)<\/a>/,
    "요약(dd.cont)": /<dd class="cont">([\s\S]*?)<\/dd>/,
    "기관(sorting-area)": /<div class="sorting-area">\s*<span>\s*([\s\S]*?)<\/span>/,
    "등록일": /등록일\s*([\d.]{10})/,
  };
  console.log("\n첫 블록에서 각 항목 매칭 결과:");
  for (const [name, rx] of Object.entries(checks)) {
    console.log(` - ${name}: ${rx.test(c) ? "OK" : "실패"}`);
  }
  console.log("\n첫 블록 앞부분 600자:");
  console.log(c.slice(0, 600));
}
