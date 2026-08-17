@echo off
chcp 65001 >nul
title 1년치 공고 수집
cd /d "%~dp0"

echo.
echo   ══════════════════════════════════════════════
echo     최근 1년(365일) 공고를 수집합니다
echo   ══════════════════════════════════════════════
echo.
echo   키워드를 정하기 위한 분석용 수집입니다.
echo   30일치보다 12배 많은 데이터를 받으므로
echo   10~20분 정도 걸립니다. 창을 닫지 마세요.
echo.
echo   * 이미 받아둔 공고는 다시 받지 않고 이어서 채웁니다.
echo   * 중간에 끊겨도 다시 실행하면 이어집니다.
echo   * 구간마다 바로 저장하므로 도중에 문제가 생겨도 그때까지
echo     받은 데이터는 남습니다.
echo   * 나라장터가 실제로 제공하는 과거 데이터에 한계가 있을 수
echo     있습니다. 그 경우 1년이 안 되더라도 정상 종료됩니다.
echo.

if "%G2B_SERVICE_KEY%"=="" (
  echo   [오류] 인증키가 등록되어 있지 않습니다.
  echo          G2B-설치.bat 을 먼저 실행해 주세요.
  echo.
  pause
  exit /b 1
)

pause
echo.

node "scripts\g2b\collect.mjs" 365
if errorlevel 1 (
  echo.
  echo   [오류] 수집 중 문제가 발생했습니다.
  echo          하루 호출 한도에 걸렸다면 내일 다시 실행하면 이어서 받습니다.
  echo.
  pause
  exit /b 1
)

echo.
echo   [화면] 대시보드를 갱신합니다...
node "scripts\g2b\build-page.mjs"

echo.
echo   ══════════════════════════════════════════════
echo     1년치 수집이 끝났습니다.
echo     이어서 키워드-검증.bat 을 실행해 주세요.
echo   ══════════════════════════════════════════════
echo.
pause
