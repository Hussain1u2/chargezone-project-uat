require('dotenv').config();
require('express-async-errors');
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const pool = require('./config/db');
const { publicLimiter, authenticatedUserLimiter } = require('./middleware/rateLimiter');

if (!process.env.JWT_SECRET) {
  console.warn('Warning: JWT_SECRET is not set. Using fallback secret key.');
  process.env.JWT_SECRET = 'chargezone_dev_jwt_secret_key_change_in_production_2026';
}

const authRoutes = require('./routes/auth');
const regionRoutes = require('./routes/regions');
const materialRoutes = require('./routes/materials');
const purchaseOrderRoutes = require('./routes/purchaseOrders');
const itemRoutes = require('./routes/items');
const transactionRoutes = require('./routes/transactions');
const requisitionRoutes = require('./routes/requisitions');
const replacementRoutes = require('./routes/replacements');
const consumptionRoutes = require('./routes/consumptions');
const dashboardRoutes = require('./routes/dashboard');
const userRoutes = require('./routes/users');

const app = express();
app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginResourcePolicy: { policy: "cross-origin" }
}));

const path = require('path');

app.set('trust proxy', 1);
const corsOptions = process.env.CORS_ORIGIN ? { origin: process.env.CORS_ORIGIN } : {};
app.use(cors(corsOptions));
app.use(express.json());

const handleHealth = async (req, res) => {
  try {
    const dbRes = await pool.query('SELECT NOW() AS current_time');
    res.json({
      status: 'ok',
      database: 'connected',
      dbTime: dbRes.rows[0].current_time,
      serverTime: new Date().toISOString()
    });
  } catch (err) {
    res.status(503).json({
      status: 'error',
      database: 'disconnected',
      error: err.message,
      serverTime: new Date().toISOString()
    });
  }
};

app.get('/api/health', publicLimiter, handleHealth);
app.get('/health', publicLimiter, handleHealth);

app.use('/api/auth', authRoutes);
app.use('/auth', authRoutes);

app.use('/api/regions', authenticatedUserLimiter, regionRoutes);
app.use('/regions', authenticatedUserLimiter, regionRoutes);

app.use('/api/zones', authenticatedUserLimiter, regionRoutes);
app.use('/zones', authenticatedUserLimiter, regionRoutes);

app.use('/api/materials', authenticatedUserLimiter, materialRoutes);
app.use('/materials', authenticatedUserLimiter, materialRoutes);

app.use('/api/purchase-orders', authenticatedUserLimiter, purchaseOrderRoutes);
app.use('/purchase-orders', authenticatedUserLimiter, purchaseOrderRoutes);

app.use('/api/items', authenticatedUserLimiter, itemRoutes);
app.use('/items', authenticatedUserLimiter, itemRoutes);

app.use('/api/transactions', authenticatedUserLimiter, transactionRoutes);
app.use('/transactions', authenticatedUserLimiter, transactionRoutes);

app.use('/api/requisitions', authenticatedUserLimiter, requisitionRoutes);
app.use('/requisitions', authenticatedUserLimiter, requisitionRoutes);

app.use('/api/replacements', authenticatedUserLimiter, replacementRoutes);
app.use('/replacements', authenticatedUserLimiter, replacementRoutes);

app.use('/api/consumptions', authenticatedUserLimiter, consumptionRoutes);
app.use('/consumptions', authenticatedUserLimiter, consumptionRoutes);

app.use('/api/dashboard', authenticatedUserLimiter, dashboardRoutes);
app.use('/dashboard', authenticatedUserLimiter, dashboardRoutes);

app.use('/api/users', authenticatedUserLimiter, userRoutes);
app.use('/users', authenticatedUserLimiter, userRoutes);

const frontendPath = path.join(__dirname, '../frontend');
app.use(express.static(frontendPath, { dotfiles: 'allow' }));
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api')) return next();
  res.sendFile(path.join(frontendPath, 'index.html'));
});

const { expressErrorHandler } = require('./utils/errorHandler');

app.use(expressErrorHandler);


const PORT = process.env.PORT || 4000;
if (process.env.NODE_ENV !== 'production' || !process.env.VERCEL) {
  app.listen(PORT, () => {
    console.log(`Server listening on port ${PORT}`);
  });
}

module.exports = app;