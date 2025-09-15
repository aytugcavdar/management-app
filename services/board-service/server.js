const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const { createServer } = require('http');
const { Server } = require('socket.io');
const Redis = require('ioredis');
require('dotenv').config();

// Shared utilities import
const { 
  middleware, 
  logger, 
  rabbitmq,
  constants: { httpStatus }
} = require('@management-app/shared-utils');

// Route imports
const workspaceRoutes = require('./routes/workspaceRoutes');
const boardRoutes = require('./routes/boardRoutes');
const listRoutes = require('./routes/listRoutes');
const cardRoutes = require('./routes/cardRoutes');
const activityRoutes = require('./routes/activityRoutes');

// Socket handlers
const socketHandler = require('./socket/socketHandler');

// Initialize Express app and HTTP server
const app = express();
const server = createServer(app);

// Initialize Socket.IO
const io = new Server(server, {
  cors: {
    origin: process.env.NODE_ENV === 'production' 
      ? ['https://yourdomain.com'] 
      : ['http://localhost:3000', 'http://localhost:3005'],
    credentials: true
  },
  transports: ['websocket', 'polling']
});

// Initialize Redis for Socket.IO adapter
let redisClient;
if (process.env.REDIS_URI) {
  redisClient = new Redis(process.env.REDIS_URI);
  
  redisClient.on('connect', () => {
    logger.info('Connected to Redis for Socket.IO');
  });
  
  redisClient.on('error', (err) => {
    logger.error('Redis connection error:', err);
  });
}

// Make io and redis available globally
app.set('io', io);
app.set('redis', redisClient);

// Security middleware
app.use(helmet());

// CORS configuration
app.use(cors({
  origin: process.env.NODE_ENV === 'production' 
    ? ['https://yourdomain.com'] 
    : ['http://localhost:3000', 'http://localhost:3005'],
  credentials: true
}));

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 200, // Higher limit for board operations
  message: {
    success: false,
    message: 'Too many requests from this IP, please try again later.'
  }
});
app.use(limiter);

// Body parsing middleware
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Request logging
app.use(middleware.requestLogger.logRequest);

// Health check endpoint
app.get('/health', (req, res) => {
  res.status(httpStatus.OK).json({
    success: true,
    message: 'Board Service is healthy',
    service: 'board-service',
    version: process.env.npm_package_version || '1.0.0',
    timestamp: new Date().toISOString(),
    connections: {
      mongodb: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected',
      redis: redisClient ? (redisClient.status === 'ready' ? 'connected' : 'disconnected') : 'not configured',
      socketio: io.engine.clientsCount || 0
    }
  });
});

// API routes
app.use('/api/workspaces', workspaceRoutes);
app.use('/api/boards', boardRoutes);
app.use('/api/lists', listRoutes);
app.use('/api/cards', cardRoutes);
app.use('/api/activities', activityRoutes);

// 404 handler
app.use(middleware.errorHandler.notFound);

// Global error handler
app.use(middleware.errorHandler.handle);

// Socket.IO connection handling
socketHandler(io, redisClient);

// Database connection
const connectDB = async () => {
  try {
    const mongoURI = process.env.MONGODB_URI || 'mongodb://localhost:27017/management_app';
    
    await mongoose.connect(mongoURI, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });
    
    logger.info('MongoDB connected successfully');
  } catch (error) {
    logger.error('MongoDB connection failed:', error);
    process.exit(1);
  }
};

// RabbitMQ initialization
const initRabbitMQ = async () => {
  try {
    await rabbitmq.publisher.init();
    await rabbitmq.consumer.init();
    
    // Register event handlers for user events
    rabbitmq.consumer.registerHandler('user.*', async (message) => {
      logger.info(`Received user event: ${message.eventType}`, message.data);
      
      // Handle user deletion - clean up their data
      if (message.eventType === 'user.deleted') {
        const { userId } = message.data;
        // TODO: Clean up user's workspace memberships, assigned cards, etc.
        logger.info(`Cleaning up data for deleted user: ${userId}`);
      }
    });
    
    // Register event handlers for notification events
    rabbitmq.consumer.registerHandler('notification.*', async (message) => {
      logger.info(`Received notification event: ${message.eventType}`, message.data);
    });
    
    // Start consuming events
    await rabbitmq.consumer.startConsuming('board-service', [
      'user.*', 
      'workspace.*', 
      'board.*', 
      'card.*'
    ]);
    
    logger.info('RabbitMQ initialized successfully');
  } catch (error) {
    logger.error('RabbitMQ initialization failed:', error);
    // Don't exit process, board service can work without RabbitMQ
  }
};

// Graceful shutdown
const gracefulShutdown = async () => {
  logger.info('Received shutdown signal, closing server...');
  
  try {
    // Close Socket.IO server
    io.close();
    logger.info('Socket.IO server closed');
    
    // Close MongoDB connection
    await mongoose.connection.close();
    logger.info('MongoDB connection closed');
    
    // Close Redis connection
    if (redisClient) {
      await redisClient.quit();
      logger.info('Redis connection closed');
    }
    
    // Close RabbitMQ connection
    await rabbitmq.connection.disconnect();
    logger.info('RabbitMQ connection closed');
    
    // Close HTTP server
    server.close(() => {
      logger.info('HTTP server closed');
      process.exit(0);
    });
    
  } catch (error) {
    logger.error('Error during graceful shutdown:', error);
    process.exit(1);
  }
};

// Handle shutdown signals
process.on('SIGTERM', gracefulShutdown);
process.on('SIGINT', gracefulShutdown);

// Start server
const startServer = async () => {
  try {
    await connectDB();
    await initRabbitMQ();
    
    const PORT = process.env.PORT || 3002;
    
    server.listen(PORT, () => {
      logger.info(`Board Service is running on port ${PORT}`);
      logger.info(`Environment: ${process.env.NODE_ENV || 'development'}`);
      logger.info(`Socket.IO enabled on port ${PORT}`);
    });
  } catch (error) {
    logger.error('Failed to start server:', error);
    process.exit(1);
  }
};

// Handle unhandled promise rejections
process.on('unhandledRejection', (err) => {
  logger.error('Unhandled Promise Rejection:', err);
  gracefulShutdown();
});

// Handle uncaught exceptions
process.on('uncaughtException', (err) => {
  logger.error('Uncaught Exception:', err);
  gracefulShutdown();
});

// Start the server
startServer();