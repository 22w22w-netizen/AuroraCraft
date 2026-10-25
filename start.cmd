@echo off
setlocal
REM AuroraCraft Launcher - Windows start script
REM
REM The volume holding this project may disallow executing binaries
REM (content intact but spawn fails with EFTYPE). Electron therefore
REM has to run from an executable-capable drive, so this script
REM mirrors the sources into a runnable directory and launches there.

set "SRC=%~dp0"
if "%SRC:~-1%"=="\" set "SRC=%SRC:~0,-1%"

set "RUN="
if exist "D:\" set "RUN=D:\aurora-l"
if not defined RUN set "RUN=%LOCALAPPDATA%\AuroraCraft\app"

echo [1/3] Sync source
echo       "%SRC%"  to  "%RUN%"
if not exist "%RUN%" mkdir "%RUN%"
robocopy "%SRC%\src" "%RUN%\src" /MIR /NFL /NDL /NJH /NJS /R:1 /W:1 >nul
robocopy "%SRC%\tools" "%RUN%\tools" /MIR /NFL /NDL /NJH /NJS /R:1 /W:1 >nul
copy /Y "%SRC%\package.json" "%RUN%\package.json" >nul

echo [2/3] Check Electron runtime
if not exist "%RUN%\node_modules\electron\dist\electron.exe" (
  echo       Installing dependencies ^(Electron only^)...
  pushd "%RUN%"
  call npm install --no-audit --no-fund
  popd
  if errorlevel 1 (
    echo.
    echo  [!] npm install failed. Run manually:
    echo      cd /d "%RUN%"
    echo      npm install
    pause
    exit /b 1
  )
)

echo [3/3] Launch AuroraCraft
if "%AC_DATA_DIR%"=="" set "AC_DATA_DIR=%LOCALAPPDATA%\AuroraCraft\data"
pushd "%RUN%"
"%RUN%\node_modules\electron\dist\electron.exe" "%RUN%" %*
set "CODE=%ERRORLEVEL%"
popd
exit /b %CODE%
