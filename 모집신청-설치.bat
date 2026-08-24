@echo off
chcp 65001 >nul
title 모집 신청 시스템 · 최초 설치
cd /d "%~dp0"

echo.
echo   ==============================================
echo     모집 신청 시스템 · 최초 설치
echo   ==============================================
echo.
echo   이 창은 처음 한 번만 실행하시면 됩니다.
echo   끝나면 PC를 켤 때마다 알아서 돌아갑니다.
echo.

rem -- 준비물 확인 -------------------------------
where git >nul 2>&1
if errorlevel 1 (
  echo   [오류] Git 이 설치되어 있지 않습니다.
  echo          https://git-scm.com/download/win 에서 설치한 뒤
  echo          이 파일을 다시 실행해 주세요.
  echo.
  pause
  exit /b 1
)

where node >nul 2>&1
if errorlevel 1 (
  echo   [오류] Node.js 가 설치되어 있지 않습니다.
  echo          https://nodejs.org 에서 LTS 를 설치한 뒤
  echo          이 파일을 다시 실행해 주세요.
  echo.
  pause
  exit /b 1
)

rem -- 1. 커밋 작성자 ----------------------------
rem 이걸 빼먹으면 수집은 되는데 업로드에서만 조용히 실패한다.
rem 로그에 "Author identity unknown" 만 남아 알아채기 어렵다.
echo   [1/3] 커밋 작성자를 확인합니다.

set "GITMAIL="
for /f "delims=" %%i in ('git config --global user.email 2^>nul') do set "GITMAIL=%%i"
set "GITNAME="
for /f "delims=" %%i in ('git config --global user.name 2^>nul') do set "GITNAME=%%i"

if not "%GITMAIL%"=="" if not "%GITNAME%"=="" goto :author_ok

echo.
echo         GitHub 에 올릴 때 쓸 이름과 이메일이 필요합니다.
echo.
if "%GITNAME%"=="" (
  set /p "GITNAME=        이름   : "
)
if "%GITMAIL%"=="" (
  set /p "GITMAIL=        이메일 : "
)
git config --global user.name "%GITNAME%"
git config --global user.email "%GITMAIL%"
echo.

:author_ok
echo         %GITNAME% ^<%GITMAIL%^>
echo.

rem -- 2. 자동 실행 등록 -------------------------
rem 작업 스케줄러 화면을 열지 않고 schtasks 로 바로 등록한다.
rem 트리거를 두 개 만드는 이유: 로그온만 걸면 PC 를 며칠 계속 켜 둔 날에는
rem 다시 걸리지 않는다. 하나는 켤 때, 하나는 매일 오전.
echo   [2/3] PC 를 켤 때 자동 실행되도록 등록합니다.

set "VBS=%~dp0collect-silent.vbs"
if not exist "%VBS%" (
  echo         [오류] collect-silent.vbs 를 찾을 수 없습니다.
  echo                저장소가 제대로 받아졌는지 확인해 주세요.
  echo.
  pause
  exit /b 1
)

set "OK=0"

schtasks /Create /TN "모집신청 수집 (로그온)" /TR "wscript.exe \"%VBS%\"" /SC ONLOGON /F >nul 2>&1
schtasks /Query /TN "모집신청 수집 (로그온)" >nul 2>&1
if errorlevel 1 (
  echo         [경고] 로그온 등록에 실패했습니다.
) else (
  echo         로그온할 때  - 등록했습니다.
  set "OK=1"
)

schtasks /Create /TN "모집신청 수집 (매일)" /TR "wscript.exe \"%VBS%\"" /SC DAILY /ST 10:00 /F >nul 2>&1
schtasks /Query /TN "모집신청 수집 (매일)" >nul 2>&1
if errorlevel 1 (
  echo         [경고] 매일 10:00 등록에 실패했습니다.
) else (
  echo         매일 10:00  - 등록했습니다.
  set "OK=1"
)

rem 둘 다 실패하면 손으로 등록해야 한다. 그냥 넘어가면 자동 실행이
rem 안 되는 채로 설치가 끝난 줄 알게 된다.
if "%OK%"=="0" (
  echo.
  echo         자동 등록이 안 됐습니다. SETUP.md 의 5단계를 보고
  echo         작업 스케줄러에서 직접 등록해 주세요.
)
echo.

rem -- 3. 시험 실행 ------------------------------
rem 첫 실행에서 GitHub 로그인 창이 뜬다. 창 없이 도는 vbs 대신 bat 을
rem 직접 불러야 그 창을 볼 수 있다.
echo   [3/3] 한 번 실행해 봅니다. 1~2분 걸립니다.
echo         GitHub 로그인 창이 뜨면 로그인해 주세요. 처음 한 번만입니다.
echo.

call "%~dp0collect.bat"

echo.
echo   ==============================================
echo     설치가 끝났습니다.
echo   ==============================================
echo.
echo   아래에 수집 결과가 보이면 정상입니다.
echo.
powershell -NoProfile -Command "Get-Content -Path 'logs\collect.log' -Tail 12 -Encoding UTF8" 2>nul
echo.
echo   ----------------------------------------------
echo   전체 기록  : logs\collect.log
echo   설치 설명  : SETUP.md
echo   사이트     : https://srajjihun.github.io/sraj/ydp.html
echo.
pause
