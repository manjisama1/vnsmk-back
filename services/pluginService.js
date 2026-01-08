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
            status: 'pending',
            createdAt: new Date('2024-03-05').toISOString()
          },
          {
            id: uuidv4(),
            name: 'Instagram Downloader',
            author: 'MediaBot',
            description: 'Download Instagram posts, stories, reels, and IGTV videos with metadata',
            type: 'media',
            gistLink: 'https://gist.github.com/mediabot/instagram-downloader',
            likes: 78,
            status: 'approved',
            createdAt: new Date('2024-02-10').toISOString()
          },
          {
            id: uuidv4(),
            name: 'Custom Stickers',
            author: 'StickerMaster',
            description: 'Create personalized stickers from any image with automatic background removal',
            type: 'sticker',
            gistLink: 'https://gist.github.com/stickermaster/custom-stickers',
            likes: 56,
            status: 'approved',
            createdAt: new Date('2024-01-25').toISOString()
          },
          {
            id: uuidv4(),
            name: 'TikTok Downloader',
            author: 'MediaBot',
            description: 'Download TikTok videos without watermark in high quality',
            type: 'media',
            gistLink: 'https://gist.github.com/mediabot/tiktok-downloader',
            likes: 92,
            status: 'approved',
            createdAt: new Date('2024-03-01').toISOString()
          },
          {
            id: uuidv4(),
            name: 'Quote Generator',
            author: 'WisdomBot',
            description: 'Generate inspirational quotes with beautiful backgrounds and typography',
            type: 'fun',
            gistLink: 'https://gist.github.com/wisdombot/quote-generator',
            likes: 41,
            status: 'rejected',
            createdAt: new Date('2024-02-15').toISOString()
          }
        ];

        await fs.writeJson(this.pluginsFile, demoPlugins);
        log.debug('Demo plugins loaded');
      }
    } catch (error) {
      log.error('Error loading demo plugins:', error.message);
    }
  }

  async getAllPlugins() {
    await this.ensureInitialized();
    
    // Check cache first
    const cacheKey = 'all_plugins';
    const cached = this.cache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < this.cacheTTL) {
      return cached.data;
    }
    
    try {
      const plugins = await fs.readJson(this.pluginsFile);
      
      // Cache the result
      this.cache.set(cacheKey, {
        data: plugins,
        timestamp: Date.now()
      });
      
      return plugins;
    } catch (error) {
      log.error('Error reading plugins:', error.message);
      return [];
    }
  }

  async getPlugins(filters = {}) {
    try {
      let plugins = await this.getAllPlugins();

      // For regular users, show approved plugins and pending plugins (but mark them)
      if (!filters.includeAll) {
        plugins = plugins.filter(plugin => 
          plugin.status === 'approved' || 
          plugin.status === 'pending' || 
          !plugin.status
        );
      }

      // Apply type filter
      if (filters.type && filters.type !== 'all') {
        plugins = plugins.filter(plugin => plugin.type === filters.type);
      }

      // Apply search filter
      if (filters.search) {
        const searchTerm = filters.search.toLowerCase();
        plugins = plugins.filter(plugin =>
          plugin.name.toLowerCase().includes(searchTerm) ||
          plugin.description.toLowerCase().includes(searchTerm) ||
          plugin.author.toLowerCase().includes(searchTerm)
        );
      }

      // Apply sorting
      switch (filters.sort) {
        case 'recent':
          plugins.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
          break;
        case 'old':
          plugins.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
          break;
        case 'liked':
          plugins.sort((a, b) => b.likes - a.likes);
          break;
        case 'az':
          plugins.sort((a, b) => a.name.localeCompare(b.name));
          break;
        default:
          plugins.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
      }

      return plugins;
    } catch (error) {
      log.error('Error getting plugins:', error.message);
      throw error;
    }
  }

  async addPlugin(pluginData) {
    try {
      const plugins = await this.getAllPlugins();

      const newPlugin = {
        id: uuidv4(),
        ...pluginData,
        likes: 0,
        status: 'pending', // New plugins start as pending
        createdAt: new Date().toISOString()
      };

      plugins.push(newPlugin);
      await fs.writeJson(this.pluginsFile, plugins);

      log.debug('Plugin added:', newPlugin.name);
      return newPlugin;
    } catch (error) {
      log.error('Error adding plugin:', error.message);
      throw error;
    }
  }

  async updatePluginStatus(pluginId, status) {
    try {
      const plugins = await this.getAllPlugins();
      const pluginIndex = plugins.findIndex(plugin => plugin.id === pluginId);

      if (pluginIndex === -1) {
        throw new Error('Plugin not found');
      }

      plugins[pluginIndex].status = status;
      plugins[pluginIndex].updatedAt = new Date().toISOString();

      await fs.writeJson(this.pluginsFile, plugins);

      log.debug(`Plugin ${status}:`, plugins[pluginIndex].name);
      return plugins[pluginIndex];
    } catch (error) {
      log.error('Error updating plugin status:', error.message);
      throw error;
    }
  }

  async likePlugin(pluginId, userId) {
    try {
      const plugins = await this.getAllPlugins();
      const pluginIndex = plugins.findIndex(plugin => plugin.id === pluginId);

      if (pluginIndex === -1) {
        throw new Error('Plugin not found');
      }

      // Initialize likedBy array if it doesn't exist
      if (!plugins[pluginIndex].likedBy) {
        plugins[pluginIndex].likedBy = [];
      }

      // Check if user already liked this plugin
      const hasLiked = plugins[pluginIndex].likedBy.includes(userId);

      if (hasLiked) {
        // Unlike: remove user from likedBy array and decrease likes
        plugins[pluginIndex].likedBy = plugins[pluginIndex].likedBy.filter(id => id !== userId);
        plugins[pluginIndex].likes = Math.max(0, plugins[pluginIndex].likes - 1);
      } else {
        // Like: add user to likedBy array and increase likes
        plugins[pluginIndex].likedBy.push(userId);
        plugins[pluginIndex].likes += 1;
      }

      await fs.writeJson(this.pluginsFile, plugins, { spaces: 2 });
      return plugins[pluginIndex];
    } catch (error) {
      log.error('Error liking plugin:', error.message);
      throw error;
    }
  }

  async deletePlugin(pluginId) {
    try {
      const plugins = await this.getAllPlugins();
      const filteredPlugins = plugins.filter(plugin => plugin.id !== pluginId);

      if (plugins.length === filteredPlugins.length) {
        throw new Error('Plugin not found');
      }

      await fs.writeJson(this.pluginsFile, filteredPlugins);
      log.debug('Plugin deleted:', pluginId);

      return true;
    } catch (error) {
      log.error('Error deleting plugin:', error.message);
      throw error;
    }
  }

  async updatePlugin(pluginId, updateData) {
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
}

export default PluginService;
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
      approvedBy: adminUser,
      approvedAt: new Date().toISOString()
    };

    const plugin = await this.addPlugin(approvedPlugin);
    
    log.success(`Plugin approved and added: ${plugin.name}`);
    return { request, plugin };
  }