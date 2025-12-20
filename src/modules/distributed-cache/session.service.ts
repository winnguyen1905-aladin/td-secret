import { Redis } from "ioredis";
import { Injectable, Inject } from "@nestjs/common";

@Injectable()
export class UserSessionCacheService {

	private readonly USER_ROOMS_KEY_PREFIX = "user:rooms:";
	private readonly SOCKET_USER_KEY_PREFIX = "socket:user:";
	private readonly USER_SOCKETS_KEY_PREFIX = "user:sockets:";

	constructor(@Inject('REDIS_CLIENT') private readonly redis: Redis) {}

	private userSocketsKey(userId: string): string {
		return `${this.USER_SOCKETS_KEY_PREFIX}${userId}`;
	}

	private socketUserKey(socketId: string): string {
		return `${this.SOCKET_USER_KEY_PREFIX}${socketId}`;
	}

	private userRoomsKey(userId: string): string {
		return `${this.USER_ROOMS_KEY_PREFIX}${userId}`;
	}

	async mapUserToSocket(userId: string, socketId: string): Promise<void> {
		const existingSocketIds = await this.redis.smembers(this.userSocketsKey(userId));

		const pipeline = this.redis.multi();

		if (existingSocketIds?.length) {
			for (const existingSocketId of existingSocketIds) {
				if (existingSocketId !== socketId) {
					pipeline.srem(this.userSocketsKey(userId), existingSocketId);
					pipeline.del(this.socketUserKey(existingSocketId));
				}
			}
		}

		pipeline.sadd(this.userSocketsKey(userId), socketId);
		pipeline.set(this.socketUserKey(socketId), userId);

		await pipeline.exec();
	}

	async unmapSocket(socketId: string): Promise<void> {
		const userId = await this.redis.get(this.socketUserKey(socketId));
		if (!userId) return;
		await this.redis.multi()
			.srem(this.userSocketsKey(userId), socketId)
			.del(this.socketUserKey(socketId))
			.exec();
	}

	async getUserIdBySocket(socketId: string): Promise<string | null> {
		const userId = await this.redis.get(this.socketUserKey(socketId));
		return userId || null;
	}

	async getSocketIdsByUser(userId: string): Promise<string[]> {
		const members = await this.redis.smembers(this.userSocketsKey(userId));
		return members || [];
	}

	async addUserRooms(userId: string, roomIds: string[]): Promise<void> {
		if (!roomIds?.length) return;
		await this.redis.sadd(this.userRoomsKey(userId), ...roomIds);
	}

	async getUserRooms(userId: string): Promise<string[]> {
		const rooms = await this.redis.smembers(this.userRoomsKey(userId));
		return rooms || [];
	}
}