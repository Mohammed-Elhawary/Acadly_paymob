const rateLimit = require('express-rate-limit');

// Use express-rate-limit directly
const checkPaymentLimiter = rateLimit({
    windowMs: 1 * 60 * 1000,
    max: 20,
    message: { error: 'Too many requests, please try again later.' },
    standardHeaders: true,
    legacyHeaders: false,
});

module.exports = { checkPaymentLimiter };
