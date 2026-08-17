const { Pool, types } = require('pg');
const path = require('path');
require('dotenv').config();
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

types.setTypeParser(types.builtins.NUMERIC, parseFloat);
types.setTypeParser(types.builtins.INT8, (value) => parseInt(value, 10));

const connectionString = process.env.DATABASE_URL || process.env.POSTGRES_URL;

let poolConfig = {};

if (connectionString) {
  poolConfig = {
    connectionString,
    ssl: process.env.DB_SSL === 'false' ? false : { rejectUnauthorized: false },
    max: 10
  };
} else {
  const isSSL = process.env.DB_SSL === 'true';
  poolConfig = {
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432', 10),
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'chargezone_inventory',
    ssl: isSSL ? { rejectUnauthorized: false } : false,
    max: 10
  };
}

const pool = new Pool(poolConfig);

pool.on('error', (err) => {
  console.error('[Database Pool Error] Unexpected error on idle PostgreSQL client:', err);
});

module.exports = pool;

