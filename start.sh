#!/bin/bash

# Vinsmoke Backend Professional Startup Script
# Production-ready with security and performance optimizations

echo "🚀 Starting Vinsmoke Bot Backend v1.0.0..."

# Check Node.js version
NODE_VERSION=$(node --version | cut -d'v' -f2 | cut -d'.' -f1)
if [ "$NODE_VERSION" -lt 18 ]; then
    echo "❌ Node.js 18+ required. Current version: $(node --version)"
    exit 1
fi

# Check if .env exists, if not copy from example
if [ ! -f .env ]; then
    echo "📝 Creating .env from example..."
    cp .env.example .env
    echo "⚠️  Please edit .env with your configuration before running again"
    echo "   Required: NODE_ENV, FRONTEND_URL"
    echo "   Optional: GITHUB_CLIENT_ID, GITHUB_CLIENT_SECRET"
    exit 1
fi

# Install dependencies if node_modules doesn't exist
if [ ! -d "node_modules" ]; then
    echo "📦 Installing production dependencies..."
    npm ci --only=production
fi

# Create necessary directories with proper permissions
echo "📁 Setting up directories..."
mkdir -p sessions data logs
chmod 755 sessions data logs

# Validate environment
echo "🔍 Validating environment..."
if [ -z "$NODE_ENV" ]; then
    echo "⚠️  NODE_ENV not set, defaulting to production"
    export NODE_ENV=production
fi

if [ -z "$PORT" ]; then
    echo "⚠️  PORT not set, defaulting to 8080"
    export PORT=8080
fi

# Security check
if [ "$NODE_ENV" = "production" ] && [ -z "$FRONTEND_URL" ]; then
    echo "❌ FRONTEND_URL required in production mode"
    exit 1
fi

# Start the server
echo "🌟 Starting server on port $PORT..."
echo "🌍 Environment: $NODE_ENV"
echo "🔒 Security: Enhanced"
echo "⚡ Performance: Optimized"
echo "📊 Health Check: http://localhost:$PORT/api/health"
echo ""

# Use PM2 if available, otherwise use node directly
if command -v pm2 &> /dev/null; then
    echo "🔄 Starting with PM2 process manager..."
    pm2 start server.js --name "vinsmoke-backend" --env production
    pm2 logs vinsmoke-backend
else
    echo "🔄 Starting with Node.js..."
    node server.js
fi