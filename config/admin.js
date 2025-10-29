// Admin Configuration for Backend
// Change this to your GitHub username to grant admin access

const ADMIN_CONFIG = {
  // Your GitHub username (case-sensitive)
  adminUsername: 'manjisama1',

  // Optional: Add multiple admin usernames
  adminUsernames: [
    'manjisama1',
    // Add more admin usernames here if needed
    // 'another-admin-username',
  ],
};

// Helper function to check if a user is admin
const isAdmin = (user) => {
  if (!user || !user.login) return false;

  // Check if user is in admin list
  return ADMIN_CONFIG.adminUsernames.includes(user.login);
};

module.exports = {
  ADMIN_CONFIG,
  isAdmin
};