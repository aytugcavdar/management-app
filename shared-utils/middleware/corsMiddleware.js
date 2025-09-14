const { httpStatus } = require('../constants');

class CorsMiddleware {
  static configure(options = {}) {
    const defaultOptions = {
      origin: process.env.NODE_ENV === 'production' 
        ? ['https://yourdomain.com'] 
        : ['http://localhost:3000', 'http://localhost:3005'],
      methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
      credentials: true,
      maxAge: 86400 // 24 hours
    };
    
    const config = { ...defaultOptions, ...options };
    
    return (req, res, next) => {
      const origin = req.headers.origin;
      
      // Check if origin is allowed
      if (config.origin.includes(origin) || config.origin.includes('*')) {
        res.setHeader('Access-Control-Allow-Origin', origin);
      }
      
      res.setHeader('Access-Control-Allow-Methods', config.methods.join(', '));
      res.setHeader('Access-Control-Allow-Headers', config.allowedHeaders.join(', '));
      res.setHeader('Access-Control-Allow-Credentials', config.credentials);
      res.setHeader('Access-Control-Max-Age', config.maxAge);
      
      // Handle preflight requests
      if (req.method === 'OPTIONS') {
        return res.status(httpStatus.NO_CONTENT).end();
      }
      
      next();
    };
  }
}

module.exports = CorsMiddleware;