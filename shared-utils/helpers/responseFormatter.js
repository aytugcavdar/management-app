const httpStatus = require('../constants/httpStatus');

class ResponseFormatter {
  static success(data = null, message = 'Success', statusCode = httpStatus.OK) {
    return {
      success: true,
      message,
      data,
      statusCode,
      timestamp: new Date().toISOString()
    };
  }
  
  static error(message = 'Internal Server Error', statusCode = httpStatus.INTERNAL_SERVER_ERROR, errors = null) {
    return {
      success: false,
      message,
      errors,
      statusCode,
      timestamp: new Date().toISOString()
    };
  }
  
  static paginated(data, pagination, message = 'Success') {
    return {
      success: true,
      message,
      data,
      pagination: {
        page: pagination.page || 1,
        limit: pagination.limit || 10,
        total: pagination.total || 0,
        totalPages: Math.ceil((pagination.total || 0) / (pagination.limit || 10)),
        hasNext: pagination.page < Math.ceil((pagination.total || 0) / (pagination.limit || 10)),
        hasPrev: pagination.page > 1
      },
      timestamp: new Date().toISOString()
    };
  }
}

module.exports = ResponseFormatter;