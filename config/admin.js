// Admin Configuration for Backend
// Configure admin users via environment variables for production security

const ADMIN_CONFIG = {
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

// Helper function to check if a user is admin
const isAdmin = (user) => {
  if (!user) return false;

  // Primary check: User ID (most secure, never changes)
  if (user.id && ADMIN_CONFIG.adminUserIds.length > 0) {
    const isAdminById = ADMIN_CONFIG.adminUserIds.includes(user.id.toString());
    if (isAdminById) {
      console.log(`✅ Admin access granted by ID: ${user.id} (${user.login})`);
      return true;
    }
  }

  // Fallback check: Username (less secure, can change)
  if (user.login && ADMIN_CONFIG.adminUsernames.length > 0) {
    const isAdminByUsername = ADMIN_CONFIG.adminUsernames.includes(user.login);
    if (isAdminByUsername) {
      console.log(`✅ Admin access granted by username: ${user.login} (ID: ${user.id})`);
      console.log(`💡 Consider using ADMIN_USER_IDS=${user.id} for better security`);
      return true;
    }
  }

  // No admin access
  console.log(`🚫 Admin access denied: ${user.login} (ID: ${user.id})`);
  return false;
};

module.exports = {
  ADMIN_CONFIG,
  isAdmin
};
