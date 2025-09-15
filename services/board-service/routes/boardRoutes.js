const express = require('express');
const BoardController = require('../controllers/boardController');

const {
  validators: { boardValidators, commonValidators },
  middleware: { authMiddleware }
} = require('@management-app/shared-utils');

const router = express.Router();

// All board routes require authentication
router.use(authMiddleware.verifyToken);

// Get boards by workspace
router.get(
  '/workspace/:workspaceId',
  commonValidators.validateMongoId('workspaceId'),
  commonValidators.validatePagination,
  BoardController.getBoardsByWorkspace
);

// Create new board
router.post(
  '/',
  commonValidators.validateRequestBody(boardValidators.createBoardSchema),
  BoardController.createBoard
);

// Get board by ID with full details
router.get(
  '/:boardId',
  commonValidators.validateMongoId('boardId'),
  BoardController.getBoardById
);

// Update board
router.put(
  '/:boardId',
  commonValidators.validateMongoId('boardId'),
  commonValidators.validateRequestBody(boardValidators.updateBoardSchema),
  BoardController.updateBoard
);

// Archive board
router.patch(
  '/:boardId/archive',
  commonValidators.validateMongoId('boardId'),
  BoardController.archiveBoard
);

// Unarchive board
router.patch(
  '/:boardId/unarchive',
  commonValidators.validateMongoId('boardId'),
  BoardController.unarchiveBoard
);

// Delete board permanently
router.delete(
  '/:boardId',
  commonValidators.validateMongoId('boardId'),
  BoardController.deleteBoard
);

// Duplicate board
router.post(
  '/:boardId/duplicate',
  commonValidators.validateMongoId('boardId'),
  commonValidators.validateRequestBody({
    name: require('joi').string().min(1).max(100).optional(),
    includeCards: require('joi').boolean().default(false)
  }),
  BoardController.duplicateBoard
);

// Add member to board
router.post(
  '/:boardId/members',
  commonValidators.validateMongoId('boardId'),
  commonValidators.validateRequestBody(boardValidators.addMemberSchema),
  BoardController.addMember
);

// Remove member from board
router.delete(
  '/:boardId/members/:memberId',
  commonValidators.validateMongoId('boardId'),
  commonValidators.validateMongoId('memberId'),
  BoardController.removeMember
);

// Update member role
router.patch(
  '/:boardId/members/:memberId/role',
  commonValidators.validateMongoId('boardId'),
  commonValidators.validateMongoId('memberId'),
  commonValidators.validateRequestBody({
    role: require('joi').string().valid('admin', 'member', 'viewer').required()
  }),
  BoardController.updateMemberRole
);

// Get board statistics
router.get(
  '/:boardId/stats',
  commonValidators.validateMongoId('boardId'),
  BoardController.getBoardStats
);

// Search within board
router.get(
  '/:boardId/search',
  commonValidators.validateMongoId('boardId'),
  BoardController.searchBoard
);

// Export board data
router.get(
  '/:boardId/export',
  commonValidators.validateMongoId('boardId'),
  BoardController.exportBoard
);

module.exports = router;