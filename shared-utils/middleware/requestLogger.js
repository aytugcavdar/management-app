const logger = require('../logger');

class RequestLogger {
  static logRequest(req, res, next) {
    const startTime = Date.now();
    
    // Log incoming request
    logger.info(`Incoming ${req.method} ${req.url}`, {
      method: req.method,
      url: req.url,
      ip: req.ip,
      userAgent: req.get('User-Agent'),
      userId: req.user?.id || 'anonymous'
    });
    
    // Override res.end to log response
    const originalEnd = res.end;
    res.end = function(...args) {
      const duration = Date.now() - startTime;
      
      logger.info(`Response ${req.method} ${req.url}`, {
        method: req.method,
        url: req.url,
        statusCode: res.statusCode,
        duration: `${duration}ms`,
        userId: req.user?.id || 'anonymous'
      });
      
      originalEnd.apply(this, args);
    };
    
    next();
  }
}

module.exports = RequestLogger;