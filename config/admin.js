// Admin Configuration for Backend
// Configure admin users via environment variables for production security

let ADMIN_CONFIG = null;

// Lazy loading function to ensure environment variables are loaded
const getAdminConfig = () => {
  if (!ADMIN_CONFIG) {
    ADMIN_CONFIG = {
      // Get admin user IDs from environment variable (comma-separated)
      // Primary: Use GitHub user IDs (more secure, never change)
      // Example: ADMIN_USER_IDS=111729787,987654321
      adminUserIds: process.env.ADMIN_USER_IDS 
        ? process.env.ADMIN_USER_IDS.split(',').map(id => id.trim()).filter(Boolean)
        : [], // Empty array in production if not configured

      // Fallback: Use GitHub usernames (can change, less secure)
      // Example: ADMIN_USERS=manjisama1,another-admin
      adminUsernames: process.env.ADMIN_USERS 
        ? process.env.ADMIN_USERS.split(',').map(username => username.trim()).filter(Boolean)
        : [], // Empty array in production if not configured
    };
  }
  return ADMIN_CONFIG;
};

// Helper function to check if a user is admin
const isAdmin = (user) => {
  const config = getAdminConfig(); // Load config when needed
  
  if (!user) return false;

  // Primary check: User ID (most secure, never changes)
  if (user.id && config.adminUserIds.length > 0) {
    const isAdminById = config.adminUserIds.includes(user.id.toString());
    if (isAdminById) {
      return true;
    }
  }

  // Fallback check: Username (less secure, can change)
  if (user.login && config.adminUsernames.length > 0) {
    const isAdminByUsername = config.adminUsernames.includes(user.login);
    if (isAdminByUsername) {
      return true;
    }
  }

  return false;
};

export {
  getAdminConfig,
  isAdmin
};
