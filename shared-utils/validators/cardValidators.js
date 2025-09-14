const Joi = require('joi');
const { cardStatuses, priorities } = require('../constants');

class CardValidators {
  static createCardSchema = Joi.object({
    title: Joi.string().min(1).max(200).required(),
    description: Joi.string().max(2000).allow('').optional(),
    listId: Joi.string().pattern(/^[0-9a-fA-F]{24}$/).required(),
    assignedTo: Joi.array().items(Joi.string().pattern(/^[0-9a-fA-F]{24}$/)).optional(),
    priority: Joi.string().valid(...Object.values(priorities)).default(priorities.MEDIUM),
    dueDate: Joi.date().greater('now').optional(),
    labels: Joi.array().items(Joi.string().max(30)).max(10).optional(),
    position: Joi.number().min(0).optional()
  });

  static updateCardSchema = Joi.object({
    title: Joi.string().min(1).max(200),
    description: Joi.string().max(2000).allow(''),
    assignedTo: Joi.array().items(Joi.string().pattern(/^[0-9a-fA-F]{24}$/)),
    priority: Joi.string().valid(...Object.values(priorities)),
    dueDate: Joi.date().greater('now').allow(null),
    labels: Joi.array().items(Joi.string().max(30)).max(10),
    status: Joi.string().valid(...Object.values(cardStatuses))
  }).min(1);

  static moveCardSchema = Joi.object({
    targetListId: Joi.string().pattern(/^[0-9a-fA-F]{24}$/).required(),
    position: Joi.number().min(0).required()
  });
}

module.exports = CardValidators;