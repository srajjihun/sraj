@echo off
chcp 65001 >nul
title Collect one year
cd /d "%~dp0"

rem IMPORTANT: keep this file 100%% ASCII. See scripts\g2b\say.mjs for why.
rem All Korean shown to the user is printed by node.

set "SAY=node scripts\g2b\say.mjs"

%SAY% year-head

if "%G2B_SERVICE_KEY%"=="" goto :nokey

pause
echo.

node "scripts\g2b\collect.mjs" 365
if errorlevel 1 goto :fail

%SAY% year-build
node "scripts\g2b\build-page.mjs"

%SAY% year-done
pause
exit /b 0

:nokey
%SAY% nokey
pause
exit /b 1

:fail
%SAY% year-fail
pause
exit /b 1
