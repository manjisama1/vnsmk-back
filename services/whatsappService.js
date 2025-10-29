const {
    default: makeWASocket,
    DisconnectReason,
    useMultiFileAuthState,
    makeCacheableSignalKeyStore,
    fetchLatestBaileysVersion,
    Browsers,
    jidNormalizedUser,
    WA_DEFAULT_EPHEMERAL
} = require('@whiskeysockets/baileys');
const QRCode = require('qrcode');
const fs = require('fs-extra');
const path = require('path');
const pino = require('pino');

class WhatsAppService {
    constructor(io) {
        this.io = io;
        this.sessionsDir = path.join(__dirname, '../sessions');
        this.sessionTrackingFile = path.join(__dirname, '../data/session-tracking.json');
        this.activeSessions = new Map(); // Track active sessions for retry logic
        this.initialized = false;
        this.initPromise = this.initialize();
    }

    async initialize() {
        try {
            await this.ensureDirectories();
            this.startSessionCleanupTimer();
            this.startUnscannedSessionCleanup();
            this.initialized = true;
            console.log('📱 WhatsApp Service: Data files initialized');
        } catch (error) {
            console.error('❌ WhatsApp Service initialization error:', error);
        }
    }

    async ensureInitialized() {
        if (!this.initialized) {
            await this.initPromise;
        }
    }

    async ensureDirectories() {
        await fs.ensureDir(this.sessionsDir);
        await fs.ensureDir(path.dirname(this.sessionTrackingFile));

        // Initialize session tracking file if it doesn't exist
        if (!(await fs.pathExists(this.sessionTrackingFile))) {
            console.log('📱 Creating session-tracking.json file...');
            await fs.writeJson(this.sessionTrackingFile, { sessions: [] });
        }
    }

    createSocket(state, version) {
        return makeWASocket({
            auth: {
                creds: state.creds,
                keys: makeCacheableSignalKeyStore(state.keys, pino({ level: 'silent' }))
            },
            version,
            browser: Browsers.macOS('VINSMOKE'),
            logger: pino({ level: 'silent' }),
            markOnlineOnConnect: false,
            connectTimeoutMs: 60000,
            defaultQueryTimeoutMs: 60000,
            keepAliveIntervalMs: 10000,
            retryRequestDelayMs: 250,
            maxMsgRetryCount: 3,
            printQRInTerminal: false,
            syncFullHistory: false,
            shouldSyncHistoryMessage: () => false,
            getMessage: async () => undefined
        });
    }

    async trackSession(sessionId) {
        try {
            const tracking = await fs.readJson(this.sessionTrackingFile);
            const sessionData = {
                sessionId,
                createdAt: new Date().toISOString(),
                expiresAt: new Date(Date.now() + (parseInt(process.env.SESSION_TIMEOUT) || 24 * 60 * 60 * 1000)).toISOString()
            };

            tracking.sessions.push(sessionData);
            await fs.writeJson(this.sessionTrackingFile, tracking, { spaces: 2 });
            console.log(`📝 Session tracked: ${sessionId} (expires in 24h)`);
        } catch (error) {
            console.error('Error tracking session:', error);
        }
    }

    async removeSessionTracking(sessionId) {
        try {
            const tracking = await fs.readJson(this.sessionTrackingFile);
            tracking.sessions = tracking.sessions.filter(s => s.sessionId !== sessionId);
            await fs.writeJson(this.sessionTrackingFile, tracking, { spaces: 2 });
        } catch (error) {
            console.error('Error removing session tracking:', error);
        }
    }

    async cleanupExpiredSessions() {
        try {
            const tracking = await fs.readJson(this.sessionTrackingFile);
            const now = new Date();
            const expiredSessions = [];
            const orphanedSessions = [];
            const validSessions = [];

            for (const session of tracking.sessions) {
                const sessionPath = path.join(this.sessionsDir, session.sessionId);
                const sessionExists = await fs.pathExists(sessionPath);

                if (!sessionExists) {
                    // Session folder doesn't exist - orphaned entry
                    orphanedSessions.push(session);
                    console.log(`🗑️ Found orphaned session entry: ${session.sessionId} (folder missing)`);
                } else if (new Date(session.expiresAt) <= now) {
                    // Session expired
                    expiredSessions.push(session);
                } else {
                    // Session is valid and active
                    validSessions.push(session);
                }
            }

            // Delete expired session folders
            for (const session of expiredSessions) {
                const sessionPath = path.join(this.sessionsDir, session.sessionId);
                if (await fs.pathExists(sessionPath)) {
                    await fs.remove(sessionPath);
                    console.log(`🗑️ Deleted expired session: ${session.sessionId}`);
                }
            }

            // Update tracking file with only valid sessions (removes both expired and orphaned)
            tracking.sessions = validSessions;
            await fs.writeJson(this.sessionTrackingFile, tracking, { spaces: 2 });

            const totalCleaned = expiredSessions.length + orphanedSessions.length;
            if (totalCleaned > 0) {
                console.log(`🧹 Cleaned up ${expiredSessions.length} expired and ${orphanedSessions.length} orphaned sessions`);
            }
        } catch (error) {
            console.error('Error cleaning up expired sessions:', error);
        }
    }

    async cleanupOrphanedEntries() {
        try {
            const tracking = await fs.readJson(this.sessionTrackingFile);
            const orphanedSessions = [];
            const validSessions = [];

            for (const session of tracking.sessions) {
                const sessionPath = path.join(this.sessionsDir, session.sessionId);
                const sessionExists = await fs.pathExists(sessionPath);

                if (!sessionExists) {
                    orphanedSessions.push(session);
                    console.log(`🗑️ Removing orphaned entry: ${session.sessionId} (folder missing)`);
                } else {
                    validSessions.push(session);
                }
            }

            if (orphanedSessions.length > 0) {
                // Update tracking file to remove orphaned entries
                tracking.sessions = validSessions;
                await fs.writeJson(this.sessionTrackingFile, tracking, { spaces: 2 });
                console.log(`🧹 Removed ${orphanedSessions.length} orphaned session entries`);
            }

            return orphanedSessions.length;
        } catch (error) {
            console.error('Error cleaning up orphaned entries:', error);
            return 0;
        }
    }

    startSessionCleanupTimer() {
        // Run cleanup every hour
        setInterval(() => {
            this.cleanupExpiredSessions();
        }, 60 * 60 * 1000);

        // Run initial sync and cleanup
        setTimeout(() => {
            this.syncSessionData().then(() => {
                this.cleanupExpiredSessions();
            });
        }, 5000);

        // Run orphaned cleanup every 30 minutes
        setInterval(() => {
            this.cleanupOrphanedEntries();
        }, 30 * 60 * 1000);

        // Run full sync every 6 hours to catch any inconsistencies
        setInterval(() => {
            this.syncSessionData();
        }, 6 * 60 * 60 * 1000);
    }

    startUnscannedSessionCleanup() {
        // Clean up unscanned sessions every 5 minutes
        setInterval(async () => {
            try {
                const now = Date.now();
                const maxAge = 10 * 60 * 1000; // 10 minutes
                
                for (const [sessionId, sessionData] of this.activeSessions.entries()) {
                    const age = now - sessionData.createdAt;
                    
                    // If session is older than 10 minutes and not connected, clean it up
                    if (age > maxAge && !sessionData.connected) {
                        console.log(`🧹 Cleaning up unscanned session: ${sessionId} (age: ${Math.round(age / 1000 / 60)}min)`);
                        try {
                            await this.stopSession(sessionId);
                        } catch (error) {
                            console.error('Error cleaning up unscanned session:', error);
                        }
                    }
                }
            } catch (error) {
                console.error('Unscanned session cleanup error:', error);
            }
        }, 5 * 60 * 1000); // 5 minutes
    }

    shouldReconnect(lastDisconnect) {
        const reason = lastDisconnect?.error?.output?.statusCode;

        // Don't reconnect for these reasons
        if (reason === DisconnectReason.loggedOut || 
            reason === DisconnectReason.badSession ||
            reason === 408 || // Request timeout - usually means QR expired
            reason === 401 || // Unauthorized
            reason === 403 || // Forbidden
            reason === 428) { // Precondition required
            return false;
        }

        // Only reconnect for connection issues (515, 500, etc.)
        return reason === DisconnectReason.connectionLost || 
               reason === DisconnectReason.connectionClosed ||
               reason === 515; // Stream error
    }

    async handleConnection(sock, sessionId, saveCreds) {
        return new Promise((resolve, reject) => {
            let resolved = false;
            let connected = false;
            let qrCount = 0;
            let qrExpired = false;

            sock.ev.on('connection.update', async (update) => {
                const { connection, lastDisconnect, qr, receivedPendingNotifications } = update;

                if (qr && !resolved && !qrExpired) {
                    try {
                        qrCount++;
                        console.log(`📱 QR Code ${qrCount} generated for session: ${sessionId}`);
                        
                        // Only allow the first QR code
                        if (qrCount === 1) {
                            const qrCodeDataURL = await QRCode.toDataURL(qr);

                            this.io.to(sessionId).emit('qr-code', {
                                qrCode: qrCodeDataURL,
                                qrCount
                            });

                            if (!resolved) {
                                resolved = true;
                                resolve({ qrCode: qrCodeDataURL });
                            }
                        } else {
                            // QR code refreshed, mark as expired and stop the session
                            console.log(`⏰ QR Code expired for session: ${sessionId}, stopping session`);
                            qrExpired = true;
                            
                            this.io.to(sessionId).emit('qr-expired', {
                                message: 'QR Code expired. Please generate a new one.'
                            });
                            
                            // Stop the session after QR expires
                            setTimeout(async () => {
                                try {
                                    await this.stopSession(sessionId);
                                } catch (error) {
                                    console.error('Error stopping expired session:', error);
                                }
                            }, 2000);
                        }
                    } catch (error) {
                        console.error('QR Code generation error:', error);
                        if (!resolved) {
                            resolved = true;
                            reject(error);
                        }
                    }
                }

                // Detect when QR is scanned
                if (receivedPendingNotifications && !connected) {
                    console.log(`📱 QR Code scanned for session: ${sessionId}, processing connection...`);
                    this.io.to(sessionId).emit('qr-scanned', { message: 'QR Code scanned, connecting...' });
                }

                if (connection === 'open') {
                    console.log(`✅ WhatsApp connection opened for session: ${sessionId}`);
                    connected = true;

                    // Generate custom session ID
                    const customSessionId = `VINSMOKEm@${sessionId}`;

                    try {
                        // Normalize the JID to get clean user ID
                        const normalizedJid = jidNormalizedUser(sock.user.id);
                        console.log(`📱 Normalized JID: ${normalizedJid} (from ${sock.user.id})`);

                        // Send session ID as disappearing message (24 hours)
                        await sock.sendMessage(normalizedJid, {
                            text: customSessionId
                        }, {
                            ephemeralExpiration: 86400 // 24 hours in seconds
                        });

                        // Send session live message as normal message (permanent)
                        await sock.sendMessage(normalizedJid, {
                            text: `🟢 Session is now live and ready to use!`
                        });

                        console.log(`📤 Messages sent to session: ${sessionId} (session ID expires in 24h, status permanent)`);

                        // Mark session as connected
                        const sessionData = this.activeSessions.get(sessionId);
                        if (sessionData) {
                            sessionData.connected = true;
                        }

                        // Emit connection success
                        this.io.to(sessionId).emit('session-connected', {
                            sessionId: customSessionId,
                            status: 'connected'
                        });

                        // Track session for 24h cleanup
                        await this.trackSession(sessionId);

                        // Clean up from active sessions
                        this.activeSessions.delete(sessionId);

                        // Disconnect immediately after sending messages
                        setTimeout(() => {
                            try {
                                sock.end();
                                console.log(`🔌 Disconnected session: ${sessionId} (session created and messages sent)`);
                            } catch (error) {
                                console.log('Socket already closed');
                            }
                        }, 2000);

                    } catch (error) {
                        console.error('Error sending messages:', error);
                    }
                } else if (connection === 'close') {
                    const reason = lastDisconnect?.error?.output?.statusCode;
                    console.log(`❌ Connection closed for session: ${sessionId}, reason: ${reason}`);

                    if (connected) {
                        // If we were connected and then disconnected, that's fine (we sent our messages)
                        console.log(`✅ Session ${sessionId} completed successfully`);
                        return;
                    }

                    // Handle reconnection logic
                    if (this.shouldReconnect(lastDisconnect)) {
                        const sessionData = this.activeSessions.get(sessionId);
                        if (sessionData) {
                            const attempts = sessionData.attempts || 0;
                            if (attempts < 3) {
                                console.log(`🔄 Attempting reconnection ${attempts + 1}/3 for session: ${sessionId} (reason: ${reason})`);

                                // Update attempt count
                                sessionData.attempts = attempts + 1;
                                this.activeSessions.set(sessionId, sessionData);

                                // Close current socket
                                try {
                                    sock.end();
                                } catch (e) {
                                    console.log('Socket already closed');
                                }

                                // Retry after delay
                                setTimeout(async () => {
                                    try {
                                        await this.reconnectSession(sessionId);
                                    } catch (error) {
                                        console.error('Reconnection failed:', error);
                                    }
                                }, 5000 * (attempts + 1)); // Exponential backoff

                                return; // Don't resolve/reject yet, let reconnection handle it
                            } else {
                                console.log(`❌ Max reconnection attempts reached for session: ${sessionId}`);
                                this.activeSessions.delete(sessionId);
                            }
                        }
                    }

                    if (!resolved) {
                        resolved = true;
                        if (reason === DisconnectReason.loggedOut) {
                            reject(new Error('Session logged out'));
                        } else if (reason === DisconnectReason.badSession) {
                            reject(new Error('Bad session'));
                        } else {
                            reject(new Error(`Connection failed with reason: ${reason}`));
                        }
                    }
                } else if (connection === 'connecting') {
                    console.log(`🔄 Connecting to WhatsApp for session: ${sessionId}`);
                }
            });

            sock.ev.on('creds.update', saveCreds);

            // Store socket reference for potential reconnection
            this.activeSessions.set(sessionId, {
                socket: sock,
                createdAt: Date.now(),
                attempts: 0,
                sessionPath: path.join(this.sessionsDir, sessionId)
            });

            // Timeout for connection
            setTimeout(() => {
                if (!resolved && !connected) {
                    resolved = true;
                    this.activeSessions.delete(sessionId);
                    reject(new Error('Connection timeout'));
                }
            }, 90000); // 90 seconds timeout
        });
    }

    async reconnectSession(sessionId) {
        try {
            const sessionData = this.activeSessions.get(sessionId);
            if (!sessionData) {
                console.log('Session data not found for reconnection:', sessionId);
                return;
            }

            console.log('Attempting to reconnect session:', sessionId);
            const sessionPath = sessionData.sessionPath;

            const { state, saveCreds } = await useMultiFileAuthState(sessionPath);
            const { version } = await fetchLatestBaileysVersion();

            const sock = this.createSocket(state, version);

            // Update the socket reference
            sessionData.socket = sock;
            this.activeSessions.set(sessionId, sessionData);

            await this.handleConnection(sock, sessionId, saveCreds);
        } catch (error) {
            console.error('Reconnection error for session', sessionId, ':', error);
            this.activeSessions.delete(sessionId);
            throw error;
        }
    }

    async generateQR(sessionId) {
        try {
            // Check max sessions limit
            const maxSessions = parseInt(process.env.MAX_SESSIONS) || 100;
            if (this.activeSessions.size >= maxSessions) {
                throw new Error(`Maximum sessions limit reached (${maxSessions}). Please try again later.`);
            }

            const sessionPath = path.join(this.sessionsDir, sessionId);
            await fs.ensureDir(sessionPath);

            const { state, saveCreds } = await useMultiFileAuthState(sessionPath);
            const { version } = await fetchLatestBaileysVersion();

            const sock = this.createSocket(state, version);
            return await this.handleConnection(sock, sessionId, saveCreds);
        } catch (error) {
            console.error('WhatsApp QR generation error:', error);
            throw error;
        }
    }

    // PAIRING CODE COMPLETELY REMOVED - NOT WORKING IN BAILEYS
    // Always returns maintenance mode error
    async generatePairingCode() {
        // Throw maintenance mode error (this is expected behavior)
        const error = new Error('MAINTENANCE_MODE');
        error.isMaintenanceMode = true;
        throw error;
    }

    async getSession(sessionId) {
        try {
            const sessionPath = path.join(this.sessionsDir, sessionId);
            if (await fs.pathExists(sessionPath)) {
                return {
                    id: sessionId,
                    status: 'available',
                    path: sessionPath
                };
            }
            return null;
        } catch (error) {
            console.error('Get session error:', error);
            throw error;
        }
    }

    async stopSession(sessionId) {
        try {
            console.log(`🛑 Stopping session: ${sessionId}`);
            
            // Get the active session data
            const sessionData = this.activeSessions.get(sessionId);
            if (sessionData && sessionData.socket) {
                // Close the WhatsApp connection
                try {
                    await sessionData.socket.logout();
                } catch (error) {
                    // If logout fails, force close the connection
                    console.log(`Force closing connection for session: ${sessionId}`);
                    sessionData.socket.end();
                }
            }
            
            // Remove from active sessions
            this.activeSessions.delete(sessionId);
            
            // Clean up session files
            const sessionPath = path.join(this.sessionsDir, sessionId);
            if (await fs.pathExists(sessionPath)) {
                await fs.remove(sessionPath);
            }
            
            // Remove from tracking
            await this.removeSessionTracking(sessionId);
            
            console.log(`✅ Session stopped and cleaned up: ${sessionId}`);
            return { success: true };
        } catch (error) {
            console.error('Stop session error:', error);
            // Still remove from active sessions even if cleanup fails
            this.activeSessions.delete(sessionId);
            throw error;
        }
    }

    async deleteSession(sessionId) {
        try {
            const sessionPath = path.join(this.sessionsDir, sessionId);
            if (await fs.pathExists(sessionPath)) {
                await fs.remove(sessionPath);
            }

            await this.removeSessionTracking(sessionId);
            console.log(`🗑️ Session deleted: ${sessionId}`);
        } catch (error) {
            console.error('Delete session error:', error);
            throw error;
        }
    }

    async getSessionFiles(sessionId) {
        try {
            const sessionPath = path.join(this.sessionsDir, sessionId);
            
            if (!(await fs.pathExists(sessionPath))) {
                return null;
            }

            const files = {};
            const fileList = await fs.readdir(sessionPath);

            for (const fileName of fileList) {
                const filePath = path.join(sessionPath, fileName);
                const stats = await fs.stat(filePath);
                
                if (stats.isFile()) {
                    files[fileName] = {
                        size: stats.size,
                        modified: stats.mtime,
                        downloadUrl: `/api/session/${sessionId}/file/${encodeURIComponent(fileName)}`
                    };
                }
            }

            return files;
        } catch (error) {
            console.error('Get session files error:', error);
            throw error;
        }
    }

    async getSessionFile(sessionId, fileName) {
        try {
            const sessionPath = path.join(this.sessionsDir, sessionId);
            const filePath = path.join(sessionPath, fileName);
            
            // Security check: ensure the file is within the session directory
            if (!filePath.startsWith(sessionPath)) {
                throw new Error('Invalid file path');
            }
            
            if (!(await fs.pathExists(filePath))) {
                return null;
            }

            const stats = await fs.stat(filePath);
            if (!stats.isFile()) {
                return null;
            }

            const buffer = await fs.readFile(filePath);
            
            return {
                buffer: buffer,
                size: stats.size,
                modified: stats.mtime,
                fileName: fileName
            };
        } catch (error) {
            console.error('Get session file error:', error);
            throw error;
        }
    }

    async getSessionFileList(sessionId) {
        try {
            const sessionPath = path.join(this.sessionsDir, sessionId);
            
            if (!(await fs.pathExists(sessionPath))) {
                return null;
            }

            const files = [];
            const fileList = await fs.readdir(sessionPath);

            for (const fileName of fileList) {
                const filePath = path.join(sessionPath, fileName);
                const stats = await fs.stat(filePath);
                
                if (stats.isFile()) {
                    files.push({
                        name: fileName,
                        size: stats.size,
                        modified: stats.mtime,
                        downloadUrl: `/api/session/${sessionId}/file/${encodeURIComponent(fileName)}`
                    });
                }
            }

            return files;
        } catch (error) {
            console.error('Get session file list error:', error);
            throw error;
        }
    }

    async getAllSessions() {
        try {
            const tracking = await fs.readJson(this.sessionTrackingFile);
            return tracking.sessions;
        } catch (error) {
            console.error('Get all sessions error:', error);
            return [];
        }
    }

    async syncSessionData() {
        try {
            console.log('🔄 Syncing session data with filesystem...');

            // Get current tracking data
            const tracking = await fs.readJson(this.sessionTrackingFile);
            const validSessions = [];
            let orphanedCount = 0;

            // Check each tracked session
            for (const session of tracking.sessions) {
                const sessionPath = path.join(this.sessionsDir, session.sessionId);
                if (await fs.pathExists(sessionPath)) {
                    validSessions.push(session);
                } else {
                    orphanedCount++;
                    console.log(`🗑️ Removing orphaned entry: ${session.sessionId}`);
                }
            }

            // Also check for untracked session folders
            const sessionDirs = await fs.readdir(this.sessionsDir);
            const trackedIds = new Set(validSessions.map(s => s.sessionId));
            let untrackedCount = 0;

            for (const dirName of sessionDirs) {
                const dirPath = path.join(this.sessionsDir, dirName);
                const stat = await fs.stat(dirPath);

                if (stat.isDirectory() && !trackedIds.has(dirName)) {
                    untrackedCount++;
                    console.log(`🗑️ Removing untracked session folder: ${dirName}`);
                    await fs.remove(dirPath);
                }
            }

            // Update tracking file
            if (orphanedCount > 0) {
                tracking.sessions = validSessions;
                await fs.writeJson(this.sessionTrackingFile, tracking, { spaces: 2 });
            }

            console.log(`✅ Session sync complete: removed ${orphanedCount} orphaned entries and ${untrackedCount} untracked folders`);
            return { orphanedCount, untrackedCount };
        } catch (error) {
            console.error('Error syncing session data:', error);
            return { orphanedCount: 0, untrackedCount: 0 };
        }
    }
}

module.exports = WhatsAppService;