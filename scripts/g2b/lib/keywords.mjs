// config/g2b-keywords.md 를 읽어 수집 키워드 설정으로 파싱합니다.
//
// 파일 구조:
//   # 수집 키워드   → ## 그룹명 아래 한 줄에 단어 하나
//   # 제외 키워드   → 한 줄에 단어 하나
//   # 제외 예외     → 한 줄에 하나. 제외어가 이 말 안에서만 걸렸으면 살립니다
//   # 조달분류코드  → "코드  설명" 형식 (첫 토큰만 코드로 사용)
import { readFile } from "node:fs/promises";

const CONFIG_PATH = new URL("../../../config/g2b-keywords.md", import.meta.url);

export async function loadKeywords(path = CONFIG_PATH) {
  const text = await readFile(path, "utf8");
  const groups = {}; // { 그룹명: [단어...] }
  const exclude = [];
  const allow = []; // 제외 예외
  const codes = [];

  let section = null; // "collect" | "exclude" | "allow" | "codes"
  let currentGroup = null;

  for (const rawLine of text.split("\n")) {
    const line = rawLine.trim();
    if (!line) continue;

    if (/^#\s*수집/.test(line)) { section = "collect"; currentGroup = null; continue; }
    if (/^#\s*제외\s*예외/.test(line)) { section = "allow"; continue; } // 제외보다 먼저 봐야 합니다
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
    else if (section === "allow") allow.push(line);
    else if (section === "codes") {
      const code = line.split(/\s+/)[0];
      if (/^\d{4,}$/.test(code)) codes.push(code);
    }
  }

  return { groups, exclude, allow, codes };
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

// 제외어가 "제외 예외" 안에서만 걸렸는지 검사합니다.
//
// 예: 제외어 "공사"는 건설공사를 막으려는 것인데 기관명에도 들어 있습니다.
//     "대한무역투자진흥공사 해외 바이어 발굴 지원" → KOTRA 공고가 통째로 죽습니다.
//     예외에 "진흥공사"를 넣어두면, 그 글자 안에서만 걸린 "공사"는 무시하고
//     "청사 리모델링 공사" 처럼 진짜 공사는 그대로 막습니다.
function matchedOutsideAllowlist(title, word, allow) {
  for (let i = title.indexOf(word); i !== -1; i = title.indexOf(word, i + 1)) {
    const end = i + word.length;
    // 이 위치를 통째로 감싸는 예외어가 하나라도 있으면 이 등장은 넘어갑니다.
    const covered = allow.some((a) => {
      for (let j = title.indexOf(a); j !== -1; j = title.indexOf(a, j + 1)) {
        if (j <= i && end <= j + a.length) return true;
      }
      return false;
    });
    if (!covered) return true; // 예외 밖에서 걸린 등장이 있다 = 진짜 제외 대상
  }
  return false;
}

/** 제목에 걸린 제외어 목록. 비어 있으면 통과입니다. */
export function excludedBy(item, config) {
  const title = item.title ?? "";
  const allow = config.allow ?? [];
  return config.exclude.filter((w) =>
    allow.length ? matchedOutsideAllowlist(title, w, allow) : title.includes(w)
  );
}

export function isExcluded(item, config) {
  return excludedBy(item, config).length > 0;
}
