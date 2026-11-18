const { checkDatabaseConnection } = require('../config/database');

function health(req, res) {
  res.status(200).json({
    success: true,
    message: 'Backend server is running successfully',
    status: 'OK',
    timestamp: new Date().toISOString(),
  });
}

async function readiness(req, res, next) {
  try {
    await checkDatabaseConnection();
    res.status(200).json({ success: true, status: 'READY' });
  } catch (error) {
    error.status = 503;
    next(error);
  }
}

module.exports = { health, readiness };
