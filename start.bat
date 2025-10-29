@echo off
title Vinsmoke Backend v1.0.0
echo 🚀 Starting Vinsmoke Bot Backend v1.0.0...

REM Check Node.js version
for /f "tokens=1 delims=v" %%i in ('node --version') do set NODE_VERSION=%%i
for /f "tokens=1 delims=." %%i in ("%NODE_VERSION:~1%") do set MAJOR_VERSION=%%i
if %MAJOR_VERSION% LSS 18 (
    echo ❌ Node.js 18+ required. Please upgrade Node.js
    pause
    exit /b 1
)

REM Check if .env exists, if not copy from example
if not exist .env (
    echo 📝 Creating .env from example...
    copy .env.example .env
    echo ⚠️  Please edit .env with your configuration before running again
    echo    Required: NODE_ENV, FRONTEND_URL
    echo    Optional: GITHUB_CLIENT_ID, GITHUB_CLIENT_SECRET
    pause
    exit /b 1
)

REM Install dependencies if node_modules doesn't exist
if not exist node_modules (
    echo 📦 Installing production dependencies...
    npm ci --only=production
)

REM Create necessary directories
echo 📁 Setting up directories...
if not exist sessions mkdir sessions
if not exist data mkdir data
if not exist logs mkdir logs

REM Set default environment variables if not set
if not defined NODE_ENV (
    echo ⚠️  NODE_ENV not set, defaulting to production
    set NODE_ENV=production
)

if not defined PORT (
    echo ⚠️  PORT not set, defaulting to 8080
    set PORT=8080
)

REM Security check for production
if "%NODE_ENV%"=="production" (
    if not defined FRONTEND_URL (
        echo ❌ FRONTEND_URL required in production mode
        pause
        exit /b 1
    )
)

REM Start the server
echo 🌟 Starting server on port %PORT%...
echo 🌍 Environment: %NODE_ENV%
echo 🔒 Security: Enhanced
echo ⚡ Performance: Optimized
echo 📊 Health Check: http://localhost:%PORT%/api/health
echo.

REM Check if PM2 is available
where pm2 >nul 2>nul
if %ERRORLEVEL% EQU 0 (
    echo 🔄 Starting with PM2 process manager...
    pm2 start server.js --name "vinsmoke-backend" --env production
    pm2 logs vinsmoke-backend
) else (
    echo 🔄 Starting with Node.js...
    echo 💡 Tip: Install PM2 globally for better process management: npm install -g pm2
    node server.js
)

pause