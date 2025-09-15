const mongoose = require('mongoose');
const { constants: { priorities, cardStatuses } } = require('@management-app/shared-utils');

const cardSchema = new mongoose.Schema({
  title: {
    type: String,
    required: [true, 'Card title is required'],
    trim: true,
    minLength: [1, 'Card title cannot be empty'],
    maxLength: [200, 'Card title cannot exceed 200 characters']
  },
  
  description: {
    type: String,
    maxLength: [2000, 'Description cannot exceed 2000 characters'],
    default: ''
  },
  
  listId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'List',
    required: [true, 'Card must belong to a list']
  },
  
  boardId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Board',
    required: [true, 'Card must belong to a board']
  },
  
  position: {
    type: Number,
    required: true,
    default: 0
  },
  
  assignedTo: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  }],
  
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  
  priority: {
    type: String,
    enum: Object.values(priorities),
    default: priorities.MEDIUM
  },
  
  status: {
    type: String,
    enum: Object.values(cardStatuses),
    default: cardStatuses.TODO
  },
  
  labels: [{
    type: String,
    maxLength: 30
  }],
  
  dueDate: {
    type: Date,
    default: null
  },
  
  completedAt: {
    type: Date,
    default: null
  },
  
  checklist: [{
    text: {
      type: String,
      required: true,
      maxLength: 200
    },
    completed: {
      type: Boolean,
      default: false
    },
    completedAt: Date,
    completedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    createdAt: {
      type: Date,
      default: Date.now
    }
  }],
  
  attachments: [{
    filename: {
      type: String,
      required: true
    },
    originalName: {
      type: String,
      required: true
    },
    mimeType: {
      type: String,
      required: true
    },
    size: {
      type: Number,
      required: true
    },
    url: {
      type: String,
      required: true
    },
    uploadedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true
    },
    uploadedAt: {
      type: Date,
      default: Date.now
    }
  }],
  
  commentCount: {
    type: Number,
    default: 0
  },
  
  isArchived: {
    type: Boolean,
    default: false
  },
  
  archivedAt: Date
}, {
  timestamps: true
});

// Indexes
cardSchema.index({ listId: 1, position: 1 });
cardSchema.index({ boardId: 1, isArchived: 1 });
cardSchema.index({ assignedTo: 1 });
cardSchema.index({ dueDate: 1 });
cardSchema.index({ status: 1 });
cardSchema.index({ priority: 1 });
cardSchema.index({ createdBy: 1 });
cardSchema.index({ createdAt: -1 });
cardSchema.index({ title: 'text', description: 'text' }); // Full text search

// Virtual for overdue status
cardSchema.virtual('isOverdue').get(function() {
  return this.dueDate && this.dueDate < new Date() && this.status !== cardStatuses.DONE;
});

// Virtual for checklist completion percentage
cardSchema.virtual('checklistCompletion').get(function() {
  if (this.checklist.length === 0) return 0;
  const completed = this.checklist.filter(item => item.completed).length;
  return Math.round((completed / this.checklist.length) * 100);
});

// Methods
cardSchema.methods.isAssignedTo = function(userId) {
  return this.assignedTo.some(assignee => assignee.toString() === userId.toString());
};

cardSchema.methods.addAssignee = function(userId) {
  if (!this.isAssignedTo(userId)) {
    this.assignedTo.push(userId);
  }
};

cardSchema.methods.removeAssignee = function(userId) {
  this.assignedTo = this.assignedTo.filter(assignee => assignee.toString() !== userId.toString());
};

module.exports = mongoose.model('Card', cardSchema);