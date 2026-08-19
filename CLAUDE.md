# 이 저장소에는 시스템이 둘 있습니다

한 폴더를 쓰지만 서로 다른 사업이고, **담당 에이전트가 다릅니다.**
상대 시스템의 파일은 **읽기만** 하고 고치지 않습니다. 상대 쪽에서 문제를
발견하면 직접 고치지 말고 사용자에게 알립니다.

---

## ① 모집·신청 레이더 — 담당: 모집 에이전트

지원사업 모집공고를 모아 웹사이트로 보여줍니다.

```
화면      index.html · ydp.html
수집기    scripts/ydp-monitor.mjs · seoul-monitor.mjs
          scripts/bizinfo-monitor.mjs · govkr-monitor.mjs · debug-govkr.mjs
공용코드  scripts/lib/deadline.mjs · exclude.mjs · prune.mjs
실행      collect-recruit.bat
데이터    data/ydp-posts.json · seoul-posts.json · bizinfo-posts.json · govkr-posts.json
자동화    .github/workflows/ydp-monitor.yml · pages.yml
```

브랜치 `claude/frontend-design-skill-install-pyd7nc` — 웹사이트가 이 브랜치를
그대로 배포합니다(`pages.yml` 이 저장소 전체를 올립니다). 수집 데이터도 PC 가
이 브랜치로 밀어 넣습니다.

## ② 나라장터 입찰 레이더 — 담당: 입찰 에이전트

나라장터 입찰공고를 모아 참여 여부를 판단합니다. 웹에 배포하지 않고 PC 에서만
봅니다(`g2b-live.html` 은 gitignore).

```
화면      g2b.html            (→ g2b-live.html, 생성물)
수집·분석 scripts/g2b/**  ·  scripts/g2b-probe.mjs  ·  scripts/md-to-docx.mjs
설정      config/g2b-keywords.md · 실적DB.md · 회사정보.md · 회사정보.예시.md
문서      docs/g2b-design.md · docs/키워드-기준.md(.docx)
실행      collect-g2b.bat · G2B-설치.bat · 1년치-수집.bat · 화면-새로고침.bat
          공고문-분석.bat · 공고문-전체분석.bat · 단어확인.bat · 키워드-검증.bat
          인증-리포트.bat · 작년실적-수집.bat · getcode.bat(코드받기.bat) · update.bat
데이터    data/g2b/           (gitignore · PC 에만 있습니다)
```

브랜치 `claude/g2b-bidding-collector-y605rn` — PC 의 주 폴더가 이 브랜치에
고정돼 있습니다.

---

## 공용 파일 — 한쪽이 마음대로 고치지 않습니다

```
collect.bat         두 시스템을 차례로 부르는 실행기. 시스템 고유 내용은
                    넣지 않습니다(예전에 여기에 G2B 로직을 붙였다가 모집 쪽
                    푸시 블록이 지워져 사이트가 며칠 멈춘 적이 있습니다).
collect-silent.vbs  collect.bat 을 창 없이 실행하는 래퍼
.gitignore · .gitattributes
```

## 지켜야 할 것

- **코드 교차 참조 금지.** 지금 서로의 모듈을 import 하는 곳은 0 곳입니다.
  공통으로 쓰고 싶은 코드가 생기면 복사하지 말고 사용자에게 먼저 알립니다.
- **상대 브랜치에 푸시하지 않습니다.**
- 공용 파일을 고쳐야 하면 상대 시스템 부분은 그대로 두고, 무엇을 왜 고쳤는지
  커밋 메시지에 남깁니다.
- 배치 파일(.bat)은 전부 100% ASCII 로 유지합니다. 한글 안내문은
  `scripts/g2b/say.mjs` 가 출력합니다. 이유는 그 파일 맨 위에 적혀 있습니다.
