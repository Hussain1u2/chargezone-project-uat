const rateLimit = require('express-rate-limit');

const parseEnvInt = (key, fallback) => {
  const val = parseInt(process.env[key], 10);
  return !isNaN(val) && val > 0 ? val : fallback;
};

const AUTH_WINDOW_MS = parseEnvInt('RATE_LIMIT_AUTH_WINDOW_MS', 15 * 60 * 1000);
const AUTH_MAX_IP = parseEnvInt('RATE_LIMIT_AUTH_MAX', 15);

const PUBLIC_WINDOW_MS = parseEnvInt('RATE_LIMIT_PUBLIC_WINDOW_MS', 15 * 60 * 1000);
const PUBLIC_MAX = parseEnvInt('RATE_LIMIT_PUBLIC_MAX', 300);

const AUTHENTICATED_WINDOW_MS = parseEnvInt('RATE_LIMIT_AUTHENTICATED_WINDOW_MS', 15 * 60 * 1000);
const AUTHENTICATED_MAX = parseEnvInt('RATE_LIMIT_AUTHENTICATED_MAX', 1500);

const EXPONENTIAL_BASE_MS = parseEnvInt('RATE_LIMIT_EXPONENTIAL_BASE_MS', 1000);
const EXPONENTIAL_MAX_DELAY_MS = parseEnvInt('RATE_LIMIT_EXPONENTIAL_MAX_DELAY_MS', 30000);

const failureStore = new Map();

function getTrackKey(ip, email) {
  const normalizedEmail = (email || '').trim().toLowerCase();
  return normalizedEmail ? `${ip}:${normalizedEmail}` : `ip:${ip}`;
}

setInterval(() => {
  const now = Date.now();
  for (const [key, record] of failureStore.entries()) {
    if (now - record.lastFailure > AUTH_WINDOW_MS) {
      failureStore.delete(key);
    }
  }
}, 10 * 60 * 1000).unref();

async function authExponentialBackoff(req, res, next) {
  const ip = req.ip || req.socket.remoteAddress || '127.0.0.1';
  const email = req.body && req.body.email;
  const key = getTrackKey(ip, email);
  const record = failureStore.get(key);

  if (record && record.count > 0) {
    const delay = Math.min(
      EXPONENTIAL_BASE_MS * Math.pow(2, record.count - 1),
      EXPONENTIAL_MAX_DELAY_MS
    );
    await new Promise((resolve) => setTimeout(resolve, delay));
  }
  next();
}

function recordAuthFailure(req) {
  const ip = req.ip || req.socket.remoteAddress || '127.0.0.1';
  const email = req.body && req.body.email;
  const key = getTrackKey(ip, email);
  const record = failureStore.get(key) || { count: 0, lastFailure: 0 };
  record.count += 1;
  record.lastFailure = Date.now();
  failureStore.set(key, record);
}

function resetAuthFailure(req) {
  const ip = req.ip || req.socket.remoteAddress || '127.0.0.1';
  const email = req.body && req.body.email;
  const key = getTrackKey(ip, email);
  failureStore.delete(key);
}

const authLimiter = rateLimit({
  windowMs: AUTH_WINDOW_MS,
  max: AUTH_MAX_IP,
  keyGenerator: (req) => {
    const ip = req.ip || req.headers['x-forwarded-for'] || req.socket.remoteAddress || '127.0.0.1';
    const email = req.body && req.body.email;
    return getTrackKey(ip, email);
  },
  validate: false,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many authentication attempts. Please wait and try again later.' }
});

const publicLimiter = rateLimit({
  windowMs: PUBLIC_WINDOW_MS,
  max: PUBLIC_MAX,
  validate: false,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests on public endpoint, please try again later.' }
});

const authenticatedUserLimiter = rateLimit({
  windowMs: AUTHENTICATED_WINDOW_MS,
  max: AUTHENTICATED_MAX,
  validate: false,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Action rate limit exceeded. Please slow down.' }
});

module.exports = {
  authLimiter,
  authExponentialBackoff,
  recordAuthFailure,
  resetAuthFailure,
  publicLimiter,
  authenticatedUserLimiter
};

