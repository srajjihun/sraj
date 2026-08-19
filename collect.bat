@echo off
chcp 65001 >nul
rem ===================================================================
rem  daily collector - dispatcher
rem  Registered in the Windows task scheduler (via collect-silent.vbs).
rem ===================================================================
rem
rem IMPORTANT: keep this file 100%% ASCII - no Korean, not even in a rem.
rem cmd.exe reads a .bat in chunks and remembers where to continue by BYTE
rem offset; under chcp 65001 a multi-byte character on a chunk boundary
rem shifts that offset and the next line is read mid-character, producing
rem "'x' is not recognized as an internal or external command".
rem Nobody watches this window (collect-silent.vbs runs it hidden), so the
rem log lines stay English on purpose - they are for diagnosis.
rem
rem This file syncs the code and then calls collect-recruit.bat.
rem
rem It used to call a second system (nara-jangteo bidding) as well. That
rem system moved to its own repository on 2026-08-19:
rem     https://github.com/srajjihun/sraj-g2b
rem so its call was removed here. Nothing else changed.
rem
rem Keep system logic in the child, not in this file. The bidding logic was
rem once pasted in here, and a rewrite of that copy dropped the recruit
rem system's push block and froze the website for days without any error.

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
rem This is how the collector below receives new code, including its own
rem .bat, so it lives here rather than in the child.
rem
rem This used to be `git pull --ff-only`. Once local and remote diverged it
rem failed forever and the error only went to the log, so nobody noticed.
rem Now we just match the remote, which repairs a diverged clone on the
rem next run. Ignored files (logs\, and the leftovers from the bidding
rem system that used to live here) survive. The branch is pinned - trusting
rem the checked-out branch once left this clone syncing to an unrelated
rem branch every single run.
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

rem -- run the collector, in its own file --
rem `call` reads the child fresh, so the sync above can replace it safely.
if exist "%~dp0collect-recruit.bat" (
  call "%~dp0collect-recruit.bat"
) else (
  echo [WARN] collect-recruit.bat missing - recruit sources skipped >> "%LOG%"
)

echo ===== %DATE% %TIME% collect end ===== >> "%LOG%"

rem Keep the log from growing without bound.
for %%F in ("%LOG%") do if %%~zF GTR 1048576 type nul > "%LOG%"
