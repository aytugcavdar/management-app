// services/board-service/models/Workspace.js
const mongoose = require('mongoose');
const mongoosePaginate = require('mongoose-paginate-v2');

const workspaceSchema = new mongoose.Schema({
  name: {
    type: String,
    required: [true, 'Workspace name is required'],
    trim: true,
    minLength: [1, 'Workspace name cannot be empty'],
    maxLength: [100, 'Workspace name cannot exceed 100 characters']
  },
  
  description: {
    type: String,
    maxLength: [500, 'Description cannot exceed 500 characters'],
    default: ''
  },
  
  slug: {
    type: String,
    required: true,
    unique: true,
    lowercase: true
  },
  
  owner: {
    type: mongoose.Schema.Types.ObjectId,
    required: [true, 'Workspace owner is required'],
    ref: 'User'
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
    },
    invitedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    }
  }],
  
  settings: {
    isPrivate: {
      type: Boolean,
      default: false
    },
    allowInvitations: {
      type: Boolean,
      default: true
    },
    requireApproval: {
      type: Boolean,
      default: false
    }
  },
  
  statistics: {
    totalBoards: {
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
  }
}, {
  timestamps: true
});

// Indexes
workspaceSchema.index({ owner: 1 });
workspaceSchema.index({ slug: 1 }, { unique: true });
workspaceSchema.index({ 'members.userId': 1 });
workspaceSchema.index({ isActive: 1 });
workspaceSchema.index({ createdAt: -1 });

// Add pagination plugin
workspaceSchema.plugin(mongoosePaginate);

// Methods
workspaceSchema.methods.isMember = function(userId) {
  return this.members.some(member => member.userId.toString() === userId.toString());
};

workspaceSchema.methods.getMemberRole = function(userId) {
  const member = this.members.find(member => member.userId.toString() === userId.toString());
  return member ? member.role : null;
};

workspaceSchema.methods.hasPermission = function(userId, requiredRole) {
  if (this.owner.toString() === userId.toString()) return true;
  
  const member = this.members.find(member => member.userId.toString() === userId.toString());
  if (!member) return false;
  
  const roleHierarchy = { viewer: 1, member: 2, admin: 3 };
  return roleHierarchy[member.role] >= roleHierarchy[requiredRole];
};

module.exports = mongoose.model('Workspace', workspaceSchema);