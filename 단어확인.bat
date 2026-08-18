@echo off
chcp 65001 >nul
title Word check
setlocal

rem IMPORTANT: keep this file 100%% ASCII. See scripts\g2b\say.mjs for why.
rem All Korean shown to the user is printed by node.
rem
rem Counts a candidate keyword across every raw notice stored on this PC.
rem Touches no config and no collected data, and calls no API.

rem Run from a copy in TEMP: getcode.bat updates this file mid-run, and cmd.exe
rem re-reads a running .bat by byte offset. See the analysis .bat for the details.
if "%SRAJ_STAGE%"=="1" goto :main
set "SRAJ_STAGE=1"
for %%i in ("%~dp0.") do set "SRAJ_HOME=%%~fi"
copy /y "%~f0" "%TEMP%\sraj-word.bat" >nul 2>&1
if not exist "%TEMP%\sraj-word.bat" goto :main
cmd /c call "%TEMP%\sraj-word.bat" %* & exit /b

:main
if "%SRAJ_HOME%"=="" for %%i in ("%~dp0.") do set "SRAJ_HOME=%%~fi"
cd /d "%SRAJ_HOME%"
set "SAY=node scripts\g2b\say.mjs"

%SAY% word-head
set /p "WORDS=  words: "

if "%WORDS%"=="" goto :empty

%SAY% word-pull
call "%SRAJ_HOME%\getcode.bat"

if not exist "logs" mkdir "logs"
node "scripts\g2b\word-check.mjs" %WORDS% > "logs\word-check.txt" 2>&1
start notepad "logs\word-check.txt"
exit /b 0

:empty
%SAY% word-empty
pause
exit /b 1
