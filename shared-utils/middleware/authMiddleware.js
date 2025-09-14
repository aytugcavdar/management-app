const jwt = require('jsonwebtoken');
const { httpStatus } = require('../constants');
const ResponseFormatter = require('../helpers/responseFormatter');

class AuthMiddleware {
  static verifyToken(req, res, next) {
    try {
      const token = req.header('Authorization')?.replace('Bearer ', '');
      
      if (!token) {
        return res.status(httpStatus.UNAUTHORIZED).json(
          ResponseFormatter.error('Access denied. No token provided.', httpStatus.UNAUTHORIZED)
        );
      }

      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      req.user = decoded;
      next();
    } catch (error) {
      return res.status(httpStatus.UNAUTHORIZED).json(
        ResponseFormatter.error('Invalid token.', httpStatus.UNAUTHORIZED)
      );
    }
  }

  static requireRole(allowedRoles) {
    return (req, res, next) => {
      if (!req.user) {
        return res.status(httpStatus.UNAUTHORIZED).json(
          ResponseFormatter.error('Authentication required.', httpStatus.UNAUTHORIZED)
        );
      }

      if (!allowedRoles.includes(req.user.role)) {
        return res.status(httpStatus.FORBIDDEN).json(
          ResponseFormatter.error('Insufficient permissions.', httpStatus.FORBIDDEN)
        );
      }

      next();
    };
  }

  static optionalAuth(req, res, next) {
    try {
      const token = req.header('Authorization')?.replace('Bearer ', '');
      
      if (token) {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        req.user = decoded;
      }
      
      next();
    } catch (error) {
      // Token varsa ama geçersizse hata ver
      if (req.header('Authorization')) {
        return res.status(httpStatus.UNAUTHORIZED).json(
          ResponseFormatter.error('Invalid token.', httpStatus.UNAUTHORIZED)
        );
      }
      next();
    }
  }
}

module.exports = AuthMiddleware;