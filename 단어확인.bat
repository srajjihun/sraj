@echo off
chcp 65001 >nul
title 단어 확인
cd /d "%~dp0"

rem 키워드로 쓸까 말까 고민되는 단어를 PC에 저장된 원본 전체에서 세어봅니다.
rem 설정 파일도 수집 데이터도 건드리지 않고, 나라장터 API 도 부르지 않습니다.

echo.
echo   ================================================
echo     단어 확인 - 이 단어 넣어야 되나?
echo   ================================================
echo.
echo   궁금한 단어를 띄어쓰기로 나눠 적으세요.
echo   예^) 판촉 유통 컨설팅 대행
echo.
set /p "WORDS=  단어: "

if "%WORDS%"=="" (
  echo.
  echo   단어를 입력하지 않으셨습니다.
  echo.
  pause
  exit /b
)

echo.
echo   최신 키워드 설정을 받는 중입니다...
git pull >nul 2>&1

if not exist "logs" mkdir "logs"
node "scripts\g2b\word-check.mjs" %WORDS% > "logs\word-check.txt" 2>&1
start notepad "logs\word-check.txt"
