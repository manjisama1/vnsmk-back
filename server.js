const express = require('express');
const cors = require('cors');
const http = require('http');
const socketIo = require('socket.io');
const fs = require('fs-extra');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
require('dotenv').config();

const WhatsAppService = require('./services/whatsappService');
const PluginService = require('./services/pluginService');
const FAQService = require('./services/faqService');
const { isAdmin } = require('./config/admin');

const app = express();

// Trust proxy for production deployments (Render, Heroku, etc.)
if (process.env.TRUST_PROXY === 'true') {
  app.set('trust proxy', 1);
}

// Security middleware
const helmet = require('helmet');
const compression = require('compression');
const rateLimit = require('express-rate-limit');

// Apply security headers
app.use(helmet({
  contentSecurityPolicy: false, // Disable CSP for API-only service
  crossOriginEmbedderPolicy: false
}));

// Compress responses
app.use(compression());

// Rate limiting
const limiter = rateLimit({
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW) || 15 * 60 * 1000, // 15 minutes
  max: parseInt(process.env.RATE_LIMIT_MAX) || 100, // limit each IP to 100 requests per windowMs
  message: {
    error: 'Too many requests from this IP, please try again later.',
    retryAfter: '15 minutes'
  },
  standardHeaders: true,
  legacyHeaders: false,
});

app.use('/api/', limiter);

const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: process.env.NODE_ENV === 'production' 
      ? [process.env.FRONTEND_URL].filter(Boolean)
      : [
          "http://localhost:3000",
          "http://localhost:3001",
          "http://127.0.0.1:3000",
          "http://127.0.0.1:3001"
        ],
    methods: ["GET", "POST"],
    credentials: true
  },
  transports: ['websocket', 'polling']
});

// CORS configuration
const corsOptions = {
  origin: function (origin, callback) {
    const allowedOrigins = process.env.NODE_ENV === 'production' 
      ? (process.env.ALLOWED_ORIGINS || process.env.FRONTEND_URL || '').split(',').filter(Boolean)
      : [
          'http://localhost:3000',
          'http://localhost:3001',
          'http://127.0.0.1:3000',
          'http://127.0.0.1:3001'
        ];
    
    // Allow requests with no origin (mobile apps, curl, etc.)
    if (!origin) return callback(null, true);
    
    if (allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
  exposedHeaders: ['X-Total-Count'],
  maxAge: 86400 // 24 hours
};

app.use(cors(corsOptions));
// Body parsing middleware with limits
app.use(express.json({ 
  limit: process.env.MAX_REQUEST_SIZE || '10mb',
  strict: true
}));
app.use(express.urlencoded({ 
  extended: true, 
  limit: process.env.MAX_REQUEST_SIZE || '10mb' 
}));

// Request timeout
app.use((req, res, next) => {
  req.setTimeout(parseInt(process.env.REQUEST_TIMEOUT) || 30000);
  next();
});

// Services
const whatsappService = new WhatsAppService(io);
const pluginService = new PluginService();
const faqService = new FAQService();

// WhatsApp service initialized - no existing sessions to initialize
// Sessions are created on-demand and auto-cleaned after 24h

// GitHub OAuth Routes
app.get('/auth/github', (req, res) => {
  const clientId = process.env.GITHUB_CLIENT_ID;
  const redirectUri = encodeURIComponent(`${process.env.BACKEND_URL || 'http://localhost:5000'}/auth/callback`);
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
    res.json({
      success: true,
      sessionId,
      qrCode: result.qrCode
    });
  } catch (error) {
    console.error('QR Generation Error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to generate QR code'
    });
  }
});

app.post('/api/session/pairing', async (req, res) => {
  try {
    const { phoneNumber } = req.body;
    if (!phoneNumber) {
      return res.status(400).json({
        success: false,
        error: 'Phone number is required'
      });
    }

    const sessionId = uuidv4();
    const result = await whatsappService.generatePairingCode(sessionId, phoneNumber);

    res.json({
      success: true,
      sessionId,
      pairingCode: result.pairingCode
    });
  } catch (error) {
    if (error.message === 'MAINTENANCE_MODE' || error.isMaintenanceMode) {
      // This is expected behavior, not an error
      console.log('📋 Pairing code requested but service is in maintenance mode');
      res.status(503).json({
        success: false,
        error: 'MAINTENANCE_MODE',
        message: 'Pairing code is under maintenance. Please use QR code for now.'
      });
    } else {
      console.error('Pairing Code Generation Error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to generate pairing code'
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

// Get all session files for a specific session ID
app.get('/api/session/:sessionId/files', async (req, res) => {
  try {
    const { sessionId } = req.params;
    const sessionFiles = await whatsappService.getSessionFiles(sessionId);

    if (!sessionFiles) {
      return res.status(404).json({
        success: false,
        error: 'Session files not found'
      });
    }

    res.json({
      success: true,
      sessionId: sessionId,
      files: sessionFiles
    });
  } catch (error) {
    console.error('Get Session Files Error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get session files'
    });
  }
});

// Get individual session file
app.get('/api/session/:sessionId/file/:fileName', async (req, res) => {
  try {
    const { sessionId, fileName } = req.params;
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
    const { sessionId } = req.params;
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
  console.log('Client connected:', socket.id);

  // Track which session this client is connected to
  let currentSessionId = null;

  socket.on('join-session', (sessionId) => {
    socket.join(sessionId);
    currentSessionId = sessionId;
    console.log(`Client ${socket.id} joined session ${sessionId}`);
  });

  socket.on('disconnect', () => {
    console.log('Client disconnected:', socket.id);

    // If client was connected to a session, check if we should clean it up
    if (currentSessionId) {
      // Check if there are any other clients in this session room
      const room = io.sockets.adapter.rooms.get(currentSessionId);
      const clientCount = room ? room.size : 0;

      if (clientCount === 0) {
        // No more clients connected to this session, schedule cleanup
        console.log(`🧹 No clients left for session ${currentSessionId}, scheduling cleanup...`);

        // Give a grace period before cleanup in case client reconnects quickly
        setTimeout(async () => {
          const roomAfterDelay = io.sockets.adapter.rooms.get(currentSessionId);
          const clientCountAfterDelay = roomAfterDelay ? roomAfterDelay.size : 0;

          if (clientCountAfterDelay === 0) {
            console.log(`🗑️ Cleaning up abandoned session: ${currentSessionId}`);
            try {
              // Stop the WhatsApp session if it's still active
              await whatsappService.stopSession(currentSessionId);
            } catch (error) {
              console.error('Error cleaning up session:', error);
            }
          }
        }, 30000); // 30 second grace period
      }
    }
  });
});

// Error handling middleware
app.use((error, req, res, next) => {
  console.error('Unhandled Error:', error);
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
  console.log('🛑 SIGTERM received, shutting down gracefully...');
  server.close(() => {
    console.log('✅ Process terminated');
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  console.log('🛑 SIGINT received, shutting down gracefully...');
  server.close(() => {
    console.log('✅ Process terminated');
    process.exit(0);
  });
});

// Start server
server.listen(PORT, HOST, () => {
  console.log(`🚀 Vinsmoke Bot Backend v1.0.0`);
  console.log(`🌐 Server running on ${HOST}:${PORT}`);
  console.log(`🌍 Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`📱 WhatsApp Service: ✅ Initialized`);
  console.log(`🔌 Plugin Service: ✅ Initialized`);
  console.log(`🛡️  Security: ✅ Enabled`);
  console.log(`⚡ Compression: ✅ Enabled`);
  console.log(`🚦 Rate Limiting: ✅ Enabled`);
  console.log(`📊 Health Check: /api/health`);
  
  if (process.env.NODE_ENV === 'production') {
    console.log(`🔒 Production mode: Security enhanced`);
  } else {
    console.log(`🔧 Development mode: Debug enabled`);
  }
});