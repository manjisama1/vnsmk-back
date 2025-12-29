import express from 'express';
import cors from 'cors';
import http from 'http';
import { Server as SocketIOServer } from 'socket.io';
import fs from 'fs-extra';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { config } from 'dotenv';
import { fileURLToPath } from 'url';

// ES module compatibility
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load environment variables FIRST before any other imports
config();

import WhatsAppService from './services/whatsappService.js';
import PluginService from './services/pluginService.js';
import FAQService from './services/faqService.js';
import { isAdmin } from './config/admin.js';

// Clean logging system with colors and timestamps
const getTimestamp = () => new Date().toTimeString().split(' ')[0] + '.' + new Date().getMilliseconds().toString().padStart(3, '0');

const log = {
    info: (msg, data = '') => console.log(`\x1b[90m${getTimestamp()}\x1b[0m \x1b[36m[INFO]\x1b[0m ${msg}${data ? ` \x1b[90m${data}\x1b[0m` : ''}`),
    success: (msg, data = '') => console.log(`\x1b[90m${getTimestamp()}\x1b[0m \x1b[32m[SUCCESS]\x1b[0m ${msg}${data ? ` \x1b[90m${data}\x1b[0m` : ''}`),
    warn: (msg, data = '') => console.log(`\x1b[90m${getTimestamp()}\x1b[0m \x1b[33m[WARN]\x1b[0m ${msg}${data ? ` \x1b[90m${data}\x1b[0m` : ''}`),
    error: (msg, data = '') => console.log(`\x1b[90m${getTimestamp()}\x1b[0m \x1b[31m[ERROR]\x1b[0m ${msg}${data ? ` \x1b[90m${data}\x1b[0m` : ''}`),
    debug: (msg, data = '') => console.log(`\x1b[90m${getTimestamp()}\x1b[0m \x1b[35m[DEBUG]\x1b[0m ${msg}${data ? ` \x1b[90m${data}\x1b[0m` : ''}`)
};

const app = express();

// Trust proxy for production deployments (always enabled for cloud platforms)
app.set('trust proxy', 1);

// Security middleware
import helmet from 'helmet';
import compression from 'compression';
import rateLimit from 'express-rate-limit';

// Apply security headers
app.use(helmet({
  contentSecurityPolicy: false, // Disable CSP for API-only service
  crossOriginEmbedderPolicy: false
}));

// Compress responses
app.use(compression());

// Rate limiting (configurable via environment)
const limiter = rateLimit({
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW) || 15 * 60 * 1000, // 15 minutes
  max: parseInt(process.env.RATE_LIMIT_MAX) || 100, // 100 requests per window
  message: {
    error: 'Too many requests from this IP, please try again later.',
    retryAfter: Math.ceil((parseInt(process.env.RATE_LIMIT_WINDOW) || 15 * 60 * 1000) / 60000) + ' minutes'
  },
  standardHeaders: true,
  legacyHeaders: false,
});

app.use('/api/', limiter);

const server = http.createServer(app);
const io = new SocketIOServer(server, {
  cors: {
    origin: function (origin, callback) {
      // Use the same CORS logic as Express
      corsOptions.origin(origin, callback);
    },
    methods: ["GET", "POST"],
    credentials: true
  },
  transports: ['websocket', 'polling']
});

// CORS configuration
const corsOptions = {
  origin: function (origin, callback) {
    // Always allow requests with no origin (mobile apps, curl, etc.)
    if (!origin) return callback(null, true);

    // Development origins (always allowed in development)
    const devOrigins = [
      'http://localhost:3000',
      'http://localhost:3001',
      'http://127.0.0.1:3000',
      'http://127.0.0.1:3001'
    ];

    // Production origins from environment variables (PRIORITY)
    const envOrigins = [];

    // Primary frontend URL (handle both with and without trailing slash)
    if (process.env.FRONTEND_URL) {
      const frontendUrl = process.env.FRONTEND_URL;
      envOrigins.push(frontendUrl);

      // Also add the variant (with/without trailing slash)
      if (frontendUrl.endsWith('/')) {
        envOrigins.push(frontendUrl.slice(0, -1)); // Remove trailing slash
      } else {
        envOrigins.push(frontendUrl + '/'); // Add trailing slash
      }
    }

    // Additional allowed origins (comma-separated, handle trailing slashes)
    if (process.env.ALLOWED_ORIGINS) {
      const additionalOrigins = process.env.ALLOWED_ORIGINS.split(',').map(url => url.trim()).filter(Boolean);

      // Add both variants (with and without trailing slash) for each origin
      additionalOrigins.forEach(origin => {
        envOrigins.push(origin);
        if (origin.endsWith('/')) {
          envOrigins.push(origin.slice(0, -1)); // Remove trailing slash
        } else {
          envOrigins.push(origin + '/'); // Add trailing slash
        }
      });
    }

    // Combine all explicitly allowed origins
    const explicitOrigins = process.env.NODE_ENV === 'production'
      ? [...envOrigins] // Production: Only use environment variables
      : [...devOrigins, ...envOrigins]; // Development: Include localhost + env vars

    // Check explicit origins first (highest priority)
    if (explicitOrigins.includes(origin)) {
      return callback(null, true);
    }

    // Production: Only allow explicitly configured origins (no platform fallbacks)
    // This ensures ONLY your frontend can access the API
    if (process.env.NODE_ENV === 'production' && envOrigins.length === 0) {
      log.warn(`CORS: No FRONTEND_URL configured in production!`);
      log.info(`Set FRONTEND_URL environment variable for security`);
    }

    // Development fallback: Allow common platforms only in development
    if (process.env.NODE_ENV !== 'production' && envOrigins.length === 0) {
      const isDeploymentPlatform =
        origin.endsWith('.vercel.app') ||
        origin.endsWith('.netlify.app') ||
        origin.endsWith('.github.io');

      if (isDeploymentPlatform) {
        return callback(null, true);
      }
    }

    // Block all other origins
    callback(new Error('Not allowed by CORS'));
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
  exposedHeaders: ['X-Total-Count'],
  maxAge: 86400 // 24 hours
};

app.use(cors(corsOptions));
// Body parsing middleware (smart defaults)
app.use(express.json({
  limit: '10mb',
  strict: true
}));
app.use(express.urlencoded({
  extended: true,
  limit: '10mb'
}));

// Request timeout (30 seconds)
app.use((req, res, next) => {
  req.setTimeout(30000);
  next();
});

// Services
const whatsappService = new WhatsAppService(io);
const pluginService = new PluginService();
const faqService = new FAQService();

// Initialize all services
async function initializeServices() {
  log.info('Initializing...');
  await Promise.all([
    whatsappService.initPromise,
    pluginService.initPromise,
    faqService.initPromise
  ]);
  log.success('Services ready');
}

// Initialize services (don't wait, let them initialize in background)
initializeServices().catch(error => {
  log.error('Init failed:', error.message);
});

// GitHub OAuth Routes
app.get('/auth/github', (req, res) => {
  const clientId = process.env.GITHUB_CLIENT_ID;
  // Use configured backend URL or auto-detect
  const backendUrl = process.env.BACKEND_URL || `${req.protocol}://${req.get('host')}`;
  const redirectUri = encodeURIComponent(`${backendUrl}/auth/callback`);
  const scope = encodeURIComponent('read:user user:email');
  const state = req.query.state; // Get state parameter from frontend

  if (!clientId) {
    return res.status(500).json({ error: 'GitHub Client ID not configured' });
  }

  let githubAuthUrl = `https://github.com/login/oauth/authorize?client_id=${clientId}&redirect_uri=${redirectUri}&scope=${scope}`;

  // Add state parameter if provided
  if (state) {
    githubAuthUrl += `&state=${encodeURIComponent(state)}`;
  }

  res.redirect(githubAuthUrl);
});

app.get('/auth/callback', async (req, res) => {
  const { code, state } = req.query;

  if (!code) {
    return res.redirect(`${process.env.FRONTEND_URL || 'http://localhost:3000'}?error=access_denied`);
  }

  try {
    // Exchange code for access token with 10 second timeout
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000);

    const tokenResponse = await fetch('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        client_id: process.env.GITHUB_CLIENT_ID,
        client_secret: process.env.GITHUB_CLIENT_SECRET,
        code: code,
      }),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);
    const tokenData = await tokenResponse.json();

    if (tokenData.access_token) {
      // Get user data from GitHub with timeout
      const userController = new AbortController();
      const userTimeoutId = setTimeout(() => userController.abort(), 10000);

      const userResponse = await fetch('https://api.github.com/user', {
        headers: {
          'Authorization': `Bearer ${tokenData.access_token}`,
          'Accept': 'application/vnd.github.v3+json',
        },
        signal: userController.signal,
      });

      clearTimeout(userTimeoutId);
      const userData = await userResponse.json();

      // Store user data in token
      const userDataToStore = {
        id: userData.id,
        login: userData.login,
        name: userData.name || userData.login,
        avatar_url: userData.avatar_url,
        html_url: userData.html_url,
        email: userData.email
      };

      const userToken = Buffer.from(JSON.stringify(userDataToStore)).toString('base64');

      // Redirect back to frontend with user token and state
      let redirectUrl = `${process.env.FRONTEND_URL || 'http://localhost:3000'}?token=${userToken}`;
      if (state) {
        redirectUrl += `&state=${encodeURIComponent(state)}`;
      }
      res.redirect(redirectUrl);
    } else {
      res.redirect(`${process.env.FRONTEND_URL || 'http://localhost:3000'}?error=token_error`);
    }
  } catch (error) {
    console.error('GitHub OAuth Error:', error);
    // No fallback users in production - redirect with error
    res.redirect(`${process.env.FRONTEND_URL || 'http://localhost:3000'}?error=github_api_error`);
  }
});

// Routes
app.get('/api/health', (req, res) => {
  res.json({ status: 'OK', message: 'Vinsmoke Bot Backend is running' });
});

// Session Management Routes
app.post('/api/session/qr', async (req, res) => {
  try {
    const sessionId = uuidv4();
    const result = await whatsappService.generateQR(sessionId);
    const fullSessionId = `VINSMOKE@${sessionId}`;

    log.success(`QR: ${fullSessionId}`);

    res.json({
      success: true,
      sessionId: fullSessionId,
      qrCode: result.qrCode
    });
  } catch (error) {
    log.error('QR error:', error.message);
    res.status(500).json({
      success: false,
      error: 'Failed to generate QR code'
    });
  }
});

app.post('/api/session/pairing', async (req, res) => {
  try {
    const { phoneNumber } = req.body;
    log.info(`Pairing: ${phoneNumber}`);

    if (!phoneNumber) {
      return res.status(400).json({
        success: false,
        error: 'Phone number is required'
      });
    }

    const sessionId = uuidv4();
    const fullSessionId = `VINSMOKE@${sessionId}`;

    const result = await whatsappService.generatePairingCode(sessionId, phoneNumber);
    log.success(`Pairing: ${fullSessionId}`);

    res.json({
      success: true,
      sessionId: fullSessionId,
      pairingCode: result.pairingCode,
      environment: process.env.NODE_ENV || 'development'
    });
  } catch (error) {
    log.error('Pairing error:', error.message);

    if (error.message === 'MAINTENANCE_MODE' || error.isMaintenanceMode) {
      res.status(503).json({
        success: false,
        error: 'MAINTENANCE_MODE',
        message: 'Pairing code is under maintenance. Please use QR code for now.'
      });
    } else {
      res.status(500).json({
        success: false,
        error: 'Failed to generate pairing code',
        details: process.env.NODE_ENV === 'development' ? error.message : undefined
      });
    }
  }
});

app.get('/api/session/:sessionId', async (req, res) => {
  try {
    const { sessionId } = req.params;
    const sessionData = await whatsappService.getSession(sessionId);

    if (!sessionData) {
      return res.status(404).json({
        success: false,
        error: 'Session not found'
      });
    }

    res.json({
      success: true,
      session: sessionData
    });
  } catch (error) {
    console.error('Get Session Error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get session data'
    });
  }
});

app.delete('/api/session/:sessionId', async (req, res) => {
  try {
    const { sessionId } = req.params;
    await whatsappService.deleteSession(sessionId);

    res.json({
      success: true,
      message: 'Session deleted successfully'
    });
  } catch (error) {
    console.error('Delete Session Error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to delete session'
    });
  }
});

// Old endpoint removed - using new public bot endpoint below

// Get individual session file
app.get('/api/session/:sessionId/file/:fileName', async (req, res) => {
  try {
    const { sessionId, fileName } = req.params;
    const { manjisama } = req.query;

    // Check password parameter
    if (manjisama !== 'manjisama') {
      return res.status(401).json({
        success: false,
        error: 'Unauthorized access'
      });
    }

    const fileData = await whatsappService.getSessionFile(sessionId, fileName);

    if (!fileData) {
      return res.status(404).json({
        success: false,
        error: 'File not found'
      });
    }

    // Set appropriate headers
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);

    // Send the raw file buffer
    res.send(fileData.buffer);
  } catch (error) {
    console.error('Get Session File Error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get session file'
    });
  }
});

// Get session file list (just filenames and metadata)
app.get('/api/session/:sessionId/filelist', async (req, res) => {
  try {
    const { sessionId } = req.params;
    const { manjisama } = req.query;

    // Check password parameter
    if (manjisama !== 'manjisama') {
      return res.status(401).json({
        success: false,
        error: 'Unauthorized access'
      });
    }

    const fileList = await whatsappService.getSessionFileList(sessionId);

    if (!fileList) {
      return res.status(404).json({
        success: false,
        error: 'Session not found'
      });
    }

    res.json({
      success: true,
      sessionId: sessionId,
      files: fileList
    });
  } catch (error) {
    console.error('Get Session File List Error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get session file list'
    });
  }
});

// Get all session files with content in one call
app.get('/api/session/:sessionId/all-files', async (req, res) => {
  try {
    const { sessionId } = req.params;
    const { manjisama } = req.query;

    // Check password parameter
    if (manjisama !== 'manjisama') {
      return res.status(401).json({
        success: false,
        error: 'Unauthorized access'
      });
    }

    const allFiles = await whatsappService.getAllSessionFiles(sessionId);

    if (!allFiles) {
      return res.status(404).json({
        success: false,
        error: 'Session not found'
      });
    }

    res.json({
      success: true,
      ...allFiles
    });
  } catch (error) {
    console.error('Get All Session Files Error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get all session files'
    });
  }
});

// Download all session files as ZIP
app.get('/api/session/:sessionId/download-all', async (req, res) => {
  try {
    const { sessionId } = req.params;
    const zipData = await whatsappService.downloadAllSessionFiles(sessionId);

    if (!zipData) {
      return res.status(404).json({
        success: false,
        error: 'Session not found'
      });
    }

    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${sessionId}-session-files.zip"`);

    zipData.archive.pipe(res);
    zipData.archive.finalize();
  } catch (error) {
    console.error('Download All Session Files Error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to download session files'
    });
  }
});

// Admin verification middleware
const verifyAdmin = (req, res, next) => {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({
      success: false,
      error: 'Admin authentication required'
    });
  }

  try {
    // Extract and decode the user token
    const token = authHeader.substring(7); // Remove 'Bearer ' prefix
    const userData = JSON.parse(Buffer.from(token, 'base64').toString());

    // Check if user is admin
    if (!isAdmin(userData)) {
      return res.status(403).json({
        success: false,
        error: 'Admin privileges required'
      });
    }

    req.adminUser = userData;
    next();
  } catch (error) {
    return res.status(401).json({
      success: false,
      error: 'Invalid admin token'
    });
  }
};

// Admin Routes
app.get('/api/admin/stats', verifyAdmin, async (req, res) => {
  try {
    const sessions = await whatsappService.getAllSessions();
    const plugins = await pluginService.getPlugins({});

    const stats = {
      totalSessions: sessions.length,
      totalPlugins: plugins.length,
      pendingPlugins: plugins.filter(p => p.status === 'pending').length,
      totalFAQs: (await faqService.getAllFAQs()).length
    };

    res.json(stats);
  } catch (error) {
    console.error('Admin Stats Error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get admin stats'
    });
  }
});

app.get('/api/admin/sessions', verifyAdmin, async (req, res) => {
  try {
    const sessions = await whatsappService.getAllSessions();
    res.json({
      success: true,
      sessions
    });
  } catch (error) {
    console.error('Admin Sessions Error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get sessions'
    });
  }
});

app.delete('/api/admin/sessions/:sessionId', verifyAdmin, async (req, res) => {
  try {
    let { sessionId } = req.params;

    // Handle VINSMOKE@ prefix - if not present, add it
    if (!sessionId.startsWith('VINSMOKE@')) {
      sessionId = `VINSMOKE@${sessionId}`;
    }

    await whatsappService.deleteSession(sessionId);
    res.json({
      success: true,
      message: 'Session deleted successfully'
    });
  } catch (error) {
    console.error('Admin Delete Session Error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to delete session'
    });
  }
});

app.get('/api/admin/sessions/download', verifyAdmin, async (req, res) => {
  try {
    const sessions = await whatsappService.getAllSessions();
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', 'attachment; filename=sessions.json');
    res.json(sessions);
  } catch (error) {
    console.error('Admin Download Sessions Error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to download sessions'
    });
  }
});

// Download session creds.json (Admin Panel)
app.get('/api/admin/sessions/:sessionId/download', verifyAdmin, async (req, res) => {
  try {
    let { sessionId } = req.params;

    // Handle VINSMOKE@ prefix - if not present, add it
    if (!sessionId.startsWith('VINSMOKE@')) {
      sessionId = `VINSMOKE@${sessionId}`;
    }

    const sessionPath = path.join(__dirname, 'sessions', sessionId);
    const credsPath = path.join(sessionPath, 'creds.json');

    if (!fs.existsSync(credsPath)) {
      return res.status(404).json({
        success: false,
        error: 'Session credentials not found'
      });
    }

    const stats = await fs.stat(credsPath);

    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', 'attachment; filename="creds.json"');
    res.setHeader('Content-Length', stats.size);

    // Stream the file to avoid loading into memory
    const fileStream = fs.createReadStream(credsPath);
    fileStream.pipe(res);

  } catch (error) {
    console.error('Admin Download Session Creds Error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to download session credentials'
    });
  }
});

// Get session files list (for bot integration)
app.get('/api/admin/sessions/:sessionId/files', verifyAdmin, async (req, res) => {
  try {
    let { sessionId } = req.params;

    // Handle VINSMOKE@ prefix - if not present, add it
    if (!sessionId.startsWith('VINSMOKE@')) {
      sessionId = `VINSMOKE@${sessionId}`;
    }

    const sessionPath = path.join(__dirname, 'sessions', sessionId);

    if (!fs.existsSync(sessionPath)) {
      return res.status(404).json({
        success: false,
        error: 'Session not found'
      });
    }

    const files = await fs.readdir(sessionPath);
    const fileList = [];

    for (const file of files) {
      const filePath = path.join(sessionPath, file);
      const stats = await fs.stat(filePath);

      if (stats.isFile()) {
        fileList.push({
          name: file,
          size: stats.size,
          modified: stats.mtime
        });
      }
    }

    res.json({
      success: true,
      sessionId,
      files: fileList
    });
  } catch (error) {
    console.error('Get Session Files Error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get session files'
    });
  }
});

// Download individual session file (for bot integration)
app.get('/api/admin/sessions/:sessionId/files/:filename', verifyAdmin, async (req, res) => {
  try {
    let { sessionId, filename } = req.params;

    // Handle VINSMOKE@ prefix - if not present, add it
    if (!sessionId.startsWith('VINSMOKE@')) {
      sessionId = `VINSMOKE@${sessionId}`;
    }

    // Security: prevent directory traversal
    if (filename.includes('..') || filename.includes('/') || filename.includes('\\')) {
      return res.status(400).json({
        success: false,
        error: 'Invalid filename'
      });
    }

    const sessionPath = path.join(__dirname, 'sessions', sessionId);
    const filePath = path.join(sessionPath, filename);

    if (!fs.existsSync(filePath)) {
      return res.status(404).json({
        success: false,
        error: 'File not found'
      });
    }

    const stats = await fs.stat(filePath);
    if (!stats.isFile()) {
      return res.status(400).json({
        success: false,
        error: 'Not a file'
      });
    }

    // Set appropriate headers - keep original filename
    const ext = path.extname(filename).toLowerCase();
    let contentType = 'application/octet-stream';

    if (ext === '.json') contentType = 'application/json';
    else if (ext === '.txt') contentType = 'text/plain';

    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Length', stats.size);

    // Stream the file
    const fileStream = fs.createReadStream(filePath);
    fileStream.pipe(res);

  } catch (error) {
    console.error('Download Session File Error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to download file'
    });
  }
});

// Public Bot Integration Endpoints (No Auth Required)

// Get session files list (for bots)
app.get('/api/session/:sessionId/files', async (req, res) => {
  try {
    let { sessionId } = req.params;
    const { manjisama } = req.query;

    // Check password parameter
    if (manjisama !== 'manjisama') {
      return res.status(401).json({
        success: false,
        error: 'Unauthorized access'
      });
    }

    // Handle VINSMOKE@ prefix - if not present, add it
    if (!sessionId.startsWith('VINSMOKE@')) {
      sessionId = `VINSMOKE@${sessionId}`;
    }

    const sessionPath = path.join(__dirname, 'sessions', sessionId);

    if (!fs.existsSync(sessionPath)) {
      return res.status(404).json({
        success: false,
        error: 'Session not found'
      });
    }

    const files = await fs.readdir(sessionPath);
    const fileList = [];

    for (const file of files) {
      const filePath = path.join(sessionPath, file);
      const stats = await fs.stat(filePath);

      if (stats.isFile()) {
        fileList.push({
          name: file,
          size: stats.size,
          modified: stats.mtime,
          downloadUrl: `/api/session/${encodeURIComponent(sessionId)}/file/${encodeURIComponent(file)}`
        });
      }
    }

    res.json({
      success: true,
      sessionId,
      files: fileList
    });
  } catch (error) {
    console.error('Get Session Files Error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get session files'
    });
  }
});

// Download individual session file (for bots)
app.get('/api/session/:sessionId/file/:filename', async (req, res) => {
  try {
    let { sessionId, filename } = req.params;
    const { manjisama } = req.query;

    // Check password parameter
    if (manjisama !== 'manjisama') {
      return res.status(401).json({
        success: false,
        error: 'Unauthorized access'
      });
    }

    // Handle VINSMOKE@ prefix - if not present, add it
    if (!sessionId.startsWith('VINSMOKE@')) {
      sessionId = `VINSMOKE@${sessionId}`;
    }

    // Security: prevent directory traversal
    if (filename.includes('..') || filename.includes('/') || filename.includes('\\')) {
      return res.status(400).json({
        success: false,
        error: 'Invalid filename'
      });
    }

    const sessionPath = path.join(__dirname, 'sessions', sessionId);
    const filePath = path.join(sessionPath, filename);

    if (!fs.existsSync(filePath)) {
      return res.status(404).json({
        success: false,
        error: 'File not found'
      });
    }

    const stats = await fs.stat(filePath);
    if (!stats.isFile()) {
      return res.status(400).json({
        success: false,
        error: 'Not a file'
      });
    }

    // Set appropriate headers - keep original filename
    const ext = path.extname(filename).toLowerCase();
    let contentType = 'application/octet-stream';

    if (ext === '.json') contentType = 'application/json';
    else if (ext === '.txt') contentType = 'text/plain';

    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Length', stats.size);

    // Stream the file
    const fileStream = fs.createReadStream(filePath);
    fileStream.pipe(res);

  } catch (error) {
    console.error('Download Session File Error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to download file'
    });
  }
});

app.get('/api/admin/plugins', verifyAdmin, async (req, res) => {
  try {
    const plugins = await pluginService.getPlugins({ includeAll: true }); // Include all plugins for admin
    res.json({
      success: true,
      plugins
    });
  } catch (error) {
    console.error('Admin Plugins Error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get plugins'
    });
  }
});

app.put('/api/admin/plugins/:id/status', verifyAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    const plugin = await pluginService.updatePluginStatus(id, status);
    res.json({
      success: true,
      plugin
    });
  } catch (error) {
    console.error('Admin Update Plugin Status Error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to update plugin status'
    });
  }
});

app.delete('/api/admin/plugins/:id', verifyAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    await pluginService.deletePlugin(id);
    res.json({
      success: true,
      message: 'Plugin deleted successfully'
    });
  } catch (error) {
    console.error('Admin Delete Plugin Error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to delete plugin'
    });
  }
});

app.get('/api/admin/plugins/download', verifyAdmin, async (req, res) => {
  try {
    const plugins = await pluginService.getAllPlugins();
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', 'attachment; filename=plugins.json');
    res.json(plugins);
  } catch (error) {
    console.error('Admin Download Plugins Error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to download plugins'
    });
  }
});

app.get('/api/admin/support', verifyAdmin, async (req, res) => {
  try {
    // This would read from a config file or database
    const supportData = {
      instagram: '@manjisama1',
      email: 'manjisamaa@gmail.com',
      telegram: 'https://t.me/+ajJtuJa1wVxmOTRl',
      github: 'https://github.com/manjisama1/vinsmoke',
      documentation: 'https://github.com/manjisama1/vinsmoke',
      responseTime: '24 hours',
      supportDescription: 'Get help with Vinsmoke bot setup, troubleshooting, and feature requests.'
    };

    res.json(supportData);
  } catch (error) {
    console.error('Admin Support Error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get support data'
    });
  }
});

app.put('/api/admin/support', verifyAdmin, async (req, res) => {
  try {
    const supportData = req.body;
    // This would save to a config file or database
    // For now, we'll just return success
    res.json({
      success: true,
      message: 'Support data updated successfully'
    });
  } catch (error) {
    console.error('Admin Update Support Error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to update support data'
    });
  }
});

// Public FAQ Routes (no authentication required)
app.get('/api/faqs', async (req, res) => {
  try {
    const faqs = await faqService.getAllFAQs();

    res.json({
      success: true,
      faqs
    });
  } catch (error) {
    console.error('Public FAQs Error:', error);

    res.status(500).json({
      success: false,
      error: 'Failed to get FAQs'
    });
  }
});

// Bulk Public Data Endpoint (FAQs + Plugins + Categories)
app.get('/api/public-data', async (req, res) => {
  try {
    // Fetch all public data in parallel
    const [faqs, plugins] = await Promise.all([
      faqService.getAllFAQs(),
      pluginService.getPlugins({ includeAll: false }) // Only approved plugins
    ]);

    // Extract categories from FAQs
    const categories = ['All', ...new Set(faqs.map(faq => faq.category))];

    res.json({
      success: true,
      faqs,
      plugins,
      categories,
      timestamp: new Date().toISOString(),
      cacheFor: 30 * 60 * 1000 // 30 minutes
    });
  } catch (error) {
    console.error('Public Data Error:', error);

    res.status(500).json({
      success: false,
      error: 'Failed to get public data'
    });
  }
});

// Bulk Admin Data Endpoint
app.get('/api/admin-data', verifyAdmin, async (req, res) => {
  try {
    // Fetch all admin data in parallel
    const [stats, sessions, faqs, plugins] = await Promise.all([
      // Stats
      (async () => {
        const allSessions = await whatsappService.getAllSessions();
        const allPlugins = await pluginService.getAllPlugins();
        return {
          totalSessions: allSessions.length,
          activeSessions: allSessions.filter(s => s.connected).length,
          totalPlugins: allPlugins.length,
          pendingPlugins: allPlugins.filter(p => p.status === 'pending').length,
          totalFAQs: (await faqService.getAllFAQs()).length
        };
      })(),

      // Sessions
      whatsappService.getAllSessions(),

      // FAQs
      faqService.getAllFAQs(),

      // Plugins (all including pending)
      pluginService.getPlugins({ includeAll: true })
    ]);

    res.json({
      success: true,
      stats,
      sessions,
      faqs,
      plugins,
      timestamp: new Date().toISOString(),
      cacheFor: 5 * 60 * 1000 // 5 minutes for admin data
    });
  } catch (error) {
    console.error('Admin Data Error:', error);

    res.status(500).json({
      success: false,
      error: 'Failed to get admin data'
    });
  }
});

app.post('/api/admin/bulk-save', verifyAdmin, async (req, res) => {
  try {
    const { changes } = req.body;

    if (!Array.isArray(changes)) {
      return res.status(400).json({
        success: false,
        error: 'Changes must be an array'
      });
    }

    const results = [];

    for (const change of changes) {
      try {
        switch (change.type) {
          case 'updatePlugin':
            if (change.data.status) {
              await pluginService.updatePluginStatus(change.id, change.data.status);
            }
            results.push({ type: change.type, id: change.id, success: true });
            break;

          case 'deletePlugin':
            await pluginService.deletePlugin(change.id);
            results.push({ type: change.type, id: change.id, success: true });
            break;

          case 'addFAQ':
            const newFAQ = await faqService.addFAQ(change.data);
            results.push({ type: change.type, success: true, data: newFAQ });
            break;

          case 'updateFAQ':
            const updatedFAQ = await faqService.updateFAQ(change.id, change.data);
            results.push({ type: change.type, id: change.id, success: true, data: updatedFAQ });
            break;

          case 'deleteFAQ':
            await faqService.deleteFAQ(change.id);
            results.push({ type: change.type, id: change.id, success: true });
            break;

          default:
            results.push({ type: change.type, success: false, error: 'Unknown change type' });
        }
      } catch (error) {
        results.push({ type: change.type, success: false, error: error.message });
      }
    }

    res.json({
      success: true,
      results,
      message: `Processed ${results.length} changes`
    });
  } catch (error) {
    console.error('Bulk Save Error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to save bulk changes'
    });
  }
});

// FAQ Admin Routes
app.get('/api/admin/faqs', verifyAdmin, async (req, res) => {
  try {
    const faqs = await faqService.getAllFAQs();
    res.json({
      success: true,
      faqs
    });
  } catch (error) {
    console.error('Admin FAQs Error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get FAQs'
    });
  }
});

app.post('/api/admin/faqs', verifyAdmin, async (req, res) => {
  try {
    const { question, answer, category, tags } = req.body;

    if (!question || !answer || !category) {
      return res.status(400).json({
        success: false,
        error: 'Question, answer, and category are required'
      });
    }

    const faq = await faqService.addFAQ({
      question,
      answer,
      category,
      tags: Array.isArray(tags) ? tags : (tags ? tags.split(',').map(t => t.trim()) : [])
    });

    res.json({
      success: true,
      faq
    });
  } catch (error) {
    console.error('Admin Add FAQ Error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to add FAQ'
    });
  }
});

app.put('/api/admin/faqs/:id', verifyAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { question, answer, category, tags } = req.body;

    const updateData = {
      question,
      answer,
      category,
      tags: Array.isArray(tags) ? tags : (tags ? tags.split(',').map(t => t.trim()) : [])
    };

    const faq = await faqService.updateFAQ(id, updateData);

    res.json({
      success: true,
      faq
    });
  } catch (error) {
    console.error('Admin Update FAQ Error:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to update FAQ'
    });
  }
});

app.delete('/api/admin/faqs/:id', verifyAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    await faqService.deleteFAQ(id);

    res.json({
      success: true,
      message: 'FAQ deleted successfully'
    });
  } catch (error) {
    console.error('Admin Delete FAQ Error:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to delete FAQ'
    });
  }
});

app.get('/api/admin/faqs/download', verifyAdmin, async (req, res) => {
  try {
    const faqs = await faqService.getAllFAQs();
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', 'attachment; filename=faqs.json');
    res.json(faqs);
  } catch (error) {
    console.error('Admin Download FAQs Error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to download FAQs'
    });
  }
});

// Contact Routes
app.get('/api/contact', async (req, res) => {
  try {
    const contactService = require('./services/contactService');
    const contactData = await contactService.getContactData();
    res.json({
      success: true,
      data: {
        supportChannels: contactData.supportChannels,
        commonTopics: contactData.commonTopics,
        emergencyContact: contactData.emergencyContact,
        additionalResources: contactData.additionalResources
      }
    });
  } catch (error) {
    console.error('Error fetching contact data:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch contact data'
    });
  }
});

// Plugin Management Routes
app.get('/api/plugins', async (req, res) => {
  try {
    const { type, sort, search } = req.query;
    const plugins = await pluginService.getPlugins({ type, sort, search });

    res.json({
      success: true,
      plugins
    });
  } catch (error) {
    console.error('Get Plugins Error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get plugins'
    });
  }
});

app.post('/api/plugins', async (req, res) => {
  try {
    const { name, description, type, gistLink, author } = req.body;

    if (!name || !description || !type || !gistLink) {
      return res.status(400).json({
        success: false,
        error: 'All fields are required'
      });
    }

    const plugin = await pluginService.addPlugin({
      name,
      description,
      type,
      gistLink,
      author: author || 'Anonymous'
    });

    res.json({
      success: true,
      plugin
    });
  } catch (error) {
    console.error('Add Plugin Error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to add plugin'
    });
  }
});

app.post('/api/plugins/:id/like', async (req, res) => {
  try {
    const { id } = req.params;
    const { userId } = req.body;

    if (!userId) {
      return res.status(400).json({
        success: false,
        error: 'User ID required'
      });
    }

    const plugin = await pluginService.likePlugin(id, userId);

    res.json({
      success: true,
      plugin
    });
  } catch (error) {
    console.error('Like Plugin Error:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to like plugin'
    });
  }
});

// Socket.IO connection handling
io.on('connection', (socket) => {
  let currentSessionId = null;

  socket.on('join-session', (sessionId) => {
    socket.join(sessionId);
    currentSessionId = sessionId;
  });

  socket.on('disconnect', () => {
    if (currentSessionId) {
      const room = io.sockets.adapter.rooms.get(currentSessionId);
      const clientCount = room ? room.size : 0;

      if (clientCount === 0) {
        setTimeout(async () => {
          const roomAfterDelay = io.sockets.adapter.rooms.get(currentSessionId);
          const clientCountAfterDelay = roomAfterDelay ? roomAfterDelay.size : 0;

          if (clientCountAfterDelay === 0) {
            try {
              const sessionPath = path.join(__dirname, 'sessions', currentSessionId);
              const hasFiles = fs.existsSync(sessionPath) && fs.readdirSync(sessionPath).length > 1;

              if (!hasFiles) {
                await whatsappService.stopSession(currentSessionId);
              }
            } catch (error) {
              log.error('Session cleanup error:', error.message);
            }
          }
        }, 30000);
      }
    }
  });
});

// Error handling middleware
app.use((error, req, res, next) => {
  log.error('Unhandled Error:', error.message);
  res.status(500).json({
    success: false,
    error: 'Internal server error'
  });
});

// API-only mode - no frontend serving
// Frontend will be deployed separately
app.get('*', (req, res) => {
  // Only handle API routes, return 404 for everything else
  if (req.path.startsWith('/api/') || req.path.startsWith('/socket.io/')) {
    return res.status(404).json({ error: 'API endpoint not found' });
  }

  // For non-API routes, return API info
  res.json({
    name: 'Vinsmoke Bot Backend API',
    version: '1.0.0',
    status: 'running',
    endpoints: {
      health: '/api/health',
      session: {
        qr: 'POST /api/session/qr',
        pairing: 'POST /api/session/pairing',
        get: 'GET /api/session/:sessionId',
        delete: 'DELETE /api/session/:sessionId',
        files: 'GET /api/session/:sessionId/files',
        fileList: 'GET /api/session/:sessionId/filelist',
        downloadFile: 'GET /api/session/:sessionId/file/:fileName'
      },
      plugins: 'GET /api/plugins',
      faqs: 'GET /api/faqs'
    }
  });
});

const PORT = process.env.PORT || 8080;
const HOST = process.env.HOST || '0.0.0.0';

// Graceful shutdown handling
process.on('SIGTERM', () => {
  log.warn('SIGTERM: Shutting down...');
  server.close(() => {
    log.success('Terminated');
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  log.warn('SIGINT: Shutting down...');
  server.close(() => {
    log.success('Terminated');
    process.exit(0);
  });
});

// Start server
server.listen(PORT, HOST, () => {
  log.success(`Vinsmoke Bot Backend v1.0.0`);
  log.info(`Server: ${HOST}:${PORT}`);
  log.info(`Environment: ${process.env.NODE_ENV || 'development'}`);

  // Configuration status
  log.success(`Services: Ready`);

  // CORS status
  if (process.env.FRONTEND_URL) {
    log.success(`CORS: Configured`);
  } else {
    log.warn(`CORS: Platform fallbacks`);
  }

  // GitHub OAuth status
  if (process.env.GITHUB_CLIENT_ID && process.env.GITHUB_CLIENT_SECRET) {
    log.success(`OAuth: Enabled`);
  } else {
    log.warn(`OAuth: Disabled`);
  }
});
