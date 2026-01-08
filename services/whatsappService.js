/**
 * WhatsApp Service - Production Optimized
 * 
 * Key Features:
 * - Only stores creds.json for successful connections
 * - Aggressive cleanup of failed/incomplete sessions  
 * - Messages must be sent successfully before session is marked as good
 * - Automatic cleanup every 2 minutes for bad sessions
 * - Only permanent, good sessions are retained
 * - File downloads restricted to creds.json only for security
 */

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


const WELCOME_MSG = [
    'Welcome to Vinsmoke Bot!',
    'Thanks for adding me 🤍',
    '~----------------------------------~',
    'I’m still working on it and improving, so you might run into a bug or two. If you do, just report it on my community or contact me and I’ll squash it quickly.',
    '',
    '*Community*',
    'https://t.me/+ajJtuJa1wVxmOTRl',
    '',
    '*Need help?*',
    '• Check the FAQ: https://vinsmoke-ten.vercel.app/faq',
    '• Having deployment or other issues? Ask in the community, happy to help.',
    '',
    '*For developers*',
    'You can easily create custom commands using plugins.',
    '• Plugin guide: https://github.com/manjisama1/vinsmoke/blob/main/plugins/z-guide.md',
    '',
    'Want to share or try plugins from others?',
    'Upload them here: https://vinsmoke-ten.vercel.app/plugins',
    '~----------------------------------~',
    'Tip: developer or not, you can copy the whole guide into Gemini and ask what command you need (just don’t ask it to make GTA-5).',
    '',
    'enjoy !'
].join('\n');


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
        this.startUpMessage = WELCOME_MSG;
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

            log.success(`Messages sent: ${fullSessionId}`);

            // Only after successful message sending, mark as good session
            await this.markSessionAsGoodSession(fullSessionId);
            
            this.io.to(sessionId).emit('session-connected', {
                sessionId: fullSessionId,
                status: 'connected'
            });
            
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
            log.error('Message send failed:', error.message);
            // Mark session as BAD and clean up
            await this.markSessionAsBad(fullSessionId, 'Failed to send welcome messages');
            await this.cleanupFailedSession(fullSessionId);
            throw error;
        }
    }

    async markSessionAsGoodSession(sessionId) {
        try {
            // First, clean up all files except creds.json
            await this.keepOnlyCredsFile(sessionId);
            
            // Extract user phone number from creds.json
            const sessionPath = path.join(this.sessionsDir, sessionId);
            const credsPath = path.join(sessionPath, 'creds.json');
            let userPhoneNumber = null;
            
            try {
                const creds = await fs.readJson(credsPath);
                if (creds.me && creds.me.id) {
                    // Extract phone number from WhatsApp ID (format: "994403163701:XX@s.whatsapp.net")
                    userPhoneNumber = creds.me.id.split(':')[0];
                }
            } catch (error) {
                log.warn('Could not extract phone number:', error.message);
            }
            
            // Update session tracking - mark as GOOD session
            const tracking = await fs.readJson(this.sessionTrackingFile);
            
            // Remove any existing entry for this session
            tracking.sessions = tracking.sessions.filter(s => s.sessionId !== sessionId);
            
            // Add new GOOD session entry
            const sessionData = {
                sessionId,
                userPhoneNumber,
                createdAt: new Date().toISOString(),
                connectedAt: new Date().toISOString(),
                expiresAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString(), // 1 year
                isPermanent: true,
                isGood: true, // GOOD SESSION - successfully sent messages
                status: 'active'
            };

            tracking.sessions.push(sessionData);
            await fs.writeJson(this.sessionTrackingFile, tracking, { spaces: 2 });
            
            log.success(`Session stored: ${sessionId}${userPhoneNumber ? ` (${userPhoneNumber})` : ''}`);
        } catch (error) {
            log.error('Error marking session as good:', error.message);
            throw error;
        }
    }

    async keepOnlyCredsFile(sessionId) {
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
                        log.warn(`Failed to delete ${file}:`, error.message);
                    }
                }
            }
            
            // Verify creds.json exists and is valid
            const credsPath = path.join(sessionPath, 'creds.json');
            if (!(await fs.pathExists(credsPath))) {
                throw new Error('creds.json not found after cleanup');
            }

            // Validate creds.json content
            const creds = await fs.readJson(credsPath);
            if (!creds.me || !creds.me.id) {
                throw new Error('Invalid creds.json content');
            }
            
            if (deletedCount > 0) {
                log.debug(`Cleaned ${deletedCount} files from: ${sessionId}`);
            }
        } catch (error) {
            log.error('Cleanup failed:', error.message);
            throw error;
        }
    }

    async cleanupFailedSession(sessionId) {
        try {
            const sessionPath = path.join(this.sessionsDir, sessionId);
            if (await fs.pathExists(sessionPath)) {
                await fs.remove(sessionPath);
                log.debug(`Removed bad session: ${sessionId}`);
            }
            await this.removeSessionFromTracking(sessionId);
        } catch (error) {
            log.error('Failed session cleanup error:', error.message);
        }
    }

    async markSessionAsBad(sessionId, reason = 'Failed to send messages') {
        try {
            // Mark session as BAD in tracking
            const tracking = await fs.readJson(this.sessionTrackingFile);
            const sessionIndex = tracking.sessions.findIndex(s => s.sessionId === sessionId);
            
            if (sessionIndex !== -1) {
                tracking.sessions[sessionIndex].isGood = false;
                tracking.sessions[sessionIndex].isPermanent = false;
                tracking.sessions[sessionIndex].status = 'failed';
                tracking.sessions[sessionIndex].failureReason = reason;
                tracking.sessions[sessionIndex].failedAt = new Date().toISOString();
                
                await fs.writeJson(this.sessionTrackingFile, tracking, { spaces: 2 });
            }
            
            log.debug(`Marked session as bad: ${sessionId} - ${reason}`);
        } catch (error) {
            log.error('Error marking session as bad:', error.message);
        }
    }

    async handleConnectionClose(sessionId, lastDisconnect, connected, resolved, reject) {
        const reason = lastDisconnect?.error?.output?.statusCode;

        if (connected) {
            return;
        }

        // Clean up session if logged out or bad session
        if (reason === DisconnectReason.loggedOut) {
            await this.cleanupFailedSession(sessionId);
            if (!resolved) {
                this.activeSessions.delete(sessionId);
                reject(new Error('Session logged out'));
            }
            return;
        }

        // For other disconnection reasons, try simple reconnect
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
            await this.cleanupFailedSession(sessionId);
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

    async removeSessionFromTracking(sessionId) {
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
            // Ensure VINSMOKE@ prefix
            const fullSessionId = sessionId.startsWith('VINSMOKE@') ? sessionId : `VINSMOKE@${sessionId}`;
            
            // Check if this is a good session before stopping
            const tracking = await fs.readJson(this.sessionTrackingFile);
            const session = tracking.sessions.find(s => s.sessionId === fullSessionId);
            
            // Protect good sessions from accidental deletion
            if (session && session.isGood && session.isPermanent) {
                return { 
                    success: false, 
                    error: 'Cannot delete good session - this session is protected',
                    isGoodSession: true 
                };
            }

            const sessionData = this.activeSessions.get(fullSessionId);
            if (sessionData && sessionData.socket) {
                try {
                    await sessionData.socket.logout();
                } catch (error) {
                    sessionData.socket.end();
                }
            }

            this.activeSessions.delete(fullSessionId);
            await this.cleanupFailedSession(fullSessionId);

            return { success: true };
        } catch (error) {
            log.error('Stop session error:', error.message);
            this.activeSessions.delete(sessionId);
            throw error;
        }
    }

    async stopSessionSafely(sessionId, isAdminRequest = false) {
        try {
            // Ensure VINSMOKE@ prefix
            const fullSessionId = sessionId.startsWith('VINSMOKE@') ? sessionId : `VINSMOKE@${sessionId}`;
            
            // Check if session is tracked as good/permanent
            const tracking = await fs.readJson(this.sessionTrackingFile);
            const session = tracking.sessions.find(s => s.sessionId === fullSessionId);
            
            // If it's a good session and not an admin request, protect it
            if (session && session.isGood && session.isPermanent && !isAdminRequest) {
                return {
                    success: false,
                    isGoodSession: true,
                    error: 'Cannot delete good session - this session is protected because it successfully sent messages'
                };
            }
            
            // For admin requests or non-good sessions, proceed with deletion
            const sessionData = this.activeSessions.get(fullSessionId);
            if (sessionData && sessionData.socket) {
                try {
                    await sessionData.socket.logout();
                } catch (error) {
                    sessionData.socket.end();
                }
            }

            this.activeSessions.delete(fullSessionId);
            
            // Remove session files and tracking
            const sessionPath = path.join(this.sessionsDir, fullSessionId);
            if (await fs.pathExists(sessionPath)) {
                await fs.remove(sessionPath);
                log.debug(`Removed session: ${fullSessionId}`);
            }
            
            await this.removeSessionFromTracking(fullSessionId);

            return { 
                success: true,
                wasGoodSession: session && session.isGood && session.isPermanent
            };
        } catch (error) {
            log.error('Stop session safely error:', error.message);
            this.activeSessions.delete(sessionId);
            throw error;
        }
    }

    startCleanupTimer() {
        // Cleanup bad sessions every 10 minutes
        setInterval(() => {
            this.cleanupBadSessions();
        }, 10 * 60 * 1000);

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
            let cleanedCount = 0;

            for (const dirName of sessionDirs) {
                if (dirName === '.gitkeep') continue;

                const sessionPath = path.join(this.sessionsDir, dirName);
                const stat = await fs.stat(sessionPath);

                if (stat.isDirectory()) {
                    const trackedSession = tracking.sessions.find(s => s.sessionId === dirName);
                    
                    // Protect good sessions - only clean extra files
                    if (trackedSession && trackedSession.isPermanent && trackedSession.isGood) {
                        await this.ensureOnlyCredsExists(dirName);
                        continue;
                    }

                    // Only remove bad sessions (failed to send messages or invalid)
                    const isValidSession = await this.isValidSession(dirName);
                    const isBadSession = trackedSession && trackedSession.isGood === false;
                    
                    if (!isValidSession || isBadSession) {
                        await fs.remove(sessionPath);
                        await this.removeSessionFromTracking(dirName);
                        cleanedCount++;
                    }
                }
            }

            if (cleanedCount > 0) {
                log.info(`Cleaned ${cleanedCount} bad sessions`);
            }
        } catch (error) {
            log.error('Cleanup error:', error.message);
        }
    }

    async isValidSession(sessionId) {
        try {
            const sessionPath = path.join(this.sessionsDir, sessionId);
            const credsPath = path.join(sessionPath, 'creds.json');

            if (!(await fs.pathExists(credsPath))) {
                return false;
            }

            const creds = await fs.readJson(credsPath);
            return !!(creds.me && creds.me.id);
        } catch (error) {
            return false;
        }
    }

    async ensureOnlyCredsExists(sessionId) {
        try {
            const sessionPath = path.join(this.sessionsDir, sessionId);
            const files = await fs.readdir(sessionPath);
            
            for (const file of files) {
                if (file !== 'creds.json') {
                    const filePath = path.join(sessionPath, file);
                    try {
                        await fs.remove(filePath);
                    } catch (error) {
                        // Silent fail
                    }
                }
            }
        } catch (error) {
            // Silent fail
        }
    }

    async cleanupUnscannedSessions() {
        try {
            const now = Date.now();
            const maxAge = 5 * 60 * 1000; // 5 minutes timeout for unscanned sessions

            for (const [sessionId, sessionData] of this.activeSessions.entries()) {
                const age = now - sessionData.createdAt;

                if (age > maxAge && !sessionData.connected) {
                    log.debug(`Timeout unscanned session: ${sessionId}`);
                    await this.cleanupFailedSession(sessionId);
                    this.activeSessions.delete(sessionId);
                }
            }
        } catch (error) {
            log.error('Unscanned cleanup error:', error.message);
        }
    }

    async getSession(sessionId) {
        try {
            const tracking = await fs.readJson(this.sessionTrackingFile);
            const session = tracking.sessions.find(s => s.sessionId === sessionId);
            
            if (!session || !session.isPermanent || !session.isGood) {
                return null;
            }

            // Check if creds.json exists
            const sessionPath = path.join(this.sessionsDir, sessionId);
            const credsPath = path.join(sessionPath, 'creds.json');
            const hasValidCreds = await fs.pathExists(credsPath);

            return {
                ...session,
                hasValidCreds,
                fileCount: hasValidCreds ? 1 : 0
            };
        } catch (error) {
            log.error('Get session error:', error.message);
            return null;
        }
    }
    async getSessionFiles(sessionId) {
        try {
            const sessionPath = path.join(this.sessionsDir, sessionId);

            if (!(await fs.pathExists(sessionPath))) {
                return null;
            }

            // Only return creds.json for valid sessions
            const credsPath = path.join(sessionPath, 'creds.json');
            if (!(await fs.pathExists(credsPath))) {
                return null;
            }

            const stats = await fs.stat(credsPath);
            return {
                'creds.json': {
                    size: stats.size,
                    modified: stats.mtime,
                    downloadUrl: `/api/session/${sessionId}/file/creds.json`
                }
            };
        } catch (error) {
            log.error('Get session files error:', error.message);
            throw error;
        }
    }

    async getSessionFile(sessionId, fileName) {
        try {
            // Only allow downloading creds.json for security
            if (fileName !== 'creds.json') {
                return null;
            }

            const sessionPath = path.join(this.sessionsDir, sessionId);
            const filePath = path.join(sessionPath, fileName);

            if (!filePath.startsWith(sessionPath) || !(await fs.pathExists(filePath))) {
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
            return tracking.sessions.filter(session => session.isPermanent && session.isGood);
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

            // Only return creds.json for valid sessions
            const credsPath = path.join(sessionPath, 'creds.json');
            if (!(await fs.pathExists(credsPath))) {
                return null;
            }

            const stats = await fs.stat(credsPath);
            const buffer = await fs.readFile(credsPath);

            return {
                sessionId,
                totalFiles: 1,
                files: [{
                    name: 'creds.json',
                    size: stats.size,
                    modified: stats.mtime,
                    content: buffer.toString('base64'),
                    downloadUrl: `/api/session/${sessionId}/file/creds.json`
                }]
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

            // Only return creds.json for valid sessions
            const credsPath = path.join(sessionPath, 'creds.json');
            if (!(await fs.pathExists(credsPath))) {
                return null;
            }

            const stats = await fs.stat(credsPath);

            return [{
                name: 'creds.json',
                size: stats.size,
                modified: stats.mtime,
                downloadUrl: `/api/session/${sessionId}/file/creds.json`
            }];
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

            // Only include creds.json in the zip
            const credsPath = path.join(sessionPath, 'creds.json');
            if (!(await fs.pathExists(credsPath))) {
                return null;
            }

            const archiver = (await import('archiver')).default;
            const archive = archiver('zip', { zlib: { level: 9 } });

            const stats = await fs.stat(credsPath);
            archive.file(credsPath, { name: 'creds.json' });

            return {
                archive,
                files: [{
                    name: 'creds.json',
                    size: stats.size,
                    modified: stats.mtime
                }],
                sessionId
            };
        } catch (error) {
            log.error('Download all session files error:', error.message);
            throw error;
        }
    }
}

export default WhatsAppService;