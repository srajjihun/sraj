@echo off
chcp 65001 >nul
title 화면 새로고침
cd /d "%~dp0"

rem 최신 코드를 받아 g2b-live.html 을 다시 만들고 엽니다.
rem 나라장터 API 를 부르지 않으므로 하루 호출 한도와 무관하게 언제든 됩니다.

echo.
echo   ================================================
echo     화면 새로고침
echo   ================================================
echo.

echo   [1/3] 최신 코드를 받는 중입니다...
git pull >nul 2>&1
if errorlevel 1 (
  echo         건너뜁니다. ^(이미 최신이거나 네트워크 문제입니다^)
) else (
  echo         완료했습니다.
)

echo.
echo   [2/3] 화면을 다시 만드는 중입니다...
node "scripts\g2b\build-page.mjs"
if errorlevel 1 (
  echo.
  echo   [오류] 화면을 만들지 못했습니다.
  echo          수집 데이터가 없으면 collect-g2b.bat 을 먼저 실행하세요.
  echo.
  pause
  exit /b 1
)
echo         완료했습니다.

echo.
echo   [3/3] g2b-live.html 을 엽니다.
echo.
echo   * 브라우저가 이미 열려 있으면 Ctrl+F5 로 새로고침하세요.
echo.
start "" "g2b-live.html"
