import appConfig from '@/config/app.config'
import { Client } from '@/models/client.model'
import { Room } from '@/models/room.model'
import { NewProducersToConsumeDto, UserInfo } from '@/modules/multimedia/media.dto'
import { Logger } from '@nestjs/common'
import { Server as SocketIOServer } from 'socket.io'

export class SocketHelpersUtil {

  private static Logger = new Logger(SocketHelpersUtil.name)
	/**
	 * Emit new producers to consume.
	 * NOTE: This should be called from within a queued context (e.g., handleStartProducing).
	 * Do NOT add queue wrapper here to avoid deadlock from nested queue calls.
	 */
	static async emitNewProducersInParallel(
		io: SocketIOServer,
		newTransportsByPeer: Record<string, string[]>,
		room: Room
	): Promise<void> {
		const emissionPromises = Object.entries(newTransportsByPeer).map(([socketId, audioPidsToCreate]) => {
			return new Promise<void>((resolve) => {
				setImmediate(() => {
					const videoPidsToCreate = audioPidsToCreate.map((aPid: string) => {
						const producerClient = room.clients.find((c: Client) => c?.producer?.audio?.id === aPid || c?.producer?.screenAudio?.id === aPid)
						if (producerClient?.producer?.screenAudio?.id === aPid) {
							return producerClient?.producer?.screenVideo?.id || null
						}
						return producerClient?.producer?.video?.id || null
					})

					const associatedUsers: UserInfo[] = audioPidsToCreate.map((aPid: string) => {
						const producerClient = room.clients.find((c: Client) => c?.producer?.audio?.id === aPid || c?.producer?.screenAudio?.id === aPid)
						const isScreenShare = producerClient?.producer?.screenAudio?.id === aPid
						const id = producerClient?.userId || 'unknown'
						const displayName = producerClient?.displayName || 'Unknown User'
						return {
							id: isScreenShare ? `${id}-screen` : id,
							displayName: isScreenShare ? `${displayName} (Sharing)` : displayName
						}
					})

          const newProducersToConsume: NewProducersToConsumeDto = {
						routerRtpCapabilities: room.router?.rtpCapabilities  || {},
						audioPidsToCreate,
						videoPidsToCreate,
						associatedUsers,
						activeSpeakerList: room.activeSpeakerList.slice(0, appConfig.roomSettings.maxActiveSpeakers)
					}
					io.to(socketId).emit('newProducersToConsume', newProducersToConsume);
					resolve();
				})
			})
		})

		await Promise.all(emissionPromises)
    this.Logger.log(`Notified ${emissionPromises.length} clients of new producer`)
	}

	static extractProducerInfo(room: Room, audioPids: string[]) {
		const videoPidsToCreate = audioPids.map((aid: string) => {
			const producingClient = room.clients.find((c: Client) => c?.producer?.audio?.id === aid || c?.producer?.screenAudio?.id === aid)
			if (producingClient?.producer?.screenAudio?.id === aid) {
				return producingClient?.producer?.screenVideo?.id || null
			}
			return producingClient?.producer?.video?.id || null
		})

		const associatedUsers: UserInfo[] = audioPids.map((aid: string) => {
			const producingClient = room.clients.find((c: Client) => c?.producer?.audio?.id === aid || c?.producer?.screenAudio?.id === aid)
			const isScreenShare = producingClient?.producer?.screenAudio?.id === aid
			const id = producingClient?.userId || 'unknown'
			const displayName = producingClient?.displayName || 'Unknown User'
			return {
				id: isScreenShare ? `${id}-screen` : id,
				displayName: isScreenShare ? `${displayName} (Sharing)` : displayName
			}
		})

		return { videoPidsToCreate, associatedUsers }
	}
}
