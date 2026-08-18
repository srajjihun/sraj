@echo off
chcp 65001 >nul
title Notice document analysis (all)
setlocal

rem IMPORTANT: keep this file 100%% ASCII. See scripts\g2b\say.mjs for why.
rem All Korean shown to the user is printed by node.
rem
rem Same as the normal analysis .bat but reads EVERY notice in one go instead
rem of the top 20. It exists because you cannot pass "--all" to a .bat by
rem double-clicking it in Explorer - the argument has to be baked in.

rem Run from a copy in TEMP: getcode.bat updates this file mid-run, and cmd.exe
rem re-reads a running .bat by byte offset. See the analysis .bat for the details.
if "%SRAJ_STAGE%"=="1" goto :main
set "SRAJ_STAGE=1"
for %%i in ("%~dp0.") do set "SRAJ_HOME=%%~fi"
copy /y "%~f0" "%TEMP%\sraj-docsall.bat" >nul 2>&1
if not exist "%TEMP%\sraj-docsall.bat" goto :main
cmd /c call "%TEMP%\sraj-docsall.bat" %* & exit /b

:main
if "%SRAJ_HOME%"=="" for %%i in ("%~dp0.") do set "SRAJ_HOME=%%~fi"
cd /d "%SRAJ_HOME%"
set "SAY=node scripts\g2b\say.mjs"

%SAY% docs-all-head

call "%SRAJ_HOME%\getcode.bat"

%SAY% docs-step2
node "scripts\g2b\docs.mjs" --all
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
