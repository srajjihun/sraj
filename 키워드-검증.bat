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
call "%~dp0코드받기.bat"
if errorlevel 1 (
  echo.
  echo         위 사유로 코드를 받지 못했습니다. 예전 코드로 계속합니다.
  echo         계속 이 메시지가 보이면 화면-새로고침.bat 을 한 번 실행하세요.
  echo.
)

echo.
echo   [2/2] 원본 공고 전체에 돌려보는 중입니다...
if not exist "logs" mkdir "logs"
node "scripts\g2b\keyword-report.mjs" > "logs\keyword-report.txt" 2>&1
echo         완료했습니다. 메모장으로 엽니다.
start notepad "logs\keyword-report.txt"
