const Joi = require('joi');

class BoardValidators {
  static createBoardSchema = Joi.object({
    name: Joi.string().min(1).max(100).required(),
    description: Joi.string().max(500).allow('').optional(),
    workspaceId: Joi.string().pattern(/^[0-9a-fA-F]{24}$/).required(),
    visibility: Joi.string().valid('private', 'workspace', 'public').default('workspace'),
    background: Joi.object({
      color: Joi.string().pattern(/^#[0-9A-F]{6}$/i).optional(),
      image: Joi.string().uri().optional()
    }).optional()
  });

  static updateBoardSchema = Joi.object({
    name: Joi.string().min(1).max(100),
    description: Joi.string().max(500).allow(''),
    visibility: Joi.string().valid('private', 'workspace', 'public'),
    background: Joi.object({
      color: Joi.string().pattern(/^#[0-9A-F]{6}$/i),
      image: Joi.string().uri().allow(null)
    })
  }).min(1);

  static addMemberSchema = Joi.object({
    userId: Joi.string().pattern(/^[0-9a-fA-F]{24}$/).required(),
    role: Joi.string().valid('admin', 'member', 'viewer').default('member')
  });
}

module.exports = BoardValidators;