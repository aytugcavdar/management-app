const amqp = require('amqplib');
const logger = require('../logger');

class RabbitMQConnection {
  constructor() {
    this.connection = null;
    this.channel = null;
    this.isConnected = false;
  }

  async connect() {
    try {
      if (this.isConnected) {
        return this.channel;
      }

      const RABBITMQ_URI = process.env.RABBITMQ_URI || 'amqp://localhost:5672';
      
      this.connection = await amqp.connect(RABBITMQ_URI);
      this.channel = await this.connection.createChannel();
      
      this.isConnected = true;
      
      // Connection error handlers
      this.connection.on('error', (err) => {
        logger.error('RabbitMQ connection error:', err);
        this.isConnected = false;
      });
      
      this.connection.on('close', () => {
        logger.warn('RabbitMQ connection closed');
        this.isConnected = false;
      });
      
      logger.info('Connected to RabbitMQ');
      return this.channel;
    } catch (error) {
      logger.error('Failed to connect to RabbitMQ:', error);
      throw error;
    }
  }

  async disconnect() {
    try {
      if (this.channel) {
        await this.channel.close();
      }
      if (this.connection) {
        await this.connection.close();
      }
      this.isConnected = false;
      logger.info('Disconnected from RabbitMQ');
    } catch (error) {
      logger.error('Error disconnecting from RabbitMQ:', error);
    }
  }

  async ensureQueue(queueName, options = {}) {
    const channel = await this.connect();
    await channel.assertQueue(queueName, {
      durable: true,
      ...options
    });
    return channel;
  }

  async ensureExchange(exchangeName, type = 'topic', options = {}) {
    const channel = await this.connect();
    await channel.assertExchange(exchangeName, type, {
      durable: true,
      ...options
    });
    return channel;
  }
}

// Singleton instance
const rabbitmqConnection = new RabbitMQConnection();

module.exports = rabbitmqConnection;