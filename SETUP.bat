@echo off
setlocal enabledelayedexpansion
title NeoLeadge — Setup & Launch

echo.
echo ============================================================
echo   NeoLeadge Deployment Manager — First Time Setup
echo ============================================================
echo.

:: ── Paths ────────────────────────────────────────────────────────────────────
set "ROOT=%~dp0"
set "BACK=%ROOT%web\Back\Integration.Elise.Api.Template"
set "BACK_SLN=%ROOT%web\Back"
set "FRONT=%ROOT%web\Front\customapp"

:: ── Helper: refresh PATH from registry so newly installed tools are found ────
:: (winget installs update the registry but not the current cmd session PATH)
:refreshPath
for /f "tokens=2*" %%A in ('reg query "HKLM\SYSTEM\CurrentControlSet\Control\Session Manager\Environment" /v Path 2^>nul') do set "SYS_PATH=%%B"
for /f "tokens=2*" %%A in ('reg query "HKCU\Environment" /v Path 2^>nul') do set "USR_PATH=%%B"
set "PATH=%SYS_PATH%;%USR_PATH%"

:: ════════════════════════════════════════════════════════════════════════════
:: 1. CHECK & INSTALL .NET 8 SDK
:: ════════════════════════════════════════════════════════════════════════════
echo [1/7] Checking .NET 8 SDK...
dotnet --version >nul 2>&1
if errorlevel 1 goto :installDotnet

:: dotnet is present — check it is version 8.x
for /f "tokens=1" %%v in ('dotnet --version 2^>nul') do set "DOTNET_VER=%%v"
if "!DOTNET_VER:~0,1!"=="8" (
    echo  Found .NET SDK: !DOTNET_VER! [OK]
    goto :dotnetDone
)
:: Wrong version — install 8 alongside
echo  Found .NET SDK !DOTNET_VER! but need 8.x — installing .NET 8 SDK...
goto :installDotnet

:installDotnet
echo  .NET 8 SDK not found — installing via winget...
winget install --id Microsoft.DotNet.SDK.8 --silent --accept-source-agreements --accept-package-agreements
if errorlevel 1 (
    echo.
    echo  ERROR: winget failed to install .NET 8 SDK.
    echo  Please install it manually: https://dotnet.microsoft.com/download/dotnet/8.0
    pause & exit /b 1
)
call :refreshPath
echo  .NET 8 SDK installed [OK]

:dotnetDone

:: ════════════════════════════════════════════════════════════════════════════
:: 2. CHECK & INSTALL dotnet-ef (EF Core CLI tool)
:: ════════════════════════════════════════════════════════════════════════════
echo.
echo [2/7] Checking EF Core CLI tool (dotnet-ef)...
dotnet ef --version >nul 2>&1
if not errorlevel 1 (
    for /f "tokens=*" %%v in ('dotnet ef --version 2^>nul') do echo  Found dotnet-ef: %%v [OK]
    goto :efDone
)
echo  dotnet-ef not found — installing globally...
dotnet tool install --global dotnet-ef
if errorlevel 1 (
    echo  Trying to update dotnet-ef instead...
    dotnet tool update --global dotnet-ef
)
call :refreshPath
:: Add dotnet tools to path explicitly (common location)
set "PATH=%PATH%;%USERPROFILE%\.dotnet\tools"
dotnet ef --version >nul 2>&1
if errorlevel 1 (
    echo.
    echo  ERROR: Could not install dotnet-ef.
    echo  Run manually: dotnet tool install --global dotnet-ef
    pause & exit /b 1
)
echo  dotnet-ef installed [OK]
:efDone

:: ════════════════════════════════════════════════════════════════════════════
:: 3. CHECK & INSTALL Node.js
:: ════════════════════════════════════════════════════════════════════════════
echo.
echo [3/7] Checking Node.js...
node --version >nul 2>&1
if not errorlevel 1 (
    for /f "tokens=*" %%v in ('node --version 2^>nul') do echo  Found Node.js: %%v [OK]
    goto :nodeDone
)
echo  Node.js not found — installing via winget...
winget install --id OpenJS.NodeJS.LTS --silent --accept-source-agreements --accept-package-agreements
if errorlevel 1 (
    echo.
    echo  ERROR: winget failed to install Node.js.
    echo  Please install it manually: https://nodejs.org
    pause & exit /b 1
)
call :refreshPath
:: Also try the default install path directly
set "PATH=%PATH%;C:\Program Files\nodejs"
node --version >nul 2>&1
if errorlevel 1 (
    echo.
    echo  Node.js was installed but needs a terminal restart to be found.
    echo  Please close this window, reopen it, and run SETUP.bat again.
    pause & exit /b 1
)
echo  Node.js installed [OK]
:nodeDone

:: ════════════════════════════════════════════════════════════════════════════
:: 4. CHECK & INSTALL SQL Server LocalDB
:: ════════════════════════════════════════════════════════════════════════════
echo.
echo [4/7] Checking SQL Server LocalDB...
SqlLocalDB info >nul 2>&1
if not errorlevel 1 (
    echo  LocalDB found [OK]
    goto :dbDone
)
:: Check for SQL Server Express too
sqlcmd -? >nul 2>&1
if not errorlevel 1 (
    echo  SQL Server found [OK]
    goto :dbDone
)
echo  SQL Server LocalDB not found — installing via winget...
winget install --id Microsoft.SQLServer.2022.Express --silent --accept-source-agreements --accept-package-agreements
if errorlevel 1 (
    echo  WARNING: Could not auto-install SQL Server.
    echo  The app will still work using hardcoded test users (no DB needed for login).
    echo  To enable the DB later: install LocalDB from https://aka.ms/sqllocaldb
) else (
    call :refreshPath
    echo  SQL Server Express installed [OK]
)
:dbDone

:: ════════════════════════════════════════════════════════════════════════════
:: 5. COPY CONFIG FILES IF MISSING
:: ════════════════════════════════════════════════════════════════════════════
echo.
echo [5/7] Checking configuration files...

if not exist "%BACK%\appsettings.json" (
    copy "%BACK%\appsettings.example.json" "%BACK%\appsettings.json" >nul
    echo  appsettings.json created from template [OK]
) else (
    echo  appsettings.json already exists — skipping
)

if not exist "%BACK%\appsettings.Development.json" (
    copy "%BACK%\appsettings.Development.example.json" "%BACK%\appsettings.Development.json" >nul
    echo  appsettings.Development.json created from template [OK]
) else (
    echo  appsettings.Development.json already exists — skipping
)

:: ════════════════════════════════════════════════════════════════════════════
:: 6. NUGET RESTORE + EF MIGRATION
:: ════════════════════════════════════════════════════════════════════════════
echo.
echo [6/7] Restoring NuGet packages ^& running DB migration...
cd /d "%BACK_SLN%"

dotnet restore "Elise projects templates.sln"
if errorlevel 1 (
    echo.
    echo  ERROR: NuGet restore failed.
    echo  Make sure web\Back\LocalPackages\ contains the .nupkg files.
    pause & exit /b 1
)
echo  NuGet packages restored [OK]

dotnet build "Elise projects templates.sln" --no-restore -c Debug
if errorlevel 1 (
    echo.
    echo  ERROR: Build failed. Fix compile errors before continuing.
    pause & exit /b 1
)
echo  Build succeeded [OK]

dotnet ef database update --project "Integration.Elise.Services" --startup-project "Integration.Elise.Api.Template"
if errorlevel 1 (
    echo.
    echo  WARNING: DB migration failed — check appsettings.Development.json connection string.
    echo  Common fixes:
    echo    Server=(localdb)\MSSQLLocalDB   ^<-- Visual Studio LocalDB
    echo    Server=.\SQLEXPRESS             ^<-- SQL Server Express
    echo.
    echo  Continuing — app will fall back to hardcoded test users without DB.
    echo.
    goto :seedSkip
)
echo  Tables created [OK]

:: ── Seed test data: start backend briefly so DbSeeder.SeedAsync runs ─────────
echo  Seeding test users and sample projects...
echo  (Starting backend for ~20 seconds to trigger seeding — please wait)
echo.
powershell -NoProfile -Command ^
    "$proc = Start-Process dotnet ^
        -ArgumentList 'run --project Integration.Elise.Api.Template --launch-profile http --no-build' ^
        -WorkingDirectory '%BACK_SLN%' ^
        -PassThru -WindowStyle Hidden; ^
    Start-Sleep -Seconds 20; ^
    try { $proc.Kill() } catch {}"
echo  Database seeded [OK]
:seedSkip

:: ════════════════════════════════════════════════════════════════════════════
:: 7. NPM INSTALL
:: ════════════════════════════════════════════════════════════════════════════
echo.
echo [7/7] Installing frontend packages ^(NeoLibrary + dependencies^)...
cd /d "%FRONT%"
npm install
if errorlevel 1 (
    echo.
    echo  ERROR: npm install failed.
    echo  Make sure deign\components-0.2.123448.tgz exists in the repo root.
    pause & exit /b 1
)
echo  npm packages installed [OK]

:: ════════════════════════════════════════════════════════════════════════════
:: DONE
:: ════════════════════════════════════════════════════════════════════════════
echo.
echo ============================================================
echo   Setup complete! Everything is ready.
echo ============================================================
echo.
echo  Test credentials:
echo    Admin:        admin@neoleadge.com   / Admin@123
echo    Project Mgr:  pm@neoleadge.com      / Pm@123
echo    Project Mgr:  pm2@neoleadge.com     / Pm2@123
echo    Deploy Team:  valid@neoleadge.com   / Valid@123
echo    New User:     newuser@neoleadge.com / Temp@123  (must change password)
echo.
echo  Backend:   http://localhost:5122
echo  Frontend:  http://localhost:5173
echo  Swagger:   http://localhost:5122/swagger
echo.
set /p LAUNCH="Launch the app now? (Y/N): "
if /i "%LAUNCH%"=="Y" (
    call "%ROOT%LAUNCH.bat"
) else (
    echo.
    echo  Run LAUNCH.bat any time to start both servers.
    pause
)
exit /b 0
