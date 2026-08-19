@echo off
chcp 65001 >nul
rem -- daily collector, run by the Windows task scheduler --
rem
rem IMPORTANT: keep this file 100%% ASCII. See scripts\g2b\say.mjs for why.
rem Nobody watches this window (collect-silent.vbs runs it hidden), so the
rem log lines below stay English on purpose - they are for diagnosis.
rem
rem Collects the four sources that GitHub Actions cannot reach from a
rem foreign IP (ydp / seoul / bizinfo / govkr) plus G2B,
rem from this PC on a Korean IP.

cd /d "%~dp0"

if not exist "logs" mkdir "logs"
set "LOG=logs\collect.log"

echo. >> "%LOG%"
echo ===== %DATE% %TIME% collect start ===== >> "%LOG%"

rem Right after boot the network may not be up yet.
ping -n 16 127.0.0.1 >nul

rem -- pull latest code --
rem This used to be `git pull --ff-only`. Once local and remote diverged it
rem failed forever and the error only went to the log, so nobody noticed.
rem That actually happened: this PC and GitHub Actions both pushed the same
rem data\*.json. Now (1) this PC commits nothing and (2) we only match the
rem remote, which repairs a diverged clone on the next run.
rem data\g2b\, g2b-live.html and config\ are untracked, so they survive.
rem The branch is pinned - trusting the checked-out branch once left this
rem clone syncing to an unrelated branch every single run.
set "BR=claude/g2b-bidding-collector-y605rn"
git fetch origin %BR% >> "%LOG%" 2>&1
git checkout -f -B %BR% FETCH_HEAD >> "%LOG%" 2>&1 || echo [WARN] could not sync code >> "%LOG%"

rem -- recruit/apply sources: collect and publish --
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
set "PUBDIR=%~dp0..\sraj-publish"

git fetch origin %PUBBR% >> "%LOG%" 2>&1
if not exist "%PUBDIR%\.git" git worktree add -f -B publish "%PUBDIR%" FETCH_HEAD >> "%LOG%" 2>&1
if not exist "%PUBDIR%\.git" goto :no_publish_dir

pushd "%PUBDIR%"

rem Match the remote exactly; this also repairs a diverged worktree.
git checkout -f -B publish FETCH_HEAD >> "%LOG%" 2>&1 || echo [WARN] could not sync publish worktree >> "%LOG%"

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
goto :recruit_done

:no_publish_dir
echo [WARN] publish worktree missing - recruit sources skipped >> "%LOG%"

:recruit_done

rem -- G2B (nara-jangteo) --
rem Only runs once G2B_SERVICE_KEY is registered (the setup .bat does that).
rem Output stays in g2b-live.html and is never pushed (company-internal).
if not "%G2B_SERVICE_KEY%"=="" (
  node "scripts\g2b\collect.mjs" >> "%LOG%" 2>&1 || echo [WARN] g2b collect failed >> "%LOG%"
  node "scripts\g2b\build-page.mjs" >> "%LOG%" 2>&1 || echo [WARN] g2b page build failed >> "%LOG%"
)

echo ===== %DATE% %TIME% collect end ===== >> "%LOG%"

rem Keep the log from growing without bound.
for %%F in ("%LOG%") do if %%~zF GTR 1048576 type nul > "%LOG%"
