// 기업마당 수집 진단용: 실제 응답을 저장하고 파싱 결과를 출력한다.
// 사용법: node scripts/debug-bizinfo.mjs
import { writeFile, mkdir } from "node:fs/promises";
import { parseRows, listUrl } from "./bizinfo-monitor.mjs";

const url = listUrl(1);
console.log("요청 URL:", url);

let res;
try {
  res = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0 (compatible; bizinfo-monitor-bot/1.0)" },
  });
} catch (err) {
  console.log("\n[요청 실패]", err.message);
  if (err.cause) console.log("원인:", err.cause.code ?? err.cause.message);
  process.exit(1);
}

console.log("HTTP 상태:", res.status);
const html = await res.text();
console.log("응답 길이:", html.length, "바이트");
await mkdir("logs", { recursive: true });
await writeFile("logs/bizinfo-response.html", html, "utf8");
console.log("→ logs/bizinfo-response.html 로 저장했습니다");

console.log("<tbody> 존재:", /<tbody>/.test(html) ? "예" : "아니오");
const items = parseRows(html);
console.log("파싱된 항목 수:", items.length);
if (items.length) {
  console.log("\n최신 5건:");
  for (const it of items.slice(0, 5)) {
    console.log(` - [${it.date}] ${it.title.slice(0, 45)}`);
  }
}
