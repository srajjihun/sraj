@echo off
chcp 65001 >nul
title 키워드 검증
cd /d "%~dp0"

rem 지금 키워드 설정을 PC에 저장된 원본 공고 전체에 돌려봅니다.
rem 나라장터 API 를 부르지 않으므로 하루 호출 한도와 무관하게 언제든 됩니다.

echo.
echo   ================================================
echo     키워드 검증
echo   ================================================
echo.
echo   [1/2] 최신 키워드 설정을 받는 중입니다...
git pull >nul 2>&1
if errorlevel 1 (
  echo         건너뜁니다. ^(이미 최신이거나 네트워크 문제입니다^)
) else (
  echo         완료했습니다.
)

echo.
echo   [2/2] 원본 공고 전체에 돌려보는 중입니다...
if not exist "logs" mkdir "logs"
node "scripts\g2b\keyword-report.mjs" > "logs\keyword-report.txt" 2>&1
echo         완료했습니다. 메모장으로 엽니다.
start notepad "logs\keyword-report.txt"
