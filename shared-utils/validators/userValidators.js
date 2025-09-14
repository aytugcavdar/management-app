const Joi = require('joi');
const { userRoles } = require('../constants');

class UserValidators {
  static registerSchema = Joi.object({
    name: Joi.string().min(2).max(50).required().messages({
      'string.min': 'Name must be at least 2 characters long',
      'string.max': 'Name cannot exceed 50 characters',
      'any.required': 'Name is required'
    }),
    email: Joi.string().email().required().messages({
      'string.email': 'Please provide a valid email address',
      'any.required': 'Email is required'
    }),
    password: Joi.string().min(8).required().messages({
      'string.min': 'Password must be at least 8 characters long',
      'any.required': 'Password is required'
    }),
    role: Joi.string().valid(...Object.values(userRoles)).default(userRoles.DEVELOPER)
  });

  static loginSchema = Joi.object({
    email: Joi.string().email().required(),
    password: Joi.string().required()
  });

  static updateProfileSchema = Joi.object({
    name: Joi.string().min(2).max(50),
    avatar: Joi.string().uri(),
    preferences: Joi.object({
      theme: Joi.string().valid('light', 'dark'),
      language: Joi.string().valid('en', 'tr')
    })
  });

  static changePasswordSchema = Joi.object({
    currentPassword: Joi.string().required(),
    newPassword: Joi.string().min(8).required(),
    confirmPassword: Joi.string().valid(Joi.ref('newPassword')).required()
      .messages({ 'any.only': 'Passwords do not match' })
  });
}

module.exports = UserValidators;