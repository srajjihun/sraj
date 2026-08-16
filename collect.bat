@echo off
chcp 65001 >nul
rem ── 모집·신청 레이더: PC 수집 스크립트 (Windows) ──
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

git pull --ff-only >> "%LOG%" 2>&1

for %%s in (ydp seoul bizinfo govkr) do (
  node "scripts\%%s-monitor.mjs" >> "%LOG%" 2>&1 || echo [경고] %%s 수집 실패 >> "%LOG%"
)

git add data\ydp-posts.json data\seoul-posts.json data\bizinfo-posts.json data\govkr-posts.json >> "%LOG%" 2>&1
git diff --cached --quiet || git commit -m "chore: 모집/신청 공고 갱신 (PC)" >> "%LOG%" 2>&1
git push >> "%LOG%" 2>&1

rem ── 나라장터 입찰·영업 정보시스템 ──
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
