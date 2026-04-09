@echo off
setlocal enabledelayedexpansion
title NeoLeadge — Setup (NestJS + Vue 3)
chcp 65001 >nul

echo.
echo ============================================================
echo   NeoLeadge Deployment Manager — First Time Setup
echo   NestJS + Prisma + MariaDB  /  Vue 3 + NeoLibrary
echo ============================================================
echo.

:: ── Absolute paths ────────────────────────────────────────────────────────────
set "ROOT=%~dp0"
:: strip trailing backslash
if "%ROOT:~-1%"=="\" set "ROOT=%ROOT:~0,-1%"

set "NEST=%ROOT%\web\back-nest"
set "FRONT=%ROOT%\web\Front\customapp"
set "NEOLIBRARY_TGZ=%ROOT%\deign\components-0.2.123448.tgz"

:: ── Refresh PATH from registry (picks up winget installs in same session) ─────
call :refreshPath

set "STEPS=0"
set "TOTAL=7"

:: ════════════════════════════════════════════════════════════════════════════
:: STEP 1 — Node.js 18+
:: ════════════════════════════════════════════════════════════════════════════
set /a STEPS+=1
echo [!STEPS!/!TOTAL!] Checking Node.js...
node --version >nul 2>&1
if errorlevel 1 goto :installNode

for /f "tokens=1" %%v in ('node --version 2^>nul') do set "NODE_VER=%%v"
:: Extract major version number (strip leading 'v' then take before first dot)
set "NODE_MAJOR=!NODE_VER:~1!"
for /f "delims=." %%m in ("!NODE_MAJOR!") do set "NODE_MAJOR=%%m"
if !NODE_MAJOR! GEQ 18 (
    echo  Found Node.js !NODE_VER! [OK]
    goto :nodeDone
)
echo  Found Node.js !NODE_VER! but need 18+ — installing LTS...

:installNode
echo  Node.js not found or outdated — installing via winget...
winget install --id OpenJS.NodeJS.LTS --silent --accept-source-agreements --accept-package-agreements
if errorlevel 1 (
    echo.
    echo  ERROR: Could not install Node.js automatically.
    echo  Download manually: https://nodejs.org
    pause & exit /b 1
)
call :refreshPath
set "PATH=%PATH%;C:\Program Files\nodejs"
node --version >nul 2>&1
if errorlevel 1 (
    echo.
    echo  Node.js installed but needs a new terminal to be found.
    echo  Close this window, reopen it, and run SETUP.bat again.
    pause & exit /b 1
)
for /f "tokens=*" %%v in ('node --version') do echo  Node.js %%v installed [OK]

:nodeDone

:: ════════════════════════════════════════════════════════════════════════════
:: STEP 2 — XAMPP (MariaDB 10.4)
:: ════════════════════════════════════════════════════════════════════════════
set /a STEPS+=1
echo.
echo [!STEPS!/!TOTAL!] Checking MariaDB / XAMPP...

:: Test if MariaDB is already reachable on port 3306
set "DB_OK=0"
powershell -NoProfile -Command ^
    "try { $t = New-Object System.Net.Sockets.TcpClient; $t.Connect('127.0.0.1',3306); $t.Close(); exit 0 } catch { exit 1 }" >nul 2>&1
if not errorlevel 1 (
    echo  MariaDB is running on port 3306 [OK]
    set "DB_OK=1"
    goto :dbDone
)

:: Check if XAMPP is installed but MySQL not started
if exist "C:\xampp\mysql\bin\mysqld.exe" (
    echo  XAMPP found but MariaDB is not running.
    echo  Starting XAMPP MySQL service...
    "C:\xampp\mysql\bin\mysqld.exe" --standalone >nul 2>&1 &
    timeout /t 4 /nobreak >nul
    powershell -NoProfile -Command ^
        "try { $t = New-Object System.Net.Sockets.TcpClient; $t.Connect('127.0.0.1',3306); $t.Close(); exit 0 } catch { exit 1 }" >nul 2>&1
    if not errorlevel 1 (
        echo  MariaDB started [OK]
        set "DB_OK=1"
        goto :dbDone
    )
    echo  Could not start MariaDB automatically.
    echo  Please open XAMPP Control Panel and click Start next to MySQL.
    pause
    goto :dbDone
)

:: XAMPP not found — offer to install
echo  XAMPP not found — installing via winget...
winget install --id ApacheFriends.Xampp.8.2 --silent --accept-source-agreements --accept-package-agreements
if errorlevel 1 (
    echo.
    echo  WARNING: Could not auto-install XAMPP.
    echo  Download from: https://www.apachefriends.org
    echo  Install it, then open XAMPP Control Panel and start MySQL.
    echo  After that, re-run this script.
    pause & exit /b 1
)
call :refreshPath
echo  XAMPP installed [OK]
echo  Please open XAMPP Control Panel and start MySQL, then press any key...
pause
goto :dbCheck2

:dbCheck2
powershell -NoProfile -Command ^
    "try { $t = New-Object System.Net.Sockets.TcpClient; $t.Connect('127.0.0.1',3306); $t.Close(); exit 0 } catch { exit 1 }" >nul 2>&1
if not errorlevel 1 (
    echo  MariaDB is running [OK]
    set "DB_OK=1"
) else (
    echo  WARNING: MariaDB still not reachable. Continuing anyway — fix before running the app.
)

:dbDone

:: ════════════════════════════════════════════════════════════════════════════
:: STEP 3 — NeoLibrary .tgz package check
:: ════════════════════════════════════════════════════════════════════════════
set /a STEPS+=1
echo.
echo [!STEPS!/!TOTAL!] Checking NeoLibrary package...
if exist "!NEOLIBRARY_TGZ!" (
    echo  Found deign\components-0.2.123448.tgz [OK]
) else (
    echo.
    echo  ERROR: NeoLibrary package not found at:
    echo    !NEOLIBRARY_TGZ!
    echo.
    echo  This private package must be present in the repo.
    echo  Ask your team lead for the components-0.2.123448.tgz file
    echo  and place it in: !ROOT!\deign\
    pause & exit /b 1
)

:: ════════════════════════════════════════════════════════════════════════════
:: STEP 4 — NestJS backend: .env + npm install + Prisma
:: ════════════════════════════════════════════════════════════════════════════
set /a STEPS+=1
echo.
echo [!STEPS!/!TOTAL!] Setting up NestJS backend...

:: ── Create .env if missing ──────────────────────────────────────────────────
if not exist "!NEST!\.env" (
    echo  Creating .env from template...
    (
        echo DATABASE_URL="mysql://root@localhost:3306/NeoLeadgeDeployment"
        echo JWT_SECRET="change-me-to-a-long-random-secret-in-production"
        echo JWT_EXPIRES_IN="8h"
        echo PORT=5122
        echo TRANSCRIPTION_URL="http://localhost:8000"
        echo OPENAI_API_KEY=""
        echo SMTP_HOST="smtp.gmail.com"
        echo SMTP_PORT=587
        echo SMTP_USER=""
        echo SMTP_PASS=""
        echo SMTP_FROM="NeoLeadge ^<noreply@neoleadge.com^>"
        echo EMAIL_ENABLED=false
    ) > "!NEST!\.env"
    echo  .env created — edit it to set your JWT_SECRET and SMTP credentials [OK]
) else (
    echo  .env already exists — skipping [OK]
)

:: ── npm install ─────────────────────────────────────────────────────────────
echo  Installing NestJS packages...
cd /d "!NEST!"
call npm install
if errorlevel 1 (
    echo.
    echo  ERROR: npm install failed for NestJS backend.
    echo  Check your internet connection and try again.
    pause & exit /b 1
)
echo  NestJS packages installed [OK]

:: ── Prisma generate ─────────────────────────────────────────────────────────
echo  Running Prisma generate...
call npx prisma generate
if errorlevel 1 (
    echo  WARNING: prisma generate failed — check DATABASE_URL in .env
) else (
    echo  Prisma client generated [OK]
)

:: ── Prisma migrate (only if DB is reachable) ────────────────────────────────
if "!DB_OK!"=="1" (
    echo  Running database migrations...
    call npx prisma migrate deploy
    if errorlevel 1 (
        echo  WARNING: Migration failed.
        echo  Common causes:
        echo    - MariaDB not running  ^(start MySQL in XAMPP Control Panel^)
        echo    - Wrong user/password  ^(edit DATABASE_URL in web\back-nest\.env^)
        echo    - Database does not exist yet  ^(it will be auto-created on first run^)
        echo.
    ) else (
        echo  Database migrations applied [OK]

        :: ── Seed initial data ────────────────────────────────────────────────
        echo  Seeding initial users and demo data...
        call npx prisma db seed >nul 2>&1
        if errorlevel 1 (
            echo  NOTE: Seed script not configured — skipping.
            echo  The app will create the admin user on first login if DbSeeder is wired in.
        ) else (
            echo  Database seeded [OK]
        )
    )
) else (
    echo  Skipping migrations — MariaDB not reachable. Run manually after starting XAMPP:
    echo    cd web\back-nest
    echo    npx prisma migrate deploy
)

:: ════════════════════════════════════════════════════════════════════════════
:: STEP 5 — Vue 3 frontend: npm install
:: ════════════════════════════════════════════════════════════════════════════
set /a STEPS+=1
echo.
echo [!STEPS!/!TOTAL!] Installing frontend packages (Vue 3 + NeoLibrary^)...
cd /d "!FRONT!"
call npm install
if errorlevel 1 (
    echo.
    echo  ERROR: npm install failed for the frontend.
    echo  Make sure deign\components-0.2.123448.tgz exists (checked in step 3).
    pause & exit /b 1
)
echo  Frontend packages installed [OK]

:: ════════════════════════════════════════════════════════════════════════════
:: STEP 6 — Verify frontend config.json
:: ════════════════════════════════════════════════════════════════════════════
set /a STEPS+=1
echo.
echo [!STEPS!/!TOTAL!] Checking frontend config.json...
set "CONFIG=!FRONT!\public\config.json"
if not exist "!CONFIG!" (
    echo  Creating public\config.json...
    (
        echo {
        echo   "GLB_API_URL": "http://localhost:5122/api",
        echo   "GLB_ELISE_URL": "http://localhost:5122"
        echo }
    ) > "!CONFIG!"
    echo  config.json created [OK]
) else (
    echo  config.json already exists — skipping [OK]
)

:: ════════════════════════════════════════════════════════════════════════════
:: STEP 7 — Quick sanity check: tsc --noEmit on NestJS
:: ════════════════════════════════════════════════════════════════════════════
set /a STEPS+=1
echo.
echo [!STEPS!/!TOTAL!] Running TypeScript check on NestJS backend...
cd /d "!NEST!"
call npx tsc --noEmit >nul 2>&1
if errorlevel 1 (
    echo  WARNING: TypeScript errors detected in backend.
    echo  Run:  cd web\back-nest ^&^& npx tsc --noEmit   to see details.
) else (
    echo  TypeScript check passed [OK]
)

:: ════════════════════════════════════════════════════════════════════════════
:: DONE
:: ════════════════════════════════════════════════════════════════════════════
echo.
echo ============================================================
echo   Setup complete! Ready to run.
echo ============================================================
echo.
echo  Test credentials (seeded in DB^):
echo    Admin:        admin@neoleadge.com   / Admin@123
echo    Project Mgr:  pm@neoleadge.com      / Pm@123
echo    Project Mgr:  pm2@neoleadge.com     / Pm2@123
echo    Deploy Team:  valid@neoleadge.com   / Valid@123
echo.
echo  Local URLs once started:
echo    Backend   →  http://localhost:5122
echo    Frontend  →  http://localhost:5173
echo    Swagger   →  http://localhost:5122/api/docs
echo    WebSocket →  ws://localhost:5122/notifications
echo.
echo  Important — before first run:
echo    1. Open XAMPP Control Panel and click Start next to MySQL
echo    2. Edit web\back-nest\.env if needed (JWT_SECRET, SMTP, etc.^)
echo.
set /p LAUNCH="Launch the app now? (Y/N): "
if /i "!LAUNCH!"=="Y" (
    call "!ROOT!\LAUNCH.bat"
) else (
    echo.
    echo  Run LAUNCH.bat any time to start both servers.
    pause
)
exit /b 0

:: ════════════════════════════════════════════════════════════════════════════
:: Subroutine: refresh PATH from registry
:: ════════════════════════════════════════════════════════════════════════════
:refreshPath
for /f "tokens=2*" %%A in ('reg query "HKLM\SYSTEM\CurrentControlSet\Control\Session Manager\Environment" /v Path 2^>nul') do set "SYS_PATH=%%B"
for /f "tokens=2*" %%A in ('reg query "HKCU\Environment" /v Path 2^>nul') do set "USR_PATH=%%B"
if defined SYS_PATH if defined USR_PATH set "PATH=!SYS_PATH!;!USR_PATH!"
goto :eof
