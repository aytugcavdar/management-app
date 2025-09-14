const Joi = require('joi');

class WorkspaceValidators {
  static createWorkspaceSchema = Joi.object({
    name: Joi.string().min(1).max(100).required().messages({
      'string.min': 'Workspace name cannot be empty',
      'string.max': 'Workspace name cannot exceed 100 characters',
      'any.required': 'Workspace name is required'
    }),
    description: Joi.string().max(500).allow('').optional(),
    isPrivate: Joi.boolean().default(false),
    settings: Joi.object({
      allowInvitations: Joi.boolean().default(true),
      requireApproval: Joi.boolean().default(false)
    }).optional()
  });

  static updateWorkspaceSchema = Joi.object({
    name: Joi.string().min(1).max(100),
    description: Joi.string().max(500).allow(''),
    isPrivate: Joi.boolean(),
    settings: Joi.object({
      allowInvitations: Joi.boolean(),
      requireApproval: Joi.boolean()
    })
  }).min(1);

  static inviteMemberSchema = Joi.object({
    email: Joi.string().email().required(),
    role: Joi.string().valid('admin', 'member', 'viewer').default('member'),
    message: Joi.string().max(200).optional()
  });
}

module.exports = WorkspaceValidators;