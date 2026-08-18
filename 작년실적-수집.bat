@echo off
chcp 65001 >nul
title Collect last year winners
setlocal

rem IMPORTANT: keep this file 100%% ASCII. See scripts\g2b\say.mjs for why.
rem All Korean shown to the user is printed by node.

rem Run from a copy in TEMP: getcode.bat updates this file mid-run, and cmd.exe
rem re-reads a running .bat by byte offset. See the analysis .bat for the details.
if "%SRAJ_STAGE%"=="1" goto :main
set "SRAJ_STAGE=1"
for %%i in ("%~dp0.") do set "SRAJ_HOME=%%~fi"
copy /y "%~f0" "%TEMP%\sraj-award.bat" >nul 2>&1
if not exist "%TEMP%\sraj-award.bat" goto :main
cmd /c call "%TEMP%\sraj-award.bat" %* & exit /b

:main
if "%SRAJ_HOME%"=="" for %%i in ("%~dp0.") do set "SRAJ_HOME=%%~fi"
cd /d "%SRAJ_HOME%"
set "SAY=node scripts\g2b\say.mjs"

%SAY% award-head

if "%G2B_SERVICE_KEY%"=="" goto :nokey

pause
echo.

call "%SRAJ_HOME%\getcode.bat"

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
