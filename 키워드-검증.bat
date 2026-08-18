@echo off
chcp 65001 >nul
title Keyword check
cd /d "%~dp0"

rem IMPORTANT: keep this file 100%% ASCII. See scripts\g2b\say.mjs for why.
rem All Korean shown to the user is printed by node.
rem
rem Runs the current keyword config against the raw notices already stored
rem on this PC. No G2B OpenAPI call, so the daily quota is unaffected.

set "SAY=node scripts\g2b\say.mjs"

%SAY% kw-head

%SAY% kw-step1
call "%~dp0getcode.bat"
if errorlevel 1 %SAY% pull-skipped

%SAY% kw-step2
if not exist "logs" mkdir "logs"
node "scripts\g2b\keyword-report.mjs" > "logs\keyword-report.txt" 2>&1
%SAY% kw-done
start notepad "logs\keyword-report.txt"
