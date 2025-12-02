import { Socket } from "socket.io";
import * as mediasoup from "mediasoup";
import { StreamKind, UserInfo } from "../../multimedia/media.dto";
import { Client } from "@/models/client.model";

export enum TransportRole {
  PRODUCER = 'producer',
  CONSUMER = 'consumer'
}

export interface JoinRoomData {
  userName: string;
  roomId: string;
  password?: string;
}

export interface JoinRoomResponse {
  routerRtpCapabilities?: any;
  newRoom?: boolean;
  audioPidsToCreate?: string[];
  videoPidsToCreate?: (string | null)[];
  associatedUsers?: UserInfo[];
  pendingApproval?: boolean; // true if waiting for owner approval
  requestId?: string; // unique request ID for tracking
  error?: string;
}

// ============ Join Request Flow ============
export interface JoinRoomRequestData {
  userId: string;
  roomId: string;
  password?: string;
  displayName?: string;
}

// PendingJoinRequest is defined in room.domain.ts

export interface AcceptJoinRoomData {
  requestId: string;
  userId: string; // user to accept
}

export interface AcceptJoinRoomResponse {
  success?: boolean;
  error?: string;
}

// ============ Kick/Block Flow ============
export interface KickOutRoomData {
  userId: string; // user to kick
}

export interface KickOutRoomResponse {
  success?: boolean;
  error?: string;
}

export interface BlockUserData {
  userId: string; // user to block
  durationMs?: number; // optional ban duration in ms, default permanent (very long)
}

export interface BlockUserResponse {
  success?: boolean;
  error?: string;
}

export interface ConnectTransportData {
  dtlsParameters: mediasoup.types.DtlsParameters;
  type: TransportRole;
  audioPid?: string;
}

export interface StartProducingData {
  kind: StreamKind;
  rtpParameters: mediasoup.types.RtpParameters;
}

export interface ConsumeMediaData {
  rtpCapabilities: mediasoup.types.RtpCapabilities;
  pid: string;
  kind: StreamKind;
}

export interface UnpauseConsumerData {
  pid: string;
  kind: StreamKind;
}

export interface SocketEventHandler {
  client: Client;
  socket: Socket;
}

export interface AuthenticatedSocket extends Socket {
  userInfo: {
    sub: string;
    email?: string;
    name?: string;
    profilePicture?: string;
    lastActive?: Date;
  };
}

// ws-types.ts
export interface AckOk<T = unknown> { ok: true; data: T }
export interface AckErr { ok: false; error: string }
export type AckResponse<T = unknown> = AckOk<T> | AckErr;

// The callback type you'd like to use in handlers
export type SocketEventCallback<T = unknown> = (res: AckResponse<T> | any) => void;

// Optional helpers
export const ok = <T>(data: T): AckOk<T> => ({ ok: true, data });
export const err = (message: string): AckErr => ({ ok: false, error: message });
