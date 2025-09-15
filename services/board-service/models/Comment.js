const mongoose = require('mongoose');
const mongoosePaginate = require('mongoose-paginate-v2');

const commentSchema = new mongoose.Schema({
  content: {
    type: String,
    required: [true, 'Comment content is required'],
    trim: true,
    minLength: [1, 'Comment cannot be empty'],
    maxLength: [1000, 'Comment cannot exceed 1000 characters']
  },
  
  cardId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Card',
    required: [true, 'Comment must belong to a card']
  },
  
  author: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: [true, 'Comment must have an author']
  },
  
  mentions: [{
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    username: String,
    position: {
      start: Number,
      end: Number
    }
  }],
  
  isEdited: {
    type: Boolean,
    default: false
  },
  
  editedAt: Date,
  
  isDeleted: {
    type: Boolean,
    default: false
  },
  
  deletedAt: Date
}, {
  timestamps: true
});

// Indexes
commentSchema.index({ cardId: 1, createdAt: -1 });
commentSchema.index({ author: 1 });
commentSchema.index({ 'mentions.userId': 1 });
commentSchema.index({ isDeleted: 1 });

commentSchema.plugin(mongoosePaginate);

// Methods
commentSchema.methods.markAsEdited = function() {
  this.isEdited = true;
  this.editedAt = new Date();
  return this.save();
};

commentSchema.methods.softDelete = function() {
  this.isDeleted = true;
  this.deletedAt = new Date();
  return this.save();
};

module.exports = mongoose.model('Comment', commentSchema);