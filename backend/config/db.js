const { Pool, types } = require('pg');
require('dotenv').config();

types.setTypeParser(types.builtins.NUMERIC, parseFloat);
types.setTypeParser(types.builtins.INT8, (value) => parseInt(value, 10));

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: process.env.DB_PORT || 5432,
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'chargezone_inventory',
  max: 10
});

pool.on('error', (err) => {
  console.error('[Database Pool Error] Unexpected error on idle PostgreSQL client:', err);
});

module.exports = pool;

