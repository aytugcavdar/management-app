const express = require('express');
const WorkspaceController = require('../controllers/workspaceController');

const {
  validators: { workspaceValidators, commonValidators },
  middleware: { authMiddleware },
  constants: { userRoles }
} = require('@management-app/shared-utils');

const router = express.Router();

// All workspace routes require authentication
router.use(authMiddleware.verifyToken);

// Create new workspace
router.post(
  '/',
  commonValidators.validateRequestBody(workspaceValidators.createWorkspaceSchema),
  WorkspaceController.createWorkspace
);

// Get user's workspaces with pagination and search
router.get(
  '/',
  commonValidators.validatePagination,
  WorkspaceController.getUserWorkspaces
);

// Get workspace by ID
router.get(
  '/:workspaceId',
  commonValidators.validateMongoId('workspaceId'),
  WorkspaceController.getWorkspaceById
);

// Update workspace (admin only)
router.put(
  '/:workspaceId',
  commonValidators.validateMongoId('workspaceId'),
  commonValidators.validateRequestBody(workspaceValidators.updateWorkspaceSchema),
  WorkspaceController.updateWorkspace
);

// Delete workspace (owner only)
router.delete(
  '/:workspaceId',
  commonValidators.validateMongoId('workspaceId'),
  WorkspaceController.deleteWorkspace
);

// Invite user to workspace
router.post(
  '/:workspaceId/invite',
  commonValidators.validateMongoId('workspaceId'),
  commonValidators.validateRequestBody(workspaceValidators.inviteMemberSchema),
  WorkspaceController.inviteUser
);

// Add member to workspace
router.post(
  '/:workspaceId/members',
  commonValidators.validateMongoId('workspaceId'),
  commonValidators.validateRequestBody({
    userId: require('joi').string().pattern(/^[0-9a-fA-F]{24}$/).required(),
    role: require('joi').string().valid('admin', 'member', 'viewer').default('member')
  }),
  WorkspaceController.addMember
);

// Remove member from workspace
router.delete(
  '/:workspaceId/members/:memberId',
  commonValidators.validateMongoId('workspaceId'),
  commonValidators.validateMongoId('memberId'),
  WorkspaceController.removeMember
);

// Update member role
router.patch(
  '/:workspaceId/members/:memberId/role',
  commonValidators.validateMongoId('workspaceId'),
  commonValidators.validateMongoId('memberId'),
  commonValidators.validateRequestBody({
    role: require('joi').string().valid('admin', 'member', 'viewer').required()
  }),
  WorkspaceController.updateMemberRole
);

// Get workspace statistics
router.get(
  '/:workspaceId/stats',
  commonValidators.validateMongoId('workspaceId'),
  WorkspaceController.getWorkspaceStats
);

module.exports = router;