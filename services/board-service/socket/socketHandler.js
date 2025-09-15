const jwt = require('jsonwebtoken');
const { logger } = require('@management-app/shared-utils');

// Socket authentication middleware
const authenticateSocket = (socket, next) => {
  try {
    const token = socket.handshake.auth.token || socket.handshake.headers.authorization?.replace('Bearer ', '');
    
    if (!token) {
      return next(new Error('Authentication token required'));
    }
    
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    socket.user = decoded;
    
    logger.info(`User connected via socket: ${decoded.email}`, {
      userId: decoded.id,
      socketId: socket.id
    });
    
    next();
  } catch (error) {
    logger.error('Socket authentication failed:', error);
    next(new Error('Invalid authentication token'));
  }
};

// Room management functions
const joinBoardRoom = (socket, boardId) => {
  const roomName = `board:${boardId}`;
  socket.join(roomName);
  socket.currentBoard = boardId;
  
  logger.info(`User joined board room: ${boardId}`, {
    userId: socket.user.id,
    socketId: socket.id,
    room: roomName
  });
  
  // Notify other users in the board
  socket.to(roomName).emit('user_joined_board', {
    userId: socket.user.id,
    userName: socket.user.name,
    userAvatar: socket.user.avatar,
    boardId
  });
};

const leaveBoardRoom = (socket, boardId) => {
  const roomName = `board:${boardId}`;
  socket.leave(roomName);
  
  logger.info(`User left board room: ${boardId}`, {
    userId: socket.user.id,
    socketId: socket.id,
    room: roomName
  });
  
  // Notify other users in the board
  socket.to(roomName).emit('user_left_board', {
    userId: socket.user.id,
    userName: socket.user.name,
    boardId
  });
};

// Real-time event handlers
const handleCardUpdates = (io) => ({
  card_created: (data) => {
    io.to(`board:${data.boardId}`).emit('card_created', data);
    logger.info(`Card created event broadcast: ${data.cardId}`, { boardId: data.boardId });
  },
  
  card_updated: (data) => {
    io.to(`board:${data.boardId}`).emit('card_updated', data);
    logger.info(`Card updated event broadcast: ${data.cardId}`, { boardId: data.boardId });
  },
  
  card_moved: (data) => {
    io.to(`board:${data.boardId}`).emit('card_moved', data);
    logger.info(`Card moved event broadcast: ${data.cardId}`, { 
      boardId: data.boardId,
      fromList: data.fromListId,
      toList: data.toListId
    });
  },
  
  card_deleted: (data) => {
    io.to(`board:${data.boardId}`).emit('card_deleted', data);
    logger.info(`Card deleted event broadcast: ${data.cardId}`, { boardId: data.boardId });
  },
  
  card_assigned: (data) => {
    io.to(`board:${data.boardId}`).emit('card_assigned', data);
    // Also notify the assigned user directly if they're connected
    io.to(`user:${data.assignedUserId}`).emit('card_assigned_to_you', data);
    logger.info(`Card assignment event broadcast: ${data.cardId}`, { 
      boardId: data.boardId,
      assignedTo: data.assignedUserId
    });
  }
});

const handleListUpdates = (io) => ({
  list_created: (data) => {
    io.to(`board:${data.boardId}`).emit('list_created', data);
    logger.info(`List created event broadcast: ${data.listId}`, { boardId: data.boardId });
  },
  
  list_updated: (data) => {
    io.to(`board:${data.boardId}`).emit('list_updated', data);
    logger.info(`List updated event broadcast: ${data.listId}`, { boardId: data.boardId });
  },
  
  list_moved: (data) => {
    io.to(`board:${data.boardId}`).emit('list_moved', data);
    logger.info(`List moved event broadcast: ${data.listId}`, { boardId: data.boardId });
  },
  
  list_deleted: (data) => {
    io.to(`board:${data.boardId}`).emit('list_deleted', data);
    logger.info(`List deleted event broadcast: ${data.listId}`, { boardId: data.boardId });
  }
});

const handleBoardUpdates = (io) => ({
  board_updated: (data) => {
    io.to(`board:${data.boardId}`).emit('board_updated', data);
    logger.info(`Board updated event broadcast: ${data.boardId}`);
  },
  
  board_member_added: (data) => {
    io.to(`board:${data.boardId}`).emit('board_member_added', data);
    // Notify the new member
    io.to(`user:${data.newMemberId}`).emit('added_to_board', data);
    logger.info(`Board member added event broadcast: ${data.boardId}`, {
      newMember: data.newMemberId
    });
  },
  
  board_member_removed: (data) => {
    io.to(`board:${data.boardId}`).emit('board_member_removed', data);
    // Notify the removed member
    io.to(`user:${data.removedMemberId}`).emit('removed_from_board', data);
    logger.info(`Board member removed event broadcast: ${data.boardId}`, {
      removedMember: data.removedMemberId
    });
  }
});

const handleCommentUpdates = (io) => ({
  comment_created: (data) => {
    io.to(`board:${data.boardId}`).emit('comment_created', data);
    
    // Notify mentioned users
    if (data.mentions && data.mentions.length > 0) {
      data.mentions.forEach(mention => {
        io.to(`user:${mention.userId}`).emit('mentioned_in_comment', {
          ...data,
          mentionedBy: data.author
        });
      });
    }
    
    logger.info(`Comment created event broadcast: ${data.commentId}`, { 
      cardId: data.cardId,
      boardId: data.boardId
    });
  },
  
  comment_updated: (data) => {
    io.to(`board:${data.boardId}`).emit('comment_updated', data);
    logger.info(`Comment updated event broadcast: ${data.commentId}`, { boardId: data.boardId });
  },
  
  comment_deleted: (data) => {
    io.to(`board:${data.boardId}`).emit('comment_deleted', data);
    logger.info(`Comment deleted event broadcast: ${data.commentId}`, { boardId: data.boardId });
  }
});

// Typing indicators
const handleTypingIndicators = (socket, io) => {
  let typingTimer;
  
  return {
    start_typing: (data) => {
      socket.to(`board:${data.boardId}`).emit('user_typing', {
        userId: socket.user.id,
        userName: socket.user.name,
        cardId: data.cardId,
        boardId: data.boardId
      });
      
      // Clear existing timer
      if (typingTimer) {
        clearTimeout(typingTimer);
      }
      
      // Auto-stop typing after 3 seconds
      typingTimer = setTimeout(() => {
        socket.to(`board:${data.boardId}`).emit('user_stopped_typing', {
          userId: socket.user.id,
          cardId: data.cardId,
          boardId: data.boardId
        });
      }, 3000);
    },
    
    stop_typing: (data) => {
      socket.to(`board:${data.boardId}`).emit('user_stopped_typing', {
        userId: socket.user.id,
        cardId: data.cardId,
        boardId: data.boardId
      });
      
      if (typingTimer) {
        clearTimeout(typingTimer);
        typingTimer = null;
      }
    }
  };
};

// Cursor tracking for collaborative editing
const handleCursorTracking = (socket) => {
  return {
    cursor_move: (data) => {
      socket.to(`board:${data.boardId}`).emit('cursor_moved', {
        userId: socket.user.id,
        userName: socket.user.name,
        userAvatar: socket.user.avatar,
        cardId: data.cardId,
        position: data.position,
        boardId: data.boardId
      });
    },
    
    cursor_leave: (data) => {
      socket.to(`board:${data.boardId}`).emit('cursor_left', {
        userId: socket.user.id,
        cardId: data.cardId,
        boardId: data.boardId
      });
    }
  };
};

// Main socket handler
const socketHandler = (io, redisClient) => {
  // Apply authentication middleware
  io.use(authenticateSocket);
  
  // Initialize event handlers
  const cardHandlers = handleCardUpdates(io);
  const listHandlers = handleListUpdates(io);
  const boardHandlers = handleBoardUpdates(io);
  const commentHandlers = handleCommentUpdates(io);
  
  io.on('connection', (socket) => {
    // Join user to their personal room for direct notifications
    socket.join(`user:${socket.user.id}`);
    
    // Handle board room management
    socket.on('join_board', (data) => {
      const { boardId } = data;
      
      // Leave previous board if any
      if (socket.currentBoard && socket.currentBoard !== boardId) {
        leaveBoardRoom(socket, socket.currentBoard);
      }
      
      joinBoardRoom(socket, boardId);
    });
    
    socket.on('leave_board', (data) => {
      const { boardId } = data;
      leaveBoardRoom(socket, boardId);
      socket.currentBoard = null;
    });
    
    // Handle typing indicators
    const typingHandlers = handleTypingIndicators(socket, io);
    socket.on('start_typing', typingHandlers.start_typing);
    socket.on('stop_typing', typingHandlers.stop_typing);
    
    // Handle cursor tracking
    const cursorHandlers = handleCursorTracking(socket);
    socket.on('cursor_move', cursorHandlers.cursor_move);
    socket.on('cursor_leave', cursorHandlers.cursor_leave);
    
    // Handle real-time presence
    socket.on('update_presence', (data) => {
      socket.to(`board:${data.boardId}`).emit('user_presence_updated', {
        userId: socket.user.id,
        userName: socket.user.name,
        status: data.status, // 'active', 'away', 'idle'
        lastSeen: new Date(),
        boardId: data.boardId
      });
    });
    
    // Handle disconnection
    socket.on('disconnect', (reason) => {
      logger.info(`User disconnected: ${socket.user.email}`, {
        userId: socket.user.id,
        socketId: socket.id,
        reason
      });
      
      // Leave current board room
      if (socket.currentBoard) {
        leaveBoardRoom(socket, socket.currentBoard);
      }
      
      // Update user presence
      if (socket.currentBoard) {
        socket.to(`board:${socket.currentBoard}`).emit('user_presence_updated', {
          userId: socket.user.id,
          userName: socket.user.name,
          status: 'offline',
          lastSeen: new Date(),
          boardId: socket.currentBoard
        });
      }
    });
    
    // Error handling
    socket.on('error', (error) => {
      logger.error('Socket error:', error, {
        userId: socket.user.id,
        socketId: socket.id
      });
    });
  });
  
  // Expose event handlers for use in controllers
  io.cardHandlers = cardHandlers;
  io.listHandlers = listHandlers;
  io.boardHandlers = boardHandlers;
  io.commentHandlers = commentHandlers;
  
  logger.info('Socket.IO handlers initialized');
  
  return io;
};

module.exports = socketHandler;