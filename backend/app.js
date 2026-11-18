require('./config/env').validateEnvironment();

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const healthRoutes = require('./routes/healthRoutes');
const authRoutes = require('./routes/authRoutes');
const adminUserRoutes = require('./routes/adminUserRoutes');
const farmerRoutes = require('./routes/farmerRoutes');
const marketplaceRoutes = require('./routes/marketplaceRoutes');
const { notFound, errorHandler } = require('./middleware/errorHandler');
const path = require('node:path');

const app = express();
const configuredOrigins = (process.env.FRONTEND_ORIGINS || '')
  .split(',').map((origin) => origin.trim()).filter(Boolean);
const allowedOrigins = configuredOrigins.length
  ? configuredOrigins
  : ['http://localhost:3000', 'http://localhost:5173', 'http://localhost:4173'];

app.use(helmet());
app.use(cors({
  origin(origin, callback) {
    if (!origin || allowedOrigins.includes(origin)) return callback(null, true);
    const error = new Error('Origin is not allowed by CORS');
    error.status = 403;
    return callback(error);
  },
}));
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));
app.use(morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev'));
app.use('/uploads', express.static(path.join(__dirname, 'uploads'), { dotfiles: 'deny', index: false }));
app.use('/api', healthRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/admin/users', adminUserRoutes);
app.use('/api/farmer', farmerRoutes);
app.use('/api/marketplace', marketplaceRoutes);
app.use(notFound);
app.use(errorHandler);

module.exports = app;
