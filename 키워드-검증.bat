@echo off
chcp 65001 >nul
title Keyword check
setlocal

rem IMPORTANT: keep this file 100%% ASCII. See scripts\g2b\say.mjs for why.
rem All Korean shown to the user is printed by node.
rem
rem Runs the current keyword config against the raw notices already stored
rem on this PC. No G2B OpenAPI call, so the daily quota is unaffected.

rem Run from a copy in TEMP: getcode.bat updates this file mid-run, and cmd.exe
rem re-reads a running .bat by byte offset. See the analysis .bat for the details.
if "%SRAJ_STAGE%"=="1" goto :main
set "SRAJ_STAGE=1"
for %%i in ("%~dp0.") do set "SRAJ_HOME=%%~fi"
copy /y "%~f0" "%TEMP%\sraj-kw.bat" >nul 2>&1
if not exist "%TEMP%\sraj-kw.bat" goto :main
cmd /c call "%TEMP%\sraj-kw.bat" %* & exit /b

:main
if "%SRAJ_HOME%"=="" for %%i in ("%~dp0.") do set "SRAJ_HOME=%%~fi"
cd /d "%SRAJ_HOME%"
set "SAY=node scripts\g2b\say.mjs"

%SAY% kw-head

%SAY% kw-step1
call "%SRAJ_HOME%\getcode.bat"
if errorlevel 1 %SAY% pull-skipped

%SAY% kw-step2
if not exist "logs" mkdir "logs"
node "scripts\g2b\keyword-report.mjs" > "logs\keyword-report.txt" 2>&1
%SAY% kw-done
start notepad "logs\keyword-report.txt"
