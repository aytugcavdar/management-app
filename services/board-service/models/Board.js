const mongoose = require('mongoose');
const mongoosePaginate = require('mongoose-paginate-v2');

const boardSchema = new mongoose.Schema({
  name: {
    type: String,
    required: [true, 'Board name is required'],
    trim: true,
    minLength: [1, 'Board name cannot be empty'],
    maxLength: [100, 'Board name cannot exceed 100 characters']
  },
  
  description: {
    type: String,
    maxLength: [500, 'Description cannot exceed 500 characters'],
    default: ''
  },
  
  slug: {
    type: String,
    required: true,
    lowercase: true
  },
  
  workspaceId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Workspace',
    required: [true, 'Board must belong to a workspace']
  },
  
  owner: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: [true, 'Board owner is required']
  },
  
  members: [{
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true
    },
    role: {
      type: String,
      enum: ['admin', 'member', 'viewer'],
      default: 'member'
    },
    joinedAt: {
      type: Date,
      default: Date.now
    }
  }],
  
  visibility: {
    type: String,
    enum: ['private', 'workspace', 'public'],
    default: 'workspace'
  },
  
  background: {
    color: {
      type: String,
      match: /^#[0-9A-F]{6}$/i,
      default: '#0079bf'
    },
    image: {
      type: String,
      default: null
    }
  },
  
  labels: [{
    name: {
      type: String,
      required: true,
      maxLength: 30
    },
    color: {
      type: String,
      match: /^#[0-9A-F]{6}$/i,
      required: true
    }
  }],
  
  statistics: {
    totalLists: {
      type: Number,
      default: 0
    },
    totalCards: {
      type: Number,
      default: 0
    },
    completedCards: {
      type: Number,
      default: 0
    }
  },
  
  isActive: {
    type: Boolean,
    default: true
  },
  
  isArchived: {
    type: Boolean,
    default: false
  },
  
  archivedAt: Date
}, {
  timestamps: true
});

// Compound index for workspace + slug uniqueness
boardSchema.index({ workspaceId: 1, slug: 1 }, { unique: true });
boardSchema.index({ workspaceId: 1, isActive: 1 });
boardSchema.index({ owner: 1 });
boardSchema.index({ 'members.userId': 1 });
boardSchema.index({ createdAt: -1 });

boardSchema.plugin(mongoosePaginate);

// Methods
boardSchema.methods.isMember = function(userId) {
  return this.members.some(member => member.userId.toString() === userId.toString()) ||
         this.owner.toString() === userId.toString();
};

boardSchema.methods.hasPermission = function(userId, requiredRole) {
  if (this.owner.toString() === userId.toString()) return true;
  
  const member = this.members.find(member => member.userId.toString() === userId.toString());
  if (!member) return false;
  
  const roleHierarchy = { viewer: 1, member: 2, admin: 3 };
  return roleHierarchy[member.role] >= roleHierarchy[requiredRole];
};

module.exports = mongoose.model('Board', boardSchema);