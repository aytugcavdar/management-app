const mongoose = require('mongoose');
const mongoosePaginate = require('mongoose-paginate-v2');

const activitySchema = new mongoose.Schema({
  type: {
    type: String,
    required: true,
    enum: [
      // Workspace activities
      'workspace_created', 'workspace_updated', 'workspace_deleted',
      'workspace_member_added', 'workspace_member_removed', 'workspace_member_role_changed',
      
      // Board activities  
      'board_created', 'board_updated', 'board_deleted', 'board_archived', 'board_unarchived',
      'board_member_added', 'board_member_removed', 'board_member_role_changed',
      
      // List activities
      'list_created', 'list_updated', 'list_deleted', 'list_archived', 'list_unarchived', 'list_moved',
      
      // Card activities
      'card_created', 'card_updated', 'card_deleted', 'card_archived', 'card_unarchived',
      'card_moved', 'card_assigned', 'card_unassigned', 'card_due_date_set', 'card_due_date_removed',
      'card_completed', 'card_reopened', 'card_label_added', 'card_label_removed',
      'card_attachment_added', 'card_attachment_removed', 'card_checklist_item_added',
      'card_checklist_item_completed', 'card_checklist_item_uncompleted',
      
      // Comment activities
      'comment_created', 'comment_updated', 'comment_deleted'
    ]
  },
  
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  
  userName: {
    type: String,
    required: true
  },
  
  userAvatar: String,
  
  // Target entity information
  entityType: {
    type: String,
    required: true,
    enum: ['workspace', 'board', 'list', 'card', 'comment']
  },
  
  entityId: {
    type: mongoose.Schema.Types.ObjectId,
    required: true
  },
  
  entityName: {
    type: String,
    required: true
  },
  
  // Parent entities for context
  workspaceId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Workspace'
  },
  
  boardId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Board'
  },
  
  listId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'List'
  },
  
  cardId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Card'
  },
  
  // Activity specific data
  data: {
    type: mongoose.Schema.Types.Mixed,
    default: {}
  },
  
  // Previous values for update activities
  previousData: {
    type: mongoose.Schema.Types.Mixed,
    default: {}
  },
  
  // Description for display
  description: {
    type: String,
    required: true
  }
}, {
  timestamps: true
});

// Indexes
activitySchema.index({ workspaceId: 1, createdAt: -1 });
activitySchema.index({ boardId: 1, createdAt: -1 });
activitySchema.index({ cardId: 1, createdAt: -1 });
activitySchema.index({ userId: 1, createdAt: -1 });
activitySchema.index({ entityType: 1, entityId: 1 });
activitySchema.index({ type: 1 });
// TTL index - activities older than 90 days will be automatically deleted
activitySchema.index({ createdAt: 1 }, { expireAfterSeconds: 7776000 });

activitySchema.plugin(mongoosePaginate);

// Static methods
activitySchema.statics.createActivity = function(activityData) {
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
    previousData = {},
    description
  } = activityData;
  
  return this.create({
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
};

// Helper method to generate activity description
activitySchema.statics.generateDescription = function(type, userName, entityName, data = {}) {
  const descriptions = {
    // Workspace activities
    workspace_created: `${userName} created workspace "${entityName}"`,
    workspace_updated: `${userName} updated workspace "${entityName}"`,
    workspace_member_added: `${userName} added ${data.memberName} to workspace "${entityName}"`,
    workspace_member_removed: `${userName} removed ${data.memberName} from workspace "${entityName}"`,
    
    // Board activities
    board_created: `${userName} created board "${entityName}"`,
    board_updated: `${userName} updated board "${entityName}"`,
    board_archived: `${userName} archived board "${entityName}"`,
    board_member_added: `${userName} added ${data.memberName} to board "${entityName}"`,
    
    // List activities
    list_created: `${userName} created list "${entityName}"`,
    list_updated: `${userName} updated list "${entityName}"`,
    list_moved: `${userName} moved list "${entityName}"`,
    
    // Card activities
    card_created: `${userName} created card "${entityName}"`,
    card_updated: `${userName} updated card "${entityName}"`,
    card_moved: `${userName} moved card "${entityName}" ${data.fromList ? `from "${data.fromList}" to "${data.toList}"` : ''}`,
    card_assigned: `${userName} assigned ${data.assigneeName} to card "${entityName}"`,
    card_unassigned: `${userName} unassigned ${data.assigneeName} from card "${entityName}"`,
    card_due_date_set: `${userName} set due date for card "${entityName}" to ${data.dueDate}`,
    card_completed: `${userName} completed card "${entityName}"`,
    card_reopened: `${userName} reopened card "${entityName}"`,
    
    // Comment activities
    comment_created: `${userName} commented on card "${entityName}"`,
    comment_updated: `${userName} updated a comment on card "${entityName}"`,
    comment_deleted: `${userName} deleted a comment on card "${entityName}"`
  };
  
  return descriptions[type] || `${userName} performed ${type} on ${entityName}`;
};

module.exports = mongoose.model('Activity', activitySchema);