# 🚀 Vinsmoke Bot Backend

**Enterprise-grade WhatsApp Bot Backend API** with advanced session management, security, and performance optimizations.

[![Node.js](https://img.shields.io/badge/Node.js-20.x-green.svg)](https://nodejs.org/)
[![Docker](https://img.shields.io/badge/Docker-Ready-blue.svg)](https://docker.com/)
[![Production](https://img.shields.io/badge/Production-Ready-brightgreen.svg)](https://render.com/)

## ✨ Features

- 🔐 **Enterprise Security** - Helmet.js, rate limiting, CORS protection
- ⚡ **High Performance** - Compression, optimized middleware, caching
- 🐳 **Container Ready** - Optimized Docker with health checks
- 🌐 **Cloud Native** - Deploy on Render, Railway, Heroku, or any platform
- 📱 **WhatsApp Integration** - Full Baileys.js implementation
- 📁 **Session Management** - Complete file-based session handling
- 🛡️ **Rate Limited** - 100 requests per 15 minutes per IP
- 📊 **Health Monitoring** - Built-in health checks and logging

## 🔌 API Endpoints

### Core Session Management
```http
POST   /api/session/qr                    # Generate QR code
POST   /api/session/pairing               # Generate pairing code  
GET    /api/session/:sessionId            # Get session info
DELETE /api/session/:sessionId            # Delete session
```

### Session Files API (Bot Integration)
```http
GET    /api/session/:sessionId/files      # Get files metadata
GET    /api/session/:sessionId/filelist   # Get file list + URLs
GET    /api/session/:sessionId/file/:name # Download individual file
```

### System & Admin
```http
GET    /api/health                        # Health check
GET    /api/plugins                       # Get plugins
GET    /api/faqs                          # Get FAQs
GET    /api/admin/*                       # Admin endpoints (auth required)
```

## 🤖 Bot Integration Example

```javascript
const API_BASE = 'https://your-backend.onrender.com';

async function syncSessionFiles(sessionId) {
  try {
    // Get list of available files
    const response = await fetch(`${API_BASE}/api/session/${sessionId}/filelist`);
    const { files } = await response.json();
    
    console.log(`Found ${files.length} session files`);
    
    // Download each file
    for (const file of files) {
      const fileResponse = await fetch(`${API_BASE}/api/session/${sessionId}/file/${file.name}`);
      const buffer = await fileResponse.buffer();
      
      // Save to local session directory
      const localPath = `./sessions/${sessionId}/${file.name}`;
      await fs.writeFile(localPath, buffer);
      
      console.log(`✅ Downloaded: ${file.name} (${file.size} bytes)`);
    }
    
    return files.length;
  } catch (error) {
    console.error('❌ Session sync failed:', error);
    throw error;
  }
}

// Usage
await syncSessionFiles('your-session-id');
```

## ⚙️ Environment Variables

### 🔧 **Minimal Setup (Required)**
```bash
NODE_ENV=production                    # Environment mode
FRONTEND_URL=https://your-app.com     # Frontend URL for CORS
```

### ⚙️ **Optional Configuration**
```bash
PORT=8080                             # Server port (auto-detected on most platforms)
TRUST_PROXY=true                      # Enable if behind load balancer
REQUEST_TIMEOUT=30000                 # Request timeout (30s)
MAX_REQUEST_SIZE=10mb                 # Max request body size
RATE_LIMIT_WINDOW=900000             # Rate limit window (15min)
RATE_LIMIT_MAX=100                   # Max requests per window
```

### 🔐 **Admin Features (Optional)**
```bash
GITHUB_CLIENT_ID=your_client_id       # For admin authentication
GITHUB_CLIENT_SECRET=your_secret      # For admin authentication
BACKEND_URL=https://your-backend.com  # For OAuth callbacks
```

## Deployment

### Render.com (Recommended)
1. Create a new Web Service on Render
2. Connect your GitHub repository
3. Set the root directory to `backend` (if deploying from a monorepo)
4. Use these settings:
   - **Build Command**: `npm install`
   - **Start Command**: `npm start`
   - **Environment**: Node
5. Set environment variables:
   - `NODE_ENV=production`
   - `FRONTEND_URL=https://your-frontend-domain.com`
   - `GITHUB_CLIENT_ID=your_client_id` (optional)
   - `GITHUB_CLIENT_SECRET=your_client_secret` (optional)

### Railway
1. Connect your GitHub repository
2. Set root directory to `backend`
3. Railway will auto-detect Node.js and use package.json

### Heroku
```bash
# If deploying from backend folder
git subtree push --prefix=backend heroku main

# Or create a separate repo for backend
```

### Docker
```bash
docker build -t vinsmoke-backend .
docker run -p 5000:5000 -e NODE_ENV=production vinsmoke-backend
```

### Manual/VPS
```bash
# Clone and setup
git clone <your-repo>
cd backend
npm install

# Set environment variables
cp .env.example .env
# Edit .env with your values

# Start with PM2 (recommended for production)
npm install -g pm2
pm2 start server.js --name "vinsmoke-backend"

# Or start directly
npm start
```

### Environment Variables for Production
```bash
NODE_ENV=production
PORT=5000
FRONTEND_URL=https://your-frontend-domain.com
GITHUB_CLIENT_ID=your_github_client_id
GITHUB_CLIENT_SECRET=your_github_client_secret
BACKEND_URL=https://your-backend-domain.com
```

## File Structure
```
sessions/
├── session-id-1/
│   ├── creds.json
│   ├── keys.json
│   └── ...
└── session-id-2/
    ├── creds.json
    ├── keys.json
    └── ...
```