import { randomUUID } from 'crypto';
import { Client } from '@/models/client.model';
import { AuthenticatedSocket } from '@/common/interfaces';

/**
 * Call connection utilities
 */

export interface CallAuthResult {
  valid: boolean;
  user?: {
    sub: string;
    walletType?: string | undefined;
  };
  error?: string;
}

/**
 * Initialize call client from authentication result
 * Creates a new Client instance and attaches it to socket
 */
export function initializeCallClient(
  socket: AuthenticatedSocket,
  authResult: CallAuthResult
): Client {
  // Generate random user ID if auth failed or no user
  const user = authResult.valid && authResult.user
    ? authResult.user
    : { sub: randomUUID() };

  // Mark as authenticated
  socket.data.authenticated = true;

  // Set user info on socket
  socket.userInfo = {
    sub: user.sub,
    displayName: 'Anonymous User'
  };

  // Create and attach client
  const client = new Client(user.sub, socket);
  socket.data.client = client;

  return client;
}

/**
 * Clear authentication timeout on socket
 */
export function clearCallAuthTimeout(socket: AuthenticatedSocket): void {
  if (socket.data?.authTimeout) {
    clearTimeout(socket.data.authTimeout);
    delete socket.data.authTimeout;
  }
}

/**
 * Extract room info before cleanup (cleanup might clear references)
 */
export function extractRoomInfo(client: Client): { roomId: string | undefined; clientCount: number } {
  return {
    roomId: client.room?.roomId,
    clientCount: client.room?.clients.length ?? 0,
  };
}
