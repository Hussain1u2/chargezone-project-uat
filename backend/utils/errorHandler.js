function sanitizeErrorMessage(err, defaultStatus = 500) {
  const status = (err && (err.status || err.statusCode)) || defaultStatus;
  const rawMsg = String((err && err.message) || err || '');

  if (err && err.code) {
    const code = String(err.code);
    if (code === '23505') {
      return { status: 409, message: 'A record with this identifier already exists' };
    }
    if (code === '23503') {
      return { status: 400, message: 'Referenced record does not exist' };
    }
    if (code === '23502') {
      return { status: 400, message: 'A required field is missing' };
    }
    if (code === '22P02') {
      return { status: 400, message: 'Invalid parameter input format' };
    }
    if (code.startsWith('23') || code.startsWith('42') || code.startsWith('08')) {
      return { status: 400, message: 'Invalid data request or constraint violation' };
    }
  }

  const containsSensitiveDetails = (
    /\\[a-zA-Z0-9_\-\\]+\.js/.test(rawMsg) ||
    /\/[a-zA-Z0-9_\-\/]+\.js/.test(rawMsg) ||
    /node_modules/i.test(rawMsg) ||
    /at\s+[a-zA-Z0-9_\.\s]+\(/.test(rawMsg) ||
    /SELECT\s+|INSERT\s+|UPDATE\s+|DELETE\s+|JOIN\s+|FROM\s+/i.test(rawMsg) ||
    /violates\s+foreign\s+key|duplicate\s+key|syntax\s+error\s+at\s+or\s+near|relation\s+".*"\s+does\s+not\s+exist/i.test(rawMsg)
  );

  if (containsSensitiveDetails) {
    return {
      status: status >= 500 ? 500 : status,
      message: status >= 500 ? 'An internal server error occurred. Please try again later.' : 'Invalid request parameters'
    };
  }

  if (status >= 500 && (!err || !err.isOperational)) {
    return {
      status: 500,
      message: 'An internal server error occurred. Please try again later.'
    };
  }

  return {
    status,
    message: rawMsg || 'Request failed'
  };
}

function handleRouteError(res, err, defaultStatus = 400) {
  console.error('Route error:', err);
  const { status, message } = sanitizeErrorMessage(err, defaultStatus);
  res.status(status).json({ error: message });
}

function expressErrorHandler(err, req, res, next) {
  console.error('Server error:', err);
  const { status, message } = sanitizeErrorMessage(err, 500);
  res.status(status).json({ error: message });
}

module.exports = {
  sanitizeErrorMessage,
  handleRouteError,
  expressErrorHandler
};

