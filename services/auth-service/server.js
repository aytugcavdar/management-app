const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
require('dotenv').config();

// Shared utilities import
const { 
  middleware, 
  logger, 
  rabbitmq,
  constants: { httpStatus }
} = require('@management-app/shared-utils');

// Route imports
const authRoutes = require('./routes/authRoutes.js');
const userRoutes = require('./routes/userRoutes');

// Initialize Express app
const app = express();

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
  max: 100, // limit each IP to 100 requests per windowMs
  message: {
    success: false,
    message: 'Too many requests from this IP, please try again later.'
  }
});
app.use(limiter);

// More strict rate limiting for auth endpoints
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 20, // limit each IP to 20 auth requests per windowMs
  message: {
    success: false,
    message: 'Too many authentication attempts, please try again later.'
  }
});

// Body parsing middleware
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Request logging
app.use(middleware.requestLogger.logRequest);

// Health check endpoint
app.get('/health', (req, res) => {
  res.status(httpStatus.OK).json({
    success: true,
    message: 'Auth Service is healthy',
    service: 'auth-service',
    version: process.env.npm_package_version || '1.0.0',
    timestamp: new Date().toISOString()
  });
});

// API routes
app.use('/api/auth', authLimiter, authRoutes);
app.use('/api/users', userRoutes);

// 404 handler
app.use(middleware.errorHandler.notFound);

// Global error handler
app.use(middleware.errorHandler.handle);

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
    
    // Register event handlers
    rabbitmq.consumer.registerHandler('user.*', async (message) => {
      logger.info(`Received user event: ${message.eventType}`, message.data);
      // Handle user events if needed
    });
    
    // Start consuming events
    await rabbitmq.consumer.startConsuming('auth-service', ['user.*', 'notification.*']);
    
    logger.info('RabbitMQ initialized successfully');
  } catch (error) {
    logger.error('RabbitMQ initialization failed:', error);
    // Don't exit process, auth service can work without RabbitMQ
  }
};

// Graceful shutdown
const gracefulShutdown = async () => {
  logger.info('Received shutdown signal, closing server...');
  
  try {
    await mongoose.connection.close();
    logger.info('MongoDB connection closed');
    
    await rabbitmq.connection.disconnect();
    logger.info('RabbitMQ connection closed');
    
    process.exit(0);
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
    
    const PORT = process.env.PORT || 3001;
    
    app.listen(PORT, () => {
      logger.info(`Auth Service is running on port ${PORT}`);
      logger.info(`Environment: ${process.env.NODE_ENV || 'development'}`);
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