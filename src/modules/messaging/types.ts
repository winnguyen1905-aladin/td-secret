import { Socket } from 'socket.io';

// ============================================================
// JWT & Authentication Types
// ============================================================

export interface JwtUser {
  sub: string;
  walletType?: string;
  email?: string;
  name?: string;
}

export interface JwtValidationResult {
  valid: boolean;
  user?: JwtUser;
  error?: string;
  details?: unknown;
}

// ============================================================
// Gateway Configuration
// ============================================================

export interface GatewayConfig {
  namespace: string;
  authTimeoutMs: number;
  connectionType: string;
}

// ============================================================
// Socket Types
// ============================================================

export interface AuthenticatedSocket extends Socket {
  userInfo: JwtUser;
  data: {
    authenticated: boolean;
    user?: JwtUser;
    connectionTime?: Date;
    connectionType?: string;
    authTimeout?: NodeJS.Timeout;
    client?: unknown;
  };
}

// ============================================================
// Response Types
// ============================================================

export interface AckOk<T = unknown> {
  ok: true;
  data: T;
}

export interface AckErr {
  ok: false;
  error: string;
}

export type AckResponse<T = unknown> = AckOk<T> | AckErr;

export type SocketEventCallback<T = unknown> = (res: AckResponse<T> | Record<string, unknown>) => void;

// ============================================================
// Helpers
// ============================================================

export const ok = <T>(data: T): AckOk<T> => ({ ok: true, data });
export const err = (message: string): AckErr => ({ ok: false, error: message });
