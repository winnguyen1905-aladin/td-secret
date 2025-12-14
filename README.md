# Socket Service

A NestJS-based socket service for real-time messaging and WebRTC streaming using Socket.io and Mediasoup.

## Tech Stack

- **NestJS** - Progressive Node.js framework
- **TypeScript** - Type-safe JavaScript
- **Socket.io** - Real-time bidirectional communication
- **Mediasoup** - WebRTC SFU for video/audio streaming
- **BullMQ** - Message queue with Redis
- **Redis** - Caching and pub/sub
- **JWT** - Authentication

## Project Structure

```
src/
├── common/                    # Shared utilities
│   ├── decorators/           # Custom decorators
│   ├── guards/               # Auth guards
│   └── interfaces/           # Shared interfaces
├── config/                    # Configuration files
├── modules/
│   ├── auth/                 # JWT authentication
│   │   └── strategies/       # Passport strategies
│   ├── messaging/            # Chat/messaging module
│   │   ├── dto/
│   │   └── interfaces/
│   ├── streaming/            # WebRTC/Mediasoup module
│   │   ├── dto/
│   │   └── interfaces/
│   ├── queue/                # BullMQ job queues
│   │   └── processors/       # Queue job processors
│   └── redis/                # Redis cache service
├── app.module.ts
└── main.ts
```

## Installation

```bash
npm install
```

## Configuration

Copy `.env.example` to `.env` and configure:

```bash
cp .env.example .env
```

### Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `NODE_ENV` | Environment | development |
| `PORT` | Server port | 3000 |
| `JWT_SECRET` | JWT signing secret | - |
| `JWT_EXPIRES_IN` | Token expiration | 7d |
| `REDIS_HOST` | Redis host | localhost |
| `REDIS_PORT` | Redis port | 6379 |
| `REDIS_PASSWORD` | Redis password | - |
| `MEDIASOUP_LISTEN_IP` | Mediasoup listen IP | 0.0.0.0 |
| `MEDIASOUP_ANNOUNCED_IP` | Public IP for WebRTC | 127.0.0.1 |
| `MEDIASOUP_MIN_PORT` | Min RTP port | 10000 |
| `MEDIASOUP_MAX_PORT` | Max RTP port | 10100 |

## Running the Application

```bash
# Development
npm run start:dev

# Production
npm run build
npm run start:prod
```

## Socket.io Namespaces

### `/messaging` - Chat & Messaging
- `join-conversation` - Join a chat room
- `leave-conversation` - Leave a chat room
- `send-message` - Send a message
- `typing` - Typing indicator
- `read-messages` - Mark messages as read

### `/streaming` - WebRTC Streaming
- `join-room` - Join a streaming room
- `leave-room` - Leave a streaming room
- `get-router-rtp-capabilities` - Get router capabilities
- `create-transport` - Create WebRTC transport
- `connect-transport` - Connect transport
- `produce` - Start producing media
- `consume` - Start consuming media

## Prerequisites

- Node.js >= 18
- Redis server
- For mediasoup: GCC/G++ or Visual Studio Build Tools

## License

MIT
