@echo off
setlocal EnableDelayedExpansion

echo ============================================================
echo  AI Agent Platform — Electron Build
echo ============================================================
echo.

:: Check Node.js
where node >nul 2>&1
if errorlevel 1 (
    echo ERROR: node.exe not found.
    echo        Install Node.js 20+ from https://nodejs.org
    pause & exit /b 1
)
for /f "tokens=*" %%v in ('node -e "process.stdout.write(process.version)"') do set NODE_VER=%%v
echo Node.js %NODE_VER% found.
echo.

:: Install dependencies
echo [1/2] Installing dependencies...
npm install
if errorlevel 1 ( echo ERROR: npm install failed. & pause & exit /b 1 )
echo       Done.
echo.

:: Build
echo [2/2] Building Windows installer...
npm run build
if errorlevel 1 ( echo ERROR: Build failed. & pause & exit /b 1 )
echo       Done.
echo.

echo ============================================================
echo  SUCCESS
echo  Installer : dist\AI Agent Platform Setup 1.0.0.exe
echo  Unpacked  : dist\win-unpacked\AI Agent Platform.exe
echo ============================================================
echo.
pause
