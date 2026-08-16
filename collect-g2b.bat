@echo off
chcp 65001 >nul
rem ── 입찰·영업 정보시스템: 나라장터 수집 스크립트 (Windows) ──
rem 나라장터 OpenAPI에서 입찰공고·사전규격을 수집하고 g2b-live.html 을 생성합니다.
rem
rem 준비(최초 1회): 공공데이터포털 일반 인증키를 환경변수로 등록합니다.
rem   setx G2B_SERVICE_KEY "여기에인증키"
rem
rem 사용법:
rem   collect-g2b.bat        ← 최근 3일 (매일 아침용)
rem   collect-g2b.bat 30     ← 최근 30일 (첫 실행·백필용)
rem 작업 스케줄러에 등록하면 매일 자동으로 수집됩니다.

cd /d "%~dp0"

if not exist "logs" mkdir "logs"
set "LOG=logs\g2b.log"

echo. >> "%LOG%"
echo ===== %DATE% %TIME% G2B 수집 시작 ===== >> "%LOG%"

if "%G2B_SERVICE_KEY%"=="" (
  echo [오류] G2B_SERVICE_KEY 가 설정되지 않았습니다. >> "%LOG%"
  echo [오류] G2B_SERVICE_KEY 가 설정되지 않았습니다.
  echo        setx G2B_SERVICE_KEY "인증키"  실행 후 새 창에서 다시 시도하세요.
  exit /b 1
)

rem 부팅 직후에는 네트워크가 아직 안 잡혔을 수 있어 잠시 대기합니다
ping -n 11 127.0.0.1 >nul

node "scripts\g2b\collect.mjs" %1 >> "%LOG%" 2>&1 || echo [경고] 수집 중 오류 발생 >> "%LOG%"
node "scripts\g2b\build-page.mjs" >> "%LOG%" 2>&1 || echo [경고] 페이지 생성 실패 >> "%LOG%"

echo ===== %DATE% %TIME% G2B 수집 종료 ===== >> "%LOG%"

rem 로그가 무한정 커지지 않도록 1MB 넘으면 비웁니다
for %%F in ("%LOG%") do if %%~zF GTR 1048576 type nul > "%LOG%"
