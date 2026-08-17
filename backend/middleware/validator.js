const EMAIL_REGEX = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
const CODE_REGEX = /^[a-zA-Z0-9_-]+$/;

class ValidationError extends Error {
  constructor(errors) {
    super('Validation Error');
    this.name = 'ValidationError';
    this.errors = errors;
  }
}

const v = {
  string({ min = 0, max = 255, format, enum: allowedValues, required = true } = {}) {
    return (val, key) => {
      if (val === undefined || val === null || val === '') {
        if (required) return `'${key}' is required`;
        return null;
      }
      if (typeof val !== 'string') return `'${key}' must be a string`;
      const trimmed = val.trim();
      if (trimmed.length < min) return `'${key}' must be at least ${min} characters long`;
      if (trimmed.length > max) return `'${key}' cannot exceed ${max} characters`;
      if (allowedValues && !allowedValues.includes(trimmed)) {
        return `'${key}' must be one of: ${allowedValues.join(', ')}`;
      }
      if (format === 'email' && !EMAIL_REGEX.test(trimmed)) {
        return `'${key}' must be a valid email address`;
      }
      if (format === 'code' && !CODE_REGEX.test(trimmed)) {
        return `'${key}' can only contain letters, numbers, underscores, and hyphens`;
      }
      return null;
    };
  },

  email({ max = 255, required = true } = {}) {
    return v.string({ min: 3, max, format: 'email', required });
  },

  phone({ required = true } = {}) {
    return (val, key) => {
      if (val === undefined || val === null || val === '') {
        if (required) return `'${key}' is required`;
        return null;
      }
      const valStr = String(val).trim();
      const normalized = valStr.replace(/\D/g, ''); // Extract only digits
      if (normalized.length !== 10 && normalized.length !== 12) {
        return `'${key}' must be a valid 10-digit phone number or 12-digit number with country code (e.g. 9876543210 or +919876543210)`;
      }
      return null;
    };
  },

  integer({ min, max, positive = false, required = true } = {}) {
    return (val, key) => {
      if (val === undefined || val === null || val === '') {
        if (required) return `'${key}' is required`;
        return null;
      }
      const num = Number(val);
      if (!Number.isInteger(num)) return `'${key}' must be an integer`;
      if (positive && num <= 0) return `'${key}' must be a positive integer (> 0)`;
      if (min !== undefined && num < min) return `'${key}' cannot be less than ${min}`;
      if (max !== undefined && num > max) return `'${key}' cannot exceed ${max}`;
      return null;
    };
  },

  number({ min, max, positive = false, required = true } = {}) {
    return (val, key) => {
      if (val === undefined || val === null || val === '') {
        if (required) return `'${key}' is required`;
        return null;
      }
      const num = Number(val);
      if (isNaN(num)) return `'${key}' must be a valid number`;
      if (positive && num <= 0) return `'${key}' must be positive (> 0)`;
      if (min !== undefined && num < min) return `'${key}' cannot be less than ${min}`;
      if (max !== undefined && num > max) return `'${key}' cannot exceed ${max}`;
      return null;
    };
  },

  boolean({ required = false } = {}) {
    return (val, key) => {
      if (val === undefined || val === null) {
        if (required) return `'${key}' is required`;
        return null;
      }
      if (typeof val !== 'boolean' && val !== 'true' && val !== 'false') {
        return `'${key}' must be a boolean`;
      }
      return null;
    };
  },

  enum(allowedValues, { required = true } = {}) {
    return (val, key) => {
      if (val === undefined || val === null || val === '') {
        if (required) return `'${key}' is required`;
        return null;
      }
      if (!allowedValues.includes(val)) {
        return `'${key}' must be one of: ${allowedValues.join(', ')}`;
      }
      return null;
    };
  },

  array({ itemValidator, minLength = 0, maxLength = 100, required = true } = {}) {
    return (val, key) => {
      if (val === undefined || val === null) {
        if (required) return `'${key}' is required`;
        return null;
      }
      if (!Array.isArray(val)) return `'${key}' must be an array`;
      if (val.length < minLength) return `'${key}' must contain at least ${minLength} items`;
      if (val.length > maxLength) return `'${key}' cannot contain more than ${maxLength} items`;
      if (itemValidator) {
        for (let i = 0; i < val.length; i++) {
          const itemError = itemValidator(val[i], `${key}[${i}]`);
          if (itemError) return itemError;
        }
      }
      return null;
    };
  },

  object(shape, { required = true } = {}) {
    return (val, key) => {
      if (val === undefined || val === null) {
        if (required) return `'${key}' is required`;
        return null;
      }
      if (typeof val !== 'object' || Array.isArray(val)) return `'${key}' must be an object`;
      for (const [subKey, validatorFn] of Object.entries(shape)) {
        const err = validatorFn(val[subKey], `${key}.${subKey}`);
        if (err) return err;
      }
      return null;
    };
  }
};

function validate({ body, params, query }) {
  return (req, res, next) => {
    const errors = [];

    if (body) {
      for (const [key, validatorFn] of Object.entries(body)) {
        const err = validatorFn(req.body ? req.body[key] : undefined, key);
        if (err) errors.push(err);
      }
    }

    if (params) {
      for (const [key, validatorFn] of Object.entries(params)) {
        const err = validatorFn(req.params ? req.params[key] : undefined, key);
        if (err) errors.push(err);
      }
    }

    if (query) {
      for (const [key, validatorFn] of Object.entries(query)) {
        const err = validatorFn(req.query ? req.query[key] : undefined, key);
        if (err) errors.push(err);
      }
    }

    if (errors.length > 0) {
      return res.status(400).json({
        error: 'Validation Error',
        details: errors
      });
    }

    next();
  };
}

module.exports = { v, validate, ValidationError };
