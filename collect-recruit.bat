@echo off
rem ===================================================================
rem  recruit/apply notices - ydp / seoul / bizinfo / govkr
rem  OWNER: the recruit/apply system. Do not edit from the G2B side.
rem ===================================================================
rem
rem IMPORTANT: keep this file 100%% ASCII.
rem
rem Normally called by collect.bat, which sets LOG and syncs the code.
rem Running it on its own works too - the fallbacks below cover that.

setlocal

rem Inherited from collect.bat; set again so a standalone run logs Korean
rem output readably too.
chcp 65001 >nul

cd /d "%~dp0"

if not exist "logs" mkdir "logs"
if "%LOG%"=="" set "LOG=%~dp0logs\collect.log"

rem These four sites block GitHub's foreign IP, so this PC is the only
rem place they can be collected, and the website deploys from PUBBR, so
rem the results have to land on that branch.
rem
rem An earlier version skipped the push entirely to avoid diverging with
rem GitHub Actions. That silently froze the website: Actions can only
rem reach seoul, so ydp / bizinfo / govkr stopped updating for days.
rem
rem This runs in its own worktree pinned to PUBBR rather than in the main
rem checkout (pinned to the G2B feature branch). The two systems then
rem never fight over the branch, and the data is read from and written
rem back to the exact branch the website serves - no divergence.
set "PUBBR=claude/frontend-design-skill-install-pyd7nc"

rem %~dp0 ends with a backslash, so "%~dp0..\sraj-publish" would carry a
rem literal ".." into git worktree add. %%~fD normalizes it to a real path.
for %%D in ("%~dp0..") do set "PUBDIR=%%~fD\sraj-publish"

rem Without a fresh remote state the worktree below would be reset to an
rem old commit, and the push at the end would be rejected as non-fast-
rem forward. Better to sit this run out; the next one retries.
git fetch origin %PUBBR% >> "%LOG%" 2>&1
if errorlevel 1 (
  echo [WARN] fetch failed - recruit sources skipped this run >> "%LOG%"
  goto :eof
)

rem Drops registrations whose folder was deleted by hand; without this,
rem worktree add refuses to reuse the path.
git worktree prune >> "%LOG%" 2>&1

rem origin/%PUBBR%, NOT FETCH_HEAD. FETCH_HEAD is per-worktree: the fetch
rem above ran in the main checkout, so inside %PUBDIR% it does not exist
rem and the checkout died with "FETCH_HEAD is not a commit". The worktree
rem then stayed on an old commit, committed on top of it, and the push was
rem rejected (non-fast-forward). The remote-tracking ref is shared by all
rem worktrees, so it resolves the same everywhere.
if not exist "%PUBDIR%\.git" git worktree add -f -B publish "%PUBDIR%" origin/%PUBBR% >> "%LOG%" 2>&1
if not exist "%PUBDIR%\.git" goto :no_publish_dir

pushd "%PUBDIR%"

rem Match the remote exactly; this also repairs a diverged worktree.
git checkout -f -B publish origin/%PUBBR% >> "%LOG%" 2>&1 || echo [WARN] could not sync publish worktree >> "%LOG%"

for %%s in (ydp seoul bizinfo govkr) do node "scripts\%%s-monitor.mjs" >> "%LOG%" 2>&1 || echo [WARN] %%s collect failed >> "%LOG%"

git add data\ydp-posts.json data\seoul-posts.json data\bizinfo-posts.json data\govkr-posts.json >> "%LOG%" 2>&1
git diff --cached --quiet
if errorlevel 1 goto :publish_data
echo [INFO] no new notices >> "%LOG%"
goto :publish_done

:publish_data
git commit -m "chore: update recruit/apply notices (PC)" >> "%LOG%" 2>&1
git push origin HEAD:%PUBBR% >> "%LOG%" 2>&1 || echo [WARN] data push failed - next run retries >> "%LOG%"

:publish_done
popd
goto :eof

:no_publish_dir
echo [WARN] publish worktree missing at %PUBDIR% - recruit sources skipped >> "%LOG%"
