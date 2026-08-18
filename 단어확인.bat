@echo off
chcp 65001 >nul
title Word check
cd /d "%~dp0"

rem IMPORTANT: keep this file 100%% ASCII. See scripts\g2b\say.mjs for why.
rem All Korean shown to the user is printed by node.
rem
rem Counts a candidate keyword across every raw notice stored on this PC.
rem Touches no config and no collected data, and calls no API.

set "SAY=node scripts\g2b\say.mjs"

%SAY% word-head
set /p "WORDS=  words: "

if "%WORDS%"=="" goto :empty

%SAY% word-pull
call "%~dp0getcode.bat"

if not exist "logs" mkdir "logs"
node "scripts\g2b\word-check.mjs" %WORDS% > "logs\word-check.txt" 2>&1
start notepad "logs\word-check.txt"
exit /b 0

:empty
%SAY% word-empty
pause
exit /b 1
