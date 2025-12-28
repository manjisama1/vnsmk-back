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

class FAQService {
  constructor() {
    this.faqFile = path.join(__dirname, '../data/faqs.json');
    this.initialized = false;
    this.initPromise = this.initialize();
  }

  async initialize() {
    try {
      await this.ensureDataDir();
      this.initialized = true;
      log.success('FAQ Service ready');
    } catch (error) {
      log.error('FAQ Service init failed:', error.message);
    }
  }

  async ensureInitialized() {
    if (!this.initialized) {
      await this.initPromise;
    }
  }
  

  async ensureDataDir() {
    const dataDir = path.dirname(this.faqFile);
    await fs.ensureDir(dataDir);

    if (!(await fs.pathExists(this.faqFile))) {
      // File doesn't exist, will be created with default FAQs from faqs.json
      const defaultFAQs = [];
      await fs.writeJson(this.faqFile, defaultFAQs, { spaces: 2 });
    }
  }

  async getAllFAQs() {
    await this.ensureInitialized();
    try {
      return await fs.readJson(this.faqFile);
    } catch (error) {
      log.error('Error reading FAQs:', error.message);
      return [];
    }
  }

  async getFAQById(id) {
    try {
      const faqs = await this.getAllFAQs();
      return faqs.find(faq => faq.id === parseInt(id));
    } catch (error) {
      log.error('Error getting FAQ by ID:', error.message);
      return null;
    }
  }

  async addFAQ(faqData) {
    try {
      const faqs = await this.getAllFAQs();
      const nextId = Math.max(...faqs.map(f => f.id), 0) + 1;

      const newFAQ = {
        id: nextId,
        ...faqData,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };

      faqs.push(newFAQ);
      await fs.writeJson(this.faqFile, faqs, { spaces: 2 });

      log.debug('FAQ added:', newFAQ.question);
      return newFAQ;
    } catch (error) {
      log.error('Error adding FAQ:', error.message);
      throw error;
    }
  }

  async updateFAQ(id, updateData) {
    try {
      const faqs = await this.getAllFAQs();
      const faqIndex = faqs.findIndex(faq => faq.id === parseInt(id));

      if (faqIndex === -1) {
        throw new Error('FAQ not found');
      }

      // Preserve permanent status - cannot be changed
      const currentFAQ = faqs[faqIndex];
      const updatedFAQ = {
        ...currentFAQ,
        ...updateData,
        isPermanent: currentFAQ.isPermanent, // Preserve permanent status
        updatedAt: new Date().toISOString()
      };

      faqs[faqIndex] = updatedFAQ;
      await fs.writeJson(this.faqFile, faqs, { spaces: 2 });

      log.debug('FAQ updated:', updatedFAQ.question);
      return updatedFAQ;
    } catch (error) {
      log.error('Error updating FAQ:', error.message);
      throw error;
    }
  }

  async deleteFAQ(id) {
    try {
      const faqs = await this.getAllFAQs();
      const faqToDelete = faqs.find(faq => faq.id === parseInt(id));

      if (!faqToDelete) {
        throw new Error('FAQ not found');
      }

      // Prevent deletion of permanent FAQs
      if (faqToDelete.isPermanent) {
        throw new Error('Cannot delete permanent FAQ. This FAQ is protected and cannot be removed.');
      }

      const filteredFAQs = faqs.filter(faq => faq.id !== parseInt(id));
      await fs.writeJson(this.faqFile, filteredFAQs, { spaces: 2 });
      log.debug('FAQ deleted:', id);

      return true;
    } catch (error) {
      log.error('Error deleting FAQ:', error.message);
      throw error;
    }
  }

  async searchFAQs(query) {
    try {
      const faqs = await this.getAllFAQs();
      const lowercaseQuery = query.toLowerCase();
      
      return faqs.filter(faq => 
        faq.question.toLowerCase().includes(lowercaseQuery) ||
        faq.answer.toLowerCase().includes(lowercaseQuery) ||
        faq.category.toLowerCase().includes(lowercaseQuery) ||
        faq.tags?.some(tag => tag.toLowerCase().includes(lowercaseQuery))
      );
    } catch (error) {
      log.error('Error searching FAQs:', error.message);
      return [];
    }
  }

  async getFAQsByCategory(category) {
    try {
      const faqs = await this.getAllFAQs();
      return faqs.filter(faq => faq.category === category);
    } catch (error) {
      log.error('Error getting FAQs by category:', error.message);
      return [];
    }
  }

  async getCategories() {
    try {
      const faqs = await this.getAllFAQs();
      const categories = [...new Set(faqs.map(faq => faq.category))];
      return ['All', ...categories.sort()];
    } catch (error) {
      log.error('Error getting categories:', error.message);
      return ['All'];
    }
  }
}

export default FAQService;