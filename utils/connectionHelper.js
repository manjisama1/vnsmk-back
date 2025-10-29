const { DisconnectReason } = require('@whiskeysockets/baileys');

class ConnectionHelper {
  static getSocketConfig(version) {
    return {
      version,
      printQRInTerminal: false,
      browser: ['Vinsmoke Bot', 'Chrome', '1.0.0'],
      connectTimeoutMs: 60000,
      defaultQueryTimeoutMs: 0,
      keepAliveIntervalMs: 10000,
      generateHighQualityLinkPreview: true,
      retryRequestDelayMs: 10000,
      maxMsgRetryCount: 5,
      msgRetryCounterCache: new Map(),
      shouldSyncHistoryMessage: () => false,
      shouldIgnoreJid: () => false,
      linkPreviewImageThumbnailWidth: 192,
      transactionOpts: {
        maxCommitRetries: 10,
        delayBetweenTriesMs: 3000
      }
    };
  }

  static shouldReconnect(lastDisconnect) {
    const reason = lastDisconnect?.error?.output?.statusCode;
    
    // Don't reconnect for these reasons
    const noReconnectReasons = [
      DisconnectReason.loggedOut,
      DisconnectReason.badSession,
      DisconnectReason.multideviceMismatch
    ];
    
    if (noReconnectReasons.includes(reason)) {
      return false;
    }
    
    // Reconnect for these common issues
    const reconnectReasons = [
      DisconnectReason.connectionClosed,
      DisconnectReason.connectionLost,
      DisconnectReason.connectionReplaced,
      DisconnectReason.timedOut,
      515, // Stream error
      503, // Service unavailable
      502, // Bad gateway
      500  // Internal server error
    ];
    
    return reconnectReasons.includes(reason) || !reason;
  }

  static getReconnectDelay(attempt = 1) {
    // Exponential backoff with jitter
    const baseDelay = Math.min(1000 * Math.pow(2, attempt), 30000);
    const jitter = Math.random() * 1000;
    return baseDelay + jitter;
  }

  static logConnectionEvent(event, sessionId, details = {}) {
    const timestamp = new Date().toISOString();
    console.log(`[${timestamp}] Session ${sessionId}: ${event}`, details);
  }
}

module.exports = ConnectionHelper;