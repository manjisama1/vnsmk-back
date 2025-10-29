const fs = require('fs-extra');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

class PluginService {
  constructor() {
    this.pluginsFile = path.join(__dirname, '../data/plugins.json');
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
      console.log('📦 Plugin Service: Production ready');
    } catch (error) {
      console.error('❌ Plugin Service initialization error:', error);
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
      console.log('📦 Creating plugins.json file...');
      await fs.writeJson(this.pluginsFile, []);
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
        console.log('Demo plugins loaded successfully');
      }
    } catch (error) {
      console.error('Error loading demo plugins:', error);
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
      console.error('Error reading plugins file:', error);
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
      console.error('Error getting plugins:', error);
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

      console.log('Plugin added:', newPlugin.name);
      return newPlugin;
    } catch (error) {
      console.error('Error adding plugin:', error);
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

      console.log(`Plugin ${status}:`, plugins[pluginIndex].name);
      return plugins[pluginIndex];
    } catch (error) {
      console.error('Error updating plugin status:', error);
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
      console.error('Error liking plugin:', error);
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
      console.log('Plugin deleted:', pluginId);

      return true;
    } catch (error) {
      console.error('Error deleting plugin:', error);
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

      console.log('Plugin updated:', plugins[pluginIndex].name);
      return plugins[pluginIndex];
    } catch (error) {
      console.error('Error updating plugin:', error);
      throw error;
    }
  }
}

module.exports = PluginService;