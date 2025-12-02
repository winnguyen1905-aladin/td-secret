import { Injectable, Logger, Inject, forwardRef } from '@nestjs/common';
import { Client } from '@/models/client.model';
import { Room } from '@/models/room.model';
import * as mediasoup from 'mediasoup';
import * as fs from 'fs/promises';
import * as path from 'path';
import { spawn, ChildProcess } from 'child_process';
import { FSWatcher, watch } from 'chokidar';
import * as dgram from 'dgram';
import { StreamingGateway } from './streaming.gateway';

// Audio Capture Types and Interfaces
export interface RTPSession {
  participantId: string;
  displayName: string;
  roomId: string;
  producerId: string;
  plainTransport: mediasoup.types.PlainTransport;
  rtpPort: number;
  rtcpPort: number;
  ffmpegProcess?: ChildProcess;
  sdpFilePath?: string;
  segmentListPath?: string;
  segmentCounter: number;
  isActive: boolean;
  startTime: Date;
}

export interface AudioCaptureConfig {
  segmentDuration: number; // seconds
  audioDir: string;
  enableCleanup: boolean; // Whether to cleanup old audio files
}

@Injectable()
export class StreamingAudioCaptureService {
  private readonly logger = new Logger(StreamingAudioCaptureService.name);
  
  // Active RTP sessions for audio capture
  private rtpSessions = new Map<string, RTPSession>(); // participantId -> session
  
  // File watcher for completed audio segments (optional)
  private fileWatcher: FSWatcher | null = null;
  
  // Port pool management for RTP streams
  private availablePorts: Set<number> = new Set();
  private usedPorts: Set<number> = new Set();
  
  // Configuration
  private config: AudioCaptureConfig = {
    segmentDuration: 30, // 30 seconds per audio segment
    audioDir: './temp/audio-segments',
    enableCleanup: false // Keep audio files for later transcription via API
  };

  constructor(
    @Inject(forwardRef(() => StreamingGateway))
    private readonly streamingGateway: StreamingGateway
  ) {
    this.initializeBaseDirectories();
    this.initializeFileWatcher();
    this.initializePortPool();
  }

  /**
   * Start audio capture for a specific audio producer
   */
  async startAudioCapture(client: Client, producerId: string): Promise<void> {
    try {
      if (!client.room || !client.room.router) {
        throw new Error('Client not in a room or router not available');
      }

      const roomId = client.room.roomId;
      const participantId = client.userId;

      this.logger.log(`Starting audio capture for participant ${participantId} in room ${roomId}`);

      // Skip if already processing this participant
      if (this.rtpSessions.has(participantId)) {
        this.logger.warn(`Audio capture already active for participant ${participantId}`);
        return;
      }

      // Initialize room audio directory
      await this.initializeRoomAudioDirectory(roomId);

      // 1. Get a port pair for FFmpeg to listen on (RTP and RTCP)
      const { rtpPort, rtcpPort } = await this.getAvailablePortPair();
      this.logger.debug(`Allocated FFmpeg ports: RTP ${rtpPort}, RTCP ${rtcpPort}`);

      // 2. Create MediaSoup transport (let it pick its own random port)
      const plainTransport = await client.room.router.createPlainTransport({
        listenInfo: {
          protocol: 'udp',
          ip: '127.0.0.1'
        },
        rtcpMux: false,
        comedia: false
      });

      this.logger.log(`PlainTransport created for ${client.userId}`);

      // 3. Connect MediaSoup transport to FFmpeg's ports
      await plainTransport.connect({
        ip: '127.0.0.1',
        port: rtpPort,
        rtcpPort: rtcpPort
      });

      this.logger.debug(`PlainTransport connected to FFmpeg at 127.0.0.1:${rtpPort}/${rtcpPort}`);

      // Create consumer to get RTP stream
      const rtpCapabilities = client.room.router.rtpCapabilities;
      const consumer = await plainTransport.consume({
        producerId,
        rtpCapabilities,
        paused: false
      });

      // Create RTP session
      const rtpSession: RTPSession = {
        participantId,
        displayName: client.displayName,
        roomId,
        producerId,
        plainTransport,
        rtpPort,
        rtcpPort,
        segmentCounter: 0,
        isActive: true,
        startTime: new Date()
      };

      // Start FFmpeg process to capture and segment RTP
      await this.startFFmpegCapture(rtpSession);
      
      this.rtpSessions.set(participantId, rtpSession);

      this.logger.log(`Audio capture started successfully for ${participantId}`);

    } catch (error) {
      this.logger.error(`Error starting audio capture for ${client.userId}:`, error);
      throw error;
    }
  }

  /**
   * Stop audio capture for a participant
   */
  async stopAudioCapture(participantId: string): Promise<void> {
    const session = this.rtpSessions.get(participantId);
    if (!session) {
      this.logger.warn(`No active audio capture session for participant ${participantId}`);
      return;
    }

    try {
      this.logger.log(`Stopping audio capture for participant ${participantId}`);
      
      // Mark session as inactive
      session.isActive = false;

      // Stop FFmpeg process
      if (session.ffmpegProcess) {
        session.ffmpegProcess.kill('SIGTERM');
        session.ffmpegProcess = undefined;
      }

      // Close MediaSoup transport
      if (session.plainTransport) {
        session.plainTransport.close();
      }

      // Cleanup SDP file
      if (session.sdpFilePath) {
        try {
          await fs.unlink(session.sdpFilePath);
        } catch (error) {
          this.logger.debug(`Failed to delete SDP file: ${session.sdpFilePath}`);
        }
      }

      // Cleanup Segment List file
      if (session.segmentListPath) {
        try {
          await fs.unlink(session.segmentListPath);
        } catch (error) {
          this.logger.debug(`Failed to delete segment list file: ${session.segmentListPath}`);
        }
      }

      // Release the RTP port pair back to the pool
      this.releasePort(session.rtpPort);
      this.releasePort(session.rtcpPort);

      // Remove from active sessions
      this.rtpSessions.delete(participantId);

      this.logger.log(`Audio capture stopped and cleaned up for participant ${participantId}`);

    } catch (error) {
      this.logger.error(`Error stopping audio capture for ${participantId}:`, error);
    }
  }

  /**
   * Get room-specific audio directory
   */
  private getRoomAudioDir(roomId: string): string {
    return path.join(this.config.audioDir, roomId);
  }

  /**
   * Initialize audio directory for a specific room
   */
  private async initializeRoomAudioDirectory(roomId: string): Promise<void> {
    try {
      const roomAudioDir = this.getRoomAudioDir(roomId);
      await fs.mkdir(roomAudioDir, { recursive: true });
      this.logger.debug(`Room audio directory initialized: ${roomAudioDir}`);
    } catch (error) {
      this.logger.error(`Failed to create room audio directory for ${roomId}:`, error);
    }
  }

  /**
   * Initialize file watcher for completed audio segments (optional monitoring)
   */
  private initializeFileWatcher(): void {
    this.fileWatcher = watch(this.config.audioDir, {
      ignored: /(^|[\/\\])\../, // ignore dotfiles
      persistent: true,
    });

    this.fileWatcher
      .on('add', (filePath) => this.handleFileEvent(filePath))
      .on('change', (filePath) => this.handleFileEvent(filePath))
      .on('error', (error) => this.logger.error('File watcher error:', error));

    this.logger.log('File watcher initialized');
  }

  /**
   * Handle file events (for monitoring purposes only)
   */
  private async handleFileEvent(filePath: string): Promise<void> {
    try {
      if (filePath.endsWith('.wav') && filePath.includes('_segment_')) {
        this.logger.debug(`New audio segment created: ${path.basename(filePath)}`);
        
        // Optionally cleanup old files if enabled
        if (this.config.enableCleanup) {
          // Add cleanup logic here if needed
        }
      }
    } catch (error) {
      this.logger.error(`Error processing file event ${filePath}:`, error);
    }
  }

  /**
   * Start FFmpeg process to capture RTP and create segments
   */
  private async startFFmpegCapture(session: RTPSession): Promise<void> {
    const roomAudioDir = this.getRoomAudioDir(session.roomId);
    // Sanitize displayName for filename (remove special characters)
    const sanitizedDisplayName = session.displayName.replace(/[^a-zA-Z0-9_\-]/g, '_');
    const outputPattern = path.join(
      roomAudioDir,
      `${sanitizedDisplayName}_${session.participantId}_segment_%03d.wav`
    );

    // Create SDP file to describe the RTP stream (Opus, Payload Type 100)
    const sdpContent = `v=0
o=- 0 0 IN IP4 127.0.0.1
s=FFmpeg
c=IN IP4 127.0.0.1
t=0 0
m=audio ${session.rtpPort} RTP/AVP 100
a=rtpmap:100 opus/48000/2
`;

    const sdpFilePath = path.join(
      roomAudioDir,
      `${sanitizedDisplayName}_${session.participantId}.sdp`
    );
    session.sdpFilePath = sdpFilePath;

    await fs.writeFile(sdpFilePath, sdpContent);
    this.logger.debug(`Created SDP file for FFmpeg: ${sdpFilePath}`);

    // Create segment list file path
    const segmentListPath = path.join(
      roomAudioDir,
      `${sanitizedDisplayName}_${session.participantId}_segments.txt`
    );
    session.segmentListPath = segmentListPath;

    // FFmpeg command to receive RTP and segment into WAV files
    const ffmpegArgs = [
      '-protocol_whitelist', 'file,rtp,udp',
      '-i', sdpFilePath,
      '-acodec', 'pcm_s16le',    // 16-bit PCM
      '-ar', '16000',            // 16kHz sample rate (good for transcription)
      '-ac', '1',                // Mono
      '-f', 'segment',           // Segment format
      '-segment_time', this.config.segmentDuration.toString(),
      '-segment_format', 'wav',  // WAV format
      '-reset_timestamps', '1',  // Reset timestamps for each segment
      '-segment_list', segmentListPath, // Maintain a list of created segments
      '-segment_list_type', 'flat',     // Simple text format
      outputPattern
    ];

    this.logger.log(`Starting FFmpeg for ${session.participantId}: ${ffmpegArgs.join(' ')}`);

    const ffmpegProcess = spawn('ffmpeg', ffmpegArgs);
    
    ffmpegProcess.stdout.on('data', (data) => {
      this.logger.debug(`FFmpeg stdout (${session.participantId}): ${data}`);
    });
    
    ffmpegProcess.stderr.on('data', (data) => {
      this.logger.debug(`FFmpeg stderr (${session.participantId}): ${data}`);
    });
    
    ffmpegProcess.on('close', (code) => {
      this.logger.log(`FFmpeg process exited with code ${code} for ${session.participantId}`);
    });

    ffmpegProcess.on('error', (error) => {
      this.logger.error(`FFmpeg error for ${session.participantId}:`, error);
    });

    session.ffmpegProcess = ffmpegProcess;
  }

  /**
   * Initialize port pool for RTP streams
   */
  private initializePortPool(): void {
    // Use very high unreserved port range 60000-65000 (5000 ports)
    for (let port = 60000; port < 65000; port++) {
      this.availablePorts.add(port);
    }
    this.logger.log(`Port pool initialized: ${this.availablePorts.size} available ports (range 60000-64999)`);
  }

  /**
   * Check if a port is actually available on the system
   */
  private async isPortAvailable(port: number): Promise<boolean> {
    return new Promise((resolve) => {
      const socket = dgram.createSocket('udp4');
      
      socket.on('error', () => {
        socket.close();
        resolve(false);
      });

      socket.bind(port, '127.0.0.1', () => {
        socket.close();
        resolve(true);
      });
    });
  }

  /**
   * Get available port pair for RTP and RTCP (consecutive ports)
   */
  private async getAvailablePortPair(): Promise<{ rtpPort: number, rtcpPort: number }> {
    if (this.availablePorts.size < 2) {
      throw new Error('Not enough available ports in pool');
    }

    // Get all ports as array to find consecutive ones
    const sortedPorts = Array.from(this.availablePorts).sort((a, b) => a - b);

    for (let i = 0; i < sortedPorts.length - 1; i++) {
      const port1 = sortedPorts[i];
      const port2 = sortedPorts[i+1];

      // Check if they are consecutive (FFmpeg expects RTP on N and RTCP on N+1)
      if (port2 === port1 + 1) {
        // Check system availability
        const isPort1Available = await this.isPortAvailable(port1);
        const isPort2Available = await this.isPortAvailable(port2);
        
        if (isPort1Available && isPort2Available) {
          // Both available, allocate them
          this.availablePorts.delete(port1);
          this.availablePorts.delete(port2);
          this.usedPorts.add(port1);
          this.usedPorts.add(port2);
          
          this.logger.debug(`Allocated RTP/RTCP ports ${port1}/${port2} (${this.availablePorts.size} remaining)`);
          return { rtpPort: port1, rtcpPort: port2 };
        }
        
        // Remove unavailable ports
        if (!isPort1Available) {
          this.availablePorts.delete(port1);
          this.logger.debug(`Port ${port1} unavailable (system), removed from pool`);
        }
        if (!isPort2Available) {
          this.availablePorts.delete(port2);
          this.logger.debug(`Port ${port2} unavailable (system), removed from pool`);
        }
      }
    }

    throw new Error('No available port pairs found - all ports in pool are in use or fragmented');
  }

  /**
   * Release a port back to the pool
   */
  private releasePort(port: number): void {
    if (this.usedPorts.has(port)) {
      this.usedPorts.delete(port);
      this.availablePorts.add(port);
      this.logger.debug(`Released RTP port ${port} back to pool`);
    }
  }

  /**
   * Initialize base audio directory
   */
  private async initializeBaseDirectories(): Promise<void> {
    try {
      await fs.mkdir(this.config.audioDir, { recursive: true });
      this.logger.log(`Base audio directory initialized: ${this.config.audioDir}`);
    } catch (error) {
      this.logger.error('Failed to create base audio directory:', error);
    }
  }

  /**
   * Get active sessions info (for debugging)
   */
  getActiveSessions(): { participantId: string; roomId: string; startTime: Date }[] {
    return Array.from(this.rtpSessions.values()).map(session => ({
      participantId: session.participantId,
      roomId: session.roomId,
      startTime: session.startTime
    }));
  }

  /**
   * Cleanup when service is destroyed
   */
  async onModuleDestroy(): Promise<void> {
    this.logger.log('Cleaning up Audio Capture service...');

    // Stop all active sessions
    for (const [participantId] of this.rtpSessions) {
      await this.stopAudioCapture(participantId);
    }

    // Close file watcher
    if (this.fileWatcher) {
      await this.fileWatcher.close();
    }

    this.logger.log('Audio Capture service cleanup completed');
  }
}
