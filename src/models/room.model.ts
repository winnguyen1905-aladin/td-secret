import { Server as SocketIOServer } from 'socket.io';
import * as mediasoup from 'mediasoup';
import { Client } from './client.model';
import appConfig from '@/config/app.config';

export interface BanInfo {
  userId: string;
  expiresAt: number;
}

export interface PendingJoinRequest {
  requestId: string;
  userId: string;
  displayName?: string;
  socketId: string;
  timestamp: number;
}

export interface RoomSecure {
  password: string;
  blackList: BanInfo[];
}

export interface CreateRoomParams {
  roomId: string
  ownerId: string
  worker: mediasoup.types.Worker
  password?: string
}

export class Room {
  public roomId: string;
  public ownerId: string;
  public worker: mediasoup.types.Worker;
  public router: mediasoup.types.Router | null = null;
  public clients: Client[] = [];
  public activeSpeakerList: string[] = [];
  public activeSpeakerObserver: mediasoup.types.ActiveSpeakerObserver | null = null;
  private refreshTimer: NodeJS.Timeout | null = null;
  private refreshCallback: (() => Promise<void>) | null = null;

  public roomSecure: RoomSecure;
  public pendingJoinRequests: Map<string, PendingJoinRequest> = new Map();

  constructor(roomId: string, ownerId: string, worker: mediasoup.types.Worker, password?: string) {
    this.worker = worker;
    this.roomId = roomId;
    this.ownerId = ownerId
    this.roomSecure = {
      password: password ? password : '',
      blackList: []
    }
  }

  addClient(client: Client): void {
    this.clients.push(client);
  }

  removeClient(clientId: string): void {
    this.clients = this.clients.filter(client => client.socket.id !== clientId);
  }

  // ============ Pending Join Request Methods ============
  addPendingRequest(request: PendingJoinRequest): void {
    this.pendingJoinRequests.set(request.requestId, request);
  }

  getPendingRequest(requestId: string): PendingJoinRequest | undefined {
    return this.pendingJoinRequests.get(requestId);
  }

  getPendingRequestByUserId(userId: string): PendingJoinRequest | undefined {
    for (const req of this.pendingJoinRequests.values()) {
      if (req.userId === userId) return req;
    }
    return undefined;
  }

  removePendingRequest(requestId: string): boolean {
    return this.pendingJoinRequests.delete(requestId);
  }

  clearExpiredPendingRequests(maxAgeMs: number = 60000): void {
    const now = Date.now();
    for (const [requestId, req] of this.pendingJoinRequests.entries()) {
      if (now - req.timestamp > maxAgeMs) {
        this.pendingJoinRequests.delete(requestId);
      }
    }
  }

  async createRouter(): Promise<void> {
    this.router = await this.worker.createRouter({
      mediaCodecs: appConfig.routerMediaCodecs
    });

    this.activeSpeakerObserver = await this.router.createActiveSpeakerObserver({
      interval: 100
    });
  }


  getClientBySocketId(socketId: string): Client | undefined {
    return this.clients.find(client => client.socket.id === socketId);
  }

  getClientByUserId(userId: string): Client | undefined {
    return this.clients.find(client => client.userId === userId);
  }

  getActiveSpeakers(limit?: number): string[] {
    // Import appConfig to get the max active speakers limit if no limit specified
    if (limit === undefined) {
      limit = appConfig.roomSettings.maxActiveSpeakers;
    }
    return this.activeSpeakerList.slice(0, limit);
  }

  /**
   * Start periodic refresh with injected service callback
   */
  startPeriodicRefreshWithService(callback: () => Promise<void>): void {
    this.stopPeriodicRefresh();
    this.refreshCallback = callback;
    this.refreshTimer = setInterval(async () => {
      if (this.refreshCallback) {
        await this.refreshCallback();
      }
    }, 25000);
  }

  /**
   * Stop the periodic refresh timer
   */
  public stopPeriodicRefresh(): void {
    if (this.refreshTimer) {
      clearInterval(this.refreshTimer);
      this.refreshTimer = null;
    }
  }

  /**
   * Clean up room resources when room is being destroyed
   */
  public cleanup(): void {
    this.stopPeriodicRefresh();

    // Close activeSpeakerObserver before router
    if (this.activeSpeakerObserver) {
      try {
        this.activeSpeakerObserver.close();
      } catch (err) {
        console.error(`[Room:${this.roomId}] Error closing ActiveSpeakerObserver:`, err);
      }
      this.activeSpeakerObserver = null;
    }

    // Close router (this also closes all transports, producers, consumers on this router)
    if (this.router) {
      try {
        this.router.close();
      } catch (err) {
        console.error(`[Room:${this.roomId}] Error closing router:`, err);
      }
      this.router = null;
    }

    // Clear remaining state
    this.clients = [];
    this.activeSpeakerList = [];
  }
}
