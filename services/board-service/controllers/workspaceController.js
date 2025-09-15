const Workspace = require('../models/Workspace');
const Board = require('../models/Board');
const ActivityLogger = require('../utils/activityLogger');

const {
  helpers: { ResponseFormatter, stringHelpers },
  constants: { httpStatus, eventTypes },
  rabbitmq: { publisher },
  middleware: { errorHandler: { asyncHandler } },
  logger
} = require('@management-app/shared-utils');

class WorkspaceController {
  // Create new workspace
  static createWorkspace = asyncHandler(async (req, res) => {
    const { name, description, settings = {} } = req.validatedBody;
    const userId = req.user.id;
    
    // Generate unique slug
    const baseSlug = stringHelpers.generateSlug(name);
    let slug = baseSlug;
    let counter = 1;
    
    while (await Workspace.findOne({ slug })) {
      slug = `${baseSlug}-${counter}`;
      counter++;
    }
    
    const workspace = new Workspace({
      name: stringHelpers.capitalizeWords(name),
      description,
      slug,
      owner: userId,
      members: [{
        userId,
        role: 'admin',
        joinedAt: new Date()
      }],
      settings: {
        isPrivate: settings.isPrivate || false,
        allowInvitations: settings.allowInvitations !== false,
        requireApproval: settings.requireApproval || false
      }
    });
    
    await workspace.save();
    
    logger.info(`Workspace created: ${workspace.name}`, {
      workspaceId: workspace._id,
      createdBy: userId
    });
    
    // Log activity
    await ActivityLogger.logWorkspaceActivity('workspace_created', workspace, req.user);
    
    // Publish workspace creation event
    try {
      await publisher.publishEvent(eventTypes.WORKSPACE_CREATED, {
        workspaceId: workspace._id,
        name: workspace.name,
        slug: workspace.slug,
        owner: userId,
        createdAt: workspace.createdAt
      });
    } catch (publishError) {
      logger.error('Failed to publish workspace creation event:', publishError);
    }
    
    res.status(httpStatus.CREATED).json(
      ResponseFormatter.success(
        workspace,
        'Workspace created successfully',
        httpStatus.CREATED
      )
    );
  });
  
  // Get user's workspaces
  static getUserWorkspaces = asyncHandler(async (req, res) => {
    const { page, limit, sort, search } = req.pagination;
    const userId = req.user.id;
    
    let query = {
      $or: [
        { owner: userId },
        { 'members.userId': userId }
      ],
      isActive: true
    };
    
    if (search) {
      query.$and = [
        query,
        {
          $or: [
            { name: { $regex: search, $options: 'i' } },
            { description: { $regex: search, $options: 'i' } }
          ]
        }
      ];
    }
    
    const options = {
      page,
      limit,
      sort,
      populate: [
        {
          path: 'owner',
          select: 'name email avatar'
        },
        {
          path: 'members.userId',
          select: 'name email avatar'
        }
      ]
    };
    
    const result = await Workspace.paginate(query, options);
    
    logger.info(`Retrieved ${result.docs.length} workspaces for user`, {
      userId,
      total: result.totalDocs
    });
    
    res.status(httpStatus.OK).json(
      ResponseFormatter.paginated(
        result.docs,
        {
          page: result.page,
          limit: result.limit,
          total: result.totalDocs
        },
        'Workspaces retrieved successfully'
      )
    );
  });
  
  // Get workspace by ID
  static getWorkspaceById = asyncHandler(async (req, res) => {
    const { workspaceId } = req.params;
    const userId = req.user.id;
    
    const workspace = await Workspace.findById(workspaceId)
      .populate('owner', 'name email avatar')
      .populate('members.userId', 'name email avatar')
      .populate('members.invitedBy', 'name email avatar');
    
    if (!workspace) {
      return res.status(httpStatus.NOT_FOUND).json(
        ResponseFormatter.error('Workspace not found', httpStatus.NOT_FOUND)
      );
    }
    
    // Check if user is member or owner
    if (!workspace.isMember(userId) && workspace.owner._id.toString() !== userId) {
      return res.status(httpStatus.FORBIDDEN).json(
        ResponseFormatter.error('Access denied', httpStatus.FORBIDDEN)
      );
    }
    
    // Get workspace boards
    const boards = await Board.find({
      workspaceId,
      isActive: true,
      $or: [
        { visibility: 'workspace' },
        { owner: userId },
        { 'members.userId': userId }
      ]
    })
    .select('name description slug owner visibility background statistics createdAt')
    .populate('owner', 'name email avatar')
    .sort({ createdAt: -1 })
    .limit(10);
    
    const workspaceData = {
      ...workspace.toJSON(),
      boards,
      userRole: workspace.getMemberRole(userId) || (workspace.owner._id.toString() === userId ? 'owner' : null)
    };
    
    res.status(httpStatus.OK).json(
      ResponseFormatter.success(workspaceData, 'Workspace retrieved successfully')
    );
  });
  
  // Update workspace
  static updateWorkspace = asyncHandler(async (req, res) => {
    const { workspaceId } = req.params;
    const updates = req.validatedBody;
    const userId = req.user.id;
    
    const workspace = await Workspace.findById(workspaceId);
    
    if (!workspace) {
      return res.status(httpStatus.NOT_FOUND).json(
        ResponseFormatter.error('Workspace not found', httpStatus.NOT_FOUND)
      );
    }
    
    // Check permissions
    if (!workspace.hasPermission(userId, 'admin')) {
      return res.status(httpStatus.FORBIDDEN).json(
        ResponseFormatter.error('Insufficient permissions', httpStatus.FORBIDDEN)
      );
    }
    
    const previousData = {
      name: workspace.name,
      description: workspace.description,
      settings: workspace.settings
    };
    
    // Update allowed fields
    if (updates.name) {
      workspace.name = stringHelpers.capitalizeWords(updates.name);
      
      // Generate new slug if name changed
      const baseSlug = stringHelpers.generateSlug(updates.name);
      let slug = baseSlug;
      let counter = 1;
      
      while (await Workspace.findOne({ slug, _id: { $ne: workspaceId } })) {
        slug = `${baseSlug}-${counter}`;
        counter++;
      }
      
      workspace.slug = slug;
    }
    
    if (updates.description !== undefined) workspace.description = updates.description;
    if (updates.settings) workspace.settings = { ...workspace.settings, ...updates.settings };
    
    await workspace.save();
    
    logger.info(`Workspace updated: ${workspace.name}`, {
      workspaceId,
      updatedBy: userId,
      updates
    });
    
    // Log activity
    await ActivityLogger.logWorkspaceActivity('workspace_updated', workspace, req.user, {
      previousData,
      updates
    });
    
    // Publish workspace update event
    try {
      await publisher.publishEvent(eventTypes.WORKSPACE_UPDATED, {
        workspaceId: workspace._id,
        updates,
        previousData,
        updatedBy: userId,
        updatedAt: workspace.updatedAt
      });
    } catch (publishError) {
      logger.error('Failed to publish workspace update event:', publishError);
    }
    
    res.status(httpStatus.OK).json(
      ResponseFormatter.success(workspace, 'Workspace updated successfully')
    );
  });
  
  // Delete workspace
  static deleteWorkspace = asyncHandler(async (req, res) => {
    const { workspaceId } = req.params;
    const userId = req.user.id;
    
    const workspace = await Workspace.findById(workspaceId);
    
    if (!workspace) {
      return res.status(httpStatus.NOT_FOUND).json(
        ResponseFormatter.error('Workspace not found', httpStatus.NOT_FOUND)
      );
    }
    
    // Only owner can delete workspace
    if (workspace.owner.toString() !== userId) {
      return res.status(httpStatus.FORBIDDEN).json(
        ResponseFormatter.error('Only workspace owner can delete the workspace', httpStatus.FORBIDDEN)
      );
    }
    
    // Check if workspace has boards
    const boardCount = await Board.countDocuments({ workspaceId, isActive: true });
    
    if (boardCount > 0) {
      return res.status(httpStatus.BAD_REQUEST).json(
        ResponseFormatter.error(
          `Cannot delete workspace with ${boardCount} active boards. Please delete or archive all boards first.`,
          httpStatus.BAD_REQUEST
        )
      );
    }
    
    // Soft delete
    workspace.isActive = false;
    await workspace.save();
    
    logger.info(`Workspace deleted: ${workspace.name}`, {
      workspaceId,
      deletedBy: userId
    });
    
    // Log activity
    await ActivityLogger.logWorkspaceActivity('workspace_deleted', workspace, req.user);
    
    // Publish workspace deletion event
    try {
      await publisher.publishEvent(eventTypes.WORKSPACE_DELETED, {
        workspaceId: workspace._id,
        name: workspace.name,
        deletedBy: userId,
        deletedAt: new Date()
      });
    } catch (publishError) {
      logger.error('Failed to publish workspace deletion event:', publishError);
    }
    
    res.status(httpStatus.OK).json(
      ResponseFormatter.success(null, 'Workspace deleted successfully')
    );
  });
  
  // Invite user to workspace
  static inviteUser = asyncHandler(async (req, res) => {
    const { workspaceId } = req.params;
    const { email, role = 'member', message } = req.validatedBody;
    const userId = req.user.id;
    
    const workspace = await Workspace.findById(workspaceId);
    
    if (!workspace) {
      return res.status(httpStatus.NOT_FOUND).json(
        ResponseFormatter.error('Workspace not found', httpStatus.NOT_FOUND)
      );
    }
    
    // Check permissions
    if (!workspace.hasPermission(userId, 'admin')) {
      return res.status(httpStatus.FORBIDDEN).json(
        ResponseFormatter.error('Insufficient permissions to invite users', httpStatus.FORBIDDEN)
      );
    }
    
    // Check if invitations are allowed
    if (!workspace.settings.allowInvitations) {
      return res.status(httpStatus.BAD_REQUEST).json(
        ResponseFormatter.error('Invitations are disabled for this workspace', httpStatus.BAD_REQUEST)
      );
    }
    
    // TODO: Check if user exists in auth service
    // For now, we'll assume the user exists and send invitation
    
    // Check if user is already a member
    const existingMember = workspace.members.find(member => member.email === email);
    
    if (existingMember) {
      return res.status(httpStatus.CONFLICT).json(
        ResponseFormatter.error('User is already a member of this workspace', httpStatus.CONFLICT)
      );
    }
    
    logger.info(`User invited to workspace: ${email}`, {
      workspaceId,
      invitedBy: userId,
      role
    });
    
    // Publish invitation event
    try {
      await publisher.publishNotificationEvent({
        type: 'workspace_invitation',
        workspaceId: workspace._id,
        workspaceName: workspace.name,
        invitedEmail: email,
        invitedBy: {
          id: req.user.id,
          name: req.user.name,
          email: req.user.email
        },
        role,
        message,
        invitationToken: stringHelpers.generateId('invite')
      });
    } catch (publishError) {
      logger.error('Failed to publish workspace invitation event:', publishError);
    }
    
    res.status(httpStatus.OK).json(
      ResponseFormatter.success(
        {
          email,
          role,
          workspaceName: workspace.name,
          invitedBy: req.user.name
        },
        'Invitation sent successfully'
      )
    );
  });
  
  // Add member to workspace (after invitation acceptance)
  static addMember = asyncHandler(async (req, res) => {
    const { workspaceId } = req.params;
    const { userId: newUserId, role = 'member' } = req.validatedBody;
    const currentUserId = req.user.id;
    
    const workspace = await Workspace.findById(workspaceId);
    
    if (!workspace) {
      return res.status(httpStatus.NOT_FOUND).json(
        ResponseFormatter.error('Workspace not found', httpStatus.NOT_FOUND)
      );
    }
    
    // Check permissions
    if (!workspace.hasPermission(currentUserId, 'admin')) {
      return res.status(httpStatus.FORBIDDEN).json(
        ResponseFormatter.error('Insufficient permissions', httpStatus.FORBIDDEN)
      );
    }
    
    // Check if user is already a member
    if (workspace.isMember(newUserId)) {
      return res.status(httpStatus.CONFLICT).json(
        ResponseFormatter.error('User is already a member', httpStatus.CONFLICT)
      );
    }
    
    // Add member
    workspace.members.push({
      userId: newUserId,
      role,
      joinedAt: new Date(),
      invitedBy: currentUserId
    });
    
    await workspace.save();
    
    logger.info(`Member added to workspace: ${newUserId}`, {
      workspaceId,
      addedBy: currentUserId,
      role
    });
    
    // Log activity
    await ActivityLogger.logWorkspaceActivity('workspace_member_added', workspace, req.user, {
      newMemberId: newUserId,
      memberRole: role
    });
    
    // Publish member addition event
    try {
      await publisher.publishEvent(eventTypes.WORKSPACE_MEMBER_ADDED, {
        workspaceId: workspace._id,
        workspaceName: workspace.name,
        newMemberId: newUserId,
        role,
        addedBy: currentUserId,
        addedAt: new Date()
      });
    } catch (publishError) {
      logger.error('Failed to publish workspace member addition event:', publishError);
    }
    
    res.status(httpStatus.OK).json(
      ResponseFormatter.success(
        {
          userId: newUserId,
          role,
          joinedAt: new Date()
        },
        'Member added successfully'
      )
    );
  });
  
  // Remove member from workspace
  static removeMember = asyncHandler(async (req, res) => {
    const { workspaceId, memberId } = req.params;
    const userId = req.user.id;
    
    const workspace = await Workspace.findById(workspaceId);
    
    if (!workspace) {
      return res.status(httpStatus.NOT_FOUND).json(
        ResponseFormatter.error('Workspace not found', httpStatus.NOT_FOUND)
      );
    }
    
    // Check permissions (admin can remove others, users can remove themselves)
    if (memberId !== userId && !workspace.hasPermission(userId, 'admin')) {
      return res.status(httpStatus.FORBIDDEN).json(
        ResponseFormatter.error('Insufficient permissions', httpStatus.FORBIDDEN)
      );
    }
    
    // Cannot remove workspace owner
    if (workspace.owner.toString() === memberId) {
      return res.status(httpStatus.BAD_REQUEST).json(
        ResponseFormatter.error('Cannot remove workspace owner', httpStatus.BAD_REQUEST)
      );
    }
    
    // Check if member exists
    const memberIndex = workspace.members.findIndex(
      member => member.userId.toString() === memberId
    );
    
    if (memberIndex === -1) {
      return res.status(httpStatus.NOT_FOUND).json(
        ResponseFormatter.error('Member not found', httpStatus.NOT_FOUND)
      );
    }
    
    const removedMember = workspace.members[memberIndex];
    workspace.members.splice(memberIndex, 1);
    
    await workspace.save();
    
    logger.info(`Member removed from workspace: ${memberId}`, {
      workspaceId,
      removedBy: userId
    });
    
    // Log activity
    await ActivityLogger.logWorkspaceActivity('workspace_member_removed', workspace, req.user, {
      removedMemberId: memberId,
      memberRole: removedMember.role
    });
    
    // Publish member removal event
    try {
      await publisher.publishEvent(eventTypes.WORKSPACE_MEMBER_REMOVED, {
        workspaceId: workspace._id,
        workspaceName: workspace.name,
        removedMemberId: memberId,
        removedBy: userId,
        removedAt: new Date()
      });
    } catch (publishError) {
      logger.error('Failed to publish workspace member removal event:', publishError);
    }
    
    res.status(httpStatus.OK).json(
      ResponseFormatter.success(null, 'Member removed successfully')
    );
  });
  
  // Update member role
  static updateMemberRole = asyncHandler(async (req, res) => {
    const { workspaceId, memberId } = req.params;
    const { role } = req.validatedBody;
    const userId = req.user.id;
    
    const workspace = await Workspace.findById(workspaceId);
    
    if (!workspace) {
      return res.status(httpStatus.NOT_FOUND).json(
        ResponseFormatter.error('Workspace not found', httpStatus.NOT_FOUND)
      );
    }
    
    // Check permissions
    if (!workspace.hasPermission(userId, 'admin')) {
      return res.status(httpStatus.FORBIDDEN).json(
        ResponseFormatter.error('Insufficient permissions', httpStatus.FORBIDDEN)
      );
    }
    
    // Cannot change owner's role
    if (workspace.owner.toString() === memberId) {
      return res.status(httpStatus.BAD_REQUEST).json(
        ResponseFormatter.error('Cannot change workspace owner role', httpStatus.BAD_REQUEST)
      );
    }
    
    // Find member
    const member = workspace.members.find(
      member => member.userId.toString() === memberId
    );
    
    if (!member) {
      return res.status(httpStatus.NOT_FOUND).json(
        ResponseFormatter.error('Member not found', httpStatus.NOT_FOUND)
      );
    }
    
    const previousRole = member.role;
    member.role = role;
    
    await workspace.save();
    
    logger.info(`Member role updated in workspace: ${memberId}`, {
      workspaceId,
      previousRole,
      newRole: role,
      updatedBy: userId
    });
    
    // Log activity
    await ActivityLogger.logWorkspaceActivity('workspace_member_role_changed', workspace, req.user, {
      memberId,
      previousRole,
      newRole: role
    });
    
    res.status(httpStatus.OK).json(
      ResponseFormatter.success(
        {
          userId: memberId,
          role,
          previousRole
        },
        'Member role updated successfully'
      )
    );
  });
  
  // Get workspace statistics
  static getWorkspaceStats = asyncHandler(async (req, res) => {
    const { workspaceId } = req.params;
    const userId = req.user.id;
    
    const workspace = await Workspace.findById(workspaceId);
    
    if (!workspace) {
      return res.status(httpStatus.NOT_FOUND).json(
        ResponseFormatter.error('Workspace not found', httpStatus.NOT_FOUND)
      );
    }
    
    // Check if user is member
    if (!workspace.isMember(userId) && workspace.owner.toString() !== userId) {
      return res.status(httpStatus.FORBIDDEN).json(
        ResponseFormatter.error('Access denied', httpStatus.FORBIDDEN)
      );
    }
    
    // Get detailed statistics
    const [boardStats, cardStats] = await Promise.all([
      Board.aggregate([
        { $match: { workspaceId: workspace._id, isActive: true } },
        {
          $group: {
            _id: null,
            totalBoards: { $sum: 1 },
            publicBoards: {
              $sum: { $cond: [{ $eq: ['$visibility', 'public'] }, 1, 0] }
            },
            privateBoards: {
              $sum: { $cond: [{ $eq: ['$visibility', 'private'] }, 1, 0] }
            },
            workspaceBoards: {
              $sum: { $cond: [{ $eq: ['$visibility', 'workspace'] }, 1, 0] }
            }
          }
        }
      ]),
      Board.aggregate([
        { $match: { workspaceId: workspace._id, isActive: true } },
        {
          $lookup: {
            from: 'cards',
            localField: '_id',
            foreignField: 'boardId',
            as: 'cards'
          }
        },
        {
          $unwind: {
            path: '$cards',
            preserveNullAndEmptyArrays: true
          }
        },
        {
          $group: {
            _id: null,
            totalCards: { $sum: { $cond: [{ $ne: ['$cards', null] }, 1, 0] } },
            completedCards: {
              $sum: {
                $cond: [
                  { $eq: ['$cards.status', 'done'] },
                  1,
                  0
                ]
              }
            },
            overdueCards: {
              $sum: {
                $cond: [
                  {
                    $and: [
                      { $ne: ['$cards', null] },
                      { $lt: ['$cards.dueDate', new Date()] },
                      { $ne: ['$cards.status', 'done'] }
                    ]
                  },
                  1,
                  0
                ]
              }
            }
          }
        }
      ])
    ]);
    
    const stats = {
      boards: boardStats[0] || {
        totalBoards: 0,
        publicBoards: 0,
        privateBoards: 0,
        workspaceBoards: 0
      },
      cards: cardStats[0] || {
        totalCards: 0,
        completedCards: 0,
        overdueCards: 0
      },
      members: {
        totalMembers: workspace.members.length + 1, // +1 for owner
        admins: workspace.members.filter(m => m.role === 'admin').length + 1,
        members: workspace.members.filter(m => m.role === 'member').length,
        viewers: workspace.members.filter(m => m.role === 'viewer').length
      }
    };
    
    res.status(httpStatus.OK).json(
      ResponseFormatter.success(stats, 'Workspace statistics retrieved successfully')
    );
  });
}

module.exports = WorkspaceController;