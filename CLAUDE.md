# 모집·신청 레이더

지원사업 모집공고를 매일 모아 GitHub Pages 로 보여줍니다.

**입찰 시스템은 2026-08-19 에 다른 저장소로 갈라졌습니다** —
https://github.com/srajjihun/sraj-g2b (`main`). 이 저장소에는 그 파일이
더 이상 없고, 담당 에이전트도 다릅니다. 서로의 저장소에 푸시하지 않습니다.

## 구조

```
화면      index.html · ydp.html
수집기    scripts/ydp-monitor.mjs · seoul-monitor.mjs
          scripts/bizinfo-monitor.mjs · govkr-monitor.mjs · debug-govkr.mjs
공용코드  scripts/lib/deadline.mjs · exclude.mjs · prune.mjs
실행      collect.bat -> collect-recruit.bat   (collect-silent.vbs 가 창 없이 부름)
데이터    data/ydp-posts.json · seoul-posts.json · bizinfo-posts.json · govkr-posts.json
자동화    .github/workflows/ydp-monitor.yml · pages.yml
```

## 브랜치가 둘입니다 — 정리가 필요합니다

```
claude/frontend-design-skill-install-pyd7nc   웹사이트가 배포되는 브랜치.
                                              PC 가 수집 데이터를 여기 올립니다.
claude/g2b-bidding-collector-y605rn           PC 의 주 폴더가 고정돼 있는 브랜치.
                                              collect.bat 이 여기서 코드를 받습니다.
```

두 번째 브랜치 이름은 이제 없어진 입찰 시스템에서 온 것입니다. 이름과 내용이
어긋나 있지만 **PC 의 `collect.bat` 과 `collect-recruit.bat` 이 이 이름을
글자로 물고 있어서**, 바꾸려면 PC 쪽도 같이 손봐야 합니다.

실제로 이것 때문에 사고가 났습니다 — 배포 브랜치에서 고친 `collect-recruit.bat`
이 PC 에 도착하지 않았습니다. PC 는 그 파일을 두 번째 브랜치에서 읽기 때문입니다.
**코드를 고칠 때 어느 브랜치에 올리는지 확인하세요.** 정리하기로 하면 브랜치를
하나로 합치는 쪽이 안전합니다.

## 손대기 전에

- **.bat 파일은 100% ASCII 로 유지합니다.** 주석에도 한글을 넣지 않습니다.
  cmd.exe 가 .bat 을 바이트 오프셋으로 이어 읽어서, 여러 바이트 글자가 조각
  경계에 걸리면 다음 줄을 글자 중간부터 읽습니다
  (`'x' is not recognized as an internal or external command`).
- **`collect.bat` 에는 시스템 고유 로직을 넣지 않습니다.** 예전에 여기에 다른
  시스템 로직을 붙여 넣었다가, 그 사본을 고치는 과정에서 모집 쪽 푸시 블록이
  지워져 웹사이트가 며칠 멈춘 적이 있습니다. 로직은 자식 .bat 에 둡니다.
- `.gitignore` 의 `data/g2b/` · `g2b-live.html` · `company/` 는 입찰 시스템이
  쓰던 폴더입니다. PC 의 옛 폴더에 아직 남아 있을 수 있어, 실수로 커밋되지
  않도록 남겨 뒀습니다.
