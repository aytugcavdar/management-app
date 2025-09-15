const mongoose = require('mongoose');

const listSchema = new mongoose.Schema({
  name: {
    type: String,
    required: [true, 'List name is required'],
    trim: true,
    minLength: [1, 'List name cannot be empty'],
    maxLength: [100, 'List name cannot exceed 100 characters']
  },
  
  boardId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Board',
    required: [true, 'List must belong to a board']
  },
  
  position: {
    type: Number,
    required: true,
    default: 0
  },
  
  cardCount: {
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
listSchema.index({ boardId: 1, position: 1 });
listSchema.index({ boardId: 1, isArchived: 1 });
listSchema.index({ createdAt: -1 });

module.exports = mongoose.model('List', listSchema);