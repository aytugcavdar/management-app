const connection = require('./connection');
const logger = require('../logger');

class Consumer {
  constructor() {
    this.exchangeName = 'management_app_events';
    this.handlers = new Map();
  }

  async init() {
    await connection.ensureExchange(this.exchangeName, 'topic');
  }

  registerHandler(eventPattern, handlerFunction) {
    this.handlers.set(eventPattern, handlerFunction);
  }

  async startConsuming(serviceName, eventPatterns = ['#']) {
    try {
      const channel = await connection.connect();
      const queueName = `${serviceName}_queue`;
      
      await channel.assertQueue(queueName, { durable: true });
      
      // Bind queue to exchange with patterns
      for (const pattern of eventPatterns) {
        await channel.bindQueue(queueName, this.exchangeName, pattern);
      }
      
      // Set prefetch count
      await channel.prefetch(1);
      
      logger.info(`Started consuming events for ${serviceName}`, {
        queue: queueName,
        patterns: eventPatterns
      });
      
      channel.consume(queueName, async (msg) => {
        if (!msg) return;
        
        try {
          const message = JSON.parse(msg.content.toString());
          const routingKey = msg.fields.routingKey;
          
          logger.info(`Received event: ${message.eventType}`, {
            eventType: message.eventType,
            routingKey,
            messageId: message.id
          });
          
          // Find matching handler
          let handled = false;
          for (const [pattern, handler] of this.handlers) {
            if (this.matchPattern(routingKey, pattern)) {
              await handler(message);
              handled = true;
              break;
            }
          }
          
          if (!handled) {
            logger.warn(`No handler found for event: ${message.eventType}`, {
              routingKey
            });
          }
          
          channel.ack(msg);
        } catch (error) {
          logger.error('Error processing message:', error);
          // Reject and requeue
          channel.nack(msg, false, true);
        }
      });
      
    } catch (error) {
      logger.error('Failed to start consuming:', error);
      throw error;
    }
  }

  matchPattern(routingKey, pattern) {
    if (pattern === '#') return true;
    
    const routingParts = routingKey.split('.');
    const patternParts = pattern.split('.');
    
    for (let i = 0; i < Math.max(routingParts.length, patternParts.length); i++) {
      const routingPart = routingParts[i];
      const patternPart = patternParts[i];
      
      if (patternPart === '#') return true;
      if (patternPart === '*') continue;
      if (routingPart !== patternPart) return false;
    }
    
    return routingParts.length === patternParts.length;
  }
}

module.exports = new Consumer();