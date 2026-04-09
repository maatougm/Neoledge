@echo off
setlocal enabledelayedexpansion
title NeoLeadge — Launch
chcp 65001 >nul

set "ROOT=%~dp0"
if "%ROOT:~-1%"=="\" set "ROOT=%ROOT:~0,-1%"

set "NEST=%ROOT%\web\back-nest"
set "FRONT=%ROOT%\web\Front\customapp"

echo.
echo ============================================================
echo   NeoLeadge Deployment Manager — Starting servers
echo ============================================================
echo.
echo  Make sure XAMPP MySQL is running before continuing.
echo.
echo  Backend   →  http://localhost:5122
echo  Frontend  →  http://localhost:5173
echo  Swagger   →  http://localhost:5122/api/docs
echo  WebSocket →  ws://localhost:5122/notifications
echo.
echo  Press Ctrl+C in each window to stop a server.
echo.

:: ── Guard: check .env exists ────────────────────────────────────────────────
if not exist "!NEST!\.env" (
    echo  ERROR: web\back-nest\.env not found.
    echo  Run SETUP.bat first to create it.
    pause & exit /b 1
)

:: ── Guard: check node_modules installed ─────────────────────────────────────
if not exist "!NEST!\node_modules" (
    echo  ERROR: NestJS node_modules not found.
    echo  Run SETUP.bat first to install packages.
    pause & exit /b 1
)
if not exist "!FRONT!\node_modules" (
    echo  ERROR: Frontend node_modules not found.
    echo  Run SETUP.bat first to install packages.
    pause & exit /b 1
)

:: ── Start NestJS backend in a new window ────────────────────────────────────
start "NeoLeadge — Backend (NestJS)" cmd /k ^
    "title NeoLeadge — Backend && cd /d "!NEST!" && npm run start:dev"

:: Wait for NestJS to boot (Prisma + Nest startup takes ~5s)
echo  Waiting for backend to start...
timeout /t 6 /nobreak >nul

:: ── Start Vue 3 frontend in a new window ────────────────────────────────────
start "NeoLeadge — Frontend (Vue 3)" cmd /k ^
    "title NeoLeadge — Frontend && cd /d "!FRONT!" && npm run dev"

:: Wait for Vite to spin up then open browser
timeout /t 4 /nobreak >nul
start http://localhost:5173

echo.
echo  Both servers are starting in separate windows.
echo  Browser opening at http://localhost:5173 ...
echo.
echo  To stop: close each server window or press Ctrl+C inside it.
echo.
pause
