function notFound(req, res, next) {
  const error = new Error(`Route not found: ${req.method} ${req.originalUrl}`);
  error.status = 404;
  next(error);
}

function errorHandler(error, req, res, next) {
  if (res.headersSent) return next(error);
  const status = Number.isInteger(error.status) ? error.status : 500;
  console.error(`[${new Date().toISOString()}] ${req.method} ${req.originalUrl}`, error);
  const exposeDetails = process.env.NODE_ENV !== 'production' || status < 500;
  res.status(status).json({
    success: false,
    message: status === 404 ? 'Route not found' : (status >= 500 ? 'An error occurred' : error.message),
    error: exposeDetails ? error.message : 'Internal server error',
  });
}

module.exports = { notFound, errorHandler };
