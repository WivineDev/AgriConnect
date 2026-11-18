const dotenv = require('dotenv');

dotenv.config();

function validateEnvironment() {
  const required = ['PORT', 'NODE_ENV', 'DB_HOST', 'DB_USER', 'DB_NAME', 'JWT_SECRET'];
  const missing = required.filter((key) => !process.env[key]);
  if (missing.length) {
    throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
  }
  const port = Number(process.env.PORT);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('PORT must be an integer between 1 and 65535');
  }
  return {
    port,
    nodeEnv: process.env.NODE_ENV,
    frontendOrigins: (process.env.FRONTEND_ORIGINS || '')
      .split(',').map((origin) => origin.trim()).filter(Boolean),
    jwtExpiresIn: process.env.JWT_EXPIRES_IN || '1h',
  };
}

module.exports = { validateEnvironment };
