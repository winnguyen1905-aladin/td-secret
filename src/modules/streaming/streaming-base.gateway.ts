import { Logger } from '@nestjs/common';
import { WebSocketServer, SubscribeMessage, ConnectedSocket } from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { Client } from '@/models/client.model';
import { JwtUser } from '../messaging/types';
import {
  GatewayConfig,
  CallServerCapabilities,
  JwtValidationResult,
  AuthenticatedSocket,
} from './streaming.types';
import { randomUUID } from 'crypto';
import { clearCallAuthTimeout, extractRoomInfo } from 'utils';

/**
 * Call connection info extracted from handshake.
 * No JWT required - userId and displayName come from query/auth.
 */
export interface CallConnectionInfo {
  userId: string;
  displayName?: string;
}

/**
 * Base gateway for call/streaming functionality.
 * Provides authentication, connection handling, and MediaSoup cleanup utilities.
 * Extend this class for call-related WebSocket gateways.
 */
export abstract class CallBaseGateway {
  @WebSocketServer()
  public server: Server;

  protected readonly logger = new Logger(this.constructor.name);

  protected getConfig(): GatewayConfig {
    return {
      namespace: '',
      authTimeoutMs: 0, // No auth timeout for call gateway
      connectionType: 'call',
    };
  }

  // ============================================================
  // LIFECYCLE HOOKS
  // ============================================================

  afterInit(): void {
    this.logger.log(`Gateway initialized: /${this.getConfig().namespace}`);
  }

  /**
   * Handle new socket connection.
   * For call gateway, NO JWT is required.
   * userId and displayName are extracted from handshake query/auth.
   */
  @SubscribeMessage('connect')
  protected async handleConnection(socket: AuthenticatedSocket): Promise<void> {
    const mockClient = new Client(randomUUID(), socket, "Anonymous");
    socket.data.client = mockClient;
    this.logger.log(`Call client connected [${socket.id}]`);
  }

  @SubscribeMessage('disconnect')
  protected async handleDisconnect(
    @ConnectedSocket() socket: AuthenticatedSocket,
  ): Promise<void> {
    this.logger.log(`Call client disconnecting [${socket.id}]`);

    try {
      // Clear any pending auth timeout
      clearCallAuthTimeout(socket);

      const client = this.getClientFromSocket(socket);
      if (client) {
        const {roomId, clientCount} = extractRoomInfo(client);
        if (!roomId) return;

        // Broadcast participantLeft BEFORE cleanup
        if (roomId && this.server) {
          this.server.to(roomId).emit('participantLeft', {
            participantId: client.userId,
            timestamp: new Date() });
        }

        // Perform cleanup (MediaSoup, etc.)
        this.logger.log(`Cleaning up MediaSoup resources for ${client.userId}`);

        if (client.room) {
          socket.leave(client.room.roomId);
        }

        this.logger.log(`Participant left room ${roomId}. Remaining: ${clientCount - 1}`);
      }
    } catch (error) {
      this.logError('Error during call disconnect handling', error, socket);
    }
  }

  // ============================================================
  // SERVER CAPABILITIES
  // ============================================================

  protected getServerCapabilities(): CallServerCapabilities {
    return {
      video: true,
      audio: true,
      screenShare: true,
      maxParticipants: 50,
    };
  }

  // ============================================================
  // CLIENT HELPERS
  // ============================================================

  protected getClientFromSocket(socket: AuthenticatedSocket): Client | null {
    return (socket.data?.client as Client) || null;
  }

  protected extractClientFromSocket(socket: AuthenticatedSocket): Client {
    const client = this.getClientFromSocket(socket);
    if (!client) {
      throw new Error('Client not found in socket data - user may not be joined to a call room');
    }
    return client;
  }

  protected hasClient(socket: AuthenticatedSocket): boolean {
    return this.getClientFromSocket(socket) !== null;
  }

  protected isMediaReady(socket: Socket): boolean {
    return Boolean(socket.data?.mediaReady);
  }

  protected setMediaReady(socket: AuthenticatedSocket, ready: boolean): void {
    socket.data.mediaReady = ready;
  }

  protected requireAuthenticatedUser(socket: Socket): NonNullable<JwtValidationResult['user']> {
    const user = this.getAuthenticatedUser(socket);
    if (!user) {
      throw new Error('User not authenticated for call');
    }
    return user;
  }

  protected getAuthenticatedUser(socket: Socket): JwtUser | undefined {
    return (socket as AuthenticatedSocket).userInfo;
  }

  // ============================================================
  // ROOM HELPERS
  // ============================================================

  public emitToRoom(roomId: string, event: string, data: unknown): void {
    this.server?.to(roomId).emit(event, data);
  }

  public broadcastToRoom(roomId: string, event: string, data: unknown): void {
    this.server?.to(roomId).emit(event, data);
  }

  public async joinRoom(socket: Socket, roomId: string): Promise<void> {
    await socket.join(roomId);
  }

  public async leaveRoom(socket: Socket, roomId: string): Promise<void> {
    await socket.leave(roomId);
  }

  // ============================================================
  // CONNECTION INFO HELPERS (No JWT required for call)
  // ============================================================

  /**
   * Extract connection info from handshake.
   * Looks for userId and displayName in query params or auth object.
   */
  public extractConnectionInfo(socket: Socket): CallConnectionInfo {
    // Try query params first
    let userId = socket.handshake.query['userId'];
    if (Array.isArray(userId)) userId = userId[0];

    let displayName = socket.handshake.query['displayName'];
    if (Array.isArray(displayName)) displayName = displayName[0];

    // Fallback to auth object
    if (!userId && socket.handshake.auth?.userId) {
      userId = String(socket.handshake.auth.userId);
    }
    if (!displayName && socket.handshake.auth?.displayName) {
      displayName = String(socket.handshake.auth.displayName);
    }

    // Fallback to odil (legacy support)
    if (!userId && socket.handshake.query['odil']) {
      userId = String(socket.handshake.query['odil']);
    }
    if (!userId && socket.handshake.auth?.odil) {
      userId = String(socket.handshake.auth.odil);
    }

    return {
      userId: userId || '',
      displayName: displayName || undefined,
    };
  }



  // ============================================================
  // LOGGING
  // ============================================================

  protected logError(message: string, error: unknown, socket?: Socket): void {
    const socketInfo = socket ? ` [${socket.id}]` : '';
    const errorMsg = error instanceof Error ? error.message : String(error);
    this.logger.error(`${message}${socketInfo}: ${errorMsg}`);
  }
}

// Re-export types for backward compatibility
export { CallServerCapabilities, JwtValidationResult, AuthenticatedSocket } from './streaming.types';
