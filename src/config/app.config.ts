/**
 * Application Configuration
 * Centralized configuration for MediaSoup and server settings
 */

import * as dotenv from 'dotenv';
dotenv.config();

// TypeScript interfaces for mediasoup configuration

export interface LogTag {
	info: string;
	ice: string;
	dtls: string;
	rtp: string;
	srtp: string;
	rtcp: string;
}

export interface WorkerSettings {
	// rtcMinPort and max are just arbitrary ports for our traffic
	// useful for firewall or networking rules
	rtcMinPort: number;
	rtcMaxPort: number;
	// log levels you want to set
	logLevel: 'debug' | 'warn' | 'error' | 'none';
	logTags: string[];
}

export interface MediaCodecParameters {
	[key: string]: string | number;
}

export interface MediaCodec {
	kind: 'audio' | 'video';
	mimeType: string;
	clockRate: number;
	channels?: number;
	parameters?: MediaCodecParameters;
}

export interface ListenIp {
	ip: string;
	announcedIp: string | null;
}

export interface WebRtcTransport {
	listenIps: ListenIp[];
	// For a typical video stream with HD quality, you might set maxIncomingBitrate
	// around 5 Mbps (5000 kbps) to balance quality and bandwidth.
	// 4K Ultra HD: 15 Mbps to 25 Mbps
	maxIncomingBitrate: number; // 5 Mbps, default is INF
	initialAvailableOutgoingBitrate: number; // 5 Mbps, default is 600000
	minimumAvailableOutgoingBitrate?: number; // Minimum bandwidth for smoother transitions
	enableUdp?: boolean; // Enable UDP for lower latency
	enableTcp?: boolean; // Disable TCP for better performance
	preferUdp?: boolean; // Prefer UDP over TCP
}

export interface AppConfig {
	port: number;
	workerSettings: WorkerSettings;
	routerMediaCodecs: MediaCodec[];
	webRtcTransport: WebRtcTransport;
	roomSettings: {
		maxActiveSpeakers: number;
		maxRoomMembers: number;
	};
	api: {
		jobsServiceUrl?: string | undefined;
		baseUrl?: string | undefined;
	};
}

// Re-export as Config for backward compatibility
export type Config = AppConfig;

const appConfig: AppConfig = {
	port: 8090,
	workerSettings: {
		// rtcMinPort and max are just arbitrary ports for our traffic
		// useful for firewall or networking rules
		rtcMinPort: 40000,
		rtcMaxPort: 41000,
		// log levels you want to set
		logLevel: 'warn',
		logTags: ['info', 'ice', 'dtls', 'rtp', 'srtp', 'rtcp'],
	},
	routerMediaCodecs: [
		{
			kind: 'audio',
			mimeType: 'audio/opus',
			clockRate: 48000,
			channels: 2,
			parameters: {
				'useinbandfec': 1,
				'usedtx': 1,
				'stereo': 1,
				'maxplaybackrate': 48000,
			},
		},
		{
			kind: 'video',
			mimeType: 'video/H264',
			clockRate: 90000,
			parameters: {
				'packetization-mode': 1,
				'profile-level-id': '42e01f',
				'level-asymmetry-allowed': 1,
			},
		},
		{
			kind: 'video',
			mimeType: 'video/VP8',
			clockRate: 90000,
			parameters: {},
		},
	],
	webRtcTransport: {
		listenIps: [
			{
				ip: '127.0.0.1',
				announcedIp: process.env.PUBLIC_IP || null,
			},
		],
		// For a typical video stream with HD quality, you might set maxIncomingBitrate
		// around 100 Mbps (100000 kbps) to balance quality and bandwidth.
		// 4K Ultra HD: 15 Mbps to 25 Mbps
		maxIncomingBitrate: 100000000, // 100 Mbps, default is INF
		initialAvailableOutgoingBitrate: 1000000000, // 100 Mbps, reduced for smoother BWE ramp-up
		minimumAvailableOutgoingBitrate: 100000000, // 100 Mbps minimum bandwidth
		enableUdp: true, // Enable UDP for lower latency
		enableTcp: true, // Disable TCP for better performance
		preferUdp: true, // Prefer UDP over TCP
	},
	roomSettings: {
		maxActiveSpeakers: 10, // Maximum number of active speakers to show (increased from 5)
		maxRoomMembers: 10, // Maximum number of members allowed in a room
	},
	api: {
		jobsServiceUrl: process.env.JOBS_SERVICE_URL,
		baseUrl: process.env.JOBS_SERVICE_URL,
	},
};

export { appConfig };
export default appConfig;
