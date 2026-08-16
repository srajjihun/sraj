// config/g2b-keywords.md 를 읽어 수집 키워드 설정으로 파싱합니다.
//
// 파일 구조:
//   # 수집 키워드   → ## 그룹명 아래 한 줄에 단어 하나
//   # 제외 키워드   → 한 줄에 단어 하나
//   # 조달분류코드  → "코드  설명" 형식 (첫 토큰만 코드로 사용)
import { readFile } from "node:fs/promises";

const CONFIG_PATH = new URL("../../../config/g2b-keywords.md", import.meta.url);

export async function loadKeywords(path = CONFIG_PATH) {
  const text = await readFile(path, "utf8");
  const groups = {}; // { 그룹명: [단어...] }
  const exclude = [];
  const codes = [];

  let section = null; // "collect" | "exclude" | "codes"
  let currentGroup = null;

  for (const rawLine of text.split("\n")) {
    const line = rawLine.trim();
    if (!line) continue;

    if (/^#\s*수집/.test(line)) { section = "collect"; currentGroup = null; continue; }
    if (/^#\s*제외/.test(line)) { section = "exclude"; continue; }
    if (/^#\s*조달분류/.test(line)) { section = "codes"; continue; }
    if (/^##\s+/.test(line)) {
      if (section === "collect") {
        currentGroup = line.replace(/^##\s+/, "").trim();
        groups[currentGroup] = [];
      }
      continue;
    }
    if (line.startsWith("#")) continue; // 그 외 헤더는 무시

    // 설명 문단(문장형 줄)은 건너뜁니다 — 항목은 짧은 토큰 위주라
    // "합니다/됩니다" 같은 서술이 있으면 안내문으로 간주합니다.
    if (/[.。]$|합니다|됩니다|적용|형식:/.test(line)) continue;

    if (section === "collect" && currentGroup) groups[currentGroup].push(line);
    else if (section === "exclude") exclude.push(line);
    else if (section === "codes") {
      const code = line.split(/\s+/)[0];
      if (/^\d{4,}$/.test(code)) codes.push(code);
    }
  }

  return { groups, exclude, codes };
}

// 항목(제목+분류명)에 매칭되는 키워드 그룹 목록을 돌려줍니다. 빈 배열이면 미매칭.
export function matchGroups(item, config) {
  const hay = `${item.title ?? ""} ${item.category ?? ""} ${item.categoryMid ?? ""} ${item.categoryLarge ?? ""}`;
  const matched = [];
  for (const [group, words] of Object.entries(config.groups)) {
    if (words.some((w) => hay.includes(w))) matched.push(group);
  }
  // 분류코드가 등록돼 있으면 키워드 없이도 수집 대상 (그룹은 "분류" 로 표시)
  if (!matched.length && item.categoryNo && config.codes.includes(item.categoryNo)) {
    matched.push("분류");
  }
  return matched;
}

export function isExcluded(item, config) {
  const title = item.title ?? "";
  return config.exclude.some((w) => title.includes(w));
}
