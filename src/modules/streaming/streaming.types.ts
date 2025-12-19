import { JwtUser } from '../messaging/types';
import { AuthenticatedSocket, SocketUser } from '@/common/interfaces';

export interface GatewayConfig {
  namespace: string;
  authTimeoutMs: number;
  connectionType: string;
}

export interface CallServerCapabilities {
  video: boolean;
  audio: boolean;
  screenShare: boolean;
  maxParticipants: number;
}

export interface JwtValidationResult {
  valid: boolean;
  user?: JwtUser;
  error?: string;
}

// Re-export for convenience
export { AuthenticatedSocket, SocketUser };