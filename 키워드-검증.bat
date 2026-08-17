@echo off
chcp 65001 >nul
title 키워드 제안안 검증
cd /d "%~dp0"

rem 제안 키워드를 PC에 저장된 원본 공고 전체에 돌려보고 결과를 메모장으로 엽니다.
rem 기존 설정(config/g2b-keywords.md)은 건드리지 않습니다.

if not exist "logs" mkdir "logs"
node "scripts\g2b\keyword-report.mjs" > "logs\keyword-report.txt" 2>&1
start notepad "logs\keyword-report.txt"
