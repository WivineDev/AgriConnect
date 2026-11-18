const jwt = require('jsonwebtoken');
const crypto = require('node:crypto');

function signToken(user) {
  return jwt.sign(
    { role: user.role, ver: user.tokenVersion || 0 },
    process.env.JWT_SECRET,
    { subject: String(user.id), jwtid: crypto.randomUUID(), expiresIn: process.env.JWT_EXPIRES_IN || '1h' },
  );
}

function tokenIdHash(jti) {
  return crypto.createHash('sha256').update(jti).digest('hex');
}

module.exports = { signToken, tokenIdHash };
