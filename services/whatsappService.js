import {
    default as makeWASocket,
    DisconnectReason,
    useMultiFileAuthState,
    fetchLatestBaileysVersion,
    Browsers,
    jidNormalizedUser
} from '@whiskeysockets/baileys';
import QRCode from 'qrcode';
import fs from 'fs-extra';
import path from 'path';
import pino from 'pino';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Clean logging system with colors and timestamps
const getTimestamp = () => new Date().toTimeString().split(' ')[0] + '.' + new Date().getMilliseconds().toString().padStart(3, '0');

const log = {
    info: (msg, data = '') => console.log(`\x1b[90m${getTimestamp()}\x1b[0m \x1b[36m[INFO]\x1b[0m ${msg}${data ? ` \x1b[90m${data}\x1b[0m` : ''}`),
    success: (msg, data = '') => console.log(`\x1b[90m${getTimestamp()}\x1b[0m \x1b[32m[SUCCESS]\x1b[0m ${msg}${data ? ` \x1b[90m${data}\x1b[0m` : ''}`),
    warn: (msg, data = '') => console.log(`\x1b[90m${getTimestamp()}\x1b[0m \x1b[33m[WARN]\x1b[0m ${msg}${data ? ` \x1b[90m${data}\x1b[0m` : ''}`),
    error: (msg, data = '') => console.log(`\x1b[90m${getTimestamp()}\x1b[0m \x1b[31m[ERROR]\x1b[0m ${msg}${data ? ` \x1b[90m${data}\x1b[0m` : ''}`),
    debug: (msg, data = '') => console.log(`\x1b[90m${getTimestamp()}\x1b[0m \x1b[35m[DEBUG]\x1b[0m ${msg}${data ? ` \x1b[90m${data}\x1b[0m` : ''}`)
};

class WhatsAppService {
    constructor(io) {
        this.io = io;
        this.sessionsDir = path.join(__dirname, '../sessions');
        this.sessionTrackingFile = path.join(__dirname, '../data/session-tracking.json');
        this.activeSessions = new Map();
        this.initialized = false;
        this.initPromise = this.initialize();
        
        // Configurable startup message
        this.startUpMessage = '🟢 Session is now live and ready to use!';
    }

    async initialize() {
        try {
            await this.ensureDirectories();
            this.startCleanupTimer();
            this.initialized = true;
            log.success('WhatsApp Service ready');
        } catch (error) {
            log.error('Service init failed:', error.message);
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
        const { version } = await fetchLatestBaileysVersion();
        return version;
    }

    createSocket(state, version, isPairing = false) {
        // Use different browser configurations for QR vs Pairing
        const browser = isPairing 
            ? Browsers.macOS('Safari')  // Official helper for pairing mode
            : ["manji", "Safari", "15.0"];  // Custom for QR mode

        const sock = makeWASocket({
            version,
            auth: state,
            logger: pino({ level: "silent" }),
            browser,
            connectTimeoutMs: 60000,
            defaultQueryTimeoutMs: 60000,
            keepAliveIntervalMs: 10000,
            retryRequestDelayMs: 250,
            maxMsgRetryCount: 3,
            printQRInTerminal: false,
            syncFullHistory: false,  // Disable history sync for performance
            shouldSyncHistoryMessage: () => false,  // Disable history sync
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

            // Ensure VINSMOKE@ prefix
            const fullSessionId = sessionId.startsWith('VINSMOKE@') ? sessionId : `VINSMOKE@${sessionId}`;
            const sessionPath = path.join(this.sessionsDir, fullSessionId);
            await fs.ensureDir(sessionPath);

            log.debug(`QR: ${fullSessionId}`);
            const version = await this.checkVersion();
            const { state, saveCreds } = await useMultiFileAuthState(sessionPath);
            const sock = this.createSocket(state, version);

            return await this.handleQRConnection(sock, fullSessionId, saveCreds);
        } catch (error) {
            log.error('QR generation error:', error.message);
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

            // Ensure VINSMOKE@ prefix
            const fullSessionId = sessionId.startsWith('VINSMOKE@') ? sessionId : `VINSMOKE@${sessionId}`;
            const sessionPath = path.join(this.sessionsDir, fullSessionId);
            await fs.ensureDir(sessionPath);

            log.debug(`Pairing: ${fullSessionId}`);
            const version = await this.checkVersion();
            const { state, saveCreds } = await useMultiFileAuthState(sessionPath);
            const sock = this.createSocket(state, version, true);

            return await this.handlePairingConnection(sock, fullSessionId, saveCreds, formattedPhone);
        } catch (error) {
            log.error('Pairing code generation error:', error.message);
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
                    log.success(`QR: ${sessionId}`);
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

            // Wait for socket to be fully ready before requesting pairing code
            await new Promise(r => setTimeout(r, 8000)); // 8 second delay for stability

            try {
                if (!sock.authState.creds.registered) {
                    log.info(`Pairing: +${phoneNumber}`);

                    // Retry logic with proper delays
                    let code;
                    let attempts = 0;
                    const maxAttempts = 3;

                    while (attempts < maxAttempts) {
                        try {
                            code = await sock.requestPairingCode(phoneNumber);
                            log.success(`Code: ${code}`);
                            break;
                        } catch (error) {
                            attempts++;
                            log.error(`Attempt ${attempts}:`, error.message);

                            if (attempts >= maxAttempts) {
                                throw error;
                            }

                            // Wait 3 seconds before retry for rate limit prevention
                            await new Promise(r => setTimeout(r, 3000));
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
                } else {
                    log.warn('Device registered');
                }
            } catch (error) {
                log.error(`Pairing failed: ${error.message}`);
                if (!resolved) {
                    resolved = true;
                    reject(error);
                }
                return;
            }

            sock.ev.on('connection.update', async ({ connection, lastDisconnect }) => {
                if (connection === 'open') {
                    log.success(`Pairing: ${sessionId}`);
                    connected = true;
                    await this.handleSuccessfulConnection(sock, sessionId);
                } else if (connection === 'close') {
                    await this.handleConnectionClose(sessionId, lastDisconnect, connected, resolved, reject);
                }
            });

            this.storeActiveSession(sessionId, sock, true);
            this.setConnectionTimeout(sessionId, resolved, connected, reject, 180000); // 3 minutes timeout for pairing
        });
    }

    async handleSuccessfulConnection(sock, sessionId) {
        const fullSessionId = sessionId.startsWith('VINSMOKE@') ? sessionId : `VINSMOKE@${sessionId}`;

        try {
            const normalizedJid = jidNormalizedUser(sock.user.id);
            const user = sock.user || {};
            const name = user.name || user.verifiedName || (user.id || '').split(':')[0] || 'User';
            
            log.success(`Connected: ${name}`);

            // Send session ID as disappearing message
            await sock.sendMessage(normalizedJid, {
                text: fullSessionId
            }, {
                ephemeralExpiration: 86400
            });

            // Send configurable startup message
            await sock.sendMessage(normalizedJid, {
                text: this.startUpMessage
            });

            this.io.to(sessionId).emit('session-connected', {
                sessionId: fullSessionId,
                status: 'connected'
            });

            // Mark session as good and track it
            await this.markSessionAsGood(fullSessionId);
            await this.trackSession(sessionId);
            
            // Clean up non-essential files but keep creds.json
            await this.cleanupNonEssentialFiles(fullSessionId);
            
            this.activeSessions.delete(sessionId);

            // Disconnect after sending messages
            setTimeout(() => {
                try {
                    sock.end();
                } catch (error) {
                    // Silent fail
                }
            }, 2000);

        } catch (error) {
            log.error('Error sending messages:', error.message);
        }
    }

    async cleanupNonEssentialFiles(sessionId) {
        try {
            const sessionPath = path.join(this.sessionsDir, sessionId);
            if (!(await fs.pathExists(sessionPath))) return;

            const files = await fs.readdir(sessionPath);
            let deletedCount = 0;
            
            // Keep only creds.json, remove ALL other files
            for (const file of files) {
                if (file !== 'creds.json') {
                    const filePath = path.join(sessionPath, file);
                    try {
                        await fs.remove(filePath);
                        deletedCount++;
                    } catch (error) {
                        // Silent fail for file deletion
                    }
                }
            }
            
            if (deletedCount > 0) {
                log.debug(`Cleaned: ${sessionId}`);
            }
        } catch (error) {
            // Silent fail for cleanup errors
        }
    }

    async handleConnectionClose(sessionId, lastDisconnect, connected, resolved, reject) {
        const reason = lastDisconnect?.error?.output?.statusCode;

        if (connected) {
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

        // Simple reconnect logic
        await new Promise(r => setTimeout(r, 2000));

        try {
            const sessionData = this.activeSessions.get(sessionId);
            if (sessionData) {
                if (sessionData.isPairing) {
                    await this.restartPairingConnection(sessionId);
                } else {
                    await this.restartQRConnection(sessionId);
                }
            }
        } catch (error) {
            log.error('Reconnection failed:', error.message);
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

        sessionData.socket = sock;
        this.activeSessions.set(sessionId, sessionData);

        sock.ev.on('creds.update', saveCreds);

        sock.ev.on('connection.update', async (update) => {
            const { connection, lastDisconnect, qr } = update;

            if (qr) {
                try {
                    const qrCodeDataURL = await QRCode.toDataURL(qr);
                    this.io.to(sessionId).emit('qr-code', { qrCode: qrCodeDataURL });
                } catch (error) {
                    log.error('QR generation error:', error.message);
                }
            }

            if (connection === 'open') {
                log.success(`QR reconnect: ${sessionId}`);
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
        const sock = this.createSocket(state, version, true); // Pass true for pairing mode

        sessionData.socket = sock;
        this.activeSessions.set(sessionId, sessionData);

        sock.ev.on('creds.update', saveCreds);

        sock.ev.on('connection.update', async ({ connection, lastDisconnect }) => {
            if (connection === 'open') {
                log.success(`Pairing reconnect: ${sessionId}`);
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
                expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(), // 30 days expiry
                isPermanent: true // Mark as permanent to prevent deletion
            };

            tracking.sessions.push(sessionData);
            await fs.writeJson(this.sessionTrackingFile, tracking, { spaces: 2 });
        } catch (error) {
            log.error('Error tracking session:', error.message);
        }
    }

    async markSessionAsGood(sessionId) {
        try {
            const tracking = await fs.readJson(this.sessionTrackingFile);
            const session = tracking.sessions.find(s => s.sessionId === sessionId);

            if (session) {
                session.isGood = true;
                session.isPermanent = true;
                session.connectedAt = new Date().toISOString();
                await fs.writeJson(this.sessionTrackingFile, tracking, { spaces: 2 });
            }
        } catch (error) {
            log.error('Error marking session as good:', error.message);
        }
    }

    async evaluateSessionQuality(sessionId) {
        try {
            const sessionPath = path.join(this.sessionsDir, sessionId);

            if (!(await fs.pathExists(sessionPath))) {
                return { isGood: false, fileCount: 0, reason: 'Session folder not found' };
            }

            const files = await fs.readdir(sessionPath);
            const hasCredsJson = files.includes('creds.json');
            
            if (!hasCredsJson) {
                return { isGood: false, fileCount: files.length, reason: 'No creds.json found' };
            }

            // Check if creds.json is valid
            try {
                const credsPath = path.join(sessionPath, 'creds.json');
                const creds = await fs.readJson(credsPath);
                const isValid = !!(creds.me && creds.me.id);
                
                // If session is good, clean up other files immediately
                if (isValid && files.length > 1) {
                    await this.cleanupNonEssentialFiles(sessionId);
                }
                
                return {
                    isGood: isValid,
                    fileCount: isValid ? 1 : files.length, // Report 1 if good (only creds.json should remain)
                    reason: isValid ? 'Valid creds.json found' : 'Invalid creds.json'
                };
            } catch {
                return { isGood: false, fileCount: files.length, reason: 'Corrupted creds.json' };
            }

        } catch (error) {
            log.error('Error evaluating session quality:', error.message);
            return { isGood: false, fileCount: 0, reason: 'Evaluation error' };
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
            log.error('Error cleaning up session:', error.message);
        }
    }

    async removeSessionTracking(sessionId) {
        try {
            const tracking = await fs.readJson(this.sessionTrackingFile);
            tracking.sessions = tracking.sessions.filter(s => s.sessionId !== sessionId);
            await fs.writeJson(this.sessionTrackingFile, tracking, { spaces: 2 });
        } catch (error) {
            log.error('Error removing session tracking:', error.message);
        }
    }

    async stopSession(sessionId) {
        try {
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

            return { success: true };
        } catch (error) {
            log.error('Stop session error:', error.message);
            this.activeSessions.delete(sessionId);
            throw error;
        }
    }

    startCleanupTimer() {
        // Only cleanup bad sessions, keep good ones permanently
        setInterval(() => {
            this.cleanupBadSessions();
        }, 30 * 60 * 1000); // Every 30 minutes

        // Cleanup unscanned sessions every 5 minutes
        setInterval(() => {
            this.cleanupUnscannedSessions();
        }, 5 * 60 * 1000);

        // Initial cleanup after 30 seconds
        setTimeout(() => {
            this.cleanupBadSessions();
        }, 30000);
    }

    async cleanupBadSessions() {
        try {
            if (!(await fs.pathExists(this.sessionsDir))) {
                return;
            }

            const tracking = await fs.readJson(this.sessionTrackingFile);
            const sessionDirs = await fs.readdir(this.sessionsDir);
            let badSessionsCount = 0;
            const now = new Date();

            for (const dirName of sessionDirs) {
                const sessionPath = path.join(this.sessionsDir, dirName);
                const stat = await fs.stat(sessionPath);

                if (stat.isDirectory()) {
                    // Check if session is tracked and marked as permanent
                    const trackedSession = tracking.sessions.find(s => s.sessionId === dirName);
                    
                    if (trackedSession && trackedSession.isPermanent) {
                        // Even permanent sessions should only have creds.json
                        await this.cleanupNonEssentialFiles(dirName);
                        continue;
                    }

                    // Evaluate session quality
                    const sessionStatus = await this.evaluateSessionQuality(dirName);

                    // Check session age
                    const sessionAge = trackedSession ?
                        (now - new Date(trackedSession.createdAt)) :
                        (now - stat.birthtime);
                    const minAge = 30 * 60 * 1000; // 30 minutes minimum before cleanup

                    // Only delete if session is bad AND old AND not permanent
                    const shouldDelete = !sessionStatus.isGood &&
                        sessionAge > minAge &&
                        (!trackedSession || !trackedSession.isPermanent);

                    if (shouldDelete) {
                        await fs.remove(sessionPath);
                        await this.removeSessionTracking(dirName);
                        badSessionsCount++;
                    } else if (sessionStatus.isGood && !trackedSession?.isPermanent) {
                        // Mark good sessions as permanent and clean up files
                        await this.markSessionAsGood(dirName);
                        await this.cleanupNonEssentialFiles(dirName);
                    }
                }
            }

            if (badSessionsCount > 0) {
                log.debug(`Cleaned ${badSessionsCount} sessions`);
            }
        } catch (error) {
            log.error('Bad session cleanup error:', error.message);
        }
    }

    async cleanupUnscannedSessions() {
        try {
            const now = Date.now();
            const maxAge = 10 * 60 * 1000; // 10 minutes

            for (const [sessionId, sessionData] of this.activeSessions.entries()) {
                const age = now - sessionData.createdAt;

                if (age > maxAge && !sessionData.connected) {
                    await this.stopSession(sessionId);
                }
            }
        } catch (error) {
            log.error('Cleanup error:', error.message);
        }
    }

    // Session file management methods (keeping existing functionality)
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
            log.error('Get session files error:', error.message);
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
            log.error('Get session file error:', error.message);
            throw error;
        }
    }

    async getAllSessions() {
        try {
            const tracking = await fs.readJson(this.sessionTrackingFile);
            return tracking.sessions;
        } catch (error) {
            log.error('Get all sessions error:', error.message);
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
            log.error('Get all session files error:', error.message);
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
            log.error('Get session file list error:', error.message);
            throw error;
        }
    }

    async downloadAllSessionFiles(sessionId) {
        try {
            const sessionPath = path.join(this.sessionsDir, sessionId);

            if (!(await fs.pathExists(sessionPath))) {
                return null;
            }

            const archiver = (await import('archiver')).default;
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
            log.error('Download all session files error:', error.message);
            throw error;
        }
    }
}

export default WhatsAppService;