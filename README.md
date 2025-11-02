# My Vinsmoke Backend API Guide

Just my personal reference for all the API calls. No fancy stuff, just what I need to know.

**Backend URL:** `https://vnsmk-back.onrender.com`  
**Admin Token:** Get from GitHub OAuth (frontend handles this)

## Session Management

### Create New Session (QR Code)
```javascript
// POST /api/session/qr
const response = await fetch('https://vnsmk-back.onrender.com/api/session/qr', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' }
});

const data = await response.json();
// Returns: { success: true, sessionId: "VINSMOKE@uuid", qrCode: "data:image/png..." }
```

### Create Session with Phone (Pairing Code)
```javascript
// POST /api/session/pairing
const response = await fetch('https://vnsmk-back.onrender.com/api/session/pairing', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ phoneNumber: '+1234567890' })
});

const data = await response.json();
// Returns: { success: true, sessionId: "VINSMOKE@uuid", pairingCode: "ABCD-EFGH" }
```

### Check Session Status
```javascript
// GET /api/session/:sessionId
const sessionId = 'VINSMOKE@my-session'; // or just 'my-session' (auto-adds prefix)
const response = await fetch(`https://vnsmk-back.onrender.com/api/session/${sessionId}`);
const data = await response.json();
// Returns: { success: true, session: { connected: true, user: {...} } }
```

### Delete Session
```javascript
// DELETE /api/session/:sessionId
const response = await fetch(`https://vnsmk-back.onrender.com/api/session/${sessionId}`, {
  method: 'DELETE'
});
// Returns: { success: true, message: "Session deleted successfully" }
```

## Admin Endpoints (Need GitHub Token)

### Get All Sessions
```javascript
// GET /api/admin/sessions
const response = await fetch('https://vnsmk-back.onrender.com/api/admin/sessions', {
  headers: { 'Authorization': 'Bearer YOUR_GITHUB_TOKEN' }
});

const data = await response.json();
// Returns: { success: true, sessions: [{ sessionId, createdAt, expiresAt, isGood }] }
```

### Delete Session (Admin)
```javascript
// DELETE /api/admin/sessions/:sessionId
const response = await fetch(`https://vnsmk-back.onrender.com/api/admin/sessions/${sessionId}`, {
  method: 'DELETE',
  headers: { 'Authorization': 'Bearer YOUR_GITHUB_TOKEN' }
});
// Returns: { success: true, message: "Session deleted successfully" }
```

## File Downloads

### Download Session Credentials (Admin Panel)
```javascript
// GET /api/admin/sessions/:sessionId/download
// Downloads ONLY creds.json file

const response = await fetch(`https://vnsmk-back.onrender.com/api/admin/sessions/${sessionId}/download`, {
  headers: { 'Authorization': 'Bearer YOUR_GITHUB_TOKEN' }
});

if (response.ok) {
  const blob = await response.blob();
  // Save as 'creds.json'
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'creds.json';
  a.click();
}
```

### Get Session Files List (Bot Integration)
```javascript
// GET /api/session/:sessionId/filelist?manjisama=manjisama
const response = await fetch(`https://vnsmk-back.onrender.com/api/session/${sessionId}/filelist?manjisama=manjisama`);

const data = await response.json();
// Returns: { 
//   success: true, 
//   sessionId: "VINSMOKE@session", 
//   files: [
//     { name: "creds.json", size: 2048, modified: "2024-01-01T00:00:00.000Z" },
//     { name: "keys.json", size: 1024, modified: "2024-01-01T00:00:00.000Z" }
//   ]
// }
```

### Download Individual File (Bot Integration)
```javascript
// GET /api/session/:sessionId/file/:filename?manjisama=manjisama
const filename = 'creds.json'; // or 'keys.json', 'pre-keys.json', etc.
const response = await fetch(`https://vnsmk-back.onrender.com/api/session/${sessionId}/file/${filename}?manjisama=manjisama`);

if (response.ok) {
  const blob = await response.blob();
  // File keeps original name
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename; // Same name as in backend
  a.click();
}
```

## Using Axios (If You Prefer)

### Download with Axios
```javascript
import axios from 'axios';

// Download creds.json
const downloadCreds = async (sessionId, token) => {
  try {
    const response = await axios.get(`https://vnsmk-back.onrender.com/api/admin/sessions/${sessionId}/download`, {
      headers: { 'Authorization': `Bearer ${token}` },
      responseType: 'blob'
    });
    
    const url = URL.createObjectURL(response.data);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'creds.json';
    a.click();
  } catch (error) {
    console.error('Download failed:', error);
  }
};

// Get files list
const getFiles = async (sessionId, token) => {
  try {
    const response = await axios.get(`https://vnsmk-back.onrender.com/api/admin/sessions/${sessionId}/files`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    
    return response.data.files;
  } catch (error) {
    console.error('Get files failed:', error);
  }
};

// Download specific file
const downloadFile = async (sessionId, filename, token) => {
  try {
    const response = await axios.get(`https://vnsmk-back.onrender.com/api/admin/sessions/${sessionId}/files/${filename}`, {
      headers: { 'Authorization': `Bearer ${token}` },
      responseType: 'blob'
    });
    
    const url = URL.createObjectURL(response.data);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
  } catch (error) {
    console.error('Download failed:', error);
  }
};
```

## Public Bot Endpoints (Password Protected!)

### Get Session Files List (Public)
```javascript
// GET /api/session/:sessionId/files?manjisama=manjisama
// REQUIRES PASSWORD PARAMETER! Perfect for deployed bots

const getSessionFiles = async (sessionId) => {
  const response = await fetch(`https://vnsmk-back.onrender.com/api/session/${sessionId}/files?manjisama=manjisama`);
  const data = await response.json();
  
  // Returns: { 
  //   success: true, 
  //   sessionId: "VINSMOKE@session", 
  //   files: [
  //     { 
  //       name: "creds.json", 
  //       size: 2048, 
  //       modified: "2024-01-01T00:00:00.000Z",
  //       downloadUrl: "/api/session/VINSMOKE@session/file/creds.json?manjisama=manjisama"
  //     }
  //   ]
  // }
  
  return data.files;
};
```

### Download Individual File (Public)
```javascript
// GET /api/session/:sessionId/file/:filename?manjisama=manjisama
// REQUIRES PASSWORD PARAMETER!

const downloadFile = async (sessionId, filename) => {
  const response = await fetch(`https://vnsmk-back.onrender.com/api/session/${sessionId}/file/${filename}?manjisama=manjisama`);
  
  if (response.ok) {
    const buffer = await response.arrayBuffer();
    return Buffer.from(buffer);
  }
  throw new Error('Download failed');
};
```

## Bot Integration Examples

### Complete Bot Session Download (No Auth!)
```javascript
const fs = require('fs');
const path = require('path');

const downloadSessionForBot = async (sessionId) => {
  try {
    // 1. Get files list (REQUIRES PASSWORD!)
    const response = await fetch(`https://vnsmk-back.onrender.com/api/session/${sessionId}/files?manjisama=manjisama`);
    const { files } = await response.json();
    
    console.log(`Found ${files.length} files for session ${sessionId}`);
    
    // 2. Create local session directory
    const sessionDir = `./sessions/${sessionId}`;
    if (!fs.existsSync(sessionDir)) {
      fs.mkdirSync(sessionDir, { recursive: true });
    }
    
    // 3. Download each file (REQUIRES PASSWORD!)
    for (const file of files) {
      const fileResponse = await fetch(`https://vnsmk-back.onrender.com/api/session/${sessionId}/file/${file.name}?manjisama=manjisama`);
      
      if (fileResponse.ok) {
        const buffer = await fileResponse.arrayBuffer();
        fs.writeFileSync(path.join(sessionDir, file.name), Buffer.from(buffer));
        console.log(`✅ Downloaded: ${file.name} (${file.size} bytes)`);
      } else {
        console.error(`❌ Failed to download: ${file.name}`);
      }
    }
    
    console.log(`🎉 Session ${sessionId} downloaded successfully!`);
    return files.length;
    
  } catch (error) {
    console.error('❌ Download failed:', error);
    throw error;
  }
};

// Usage in your bot
await downloadSessionForBot('VINSMOKE@my-session');
```

### Axios Version (For Bots)
```javascript
const axios = require('axios');
const fs = require('fs');
const path = require('path');

const downloadWithAxios = async (sessionId) => {
  try {
    // Get files list (with password)
    const { data } = await axios.get(`https://vnsmk-back.onrender.com/api/session/${sessionId}/files?manjisama=manjisama`);
    
    // Download each file (with password)
    for (const file of data.files) {
      const response = await axios.get(`https://vnsmk-back.onrender.com/api/session/${sessionId}/file/${file.name}?manjisama=manjisama`, {
        responseType: 'arraybuffer'
      });
      
      fs.writeFileSync(`./sessions/${sessionId}/${file.name}`, response.data);
      console.log(`Downloaded: ${file.name}`);
    }
  } catch (error) {
    console.error('Download failed:', error);
  }
};
```

### Simple One-File Download
```javascript
// Just download creds.json (with password)
const downloadCreds = async (sessionId) => {
  const response = await fetch(`https://vnsmk-back.onrender.com/api/session/${sessionId}/file/creds.json?manjisama=manjisama`);
  
  if (response.ok) {
    const credsData = await response.text();
    fs.writeFileSync('./creds.json', credsData);
    console.log('✅ creds.json downloaded!');
  }
};
```

## Other Endpoints

### Health Check
```javascript
// GET /api/health
const response = await fetch('https://vnsmk-back.onrender.com/api/health');
// Returns: { status: "healthy", timestamp: "...", uptime: 3600 }
```

### Get Public Data
```javascript
// GET /api/plugins - Get approved plugins
// GET /api/faqs - Get FAQ data  
// GET /api/support - Get support info
```

## For Bot Developers (Public Access!)

### Perfect for Deployed Bots
```javascript
// Your users can deploy your bot anywhere and it will work!
// No tokens, no auth, just session ID

const BACKEND_URL = 'https://vnsmk-back.onrender.com';

class VinsmokeBot {
  async loadSession(sessionId) {
    try {
      // Get all session files (with password)
      const response = await fetch(`${BACKEND_URL}/api/session/${sessionId}/files?manjisama=manjisama`);
      const { files } = await response.json();
      
      // Download each file to local sessions folder (with password)
      for (const file of files) {
        const fileResponse = await fetch(`${BACKEND_URL}/api/session/${sessionId}/file/${file.name}?manjisama=manjisama`);
        const buffer = await fileResponse.arrayBuffer();
        
        // Save to your bot's session directory
        fs.writeFileSync(`./sessions/${sessionId}/${file.name}`, Buffer.from(buffer));
      }
      
      console.log(`Session ${sessionId} loaded successfully!`);
      return true;
    } catch (error) {
      console.error('Failed to load session:', error);
      return false;
    }
  }
}

// Usage
const bot = new VinsmokeBot();
await bot.loadSession('VINSMOKE@user-session');
```

### Environment Variables for Bots
```javascript
// In your bot's .env file
VINSMOKE_BACKEND_URL=https://vnsmk-back.onrender.com
VINSMOKE_SESSION_ID=VINSMOKE@my-session

// In your bot code
const sessionId = process.env.VINSMOKE_SESSION_ID;
const backendUrl = process.env.VINSMOKE_BACKEND_URL;

const loadSession = async () => {
  const response = await fetch(`${backendUrl}/api/session/${sessionId}/files?manjisama=manjisama`);
  // ... rest of download logic
};
```

## Important Notes

- **Session ID Format:** Always `VINSMOKE@sessionId` in storage, but you can use just `sessionId` in API calls
- **File Names:** All downloads keep original filenames from backend
- **Good Sessions:** Sessions that connect successfully are marked as "good" and won't be auto-deleted
- **Public Access:** Bot endpoints (`/api/session/`) require password parameter `?manjisama=manjisama`
- **Admin Access:** Admin endpoints (`/api/admin/`) need GitHub OAuth token
- **Rate Limit:** 100 requests per 15 minutes per IP

## Quick Test Commands

```bash
# Health check
curl https://vnsmk-back.onrender.com/api/health

# Create session
curl -X POST https://vnsmk-back.onrender.com/api/session/qr

# Get session files (need password)
curl "https://vnsmk-back.onrender.com/api/session/VINSMOKE@session-id/files?manjisama=manjisama"

# Download creds.json (need password)
curl "https://vnsmk-back.onrender.com/api/session/VINSMOKE@session-id/file/creds.json?manjisama=manjisama" -o creds.json
```

That's it! Everything I need to know about my backend API.