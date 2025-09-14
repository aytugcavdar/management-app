const { httpStatus } = require('../constants');
const ResponseFormatter = require('../helpers/responseFormatter');
const logger = require('../logger');

class ErrorHandler {
  static handle(err, req, res, next) {
    logger.error('Error occurred:', {
      error: err.message,
      stack: err.stack,
      url: req.url,
      method: req.method,
      ip: req.ip,
      userAgent: req.get('User-Agent')
    });

    // Joi validation error
    if (err.isJoi) {
      const errors = err.details.map(detail => ({
        field: detail.path.join('.'),
        message: detail.message
      }));
      
      return res.status(httpStatus.BAD_REQUEST).json(
        ResponseFormatter.error('Validation error', httpStatus.BAD_REQUEST, errors)
      );
    }

    // MongoDB duplicate key error
    if (err.code === 11000) {
      const field = Object.keys(err.keyValue)[0];
      return res.status(httpStatus.CONFLICT).json(
        ResponseFormatter.error(`${field} already exists`, httpStatus.CONFLICT)
      );
    }

    // MongoDB cast error
    if (err.name === 'CastError') {
      return res.status(httpStatus.BAD_REQUEST).json(
        ResponseFormatter.error('Invalid ID format', httpStatus.BAD_REQUEST)
      );
    }

    // JWT error
    if (err.name === 'JsonWebTokenError') {
      return res.status(httpStatus.UNAUTHORIZED).json(
        ResponseFormatter.error('Invalid token', httpStatus.UNAUTHORIZED)
      );
    }

    // Default server error
    res.status(httpStatus.INTERNAL_SERVER_ERROR).json(
      ResponseFormatter.error(
        process.env.NODE_ENV === 'production' ? 'Internal server error' : err.message,
        httpStatus.INTERNAL_SERVER_ERROR
      )
    );
  }

  static notFound(req, res) {
    res.status(httpStatus.NOT_FOUND).json(
      ResponseFormatter.error(`Route ${req.originalUrl} not found`, httpStatus.NOT_FOUND)
    );
  }

  static asyncHandler(fn) {
    return (req, res, next) => {
      Promise.resolve(fn(req, res, next)).catch(next);
    };
  }
}

module.exports = ErrorHandler;