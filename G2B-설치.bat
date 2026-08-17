@echo off
chcp 65001 >nul
title 입찰·영업 정보시스템 · 최초 설치
cd /d "%~dp0"

echo.
echo   ==============================================
echo     입찰·영업 정보시스템 · 최초 설치
echo   ==============================================
echo.
echo   이 창은 처음 한 번만 실행하시면 됩니다.
echo.

rem -- Node.js 확인 ------------------------------
where node >nul 2>&1
if errorlevel 1 (
  echo   [오류] Node.js 가 설치되어 있지 않습니다.
  echo          https://nodejs.org 에서 설치한 뒤 다시 실행해 주세요.
  echo.
  pause
  exit /b 1
)

rem -- 1. 최신 코드 ------------------------------
echo   [1/4] 최신 코드를 받는 중입니다...
git pull >nul 2>&1
if errorlevel 1 (
  echo         건너뜁니다. ^(이미 최신이거나 네트워크 문제입니다^)
) else (
  echo         완료했습니다.
)

rem -- 2. 인증키 ---------------------------------
echo.
if not "%G2B_SERVICE_KEY%"=="" goto :ready
echo   [2/4] 공공데이터포털 인증키를 등록합니다.
echo.
echo         마이페이지에서 [일반 인증키(Decoding)] 를 복사한 뒤
echo         아래에 붙여넣고 Enter 를 누르세요.
echo         ^(붙여넣기는 마우스 오른쪽 클릭입니다^)
echo.
set /p "KEY=  인증키를 붙여넣으세요: "
if "%KEY%"=="" (
  echo.
  echo   [오류] 인증키가 입력되지 않았습니다. 다시 실행해 주세요.
  echo.
  pause
  exit /b 1
)
setx G2B_SERVICE_KEY "%KEY%" >nul
set "G2B_SERVICE_KEY=%KEY%"
echo.
echo         등록했습니다. 다음부터는 묻지 않습니다.
goto :collect

:ready
echo   [2/4] 인증키가 이미 등록되어 있습니다.

rem -- 3. 수집 -----------------------------------
:collect
echo.
echo   [3/4] 나라장터에서 최근 30일 공고를 수집합니다.
echo         1분 정도 걸립니다. 창을 닫지 마세요.
echo.
node "scripts\g2b\collect.mjs" 30
if errorlevel 1 (
  echo.
  echo   [오류] 수집에 실패했습니다. 위에 표시된 메시지를 확인해 주세요.
  echo          인증키 오류라면 Decoding 키가 맞는지 확인하시고,
  echo          이 창을 캡처해서 문의하시면 도와드립니다.
  echo.
  pause
  exit /b 1
)

rem -- 4. 화면 생성 ------------------------------
echo.
echo   [4/4] 화면을 만드는 중입니다...
node "scripts\g2b\build-page.mjs"
if errorlevel 1 (
  echo.
  echo   [오류] 화면 생성에 실패했습니다.
  echo.
  pause
  exit /b 1
)

echo.
echo   ==============================================
echo     설치가 끝났습니다.
echo     잠시 후 g2b-live.html 이 열립니다.
echo   ==============================================
echo.
echo   앞으로는 collect.bat 이 매일 함께 수집합니다.
echo   결과를 보시려면 g2b-live.html 을 열어주세요.
echo   ^(바탕화면에 바로가기를 만들어 두시면 편합니다^)
echo.
start "" "g2b-live.html"
pause
