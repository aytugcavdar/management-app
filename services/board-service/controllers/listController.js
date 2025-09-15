// services/board-service/controllers/listController.js
const List = require('../models/List');
const Board = require('../models/Board');
const Card = require('../models/Card');
const ActivityLogger = require('../utils/activityLogger');

const {
  helpers: { ResponseFormatter, stringHelpers },
  constants: { httpStatus, eventTypes },
  rabbitmq: { publisher },
  middleware: { errorHandler: { asyncHandler } },
  logger
} = require('@management-app/shared-utils');

class ListController {
  // Create new list
  static createList = asyncHandler(async (req, res) => {
    const { name, boardId, position } = req.validatedBody;
    const userId = req.user.id;
    
    // Check if board exists and user has access
    const board = await Board.findById(boardId);
    
    if (!board) {
      return res.status(httpStatus.NOT_FOUND).json(
        ResponseFormatter.error('Board not found', httpStatus.NOT_FOUND)
      );
    }
    
    if (!board.isMember(userId)) {
      return res.status(httpStatus.FORBIDDEN).json(
        ResponseFormatter.error('Access denied to board', httpStatus.FORBIDDEN)
      );
    }
    
    // Check if user has permission to create lists (members and above)
    if (!board.hasPermission(userId, 'member')) {
      return res.status(httpStatus.FORBIDDEN).json(
        ResponseFormatter.error('Insufficient permissions to create lists', httpStatus.FORBIDDEN)
      );
    }
    
    // Determine position if not provided
    let finalPosition = position;
    if (finalPosition === undefined) {
      const maxPosition = await List.findOne({ boardId, isArchived: false })
        .sort({ position: -1 })
        .select('position');
      finalPosition = maxPosition ? maxPosition.position + 1 : 0;
    } else {
      // Shift other lists if inserting at specific position
      await List.updateMany(
        { 
          boardId, 
          position: { $gte: finalPosition },
          isArchived: false 
        },
        { $inc: { position: 1 } }
      );
    }
    
    const list = new List({
      name: stringHelpers.capitalizeWords(name),
      boardId,
      position: finalPosition
    });
    
    await list.save();
    
    // Update board statistics
    board.statistics.totalLists += 1;
    await board.save();
    
    logger.info(`List created: ${list.name}`, {
      listId: list._id,
      boardId,
      createdBy: userId,
      position: finalPosition
    });
    
    // Log activity
    await ActivityLogger.logBoardActivity('list_created', board, req.user, {
      workspaceId: board.workspaceId,
      listId: list._id,
      listName: list.name,
      position: finalPosition
    });
    
    // Publish list creation event
    try {
      await publisher.publishEvent(eventTypes.LIST_CREATED, {
        listId: list._id,
        name: list.name,
        boardId,
        position: finalPosition,
        createdBy: userId,
        createdAt: list.createdAt
      });
    } catch (publishError) {
      logger.error('Failed to publish list creation event:', publishError);
    }
    
    // Emit real-time event
    const io = req.app.get('io');
    if (io && io.listHandlers) {
      io.listHandlers.list_created({
        listId: list._id,
        list: list.toJSON(),
        boardId,
        createdBy: {
          id: userId,
          name: req.user.name,
          avatar: req.user.avatar
        }
      });
    }
    
    res.status(httpStatus.CREATED).json(
      ResponseFormatter.success(
        list,
        'List created successfully',
        httpStatus.CREATED
      )
    );
  });
  
  // Get lists by board
  static getListsByBoard = asyncHandler(async (req, res) => {
    const { boardId } = req.params;
    const { includeArchived = false, includeCards = false } = req.query;
    const userId = req.user.id;
    
    // Check board access
    const board = await Board.findById(boardId);
    
    if (!board) {
      return res.status(httpStatus.NOT_FOUND).json(
        ResponseFormatter.error('Board not found', httpStatus.NOT_FOUND)
      );
    }
    
    if (!board.isMember(userId)) {
      return res.status(httpStatus.FORBIDDEN).json(
        ResponseFormatter.error('Access denied to board', httpStatus.FORBIDDEN)
      );
    }
    
    const query = { boardId };
    if (!includeArchived) {
      query.isArchived = false;
    }
    
    const lists = await List.find(query)
      .sort({ position: 1, createdAt: 1 });
    
    let listsData = lists;
    
    // Include cards if requested
    if (includeCards) {
      const listIds = lists.map(list => list._id);
      const cardQuery = { listId: { $in: listIds } };
      if (!includeArchived) {
        cardQuery.isArchived = false;
      }
      
      const cards = await Card.find(cardQuery)
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
      
      listsData = lists.map(list => ({
        ...list.toJSON(),
        cards: cardsByList[list._id.toString()] || []
      }));
    }
    
    logger.info(`Retrieved ${lists.length} lists for board`, {
      boardId,
      includeArchived,
      includeCards,
      userId
    });
    
    res.status(httpStatus.OK).json(
      ResponseFormatter.success(
        listsData,
        'Lists retrieved successfully'
      )
    );
  });
  
  // Get list by ID
  static getListById = asyncHandler(async (req, res) => {
    const { listId } = req.params;
    const { includeCards = false } = req.query;
    const userId = req.user.id;
    
    const list = await List.findById(listId);
    
    if (!list) {
      return res.status(httpStatus.NOT_FOUND).json(
        ResponseFormatter.error('List not found', httpStatus.NOT_FOUND)
      );
    }
    
    // Check board access
    const board = await Board.findById(list.boardId);
    
    if (!board || !board.isMember(userId)) {
      return res.status(httpStatus.FORBIDDEN).json(
        ResponseFormatter.error('Access denied', httpStatus.FORBIDDEN)
      );
    }
    
    let listData = list.toJSON();
    
    // Include cards if requested
    if (includeCards) {
      const cards = await Card.find({ 
        listId, 
        isArchived: false 
      })
      .populate('assignedTo', 'name email avatar')
      .populate('createdBy', 'name email avatar')
      .sort({ position: 1 });
      
      listData.cards = cards;
    }
    
    res.status(httpStatus.OK).json(
      ResponseFormatter.success(listData, 'List retrieved successfully')
    );
  });
  
  // Update list
  static updateList = asyncHandler(async (req, res) => {
    const { listId } = req.params;
    const { name } = req.validatedBody;
    const userId = req.user.id;
    
    const list = await List.findById(listId);
    
    if (!list) {
      return res.status(httpStatus.NOT_FOUND).json(
        ResponseFormatter.error('List not found', httpStatus.NOT_FOUND)
      );
    }
    
    // Check board access and permissions
    const board = await Board.findById(list.boardId);
    
    if (!board) {
      return res.status(httpStatus.NOT_FOUND).json(
        ResponseFormatter.error('Board not found', httpStatus.NOT_FOUND)
      );
    }
    
    if (!board.hasPermission(userId, 'member')) {
      return res.status(httpStatus.FORBIDDEN).json(
        ResponseFormatter.error('Insufficient permissions', httpStatus.FORBIDDEN)
      );
    }
    
    const previousData = {
      name: list.name
    };
    
    list.name = stringHelpers.capitalizeWords(name);
    await list.save();
    
    logger.info(`List updated: ${list.name}`, {
      listId,
      boardId: list.boardId,
      updatedBy: userId,
      previousName: previousData.name
    });
    
    // Log activity
    await ActivityLogger.logBoardActivity('list_updated', board, req.user, {
      workspaceId: board.workspaceId,
      listId: list._id,
      listName: list.name,
      previousData
    });
    
    // Publish list update event
    try {
      await publisher.publishEvent(eventTypes.LIST_UPDATED, {
        listId: list._id,
        name: list.name,
        boardId: list.boardId,
        previousData,
        updatedBy: userId,
        updatedAt: list.updatedAt
      });
    } catch (publishError) {
      logger.error('Failed to publish list update event:', publishError);
    }
    
    // Emit real-time event
    const io = req.app.get('io');
    if (io && io.listHandlers) {
      io.listHandlers.list_updated({
        listId: list._id,
        list: list.toJSON(),
        boardId: list.boardId,
        previousData,
        updatedBy: {
          id: userId,
          name: req.user.name,
          avatar: req.user.avatar
        }
      });
    }
    
    res.status(httpStatus.OK).json(
      ResponseFormatter.success(list, 'List updated successfully')
    );
  });
  
  // Move list (change position)
  static moveList = asyncHandler(async (req, res) => {
    const { listId } = req.params;
    const { position: newPosition } = req.validatedBody;
    const userId = req.user.id;
    
    const list = await List.findById(listId);
    
    if (!list) {
      return res.status(httpStatus.NOT_FOUND).json(
        ResponseFormatter.error('List not found', httpStatus.NOT_FOUND)
      );
    }
    
    // Check board access and permissions
    const board = await Board.findById(list.boardId);
    
    if (!board || !board.hasPermission(userId, 'member')) {
      return res.status(httpStatus.FORBIDDEN).json(
        ResponseFormatter.error('Insufficient permissions', httpStatus.FORBIDDEN)
      );
    }
    
    const oldPosition = list.position;
    
    if (oldPosition === newPosition) {
      return res.status(httpStatus.OK).json(
        ResponseFormatter.success(list, 'List position unchanged')
      );
    }
    
    // Update positions of other lists
    if (newPosition > oldPosition) {
      // Moving right: decrease position of lists between old and new position
      await List.updateMany(
        {
          boardId: list.boardId,
          position: { $gt: oldPosition, $lte: newPosition },
          _id: { $ne: listId },
          isArchived: false
        },
        { $inc: { position: -1 } }
      );
    } else {
      // Moving left: increase position of lists between new and old position
      await List.updateMany(
        {
          boardId: list.boardId,
          position: { $gte: newPosition, $lt: oldPosition },
          _id: { $ne: listId },
          isArchived: false
        },
        { $inc: { position: 1 } }
      );
    }
    
    // Update list position
    list.position = newPosition;
    await list.save();
    
    logger.info(`List moved: ${list.name}`, {
      listId,
      boardId: list.boardId,
      oldPosition,
      newPosition,
      movedBy: userId
    });
    
    // Log activity
    await ActivityLogger.logBoardActivity('list_moved', board, req.user, {
      workspaceId: board.workspaceId,
      listId: list._id,
      listName: list.name,
      oldPosition,
      newPosition
    });
    
    // Emit real-time event
    const io = req.app.get('io');
    if (io && io.listHandlers) {
      io.listHandlers.list_moved({
        listId: list._id,
        boardId: list.boardId,
        oldPosition,
        newPosition,
        movedBy: {
          id: userId,
          name: req.user.name,
          avatar: req.user.avatar
        }
      });
    }
    
    res.status(httpStatus.OK).json(
      ResponseFormatter.success(
        {
          id: list._id,
          name: list.name,
          oldPosition,
          newPosition
        },
        'List moved successfully'
      )
    );
  });
  
  // Archive list
  static archiveList = asyncHandler(async (req, res) => {
    const { listId } = req.params;
    const userId = req.user.id;
    
    const list = await List.findById(listId);
    
    if (!list) {
      return res.status(httpStatus.NOT_FOUND).json(
        ResponseFormatter.error('List not found', httpStatus.NOT_FOUND)
      );
    }
    
    // Check board access and permissions
    const board = await Board.findById(list.boardId);
    
    if (!board || !board.hasPermission(userId, 'member')) {
      return res.status(httpStatus.FORBIDDEN).json(
        ResponseFormatter.error('Insufficient permissions', httpStatus.FORBIDDEN)
      );
    }
    
    if (list.isArchived) {
      return res.status(httpStatus.BAD_REQUEST).json(
        ResponseFormatter.error('List is already archived', httpStatus.BAD_REQUEST)
      );
    }
    
    // Archive the list
    list.isArchived = true;
    list.archivedAt = new Date();
    await list.save();
    
    // Archive all cards in the list
    await Card.updateMany(
      { listId, isArchived: false },
      { 
        isArchived: true, 
        archivedAt: new Date() 
      }
    );
    
    // Update positions of remaining lists
    await List.updateMany(
      {
        boardId: list.boardId,
        position: { $gt: list.position },
        isArchived: false
      },
      { $inc: { position: -1 } }
    );
    
    // Update board statistics
    board.statistics.totalLists -= 1;
    const archivedCardCount = await Card.countDocuments({ listId, isArchived: true });
    board.statistics.totalCards -= archivedCardCount;
    await board.save();
    
    logger.info(`List archived: ${list.name}`, {
      listId,
      boardId: list.boardId,
      archivedBy: userId,
      archivedCardCount
    });
    
    // Log activity
    await ActivityLogger.logBoardActivity('list_archived', board, req.user, {
      workspaceId: board.workspaceId,
      listId: list._id,
      listName: list.name,
      archivedCardCount
    });
    
    // Emit real-time event
    const io = req.app.get('io');
    if (io && io.listHandlers) {
      io.listHandlers.list_archived({
        listId: list._id,
        boardId: list.boardId,
        archivedBy: {
          id: userId,
          name: req.user.name,
          avatar: req.user.avatar
        },
        archivedAt: list.archivedAt,
        archivedCardCount
      });
    }
    
    res.status(httpStatus.OK).json(
      ResponseFormatter.success(
        {
          isArchived: true,
          archivedAt: list.archivedAt,
          archivedCardCount
        },
        'List archived successfully'
      )
    );
  });
  
  // Unarchive list
  static unarchiveList = asyncHandler(async (req, res) => {
    const { listId } = req.params;
    const userId = req.user.id;
    
    const list = await List.findById(listId);
    
    if (!list) {
      return res.status(httpStatus.NOT_FOUND).json(
        ResponseFormatter.error('List not found', httpStatus.NOT_FOUND)
      );
    }
    
    // Check board access and permissions
    const board = await Board.findById(list.boardId);
    
    if (!board || !board.hasPermission(userId, 'member')) {
      return res.status(httpStatus.FORBIDDEN).json(
        ResponseFormatter.error('Insufficient permissions', httpStatus.FORBIDDEN)
      );
    }
    
    if (!list.isArchived) {
      return res.status(httpStatus.BAD_REQUEST).json(
        ResponseFormatter.error('List is not archived', httpStatus.BAD_REQUEST)
      );
    }
    
    // Find the last position for unarchived lists
    const maxPosition = await List.findOne({ 
      boardId: list.boardId, 
      isArchived: false 
    })
    .sort({ position: -1 })
    .select('position');
    
    // Unarchive the list
    list.isArchived = false;
    list.archivedAt = null;
    list.position = maxPosition ? maxPosition.position + 1 : 0;
    await list.save();
    
    // Note: Cards remain archived and need to be unarchived individually
    
    // Update board statistics
    board.statistics.totalLists += 1;
    await board.save();
    
    logger.info(`List unarchived: ${list.name}`, {
      listId,
      boardId: list.boardId,
      unarchivedBy: userId,
      newPosition: list.position
    });
    
    // Log activity
    await ActivityLogger.logBoardActivity('list_unarchived', board, req.user, {
      workspaceId: board.workspaceId,
      listId: list._id,
      listName: list.name,
      newPosition: list.position
    });
    
    res.status(httpStatus.OK).json(
      ResponseFormatter.success(
        {
          isArchived: false,
          archivedAt: null,
          position: list.position
        },
        'List unarchived successfully'
      )
    );
  });
  
  // Delete list permanently
  static deleteList = asyncHandler(async (req, res) => {
    const { listId } = req.params;
    const userId = req.user.id;
    
    const list = await List.findById(listId);
    
    if (!list) {
      return res.status(httpStatus.NOT_FOUND).json(
        ResponseFormatter.error('List not found', httpStatus.NOT_FOUND)
      );
    }
    
    // Check board access and permissions (only admin can delete)
    const board = await Board.findById(list.boardId);
    
    if (!board || !board.hasPermission(userId, 'admin')) {
      return res.status(httpStatus.FORBIDDEN).json(
        ResponseFormatter.error('Insufficient permissions to delete list', httpStatus.FORBIDDEN)
      );
    }
    
    // Check if list has active cards
    const cardCount = await Card.countDocuments({ listId, isArchived: false });
    
    if (cardCount > 0) {
      return res.status(httpStatus.BAD_REQUEST).json(
        ResponseFormatter.error(
          `Cannot delete list with ${cardCount} active cards. Please archive or move all cards first.`,
          httpStatus.BAD_REQUEST
        )
      );
    }
    
    // Delete all cards in the list (archived ones too)
    await Card.deleteMany({ listId });
    
    // Update positions of remaining lists
    await List.updateMany(
      {
        boardId: list.boardId,
        position: { $gt: list.position },
        isArchived: false
      },
      { $inc: { position: -1 } }
    );
    
    // Delete the list
    await List.findByIdAndDelete(listId);
    
    // Update board statistics
    if (!list.isArchived) {
      board.statistics.totalLists -= 1;
    }
    await board.save();
    
    logger.info(`List deleted: ${list.name}`, {
      listId,
      boardId: list.boardId,
      deletedBy: userId
    });
    
    // Log activity
    await ActivityLogger.logBoardActivity('list_deleted', board, req.user, {
      workspaceId: board.workspaceId,
      listId: list._id,
      listName: list.name
    });
    
    // Emit real-time event
    const io = req.app.get('io');
    if (io && io.listHandlers) {
      io.listHandlers.list_deleted({
        listId: list._id,
        boardId: list.boardId,
        deletedBy: {
          id: userId,
          name: req.user.name,
          avatar: req.user.avatar
        }
      });
    }
    
    res.status(httpStatus.OK).json(
      ResponseFormatter.success(null, 'List deleted successfully')
    );
  });
  
  // Copy list to another board
  static copyList = asyncHandler(async (req, res) => {
    const { listId } = req.params;
    const { targetBoardId, name, includeCards = true } = req.validatedBody;
    const userId = req.user.id;
    
    const originalList = await List.findById(listId);
    
    if (!originalList) {
      return res.status(httpStatus.NOT_FOUND).json(
        ResponseFormatter.error('List not found', httpStatus.NOT_FOUND)
      );
    }
    
    // Check access to source board
    const sourceBoard = await Board.findById(originalList.boardId);
    if (!sourceBoard || !sourceBoard.isMember(userId)) {
      return res.status(httpStatus.FORBIDDEN).json(
        ResponseFormatter.error('Access denied to source board', httpStatus.FORBIDDEN)
      );
    }
    
    // Check access to target board
    const targetBoard = await Board.findById(targetBoardId);
    if (!targetBoard || !targetBoard.hasPermission(userId, 'member')) {
      return res.status(httpStatus.FORBIDDEN).json(
        ResponseFormatter.error('Access denied to target board', httpStatus.FORBIDDEN)
      );
    }
    
    // Get position for new list
    const maxPosition = await List.findOne({ 
      boardId: targetBoardId, 
      isArchived: false 
    })
    .sort({ position: -1 })
    .select('position');
    
    const newPosition = maxPosition ? maxPosition.position + 1 : 0;
    
    // Create copy of list
    const copiedList = new List({
      name: name || `${originalList.name} Copy`,
      boardId: targetBoardId,
      position: newPosition
    });
    
    await copiedList.save();
    
    let copiedCardCount = 0;
    
    // Copy cards if requested
    if (includeCards) {
      const originalCards = await Card.find({ 
        listId: originalList._id, 
        isArchived: false 
      }).sort({ position: 1 });
      
      for (const originalCard of originalCards) {
        const copiedCard = new Card({
          title: originalCard.title,
          description: originalCard.description,
          listId: copiedList._id,
          boardId: targetBoardId,
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
        
        await copiedCard.save();
        copiedCardCount++;
      }
      
      copiedList.cardCount = copiedCardCount;
      await copiedList.save();
    }
    
    // Update target board statistics
    targetBoard.statistics.totalLists += 1;
    targetBoard.statistics.totalCards += copiedCardCount;
    await targetBoard.save();
    
    logger.info(`List copied: ${originalList.name} -> ${copiedList.name}`, {
      originalListId: listId,
      copiedListId: copiedList._id,
      sourceBoardId: originalList.boardId,
      targetBoardId,
      includeCards,
      copiedCardCount,
      copiedBy: userId
    });
    
    res.status(httpStatus.CREATED).json(
      ResponseFormatter.success(
        {
          ...copiedList.toJSON(),
          copiedCardCount
        },
        'List copied successfully',
        httpStatus.CREATED
      )
    );
  });
}

module.exports = ListController;