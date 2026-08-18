@echo off
rem ============================================================
rem  최신 코드 받기 — 다른 .bat 들이 call 로 부르는 공용 루틴입니다.
rem  이 파일만 따로 실행하셔도 됩니다.
rem
rem  왜 git pull 을 안 쓰는가:
rem    이 PC 와 GitHub Actions 가 같은 data\*.json 을 서로 커밋·푸시해서
rem    로컬과 원격이 갈라졌습니다. 그러면 git pull 은 영영 실패하는데
rem    모든 .bat 이 그 오류를 >nul 로 숨기고 있어서, 새 코드가 몇 번을
rem    올려도 PC 에 도착하지 않았습니다.
rem
rem    이제 PC 는 아무것도 커밋·푸시하지 않습니다. 그래서 "원격 상태로
rem    맞추기"만 하면 되고, 갈라져 있어도 그 한 번으로 복구됩니다.
rem
rem  덮어써지지 않는 것 (git 이 추적하지 않는 파일들):
rem    data\g2b\        수집 데이터
rem    g2b-live.html    만들어진 화면
rem    config\회사정보.md  회사 내부 정보
rem
rem  git 이 없거나 이 폴더가 clone 이 아니면 화면-새로고침.bat 을 쓰세요.
rem  그쪽은 git 없이 GitHub 에서 ZIP 으로 받습니다.
rem ============================================================

where git >nul 2>&1
if errorlevel 1 (
  echo         git 이 설치돼 있지 않습니다 - 코드 받기를 건너뜁니다.
  echo         화면-새로고침.bat 을 쓰시면 git 없이 받을 수 있습니다.
  exit /b 1
)

if not exist ".git" (
  echo         이 폴더는 git 저장소가 아닙니다 - 코드 받기를 건너뜁니다.
  echo         화면-새로고침.bat 을 쓰시면 git 없이 받을 수 있습니다.
  exit /b 1
)

rem 작업 브랜치를 고정값으로 씁니다 (현재 체크아웃된 브랜치를 믿지 않습니다).
rem 예전에는 "git rev-parse --abbrev-ref HEAD" 로 지금 브랜치를 알아내 그
rem 브랜치 최신본으로만 맞췄습니다. 그런데 이 PC 의 저장소가 이 프로젝트와
rem 무관한 다른 브랜치에 가 있었던 적이 있고, 그 상태에서는 아무리 실행해도
rem 엉뚱한 브랜치로만 맞춰졌습니다 — 최신 코드와 예전 코드가 섞여 이 파일이
rem 고치려던 바로 그 문제(파일마다 버전이 다름)가 재발했습니다.
rem 이제는 항상 이 브랜치로 고정해서 맞추므로, 지금 브랜치가 무엇이든 상관없이
rem 실행할 때마다 저절로 복구됩니다.
set "BR=claude/g2b-bidding-collector-y605rn"

git fetch origin %BR%
if errorlevel 1 (
  echo         [경고] GitHub 에 연결하지 못했습니다. 예전 코드로 계속합니다.
  exit /b 1
)

rem checkout -B 는 로컬 브랜치를 FETCH_HEAD 로 강제로 맞추고 그 브랜치로
rem 전환합니다. 지금 다른 브랜치에 가 있었더라도 여기서 바로잡힙니다.
git checkout -B %BR% FETCH_HEAD
if errorlevel 1 (
  echo         [경고] 코드를 맞추지 못했습니다. 위 메시지를 알려 주세요.
  exit /b 1
)

echo         최신 코드로 맞췄습니다. ^(브랜치 %BR%^)
exit /b 0
