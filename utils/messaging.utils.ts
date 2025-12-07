import { AuthenticatedSocket } from '@/common/interfaces';

/**
 * Chat connection utilities
 */

export interface ChatAuthResult {
  valid: boolean;
  user?: {
    sub: string;
    walletType?: string;
  };
  error?: string;
}

/**
 * Initialize chat session from authentication result
 * Sets user info on socket
 */
export function initializeChatSession(
  socket: AuthenticatedSocket,
  authResult: ChatAuthResult
): boolean {
  if (!authResult.valid || !authResult.user) {
    return false;
  }

  const user = authResult.user;
  
  // Set user info on socket
  socket.userInfo = {
    sub: user.sub,
    displayName: 'Anonymous User'
  };
  
  // Mark as authenticated
  socket.data.authenticated = true;
  socket.data.connectionTime = new Date();
  
  return true;
}

/**
 * Clear authentication timeout on socket
 */
export function clearChatAuthTimeout(socket: AuthenticatedSocket): void {
  if (socket.data?.authTimeout) {
    clearTimeout(socket.data.authTimeout);
    delete socket.data.authTimeout;
  }
}

/**
 * Emit authentication error and disconnect
 */
export function emitAuthErrorAndDisconnect(
  socket: AuthenticatedSocket,
  error: string,
  code: string = 'AUTH_FAILED'
): void {
  socket.emit('error.chat.auth', { error, code });
  socket.disconnect(true);
}

/**
 * Filter valid room IDs from array
 */
export function filterValidRoomIds(roomIds: (string | null | undefined)[]): string[] {
  return roomIds.filter((v): v is string => Boolean(v));
}
