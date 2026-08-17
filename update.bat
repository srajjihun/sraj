@echo off
chcp 65001 >nul
title 화면 새로고침
setlocal

rem ============================================================
rem  화면 새로고침 (git 없이도 동작)
rem
rem  1) GitHub 에서 최신 코드 ZIP 을 내려받아 이 폴더에 덮어씁니다.
rem  2) node scripts\g2b\build-page.mjs 로 g2b-live.html 을 다시 만듭니다.
rem  3) 새 화면(카드형)이 맞는지 확인한 뒤 브라우저로 엽니다.
rem
rem  * git 을 쓰지 않습니다. git 이 없어도, 이 폴더가 clone 이 아니어도 됩니다.
rem  * 수집 데이터(data\g2b\, g2b-live.html)와 인증키(G2B_SERVICE_KEY)는
rem    절대 건드리지 않습니다.
rem  * 나라장터 API 를 부르지 않으므로 하루 호출 한도와 무관합니다.
rem ============================================================

rem -- 이 파일 자신도 갱신 대상이라, 임시 폴더로 복사해서 실행한다.
rem    (실행 중인 .bat 을 덮어쓰면 cmd 가 엉뚱한 줄을 읽어 오작동한다)
if "%SRAJ_STAGE%"=="1" goto :main
set "SRAJ_STAGE=1"
rem 끝의 역슬래시를 없앤 절대경로로 만든다 (PowerShell 에 그대로 넘기기 위해)
for %%i in ("%~dp0.") do set "SRAJ_HOME=%%~fi"
copy /y "%~f0" "%TEMP%\sraj-updater.bat" >nul 2>&1
if not exist "%TEMP%\sraj-updater.bat" goto :main
cmd /c call "%TEMP%\sraj-updater.bat" & exit /b

:main
cd /d "%SRAJ_HOME%"
if errorlevel 1 goto :nohome

rem -- 이 파일이 sraj 폴더 안에 있는지 확인합니다.
rem    다운로드 폴더에서 그냥 실행하면 엉뚱한 곳에 코드를 풀어 놓게 됩니다.
if not exist "scripts\g2b\build-page.mjs" (
  if not exist "g2b.html" (
    echo.
    echo   [멈춤] 이 파일이 sraj 폴더 밖에 있습니다.
    echo          지금 위치: %SRAJ_HOME%
    echo.
    echo   이 파일을 sraj 폴더 안으로 옮긴 뒤 다시 실행해 주세요.
    echo   ^(다른 .bat 파일들과 같은 곳입니다^)
    echo.
    pause
    exit /b 1
  )
)

echo.
echo   ================================================
echo     화면 새로고침
echo   ================================================
echo.
echo   폴더: %SRAJ_HOME%
echo.

where node >nul 2>&1
if errorlevel 1 goto :nonode

echo   [1/3] GitHub 에서 최신 코드를 내려받는 중입니다...
echo         수집 데이터^(data\g2b^)와 g2b-live.html 은 건드리지 않습니다.
echo.

rem -- PowerShell 로 ZIP 을 받아 덮어쓴다.
rem    PS 코드에는 한글/큰따옴표/%%/느낌표를 쓰지 않는다(cmd 해석 사고 방지).
rem    사용자에게 보여줄 한글 안내는 아래 종료코드로 분기해 batch 가 출력한다.
set "PS="
set "PS=%PS%$ErrorActionPreference='Stop';"
set "PS=%PS%$ProgressPreference='SilentlyContinue';"
set "PS=%PS%try{[Net.ServicePointManager]::SecurityProtocol=[Net.SecurityProtocolType]::Tls12}catch{};"
set "PS=%PS%try{[Net.WebRequest]::DefaultWebProxy.Credentials=[Net.CredentialCache]::DefaultCredentials}catch{};"
set "PS=%PS%$dest=$env:SRAJ_HOME;"
set "PS=%PS%$url='https://github.com/srajjihun/sraj/archive/refs/heads/claude/g2b-bidding-collector-y605rn.zip';"
set "PS=%PS%$top='sraj-claude-g2b-bidding-collector-y605rn';"
set "PS=%PS%$tmp=Join-Path $env:TEMP 'sraj-upd';"
set "PS=%PS%if(Test-Path -LiteralPath $tmp){Remove-Item -LiteralPath $tmp -Recurse -Force};"
set "PS=%PS%New-Item -ItemType Directory -Path $tmp -Force | Out-Null;"
set "PS=%PS%$zip=Join-Path $tmp 'src.zip';"
set "PS=%PS%try{Invoke-WebRequest -Uri $url -OutFile $zip -UseBasicParsing}catch{Write-Host $_.Exception.Message;exit 2};"
set "PS=%PS%try{Add-Type -AssemblyName System.IO.Compression.FileSystem -ErrorAction SilentlyContinue;"
set "PS=%PS%[IO.Compression.ZipFile]::ExtractToDirectory($zip,$tmp,[Text.Encoding]::UTF8)}catch{Write-Host $_.Exception.Message;exit 3};"
set "PS=%PS%$src=Join-Path $tmp $top;"
set "PS=%PS%if(-not (Test-Path -LiteralPath $src)){$d=@(Get-ChildItem -LiteralPath $tmp -Directory);if($d.Count -eq 1){$src=$d[0].FullName}};"
set "PS=%PS%$src=(Get-Item -LiteralPath $src).FullName;"
set "PS=%PS%$tpl=Join-Path $src 'g2b.html';"
set "PS=%PS%if(-not (Test-Path -LiteralPath $tpl)){exit 4};"
set "PS=%PS%if(-not (Select-String -LiteralPath $tpl -Pattern 'cardView' -Quiet)){exit 4};"
set "PS=%PS%$n=0;"
set "PS=%PS%try{foreach($f in @(Get-ChildItem -LiteralPath $src -Recurse -File -Force)){"
set "PS=%PS%$rel=$f.FullName.Substring($src.Length+1);"
set "PS=%PS%if($rel -eq 'g2b-live.html'){continue};"
set "PS=%PS%if($rel -like 'data\g2b\*'){continue};"
set "PS=%PS%if($rel -like 'logs\*'){continue};"
set "PS=%PS%$t=Join-Path $dest $rel;"
set "PS=%PS%if(($rel -like 'data\*') -and (Test-Path -LiteralPath $t)){continue};"
set "PS=%PS%$p=Split-Path $t -Parent;"
set "PS=%PS%if(-not (Test-Path -LiteralPath $p)){New-Item -ItemType Directory -Path $p -Force | Out-Null};"
set "PS=%PS%Copy-Item -LiteralPath $f.FullName -Destination $t -Force;"
set "PS=%PS%$n=$n+1}}catch{Write-Host $_.Exception.Message;exit 5};"
set "PS=%PS%Remove-Item -LiteralPath $tmp -Recurse -Force -ErrorAction SilentlyContinue;"
set "PS=%PS%Write-Host ('        updated files: ' + $n);"
set "PS=%PS%exit 0"

rem PATH 가 망가진 PC 도 있어 PowerShell 은 절대경로를 우선 쓴다.
set "PSEXE=powershell.exe"
if exist "%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe" set "PSEXE=%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe"

"%PSEXE%" -NoProfile -ExecutionPolicy Bypass -Command "%PS%"
set "RC=%errorlevel%"
if not "%RC%"=="0" goto :getfail

echo         최신 코드를 받았습니다.
echo.

echo   [2/3] 지금 키워드로 공고를 다시 걸러내는 중입니다...
node "scripts\g2b\reclassify.mjs"
echo.
echo         화면을 다시 만드는 중입니다...
node "scripts\g2b\build-page.mjs"
if errorlevel 1 goto :buildfail

echo.
echo   [3/3] 새 화면이 맞는지 확인합니다...
findstr /C:"cardView" "g2b-live.html" >nul 2>&1
if errorlevel 1 goto :oldpage
echo         확인됨 - 카드형 새 화면입니다.
for %%f in ("g2b-live.html") do echo         만든 시각: %%~tf  ^(크기 %%~zf 바이트^)

echo.
echo   ================================================
echo     끝났습니다. g2b-live.html 을 엽니다.
echo   ================================================
echo.
echo   * 목록이 표가 아니라 카드로 보이면 제대로 바뀐 것입니다.
echo   * 그래도 예전 표가 보이면 파일은 새 것이고 브라우저가
echo     예전 화면을 기억하고 있는 것입니다.
echo     그 창에서 Ctrl+F5 를 누르세요.
echo     그래도 같으면 Ctrl+Shift+N ^(시크릿 창^) 을 열고
echo     g2b-live.html 을 그 창으로 끌어다 놓으세요.
echo.
start "" "g2b-live.html"
pause
exit /b 0

rem ------------------------------------------------------------
:nohome
echo   [오류] 저장소 폴더를 찾지 못했습니다: %SRAJ_HOME%
echo          이 파일을 sraj 폴더 안에 두고 실행해 주세요.
echo.
pause
exit /b 1

:nonode
echo   [오류] Node.js 가 설치되어 있지 않습니다.
echo          https://nodejs.org 에서 LTS 를 설치한 뒤 다시 실행해 주세요.
echo.
pause
exit /b 1

:getfail
echo.
echo   ================================================
if "%RC%"=="2" echo     [오류] 인터넷에서 내려받지 못했습니다.
if "%RC%"=="2" echo            잠시 뒤 다시 실행해 보세요.
if "%RC%"=="3" echo     [오류] 내려받은 파일을 푸는 데 실패했습니다.
if "%RC%"=="4" echo     [오류] 내려받은 코드가 예상과 다릅니다.
if "%RC%"=="4" echo            관리자에게 이 화면을 알려 주세요.
if "%RC%"=="5" echo     [오류] 파일을 폴더에 넣지 못했습니다.
if "%RC%"=="5" echo            g2b-live.html 을 연 브라우저나 편집기를 닫고 다시 실행하세요.
if "%RC%"=="9009" echo     [오류] PowerShell 을 찾지 못했습니다.
echo.
echo     위에 영어로 나온 줄까지 그대로 캡처해서 보내주세요.
echo     ^(종료코드 %RC%^)
echo   ================================================
echo.
pause
exit /b 1

:buildfail
echo.
echo   [오류] 화면을 만들지 못했습니다.
echo          수집 데이터가 아직 없으면 collect-g2b.bat 을 먼저 실행하세요.
echo.
pause
exit /b 1

:oldpage
echo.
echo   [오류] 코드는 받았는데 화면이 예전 것으로 만들어졌습니다.
echo          이 화면을 그대로 캡처해서 관리자에게 알려 주세요.
echo.
pause
exit /b 1
