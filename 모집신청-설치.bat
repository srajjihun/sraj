@echo off
chcp 65001 >nul
title Recruit Notice System - Setup
cd /d "%~dp0"

rem ===================================================================
rem  Installer launcher.
rem
rem  IMPORTANT: this file must stay 100%% ASCII - no Korean, not even in
rem  a rem line. cmd.exe reads a .bat in chunks and remembers where to
rem  continue by BYTE offset; under chcp 65001 a multi-byte character on
rem  a chunk boundary shifts that offset, so the next line is read
rem  mid-character. The symptom is garbage like
rem      'x' is not recognized as an internal or external command
rem  and it already happened once with a Korean version of this file.
rem
rem  So this file only checks the two prerequisites and hands off to
rem  scripts/install.mjs, which prints Korean safely because Node reads
rem  its source as UTF-8 in one piece.
rem ===================================================================

where git >nul 2>&1
if errorlevel 1 (
  echo.
  echo   [ERROR] Git is not installed.
  echo           Install it from https://git-scm.com/download/win
  echo           then open a NEW command prompt and run this file again.
  echo.
  pause
  exit /b 1
)

where node >nul 2>&1
if errorlevel 1 (
  echo.
  echo   [ERROR] Node.js is not installed.
  echo           Install the LTS build from https://nodejs.org
  echo           then open a NEW command prompt and run this file again.
  echo.
  pause
  exit /b 1
)

rem Refresh the code first so the installer below is the current one.
rem Failure is not fatal - we just run whatever is already here.
git pull --ff-only >nul 2>&1

node "scripts\install.mjs"
set "RC=%ERRORLEVEL%"

echo.
pause
exit /b %RC%
