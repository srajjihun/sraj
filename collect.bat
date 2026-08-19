@echo off
chcp 65001 >nul
rem ===================================================================
rem  daily collector - dispatcher
rem  Registered in the Windows task scheduler (via collect-silent.vbs).
rem ===================================================================
rem
rem IMPORTANT: keep this file 100%% ASCII. See scripts\g2b\say.mjs for why.
rem Nobody watches this window (collect-silent.vbs runs it hidden), so the
rem log lines stay English on purpose - they are for diagnosis.
rem
rem This file is SHARED, so it holds nothing system-specific. Each system
rem owns exactly one file and must edit only its own:
rem
rem   collect-recruit.bat  -> recruit/apply notices (ydp seoul bizinfo govkr)
rem   collect-g2b.bat      -> nara-jangteo (G2B) bidding, logs to logs\g2b.log
rem                          (already existed; also runnable by hand, and
rem                           takes a day count: collect-g2b.bat 30)
rem
rem The G2B logic used to be pasted into this file as well. A rewrite of
rem that copy dropped the recruit system's push block and froze the website
rem for days without any error. Now this file only calls the two.

cd /d "%~dp0"

if not exist "logs" mkdir "logs"

rem The log path must be ABSOLUTE: collect-recruit.bat pushd's into another
rem folder that has no logs\ (logs/ is gitignored). With a relative path
rem every redirection there failed with "The system cannot find the path
rem specified." and the command was skipped entirely.
set "LOG=%~dp0logs\collect.log"

echo. >> "%LOG%"
echo ===== %DATE% %TIME% collect start ===== >> "%LOG%"


rem -- pull latest code --
rem This is how both systems receive new code, including the two .bat
rem files below, so it lives here rather than in either child.
rem
rem This used to be `git pull --ff-only`. Once local and remote diverged it
rem failed forever and the error only went to the log, so nobody noticed.
rem Now we just match the remote, which repairs a diverged clone on the
rem next run. data\g2b\, g2b-live.html and config\ are untracked, so they
rem survive. The branch is pinned - trusting the checked-out branch once
rem left this clone syncing to an unrelated branch every single run.
set "BR=claude/g2b-bidding-collector-y605rn"

rem Retry the fetch instead of waiting a fixed 15 seconds for the network.
rem Right after boot - and after a resume from sleep - DNS is not up yet,
rem and a fixed wait lost whole runs to "Could not resolve host: github.com"
rem followed by every source failing with ENOTFOUND. 6 tries, 20s apart.
set "FETCHED="
for /L %%i in (1,1,6) do (
  if not defined FETCHED (
    git fetch origin %BR% >> "%LOG%" 2>&1
    if not errorlevel 1 set "FETCHED=1"
    if not defined FETCHED ping -n 21 127.0.0.1 >nul
  )
)
if not defined FETCHED echo [WARN] network still down - keeping the code we have >> "%LOG%"

rem origin/%BR%, not FETCH_HEAD: FETCH_HEAD is per-worktree and is missing
rem or stale whenever the fetch above did not run here. The remote-tracking
rem ref is shared and always points at the last successful fetch, so this
rem is a harmless no-op offline instead of a fatal error.
git checkout -f -B %BR% origin/%BR% >> "%LOG%" 2>&1 || echo [WARN] could not sync code >> "%LOG%"

rem -- run each system, in its own file --
rem `call` reads the child fresh, so the sync above can replace them safely.
if exist "%~dp0collect-recruit.bat" (
  call "%~dp0collect-recruit.bat"
) else (
  echo [WARN] collect-recruit.bat missing - recruit sources skipped >> "%LOG%"
)

rem Owns its own log (logs\g2b.log) and its own start/end banner, so
rem nothing about it belongs here. It exits 1 when the API key is not
rem registered yet; `call` just returns, which is what we want.
if exist "%~dp0collect-g2b.bat" (
  call "%~dp0collect-g2b.bat"
) else (
  echo [WARN] collect-g2b.bat missing - g2b skipped >> "%LOG%"
)

echo ===== %DATE% %TIME% collect end ===== >> "%LOG%"

rem Keep the log from growing without bound.
for %%F in ("%LOG%") do if %%~zF GTR 1048576 type nul > "%LOG%"
