@echo off
chcp 65001 >nul
title Credential report
setlocal

rem IMPORTANT: keep this file 100%% ASCII. See scripts\g2b\say.mjs for why.
rem All Korean shown to the user is printed by node.
rem
rem Reads nothing new - it only counts what the analysis .bat already stored,
rem so it finishes in seconds and costs no API quota.

rem Run from a copy in TEMP: getcode.bat updates this file mid-run, and cmd.exe
rem re-reads a running .bat by byte offset. See the analysis .bat for the details.
if "%SRAJ_STAGE%"=="1" goto :main
set "SRAJ_STAGE=1"
for %%i in ("%~dp0.") do set "SRAJ_HOME=%%~fi"
copy /y "%~f0" "%TEMP%\sraj-cred.bat" >nul 2>&1
if not exist "%TEMP%\sraj-cred.bat" goto :main
cmd /c call "%TEMP%\sraj-cred.bat" %* & exit /b

:main
if "%SRAJ_HOME%"=="" for %%i in ("%~dp0.") do set "SRAJ_HOME=%%~fi"
cd /d "%SRAJ_HOME%"
set "SAY=node scripts\g2b\say.mjs"

%SAY% cred-head
call "%SRAJ_HOME%\getcode.bat"

if not exist "logs" mkdir "logs"
node "scripts\g2b\credits.mjs" > "logs\credit-report.txt" 2>&1
if errorlevel 1 goto :fail

%SAY% cred-done
start notepad "logs\credit-report.txt"
exit /b 0

:fail
%SAY% cred-fail
type "logs\credit-report.txt"
pause
exit /b 1
