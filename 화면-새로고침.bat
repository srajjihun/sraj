@echo off
chcp 65001 >nul
title 화면 새로고침
cd /d "%~dp0"

rem 최신 코드를 받아 g2b-live.html 을 다시 만들고 엽니다.
rem 나라장터 API 를 부르지 않으므로 하루 호출 한도와 무관하게 여러 번 돌려도 됩니다.

echo.
echo   ================================================
echo     화면 새로고침
echo   ================================================
echo.

echo   [1/4] 최신 코드를 받는 중입니다...
for /f %%b in ('git rev-parse --abbrev-ref HEAD') do set BR=%%b
echo         현재 브랜치: %BR%
git pull
echo.

echo   [2/4] 받은 코드가 최신인지 확인합니다...
findstr /C:"cardView(" g2b.html >nul 2>&1
if errorlevel 1 (
  echo         최신 화면 코드가 없습니다. 작업 브랜치에서 다시 받습니다...
  git fetch origin claude/g2b-bidding-collector-y605rn
  git checkout claude/g2b-bidding-collector-y605rn
  git pull origin claude/g2b-bidding-collector-y605rn
  echo.
)
findstr /C:"cardView(" g2b.html >nul 2>&1
if errorlevel 1 (
  echo.
  echo   [오류] 최신 화면 코드를 받지 못했습니다.
  echo          위에 나온 git 메시지를 그대로 알려 주세요.
  echo          ^(고친 파일이 있어서 git 이 덮어쓰기를 막고 있을 수 있습니다^)
  echo.
  pause
  exit /b 1
)
echo         최신 코드 확인됨.

echo.
echo   [3/4] 화면을 다시 만드는 중입니다...
node "scripts\g2b\build-page.mjs"
if errorlevel 1 (
  echo.
  echo   [오류] 화면을 만들지 못했습니다.
  echo          수집 데이터가 없으면 collect-g2b.bat 을 먼저 실행하세요.
  echo.
  pause
  exit /b 1
)

echo.
echo   [4/4] g2b-live.html 을 엽니다.
for %%f in ("g2b-live.html") do echo         만든 시각: %%~tf  ^(크기 %%~zf 바이트^)
echo.
echo   * 화면이 그대로면 브라우저가 예전 것을 보여주는 중입니다.
echo     그 창에서 Ctrl+F5 를 누르세요. 그래도 같으면 탭을 닫고 다시 실행하세요.
echo   * 목록이 표가 아니라 카드 2칸으로 보이면 제대로 바뀐 것입니다.
echo.
start "" "g2b-live.html"

pause
