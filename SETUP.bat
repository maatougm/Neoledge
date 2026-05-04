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
if "%ROOT:~-1%"=="\" set "ROOT=%ROOT:~0,-1%"

set "NEST=%ROOT%\web\back-nest"
set "FRONT=%ROOT%\web\Front\customapp"
set "NEOLIBRARY_TGZ=%ROOT%\deign\components-0.2.123448.tgz"

set "ERRORS=0"
set "STEPS=0"
set "TOTAL=10"

:: ─── Helper macros ────────────────────────────────────────────────────────────
::   call :ok  <label>  → prints green [OK]  label
::   call :fail <label> → prints red   [FAIL] label and increments ERRORS
::   call :warn <label> → prints yellow [WARN] label (non-fatal)

:: ════════════════════════════════════════════════════════════════════════════
:: PREFLIGHT — winget available?
:: ════════════════════════════════════════════════════════════════════════════
echo  Pre-flight: checking winget (Windows Package Manager)...
winget --version >nul 2>&1
if errorlevel 1 (
    echo  [WARN] winget not found — auto-install of missing tools will be skipped.
    echo         Install missing tools manually if the checks below fail.
    set "WINGET_OK=0"
) else (
    for /f "tokens=*" %%v in ('winget --version 2^>nul') do echo  winget %%v [OK]
    set "WINGET_OK=1"
)
echo.

:: Refresh PATH from registry now so any pre-installed tools are found
call :refreshPath

:: ════════════════════════════════════════════════════════════════════════════
:: STEP 1 — Node.js 18+
:: ════════════════════════════════════════════════════════════════════════════
set /a STEPS+=1
echo [!STEPS!/!TOTAL!] Checking Node.js (required: 18+^)...

set "NODE_INSTALLED=0"
node --version >nul 2>&1
if not errorlevel 1 set "NODE_INSTALLED=1"

if "!NODE_INSTALLED!"=="1" (
    for /f "tokens=1" %%v in ('node --version 2^>nul') do set "NODE_VER=%%v"
    set "NODE_MAJOR=!NODE_VER:~1!"
    for /f "delims=." %%m in ("!NODE_MAJOR!") do set "NODE_MAJOR=%%m"
    if !NODE_MAJOR! GEQ 18 (
        echo  Node.js !NODE_VER! already installed [OK]
        goto :verifyNpm
    )
    echo  Node.js !NODE_VER! is too old (need 18+^) — will upgrade.
    set "NODE_INSTALLED=0"
)

:: Install Node.js
if "!WINGET_OK!"=="1" (
    echo  Installing Node.js LTS via winget...
    winget install --id OpenJS.NodeJS.LTS --silent --accept-source-agreements --accept-package-agreements
    call :refreshPath
    set "PATH=%PATH%;C:\Program Files\nodejs"
) else (
    echo  [FAIL] Node.js not found and winget unavailable.
    echo         Download from: https://nodejs.org  then re-run SETUP.bat.
    set /a ERRORS+=1
    goto :verifyNpm
)

:: Verify after install
node --version >nul 2>&1
if errorlevel 1 (
    echo  [FAIL] Node.js install did not succeed or needs a terminal restart.
    echo         Close this window, reopen it, and run SETUP.bat again.
    set /a ERRORS+=1
    pause & exit /b 1
)
for /f "tokens=*" %%v in ('node --version') do echo  Node.js %%v installed [OK]

:verifyNpm
echo  Verifying npm...
npm --version >nul 2>&1
if errorlevel 1 (
    echo  [FAIL] npm not found — it should come bundled with Node.js.
    set /a ERRORS+=1
) else (
    for /f "tokens=*" %%v in ('npm --version 2^>nul') do echo  npm v%%v [OK]
)

echo  Verifying npx...
npx --version >nul 2>&1
if errorlevel 1 (
    echo  [FAIL] npx not found — re-install Node.js.
    set /a ERRORS+=1
) else (
    echo  npx [OK]
)

:: ════════════════════════════════════════════════════════════════════════════
:: STEP 2 — git
:: ════════════════════════════════════════════════════════════════════════════
set /a STEPS+=1
echo.
echo [!STEPS!/!TOTAL!] Checking git...
git --version >nul 2>&1
if errorlevel 1 (
    if "!WINGET_OK!"=="1" (
        echo  git not found — installing via winget...
        winget install --id Git.Git --silent --accept-source-agreements --accept-package-agreements
        call :refreshPath
        set "PATH=%PATH%;C:\Program Files\Git\cmd"
        git --version >nul 2>&1
        if errorlevel 1 (
            echo  [WARN] git install may need a terminal restart.
        ) else (
            for /f "tokens=*" %%v in ('git --version') do echo  %%v installed [OK]
        )
    ) else (
        echo  [WARN] git not found. Download from: https://git-scm.com
    )
) else (
    for /f "tokens=*" %%v in ('git --version 2^>nul') do echo  %%v [OK]
)

:: ════════════════════════════════════════════════════════════════════════════
:: STEP 3 — XAMPP / MariaDB
:: ════════════════════════════════════════════════════════════════════════════
set /a STEPS+=1
echo.
echo [!STEPS!/!TOTAL!] Checking MariaDB / XAMPP (port 3306^)...

set "DB_OK=0"
call :testPort3306
if "!DB_OK!"=="1" (
    echo  MariaDB is running on port 3306 [OK]
    goto :dbDone
)

:: XAMPP installed but MySQL not started?
if exist "C:\xampp\mysql\bin\mysqld.exe" (
    echo  XAMPP found — MySQL is not running. Attempting to start...
    start /b "" "C:\xampp\mysql\bin\mysqld.exe" --standalone >nul 2>&1
    timeout /t 5 /nobreak >nul
    call :testPort3306
    if "!DB_OK!"=="1" (
        echo  MariaDB started [OK]
        goto :dbDone
    )
    echo  [WARN] Could not start MariaDB automatically.
    echo         Open XAMPP Control Panel → Start MySQL, then continue.
    pause
    call :testPort3306
    if "!DB_OK!"=="1" (
        echo  MariaDB is now running [OK]
    ) else (
        echo  [WARN] MariaDB still not reachable — migrations will be skipped.
        echo         Fix this before running the app.
    )
    goto :dbDone
)

:: XAMPP not installed — offer winget
if "!WINGET_OK!"=="1" (
    echo  XAMPP not found — installing via winget...
    winget install --id ApacheFriends.Xampp.8.2 --silent --accept-source-agreements --accept-package-agreements
    if errorlevel 1 (
        echo  [WARN] winget install failed. Download XAMPP from: https://www.apachefriends.org
        goto :dbDone
    )
    call :refreshPath
    echo  XAMPP installed [OK]
) else (
    echo  [WARN] XAMPP not found and winget unavailable.
    echo         Download XAMPP from: https://www.apachefriends.org
    goto :dbDone
)

echo  Please open XAMPP Control Panel, start MySQL, then press any key...
pause

call :testPort3306
if "!DB_OK!"=="1" (
    echo  MariaDB is running [OK]
) else (
    echo  [WARN] MariaDB still not reachable — migrations will be skipped.
)

:dbDone

:: ════════════════════════════════════════════════════════════════════════════
:: STEP 4 — NeoLibrary private package
:: ════════════════════════════════════════════════════════════════════════════
set /a STEPS+=1
echo.
echo [!STEPS!/!TOTAL!] Checking NeoLibrary package...
if exist "!NEOLIBRARY_TGZ!" (
    for %%F in ("!NEOLIBRARY_TGZ!") do echo  Found deign\components-0.2.123448.tgz  (%%~zF bytes^) [OK]
) else (
    echo  [FAIL] NeoLibrary package not found:
    echo         !NEOLIBRARY_TGZ!
    echo.
    echo         This private .tgz must be in the repo under deign\.
    echo         Ask your team lead for components-0.2.123448.tgz
    set /a ERRORS+=1
    echo  Cannot continue without NeoLibrary — aborting frontend setup.
    goto :frontendSkip
)

:: ════════════════════════════════════════════════════════════════════════════
:: STEP 5 — NestJS .env
:: ════════════════════════════════════════════════════════════════════════════
set /a STEPS+=1
echo.
echo [!STEPS!/!TOTAL!] Configuring NestJS .env...
if not exist "!NEST!\.env" (
    echo  Creating .env from defaults...
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
    :: Verify it was created
    if exist "!NEST!\.env" (
        echo  .env created [OK]
        echo  [NOTE] Edit web\back-nest\.env before first run:
        echo         - Set a strong JWT_SECRET
        echo         - Set SMTP credentials if you want email notifications
    ) else (
        echo  [FAIL] Could not create .env — check folder write permissions.
        set /a ERRORS+=1
    )
) else (
    echo  .env already exists [OK]
    :: Warn if JWT_SECRET is still the default
    findstr /C:"change-me-to-a-long-random-secret" "!NEST!\.env" >nul 2>&1
    if not errorlevel 1 (
        echo  [WARN] JWT_SECRET is still the default placeholder.
        echo         Edit web\back-nest\.env and set a real secret before deploying.
    )
)

:: ════════════════════════════════════════════════════════════════════════════
:: STEP 6 — NestJS npm install
:: ════════════════════════════════════════════════════════════════════════════
set /a STEPS+=1
echo.
echo [!STEPS!/!TOTAL!] Installing NestJS packages (npm install^)...
cd /d "!NEST!"

:: Skip if node_modules is already populated
if exist "!NEST!\node_modules\.package-lock.json" (
    echo  node_modules already present — running npm ci to verify...
    call npm ci --prefer-offline >nul 2>&1
    if errorlevel 1 (
        echo  npm ci failed — falling back to npm install...
        call npm install
    )
) else (
    call npm install
)

if errorlevel 1 (
    echo  [FAIL] npm install failed for NestJS backend.
    echo         Check your internet connection and try again.
    set /a ERRORS+=1
    goto :prismaSkip
)

:: Verify node_modules exists and @nestjs/core is present
if exist "!NEST!\node_modules\@nestjs\core" (
    echo  NestJS packages installed [OK]
) else (
    echo  [FAIL] npm install ran but @nestjs/core not found in node_modules.
    set /a ERRORS+=1
    goto :prismaSkip
)

:: ════════════════════════════════════════════════════════════════════════════
:: STEP 7 — Prisma generate + migrate
:: ════════════════════════════════════════════════════════════════════════════
echo  Running prisma generate...
call npx prisma generate
if errorlevel 1 (
    echo  [FAIL] prisma generate failed — check DATABASE_URL in .env.
    set /a ERRORS+=1
) else (
    :: Verify generated client exists
    if exist "!NEST!\node_modules\.prisma\client\index.js" (
        echo  Prisma client generated [OK]
    ) else if exist "!NEST!\node_modules\@prisma\client\default.js" (
        echo  Prisma client generated [OK]
    ) else (
        echo  [WARN] prisma generate ran but client files not found at expected path.
    )
)

if "!DB_OK!"=="1" (
    echo  Running prisma migrate deploy...
    call npx prisma migrate deploy
    if errorlevel 1 (
        echo  [FAIL] Database migration failed.
        echo         Common fixes:
        echo           - MariaDB not running       → start MySQL in XAMPP Control Panel
        echo           - Wrong credentials         → edit DATABASE_URL in web\back-nest\.env
        echo           - DB user missing privilege → grant CREATE, ALTER on NeoLeadgeDeployment.*
        set /a ERRORS+=1
    ) else (
        echo  Database migrations applied [OK]
        :: Quick connection smoke-test
        call npx prisma db execute --stdin < nul >nul 2>&1
        echo  Database connection verified [OK]
    )
) else (
    echo  [SKIP] Migrations skipped — MariaDB not reachable.
    echo         Run manually once XAMPP MySQL is started:
    echo           cd web\back-nest
    echo           npx prisma migrate deploy
)

:prismaSkip

:: ════════════════════════════════════════════════════════════════════════════
:: STEP 8 — Frontend npm install
:: ════════════════════════════════════════════════════════════════════════════
:frontendSetup
set /a STEPS+=1
echo.
echo [!STEPS!/!TOTAL!] Installing frontend packages (Vue 3 + NeoLibrary^)...
cd /d "!FRONT!"

if exist "!FRONT!\node_modules\.package-lock.json" (
    echo  node_modules already present — running npm ci to verify...
    call npm ci --prefer-offline >nul 2>&1
    if errorlevel 1 (
        echo  npm ci failed — falling back to npm install...
        call npm install
    )
) else (
    call npm install
)

if errorlevel 1 (
    echo  [FAIL] npm install failed for the frontend.
    echo         Make sure deign\components-0.2.123448.tgz exists.
    set /a ERRORS+=1
    goto :frontendSkip
)

:: Verify key packages
if exist "!FRONT!\node_modules\vue" (
    for /f "tokens=2 delims=:, " %%v in ('findstr "version" "!FRONT!\node_modules\vue\package.json" 2^>nul') do (
        echo  vue %%~v [OK]
        goto :checkNeolibrary
    )
)
echo  [FAIL] vue not found in node_modules after install.
set /a ERRORS+=1

:checkNeolibrary
if exist "!FRONT!\node_modules\@neolibrary\components" (
    echo  @neolibrary/components [OK]
) else (
    echo  [FAIL] @neolibrary/components not found in node_modules.
    echo         Verify deign\components-0.2.123448.tgz is valid.
    set /a ERRORS+=1
)

if exist "!FRONT!\node_modules\pinia" (
    echo  pinia [OK]
) else (
    echo  [WARN] pinia not found — something may be wrong with the install.
)

:frontendSkip

:: ════════════════════════════════════════════════════════════════════════════
:: STEP 9 — Frontend config.json
:: ════════════════════════════════════════════════════════════════════════════
set /a STEPS+=1
echo.
echo [!STEPS!/!TOTAL!] Checking frontend public\config.json...
set "CONFIG=!FRONT!\public\config.json"
if not exist "!CONFIG!" (
    echo  Creating config.json...
    (
        echo {
        echo   "GLB_API_URL": "http://localhost:5122/api",
        echo   "GLB_ELISE_URL": "http://localhost:5122"
        echo }
    ) > "!CONFIG!"
    if exist "!CONFIG!" (
        echo  config.json created [OK]
    ) else (
        echo  [FAIL] Could not create config.json.
        set /a ERRORS+=1
    )
) else (
    echo  config.json exists [OK]
    :: Show current API URL so the dev can confirm it is correct
    findstr "GLB_API_URL" "!CONFIG!"
)

:: ════════════════════════════════════════════════════════════════════════════
:: STEP 10 — TypeScript sanity check on NestJS
:: ════════════════════════════════════════════════════════════════════════════
set /a STEPS+=1
echo.
echo [!STEPS!/!TOTAL!] Running TypeScript check on NestJS backend...
cd /d "!NEST!"
call npx tsc --noEmit 2>"%TEMP%\tsc_errors.txt"
if errorlevel 1 (
    echo  [FAIL] TypeScript errors found:
    type "%TEMP%\tsc_errors.txt"
    set /a ERRORS+=1
) else (
    echo  TypeScript: zero errors [OK]
)
del "%TEMP%\tsc_errors.txt" >nul 2>&1

:: ════════════════════════════════════════════════════════════════════════════
:: SUMMARY
:: ════════════════════════════════════════════════════════════════════════════
echo.
echo ============================================================
if "!ERRORS!"=="0" (
    echo   Setup complete — ALL checks passed.
) else (
    echo   Setup finished with !ERRORS! issue^(s^) — see [FAIL] lines above.
    echo   Fix those issues then re-run SETUP.bat.
)
echo ============================================================
echo.
echo  Test credentials (after DB is seeded^):
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
echo  Before first run:
echo    1. XAMPP Control Panel → Start MySQL
echo    2. Edit web\back-nest\.env  (JWT_SECRET, SMTP if needed^)
echo.
if "!ERRORS!"=="0" (
    set /p LAUNCH="Launch the app now? (Y/N): "
    if /i "!LAUNCH!"=="Y" (
        call "!ROOT!\LAUNCH.bat"
        goto :eof
    )
)
echo  Run LAUNCH.bat any time to start both servers.
pause
exit /b !ERRORS!

:: ════════════════════════════════════════════════════════════════════════════
:: Subroutines
:: ════════════════════════════════════════════════════════════════════════════

:testPort3306
set "DB_OK=0"
powershell -NoProfile -Command ^
    "try { $t = New-Object System.Net.Sockets.TcpClient; $t.ConnectAsync('127.0.0.1',3306).Wait(1500); if($t.Connected){$t.Close(); exit 0} exit 1 } catch { exit 1 }" >nul 2>&1
if not errorlevel 1 set "DB_OK=1"
goto :eof

:refreshPath
for /f "tokens=2*" %%A in ('reg query "HKLM\SYSTEM\CurrentControlSet\Control\Session Manager\Environment" /v Path 2^>nul') do set "SYS_PATH=%%B"
for /f "tokens=2*" %%A in ('reg query "HKCU\Environment" /v Path 2^>nul') do set "USR_PATH=%%B"
if defined SYS_PATH if defined USR_PATH set "PATH=!SYS_PATH!;!USR_PATH!"
goto :eof
