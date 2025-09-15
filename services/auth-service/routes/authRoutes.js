const express = require('express');
const AuthController = require('../controllers/authController');

const {
  validators: { userValidators, commonValidators },
  middleware: { authMiddleware, errorHandler }
} = require('@management-app/shared-utils');

const router = express.Router();

// Public routes (no authentication required)
router.post(
  '/register',
  commonValidators.validateRequestBody(userValidators.registerSchema),
  AuthController.register
);

router.post(
  '/login',
  commonValidators.validateRequestBody(userValidators.loginSchema),
  AuthController.login
);

router.get(
  '/verify-email/:token',
  AuthController.verifyEmail
);

router.post(
  '/resend-verification',
  commonValidators.validateRequestBody({
    email: require('joi').string().email().required()
  }),
  AuthController.resendEmailVerification
);

router.post(
  '/forgot-password',
  commonValidators.validateRequestBody({
    email: require('joi').string().email().required()
  }),
  AuthController.forgotPassword
);

router.post(
  '/reset-password/:token',
  commonValidators.validateRequestBody({
    password: require('joi').string().min(8).required(),
    confirmPassword: require('joi').string().valid(require('joi').ref('password')).required()
      .messages({ 'any.only': 'Passwords do not match' })
  }),
  AuthController.resetPassword
);

// Protected routes (authentication required)
router.use(authMiddleware.verifyToken);

router.get(
  '/profile',
  AuthController.getProfile
);

router.put(
  '/profile',
  commonValidators.validateRequestBody(userValidators.updateProfileSchema),
  AuthController.updateProfile
);

router.post(
  '/change-password',
  commonValidators.validateRequestBody(userValidators.changePasswordSchema),
  AuthController.changePassword
);

router.post(
  '/refresh-token',
  AuthController.refreshToken
);

module.exports = router;

// services/auth-service/routes/userRoutes.js
const express = require('express');
const UserController = require('../controllers/userController');

const {
  validators: { commonValidators },
  middleware: { authMiddleware, errorHandler },
  constants: { userRoles }
} = require('@management-app/shared-utils');

const router = express.Router();

// All user routes require authentication
router.use(authMiddleware.verifyToken);

// Get all users (with pagination and search)
router.get(
  '/',
  commonValidators.validatePagination,
  errorHandler.asyncHandler(UserController.getAllUsers)
);

// Get user by ID
router.get(
  '/:userId',
  commonValidators.validateMongoId('userId'),
  errorHandler.asyncHandler(UserController.getUserById)
);

// Search users
router.get(
  '/search/:query',
  errorHandler.asyncHandler(UserController.searchUsers)
);

// Admin only routes
router.use(authMiddleware.requireRole([userRoles.ADMIN]));

// Update user (admin only)
router.put(
  '/:userId',
  commonValidators.validateMongoId('userId'),
  commonValidators.validateRequestBody({
    name: require('joi').string().min(2).max(50),
    role: require('joi').string().valid(...Object.values(userRoles)),
    isActive: require('joi').boolean()
  }),
  errorHandler.asyncHandler(UserController.updateUser)
);

// Deactivate user (admin only)
router.patch(
  '/:userId/deactivate',
  commonValidators.validateMongoId('userId'),
  errorHandler.asyncHandler(UserController.deactivateUser)
);

// Activate user (admin only)
router.patch(
  '/:userId/activate',
  commonValidators.validateMongoId('userId'),
  errorHandler.asyncHandler(UserController.activateUser)
);

// Delete user (admin only)
router.delete(
  '/:userId',
  commonValidators.validateMongoId('userId'),
  errorHandler.asyncHandler(UserController.deleteUser)
);

module.exports = router;