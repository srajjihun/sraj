// 정부24 수집 진단용: 실제 응답 HTML을 저장하고 파싱 결과를 출력한다.
// 사용법: node scripts/debug-govkr.mjs
import { writeFile } from "node:fs/promises";
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
await writeFile("logs/govkr-response.html", html, "utf8");
console.log("→ logs/govkr-response.html 로 저장했습니다");

console.log('"<dt class=\\"pcb\\">" 등장 횟수:', html.split('<dt class="pcb">').length - 1);
console.log("파싱된 항목 수:", parseItems(html, "모집").length);
