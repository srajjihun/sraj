@echo off
chcp 65001 >nul
rem -- 모집·신청 레이더: PC 수집 스크립트 (Windows) --
rem GitHub 서버(해외 IP)에서 접속이 차단되는 영등포구청/기업마당/정부24를
rem 포함해 4개 소스를 이 PC(한국 IP)에서 수집하고 저장소에 푸시한다.
rem 사용법: collect-silent.vbs 로 실행하면 창 없이 조용히 동작한다.
rem        (직접 실행해도 되며, 그때는 진행 상황이 창에 보인다)

cd /d "%~dp0"

rem 실행 기록은 logs\collect.log 에 남긴다 (최근 실행분 위주로 확인용)
if not exist "logs" mkdir "logs"
set "LOG=logs\collect.log"

echo. >> "%LOG%"
echo ===== %DATE% %TIME% 수집 시작 ===== >> "%LOG%"

rem 부팅 직후에는 네트워크가 아직 안 잡혔을 수 있어 잠시 대기
ping -n 16 127.0.0.1 >nul

rem -- 최신 코드 받기 --
rem 예전에는 여기서 git pull --ff-only 를 썼는데, 로컬과 원격이 한 번 갈라지면
rem 영영 실패하고 그 오류가 로그에만 남아 아무도 모릅니다. 실제로 그 일이
rem 있었습니다 — 이 PC 와 GitHub Actions 가 같은 data\*.json 을 서로 커밋·푸시해서
rem 갈라졌고, 그 뒤로 모든 .bat 의 git pull 이 조용히 실패했습니다.
rem
rem 그래서 (1) 이 PC 는 이제 아무것도 커밋·푸시하지 않고
rem        (2) 원격 상태로 맞추기만 합니다. 갈라져 있어도 복구됩니다.
rem data\g2b\ 와 g2b-live.html, config\회사정보.md 는 git 이 추적하지 않으므로
rem 이 명령의 영향을 받지 않습니다.
git fetch origin >> "%LOG%" 2>&1
for /f %%b in ('git rev-parse --abbrev-ref HEAD 2^>nul') do set "BR=%%b"
if defined BR (
  git reset --hard origin/%BR% >> "%LOG%" 2>&1 || echo [경고] 최신 코드를 받지 못했습니다 >> "%LOG%"
) else (
  echo [경고] git 을 쓸 수 없습니다. 화면-새로고침.bat 으로 코드를 받으세요 >> "%LOG%"
)

for %%s in (ydp seoul bizinfo govkr) do (
  node "scripts\%%s-monitor.mjs" >> "%LOG%" 2>&1 || echo [경고] %%s 수집 실패 >> "%LOG%"
)

rem 수집 결과(data\*.json)는 PC 에서 올리지 않습니다.
rem GitHub Actions(ydp-monitor.yml)가 같은 파일을 갱신하므로, 양쪽에서 밀면
rem 반드시 갈라집니다. 저장소 쪽은 Actions 에 맡깁니다.

rem -- 나라장터 입찰·영업 정보시스템 --
rem 인증키(G2B_SERVICE_KEY)가 등록돼 있을 때만 동작한다.
rem 최초 등록은 G2B-설치.bat 을 한 번 실행하면 된다.
rem 수집 결과는 g2b-live.html 로만 남고 저장소에는 올리지 않는다(사내 정보).
if not "%G2B_SERVICE_KEY%"=="" (
  node "scripts\g2b\collect.mjs" >> "%LOG%" 2>&1 || echo [경고] 나라장터 수집 실패 >> "%LOG%"
  node "scripts\g2b\build-page.mjs" >> "%LOG%" 2>&1 || echo [경고] 나라장터 화면 생성 실패 >> "%LOG%"
)

echo ===== %DATE% %TIME% 수집 종료 ===== >> "%LOG%"

rem 로그가 무한정 커지지 않도록 1MB 넘으면 비운다
for %%F in ("%LOG%") do if %%~zF GTR 1048576 type nul > "%LOG%"
