import { Logger } from '@nestjs/common';
import {
  OnGatewayConnection,
  OnGatewayDisconnect,
  OnGatewayInit,
  WebSocketServer,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import * as jwt from 'jsonwebtoken';
import { AuthenticatedSocket } from '../streaming/interfaces/streaming-events.interface';
import { JwtUser } from './types';
import { UserSessionCacheService } from '../distributed-cache/session.service';
import { getUserJobs } from '../../../libs/apiClient';
import { filterValidRoomIds } from '../../../utils/messaging.utils';
import appConfig from '@/config/app.config';

const AUTH_TIMEOUT_MS = 30000;
const NAMESPACE = 'chat';

/**
 * Base gateway with authentication and core socket utilities.
 * Extend this class for WebSocket gateways.
 */
export abstract class BaseGateway
  implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect
{
  @WebSocketServer()
  public server: Server;

  protected readonly logger = new Logger(this.constructor.name);

  protected abstract get userSessionCache(): UserSessionCacheService;

  // ============================================================
  // LIFECYCLE
  // ============================================================

  afterInit(): void {
    this.logger.log(`Gateway initialized: /${NAMESPACE}`);
  }

  async handleConnection(socket: Socket): Promise<void> {
    socket.data = { authenticated: false, connectionTime: new Date() };

    const timeout = setTimeout(() => {
      if (!socket.data?.authenticated) {
        socket.emit('error:auth', { error: 'Auth timeout', code: 'AUTH_TIMEOUT' });
        socket.disconnect(true);
      }
    }, AUTH_TIMEOUT_MS);
    socket.data.authTimeout = timeout;

    const token = this.extractToken(socket);
    const result = await this.validateJwt(token);

    if (!result.valid || !result.user) {
      clearTimeout(timeout);
      socket.emit('error:auth', { error: result.error, code: 'AUTH_FAILED' });
      socket.disconnect(true);
      return;
    }

    clearTimeout(timeout);
    socket.data.user = result.user;
    socket.data.authenticated = true;
    (socket as AuthenticatedSocket).userInfo = result.user;

    // Cache user <-> socket mapping
    try {
      const socketIds = await this.userSessionCache.getSocketIdsByUser(result.user.sub);
      for (const socketId of socketIds) {
        await this.userSessionCache.unmapSocket(socketId);
        try {
          // Use adapter-aware API to disconnect sockets by id (works across Redis clusters)
          this.server?.in(socketId).disconnectSockets(true);
        } catch (disconnectError) {
          this.logger.warn(
            `Failed to disconnect stale socket ${socketId}: ${
              disconnectError instanceof Error ? disconnectError.message : String(disconnectError)
            }`,
          );
        }
      }
      await this.userSessionCache.mapUserToSocket(result.user.sub, socket.id);
    } catch (e) {
      socket.disconnect(true);
      this.logError('Failed to cache user-session mapping', e, socket);
      throw e;
    }

    // Fetch user jobs and join corresponding rooms
    try {
      const baseUrl = appConfig.api.jobsServiceUrl || appConfig.api.baseUrl;
      if (!baseUrl) {
        throw new Error('JOBS_SERVICE_URL or JOBS_SERVICE_URL is not configured');
      }

      const roomIds = await getUserJobs({baseUrl, userId: result.user.sub, token: token!})

      // Persist rooms in cache for the user
      await this.userSessionCache.addUserRooms(result.user.sub, roomIds);

      // Join all rooms
      await this.joinRooms(socket, roomIds);

      this.logger.log(`User ${result.user.sub} joined ${roomIds.length} rooms`);
    } catch (e) {
      socket.disconnect(true);
      const errorMessage = 'Failed to fetch/join user rooms: ' + (e as Error).message;
      this.logError(errorMessage, e, socket);
      throw new Error(errorMessage);
    }

    // await this.onAuthenticated(socket as AuthenticatedSocket, result.user);
    this.logger.log(`Connected: ${result.user.sub} [${socket.id}]`);
  }

  async handleDisconnect(socket: AuthenticatedSocket): Promise<void> {
    if (socket.data?.authTimeout) clearTimeout(socket.data.authTimeout);
    await this.userSessionCache.unmapSocket(socket.id);
    // if (user) this.onUserDisconnect(socket, user);
    this.logger.log(`Disconnected [${socket.id}]`);
  }

  // Override in subclass
  // protected async onAuthenticated(_socket: AuthenticatedSocket, _user: JwtUser): Promise<void> {}
  // protected onUserDisconnect(_socket: AuthenticatedSocket, _user: JwtUser): void {}

  protected logError(message: string, error: unknown, socket?: Socket): void {
    const socketInfo = socket ? ` [${socket.id}]` : '';
    const errorMsg = error instanceof Error ? error.message : String(error);
    this.logger.error(`${message}${socketInfo}: ${errorMsg}`);
  }

  // ============================================================
  // ROOM HELPERS
  // ============================================================

  protected emitToRoom(roomId: string, event: string, data: unknown): void {
    this.server?.to(roomId).emit(event, data);
  }

  protected broadcastToRoom(socket: Socket, roomId: string, event: string, data: unknown): void {
    socket.to(roomId).emit(event, data);
  }

  protected async joinRoom(socket: Socket, roomId: string): Promise<void> {
    await socket.join(roomId);
  }

  protected async joinRooms(socket: Socket, roomIds: string[]): Promise<void> {
    await socket.join(roomIds);
  }

  protected async leaveRoom(socket: Socket, roomId: string): Promise<void> {
    await socket.leave(roomId);
  }

  // ============================================================
  // AUTH HELPERS
  // ============================================================

  private extractToken(socket: Socket): string | undefined {
    const q = socket.handshake.query['token'];
    if (typeof q === 'string' && q) return q;

    const h = socket.handshake.headers.authorization;
    if (h?.startsWith('Bearer ')) return h.slice(7);

    const a = socket.handshake.auth?.token;
    if (typeof a === 'string' && a) return a;

    return undefined;
  }

  private async validateJwt(token?: string): Promise<{ valid: boolean; user?: JwtUser; error?: string }> {
    if (!token) return { valid: false, error: 'No token' };

    try {
      const secret = process.env.JWT_SECRET;
      if (!secret) throw new Error('JWT_SECRET not configured');

      const decoded = jwt.verify(token, secret) as jwt.JwtPayload;
      return { valid: true, user: { sub: decoded.sub as string, walletType: decoded.walletType } };
    } catch {
      return { valid: false, error: 'Invalid token' };
    }
  }
}

