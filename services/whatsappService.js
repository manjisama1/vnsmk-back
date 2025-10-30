const {
    default: makeWASocket,
    DisconnectReason,
    useMultiFileAuthState,
    fetchLatestBaileysVersion,
    Browsers,
    jidNormalizedUser
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
        this.activeSessions = new Map();
        this.initialized = false;
        this.initPromise = this.initialize();
    }

    async initialize() {
        try {
            await this.ensureDirectories();
            this.startCleanupTimer();
            this.initialized = true;
            console.log('📱 WhatsApp Service initialized');
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

        if (!(await fs.pathExists(this.sessionTrackingFile))) {
            await fs.writeJson(this.sessionTrackingFile, { sessions: [] });
        }
    }

    async checkVersion() {
        const { version, isLatest } = await fetchLatestBaileysVersion();
        console.log(`🔍 Using Baileys v${version.join(".")} (latest: ${isLatest})`);
        return version;
    }

    createSocket(state, version, isPairing = false) {
        // Use Chrome for pairing in production for better compatibility
        const browser = isPairing && process.env.NODE_ENV === 'production' 
            ? Browsers.windows("Chrome") 
            : Browsers.macOS("Safari");

        const sock = makeWASocket({
            version,
            auth: state,
            logger: pino({ level: "silent" }),
            browser,
            connectTimeoutMs: 60000,
            defaultQueryTimeoutMs: 60000,
            keepAliveIntervalMs: 30000,
            retryRequestDelayMs: 1000,
            maxMsgRetryCount: 5,
            printQRInTerminal: false,
            syncFullHistory: false,
            shouldSyncHistoryMessage: () => false,
            getMessage: async () => undefined
        });
        return sock;
    }

    async generateQR(sessionId) {
        try {
            const maxSessions = parseInt(process.env.MAX_SESSIONS) || 100;
            if (this.activeSessions.size >= maxSessions) {
                throw new Error(`Maximum sessions limit reached (${maxSessions})`);
            }

            const sessionPath = path.join(this.sessionsDir, sessionId);
            await fs.ensureDir(sessionPath);

            const version = await this.checkVersion();
            const { state, saveCreds } = await useMultiFileAuthState(sessionPath);
            const sock = this.createSocket(state, version);

            return await this.handleQRConnection(sock, sessionId, saveCreds);
        } catch (error) {
            console.error('QR generation error:', error);
            throw error;
        }
    }

    async generatePairingCode(sessionId, phoneNumber) {
        try {
            const maxSessions = parseInt(process.env.MAX_SESSIONS) || 100;
            if (this.activeSessions.size >= maxSessions) {
                throw new Error(`Maximum sessions limit reached (${maxSessions})`);
            }

            // Clean phone number
            const cleanPhone = phoneNumber.replace(/[\s\-\(\)]/g, '');
            const formattedPhone = cleanPhone.startsWith('+') ? cleanPhone.slice(1) : cleanPhone;

            const sessionPath = path.join(this.sessionsDir, sessionId);
            await fs.ensureDir(sessionPath);

            const version = await this.checkVersion();
            const { state, saveCreds } = await useMultiFileAuthState(sessionPath);
            const sock = this.createSocket(state, version, true);

            return await this.handlePairingConnection(sock, sessionId, saveCreds, formattedPhone);
        } catch (error) {
            console.error('Pairing code generation error:', error);
            throw error;
        }
    }

    async handleQRConnection(sock, sessionId, saveCreds) {
        return new Promise((resolve, reject) => {
            let resolved = false;
            let connected = false;

            sock.ev.on('creds.update', saveCreds);

            sock.ev.on('connection.update', async (update) => {
                const { connection, lastDisconnect, qr } = update;

                if (qr && !resolved) {
                    try {
                        const qrCodeDataURL = await QRCode.toDataURL(qr);
                        this.io.to(sessionId).emit('qr-code', { qrCode: qrCodeDataURL });

                        if (!resolved) {
                            resolved = true;
                            resolve({ qrCode: qrCodeDataURL });
                        }
                    } catch (error) {
                        if (!resolved) {
                            resolved = true;
                            reject(error);
                        }
                    }
                }

                if (connection === 'open') {
                    console.log(`✅ QR connection opened for session: ${sessionId}`);
                    connected = true;
                    await this.handleSuccessfulConnection(sock, sessionId);
                } else if (connection === 'close') {
                    await this.handleConnectionClose(sessionId, lastDisconnect, connected, resolved, reject);
                }
            });

            this.storeActiveSession(sessionId, sock);
            this.setConnectionTimeout(sessionId, resolved, connected, reject, 90000);
        });
    }

    async handlePairingConnection(sock, sessionId, saveCreds, phoneNumber) {
        return new Promise(async (resolve, reject) => {
            let resolved = false;
            let connected = false;

            sock.ev.on('creds.update', saveCreds);

            // Wait longer in production for better stability
            const waitTime = process.env.NODE_ENV === 'production' ? 5000 : 3000;
            await new Promise(r => setTimeout(r, waitTime));

            try {
                if (!sock.authState.creds.registered) {
                    console.log(`� Requiesting pairing code for ${phoneNumber} in ${process.env.NODE_ENV || 'development'} mode`);
                    
                    // Add retry logic for production
                    let code;
                    let attempts = 0;
                    const maxAttempts = process.env.NODE_ENV === 'production' ? 3 : 1;
                    
                    while (attempts < maxAttempts) {
                        try {
                            code = await sock.requestPairingCode(phoneNumber);
                            console.log(`💬 Pairing code generated for ${sessionId}: ${code} (attempt ${attempts + 1})`);
                            break;
                        } catch (error) {
                            attempts++;
                            console.error(`❌ Pairing code attempt ${attempts} failed:`, error.message);
                            
                            if (attempts >= maxAttempts) {
                                throw error;
                            }
                            
                            // Wait before retry
                            await new Promise(r => setTimeout(r, 2000));
                        }
                    }

                    if (code) {
                        this.io.to(sessionId).emit('pairing-code', {
                            pairingCode: code,
                            phoneNumber: `+${phoneNumber}`
                        });

                        if (!resolved) {
                            resolved = true;
                            resolve({ pairingCode: code, phoneNumber: `+${phoneNumber}` });
                        }
                    }
                }
            } catch (error) {
                console.error(`❌ Pairing code generation failed for ${sessionId}:`, error);
                if (!resolved) {
                    resolved = true;
                    reject(error);
                }
                return;
            }

            sock.ev.on('connection.update', async ({ connection, lastDisconnect }) => {
                if (connection === 'open') {
                    console.log(`✅ Pairing connection opened for session: ${sessionId}`);
                    connected = true;



                    await this.handleSuccessfulConnection(sock, sessionId);
                } else if (connection === 'close') {
                    await this.handleConnectionClose(sessionId, lastDisconnect, connected, resolved, reject);
                }
            });

            this.storeActiveSession(sessionId, sock, true);
            this.setConnectionTimeout(sessionId, resolved, connected, reject, 120000);
        });
    }

    async handleSuccessfulConnection(sock, sessionId) {
        const customSessionId = `VINSMOKEm@${sessionId}`;

        try {
            const normalizedJid = jidNormalizedUser(sock.user.id);

            // Send session ID as disappearing message
            await sock.sendMessage(normalizedJid, {
                text: customSessionId
            }, {
                ephemeralExpiration: 86400
            });

            // Send session live message
            await sock.sendMessage(normalizedJid, {
                text: `🟢 Session is now live and ready to use!`
            });

            console.log(`📤 Messages sent to session: ${sessionId}`);

            this.io.to(sessionId).emit('session-connected', {
                sessionId: customSessionId,
                status: 'connected'
            });

            await this.trackSession(sessionId);
            this.activeSessions.delete(sessionId);

            // Disconnect after sending messages
            setTimeout(() => {
                try {
                    sock.end();
                    console.log(`🔌 Disconnected session: ${sessionId}`);
                } catch (error) {
                    console.log('Socket already closed');
                }
            }, 2000);

        } catch (error) {
            console.error('Error sending messages:', error);
        }
    }

    async handleConnectionClose(sessionId, lastDisconnect, connected, resolved, reject) {
        const reason = lastDisconnect?.error?.output?.statusCode;
        console.log(`❌ Connection closed for session: ${sessionId}, reason: ${reason}`);

        if (connected) {
            console.log(`✅ Session ${sessionId} completed successfully`);
            return;
        }

        // Clean up session if logged out
        if (reason === DisconnectReason.loggedOut) {
            await this.cleanupSession(sessionId);
            if (!resolved) {
                this.activeSessions.delete(sessionId);
                reject(new Error('Session logged out'));
            }
            return;
        }

        // Simple reconnect logic like the script - just restart the connection
        console.log(`🔄 Reconnecting session: ${sessionId}...`);
        await new Promise(r => setTimeout(r, 2000));

        try {
            const sessionData = this.activeSessions.get(sessionId);
            if (sessionData) {
                if (sessionData.isPairing) {
                    // Restart pairing connection
                    await this.restartPairingConnection(sessionId);
                } else {
                    // Restart QR connection
                    await this.restartQRConnection(sessionId);
                }
            }
        } catch (error) {
            console.error('Reconnection failed:', error);
            if (!resolved) {
                this.activeSessions.delete(sessionId);
                reject(error);
            }
        }
    }

    storeActiveSession(sessionId, sock, isPairing = false) {
        this.activeSessions.set(sessionId, {
            socket: sock,
            createdAt: Date.now(),
            sessionPath: path.join(this.sessionsDir, sessionId),
            isPairing
        });
    }

    async restartQRConnection(sessionId) {
        const sessionData = this.activeSessions.get(sessionId);
        if (!sessionData) return;

        const version = await this.checkVersion();
        const { state, saveCreds } = await useMultiFileAuthState(sessionData.sessionPath);
        const sock = this.createSocket(state, version);

        // Update socket reference
        sessionData.socket = sock;
        this.activeSessions.set(sessionId, sessionData);

        // Handle connection events
        sock.ev.on('creds.update', saveCreds);

        sock.ev.on('connection.update', async (update) => {
            const { connection, lastDisconnect, qr } = update;

            if (qr) {
                try {
                    const qrCodeDataURL = await QRCode.toDataURL(qr);
                    this.io.to(sessionId).emit('qr-code', { qrCode: qrCodeDataURL });
                    console.log(`📱 New QR code generated for reconnection: ${sessionId}`);
                } catch (error) {
                    console.error('QR generation error on reconnect:', error);
                }
            }

            if (connection === 'open') {
                console.log(`✅ QR reconnection successful for session: ${sessionId}`);
                await this.handleSuccessfulConnection(sock, sessionId);
            } else if (connection === 'close') {
                await this.handleConnectionClose(sessionId, lastDisconnect, true, false, () => { });
            }
        });
    }

    async restartPairingConnection(sessionId) {
        const sessionData = this.activeSessions.get(sessionId);
        if (!sessionData) return;

        const version = await this.checkVersion();
        const { state, saveCreds } = await useMultiFileAuthState(sessionData.sessionPath);
        const sock = this.createSocket(state, version);

        // Update socket reference
        sessionData.socket = sock;
        this.activeSessions.set(sessionId, sessionData);

        // Handle connection events
        sock.ev.on('creds.update', saveCreds);

        sock.ev.on('connection.update', async ({ connection, lastDisconnect }) => {
            if (connection === 'open') {
                console.log(`✅ Pairing reconnection successful for session: ${sessionId}`);



                await this.handleSuccessfulConnection(sock, sessionId);
            } else if (connection === 'close') {
                await this.handleConnectionClose(sessionId, lastDisconnect, true, false, () => { });
            }
        });
    }

    setConnectionTimeout(sessionId, resolved, connected, reject, timeout) {
        setTimeout(() => {
            if (!resolved && !connected) {
                this.activeSessions.delete(sessionId);
                reject(new Error('Connection timeout'));
            }
        }, timeout);
    }

    async trackSession(sessionId) {
        try {
            const tracking = await fs.readJson(this.sessionTrackingFile);
            const sessionData = {
                sessionId,
                createdAt: new Date().toISOString(),
                expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
            };

            tracking.sessions.push(sessionData);
            await fs.writeJson(this.sessionTrackingFile, tracking, { spaces: 2 });
            console.log(`📝 Session tracked: ${sessionId}`);
        } catch (error) {
            console.error('Error tracking session:', error);
        }
    }

    async cleanupSession(sessionId) {
        try {
            const sessionPath = path.join(this.sessionsDir, sessionId);
            if (await fs.pathExists(sessionPath)) {
                await fs.remove(sessionPath);
            }
            await this.removeSessionTracking(sessionId);
        } catch (error) {
            console.error('Error cleaning up session:', error);
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

    async stopSession(sessionId) {
        try {
            console.log(`🛑 Stopping session: ${sessionId}`);

            const sessionData = this.activeSessions.get(sessionId);
            if (sessionData && sessionData.socket) {
                try {
                    await sessionData.socket.logout();
                } catch (error) {
                    sessionData.socket.end();
                }
            }

            this.activeSessions.delete(sessionId);
            await this.cleanupSession(sessionId);

            console.log(`✅ Session stopped: ${sessionId}`);
            return { success: true };
        } catch (error) {
            console.error('Stop session error:', error);
            this.activeSessions.delete(sessionId);
            throw error;
        }
    }

    startCleanupTimer() {
        // Cleanup expired sessions every hour
        setInterval(() => {
            this.cleanupExpiredSessions();
        }, 60 * 60 * 1000);

        // Cleanup unscanned sessions every 5 minutes
        setInterval(() => {
            this.cleanupUnscannedSessions();
        }, 5 * 60 * 1000);

        // Cleanup bad sessions every 30 minutes
        setInterval(() => {
            this.cleanupBadSessions();
        }, 30 * 60 * 1000);

        // Sync session data every 15 minutes
        setInterval(() => {
            this.syncSessionData();
        }, 15 * 60 * 1000);

        // Initial cleanup after 30 seconds
        setTimeout(() => {
            this.syncSessionData();
            this.cleanupBadSessions();
        }, 30000);
    }

    async cleanupExpiredSessions() {
        try {
            const tracking = await fs.readJson(this.sessionTrackingFile);
            const now = new Date();
            const validSessions = [];

            for (const session of tracking.sessions) {
                if (new Date(session.expiresAt) <= now) {
                    await this.cleanupSession(session.sessionId);
                    console.log(`🗑️ Deleted expired session: ${session.sessionId}`);
                } else {
                    validSessions.push(session);
                }
            }

            tracking.sessions = validSessions;
            await fs.writeJson(this.sessionTrackingFile, tracking, { spaces: 2 });
        } catch (error) {
            console.error('Error cleaning up expired sessions:', error);
        }
    }

    async cleanupUnscannedSessions() {
        try {
            const now = Date.now();
            const maxAge = 10 * 60 * 1000; // 10 minutes

            for (const [sessionId, sessionData] of this.activeSessions.entries()) {
                const age = now - sessionData.createdAt;

                if (age > maxAge && !sessionData.connected) {
                    console.log(`🧹 Cleaning up unscanned session: ${sessionId}`);
                    await this.stopSession(sessionId);
                }
            }
        } catch (error) {
            console.error('Unscanned session cleanup error:', error);
        }
    }

    async cleanupBadSessions() {
        try {
            console.log('🔍 Scanning for bad session folders...');
            
            if (!(await fs.pathExists(this.sessionsDir))) {
                return;
            }

            const sessionDirs = await fs.readdir(this.sessionsDir);
            let badSessionsCount = 0;

            for (const dirName of sessionDirs) {
                const sessionPath = path.join(this.sessionsDir, dirName);
                const stat = await fs.stat(sessionPath);

                if (stat.isDirectory()) {
                    const isGoodSession = await this.isGoodSession(sessionPath);
                    
                    if (!isGoodSession) {
                        console.log(`🗑️ Removing bad session folder: ${dirName}`);
                        await fs.remove(sessionPath);
                        await this.removeSessionTracking(dirName);
                        badSessionsCount++;
                    }
                }
            }

            if (badSessionsCount > 0) {
                console.log(`✅ Cleaned up ${badSessionsCount} bad session folders`);
            }
        } catch (error) {
            console.error('Bad session cleanup error:', error);
        }
    }

    async isGoodSession(sessionPath) {
        try {
            const files = await fs.readdir(sessionPath);
            
            // Check if creds.json exists
            const hasCredsFile = files.includes('creds.json');
            if (!hasCredsFile) {
                return false; // No creds file = bad session
            }

            // Good session must have creds.json + at least one other file
            const otherFiles = files.filter(file => file !== 'creds.json');
            return otherFiles.length > 0;
        } catch (error) {
            console.error('Error checking session validity:', error);
            return false; // If we can't read it, consider it bad
        }
    }

    async syncSessionData() {
        try {
            console.log('🔄 Syncing session data with filesystem...');

            // Get current tracking data
            const tracking = await fs.readJson(this.sessionTrackingFile);
            const validSessions = [];
            let orphanedCount = 0;
            let missingCount = 0;

            // Check each tracked session against filesystem
            for (const session of tracking.sessions) {
                const sessionPath = path.join(this.sessionsDir, session.sessionId);
                
                if (await fs.pathExists(sessionPath)) {
                    // Check if it's a good session
                    const isGood = await this.isGoodSession(sessionPath);
                    if (isGood) {
                        validSessions.push(session);
                    } else {
                        console.log(`🗑️ Removing bad session from tracking: ${session.sessionId}`);
                        await fs.remove(sessionPath);
                        orphanedCount++;
                    }
                } else {
                    orphanedCount++;
                    console.log(`🗑️ Removing orphaned entry: ${session.sessionId} (folder missing)`);
                }
            }

            // Check for untracked session folders
            if (await fs.pathExists(this.sessionsDir)) {
                const sessionDirs = await fs.readdir(this.sessionsDir);
                const trackedIds = new Set(validSessions.map(s => s.sessionId));

                for (const dirName of sessionDirs) {
                    const dirPath = path.join(this.sessionsDir, dirName);
                    const stat = await fs.stat(dirPath);

                    if (stat.isDirectory() && !trackedIds.has(dirName)) {
                        const isGood = await this.isGoodSession(dirPath);
                        
                        if (isGood) {
                            // Add missing good session to tracking
                            const sessionData = {
                                sessionId: dirName,
                                createdAt: stat.birthtime.toISOString(),
                                expiresAt: new Date(stat.birthtime.getTime() + 24 * 60 * 60 * 1000).toISOString()
                            };
                            validSessions.push(sessionData);
                            missingCount++;
                            console.log(`📝 Added missing session to tracking: ${dirName}`);
                        } else {
                            // Remove bad untracked session
                            console.log(`🗑️ Removing untracked bad session: ${dirName}`);
                            await fs.remove(dirPath);
                        }
                    }
                }
            }

            // Update tracking file if changes were made
            if (orphanedCount > 0 || missingCount > 0) {
                tracking.sessions = validSessions;
                await fs.writeJson(this.sessionTrackingFile, tracking, { spaces: 2 });
            }

            console.log(`✅ Session sync complete: removed ${orphanedCount} orphaned entries, added ${missingCount} missing sessions`);
            return { orphanedCount, missingCount };
        } catch (error) {
            console.error('Error syncing session data:', error);
            return { orphanedCount: 0, missingCount: 0 };
        }
    }

    // Session file management methods
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

    async getAllSessions() {
        try {
            const tracking = await fs.readJson(this.sessionTrackingFile);
            return tracking.sessions;
        } catch (error) {
            console.error('Get all sessions error:', error);
            return [];
        }
    }

    async getAllSessionFiles(sessionId) {
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
                    const buffer = await fs.readFile(filePath);
                    files.push({
                        name: fileName,
                        size: stats.size,
                        modified: stats.mtime,
                        content: buffer.toString('base64'),
                        downloadUrl: `/api/session/${sessionId}/file/${encodeURIComponent(fileName)}`
                    });
                }
            }

            return {
                sessionId,
                totalFiles: files.length,
                files
            };
        } catch (error) {
            console.error('Get all session files error:', error);
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

    async downloadAllSessionFiles(sessionId) {
        try {
            const sessionPath = path.join(this.sessionsDir, sessionId);

            if (!(await fs.pathExists(sessionPath))) {
                return null;
            }

            const archiver = require('archiver');
            const archive = archiver('zip', { zlib: { level: 9 } });

            const fileList = await fs.readdir(sessionPath);
            const files = [];

            for (const fileName of fileList) {
                const filePath = path.join(sessionPath, fileName);
                const stats = await fs.stat(filePath);

                if (stats.isFile()) {
                    archive.file(filePath, { name: fileName });
                    files.push({
                        name: fileName,
                        size: stats.size,
                        modified: stats.mtime
                    });
                }
            }

            return {
                archive,
                files,
                sessionId
            };
        } catch (error) {
            console.error('Download all session files error:', error);
            throw error;
        }
    }
}

module.exports = WhatsAppService;