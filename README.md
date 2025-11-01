# 🚀 Vinsmoke Bot Backend - Personal API Guide

**Your Complete WhatsApp Bot Backend API Reference** - Everything you need to know about your backend.

[![Node.js](https://img.shields.io/badge/Node.js-20.x-green.svg)](https://nodejs.org/)
[![Production](https://img.shields.io/badge/Production-Ready-brightgreen.svg)](https://render.com/)
[![Session Management](https://img.shields.io/badge/Sessions-VINSMOKE%40-blue.svg)](#session-management)

## 🎯 Quick Reference

**Backend URL:** `https://vnsmk-back.onrender.com`  
**Session Prefix:** `VINSMOKE@` (auto-added if missing)  
**Admin Auth:** GitHub OAuth required for admin endpoints  
**Rate Limit:** 100 requests per 15 minutes per IP  

## ✨ Key Features

- 🔐 **GitHub OAuth Authentication** - Secure admin access
- 📱 **WhatsApp Session Management** - Complete Baileys.js integration
- 📁 **File Management** - Individual & ZIP downloads with original names
- 🛡️ **Auto Session Preservation** - Completed sessions protected from cleanup
- ⚡ **High Performance** - Compression, caching, optimized middleware
- 🌐 **CORS Protected** - Only your frontend can access

## 🔌 Complete API Reference

### 📱 WhatsApp Session Management

#### Create New Session
```http
POST /api/session/qr
Content-Type: application/json

{
  "sessionId": "my-session-id"  # Will become VINSMOKE@my-session-id
}

Response:
{
  "success": true,
  "sessionId": "VINSMOKE@my-session-id",
  "qr": "data:image/png;base64,..."
}
```

#### Generate Pairing Code
```http
POST /api/session/pairing
Content-Type: application/json

{
  "sessionId": "my-session-id",
  "phoneNumber": "+1234567890"
}

Response:
{
  "success": true,
  "sessionId": "VINSMOKE@my-session-id", 
  "pairingCode": "ABCD-EFGH"
}
```

#### Get Session Status
```http
GET /api/session/VINSMOKE@my-session-id

Response:
{
  "success": true,
  "sessionId": "VINSMOKE@my-session-id",
  "connected": true,
  "user": {
    "id": "1234567890@s.whatsapp.net",
    "name": "Your Name"
  }
}
```

#### Delete Session
```http
DELETE /api/session/VINSMOKE@my-session-id

Response:
{
  "success": true,
  "message": "Session deleted successfully"
}
```

### 🔐 Admin Session Management (Requires GitHub OAuth)

#### Get All Sessions
```http
GET /api/admin/sessions
Authorization: Bearer <github-oauth-token>

Response:
{
  "success": true,
  "sessions": [
    {
      "sessionId": "VINSMOKE@session-1",
      "createdAt": "2024-01-15T10:30:00.000Z",
      "expiresAt": "2024-01-22T10:30:00.000Z",
      "connected": true,
      "completed": true
    }
  ]
}
```

#### Delete Session (Admin)
```http
DELETE /api/admin/sessions/VINSMOKE@my-session-id
Authorization: Bearer <github-oauth-token>

Response:
{
  "success": true,
  "message": "Session deleted successfully"
}
```

### 📁 Session File Management

#### Get Session Files List
```http
GET /api/admin/sessions/my-session-id/files
Authorization: Bearer <github-oauth-token>

# Note: VINSMOKE@ prefix auto-added if missing

Response:
{
  "success": true,
  "sessionId": "VINSMOKE@my-session-id",
  "files": [
    {
      "name": "creds.json",
      "size": 2048,
      "modified": "2024-01-15T10:30:00.000Z",
      "type": ".json"
    },
    {
      "name": "keys.json",
      "size": 1024, 
      "modified": "2024-01-15T10:30:00.000Z",
      "type": ".json"
    },
    {
      "name": "pre-keys.json",
      "size": 512,
      "modified": "2024-01-15T10:30:00.000Z", 
      "type": ".json"
    }
  ]
}
```

#### Download Individual File
```http
GET /api/admin/sessions/my-session-id/files/creds.json
Authorization: Bearer <github-oauth-token>

# Downloads file with original name: creds.json
# Content-Type: application/json (for .json files)
# Content-Disposition: attachment; filename="creds.json"
```

#### Download All Session Files (ZIP)
```http
GET /api/admin/sessions/my-session-id/download
Authorization: Bearer <github-oauth-token>

# Downloads ZIP file: my-session-id-session.zip
# Contains all session files with original names
# Content-Type: application/zip
# Content-Disposition: attachment; filename="my-session-id-session.zip"
```

#### Download All Sessions Metadata
```http
GET /api/admin/sessions/download
Authorization: Bearer <github-oauth-token>

# Downloads JSON file with all session metadata
# Content-Type: application/json
# Content-Disposition: attachment; filename="sessions-YYYY-MM-DD.json"
```

### 🔧 System & Health

#### Health Check
```http
GET /api/health

Response:
{
  "status": "healthy",
  "timestamp": "2024-01-15T10:30:00.000Z",
  "uptime": 3600,
  "version": "1.0.0"
}
```

#### Get Public Data
```http
GET /api/plugins        # Get approved plugins
GET /api/faqs          # Get FAQ data
GET /api/support       # Get support info
```

## 🎯 Session Management Deep Dive

### 📋 Session ID Format
- **Input:** `my-session-id` or `VINSMOKE@my-session-id`
- **Storage:** Always `VINSMOKE@my-session-id` 
- **Auto-Prefix:** Backend adds `VINSMOKE@` if missing
- **File Path:** `./sessions/VINSMOKE@my-session-id/`

### 📁 Session File Structure
```
sessions/
└── VINSMOKE@my-session-id/
    ├── creds.json          # WhatsApp credentials
    ├── keys.json           # Encryption keys  
    ├── pre-keys.json       # Pre-keys for encryption
    ├── sender-keys.json    # Sender keys
    └── app-state-sync-*.json # App state files
```

### 🔒 Session Lifecycle & Protection

#### 1. Session Creation
```javascript
// Creates session with VINSMOKE@ prefix
POST /api/session/qr { "sessionId": "my-bot" }
// Result: VINSMOKE@my-bot stored in ./sessions/VINSMOKE@my-bot/
```

#### 2. Session Completion
```javascript
// When WhatsApp connection succeeds:
✅ Session VINSMOKE@my-bot completed successfully
// Session marked as completed = true
// Protected from auto-cleanup
```

#### 3. Session Preservation
- ✅ **Completed sessions** are preserved indefinitely
- ✅ **Downloaded sessions** remain available
- ❌ **Abandoned sessions** (no client connection) deleted after 30s
- ❌ **Failed sessions** cleaned up automatically

### 🔐 Authentication Guide

#### GitHub OAuth Setup
1. **Create OAuth App:** https://github.com/settings/developers
2. **Set Callback URL:** `https://your-backend.com/auth/callback`
3. **Get Token:** Use frontend login or direct OAuth flow

#### Admin Token Usage
```javascript
const headers = {
  'Authorization': 'Bearer <github-oauth-token>',
  'Content-Type': 'application/json'
};

// All /api/admin/* endpoints require this header
```

### 📥 File Download Strategies

#### Strategy 1: Individual Files
```javascript
// Get file list first
const files = await fetch('/api/admin/sessions/my-bot/files', { headers });

// Download specific files
for (const file of files) {
  const response = await fetch(`/api/admin/sessions/my-bot/files/${file.name}`, { headers });
  const blob = await response.blob();
  // Save with original filename: file.name
}
```

#### Strategy 2: Complete ZIP Download
```javascript
// Download everything at once
const response = await fetch('/api/admin/sessions/my-bot/download', { headers });
const blob = await response.blob();
// Filename: my-bot-session.zip
// Contains all files with original names
```

#### Strategy 3: Bulk Session Export
```javascript
// Download all session metadata
const response = await fetch('/api/admin/sessions/download', { headers });
const sessions = await response.json();
// Contains all session info for backup/analysis
```

## 🛠️ Practical Examples & Code

### 🚀 Quick Start: Create & Download Session

```javascript
const API_BASE = 'https://vnsmk-back.onrender.com';
const AUTH_TOKEN = 'your-github-oauth-token';

// 1. Create new WhatsApp session
async function createSession(sessionId) {
  const response = await fetch(`${API_BASE}/api/session/qr`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sessionId })
  });
  
  const data = await response.json();
  console.log(`✅ Session created: ${data.sessionId}`);
  console.log(`📱 QR Code: ${data.qr}`);
  return data;
}

// 2. Check session status
async function checkSession(sessionId) {
  const response = await fetch(`${API_BASE}/api/session/${sessionId}`);
  const data = await response.json();
  
  if (data.connected) {
    console.log(`✅ ${sessionId} is connected as ${data.user.name}`);
  } else {
    console.log(`❌ ${sessionId} is not connected`);
  }
  return data;
}

// 3. Download session files (after completion)
async function downloadSession(sessionId) {
  const response = await fetch(`${API_BASE}/api/admin/sessions/${sessionId}/download`, {
    headers: { 'Authorization': `Bearer ${AUTH_TOKEN}` }
  });
  
  if (response.ok) {
    const blob = await response.blob();
    // Save as: sessionId-session.zip
    console.log(`✅ Downloaded ${sessionId} (${blob.size} bytes)`);
    return blob;
  } else {
    console.error(`❌ Download failed: ${response.status}`);
  }
}

// Usage
await createSession('my-bot');
// ... scan QR code ...
await checkSession('my-bot');
await downloadSession('my-bot');
```

### 📁 Advanced File Management

```javascript
// Get detailed file information
async function analyzeSession(sessionId) {
  const response = await fetch(`${API_BASE}/api/admin/sessions/${sessionId}/files`, {
    headers: { 'Authorization': `Bearer ${AUTH_TOKEN}` }
  });
  
  const data = await response.json();
  console.log(`📊 Session Analysis: ${data.sessionId}`);
  
  let totalSize = 0;
  data.files.forEach(file => {
    console.log(`📄 ${file.name}: ${file.size} bytes (${file.type})`);
    totalSize += file.size;
  });
  
  console.log(`💾 Total size: ${totalSize} bytes`);
  return data.files;
}

// Download specific files only
async function downloadCredentials(sessionId) {
  const files = ['creds.json', 'keys.json'];
  
  for (const filename of files) {
    const response = await fetch(`${API_BASE}/api/admin/sessions/${sessionId}/files/${filename}`, {
      headers: { 'Authorization': `Bearer ${AUTH_TOKEN}` }
    });
    
    if (response.ok) {
      const buffer = await response.arrayBuffer();
      console.log(`✅ Downloaded ${filename} (${buffer.byteLength} bytes)`);
      // File keeps original name: filename
    } else {
      console.error(`❌ Failed to download ${filename}: ${response.status}`);
    }
  }
}
```

### 🔄 Session Backup & Restore

```javascript
// Backup all sessions
async function backupAllSessions() {
  // 1. Get session list
  const sessionsResponse = await fetch(`${API_BASE}/api/admin/sessions`, {
    headers: { 'Authorization': `Bearer ${AUTH_TOKEN}` }
  });
  const { sessions } = await sessionsResponse.json();
  
  // 2. Download each session
  for (const session of sessions) {
    if (session.completed) {
      console.log(`💾 Backing up ${session.sessionId}...`);
      await downloadSession(session.sessionId);
    }
  }
  
  console.log(`✅ Backed up ${sessions.length} sessions`);
}

// Restore session files (upload to new backend)
async function restoreSession(sessionId, zipFile) {
  // This would require a restore endpoint (not implemented yet)
  // For now, manually extract ZIP and place in sessions folder
  console.log(`📤 To restore ${sessionId}:`);
  console.log(`1. Extract ${sessionId}-session.zip`);
  console.log(`2. Place files in ./sessions/VINSMOKE@${sessionId}/`);
  console.log(`3. Restart backend to detect session`);
}
```

### 🐛 Troubleshooting & Debugging

```javascript
// Debug session issues
async function debugSession(sessionId) {
  console.log(`🔍 Debugging session: ${sessionId}`);
  
  // 1. Check if session exists
  try {
    const statusResponse = await fetch(`${API_BASE}/api/session/${sessionId}`);
    const status = await statusResponse.json();
    console.log(`📊 Status:`, status);
  } catch (error) {
    console.error(`❌ Session not found: ${error.message}`);
    return;
  }
  
  // 2. Check files
  try {
    const filesResponse = await fetch(`${API_BASE}/api/admin/sessions/${sessionId}/files`, {
      headers: { 'Authorization': `Bearer ${AUTH_TOKEN}` }
    });
    
    if (filesResponse.ok) {
      const { files } = await filesResponse.json();
      console.log(`📁 Files (${files.length}):`, files.map(f => f.name));
    } else {
      console.error(`❌ Cannot access files: ${filesResponse.status}`);
    }
  } catch (error) {
    console.error(`❌ File access error: ${error.message}`);
  }
  
  // 3. Test download
  try {
    const downloadResponse = await fetch(`${API_BASE}/api/admin/sessions/${sessionId}/download`, {
      headers: { 'Authorization': `Bearer ${AUTH_TOKEN}` }
    });
    
    if (downloadResponse.ok) {
      console.log(`✅ Download available (${downloadResponse.headers.get('content-length')} bytes)`);
    } else {
      console.error(`❌ Download failed: ${downloadResponse.status}`);
    }
  } catch (error) {
    console.error(`❌ Download error: ${error.message}`);
  }
}

// Check backend health
async function checkBackendHealth() {
  try {
    const response = await fetch(`${API_BASE}/api/health`);
    const health = await response.json();
    console.log(`💚 Backend healthy:`, health);
    return true;
  } catch (error) {
    console.error(`❌ Backend unhealthy:`, error.message);
    return false;
  }
}
```

## ⚠️ Common Issues & Solutions

### 🚫 "Session not found" Error
```javascript
// Problem: Session ID format mismatch
❌ GET /api/admin/sessions/my-session/files
✅ GET /api/admin/sessions/VINSMOKE@my-session/files
// OR (auto-prefix)
✅ GET /api/admin/sessions/my-session/files  # Backend adds VINSMOKE@
```

### 🔐 "Authentication expired" Error
```javascript
// Problem: GitHub OAuth token expired
// Solution: Re-login through frontend or refresh token
const newToken = await refreshGitHubToken();
```

### 📁 "File not found" Error
```javascript
// Problem: Session not completed or files cleaned up
// Check session status first:
const status = await fetch('/api/session/my-session');
if (!status.completed) {
  console.log('Session not completed yet');
}
```

### 🗑️ "Session gets deleted after download"
```javascript
// This is FIXED! Completed sessions are now preserved
// Sessions only get deleted if:
// 1. Manually deleted via DELETE endpoint
// 2. Never completed successfully
// 3. Abandoned (no client connection) for 30+ seconds
```

### 🌐 CORS Errors
```javascript
// Problem: Frontend URL not whitelisted
// Solution: Check FRONTEND_URL environment variable
FRONTEND_URL=https://your-exact-frontend-domain.com
```

## ⚙️ Environment Variables

### 🎯 **Production Deployment**
```bash
# Required
FRONTEND_URL=https://vinsmoke-six.vercel.app
GITHUB_CLIENT_ID=your_github_client_id
GITHUB_CLIENT_SECRET=your_github_client_secret

# Optional (has defaults)
PORT=5000
NODE_ENV=production
BACKEND_URL=https://vnsmk-back.onrender.com
```

### 🔧 **Development Setup**
```bash
# Copy example file
cp .env.example .env

# Edit with your values
FRONTEND_URL=http://localhost:3000
GITHUB_CLIENT_ID=your_dev_client_id
GITHUB_CLIENT_SECRET=your_dev_client_secret
PORT=5000
```

## 🚀 Deployment Options

### 🆓 **Free Tier Platforms**

#### Render.com (Easy Setup)
- **Free Plan**: Sleeps after 15min inactivity
- **Paid Plan**: $7/month, always on
- Uses included `render.yaml` configuration

#### Railway (Better Performance)
- **Free**: $5/month credit (usually enough)
- **No sleep time**, better than Render free
- Excellent for development and small apps

#### Vercel (Serverless)
- **Generous free tier** with global CDN
- Uses included `vercel.json` configuration
- Best for API-only deployments

### 🚀 **Quick Deploy Steps**

#### 1. Setup GitHub OAuth App
1. Go to GitHub → Settings → Developer settings → OAuth Apps
2. Click "New OAuth App"
3. Fill in:
   - **Application name**: `Vinsmoke Bot Admin`
   - **Homepage URL**: `https://your-frontend.vercel.app`
   - **Authorization callback URL**: `https://your-backend.onrender.com/auth/callback`
4. Save and copy the Client ID and Client Secret

#### 2. Deploy to Render
1. **Fork/Clone**: https://github.com/manjisama1/vnsmk-back
2. **Connect to Render**: Import your GitHub repo
3. **Set Environment Variables**:
   ```bash
   FRONTEND_URL=https://your-frontend.vercel.app
   BACKEND_URL=https://your-backend.onrender.com
   GITHUB_CLIENT_ID=your_client_id_from_step_1
   GITHUB_CLIENT_SECRET=your_client_secret_from_step_1
   ```
4. **Deploy**: Render handles the rest automatically

### ⚙️ **Manual Configuration**
If not using config files, set these build settings:
- **Build Command**: `npm ci --only=production`
- **Start Command**: `node server.js`
- **Node Version**: 20.x

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

## 📊 Monitoring & Maintenance

### 🔍 Backend Logs (Render Dashboard)
```bash
# Key log messages to watch for:
✅ Session VINSMOKE@xxx completed successfully    # Good!
🔒 Preserving completed session: VINSMOKE@xxx    # Protected from cleanup
🗑️ Cleaning up abandoned session: VINSMOKE@xxx   # Expected for failed sessions
❌ Connection closed for session: VINSMOKE@xxx   # Normal disconnect
🧹 No clients left for session VINSMOKE@xxx     # Cleanup scheduled
```

### 📈 Performance Monitoring
```javascript
// Check backend performance
async function monitorBackend() {
  const health = await fetch('/api/health');
  const data = await health.json();
  
  console.log(`⏱️ Uptime: ${data.uptime}s`);
  console.log(`💾 Memory: ${process.memoryUsage().heapUsed / 1024 / 1024}MB`);
  console.log(`📊 Status: ${data.status}`);
}
```

### 🧹 Cleanup Schedules
- **Expired sessions:** Every 1 hour
- **Bad sessions:** Every 30 minutes  
- **Unscanned sessions:** Every 5 minutes
- **Abandoned sessions:** 30 seconds after disconnect
- **Completed sessions:** ✅ **NEVER DELETED**

### 🔄 Session Lifecycle
```
1. Create Session → VINSMOKE@xxx created
2. Generate QR → QR code displayed
3. Scan QR → WhatsApp connects
4. Complete → Session marked as completed=true
5. Disconnect → Session preserved (not deleted)
6. Download → Files available indefinitely
7. Manual Delete → Only way to remove completed sessions
```

## 📁 File Structure Reference
```
vinsmoke-backend/
├── sessions/                          # Session storage
│   ├── VINSMOKE@session-1/
│   │   ├── creds.json                # WhatsApp credentials
│   │   ├── keys.json                 # Encryption keys
│   │   ├── pre-keys.json            # Pre-keys
│   │   └── app-state-sync-*.json    # App state
│   └── VINSMOKE@session-2/
│       └── ...
├── data/
│   ├── session-tracking.json        # Session metadata
│   ├── faqs.json                   # FAQ data
│   └── plugins.json                # Plugin data
├── services/
│   ├── whatsappService.js          # Core WhatsApp logic
│   ├── pluginService.js            # Plugin management
│   └── faqService.js               # FAQ management
└── server.js                       # Main server file
```

## 🎯 Quick Commands Cheat Sheet

```bash
# Health check
curl https://vnsmk-back.onrender.com/api/health

# Create session
curl -X POST https://vnsmk-back.onrender.com/api/session/qr \
  -H "Content-Type: application/json" \
  -d '{"sessionId":"test"}'

# Get session files (requires auth)
curl https://vnsmk-back.onrender.com/api/admin/sessions/test/files \
  -H "Authorization: Bearer YOUR_TOKEN"

# Download session ZIP (requires auth)  
curl https://vnsmk-back.onrender.com/api/admin/sessions/test/download \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -o test-session.zip
```

---

**🎉 Your backend is ready!** All session files are preserved after completion and available for download anytime. The VINSMOKE@ prefix is handled automatically, and completed sessions are protected from cleanup.