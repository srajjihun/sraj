# 모집 신청 시스템 — 새 PC 설치

영등포구청 · 서울시 · 기업마당 · 정부24의 모집/신청 공고를 모아
[웹페이지](https://srajjihun.github.io/sraj/ydp.html)에 보여주는 시스템입니다.

이 문서는 **PC를 바꿨을 때** 다시 붙이는 방법입니다.

**Git 과 Node.js 만 설치하시면 나머지는 `모집신청-설치.bat` 이 다 합니다.**
아래 [설치](#설치) 를 보세요. 5분이면 됩니다.

Claude Code 를 새 PC에서 쓰신다면 이 한 줄을 붙여넣으셔도 됩니다.
저장소 주소가 들어 있어야 합니다 — 새 PC에는 아직 저장소가 없어서
"SETUP.md 보고 셋팅해줘" 만으로는 읽을 파일이 없습니다.

```
https://github.com/srajjihun/sraj 를 %USERPROFILE%\sraj 에 클론하고, 그 안의 SETUP.md 대로 셋팅해줘
```

---

## 먼저 — PC가 꼭 필요한가?

**대부분은 필요 없습니다.** 수집은 GitHub 서버에서 하루 세 번
(09:40 · 13:00 · 17:00 KST) 자동으로 돌고, PC 전원과 무관합니다.

PC의 역할은 **영등포구청 하나뿐**입니다. 이 사이트는 해외 IP를 간헐적으로
막아서, GitHub 서버에서 연결이 끊기는 날이 있습니다. 국내 IP인 PC가
그 빈틈을 메웁니다.

| | PC 없이 |
|---|---|
| 서울시 · 기업마당 · 정부24 | 문제 없음 |
| 영등포구청 | 막히는 회차만 빠짐. 다음 회차에 회수됨 |

수집기는 매번 최근 30일치를 통째로 다시 훑기 때문에, 몇 회차를 걸러도
**영구히 놓치지는 않고 늦어질 뿐**입니다.

그래서 선택하세요.

- **설치 안 함** — 영등포구청이 가끔 몇 시간 늦게 들어옵니다. 그걸로 충분하면 여기서 끝.
- **설치함** — 영등포구청까지 확실하게. 아래 5단계, 30분쯤.

---

## 설치

### 1. Git · Node.js 설치

이 둘만 손으로 설치하시면 됩니다. 나머지는 자동입니다.

- Git: <https://git-scm.com/download/win>
- Node.js: <https://nodejs.org> (LTS)

설치 후 **새** 명령 프롬프트에서 확인합니다. (기존 창은 PATH 를 모릅니다)

```
git --version
node --version
```

### 2. 저장소 받기

명령 프롬프트에 붙여넣습니다.

```
cd %USERPROFILE%
git clone https://github.com/srajjihun/sraj.git
```

### 3. 설치 파일 실행

`%USERPROFILE%\sraj` 폴더의 **`모집신청-설치.bat`** 을 더블클릭합니다.

이게 알아서 합니다.

- 커밋 작성자(이름·이메일) 등록 — 없으면 물어봅니다
- 작업 스케줄러 등록 — 로그온할 때 + 매일 10:00, 두 개
- 한 번 시험 실행하고 결과를 보여줍니다

중간에 **GitHub 로그인 창**이 뜹니다. 로그인해 주세요. 처음 한 번만입니다.

마지막에 이런 줄들이 보이면 정상입니다.

```
총 45건 저장 (신규 ...)      <- 영등포구청
총 17건 저장 (신규 ...)      <- 서울시
총 134건 저장 (...) [전국 +.., 수도권 +..]   <- 기업마당
총 133건 저장 (신규 ...)     <- 정부24
[publish xxxxxxx] chore: update recruit/apply notices (PC)
   xxxxxxx..xxxxxxx  HEAD -> claude/frontend-design-skill-install-pyd7nc
```

`[INFO] no new notices` 는 오류가 아니라 "새 공고 없음"이라는 뜻입니다.

---

## 직접 하려면

설치 파일이 안 될 때만 보시면 됩니다.

**커밋 작성자** — 빼먹으면 수집은 되는데 업로드에서만 조용히 멈춥니다.
로그에 `Author identity unknown` 만 남아 알아채기 어렵습니다.

```
git config --global user.name "이름"
git config --global user.email "sraj.jihun@gmail.com"
```

**자동 실행 등록** — `collect-silent.vbs` 가 `collect.bat` 을 **창 없이**
실행합니다. 검은 창이 뜨는 게 싫으면 반드시 이 파일을 등록하세요.

명령 프롬프트에서 (경로의 `<사용자>` 만 바꾸세요):

```
schtasks /Create /TN "모집신청 수집 (로그온)" /TR "wscript.exe \"C:\Users\<사용자>\sraj\collect-silent.vbs\"" /SC ONLOGON /F
schtasks /Create /TN "모집신청 수집 (매일)" /TR "wscript.exe \"C:\Users\<사용자>\sraj\collect-silent.vbs\"" /SC DAILY /ST 10:00 /F
```

작업 스케줄러(`taskschd.msc`) 화면에서 하시려면 → **작업 만들기**

- **일반**: 이름 `모집신청 수집` / "사용자가 로그온할 때만 실행"
- **트리거**: **로그온할 때** 하나, **매일 10:00** 하나. 둘 다 필요합니다 —
  로그온만 걸면 PC 를 며칠 계속 켜 둔 날에는 다시 걸리지 않습니다.
- **동작**: 프로그램 시작
  - 프로그램/스크립트: `wscript.exe`
  - 인수 추가: `"C:\Users\<사용자>\sraj\collect-silent.vbs"` (따옴표 포함)
- **조건**: "컴퓨터의 AC 전원이 켜져 있는 경우에만" 체크 해제 (노트북이면)

시작 위치는 비워 두셔도 됩니다. 스크립트가 자기 위치를 스스로 찾습니다.

등록 후 목록에서 우클릭 → **실행** 으로 시험하고,
`logs\collect.log` 에 새 줄이 붙었는지 확인합니다.

---

## 구조

```
%USERPROFILE%\sraj\             <- 본체. collect.bat 이 자기를 이 브랜치에 고정
    collect.bat                 <- 스케줄러가 부르는 껍데기
    collect-recruit.bat         <- 실제 수집 + 업로드
    collect-silent.vbs          <- 창 없이 실행하는 래퍼
    모집신청-설치.bat            <- 처음 한 번만 실행 (스케줄러 등록까지)
    logs\collect.log            <- 모든 기록
%USERPROFILE%\sraj-publish\     <- collect-recruit.bat 이 자동으로 만드는 작업 폴더
                                   (사이트 배포 브랜치에 고정)
```

`sraj-publish` 를 따로 만든 이유: 데이터는 사이트가 배포되는 브랜치에
올라가야 하는데, 본체는 다른 브랜치에 고정돼 있습니다. 한 폴더에서 브랜치를
왔다갔다 하면 서로 덮어씁니다. git worktree 라 저장소는 공유해서 디스크는
거의 안 먹습니다.

---

## 안 될 때

로그(`logs\collect.log`)를 먼저 보세요. 대부분 원인이 그대로 적혀 있습니다.

| 로그에 보이는 것 | 뜻 | 할 일 |
|---|---|---|
| `Author identity unknown` | 2단계를 안 했음 | `git config --global` 두 줄 실행 |
| `network still down` | 부팅 직후 DNS가 안 잡힘 | 그냥 두면 다음 회차에 복구됨 |
| `data push failed` | 업로드가 밀림 | 다음 회차가 재시도함 |
| `ydp collect failed` | 영등포구청 연결 끊김 | 사이트 쪽 문제. 다음 회차에 회수됨 |
| `publish worktree missing` | `sraj-publish` 를 못 만듦 | 상위 폴더 쓰기 권한 확인 |

로그가 아예 안 생기면 작업 스케줄러에 등록이 안 된 것입니다. 확인:

```
schtasks /Query /TN "모집신청 수집 (로그온)"
```

없다고 나오면 `모집신청-설치.bat` 을 다시 실행하거나,
위 [직접 하려면](#직접-하려면) 의 `schtasks` 두 줄을 붙여넣으세요.

---

## 이 PC 없이 돌아가는 부분

| | 언제 | 하는 일 |
|---|---|---|
| GitHub Actions | 09:40 · 13:00 · 17:00 KST | 4개 소스 수집 후 업로드 |
| GitHub Pages | 수집이 끝나는 즉시 | 사이트 갱신 |

수집 이력은 저장소 **Actions** 탭에서 볼 수 있습니다.

빨간불은 **사람이 봐야 할 때만** 켜집니다.

| 표시 | 뜻 | 할 일 |
|---|---|---|
| 경고 (노란 느낌표) | 연결이 안 됨 (해외 IP 차단, DNS 등) | 없음. 다음 회차에 회수됨 |
| 오류 (빨간 X) | 파싱이 깨졌거나 주소가 바뀜 | 확인 필요 |

대상 사이트들이 해외 IP를 간헐적으로 막기 때문에, 연결 실패를 고장으로 치면
빨간불이 늘 켜져 있어 진짜 고장이 묻힙니다. 분류 기준은
`scripts/lib/exit.mjs` 에 있고 `node scripts/lib/exit.test.mjs` 로 확인합니다.

---

## 손댈 만한 것

| 하고 싶은 것 | 파일 |
|---|---|
| 특정 단어 들어간 공고 빼기 | `scripts/lib/exclude.mjs` (맨 위에 방법 적어둠) |
| 보관 기간 바꾸기 (기본 30일) | 각 `scripts/*-monitor.mjs` 의 `RETENTION_DAYS` |
| 수집 시각 바꾸기 | `.github/workflows/ydp-monitor.yml` 과 `pages.yml` 의 `cron` (UTC, KST-9). **둘은 짝이라 같이 고쳐야 합니다** |
| 화면 | `ydp.html` 한 파일 |

마감일 추출을 손볼 때는 먼저 테스트를 돌려 보세요.

```
node scripts/lib/deadline.test.mjs
```
