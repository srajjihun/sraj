@echo off
chcp 65001 >nul
title Collect last year winners
cd /d "%~dp0"

rem IMPORTANT: keep this file 100%% ASCII. See scripts\g2b\say.mjs for why.
rem All Korean shown to the user is printed by node.

set "SAY=node scripts\g2b\say.mjs"

%SAY% award-head

if "%G2B_SERVICE_KEY%"=="" goto :nokey

pause
echo.

call "%~dp0getcode.bat"

node "scripts\g2b\award.mjs"
if errorlevel 1 goto :fail

%SAY% award-apply
node "scripts\g2b\collect.mjs"
node "scripts\g2b\build-page.mjs"

%SAY% award-done
pause
exit /b 0

:nokey
%SAY% nokey
pause
exit /b 1

:fail
%SAY% award-fail
pause
exit /b 1
