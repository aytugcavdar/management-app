# Management-App

Real-time project management tool built with microservices architecture.

## Features

- 🏗️ **Microservices Architecture** - Scalable and maintainable
- ⚡ **Real-time Updates** - WebSocket-based live collaboration  
- 🔐 **JWT Authentication** - Secure user management
- 📬 **Event-driven Communication** - RabbitMQ integration
- 🐳 **Docker Support** - Easy deployment and development
- 🎨 **Modern UI** - Responsive Kanban board interface

## Services

- **Auth Service** (Port: 3001) - User authentication and authorization
- **Board Service** (Port: 3002) - Board, lists, and cards management
- **Notification Service** (Port: 3003) - Email and push notifications
- **Realtime Service** (Port: 3004) - WebSocket connections
- **API Gateway** (Port: 3000) - Request routing and load balancing

## Quick Start

### Prerequisites
- Node.js 18+
- Docker & Docker Compose
- MongoDB
- RabbitMQ

### Development Setup

1. **Clone and install dependencies**
```bash
   git clone <repo-url>
   cd Management-App
   npm run install:all