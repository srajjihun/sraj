@echo off
chcp 65001 >nul
title 공고문 분석
cd /d "%~dp0"

echo.
echo   ==============================================
echo     공고문을 읽어 참가자격과 배점표를 뽑습니다
echo   ==============================================
echo.
echo   나라장터 목록은 [지역제한 있음] 까지만 알려주고
echo   어느 지역인지는 공고문 안에만 있습니다. 그걸 읽습니다.
echo.
echo   - 지역제한 / 업종·면허 / 실적요건
echo   - 기술:가격 배점, 배점표
echo   - 회사정보.md 를 채워두셨으면 [참가 가능/불가] 까지 판정합니다
echo.
echo   PDF 와 HWPX 는 그냥 읽고, HWP 는 한글에게 변환을 시킵니다.
echo.

call "%~dp0코드받기.bat"

echo.
echo   [1/3] 한글 자동화 상태를 확인합니다...
powershell -NoProfile -ExecutionPolicy Bypass -File "scripts\g2b\hancom.ps1" -Check >nul 2>&1
if errorlevel 1 (
  echo         한글 보안 설정이 안 돼 있습니다. 지금 설정합니다...
  powershell -NoProfile -ExecutionPolicy Bypass -File "scripts\g2b\hancom.ps1" -Register
  echo.
  echo         * 실패했다면 HWP 는 건너뛰고 PDF·HWPX 만 읽습니다.
  echo           한글이 보안 팝업을 띄우면 자동 실행이 멈추기 때문입니다.
  echo.
) else (
  echo         준비됐습니다 - HWP 도 읽습니다.
)

echo.
echo   [2/3] 공고문을 읽는 중입니다. 건당 3~10초 걸립니다...
echo.
node "scripts\g2b\docs.mjs" %1
if errorlevel 1 (
  echo.
  echo   [오류] 공고문 분석 중 문제가 발생했습니다.
  echo          수집 데이터가 없으면 collect-g2b.bat 을 먼저 실행하세요.
  echo.
  pause
  exit /b 1
)

echo.
echo   [3/3] 화면에 반영합니다...
node "scripts\g2b\build-page.mjs"

echo.
echo   끝났습니다. 화면-새로고침.bat 으로 열어 보시면
echo   카드에 [참가 가능/불가] 와 지역·업종·배점이 붙어 있습니다.
echo   각 항목에 마우스를 올리면 공고문 원문이 보입니다.
echo.
pause
