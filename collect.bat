@echo off
chcp 65001 >nul
rem ── 모집·신청 레이더: PC 수집 스크립트 (Windows) ──
rem GitHub 서버(해외 IP)에서 접속이 차단되는 영등포구청/기업마당/정부24를
rem 포함해 4개 소스를 이 PC(한국 IP)에서 수집하고 저장소에 푸시한다.
rem 사용법: 이 저장소를 clone한 폴더에서 실행 (Node.js, Git 필요)

cd /d "%~dp0"

git pull --ff-only

for %%s in (ydp seoul bizinfo govkr) do (
  node "scripts\%%s-monitor.mjs" || echo [경고] %%s 수집 실패
)

git add data\ydp-posts.json data\seoul-posts.json data\bizinfo-posts.json data\govkr-posts.json
git diff --cached --quiet || git commit -m "chore: 모집/신청 공고 갱신 (PC)"
git push
