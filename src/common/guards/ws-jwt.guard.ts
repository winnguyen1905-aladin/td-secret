import { Injectable, CanActivate, ExecutionContext } from '@nestjs/common';
import { WsException } from '@nestjs/websockets';
import { Socket } from 'socket.io';

/**
 * WebSocket JWT Guard - validates that socket is authenticated.
 * Authentication is handled during connection in ChatBaseGateway.
 * This guard simply checks if the socket has been marked as authenticated.
 */
@Injectable()
export class WsJwtGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const client = context.switchToWs().getClient<Socket>();

    // Check if socket was authenticated during connection
    if (!client.data?.authenticated) {
      throw new WsException('Unauthorized: Socket not authenticated');
    }

    // Verify user info exists
    const userInfo = (client as any).userInfo || client.data?.user;
    if (!userInfo?.sub) {
      throw new WsException('Unauthorized: User info not found');
    }

    return true;
  }
}

