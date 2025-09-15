const express = require('express');
const ListController = require('../controllers/listController');

const {
  validators: { commonValidators },
  middleware: { authMiddleware }
} = require('@management-app/shared-utils');

const router = express.Router();

// All list routes require authentication
router.use(authMiddleware.verifyToken);

// Get lists by board
router.get(
  '/board/:boardId',
  commonValidators.validateMongoId('boardId'),
  ListController.getListsByBoard
);

// Create new list
router.post(
  '/',
  commonValidators.validateRequestBody({
    name: require('joi').string().min(1).max(100).required(),
    boardId: require('joi').string().pattern(/^[0-9a-fA-F]{24}$/).required(),
    position: require('joi').number().integer().min(0).optional()
  }),
  ListController.createList
);

// Get list by ID
router.get(
  '/:listId',
  commonValidators.validateMongoId('listId'),
  ListController.getListById
);

// Update list
router.put(
  '/:listId',
  commonValidators.validateMongoId('listId'),
  commonValidators.validateRequestBody({
    name: require('joi').string().min(1).max(100).required()
  }),
  ListController.updateList
);

// Move list (change position)
router.patch(
  '/:listId/move',
  commonValidators.validateMongoId('listId'),
  commonValidators.validateRequestBody({
    position: require('joi').number().integer().min(0).required()
  }),
  ListController.moveList
);

// Archive list
router.patch(
  '/:listId/archive',
  commonValidators.validateMongoId('listId'),
  ListController.archiveList
);

// Unarchive list
router.patch(
  '/:listId/unarchive',
  commonValidators.validateMongoId('listId'),
  ListController.unarchiveList
);

// Delete list permanently
router.delete(
  '/:listId',
  commonValidators.validateMongoId('listId'),
  ListController.deleteList
);

// Copy list to another board
router.post(
  '/:listId/copy',
  commonValidators.validateMongoId('listId'),
  commonValidators.validateRequestBody({
    targetBoardId: require('joi').string().pattern(/^[0-9a-fA-F]{24}$/).required(),
    name: require('joi').string().min(1).max(100).optional(),
    includeCards: require('joi').boolean().default(true)
  }),
  ListController.copyList
);

module.exports = router;