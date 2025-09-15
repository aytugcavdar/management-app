const Board = require('../models/Board');
const Workspace = require('../models/Workspace');
const List = require('../models/List');
const Card = require('../models/Card');
const ActivityLogger = require('../utils/activityLogger');

const {
  helpers: { ResponseFormatter, stringHelpers },
  constants: { httpStatus, eventTypes },
  rabbitmq: { publisher },
  middleware: { errorHandler: { asyncHandler } },
  logger
} = require('@management-app/shared-utils');

class BoardController {
  // Create new board
  static createBoard = asyncHandler(async (req, res) => {
    const { name, description, workspaceId, visibility = 'workspace', background = {} } = req.validatedBody;
    const userId = req.user.id;
    
    // Check if workspace exists and user has access
    const workspace = await Workspace.findById(workspaceId);
    
    if (!workspace) {
      return res.status(httpStatus.NOT_FOUND).json(
        ResponseFormatter.error('Workspace not found', httpStatus.NOT_FOUND)
      );
    }
    
    if (!workspace.isMember(userId) && workspace.owner.toString() !== userId) {
      return res.status(httpStatus.FORBIDDEN).json(
        ResponseFormatter.error('Access denied to workspace', httpStatus.FORBIDDEN)
      );
    }
    
    // Generate unique slug within workspace
    const baseSlug = stringHelpers.generateSlug(name);
    let slug = baseSlug;
    let counter = 1;
    
    while (await Board.findOne({ workspaceId, slug })) {
      slug = `${baseSlug}-${counter}`;
      counter++;
    }
    
    const board = new Board({
      name: stringHelpers.capitalizeWords(name),
      description,
      slug,
      workspaceId,
      owner: userId,
      visibility,
      background: {
        color: background.color || '#0079bf',
        image: background.image || null
      },
      members: [{
        userId,
        role: 'admin',
        joinedAt: new Date()
      }],
      labels: [
        { name: 'High Priority', color: '#dc3545' },
        { name: 'Medium Priority', color: '#ffc107' },
        { name: 'Low Priority', color: '#28a745' },
        { name: 'Bug', color: '#e74c3c' },
        { name: 'Feature', color: '#3498db' },
        { name: 'Enhancement', color: '#9b59b6' }
      ]
    });
    
    await board.save();
    
    // Create default lists
    const defaultLists = [
      { name: 'To Do', position: 0 },
      { name: 'In Progress', position: 1 },
      { name: 'In Review', position: 2 },
      { name: 'Done', position: 3 }
    ];
    
    const createdLists = [];
    for (const listData of defaultLists) {
      const list = new List({
        name: listData.name,
        boardId: board._id,
        position: listData.position
      });
      await list.save();
      createdLists.push(list);
    }
    
    // Update board statistics
    board.statistics.totalLists = createdLists.length;
    await board.save();
    
    // Update workspace statistics
    workspace.statistics.totalBoards += 1;
    await workspace.save();
    
    logger.info(`Board created: ${board.name}`, {
      boardId: board._id,
      workspaceId,
      createdBy: userId
    });
    
    // Log activity
    await ActivityLogger.logBoardActivity('board_created', board, req.user, { workspaceId });
    
    // Publish board creation event
    try {
      await publisher.publishEvent(eventTypes.BOARD_CREATED, {
        boardId: board._id,
        name: board.name,
        slug: board.slug,
        workspaceId,
        owner: userId,
        visibility,
        createdAt: board.createdAt
      });
    } catch (publishError) {
      logger.error('Failed to publish board creation event:', publishError);
    }
    
    // Emit real-time event
    const io = req.app.get('io');
    if (io && io.boardHandlers) {
      io.boardHandlers.board_created({
        boardId: board._id,
        board: board.toJSON(),
        workspaceId,
        createdBy: {
          id: userId,
          name: req.user.name,
          avatar: req.user.avatar
        }
      });
    }
    
    res.status(httpStatus.CREATED).json(
      ResponseFormatter.success(
        {
          ...board.toJSON(),
          lists: createdLists
        },
        'Board created successfully',
        httpStatus.CREATED
      )
    );
  });
  
  // Get boards by workspace
  static getBoardsByWorkspace = asyncHandler(async (req, res) => {
    const { workspaceId } = req.params;
    const { page, limit, sort, search } = req.pagination;
    const userId = req.user.id;
    
    // Check workspace access
    const workspace = await Workspace.findById(workspaceId);
    
    if (!workspace) {
      return res.status(httpStatus.NOT_FOUND).json(
        ResponseFormatter.error('Workspace not found', httpStatus.NOT_FOUND)
      );
    }
    
    if (!workspace.isMember(userId) && workspace.owner.toString() !== userId) {
      return res.status(httpStatus.FORBIDDEN).json(
        ResponseFormatter.error('Access denied to workspace', httpStatus.FORBIDDEN)
      );
    }
    
    let query = {
      workspaceId,
      isActive: true,
      $or: [
        { visibility: 'workspace' },
        { visibility: 'public' },
        { owner: userId },
        { 'members.userId': userId }
      ]
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
    
    const result = await Board.paginate(query, options);
    
    logger.info(`Retrieved ${result.docs.length} boards for workspace`, {
      workspaceId,
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
        'Boards retrieved successfully'
      )
    );
  });
  
  // Get board by ID with full details
  static getBoardById = asyncHandler(async (req, res) => {
    const { boardId } = req.params;
    const userId = req.user.id;
    
    const board = await Board.findById(boardId)
      .populate('owner', 'name email avatar')
      .populate('members.userId', 'name email avatar');
    
    if (!board) {
      return res.status(httpStatus.NOT_FOUND).json(
        ResponseFormatter.error('Board not found', httpStatus.NOT_FOUND)
      );
    }
    
    // Check access permissions
    const hasAccess = board.visibility === 'public' || 
                     board.owner._id.toString() === userId ||
                     board.members.some(member => member.userId._id.toString() === userId);
                     
    if (!hasAccess) {
      // Check workspace membership for workspace visibility
      if (board.visibility === 'workspace') {
        const workspace = await Workspace.findById(board.workspaceId);
        if (!workspace || (!workspace.isMember(userId) && workspace.owner.toString() !== userId)) {
          return res.status(httpStatus.FORBIDDEN).json(
            ResponseFormatter.error('Access denied', httpStatus.FORBIDDEN)
          );
        }
      } else {
        return res.status(httpStatus.FORBIDDEN).json(
          ResponseFormatter.error('Access denied', httpStatus.FORBIDDEN)
        );
      }
    }
    
    // Get board lists with cards
    const lists = await List.find({ 
      boardId, 
      isArchived: false 
    })
    .sort({ position: 1 });
    
    const listIds = lists.map(list => list._id);
    
    const cards = await Card.find({ 
      listId: { $in: listIds }, 
      isArchived: false 
    })
    .populate('assignedTo', 'name email avatar')
    .populate('createdBy', 'name email avatar')
    .sort({ position: 1 });
    
    // Group cards by listId
    const cardsByList = {};
    cards.forEach(card => {
      const listId = card.listId.toString();
      if (!cardsByList[listId]) {
        cardsByList[listId] = [];
      }
      cardsByList[listId].push(card);
    });
    
    // Attach cards to lists
    const listsWithCards = lists.map(list => ({
      ...list.toJSON(),
      cards: cardsByList[list._id.toString()] || []
    }));
    
    const boardData = {
      ...board.toJSON(),
      lists: listsWithCards,
      userRole: board.isMember(userId) ? 
        (board.owner._id.toString() === userId ? 'owner' : 
         board.members.find(m => m.userId._id.toString() === userId)?.role) : null
    };
    
    logger.info(`Board accessed: ${board.name}`, {
      boardId,
      userId,
      userRole: boardData.userRole
    });
    
    res.status(httpStatus.OK).json(
      ResponseFormatter.success(boardData, 'Board retrieved successfully')
    );
  });
  
  // Update board
  static updateBoard = asyncHandler(async (req, res) => {
    const { boardId } = req.params;
    const updates = req.validatedBody;
    const userId = req.user.id;
    
    const board = await Board.findById(boardId);
    
    if (!board) {
      return res.status(httpStatus.NOT_FOUND).json(
        ResponseFormatter.error('Board not found', httpStatus.NOT_FOUND)
      );
    }
    
    // Check permissions
    if (!board.hasPermission(userId, 'member')) {
      return res.status(httpStatus.FORBIDDEN).json(
        ResponseFormatter.error('Insufficient permissions', httpStatus.FORBIDDEN)
      );
    }
    
    const previousData = {
      name: board.name,
      description: board.description,
      visibility: board.visibility,
      background: board.background
    };
    
    // Update allowed fields
    if (updates.name) {
      board.name = stringHelpers.capitalizeWords(updates.name);
      
      // Generate new slug if name changed
      const baseSlug = stringHelpers.generateSlug(updates.name);
      let slug = baseSlug;
      let counter = 1;
      
      while (await Board.findOne({ 
        workspaceId: board.workspaceId, 
        slug, 
        _id: { $ne: boardId } 
      })) {
        slug = `${baseSlug}-${counter}`;
        counter++;
      }
      
      board.slug = slug;
    }
    
    if (updates.description !== undefined) board.description = updates.description;
    if (updates.visibility) board.visibility = updates.visibility;
    if (updates.background) {
      board.background = { ...board.background, ...updates.background };
    }
    
    await board.save();
    
    logger.info(`Board updated: ${board.name}`, {
      boardId,
      updatedBy: userId,
      updates
    });
    
    // Log activity
    await ActivityLogger.logBoardActivity('board_updated', board, req.user, {
      workspaceId: board.workspaceId,
      previousData,
      updates
    });
    
    // Publish board update event
    try {
      await publisher.publishEvent(eventTypes.BOARD_UPDATED, {
        boardId: board._id,
        updates,
        previousData,
        updatedBy: userId,
        updatedAt: board.updatedAt
      });
    } catch (publishError) {
      logger.error('Failed to publish board update event:', publishError);
    }
    
    // Emit real-time event
    const io = req.app.get('io');
    if (io && io.boardHandlers) {
      io.boardHandlers.board_updated({
        boardId: board._id,
        updates,
        previousData,
        updatedBy: {
          id: userId,
          name: req.user.name,
          avatar: req.user.avatar
        }
      });
    }
    
    res.status(httpStatus.OK).json(
      ResponseFormatter.success(board, 'Board updated successfully')
    );
  });
  
  // Archive board
  static archiveBoard = asyncHandler(async (req, res) => {
    const { boardId } = req.params;
    const userId = req.user.id;
    
    const board = await Board.findById(boardId);
    
    if (!board) {
      return res.status(httpStatus.NOT_FOUND).json(
        ResponseFormatter.error('Board not found', httpStatus.NOT_FOUND)
      );
    }
    
    // Only admin or owner can archive
    if (!board.hasPermission(userId, 'admin')) {
      return res.status(httpStatus.FORBIDDEN).json(
        ResponseFormatter.error('Insufficient permissions to archive board', httpStatus.FORBIDDEN)
      );
    }
    
    if (board.isArchived) {
      return res.status(httpStatus.BAD_REQUEST).json(
        ResponseFormatter.error('Board is already archived', httpStatus.BAD_REQUEST)
      );
    }
    
    board.isArchived = true;
    board.archivedAt = new Date();
    await board.save();
    
    // Update workspace statistics
    const workspace = await Workspace.findById(board.workspaceId);
    if (workspace) {
      workspace.statistics.totalBoards -= 1;
      await workspace.save();
    }
    
    logger.info(`Board archived: ${board.name}`, {
      boardId,
      archivedBy: userId
    });
    
    // Log activity
    await ActivityLogger.logBoardActivity('board_archived', board, req.user, {
      workspaceId: board.workspaceId
    });
    
    // Emit real-time event
    const io = req.app.get('io');
    if (io && io.boardHandlers) {
      io.boardHandlers.board_archived({
        boardId: board._id,
        archivedBy: {
          id: userId,
          name: req.user.name,
          avatar: req.user.avatar
        },
        archivedAt: board.archivedAt
      });
    }
    
    res.status(httpStatus.OK).json(
      ResponseFormatter.success(
        {
          isArchived: true,
          archivedAt: board.archivedAt
        },
        'Board archived successfully'
      )
    );
  });
  
  // Unarchive board
  static unarchiveBoard = asyncHandler(async (req, res) => {
    const { boardId } = req.params;
    const userId = req.user.id;
    
    const board = await Board.findById(boardId);
    
    if (!board) {
      return res.status(httpStatus.NOT_FOUND).json(
        ResponseFormatter.error('Board not found', httpStatus.NOT_FOUND)
      );
    }
    
    // Only admin or owner can unarchive
    if (!board.hasPermission(userId, 'admin')) {
      return res.status(httpStatus.FORBIDDEN).json(
        ResponseFormatter.error('Insufficient permissions to unarchive board', httpStatus.FORBIDDEN)
      );
    }
    
    if (!board.isArchived) {
      return res.status(httpStatus.BAD_REQUEST).json(
        ResponseFormatter.error('Board is not archived', httpStatus.BAD_REQUEST)
      );
    }
    
    board.isArchived = false;
    board.archivedAt = null;
    await board.save();
    
    // Update workspace statistics
    const workspace = await Workspace.findById(board.workspaceId);
    if (workspace) {
      workspace.statistics.totalBoards += 1;
      await workspace.save();
    }
    
    logger.info(`Board unarchived: ${board.name}`, {
      boardId,
      unarchivedBy: userId
    });
    
    // Log activity
    await ActivityLogger.logBoardActivity('board_unarchived', board, req.user, {
      workspaceId: board.workspaceId
    });
    
    res.status(httpStatus.OK).json(
      ResponseFormatter.success(
        {
          isArchived: false,
          archivedAt: null
        },
        'Board unarchived successfully'
      )
    );
  });
  
  // Delete board permanently
  static deleteBoard = asyncHandler(async (req, res) => {
    const { boardId } = req.params;
    const userId = req.user.id;
    
    const board = await Board.findById(boardId);
    
    if (!board) {
      return res.status(httpStatus.NOT_FOUND).json(
        ResponseFormatter.error('Board not found', httpStatus.NOT_FOUND)
      );
    }
    
    // Only owner can delete permanently
    if (board.owner.toString() !== userId) {
      return res.status(httpStatus.FORBIDDEN).json(
        ResponseFormatter.error('Only board owner can delete the board', httpStatus.FORBIDDEN)
      );
    }
    
    // Check if board has active cards
    const cardCount = await Card.countDocuments({ boardId, isArchived: false });
    
    if (cardCount > 0) {
      return res.status(httpStatus.BAD_REQUEST).json(
        ResponseFormatter.error(
          `Cannot delete board with ${cardCount} active cards. Please archive or delete all cards first.`,
          httpStatus.BAD_REQUEST
        )
      );
    }
    
    // Delete all associated data
    await Promise.all([
      List.deleteMany({ boardId }),
      Card.deleteMany({ boardId })
    ]);
    
    await Board.findByIdAndDelete(boardId);
    
    // Update workspace statistics
    const workspace = await Workspace.findById(board.workspaceId);
    if (workspace) {
      workspace.statistics.totalBoards -= 1;
      await workspace.save();
    }
    
    logger.info(`Board deleted: ${board.name}`, {
      boardId,
      deletedBy: userId
    });
    
    // Log activity
    await ActivityLogger.logBoardActivity('board_deleted', board, req.user, {
      workspaceId: board.workspaceId
    });
    
    // Publish board deletion event
    try {
      await publisher.publishEvent(eventTypes.BOARD_DELETED, {
        boardId: board._id,
        name: board.name,
        workspaceId: board.workspaceId,
        deletedBy: userId,
        deletedAt: new Date()
      });
    } catch (publishError) {
      logger.error('Failed to publish board deletion event:', publishError);
    }
    
    res.status(httpStatus.OK).json(
      ResponseFormatter.success(null, 'Board deleted successfully')
    );
  });
  
  // Add member to board
  static addMember = asyncHandler(async (req, res) => {
    const { boardId } = req.params;
    const { userId: newUserId, role = 'member' } = req.validatedBody;
    const currentUserId = req.user.id;
    
    const board = await Board.findById(boardId).populate('workspaceId');
    
    if (!board) {
      return res.status(httpStatus.NOT_FOUND).json(
        ResponseFormatter.error('Board not found', httpStatus.NOT_FOUND)
      );
    }
    
    // Check permissions
    if (!board.hasPermission(currentUserId, 'admin')) {
      return res.status(httpStatus.FORBIDDEN).json(
        ResponseFormatter.error('Insufficient permissions', httpStatus.FORBIDDEN)
      );
    }
    
    // Check if user is already a member
    if (board.isMember(newUserId)) {
      return res.status(httpStatus.CONFLICT).json(
        ResponseFormatter.error('User is already a member', httpStatus.CONFLICT)
      );
    }
    
    // Check if user is workspace member
    const workspace = board.workspaceId;
    if (!workspace.isMember(newUserId) && workspace.owner.toString() !== newUserId) {
      return res.status(httpStatus.BAD_REQUEST).json(
        ResponseFormatter.error('User must be a workspace member first', httpStatus.BAD_REQUEST)
      );
    }
    
    // Add member
    board.members.push({
      userId: newUserId,
      role,
      joinedAt: new Date()
    });
    
    await board.save();
    
    logger.info(`Member added to board: ${newUserId}`, {
      boardId,
      addedBy: currentUserId,
      role
    });
    
    // Log activity
    await ActivityLogger.logBoardActivity('board_member_added', board, req.user, {
      workspaceId: board.workspaceId,
      newMemberId: newUserId,
      memberRole: role
    });
    
    // Emit real-time event
    const io = req.app.get('io');
    if (io && io.boardHandlers) {
      io.boardHandlers.board_member_added({
        boardId: board._id,
        newMemberId: newUserId,
        role,
        addedBy: {
          id: currentUserId,
          name: req.user.name,
          avatar: req.user.avatar
        }
      });
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
  
  // Remove member from board
  static removeMember = asyncHandler(async (req, res) => {
    const { boardId, memberId } = req.params;
    const userId = req.user.id;
    
    const board = await Board.findById(boardId);
    
    if (!board) {
      return res.status(httpStatus.NOT_FOUND).json(
        ResponseFormatter.error('Board not found', httpStatus.NOT_FOUND)
      );
    }
    
    // Check permissions (admin can remove others, users can remove themselves)
    if (memberId !== userId && !board.hasPermission(userId, 'admin')) {
      return res.status(httpStatus.FORBIDDEN).json(
        ResponseFormatter.error('Insufficient permissions', httpStatus.FORBIDDEN)
      );
    }
    
    // Cannot remove board owner
    if (board.owner.toString() === memberId) {
      return res.status(httpStatus.BAD_REQUEST).json(
        ResponseFormatter.error('Cannot remove board owner', httpStatus.BAD_REQUEST)
      );
    }
    
    // Check if member exists
    const memberIndex = board.members.findIndex(
      member => member.userId.toString() === memberId
    );
    
    if (memberIndex === -1) {
      return res.status(httpStatus.NOT_FOUND).json(
        ResponseFormatter.error('Member not found', httpStatus.NOT_FOUND)
      );
    }
    
    const removedMember = board.members[memberIndex];
    board.members.splice(memberIndex, 1);
    
    await board.save();
    
    logger.info(`Member removed from board: ${memberId}`, {
      boardId,
      removedBy: userId
    });
    
    // Log activity
    await ActivityLogger.logBoardActivity('board_member_removed', board, req.user, {
      workspaceId: board.workspaceId,
      removedMemberId: memberId,
      memberRole: removedMember.role
    });
    
    // Emit real-time event
    const io = req.app.get('io');
    if (io && io.boardHandlers) {
      io.boardHandlers.board_member_removed({
        boardId: board._id,
        removedMemberId: memberId,
        removedBy: {
          id: userId,
          name: req.user.name,
          avatar: req.user.avatar
        }
      });
    }
    
    res.status(httpStatus.OK).json(
      ResponseFormatter.success(null, 'Member removed successfully')
    );
  });
  
  // Update member role
  static updateMemberRole = asyncHandler(async (req, res) => {
    const { boardId, memberId } = req.params;
    const { role } = req.validatedBody;
    const userId = req.user.id;
    
    const board = await Board.findById(boardId);
    
    if (!board) {
      return res.status(httpStatus.NOT_FOUND).json(
        ResponseFormatter.error('Board not found', httpStatus.NOT_FOUND)
      );
    }
    
    // Check permissions
    if (!board.hasPermission(userId, 'admin')) {
      return res.status(httpStatus.FORBIDDEN).json(
        ResponseFormatter.error('Insufficient permissions', httpStatus.FORBIDDEN)
      );
    }
    
    // Cannot change owner's role
    if (board.owner.toString() === memberId) {
      return res.status(httpStatus.BAD_REQUEST).json(
        ResponseFormatter.error('Cannot change board owner role', httpStatus.BAD_REQUEST)
      );
    }
    
    // Find member
    const member = board.members.find(
      member => member.userId.toString() === memberId
    );
    
    if (!member) {
      return res.status(httpStatus.NOT_FOUND).json(
        ResponseFormatter.error('Member not found', httpStatus.NOT_FOUND)
      );
    }
    
    const previousRole = member.role;
    member.role = role;
    
    await board.save();
    
    logger.info(`Member role updated in board: ${memberId}`, {
      boardId,
      previousRole,
      newRole: role,
      updatedBy: userId
    });
    
    // Log activity
    await ActivityLogger.logBoardActivity('board_member_role_changed', board, req.user, {
      workspaceId: board.workspaceId,
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
  
  // Duplicate board
  static duplicateBoard = asyncHandler(async (req, res) => {
    const { boardId } = req.params;
    const { name, includeCards = false } = req.validatedBody;
    const userId = req.user.id;
    
    const originalBoard = await Board.findById(boardId);
    
    if (!originalBoard) {
      return res.status(httpStatus.NOT_FOUND).json(
        ResponseFormatter.error('Board not found', httpStatus.NOT_FOUND)
      );
    }
    
    // Check if user has access to original board
    if (!originalBoard.isMember(userId)) {
      return res.status(httpStatus.FORBIDDEN).json(
        ResponseFormatter.error('Access denied', httpStatus.FORBIDDEN)
      );
    }
    
    // Generate unique slug
    const baseSlug = stringHelpers.generateSlug(name || `${originalBoard.name} Copy`);
    let slug = baseSlug;
    let counter = 1;
    
    while (await Board.findOne({ workspaceId: originalBoard.workspaceId, slug })) {
      slug = `${baseSlug}-${counter}`;
      counter++;
    }
    
    // Create duplicate board
    const duplicateBoard = new Board({
      name: name || `${originalBoard.name} Copy`,
      description: originalBoard.description,
      slug,
      workspaceId: originalBoard.workspaceId,
      owner: userId,
      visibility: originalBoard.visibility,
      background: originalBoard.background,
      labels: originalBoard.labels,
      members: [{
        userId,
        role: 'admin',
        joinedAt: new Date()
      }]
    });
    
    await duplicateBoard.save();
    
    // Duplicate lists
    const originalLists = await List.find({ 
      boardId: originalBoard._id, 
      isArchived: false 
    }).sort({ position: 1 });
    
    const listMapping = {};
    
    for (const originalList of originalLists) {
      const duplicateList = new List({
        name: originalList.name,
        boardId: duplicateBoard._id,
        position: originalList.position
      });
      
      await duplicateList.save();
      listMapping[originalList._id.toString()] = duplicateList._id;
      
      // Duplicate cards if requested
      if (includeCards) {
        const originalCards = await Card.find({ 
          listId: originalList._id, 
          isArchived: false 
        }).sort({ position: 1 });
        
        for (const originalCard of originalCards) {
          const duplicateCard = new Card({
            title: originalCard.title,
            description: originalCard.description,
            listId: duplicateList._id,
            boardId: duplicateBoard._id,
            position: originalCard.position,
            createdBy: userId,
            priority: originalCard.priority,
            labels: originalCard.labels,
            checklist: originalCard.checklist.map(item => ({
              ...item,
              completed: false,
              completedAt: null,
              completedBy: null
            }))
          });
          
          await duplicateCard.save();
          duplicateList.cardCount += 1;
        }
        
        await duplicateList.save();
      }
    }
    
    // Update board statistics
    duplicateBoard.statistics.totalLists = originalLists.length;
    if (includeCards) {
      const totalCards = await Card.countDocuments({ boardId: duplicateBoard._id });
      duplicateBoard.statistics.totalCards = totalCards;
    }
    await duplicateBoard.save();
    
    // Update workspace statistics
    const workspace = await Workspace.findById(duplicateBoard.workspaceId);
    if (workspace) {
      workspace.statistics.totalBoards += 1;
      if (includeCards) {
        const totalCards = await Card.countDocuments({ boardId: duplicateBoard._id });
        workspace.statistics.totalCards += totalCards;
      }
      await workspace.save();
    }
    
    logger.info(`Board duplicated: ${originalBoard.name} -> ${duplicateBoard.name}`, {
      originalBoardId: boardId,
      duplicateBoardId: duplicateBoard._id,
      includeCards,
      duplicatedBy: userId
    });
    
    // Log activity
    await ActivityLogger.logBoardActivity('board_created', duplicateBoard, req.user, {
      workspaceId: duplicateBoard.workspaceId,
      duplicatedFrom: originalBoard.name
    });
    
    res.status(httpStatus.CREATED).json(
      ResponseFormatter.success(
        duplicateBoard,
        'Board duplicated successfully',
        httpStatus.CREATED
      )
    );
  });
  
  // Get board statistics
  static getBoardStats = asyncHandler(async (req, res) => {
    const { boardId } = req.params;
    const userId = req.user.id;
    
    const board = await Board.findById(boardId);
    
    if (!board) {
      return res.status(httpStatus.NOT_FOUND).json(
        ResponseFormatter.error('Board not found', httpStatus.NOT_FOUND)
      );
    }
    
    // Check access
    if (!board.isMember(userId)) {
      return res.status(httpStatus.FORBIDDEN).json(
        ResponseFormatter.error('Access denied', httpStatus.FORBIDDEN)
      );
    }
    
    // Get detailed statistics
    const [listStats, cardStats, memberStats] = await Promise.all([
      List.aggregate([
        { $match: { boardId: board._id, isArchived: false } },
        {
          $group: {
            _id: null,
            totalLists: { $sum: 1 },
            totalCardCount: { $sum: '$cardCount' }
          }
        }
      ]),
      Card.aggregate([
        { $match: { boardId: board._id, isArchived: false } },
        {
          $group: {
            _id: null,
            totalCards: { $sum: 1 },
            completedCards: {
              $sum: { $cond: [{ $eq: ['$status', 'done'] }, 1, 0] }
            },
            overdueCards: {
              $sum: {
                $cond: [
                  {
                    $and: [
                      { $ne: ['$dueDate', null] },
                      { $lt: ['$dueDate', new Date()] },
                      { $ne: ['$status', 'done'] }
                    ]
                  },
                  1,
                  0
                ]
              }
            },
            dueSoonCards: {
              $sum: {
                $cond: [
                  {
                    $and: [
                      { $ne: ['$dueDate', null] },
                      { $gte: ['$dueDate', new Date()] },
                      { $lte: ['$dueDate', new Date(Date.now() + 3 * 24 * 60 * 60 * 1000)] },
                      { $ne: ['$status', 'done'] }
                    ]
                  },
                  1,
                  0
                ]
              }
            },
            highPriorityCards: {
              $sum: { $cond: [{ $in: ['$priority', ['high', 'urgent']] }, 1, 0] }
            }
          }
        }
      ]),
      Card.aggregate([
        { $match: { boardId: board._id, isArchived: false } },
        { $unwind: '$assignedTo' },
        {
          $group: {
            _id: '$assignedTo',
            assignedCards: { $sum: 1 },
            completedCards: {
              $sum: { $cond: [{ $eq: ['$status', 'done'] }, 1, 0] }
            }
          }
        },
        { $sort: { assignedCards: -1 } },
        { $limit: 10 }
      ])
    ]);
    
    // Get activity timeline (last 30 days)
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const Activity = require('../models/Activity');
    
    const recentActivities = await Activity.find({
      boardId: board._id,
      createdAt: { $gte: thirtyDaysAgo }
    })
    .sort({ createdAt: -1 })
    .limit(20)
    .populate('userId', 'name avatar');
    
    const stats = {
      lists: listStats[0] || {
        totalLists: 0,
        totalCardCount: 0
      },
      cards: cardStats[0] || {
        totalCards: 0,
        completedCards: 0,
        overdueCards: 0,
        dueSoonCards: 0,
        highPriorityCards: 0
      },
      members: {
        totalMembers: board.members.length + 1, // +1 for owner
        admins: board.members.filter(m => m.role === 'admin').length + 1,
        members: board.members.filter(m => m.role === 'member').length,
        viewers: board.members.filter(m => m.role === 'viewer').length,
        topContributors: memberStats
      },
      recentActivities: recentActivities.slice(0, 10)
    };
    
    res.status(httpStatus.OK).json(
      ResponseFormatter.success(stats, 'Board statistics retrieved successfully')
    );
  });
  
  // Search within board
  static searchBoard = asyncHandler(async (req, res) => {
    const { boardId } = req.params;
    const { query, type = 'all' } = req.query;
    const userId = req.user.id;
    
    if (!query || query.length < 2) {
      return res.status(httpStatus.BAD_REQUEST).json(
        ResponseFormatter.error('Search query must be at least 2 characters long', httpStatus.BAD_REQUEST)
      );
    }
    
    const board = await Board.findById(boardId);
    
    if (!board) {
      return res.status(httpStatus.NOT_FOUND).json(
        ResponseFormatter.error('Board not found', httpStatus.NOT_FOUND)
      );
    }
    
    // Check access
    if (!board.isMember(userId)) {
      return res.status(httpStatus.FORBIDDEN).json(
        ResponseFormatter.error('Access denied', httpStatus.FORBIDDEN)
      );
    }
    
    const results = {};
    
    if (type === 'all' || type === 'cards') {
      results.cards = await Card.find({
        boardId,
        isArchived: false,
        $or: [
          { title: { $regex: query, $options: 'i' } },
          { description: { $regex: query, $options: 'i' } },
          { labels: { $in: [new RegExp(query, 'i')] } }
        ]
      })
      .populate('assignedTo', 'name email avatar')
      .populate('createdBy', 'name email avatar')
      .populate('listId', 'name')
      .limit(50)
      .sort({ updatedAt: -1 });
    }
    
    if (type === 'all' || type === 'lists') {
      results.lists = await List.find({
        boardId,
        isArchived: false,
        name: { $regex: query, $options: 'i' }
      })
      .limit(20)
      .sort({ position: 1 });
    }
    
    if (type === 'all' || type === 'comments') {
      const Comment = require('../models/Comment');
      results.comments = await Comment.find({
        cardId: { $in: await Card.find({ boardId }).distinct('_id') },
        content: { $regex: query, $options: 'i' },
        isDeleted: false
      })
      .populate('author', 'name email avatar')
      .populate('cardId', 'title')
      .limit(30)
      .sort({ createdAt: -1 });
    }
    
    const totalResults = Object.values(results).reduce((sum, arr) => sum + arr.length, 0);
    
    logger.info(`Board search performed: "${query}"`, {
      boardId,
      searchedBy: userId,
      type,
      totalResults
    });
    
    res.status(httpStatus.OK).json(
      ResponseFormatter.success(
        {
          query,
          type,
          totalResults,
          results
        },
        'Search completed successfully'
      )
    );
  });
  
  // Export board data
  static exportBoard = asyncHandler(async (req, res) => {
    const { boardId } = req.params;
    const { format = 'json', includeArchived = false } = req.query;
    const userId = req.user.id;
    
    const board = await Board.findById(boardId)
      .populate('owner', 'name email avatar')
      .populate('members.userId', 'name email avatar');
    
    if (!board) {
      return res.status(httpStatus.NOT_FOUND).json(
        ResponseFormatter.error('Board not found', httpStatus.NOT_FOUND)
      );
    }
    
    // Check access
    if (!board.isMember(userId)) {
      return res.status(httpStatus.FORBIDDEN).json(
        ResponseFormatter.error('Access denied', httpStatus.FORBIDDEN)
      );
    }
    
    // Get all board data
    const listQuery = { boardId };
    const cardQuery = { boardId };
    
    if (!includeArchived) {
      listQuery.isArchived = false;
      cardQuery.isArchived = false;
    }
    
    const [lists, cards, comments] = await Promise.all([
      List.find(listQuery).sort({ position: 1 }),
      Card.find(cardQuery)
        .populate('assignedTo', 'name email avatar')
        .populate('createdBy', 'name email avatar')
        .sort({ listId: 1, position: 1 }),
      require('../models/Comment').find({
        cardId: { $in: await Card.find(cardQuery).distinct('_id') },
        isDeleted: false
      }).populate('author', 'name email avatar')
    ]);
    
    const exportData = {
      board: {
        id: board._id,
        name: board.name,
        description: board.description,
        slug: board.slug,
        owner: board.owner,
        members: board.members,
        visibility: board.visibility,
        background: board.background,
        labels: board.labels,
        statistics: board.statistics,
        createdAt: board.createdAt,
        updatedAt: board.updatedAt
      },
      lists: lists.map(list => ({
        id: list._id,
        name: list.name,
        position: list.position,
        cardCount: list.cardCount,
        createdAt: list.createdAt,
        cards: cards.filter(card => card.listId.toString() === list._id.toString()).map(card => ({
          id: card._id,
          title: card.title,
          description: card.description,
          position: card.position,
          assignedTo: card.assignedTo,
          createdBy: card.createdBy,
          priority: card.priority,
          status: card.status,
          labels: card.labels,
          dueDate: card.dueDate,
          checklist: card.checklist,
          attachments: card.attachments,
          createdAt: card.createdAt,
          updatedAt: card.updatedAt,
          comments: comments.filter(comment => comment.cardId.toString() === card._id.toString())
        }))
      })),
      exportedAt: new Date(),
      exportedBy: req.user,
      includeArchived
    };
    
    logger.info(`Board exported: ${board.name}`, {
      boardId,
      format,
      includeArchived,
      exportedBy: userId
    });
    
    if (format === 'json') {
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Content-Disposition', `attachment; filename="${board.slug}-export.json"`);
      res.send(JSON.stringify(exportData, null, 2));
    } else {
      res.status(httpStatus.OK).json(
        ResponseFormatter.success(exportData, 'Board data exported successfully')
      );
    }
  });
}

module.exports = BoardController;