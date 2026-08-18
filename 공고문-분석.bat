@echo off
chcp 65001 >nul
title Notice document analysis
setlocal

rem IMPORTANT: keep this file 100%% ASCII. See scripts\g2b\say.mjs for why.
rem All Korean shown to the user is printed by node.
rem
rem Usage:
rem   this .bat        top 20 by budget
rem   this .bat 50     top 50
rem   this .bat --all  everything (slow)
rem
rem PDF / HWPX / HWP are all parsed by our own code (lib\pdf.mjs, lib\hwpx.mjs,
rem lib\hwp.mjs). Hancom Office is not required; hancom.ps1 is only a quiet
rem fallback that doc.mjs tries for documents we cannot read ourselves.

rem This file calls getcode.bat, which git-updates the folder - including THIS
rem file. cmd.exe re-reads a running .bat by byte offset, so if the file grows
rem or shrinks mid-run it resumes in the middle of some other line and prints
rem "'hwpx.mjs' is not recognized as an internal or external command", then
rem replays the script from a wrong position. Running from a copy in TEMP means
rem the file cmd is reading never changes.
if "%SRAJ_STAGE%"=="1" goto :main
set "SRAJ_STAGE=1"
for %%i in ("%~dp0.") do set "SRAJ_HOME=%%~fi"
copy /y "%~f0" "%TEMP%\sraj-docs.bat" >nul 2>&1
if not exist "%TEMP%\sraj-docs.bat" goto :main
cmd /c call "%TEMP%\sraj-docs.bat" %* & exit /b

:main
if "%SRAJ_HOME%"=="" for %%i in ("%~dp0.") do set "SRAJ_HOME=%%~fi"
cd /d "%SRAJ_HOME%"
set "SAY=node scripts\g2b\say.mjs"

%SAY% docs-head

call "%SRAJ_HOME%\getcode.bat"

%SAY% docs-step2
node "scripts\g2b\docs.mjs" %1
if errorlevel 1 goto :fail

%SAY% docs-step3
node "scripts\g2b\build-page.mjs"

%SAY% docs-done
pause
exit /b 0

:fail
%SAY% docs-fail
pause
exit /b 1
