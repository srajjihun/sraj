// g2b.html(페이지 틀)에 data/g2b/posts.json 을 심어 g2b-live.html 을 만듭니다.
//
// g2b.html 은 데이터가 빈 채로 저장소에 커밋되고,
// g2b-live.html 은 수집 데이터가 담긴 로컬 전용 파일입니다(.gitignore).
// 브라우저에서 g2b-live.html 을 더블클릭하면 열립니다.
import { readFile, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

const TEMPLATE = new URL("../../g2b.html", import.meta.url);
const DATA = new URL("../../data/g2b/posts.json", import.meta.url);
const OUT = new URL("../../g2b-live.html", import.meta.url);

const START = "<!--G2B_DATA_START-->";
const END = "<!--G2B_DATA_END-->";

async function main() {
  const html = await readFile(TEMPLATE, "utf8");

  let data;
  try {
    data = await readFile(DATA, "utf8");
    JSON.parse(data); // 손상된 파일을 심지 않도록 검증
  } catch (err) {
    throw new Error(`data/g2b/posts.json 을 읽지 못했습니다 (${err.message}). 먼저 collect.mjs 를 실행하세요.`);
  }

  const s = html.indexOf(START);
  const e = html.indexOf(END);
  if (s === -1 || e === -1) throw new Error("g2b.html 에서 데이터 마커를 찾지 못했습니다.");

  // </script> 조기 종료 방지
  const safe = data.trim().replace(/<\/script/gi, "<\\/script");
  const block = `${START}\n<script id="g2b-data" type="application/json">\n${safe}\n</script>\n${END}`;
  const out = html.slice(0, s) + block + html.slice(e + END.length);

  await writeFile(OUT, out, "utf8");
  console.log(`[완료] g2b-live.html 생성 (${(out.length / 1024).toFixed(0)}KB)`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
}
