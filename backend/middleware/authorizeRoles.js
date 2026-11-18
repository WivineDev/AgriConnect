function authorizeRoles(...allowedRoles) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ success: false, message: 'Authentication required' });
    if (!allowedRoles.includes(req.user.role)) {
      return res.status(403).json({ success: false, message: 'You do not have permission to access this resource' });
    }
    return next();
  };
}

function authorizeOwner(paramName = 'userId', administratorRoles = ['ADMIN']) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ success: false, message: 'Authentication required' });
    if (administratorRoles.includes(req.user.role) || String(req.user.id) === String(req.params[paramName])) return next();
    return res.status(403).json({ success: false, message: 'You do not have permission to access this resource' });
  };
}

module.exports = authorizeRoles;
module.exports.authorizeOwner = authorizeOwner;
