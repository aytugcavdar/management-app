const Activity = require('../models/Activity');
const { logger } = require('@management-app/shared-utils');

class ActivityLogger {
  static async log(activityData) {
    try {
      const {
        type,
        userId,
        userName,
        userAvatar,
        entityType,
        entityId,
        entityName,
        workspaceId,
        boardId,
        listId,
        cardId,
        data = {},
        previousData = {}
      } = activityData;
      
      const description = Activity.generateDescription(type, userName, entityName, data);
      
      const activity = await Activity.createActivity({
        type,
        userId,
        userName,
        userAvatar,
        entityType,
        entityId,
        entityName,
        workspaceId,
        boardId,
        listId,
        cardId,
        data,
        previousData,
        description
      });
      
      logger.info(`Activity logged: ${type}`, {
        activityId: activity._id,
        userId,
        entityType,
        entityId
      });
      
      return activity;
    } catch (error) {
      logger.error('Failed to log activity:', error);
      // Don't throw error to prevent disrupting the main operation
      return null;
    }
  }
  
  static async logCardActivity(type, card, user, additionalData = {}) {
    return this.log({
      type,
      userId: user.id,
      userName: user.name,
      userAvatar: user.avatar,
      entityType: 'card',
      entityId: card._id,
      entityName: card.title,
      workspaceId: additionalData.workspaceId,
      boardId: card.boardId,
      listId: card.listId,
      cardId: card._id,
      data: additionalData,
      previousData: additionalData.previousData || {}
    });
  }
  
  static async logBoardActivity(type, board, user, additionalData = {}) {
    return this.log({
      type,
      userId: user.id,
      userName: user.name,
      userAvatar: user.avatar,
      entityType: 'board',
      entityId: board._id,
      entityName: board.name,
      workspaceId: board.workspaceId,
      boardId: board._id,
      data: additionalData,
      previousData: additionalData.previousData || {}
    });
  }
  
  static async logWorkspaceActivity(type, workspace, user, additionalData = {}) {
    return this.log({
      type,
      userId: user.id,
      userName: user.name,
      userAvatar: user.avatar,
      entityType: 'workspace',
      entityId: workspace._id,
      entityName: workspace.name,
      workspaceId: workspace._id,
      data: additionalData,
      previousData: additionalData.previousData || {}
    });
  }
}

module.exports = ActivityLogger;