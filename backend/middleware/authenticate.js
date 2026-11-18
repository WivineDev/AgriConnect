const jwt = require('jsonwebtoken');
const { pool } = require('../config/database');
const { tokenIdHash } = require('../utils/token');

async function authenticate(req, res, next) {
  const header = req.get('authorization') || '';
  const match = header.match(/^Bearer\s+(.+)$/i);
  if (!match) return res.status(401).json({ success: false, message: 'Authentication required' });

  try {
    const claims = jwt.verify(match[1], process.env.JWT_SECRET);
    if (!claims.sub || !claims.jti) throw new Error('Invalid token');
    const [revoked] = await pool.execute(
      'SELECT 1 FROM revoked_tokens WHERE jti_hash = ? AND expires_at > UTC_TIMESTAMP() LIMIT 1',
      [tokenIdHash(claims.jti)]);
    if (revoked.length) return res.status(401).json({ success: false, message: 'Token is no longer valid' });

    const [rows] = await pool.execute(
      `SELECT u.user_id AS id, UPPER(r.role_name) AS role,
        UPPER(u.account_status) AS status, u.token_version AS tokenVersion
        , u.must_change_password AS mustChangePassword
       FROM users u JOIN roles r ON r.role_id = u.role_id
       WHERE u.user_id = ? LIMIT 1`, [claims.sub]);
    const user = rows[0];
    if (!user) return res.status(401).json({ success: false, message: 'Invalid authentication token' });
    if (user.status !== 'ACTIVE') return res.status(403).json({ success: false, message: 'Account is suspended' });
    if (claims.ver !== user.tokenVersion) return res.status(401).json({ success: false, message: 'Token is no longer valid' });
    if (user.mustChangePassword && !(req.method === 'PUT' && req.path === '/change-password')) {
      return res.status(403).json({ success: false, message: 'Change your temporary password before using this account' });
    }
    req.user = { id: user.id, role: user.role, mustChangePassword: Boolean(user.mustChangePassword) };
    req.auth = { token: match[1], claims };
    return next();
  } catch (error) {
    if (error.name === 'JsonWebTokenError' || error.name === 'TokenExpiredError') {
      return res.status(401).json({ success: false, message: 'Invalid or expired authentication token' });
    }
    return next(error);
  }
}

module.exports = authenticate;
