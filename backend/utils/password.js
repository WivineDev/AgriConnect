const bcrypt = require('bcrypt');
const crypto = require('node:crypto');

const SALT_ROUNDS = 12;
const PASSWORD_PATTERN = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z\d]).{12,72}$/;

function isStrongPassword(password) {
  return typeof password === 'string'
    && Buffer.byteLength(password, 'utf8') <= 72
    && PASSWORD_PATTERN.test(password);
}

function hashPassword(password) {
  return bcrypt.hash(password, SALT_ROUNDS);
}

function comparePassword(password, hash) {
  return bcrypt.compare(password, hash);
}

function generateTemporaryPassword() {
  return `${crypto.randomBytes(20).toString('base64url')}Aa1!`;
}

module.exports = { isStrongPassword, hashPassword, comparePassword, generateTemporaryPassword };
