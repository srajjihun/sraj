@echo off
chcp 65001 >nul
title Notice document analysis
cd /d "%~dp0"

rem IMPORTANT: keep this file 100%% ASCII. See scripts\g2b\say.mjs for why.
rem All Korean shown to the user is printed by node.
rem
rem Usage:
rem   this .bat        top 20 by budget
rem   this .bat 50     top 50
rem   this .bat --all  everything (slow)

set "SAY=node scripts\g2b\say.mjs"

%SAY% docs-head

call "%~dp0getcode.bat"

%SAY% docs-step1

rem Hangul refuses to open a file from an external program until the
rem FilePathChecker module is registered - it pops a security dialog and
rem automation hangs forever waiting for a click. hancom.ps1 -Check tells
rem us whether that registration exists; -Register creates it.
rem Exit codes from hancom.ps1: 0 ok / 2 Hangul or DLL missing / 4 not registered
powershell -NoProfile -ExecutionPolicy Bypass -File "scripts\g2b\hancom.ps1" -Check >nul 2>&1
if not errorlevel 1 goto :hancom_ok

%SAY% docs-hancom-try
powershell -NoProfile -ExecutionPolicy Bypass -File "scripts\g2b\hancom.ps1" -Register
set "HRC=%errorlevel%"
if "%HRC%"=="0" goto :hancom_registered
if "%HRC%"=="2" goto :hancom_nodll
%SAY% docs-hancom-fail
goto :read

:hancom_ok
%SAY% docs-hancom-ok
goto :read

:hancom_registered
%SAY% docs-hancom-registered
goto :read

:hancom_nodll
%SAY% docs-hancom-nodll
goto :read

:read
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
