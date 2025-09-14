const Joi = require('joi');

class BoardValidators {
  static createBoardSchema = Joi.object({
    name: Joi.string().min(1).max(100).required(),
    description: Joi.string().max(500).allow('').optional(),
    workspaceId: Joi.string().pattern(/^[0-9a-fA-F]{24}$/).required(),
    isPrivate: Joi.boolean().default(false),
    backgroundColor: Joi.string().pattern(/^#[0-9A-F]{6}$/i).optional(),
    backgroundImage: Joi.string().uri().optional()
  });

  static updateBoardSchema = Joi.object({
    name: Joi.string().min(1).max(100),
    description: Joi.string().max(500).allow(''),
    isPrivate: Joi.boolean(),
    backgroundColor: Joi.string().pattern(/^#[0-9A-F]{6}$/i),
    backgroundImage: Joi.string().uri()
  }).min(1);

  static addMemberSchema = Joi.object({
    userId: Joi.string().pattern(/^[0-9a-fA-F]{24}$/).required(),
    role: Joi.string().valid('admin', 'member', 'viewer').default('member')
  });
}

module.exports = BoardValidators;