const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const User = require('../models/User');

const {
  helpers: { ResponseFormatter, passwordUtils, stringHelpers },
  constants: { httpStatus, eventTypes },
  rabbitmq: { publisher },
  middleware: { errorHandler: { asyncHandler } },
  logger
} = require('@management-app/shared-utils');

class AuthController {
  // User registration
  static register = asyncHandler(async (req, res) => {
    const { name, email, password, role } = req.validatedBody;

    // Check if user already exists
    const existingUser = await User.findByEmail(email);
    if (existingUser) {
      return res.status(httpStatus.CONFLICT).json(
        ResponseFormatter.error('User already exists with this email', httpStatus.CONFLICT)
      );
    }

    // Hash password
    const hashedPassword = await passwordUtils.hash(password);

    // Generate email verification token
    const emailVerificationToken = crypto.randomBytes(32).toString('hex');

    // Create user
    const user = new User({
      name: stringHelpers.capitalizeWords(name),
      email: stringHelpers.normalizeEmail(email),
      password: hashedPassword,
      role,
      emailVerificationToken,
      emailVerificationExpires: Date.now() + 24 * 60 * 60 * 1000 // 24 hours
    });

    await user.save();

    logger.info(`New user registered: ${email}`, { userId: user._id });

    // Publish user registration event
    try {
      await publisher.publishUserEvent(eventTypes.USER_REGISTERED, {
        userId: user._id,
        email: user.email,
        name: user.name,
        emailVerificationToken,
        createdAt: user.createdAt
      });
    } catch (publishError) {
      logger.error('Failed to publish user registration event:', publishError);
      // Don't fail the registration if event publishing fails
    }

    // Generate JWT token
    const token = AuthController.generateToken(user);

    res.status(httpStatus.CREATED).json(
      ResponseFormatter.success(
        {
          user: user.toJSON(),
          token,
          message: 'Registration successful. Please check your email to verify your account.'
        },
        'User registered successfully',
        httpStatus.CREATED
      )
    );
  });

  // User login
  static login = asyncHandler(async (req, res) => {
    const { email, password } = req.validatedBody;

    // Find user and include password
    const user = await User.findByEmail(email).select('+password');
    
    if (!user) {
      return res.status(httpStatus.UNAUTHORIZED).json(
        ResponseFormatter.error('Invalid email or password', httpStatus.UNAUTHORIZED)
      );
    }

    // Check if account is locked
    if (user.isLocked) {
      return res.status(httpStatus.UNAUTHORIZED).json(
        ResponseFormatter.error('Account is temporarily locked due to too many failed login attempts', httpStatus.UNAUTHORIZED)
      );
    }

    // Check if account is active
    if (!user.isActive) {
      return res.status(httpStatus.UNAUTHORIZED).json(
        ResponseFormatter.error('Account is deactivated', httpStatus.UNAUTHORIZED)
      );
    }

    // Verify password
    const isPasswordValid = await passwordUtils.compare(password, user.password);
    
    if (!isPasswordValid) {
      await user.handleFailedLogin();
      return res.status(httpStatus.UNAUTHORIZED).json(
        ResponseFormatter.error('Invalid email or password', httpStatus.UNAUTHORIZED)
      );
    }

    // Update login info
    await user.updateLoginInfo();

    logger.info(`User logged in: ${email}`, { userId: user._id });

    // Generate JWT token
    const token = AuthController.generateToken(user);

    res.status(httpStatus.OK).json(
      ResponseFormatter.success(
        {
          user: user.toJSON(),
          token
        },
        'Login successful'
      )
    );
  });

  // Verify email
  static verifyEmail = asyncHandler(async (req, res) => {
    const { token } = req.params;

    const user = await User.findOne({
      emailVerificationToken: token,
      emailVerificationExpires: { $gt: Date.now() }
    });

    if (!user) {
      return res.status(httpStatus.BAD_REQUEST).json(
        ResponseFormatter.error('Invalid or expired verification token', httpStatus.BAD_REQUEST)
      );
    }

    user.isEmailVerified = true;
    user.emailVerificationToken = undefined;
    user.emailVerificationExpires = undefined;
    await user.save();

    logger.info(`Email verified for user: ${user.email}`, { userId: user._id });

    res.status(httpStatus.OK).json(
      ResponseFormatter.success(
        { isEmailVerified: true },
        'Email verified successfully'
      )
    );
  });

  // Resend email verification
  static resendEmailVerification = asyncHandler(async (req, res) => {
    const { email } = req.validatedBody;

    const user = await User.findByEmail(email);
    
    if (!user) {
      return res.status(httpStatus.NOT_FOUND).json(
        ResponseFormatter.error('User not found', httpStatus.NOT_FOUND)
      );
    }

    if (user.isEmailVerified) {
      return res.status(httpStatus.BAD_REQUEST).json(
        ResponseFormatter.error('Email is already verified', httpStatus.BAD_REQUEST)
      );
    }

    // Generate new verification token
    user.emailVerificationToken = crypto.randomBytes(32).toString('hex');
    user.emailVerificationExpires = Date.now() + 24 * 60 * 60 * 1000; // 24 hours
    await user.save();

    // Publish email verification event
    try {
      await publisher.publishNotificationEvent({
        type: 'email_verification',
        userId: user._id,
        email: user.email,
        name: user.name,
        token: user.emailVerificationToken
      });
    } catch (publishError) {
      logger.error('Failed to publish email verification event:', publishError);
    }

    res.status(httpStatus.OK).json(
      ResponseFormatter.success(
        null,
        'Verification email sent successfully'
      )
    );
  });

  // Forgot password
  static forgotPassword = asyncHandler(async (req, res) => {
    const { email } = req.validatedBody;

    const user = await User.findByEmail(email);
    
    if (!user) {
      // Don't reveal whether user exists or not
      return res.status(httpStatus.OK).json(
        ResponseFormatter.success(
          null,
          'If an account with that email exists, a password reset link has been sent'
        )
      );
    }

    if (!user.isActive) {
      return res.status(httpStatus.OK).json(
        ResponseFormatter.success(
          null,
          'If an account with that email exists, a password reset link has been sent'
        )
      );
    }

    // Generate password reset token
    user.passwordResetToken = crypto.randomBytes(32).toString('hex');
    user.passwordResetExpires = Date.now() + 60 * 60 * 1000; // 1 hour
    await user.save();

    logger.info(`Password reset requested for: ${email}`, { userId: user._id });

    // Publish password reset event
    try {
      await publisher.publishNotificationEvent({
        type: 'password_reset',
        userId: user._id,
        email: user.email,
        name: user.name,
        token: user.passwordResetToken
      });
    } catch (publishError) {
      logger.error('Failed to publish password reset event:', publishError);
    }

    res.status(httpStatus.OK).json(
      ResponseFormatter.success(
        null,
        'If an account with that email exists, a password reset link has been sent'
      )
    );
  });

  // Reset password
  static resetPassword = asyncHandler(async (req, res) => {
    const { token } = req.params;
    const { password } = req.validatedBody;

    const user = await User.findOne({
      passwordResetToken: token,
      passwordResetExpires: { $gt: Date.now() }
    });

    if (!user) {
      return res.status(httpStatus.BAD_REQUEST).json(
        ResponseFormatter.error('Invalid or expired reset token', httpStatus.BAD_REQUEST)
      );
    }

    // Hash new password
    user.password = await passwordUtils.hash(password);
    user.passwordResetToken = undefined;
    user.passwordResetExpires = undefined;
    user.loginAttempts = 0;
    user.lockUntil = undefined;
    await user.save();

    logger.info(`Password reset completed for: ${user.email}`, { userId: user._id });

    res.status(httpStatus.OK).json(
      ResponseFormatter.success(
        null,
        'Password reset successful'
      )
    );
  });

  // Get current user profile
  static getProfile = asyncHandler(async (req, res) => {
    const user = await User.findById(req.user.id);
    
    if (!user) {
      return res.status(httpStatus.NOT_FOUND).json(
        ResponseFormatter.error('User not found', httpStatus.NOT_FOUND)
      );
    }

    res.status(httpStatus.OK).json(
      ResponseFormatter.success(user.toJSON(), 'Profile retrieved successfully')
    );
  });

  // Update current user profile
  static updateProfile = asyncHandler(async (req, res) => {
    const updates = req.validatedBody;
    
    const user = await User.findById(req.user.id);
    
    if (!user) {
      return res.status(httpStatus.NOT_FOUND).json(
        ResponseFormatter.error('User not found', httpStatus.NOT_FOUND)
      );
    }

    // Update allowed fields
    if (updates.name) user.name = stringHelpers.capitalizeWords(updates.name);
    if (updates.avatar) user.avatar = updates.avatar;
    if (updates.preferences) user.preferences = { ...user.preferences, ...updates.preferences };

    await user.save();

    logger.info(`Profile updated for user: ${user.email}`, { userId: user._id });

    // Publish user update event
    try {
      await publisher.publishUserEvent(eventTypes.USER_UPDATED, {
        userId: user._id,
        updates,
        updatedAt: user.updatedAt
      });
    } catch (publishError) {
      logger.error('Failed to publish user update event:', publishError);
    }

    res.status(httpStatus.OK).json(
      ResponseFormatter.success(user.toJSON(), 'Profile updated successfully')
    );
  });

  // Change password
  static changePassword = asyncHandler(async (req, res) => {
    const { currentPassword, newPassword } = req.validatedBody;

    const user = await User.findById(req.user.id).select('+password');
    
    if (!user) {
      return res.status(httpStatus.NOT_FOUND).json(
        ResponseFormatter.error('User not found', httpStatus.NOT_FOUND)
      );
    }

    // Verify current password
    const isCurrentPasswordValid = await passwordUtils.compare(currentPassword, user.password);
    
    if (!isCurrentPasswordValid) {
      return res.status(httpStatus.BAD_REQUEST).json(
        ResponseFormatter.error('Current password is incorrect', httpStatus.BAD_REQUEST)
      );
    }

    // Hash new password
    user.password = await passwordUtils.hash(newPassword);
    await user.save();

    logger.info(`Password changed for user: ${user.email}`, { userId: user._id });

    res.status(httpStatus.OK).json(
      ResponseFormatter.success(null, 'Password changed successfully')
    );
  });

  // Refresh token
  static refreshToken = asyncHandler(async (req, res) => {
    const user = await User.findById(req.user.id);
    
    if (!user || !user.isActive) {
      return res.status(httpStatus.UNAUTHORIZED).json(
        ResponseFormatter.error('User not found or inactive', httpStatus.UNAUTHORIZED)
      );
    }

    const token = AuthController.generateToken(user);

    res.status(httpStatus.OK).json(
      ResponseFormatter.success({ token }, 'Token refreshed successfully')
    );
  });

  // Helper method to generate JWT token
  static generateToken(user) {
    return jwt.sign(
      {
        id: user._id,
        email: user.email,
        role: user.role,
        name: user.name
      },
      process.env.JWT_SECRET,
      {
        expiresIn: process.env.JWT_EXPIRE || '24h'
      }
    );
  }
}

module.exports = AuthController;