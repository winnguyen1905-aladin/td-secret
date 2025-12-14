import { Socket } from 'socket.io';

export interface SocketUser {
  sub: string;
  displayName?: string;
  walletType?: string;
  email?: string;
  name?: string;
}

export interface AuthenticatedSocket extends Socket {
  userInfo: SocketUser;
  data: {
    authenticated: boolean;
    user?: SocketUser;
    connectionTime?: Date;
    connectionType?: string;
    authTimeout?: NodeJS.Timeout;
    client?: unknown;
    mediaReady?: boolean;
  };
}

