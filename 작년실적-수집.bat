@echo off
chcp 65001 >nul
title 작년 수행업체 수집
cd /d "%~dp0"

echo.
echo   ==============================================
echo     작년에 누가 이 사업을 했는지 받아옵니다
echo   ==============================================
echo.
echo   나라장터 낙찰정보에서 작년 1년치를 받아
echo   공고 카드에 [작년] 줄을 채웁니다.
echo   - 낙찰업체 / 낙찰금액 / 낙찰률 / 투찰업체 수
echo.
echo   * 우리 6개 분야 키워드에 걸리는 건만 남깁니다.
echo   * 하루 호출 한도(1,000회)에 걸리면 자동으로 멈춥니다.
echo     그럴 때는 다음 날 이 파일을 다시 실행하면 멈춘 달부터 이어받습니다.
echo   * 사업명과 수요기관이 둘 다 같을 때만 작년 건으로 인정합니다.
echo     사업명이 바뀐 건은 [기록 없음] 으로 남습니다.
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

call "%~dp0코드받기.bat"

node "scripts\g2b\award.mjs"
if errorlevel 1 (
  echo.
  echo   [오류] 낙찰정보 수집 중 문제가 발생했습니다.
  echo          하루 호출 한도에 걸린 것이라면 내일 다시 실행하면 이어서 받습니다.
  echo.
  pause
  exit /b 1
)

echo.
echo   받은 낙찰정보를 화면에 반영합니다 ...
echo.
node "scripts\g2b\collect.mjs"
node "scripts\g2b\build-page.mjs"

echo.
echo   끝났습니다. 화면-새로고침.bat 으로 g2b-live.html 을 여시면
echo   공고 카드에 [작년] 줄이 보입니다.
echo.
pause
