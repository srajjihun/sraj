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
rem
rem PDF / HWPX / HWP are all parsed by our own code now (lib\pdf.mjs,
rem lib\hwpx.mjs, lib\hwp.mjs). Hancom Office is no longer required, so the
rem security-module setup step that used to live here is gone. hancom.ps1
rem stays as a fallback that doc.mjs calls only for documents we cannot read
rem ourselves, and it stays quiet when Hangul is missing.

set "SAY=node scripts\g2b\say.mjs"

%SAY% docs-head

call "%~dp0getcode.bat"

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
