// config/g2b-keywords.md 를 읽어 수집 키워드 설정으로 파싱합니다.
//
// 파일 구조:
//   # 수집 키워드   → ## 그룹명 아래 한 줄에 단어 하나
//   # 제외 키워드   → 한 줄에 단어 하나
//   # 수집 예외     → 한 줄에 하나. 수집어가 이 말 안에서만 걸렸으면 무시합니다
//   # 제외 예외     → 한 줄에 하나. 제외어가 이 말 안에서만 걸렸으면 살립니다
//   # 제외 해제     → "조건어 → 무시할제외어 무시할제외어" 형식
//   # 조달분류코드  → "코드  설명" 형식 (첫 토큰만 코드로 사용)
import { readFile } from "node:fs/promises";

const CONFIG_PATH = new URL("../../../config/g2b-keywords.md", import.meta.url);

export async function loadKeywords(path = CONFIG_PATH) {
  const text = await readFile(path, "utf8");
  const groups = {}; // { 그룹명: [단어...] }
  const exclude = [];
  const allow = []; // 제외 예외
  const kwAllow = []; // 수집 예외
  const release = []; // 제외 해제 조건 [{ when, words }]
  const codes = [];

  let section = null; // "collect" | "exclude" | "allow" | "release" | "codes"
  let currentGroup = null;

  for (const rawLine of text.split("\n")) {
    const line = rawLine.trim();
    if (!line) continue;

    if (/^#\s*수집\s*예외/.test(line)) { section = "kwallow"; continue; } // "# 수집" 보다 먼저
    if (/^#\s*수집/.test(line)) { section = "collect"; currentGroup = null; continue; }
    // 아래 두 줄은 "# 제외" 보다 먼저 봐야 합니다 (앞부분이 같습니다)
    if (/^#\s*제외\s*예외/.test(line)) { section = "allow"; continue; }
    if (/^#\s*제외\s*해제/.test(line)) { section = "release"; continue; }
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
    else if (section === "kwallow") kwAllow.push(line);
    else if (section === "release") {
      // "수출 → 행사 전시회 상담회"
      const [left, right] = line.split(/→|->/);
      const when = (left ?? "").trim();
      const words = (right ?? "").trim().split(/\s+/).filter(Boolean);
      if (when && words.length) release.push({ when, words });
    }
    else if (section === "codes") {
      const code = line.split(/\s+/)[0];
      if (/^\d{4,}$/.test(code)) codes.push(code);
    }
  }

  return { groups, exclude, allow, kwAllow, release, codes };
}

// 항목(제목+분류명)에 매칭되는 키워드 그룹 목록을 돌려줍니다. 빈 배열이면 미매칭.
export function matchGroups(item, config) {
  // 공고명만 봅니다. 조달분류명(예: "광고및홍보서비스")은 업종 코드라서
  // 달력·자료집·애니메이션 제작이 전부 같은 칸에 들어옵니다 — 오탐의 최대 원인이었습니다.
  const hay = item.title ?? "";
  const kwAllow = config.kwAllow ?? [];
  // 수집어가 엉뚱한 말 안에서만 걸린 경우를 걸러냅니다.
  // 예: "무역"은 "직무역량"(직-무역-량) 안에도 있어 HRD 공고가 수출 그룹으로
  //     분류됐습니다. "무역량"을 수집 예외에 적으면 그 안의 "무역"은 무시되고
  //     "무역사절단 파견" 같은 진짜 무역 공고는 그대로 잡힙니다.
  const hit = (w) => (kwAllow.length ? matchedOutsideAllowlist(hay, w, kwAllow) : hay.includes(w));
  const matched = [];
  for (const [group, words] of Object.entries(config.groups)) {
    if (words.some(hit)) matched.push(group);
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

// 제외 해제 조건: 제목에 조건어가 있으면 그 제외어들을 무시합니다.
//
// 예: 수출지원사업의 표준 형태가 "해외 전시회 참가지원"·"수출상담회"·
//     "무역사절단"입니다. 발주기관이 기업을 해외에 내보내는 사업이지
//     행사 기획이 아닌데, 행사·전시회·상담회 제외어가 전부 죽였습니다.
//     "수출 → 행사 전시회 상담회" 를 적어두면 수출 맥락에서만 풀립니다.
function releasedWords(title, release) {
  const out = new Set();
  for (const r of release) {
    if (title.includes(r.when)) for (const w of r.words) out.add(w);
  }
  return out;
}

/** 제목에 걸린 제외어 목록. 비어 있으면 통과입니다. */
export function excludedBy(item, config) {
  const title = item.title ?? "";
  const allow = config.allow ?? [];
  const freed = releasedWords(title, config.release ?? []);
  return config.exclude.filter((w) => {
    if (freed.has(w)) return false;
    return allow.length ? matchedOutsideAllowlist(title, w, allow) : title.includes(w);
  });
}

export function isExcluded(item, config) {
  return excludedBy(item, config).length > 0;
}
