const connection = require('./connection');
const logger = require('../logger');
const { eventTypes } = require('../constants');

class Publisher {
  constructor() {
    this.exchangeName = 'management_app_events';
  }

  async init() {
    await connection.ensureExchange(this.exchangeName, 'topic');
  }

  async publishEvent(eventType, data, routingKey = '') {
    try {
      const channel = await connection.connect();
      
      const message = {
        eventType,
        data,
        timestamp: new Date().toISOString(),
        id: require('crypto').randomUUID()
      };

      const routingPattern = routingKey || eventType.replace('.', '_');
      
      channel.publish(
        this.exchangeName,
        routingPattern,
        Buffer.from(JSON.stringify(message)),
        {
          persistent: true,
          messageId: message.id,
          timestamp: Date.now()
        }
      );

      logger.info(`Event published: ${eventType}`, {
        eventType,
        routingKey: routingPattern,
        messageId: message.id
      });

      return message.id;
    } catch (error) {
      logger.error('Failed to publish event:', error);
      throw error;
    }
  }

  // Convenience methods for common events
  async publishUserEvent(eventType, userData) {
    return this.publishEvent(eventType, userData, `user.${eventType.split('.')[1]}`);
  }

  async publishBoardEvent(eventType, boardData) {
    return this.publishEvent(eventType, boardData, `board.${eventType.split('.')[1]}`);
  }

  async publishCardEvent(eventType, cardData) {
    return this.publishEvent(eventType, cardData, `card.${eventType.split('.')[1]}`);
  }

  async publishNotificationEvent(notificationData) {
    return this.publishEvent(eventTypes.NOTIFICATION_SEND, notificationData, 'notification.send');
  }
}

module.exports = new Publisher();