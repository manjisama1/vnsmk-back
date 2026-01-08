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
    this.pluginsFile = path.join(__dirname, '../data/plugins.json');
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
    const dataDir = path.dirname(this.pluginsFile);
    await fs.ensureDir(dataDir);

    if (!(await fs.pathExists(this.pluginsFile))) {
      await fs.writeJson(this.pluginsFile, []);
    }

    if (!(await fs.pathExists(this.pluginRequestsFile))) {
      await fs.writeJson(this.pluginRequestsFile, []);
    }
  }

  async loadDemoPlugins() {
    try {
      const plugins = await this.getAllPlugins();
      if (plugins.length === 0) {
        const demoPlugins = [
          {
            id: uuidv4(),
            name: 'Sticker Pack Manager',
            author: 'VinsmokeTeam',
            description: 'Manage and create custom sticker packs for your WhatsApp bot with advanced features',
            type: 'sticker',
            gistLink: 'https://gist.github.com/vinsmokebot/sticker-pack-manager',
            likes: 45,
            status: 'approved',
            createdAt: new Date('2024-01-15').toISOString()
          },
          {
            id: uuidv4(),
            name: 'YouTube Downloader',
            author: 'MediaBot',
            description: 'Download YouTube videos and audio directly through WhatsApp with multiple quality options',
            type: 'media',
            gistLink: 'https://gist.github.com/mediabot/youtube-downloader',
            likes: 89,
            status: 'approved',
            createdAt: new Date('2024-02-20').toISOString()
          },
          {
            id: uuidv4(),
            name: 'Meme Generator',
            author: 'FunBot',
            description: 'Generate hilarious memes with custom text and images using AI-powered templates',
            type: 'fun',
            gistLink: 'https://gist.github.com/funbot/meme-generator',
            likes: 67,
            status: 'approved',
            createdAt: new Date('2024-01-30').toISOString()
          },
          {
            id: uuidv4(),
            name: 'Weather Bot',
            author: 'WeatherTeam',
            description: 'Get real-time weather updates, forecasts, and alerts for any location worldwide',
            type: 'fun',
            gistLink: 'https://gist.github.com/weatherteam/weather-bot',
            likes: 34,
            status: 'approved',
            createdAt: new Date('2024-02-10').toISOString()
          },
          {
            id: uuidv4(),
            name: 'Group Manager Pro',
            author: 'AdminTools',
            description: 'Advanced group management with auto-moderation, welcome messages, and member analytics',
            type: 'admin',
            gistLink: 'https://gist.github.com/admintools/group-manager-pro',
            likes: 78,
            status: 'approved',
            createdAt: new Date('2024-01-25').toISOString()
          }
        ];

        await fs.writeJson(this.pluginsFile, demoPlugins, { spaces: 2 });
        log.success('Demo plugins loaded');
      }
    } catch (error) {
      log.error('Demo plugins load failed:', error.message);
    }
  }

  async getAllPlugins() {
    await this.ensureInitialized();
    
    const cacheKey = 'all-plugins';
    const cached = this.cache.get(cacheKey);
    
    if (cached && Date.now() - cached.timestamp < this.cacheTTL) {
      return cached.data;
    }
    
    try {
      const plugins = await fs.readJson(this.pluginsFile);
      
      // Cache the results
      this.cache.set(cacheKey, {
        data: plugins,
        timestamp: Date.now()
      });
      
      return plugins;
    } catch (error) {
      log.error('Get all plugins failed:', error.message);
      return [];
    }
  }

  async getPlugins(filters = {}) {
    try {
      let plugins = await this.getAllPlugins();
      
      // Apply filters
      if (filters.type && filters.type !== 'all') {
        plugins = plugins.filter(plugin => plugin.type === filters.type);
      }
      
      if (filters.status) {
        plugins = plugins.filter(plugin => plugin.status === filters.status);
      } else if (!filters.includeAll) {
        // By default, only return approved plugins for public API
        plugins = plugins.filter(plugin => plugin.status === 'approved');
      }
      
      if (filters.search) {
        const searchTerm = filters.search.toLowerCase();
        plugins = plugins.filter(plugin =>
          plugin.name.toLowerCase().includes(searchTerm) ||
          plugin.description.toLowerCase().includes(searchTerm) ||
          plugin.author.toLowerCase().includes(searchTerm) ||
          (plugin.tags && plugin.tags.some(tag => tag.toLowerCase().includes(searchTerm)))
        );
      }
      
      // Apply sorting
      if (filters.sort) {
        switch (filters.sort) {
          case 'likes':
            plugins.sort((a, b) => (b.likes || 0) - (a.likes || 0));
            break;
          case 'recent':
            plugins.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
            break;
          case 'name':
            plugins.sort((a, b) => a.name.localeCompare(b.name));
            break;
          default:
            plugins.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
        }
      }
      
      return plugins;
    } catch (error) {
      log.error('Get plugins failed:', error.message);
      return [];
    }
  }

  async addPlugin(pluginData) {
    await this.ensureInitialized();
    
    try {
      const plugins = await this.getAllPlugins();
      
      const newPlugin = {
        id: uuidv4(),
        ...pluginData,
        likes: pluginData.likes || 0,
        status: pluginData.status || 'pending',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };
      
      plugins.push(newPlugin);
      await fs.writeJson(this.pluginsFile, plugins, { spaces: 2 });
      
      // Clear cache
      this.cache.delete('all-plugins');
      
      log.success(`Plugin added: ${newPlugin.name} by ${newPlugin.author}`);
      return newPlugin;
    } catch (error) {
      log.error('Add plugin failed:', error.message);
      throw error;
    }
  }

  async updatePluginStatus(pluginId, status) {
    await this.ensureInitialized();
    
    try {
      const plugins = await this.getAllPlugins();
      const pluginIndex = plugins.findIndex(plugin => plugin.id === pluginId);
      
      if (pluginIndex === -1) {
        throw new Error('Plugin not found');
      }
      
      plugins[pluginIndex].status = status;
      plugins[pluginIndex].updatedAt = new Date().toISOString();
      
      await fs.writeJson(this.pluginsFile, plugins, { spaces: 2 });
      
      // Clear cache
      this.cache.delete('all-plugins');
      
      log.success(`Plugin status updated: ${plugins[pluginIndex].name} -> ${status}`);
      return plugins[pluginIndex];
    } catch (error) {
      log.error('Update plugin status failed:', error.message);
      throw error;
    }
  }

  async deletePlugin(pluginId) {
    await this.ensureInitialized();
    
    try {
      const plugins = await this.getAllPlugins();
      const pluginIndex = plugins.findIndex(plugin => plugin.id === pluginId);
      
      if (pluginIndex === -1) {
        throw new Error('Plugin not found');
      }
      
      const deletedPlugin = plugins.splice(pluginIndex, 1)[0];
      await fs.writeJson(this.pluginsFile, plugins, { spaces: 2 });
      
      // Clear cache
      this.cache.delete('all-plugins');
      
      log.success(`Plugin deleted: ${deletedPlugin.name}`);
      return deletedPlugin;
    } catch (error) {
      log.error('Delete plugin failed:', error.message);
      throw error;
    }
  }

  async likePlugin(pluginId, userId) {
    await this.ensureInitialized();
    
    try {
      const plugins = await this.getAllPlugins();
      const pluginIndex = plugins.findIndex(plugin => plugin.id === pluginId);
      
      if (pluginIndex === -1) {
        throw new Error('Plugin not found');
      }
      
      // Initialize likes array if it doesn't exist
      if (!plugins[pluginIndex].likedBy) {
        plugins[pluginIndex].likedBy = [];
      }
      
      const hasLiked = plugins[pluginIndex].likedBy.includes(userId);
      
      if (hasLiked) {
        // Unlike
        plugins[pluginIndex].likedBy = plugins[pluginIndex].likedBy.filter(id => id !== userId);
        plugins[pluginIndex].likes = Math.max(0, (plugins[pluginIndex].likes || 0) - 1);
      } else {
        // Like
        plugins[pluginIndex].likedBy.push(userId);
        plugins[pluginIndex].likes = (plugins[pluginIndex].likes || 0) + 1;
      }
      
      plugins[pluginIndex].updatedAt = new Date().toISOString();
      await fs.writeJson(this.pluginsFile, plugins, { spaces: 2 });
      
      // Clear cache
      this.cache.delete('all-plugins');
      
      log.debug(`Plugin ${hasLiked ? 'unliked' : 'liked'}: ${plugins[pluginIndex].name}`);
      return plugins[pluginIndex];
    } catch (error) {
      log.error('Like plugin failed:', error.message);
      throw error;
    }
  }

  async updatePlugin(pluginId, updateData) {
    await this.ensureInitialized();
    
    try {
      const plugins = await this.getAllPlugins();
      const pluginIndex = plugins.findIndex(plugin => plugin.id === pluginId);
      
      if (pluginIndex === -1) {
        throw new Error('Plugin not found');
      }

      plugins[pluginIndex] = {
        ...plugins[pluginIndex],
        ...updateData,
        updatedAt: new Date().toISOString()
      };

      await fs.writeJson(this.pluginsFile, plugins);

      log.debug('Plugin updated:', plugins[pluginIndex].name);
      return plugins[pluginIndex];
    } catch (error) {
      log.error('Error updating plugin:', error.message);
      throw error;
    }
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

  async approvePluginRequest(id, adminUser = null) {
    const request = await this.getPluginRequestById(id);
    if (!request) {
      throw new Error('Plugin request not found');
    }

    // Update request status
    await this.updatePluginRequestStatus(id, 'approved', adminUser);
    
    // Add to approved plugins
    const approvedPlugin = {
      name: request.name,
      author: request.author,
      description: request.description,
      type: request.type,
      gistLink: request.gistLink,
      tags: request.tags || [],
      features: request.features || [],
      likes: 0,
      status: 'approved',
      submittedBy: request.submittedBy,
      originalRequestId: id, // Store reference to original request
      approvedBy: adminUser,
      approvedAt: new Date().toISOString()
    };

    const plugin = await this.addPlugin(approvedPlugin);
    
    log.success(`Plugin approved and added: ${plugin.name}`);
    return { request, plugin };
  }

  // Find approved plugin by various criteria
  async findApprovedPlugin(criteria) {
    const plugins = await this.getAllPlugins();
    
    if (criteria.id) {
      return plugins.find(plugin => plugin.id === criteria.id);
    }
    
    if (criteria.originalRequestId) {
      return plugins.find(plugin => plugin.originalRequestId === criteria.originalRequestId);
    }
    
    if (criteria.name && criteria.author) {
      return plugins.find(plugin => 
        plugin.name === criteria.name && plugin.author === criteria.author
      );
    }
    
    if (criteria.submittedBy) {
      return plugins.find(plugin => plugin.submittedBy === criteria.submittedBy);
    }
    
    return null;
  }

  // Delete plugin from both requests and approved lists
  async deletePluginCompletely(id) {
    let deletedFromRequests = false;
    let deletedFromApproved = false;
    let approvedPlugin = null;

    // Try to get the plugin request first
    try {
      const request = await this.getPluginRequestById(id);
      if (request) {
        // Look for approved plugin by original request ID (most reliable)
        approvedPlugin = await this.findApprovedPlugin({
          originalRequestId: id
        });
        
        // Fallback: look by name/author if originalRequestId not found
        if (!approvedPlugin) {
          approvedPlugin = await this.findApprovedPlugin({
            name: request.name,
            author: request.author
          });
        }
      }
    } catch (error) {
      // Request might not exist, try to find approved plugin by ID directly
      try {
        approvedPlugin = await this.findApprovedPlugin({ id });
      } catch (e) {
        // Plugin might not exist
      }
    }

    // Delete from requests
    try {
      await this.deletePluginRequest(id);
      deletedFromRequests = true;
    } catch (error) {
      // Request might not exist
    }

    // Delete from approved plugins
    try {
      if (approvedPlugin) {
        await this.deletePlugin(approvedPlugin.id);
        deletedFromApproved = true;
      } else {
        // Try to delete by ID directly (in case it's an approved plugin ID)
        await this.deletePlugin(id);
        deletedFromApproved = true;
      }
    } catch (error) {
      // Plugin might not exist in approved list
    }

    return {
      deletedFromRequests,
      deletedFromApproved,
      approvedPlugin: approvedPlugin ? { id: approvedPlugin.id, name: approvedPlugin.name } : null
    };
  }
}

export default PluginService;