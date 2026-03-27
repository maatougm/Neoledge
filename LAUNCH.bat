@echo off
setlocal enabledelayedexpansion
title NeoLeadge — Launch

set "ROOT=%~dp0"
set "BACK_SLN=%ROOT%web\Back"
set "FRONT=%ROOT%web\Front\customapp"

echo.
echo ============================================================
echo   NeoLeadge — Starting servers
echo ============================================================
echo.
echo  Backend   →  http://localhost:5122
echo  Frontend  →  http://localhost:5173
echo  Swagger   →  http://localhost:5122/swagger
echo.
echo  Press Ctrl+C in each window to stop.
echo.

:: Start backend in a new window
start "NeoLeadge Backend" cmd /k "cd /d "%BACK_SLN%" && dotnet run --project Integration.Elise.Api.Template --launch-profile http"

:: Wait 3 seconds for backend to start before opening frontend
timeout /t 3 /nobreak >nul

:: Start frontend in a new window
start "NeoLeadge Frontend" cmd /k "cd /d "%FRONT%" && npm run dev"

:: Wait 4 more seconds then open browser
timeout /t 4 /nobreak >nul
start http://localhost:5173

echo  Both servers launched in separate windows.
echo  Browser opening at http://localhost:5173...
echo.
pause
