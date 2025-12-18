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

// STT Types and Interfaces
export interface TranscriptionSegment {
  participantId: string;
  roomId: string;
  text: string;
  confidence: number;
  language: 'vi' | 'en' | 'auto';
  timestamp: Date;
  segmentNumber: number;
  duration: number; // seconds
}

export interface RTPSession {
  participantId: string;
  roomId: string;
  producerId: string;
  plainTransport: mediasoup.types.PlainTransport;
  rtpPort: number;
  rtcpPort: number;
  ffmpegProcess?: ChildProcess;
  sdpFilePath?: string;
  segmentListPath?: string;
  segmentCounter: number;
  lastProcessedSegment: number;
  processingSegments: Set<number>;
  isActive: boolean;
  startTime: Date;
}

export interface STTConfig {
  segmentDuration: number; // seconds
  audioDir: string;
  transcriptDir: string; // Directory to save transcript files
  whisperBinaryPath: string;
  whisperModelPath: string;
  language: 'vi' | 'en' | 'auto';
  enableCleanup: boolean;
}

@Injectable()
export class StreamingSTTService {
  private readonly logger = new Logger(StreamingSTTService.name);
  
  // In-memory storage for transcriptions per room
  private transcriptions = new Map<string, TranscriptionSegment[]>(); // roomId -> segments[]
  
  // Active RTP sessions for audio capture
  private rtpSessions = new Map<string, RTPSession>(); // participantId -> session
  
  // File watcher for completed audio segments
  private fileWatcher: FSWatcher | null = null;
  
  // Port pool management for RTP streams
  private availablePorts: Set<number> = new Set();
  private usedPorts: Set<number> = new Set();
  
  // Configuration
  private config: STTConfig = {
    segmentDuration: 6, // 6 seconds for faster testing (was 60)
    audioDir: './temp/audio-segments',
    transcriptDir: './temp/transcripts',
    whisperBinaryPath: '/home/loi/whisper.cpp/whisper.cpp/build/bin/whisper-cli',
    whisperModelPath: '/home/loi/whisper.cpp/whisper.cpp/ggml-base.bin',
    language: 'vi',
    enableCleanup: true
  };

  constructor(
    @Inject(forwardRef(() => StreamingGateway))
    private readonly streamingGateway: StreamingGateway
  ) {
    this.initializeAudioDirectory();
    this.initializeTranscriptDirectory();
    this.initializeFileWatcher();
    this.initializePortPool();
  }

  /**
   * Start STT transcription for a specific audio producer
   */
  async startTranscription(client: Client, producerId: string): Promise<void> {
    try {
      if (!client.room || !client.room.router) {
        throw new Error('Client not in a room or router not available');
      }

      const participantId = client.userId;
      const roomId = client.room.roomId;

      this.logger.log(`Starting STT for participant ${participantId} in room ${roomId}`);

      // Skip if already processing this participant
      if (this.rtpSessions.has(participantId)) {
        this.logger.warn(`STT already active for participant ${participantId}`);
        return;
      }

      // 1. Get a port pair for FFmpeg to listen on (RTP and RTCP)
      const { rtpPort, rtcpPort } = await this.getAvailablePortPair();
      this.logger.debug(`Allocated FFmpeg ports: RTP ${rtpPort}, RTCP ${rtcpPort}`);

      // 2. Create MediaSoup transport (let it pick its own random port)
      // We don't specify 'port' here, so MediaSoup won't conflict with FFmpeg
      const plainTransport = await client.room.router.createPlainTransport({
        listenInfo: {
          protocol: 'udp',
          ip: '127.0.0.1'
        },
        rtcpMux: false, // FFmpeg expects separate RTP/RTCP ports usually
        comedia: false // We will explicitly connect to FFmpeg
      });

      this.logger.log(`PlainTransport created for ${client.userId}`);

      // 3. Connect MediaSoup transport to FFmpeg's ports
      // This tells MediaSoup where to send the audio packets
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
        roomId,
        producerId,
        plainTransport,
        rtpPort,
        rtcpPort,
        segmentCounter: 0,
        lastProcessedSegment: -1,
        processingSegments: new Set(),
        isActive: true,
        startTime: new Date()
      };

      // Start FFmpeg process to capture and segment RTP
      await this.startFFmpegCapture(rtpSession);
      
      this.rtpSessions.set(participantId, rtpSession);

      this.logger.log(`STT started successfully for ${participantId}`);

    } catch (error) {
      this.logger.error(`Error starting STT for ${client.userId}:`, error);
      throw error;
    }
  }

  /**
   * Stop STT transcription for a participant
   */
  async stopTranscription(participantId: string): Promise<void> {
    const session = this.rtpSessions.get(participantId);
    if (!session) {
      this.logger.warn(`No active STT session for participant ${participantId}`);
      return;
    }

    try {
      this.logger.log(`Stopping STT for participant ${participantId}`);
      
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

      this.logger.log(`STT stopped for participant ${participantId}`);

    } catch (error) {
      this.logger.error(`Error stopping STT for ${participantId}:`, error);
    }
  }

  /**
   * Get transcriptions for a room
   */
  getTranscriptions(roomId: string): TranscriptionSegment[] {
    return this.transcriptions.get(roomId) || [];
  }

  /**
   * Get transcriptions for a specific participant in a room
   */
  getParticipantTranscriptions(roomId: string, participantId: string): TranscriptionSegment[] {
    const roomTranscriptions = this.transcriptions.get(roomId) || [];
    return roomTranscriptions.filter(t => t.participantId === participantId);
  }

  /**
   * Clear transcriptions for a room (when room ends)
   */
  clearRoomTranscriptions(roomId: string): void {
    this.transcriptions.delete(roomId);
    this.logger.log(`Cleared transcriptions for room ${roomId}`);
  }

  /**
   * Initialize audio directory
   */
  private async initializeAudioDirectory(): Promise<void> {
    try {
      await fs.mkdir(this.config.audioDir, { recursive: true });
      this.logger.log(`Audio directory initialized: ${this.config.audioDir}`);
    } catch (error) {
      this.logger.error('Failed to create audio directory:', error);
    }
  }

  /**
   * Initialize file watcher for completed audio segments
   */
  private initializeFileWatcher(): void {
    this.fileWatcher = watch(this.config.audioDir, {
      ignored: /(^|[\/\\])\../, // ignore dotfiles
      persistent: true,
      // We don't need awaitWriteFinish anymore as we watch the segment list
      // which is updated only after the segment file is closed
    });

    this.fileWatcher
      .on('add', (filePath) => this.handleFileEvent(filePath))
      .on('change', (filePath) => this.handleFileEvent(filePath))
      .on('error', (error) => this.logger.error('File watcher error:', error));

    this.logger.log('File watcher initialized');
  }

  /**
   * Start FFmpeg process to capture RTP and create segments
   */
  private async startFFmpegCapture(session: RTPSession): Promise<void> {
    const outputPattern = path.join(
      this.config.audioDir,
      `${session.roomId}_${session.participantId}_segment_%03d.wav`
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
      this.config.audioDir,
      `${session.roomId}_${session.participantId}.sdp`
    );
    session.sdpFilePath = sdpFilePath;

    await fs.writeFile(sdpFilePath, sdpContent);
    this.logger.debug(`Created SDP file for FFmpeg: ${sdpFilePath}`);

    // Create segment list file path
    const segmentListPath = path.join(
      this.config.audioDir,
      `${session.roomId}_${session.participantId}_segments.txt`
    );
    session.segmentListPath = segmentListPath;
    session.lastProcessedSegment = -1;

    // FFmpeg command to receive RTP and segment into WAV files
    // Note: protocol_whitelist is required to allow reading SDP file and receiving RTP
    const ffmpegArgs = [
      '-protocol_whitelist', 'file,rtp,udp',
      '-i', sdpFilePath,
      '-acodec', 'pcm_s16le',    // 16-bit PCM
      '-ar', '16000',            // 16kHz sample rate (good for Whisper)
      '-ac', '1',                // Mono
      '-f', 'segment',           // Segment format
      '-segment_time', this.config.segmentDuration.toString(), // 60 seconds
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
   * Handle file events (checking segment lists)
   */
  private async handleFileEvent(filePath: string): Promise<void> {
    try {
      if (!filePath.endsWith('_segments.txt')) {
        return;
      }

      const filename = path.basename(filePath);
      const match = filename.match(/^(.+)_(.+)_segments\.txt$/);
      
      if (!match) {
        return;
      }

      const [, roomId, participantId] = match;
      
      // Get the session to track progress
      const session = this.rtpSessions.get(participantId);
      if (!session) {
        // Session might have ended
        return;
      }

      // Read the list file
      const content = await fs.readFile(filePath, 'utf-8');
      const lines = content.split('\n').filter(line => line.trim());
      
      // Process new lines
      for (const line of lines) {
        // Parse segment index from filename: ..._segment_000.wav
        const segMatch = line.match(/_segment_(\d+)\.wav$/);
        if (!segMatch) continue;
        
        const segmentIndex = parseInt(segMatch[1], 10);
        
        // Only process if it's new and not currently being processed
        if (segmentIndex > session.lastProcessedSegment && !session.processingSegments.has(segmentIndex)) {
          session.processingSegments.add(segmentIndex);
          
          // Use basename to ensure we build the correct path regardless of what FFmpeg put in the list
          const audioFilePath = path.join(this.config.audioDir, path.basename(line.trim()));
          
          this.logger.log(`Processing new segment index ${segmentIndex}: ${line}`);
          
          try {
            // Process with Whisper
            const transcription = await this.processWithWhisper(audioFilePath, roomId, participantId, segmentIndex);
            
            if (transcription) {
              this.storeTranscription(transcription);
              // Update last processed only if it's the next one (to maintain order logic if needed)
              // But here we just want to ensure we don't reprocess
              session.lastProcessedSegment = Math.max(session.lastProcessedSegment, segmentIndex);
              
              // Cleanup audio file
              if (this.config.enableCleanup) {
                await this.cleanupAudioFile(audioFilePath);
              }
            }
          } finally {
            session.processingSegments.delete(segmentIndex);
          }
        }
      }

    } catch (error) {
      this.logger.error(`Error processing file event ${filePath}:`, error);
    }
  }

  /**
   * Process audio file with Whisper.cpp
   */
  private async processWithWhisper(
    filePath: string, 
    roomId: string, 
    participantId: string, 
    segmentNumber: number
  ): Promise<TranscriptionSegment | null> {
    return new Promise((resolve) => {
      // Whisper.cpp command
      const whisperArgs = [
        '-m', this.config.whisperModelPath,
        '-f', filePath,
        '-l', this.config.language === 'auto' ? 'auto' : this.config.language,
        '--output-txt',
        '--no-timestamps' // We'll use our own timestamps
      ];

      this.logger.log(`Running Whisper: ${this.config.whisperBinaryPath} ${whisperArgs.join(' ')}`);

      const whisperProcess = spawn(this.config.whisperBinaryPath, whisperArgs);
      let output = '';
      let errorOutput = '';

      whisperProcess.stdout.on('data', (data) => {
        output += data.toString();
      });

      whisperProcess.stderr.on('data', (data) => {
        errorOutput += data.toString();
      });

      whisperProcess.on('close', (code) => {
        if (code === 0 && output.trim()) {
          const transcription: TranscriptionSegment = {
            participantId,
            roomId,
            text: output.trim(),
            confidence: 0.8, // Default confidence, Whisper doesn't always provide this
            language: this.detectLanguage(output.trim()),
            timestamp: new Date(),
            segmentNumber,
            duration: this.config.segmentDuration
          };
          
          this.logger.log(`Transcription completed for ${participantId} segment ${segmentNumber}: "${transcription.text.substring(0, 50)}..."`);
          resolve(transcription);
        } else {
          this.logger.error(`Whisper failed with code ${code}. Error: ${errorOutput}`);
          resolve(null);
        }
      });

      whisperProcess.on('error', (error) => {
        this.logger.error(`Whisper process error:`, error);
        resolve(null);
      });
    });
  }

  /**
   * Store transcription in memory
   */
  private storeTranscription(transcription: TranscriptionSegment): void {
    const roomTranscriptions = this.transcriptions.get(transcription.roomId) || [];
    roomTranscriptions.push(transcription);
    
    // Sort by timestamp to maintain chronological order
    roomTranscriptions.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
    
    this.transcriptions.set(transcription.roomId, roomTranscriptions);
    
    this.logger.log(`Stored transcription for room ${transcription.roomId}: ${roomTranscriptions.length} total segments`);

    // Broadcast to room
    this.streamingGateway.broadcastToRoom(transcription.roomId, 'transcription', transcription);
  }

  /**
   * Simple language detection (basic heuristic)
   */
  private detectLanguage(text: string): 'vi' | 'en' {
    // Simple heuristic: check for Vietnamese characters
    const vietnameseChars = /[àáạảãâầấậẩẫăằắặẳẵèéẹẻẽêềếệểễìíịỉĩòóọỏõôồốộổỗơờớợởỡùúụủũưừứựửữỳýỵỷỹđ]/i;
    return vietnameseChars.test(text) ? 'vi' : 'en';
  }

  /**
   * Cleanup audio file
   */
  private async cleanupAudioFile(filePath: string): Promise<void> {
    try {
      await fs.unlink(filePath);
      this.logger.debug(`Cleaned up audio file: ${filePath}`);
    } catch (error) {
      this.logger.error(`Failed to cleanup audio file ${filePath}:`, error);
    }
  }

  /**
   * Initialize port pool for RTP streams
   */
  private initializePortPool(): void {
    // Use very high unreserved port range 60000-65000 (5000 ports)
    // This range is typically free from system services
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
   * Initialize transcript directory
   */
  private async initializeTranscriptDirectory(): Promise<void> {
    try {
      await fs.mkdir(this.config.transcriptDir, { recursive: true });
      this.logger.log(`Transcript directory initialized: ${this.config.transcriptDir}`);
    } catch (error) {
      this.logger.error('Failed to create transcript directory:', error);
    }
  }

  /**
   * Save transcriptions for a participant when they leave the room
   */
  async saveParticipantTranscript(participantId: string, roomId: string): Promise<void> {
    try {
      // Get all transcriptions for this participant in the room
      const roomTranscriptions = this.transcriptions.get(roomId) || [];
      const participantTranscriptions = roomTranscriptions.filter(t => t.participantId === participantId);
      
      if (participantTranscriptions.length === 0) {
        this.logger.log(`No transcriptions to save for participant ${participantId} in room ${roomId}`);
        return;
      }

      // Create transcript data structure
      const transcriptData = {
        roomId,
        participantId,
        sessionStartTime: participantTranscriptions[0].timestamp,
        sessionEndTime: participantTranscriptions[participantTranscriptions.length - 1].timestamp,
        totalSegments: participantTranscriptions.length,
        segments: participantTranscriptions
      };

      // Generate filename with timestamp
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const filename = `${roomId}_${participantId}_${timestamp}.json`;
      const filepath = path.join(this.config.transcriptDir, filename);

      // Save to file
      await fs.writeFile(filepath, JSON.stringify(transcriptData, null, 2), 'utf-8');
      
      this.logger.log(`Saved transcript for participant ${participantId} to ${filepath}`);
      
      // TODO: Later - Save to database
      // await this.saveTranscriptToDatabase(transcriptData);
      
    } catch (error) {
      this.logger.error(`Failed to save transcript for participant ${participantId}:`, error);
    }
  }

  /**
   * Save all transcriptions for a room when it ends
   */
  async saveRoomTranscript(roomId: string): Promise<void> {
    try {
      const roomTranscriptions = this.transcriptions.get(roomId) || [];
      
      if (roomTranscriptions.length === 0) {
        this.logger.log(`No transcriptions to save for room ${roomId}`);
        return;
      }

      // Group transcriptions by participant
      const participantsMap = new Map<string, typeof roomTranscriptions>();
      roomTranscriptions.forEach(t => {
        if (!participantsMap.has(t.participantId)) {
          participantsMap.set(t.participantId, []);
        }
        participantsMap.get(t.participantId)!.push(t);
      });

      // Save transcript for each participant
      const savePromises = Array.from(participantsMap.keys()).map(participantId => 
        this.saveParticipantTranscript(participantId, roomId)
      );
      
      await Promise.all(savePromises);
      
      this.logger.log(`Saved all transcripts for room ${roomId}`);
      
    } catch (error) {
      this.logger.error(`Failed to save room transcripts for ${roomId}:`, error);
    }
  }

  /**
   * Cleanup when service is destroyed
   */
  async onModuleDestroy(): Promise<void> {
    this.logger.log('Cleaning up STT service...');

    // Stop all active sessions
    for (const [participantId] of this.rtpSessions) {
      await this.stopTranscription(participantId);
    }

    // Close file watcher
    if (this.fileWatcher) {
      await this.fileWatcher.close();
    }

    this.logger.log('STT service cleanup completed');
  }
}