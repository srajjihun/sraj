@echo off
chcp 65001 >nul
rem -- G2B (nara-jangteo) collector --
rem
rem IMPORTANT: keep this file 100%% ASCII. See scripts\g2b\say.mjs for why.
rem
rem Usage:
rem   collect-g2b.bat        last 3 days (daily run)
rem   collect-g2b.bat 30     last 30 days (first run / backfill)
rem Register it in the Windows task scheduler for a daily collect.

cd /d "%~dp0"

if not exist "logs" mkdir "logs"
set "LOG=logs\g2b.log"

echo. >> "%LOG%"
echo ===== %DATE% %TIME% g2b collect start ===== >> "%LOG%"

if "%G2B_SERVICE_KEY%"=="" (
  echo [ERROR] G2B_SERVICE_KEY is not set >> "%LOG%"
  node "scripts\g2b\say.mjs" nokey
  exit /b 1
)

rem Right after boot the network may not be up yet.
ping -n 11 127.0.0.1 >nul

node "scripts\g2b\collect.mjs" %1 >> "%LOG%" 2>&1 || echo [WARN] collect failed >> "%LOG%"
node "scripts\g2b\build-page.mjs" >> "%LOG%" 2>&1 || echo [WARN] page build failed >> "%LOG%"

echo ===== %DATE% %TIME% g2b collect end ===== >> "%LOG%"

rem Keep the log from growing without bound.
for %%F in ("%LOG%") do if %%~zF GTR 1048576 type nul > "%LOG%"
