import fs from 'fs-extra';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
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

class PluginService {
  constructor() {
    this.pluginRequestsFile = path.join(__dirname, '../data/plugin-requests.json');
    this.initialized = false;
    this.initPromise = this.initialize();
    
    // Plugin cache
    this.cache = new Map();
    this.cacheTTL = parseInt(process.env.PLUGIN_CACHE_TTL) || 5 * 60 * 1000; // 5 minutes default
  }

  async initialize() {
    try {
      await this.ensureDataDir();
      this.initialized = true;
      log.success('Plugin Service ready');
    } catch (error) {
      log.error('Plugin Service init failed:', error.message);
    }
  }

  async ensureInitialized() {
    if (!this.initialized) {
      await this.initPromise;
    }
  }

  async ensureDataDir() {
    const dataDir = path.dirname(this.pluginRequestsFile);
    await fs.ensureDir(dataDir);

    if (!(await fs.pathExists(this.pluginRequestsFile))) {
      await fs.writeJson(this.pluginRequestsFile, []);
    }
  }

  // Since we're using manual Git-based workflow, we don't need to load demo plugins
  // Approved plugins are managed in frontend/src/data/permanentPlugins.js

  async getAllPlugins() {
    // Return empty array since approved plugins are now in permanentPlugins.js
    return [];
  }

  async getPlugins(filters = {}) {
    // Return empty array since approved plugins are now in permanentPlugins.js
    return [];
  }

  // Plugin Requests Management
  async addPluginRequest(pluginData) {
    await this.ensureInitialized();
    
    try {
      const requests = await this.getAllPluginRequests();
      
      const newRequest = {
        id: uuidv4(),
        ...pluginData,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };
      
      requests.push(newRequest);
      await fs.writeJson(this.pluginRequestsFile, requests, { spaces: 2 });
      
      // Clear cache
      this.cache.delete('plugin-requests');
      
      log.success(`Plugin request added: ${newRequest.name} by ${newRequest.author}`);
      return newRequest;
    } catch (error) {
      log.error('Add plugin request failed:', error.message);
      throw error;
    }
  }

  async getAllPluginRequests() {
    await this.ensureInitialized();
    
    const cacheKey = 'plugin-requests';
    const cached = this.cache.get(cacheKey);
    
    if (cached && Date.now() - cached.timestamp < this.cacheTTL) {
      return cached.data;
    }
    
    try {
      const requests = await fs.readJson(this.pluginRequestsFile);
      
      // Cache the results
      this.cache.set(cacheKey, {
        data: requests,
        timestamp: Date.now()
      });
      
      return requests;
    } catch (error) {
      log.error('Get plugin requests failed:', error.message);
      return [];
    }
  }

  async getPluginRequestById(id) {
    const requests = await this.getAllPluginRequests();
    return requests.find(request => request.id === id);
  }

  async updatePluginRequestStatus(id, status, adminUser = null) {
    await this.ensureInitialized();
    
    try {
      const requests = await this.getAllPluginRequests();
      const requestIndex = requests.findIndex(request => request.id === id);
      
      if (requestIndex === -1) {
        throw new Error('Plugin request not found');
      }
      
      requests[requestIndex].status = status;
      requests[requestIndex].updatedAt = new Date().toISOString();
      
      if (adminUser) {
        requests[requestIndex].reviewedBy = adminUser;
        requests[requestIndex].reviewedAt = new Date().toISOString();
      }
      
      await fs.writeJson(this.pluginRequestsFile, requests, { spaces: 2 });
      
      // Clear cache
      this.cache.delete('plugin-requests');
      
      log.success(`Plugin request ${status}: ${requests[requestIndex].name}`);
      return requests[requestIndex];
    } catch (error) {
      log.error('Update plugin request status failed:', error.message);
      throw error;
    }
  }

  async deletePluginRequest(id) {
    await this.ensureInitialized();
    
    try {
      const requests = await this.getAllPluginRequests();
      const requestIndex = requests.findIndex(request => request.id === id);
      
      if (requestIndex === -1) {
        throw new Error('Plugin request not found');
      }
      
      const deletedRequest = requests.splice(requestIndex, 1)[0];
      await fs.writeJson(this.pluginRequestsFile, requests, { spaces: 2 });
      
      // Clear cache
      this.cache.delete('plugin-requests');
      
      log.success(`Plugin request deleted: ${deletedRequest.name}`);
      return deletedRequest;
    } catch (error) {
      log.error('Delete plugin request failed:', error.message);
      throw error;
    }
  }

}

export default PluginService;