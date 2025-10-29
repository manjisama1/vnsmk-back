const fs = require('fs-extra');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

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
      console.log('❓ FAQ Service: Data files initialized');
    } catch (error) {
      console.error('❌ FAQ Service initialization error:', error);
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
      console.log('❓ Creating faqs.json file...');
      // Initialize with some default FAQs
      const defaultFAQs = [
        {
          id: 1,
          category: "Getting Started",
          question: "How do I connect my WhatsApp to the Vinsmoke bot?",
          answer: "You can connect your WhatsApp using either red`QR code scanning` or blue`pairing code method`. Go to the Session page and choose your preferred method. For QR code, simply scan the generated code with your WhatsApp app.",
          tags: ["connection", "setup", "whatsapp"],
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        },
        {
          id: 2,
          category: "Security",
          question: "Is my data secure with Vinsmoke bot?",
          answer: "Yes, absolutely! All sessions are yellow`end-to-end encrypted` and stored securely on our servers. We use green`industry-standard encryption protocols` and don't have access to your personal messages or data.",
          tags: ["security", "privacy", "data"],
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        }
      ];
      await fs.writeJson(this.faqFile, defaultFAQs, { spaces: 2 });
    }
  }

  async getAllFAQs() {
    await this.ensureInitialized();
    try {
      return await fs.readJson(this.faqFile);
    } catch (error) {
      console.error('Error reading FAQs file:', error);
      return [];
    }
  }

  async getFAQById(id) {
    try {
      const faqs = await this.getAllFAQs();
      return faqs.find(faq => faq.id === parseInt(id));
    } catch (error) {
      console.error('Error getting FAQ by ID:', error);
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

      console.log('FAQ added:', newFAQ.question);
      return newFAQ;
    } catch (error) {
      console.error('Error adding FAQ:', error);
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

      faqs[faqIndex] = {
        ...faqs[faqIndex],
        ...updateData,
        updatedAt: new Date().toISOString()
      };

      await fs.writeJson(this.faqFile, faqs, { spaces: 2 });

      console.log('FAQ updated:', faqs[faqIndex].question);
      return faqs[faqIndex];
    } catch (error) {
      console.error('Error updating FAQ:', error);
      throw error;
    }
  }

  async deleteFAQ(id) {
    try {
      const faqs = await this.getAllFAQs();
      const filteredFAQs = faqs.filter(faq => faq.id !== parseInt(id));

      if (faqs.length === filteredFAQs.length) {
        throw new Error('FAQ not found');
      }

      await fs.writeJson(this.faqFile, filteredFAQs, { spaces: 2 });
      console.log('FAQ deleted:', id);

      return true;
    } catch (error) {
      console.error('Error deleting FAQ:', error);
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
      console.error('Error searching FAQs:', error);
      return [];
    }
  }

  async getFAQsByCategory(category) {
    try {
      const faqs = await this.getAllFAQs();
      return faqs.filter(faq => faq.category === category);
    } catch (error) {
      console.error('Error getting FAQs by category:', error);
      return [];
    }
  }

  async getCategories() {
    try {
      const faqs = await this.getAllFAQs();
      const categories = [...new Set(faqs.map(faq => faq.category))];
      return ['All', ...categories.sort()];
    } catch (error) {
      console.error('Error getting categories:', error);
      return ['All'];
    }
  }
}

module.exports = FAQService;