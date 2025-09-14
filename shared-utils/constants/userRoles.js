module.exports = {
  ADMIN: 'admin',
  PROJECT_MANAGER: 'project_manager', 
  DEVELOPER: 'developer',
  VIEWER: 'viewer',
  
  // Role hierarchy (higher number = more permissions)
  HIERARCHY: {
    viewer: 1,
    developer: 2, 
    project_manager: 3,
    admin: 4
  },
  
  // Check if role has permission
  hasPermission: (userRole, requiredRole) => {
    const userLevel = module.exports.HIERARCHY[userRole] || 0;
    const requiredLevel = module.exports.HIERARCHY[requiredRole] || 0;
    return userLevel >= requiredLevel;
  }
};