const mongoose = require('mongoose');
const { constants: { userRoles } } = require('@management-app/shared-utils');

const userSchema = new mongoose.Schema({
  name: {
    type: String,
    required: [true, 'Name is required'],
    trim: true,
    minLength: [2, 'Name must be at least 2 characters long'],
    maxLength: [50, 'Name cannot exceed 50 characters']
  },
  
  email: {
    type: String,
    required: [true, 'Email is required'],
    unique: true,
    lowercase: true,
    trim: true,
    match: [/^\w+([.-]?\w+)*@\w+([.-]?\w+)*(\.\w{2,3})+$/, 'Please provide a valid email']
  },
  
  password: {
    type: String,
    required: [true, 'Password is required'],
    minLength: [8, 'Password must be at least 8 characters long'],
    select: false // Don't include password in queries by default
  },
  
  avatar: {
    type: String,
    default: function() {
      // Generate avatar URL using UI Avatars service
      const name = this.name.replace(/\s+/g, '+');
      return `https://ui-avatars.com/api/?name=${name}&background=6366f1&color=fff&size=128`;
    }
  },
  
  role: {
    type: String,
    enum: Object.values(userRoles),
    default: userRoles.DEVELOPER
  },
  
  // User preferences for UI customization
  preferences: {
    theme: {
      type: String,
      enum: ['light', 'dark', 'system'],
      default: 'system'
    },
    language: {
      type: String,
      enum: ['en', 'tr'],
      default: 'tr'
    },
    notifications: {
      email: {
        type: Boolean,
        default: true
      },
      push: {
        type: Boolean,
        default: true
      },
      mentions: {
        type: Boolean,
        default: true
      },
      assignments: {
        type: Boolean,
        default: true
      },
      deadlines: {
        type: Boolean,
        default: true
      }
    }
  },
  
  // Workspaces this user belongs to
  workspaces: [{
    workspaceId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Workspace'
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
  
  // Account status and verification
  isActive: {
    type: Boolean,
    default: true
  },
  
  isEmailVerified: {
    type: Boolean,
    default: false
  },
  
  emailVerificationToken: String,
  
  emailVerificationExpires: Date,
  
  // Password reset functionality
  passwordResetToken: String,
  
  passwordResetExpires: Date,
  
  // Login tracking
  lastLogin: Date,
  
  loginAttempts: {
    type: Number,
    default: 0
  },
  
  lockUntil: Date,
  
  // Timestamps
  createdAt: {
    type: Date,
    default: Date.now
  },
  
  updatedAt: {
    type: Date,
    default: Date.now
  }
}, {
  timestamps: true,
  toJSON: {
    transform: function(doc, ret) {
      delete ret.password;
      delete ret.passwordResetToken;
      delete ret.passwordResetExpires;
      delete ret.emailVerificationToken;
      delete ret.emailVerificationExpires;
      delete ret.loginAttempts;
      delete ret.lockUntil;
      return ret;
    }
  }
});

// Indexes for better query performance
userSchema.index({ email: 1 }, { unique: true });
userSchema.index({ role: 1 });
userSchema.index({ isActive: 1 });
userSchema.index({ 'workspaces.workspaceId': 1 });
userSchema.index({ createdAt: -1 });

// Virtual for checking if account is locked
userSchema.virtual('isLocked').get(function() {
  return !!(this.lockUntil && this.lockUntil > Date.now());
});

// Pre-save middleware to update updatedAt
userSchema.pre('save', function(next) {
  this.updatedAt = new Date();
  next();
});

// Methods
userSchema.methods.toJSON = function() {
  const user = this.toObject();
  delete user.password;
  delete user.passwordResetToken;
  delete user.passwordResetExpires;
  delete user.emailVerificationToken;
  delete user.emailVerificationExpires;
  delete user.loginAttempts;
  delete user.lockUntil;
  return user;
};

// Check if user has permission for a workspace
userSchema.methods.hasWorkspaceAccess = function(workspaceId, requiredRole = 'viewer') {
  const workspace = this.workspaces.find(w => 
    w.workspaceId.toString() === workspaceId.toString()
  );
  
  if (!workspace) return false;
  
  const roleHierarchy = {
    viewer: 1,
    member: 2,
    admin: 3
  };
  
  return roleHierarchy[workspace.role] >= roleHierarchy[requiredRole];
};

// Add user to workspace
userSchema.methods.addToWorkspace = function(workspaceId, role = 'member') {
  const existingWorkspace = this.workspaces.find(w => 
    w.workspaceId.toString() === workspaceId.toString()
  );
  
  if (!existingWorkspace) {
    this.workspaces.push({
      workspaceId,
      role,
      joinedAt: new Date()
    });
  }
  
  return this.save();
};

// Remove user from workspace
userSchema.methods.removeFromWorkspace = function(workspaceId) {
  this.workspaces = this.workspaces.filter(w => 
    w.workspaceId.toString() !== workspaceId.toString()
  );
  
  return this.save();
};

// Update login info
userSchema.methods.updateLoginInfo = function() {
  this.lastLogin = new Date();
  this.loginAttempts = 0;
  this.lockUntil = undefined;
  return this.save();
};

// Handle failed login attempt
userSchema.methods.handleFailedLogin = function() {
  this.loginAttempts += 1;
  
  // Lock account after 5 failed attempts for 1 hour
  if (this.loginAttempts >= 5) {
    this.lockUntil = Date.now() + (60 * 60 * 1000); // 1 hour
  }
  
  return this.save();
};

// Static methods
userSchema.statics.findByEmail = function(email) {
  return this.findOne({ email: email.toLowerCase() });
};

userSchema.statics.findActiveUsers = function() {
  return this.find({ isActive: true });
};

userSchema.statics.findByRole = function(role) {
  return this.find({ role, isActive: true });
};

module.exports = mongoose.model('User', userSchema);