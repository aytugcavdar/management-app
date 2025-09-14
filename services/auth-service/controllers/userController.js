const User = require('../models/User');

const {
  helpers: { ResponseFormatter, stringHelpers },
  constants: { httpStatus, eventTypes },
  rabbitmq: { publisher },
  logger
} = require('@management-app/shared-utils');

class UserController {
  // Get all users with pagination and search
  static async getAllUsers(req, res, next) {
    try {
      const { page, limit, sort, search } = req.pagination;
      
      let query = { isActive: true };
      
      // Add search functionality
      if (search) {
        query.$or = [
          { name: { $regex: search, $options: 'i' } },
          { email: { $regex: search, $options: 'i' } }
        ];
      }
      
      // Calculate pagination
      const skip = (page - 1) * limit;
      
      // Execute query
      const [users, total] = await Promise.all([
        User.find(query)
          .sort(sort)
          .skip(skip)
          .limit(limit)
          .select('-password -passwordResetToken -passwordResetExpires -emailVerificationToken -emailVerificationExpires'),
        User.countDocuments(query)
      ]);
      
      logger.info(`Retrieved ${users.length} users`, { 
        page, 
        limit, 
        total, 
        search,
        requestedBy: req.user.id 
      });
      
      res.status(httpStatus.OK).json(
        ResponseFormatter.paginated(
          users,
          { page, limit, total },
          'Users retrieved successfully'
        )
      );
      
    } catch (error) {
      logger.error('Get all users error:', error);
      next(error);
    }
  }

  // Get user by ID
  static async getUserById(req, res, next) {
    try {
      const { userId } = req.params;
      
      const user = await User.findById(userId)
        .select('-password -passwordResetToken -passwordResetExpires -emailVerificationToken -emailVerificationExpires');
      
      if (!user) {
        return res.status(httpStatus.NOT_FOUND).json(
          ResponseFormatter.error('User not found', httpStatus.NOT_FOUND)
        );
      }
      
      // Check if user has permission to view this profile
      // Users can view their own profile or admins can view any profile
      if (req.user.id !== userId && req.user.role !== 'admin') {
        return res.status(httpStatus.FORBIDDEN).json(
          ResponseFormatter.error('Access denied', httpStatus.FORBIDDEN)
        );
      }
      
      logger.info(`User profile viewed: ${user.email}`, { 
        viewedUserId: userId,
        viewedBy: req.user.id 
      });
      
      res.status(httpStatus.OK).json(
        ResponseFormatter.success(user, 'User retrieved successfully')
      );
      
    } catch (error) {
      logger.error('Get user by ID error:', error);
      next(error);
    }
  }

  // Search users by name or email
  static async searchUsers(req, res, next) {
    try {
      const { query } = req.params;
      const limit = parseInt(req.query.limit) || 10;
      
      if (query.length < 2) {
        return res.status(httpStatus.BAD_REQUEST).json(
          ResponseFormatter.error('Search query must be at least 2 characters long', httpStatus.BAD_REQUEST)
        );
      }
      
      const users = await User.find({
        isActive: true,
        $or: [
          { name: { $regex: query, $options: 'i' } },
          { email: { $regex: query, $options: 'i' } }
        ]
      })
      .limit(limit)
      .select('name email avatar role')
      .sort({ name: 1 });
      
      logger.info(`User search performed: "${query}"`, { 
        resultsCount: users.length,
        searchedBy: req.user.id 
      });
      
      res.status(httpStatus.OK).json(
        ResponseFormatter.success(users, 'Search completed successfully')
      );
      
    } catch (error) {
      logger.error('Search users error:', error);
      next(error);
    }
  }

  // Update user (admin only)
  static async updateUser(req, res, next) {
    try {
      const { userId } = req.params;
      const updates = req.validatedBody;
      
      const user = await User.findById(userId);
      
      if (!user) {
        return res.status(httpStatus.NOT_FOUND).json(
          ResponseFormatter.error('User not found', httpStatus.NOT_FOUND)
        );
      }
      
      // Prevent admin from updating their own role
      if (userId === req.user.id && updates.role) {
        return res.status(httpStatus.BAD_REQUEST).json(
          ResponseFormatter.error('Cannot change your own role', httpStatus.BAD_REQUEST)
        );
      }
      
      // Update allowed fields
      if (updates.name) user.name = stringHelpers.capitalizeWords(updates.name);
      if (updates.role) user.role = updates.role;
      if (updates.isActive !== undefined) user.isActive = updates.isActive;
      
      await user.save();
      
      logger.info(`User updated by admin: ${user.email}`, { 
        updatedUserId: userId,
        updatedBy: req.user.id,
        updates 
      });
      
      // Publish user update event
      try {
        await publisher.publishUserEvent(eventTypes.USER_UPDATED, {
          userId: user._id,
          updates,
          updatedBy: req.user.id,
          updatedAt: user.updatedAt
        });
      } catch (publishError) {
        logger.error('Failed to publish user update event:', publishError);
      }
      
      res.status(httpStatus.OK).json(
        ResponseFormatter.success(user.toJSON(), 'User updated successfully')
      );
      
    } catch (error) {
      logger.error('Update user error:', error);
      next(error);
    }
  }

  // Deactivate user (admin only)
  static async deactivateUser(req, res, next) {
    try {
      const { userId } = req.params;
      
      if (userId === req.user.id) {
        return res.status(httpStatus.BAD_REQUEST).json(
          ResponseFormatter.error('Cannot deactivate your own account', httpStatus.BAD_REQUEST)
        );
      }
      
      const user = await User.findById(userId);
      
      if (!user) {
        return res.status(httpStatus.NOT_FOUND).json(
          ResponseFormatter.error('User not found', httpStatus.NOT_FOUND)
        );
      }
      
      if (!user.isActive) {
        return res.status(httpStatus.BAD_REQUEST).json(
          ResponseFormatter.error('User is already deactivated', httpStatus.BAD_REQUEST)
        );
      }
      
      user.isActive = false;
      await user.save();
      
      logger.info(`User deactivated by admin: ${user.email}`, { 
        deactivatedUserId: userId,
        deactivatedBy: req.user.id 
      });
      
      // Publish user deactivation event
      try {
        await publisher.publishUserEvent(eventTypes.USER_UPDATED, {
          userId: user._id,
          isActive: false,
          deactivatedBy: req.user.id,
          deactivatedAt: new Date()
        });
      } catch (publishError) {
        logger.error('Failed to publish user deactivation event:', publishError);
      }
      
      res.status(httpStatus.OK).json(
        ResponseFormatter.success(
          { isActive: false },
          'User deactivated successfully'
        )
      );
      
    } catch (error) {
      logger.error('Deactivate user error:', error);
      next(error);
    }
  }

  // Activate user (admin only)
  static async activateUser(req, res, next) {
    try {
      const { userId } = req.params;
      
      const user = await User.findById(userId);
      
      if (!user) {
        return res.status(httpStatus.NOT_FOUND).json(
          ResponseFormatter.error('User not found', httpStatus.NOT_FOUND)
        );
      }
      
      if (user.isActive) {
        return res.status(httpStatus.BAD_REQUEST).json(
          ResponseFormatter.error('User is already active', httpStatus.BAD_REQUEST)
        );
      }
      
      user.isActive = true;
      await user.save();
      
      logger.info(`User activated by admin: ${user.email}`, { 
        activatedUserId: userId,
        activatedBy: req.user.id 
      });
      
      // Publish user activation event
      try {
        await publisher.publishUserEvent(eventTypes.USER_UPDATED, {
          userId: user._id,
          isActive: true,
          activatedBy: req.user.id,
          activatedAt: new Date()
        });
      } catch (publishError) {
        logger.error('Failed to publish user activation event:', publishError);
      }
      
      res.status(httpStatus.OK).json(
        ResponseFormatter.success(
          { isActive: true },
          'User activated successfully'
        )
      );
      
    } catch (error) {
      logger.error('Activate user error:', error);
      next(error);
    }
  }

  // Delete user (admin only)
  static async deleteUser(req, res, next) {
    try {
      const { userId } = req.params;
      
      if (userId === req.user.id) {
        return res.status(httpStatus.BAD_REQUEST).json(
          ResponseFormatter.error('Cannot delete your own account', httpStatus.BAD_REQUEST)
        );
      }
      
      const user = await User.findById(userId);
      
      if (!user) {
        return res.status(httpStatus.NOT_FOUND).json(
          ResponseFormatter.error('User not found', httpStatus.NOT_FOUND)
        );
      }
      
      await User.findByIdAndDelete(userId);
      
      logger.info(`User deleted by admin: ${user.email}`, { 
        deletedUserId: userId,
        deletedBy: req.user.id 
      });
      
      // Publish user deletion event
      try {
        await publisher.publishUserEvent(eventTypes.USER_DELETED, {
          userId: user._id,
          email: user.email,
          name: user.name,
          deletedBy: req.user.id,
          deletedAt: new Date()
        });
      } catch (publishError) {
        logger.error('Failed to publish user deletion event:', publishError);
      }
      
      res.status(httpStatus.OK).json(
        ResponseFormatter.success(
          null,
          'User deleted successfully'
        )
      );
      
    } catch (error) {
      logger.error('Delete user error:', error);
      next(error);
    }
  }
}

module.exports = UserController;