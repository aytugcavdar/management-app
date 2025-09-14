const { httpStatus } = require('../constants');
const ResponseFormatter = require('../helpers/responseFormatter');

class RateLimiter {
  constructor() {
    this.requests = new Map();
  }

  createLimiter(windowMs = 15 * 60 * 1000, maxRequests = 100) {
    return (req, res, next) => {
      const key = req.ip || req.connection.remoteAddress;
      const now = Date.now();
      
      if (!this.requests.has(key)) {
        this.requests.set(key, []);
      }
      
      const userRequests = this.requests.get(key);
      
      // Remove expired requests
      while (userRequests.length > 0 && userRequests[0] <= now - windowMs) {
        userRequests.shift();
      }
      
      if (userRequests.length >= maxRequests) {
        return res.status(httpStatus.TOO_MANY_REQUESTS).json(
          ResponseFormatter.error('Too many requests', 429)
        );
      }
      
      userRequests.push(now);
      next();
    };
  }

  // Predefined limiters
  static strict = new RateLimiter().createLimiter(15 * 60 * 1000, 50); // 50 requests per 15 minutes
  static moderate = new RateLimiter().createLimiter(15 * 60 * 1000, 100); // 100 requests per 15 minutes
  static lenient = new RateLimiter().createLimiter(15 * 60 * 1000, 200); // 200 requests per 15 minutes
}

module.exports = RateLimiter;