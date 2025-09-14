const Joi = require('joi');

class CommonValidators {
  static mongoIdSchema = Joi.string().pattern(/^[0-9a-fA-F]{24}$/).required();
  
  static paginationSchema = Joi.object({
    page: Joi.number().integer().min(1).default(1),
    limit: Joi.number().integer().min(1).max(100).default(10),
    sort: Joi.string().valid('createdAt', '-createdAt', 'updatedAt', '-updatedAt', 'name', '-name').default('-createdAt'),
    search: Joi.string().max(100).optional()
  });

  static validatePagination(req, res, next) {
    const { error, value } = CommonValidators.paginationSchema.validate(req.query);
    
    if (error) {
      return res.status(400).json({
        success: false,
        message: 'Invalid pagination parameters',
        errors: error.details.map(detail => ({
          field: detail.path.join('.'),
          message: detail.message
        }))
      });
    }
    
    req.pagination = value;
    next();
  }

  static validateMongoId(paramName) {
    return (req, res, next) => {
      const id = req.params[paramName];
      const { error } = CommonValidators.mongoIdSchema.validate(id);
      
      if (error) {
        return res.status(400).json({
          success: false,
          message: `Invalid ${paramName} format`
        });
      }
      
      next();
    };
  }

  static validateRequestBody(schema) {
    return (req, res, next) => {
      const { error, value } = schema.validate(req.body);
      
      if (error) {
        const errors = error.details.map(detail => ({
          field: detail.path.join('.'),
          message: detail.message,
          value: detail.context?.value
        }));
        
        return res.status(400).json({
          success: false,
          message: 'Validation failed',
          errors
        });
      }
      
      req.validatedBody = value;
      next();
    };
  }
}

module.exports = CommonValidators;