// ─── Global Error Handler ─────────────────────────────────────────────────────
const errorHandler = (err, req, res, next) => {
    let statusCode = err.statusCode || 500;
    let message = err.message || 'Internal Server Error';

    // Mongoose: Duplicate key
    if (err.code === 11000) {
        const field = Object.keys(err.keyValue)[0];
        message = `${field.charAt(0).toUpperCase() + field.slice(1)} already exists.`;
        statusCode = 409;
    }

    // Mongoose: Validation error
    if (err.name === 'ValidationError') {
        message = Object.values(err.errors).map((e) => e.message).join(', ');
        statusCode = 400;
    }

    // Mongoose: Cast error (invalid ObjectId)
    if (err.name === 'CastError') {
        message = `Invalid ${err.path}: ${err.value}`;
        statusCode = 400;
    }

    // JWT Errors
    if (err.name === 'JsonWebTokenError') {
        message = 'Invalid token.';
        statusCode = 401;
    }
    if (err.name === 'TokenExpiredError') {
        message = 'Token expired.';
        statusCode = 401;
    }

    if (process.env.NODE_ENV === 'development') {
        console.error('❌ Error:', err);
    }

    res.status(statusCode).json({
        success: false,
        message,
        ...(process.env.NODE_ENV === 'development' && { stack: err.stack }),
    });
};

// ─── Async Handler Wrapper (eliminates try/catch boilerplate) ─────────────────
const asyncHandler = (fn) => (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
};

// ─── 404 Handler ──────────────────────────────────────────────────────────────
const notFound = (req, res, next) => {
    const error = new Error(`Route not found: ${req.originalUrl}`);
    error.statusCode = 404;
    next(error);
};

module.exports = { errorHandler, asyncHandler, notFound };