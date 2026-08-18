@echo off
chcp 65001 >nul
title G2B setup
cd /d "%~dp0"

rem IMPORTANT: keep this file 100%% ASCII. See scripts\g2b\say.mjs for why.
rem All Korean shown to the user is printed by node.

where node >nul 2>&1
if errorlevel 1 goto :nonode

set "SAY=node scripts\g2b\say.mjs"

%SAY% install-head

%SAY% install-step1
call "%~dp0getcode.bat"
if errorlevel 1 %SAY% pull-skipped

if not "%G2B_SERVICE_KEY%"=="" goto :havekey

%SAY% install-step2-new
set /p "KEY=  key: "
if "%KEY%"=="" goto :nokey
setx G2B_SERVICE_KEY "%KEY%" >nul
set "G2B_SERVICE_KEY=%KEY%"
%SAY% install-keysaved
goto :collect

:havekey
%SAY% install-step2-have

:collect
%SAY% install-step3
node "scripts\g2b\collect.mjs" 30
if errorlevel 1 goto :collectfail

%SAY% install-step4
node "scripts\g2b\build-page.mjs"
if errorlevel 1 goto :buildfail

%SAY% install-done
start "" "g2b-live.html"
pause
exit /b 0

:nonode
echo.
echo   [ERROR] Node.js is not installed.
echo           Install it from https://nodejs.org and run this again.
echo.
pause
exit /b 1

:nokey
%SAY% install-nokey
pause
exit /b 1

:collectfail
%SAY% install-collectfail
pause
exit /b 1

:buildfail
%SAY% install-buildfail
pause
exit /b 1
