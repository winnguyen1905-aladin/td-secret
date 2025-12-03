import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as fs from 'fs/promises';
import * as path from 'path';
import { spawn } from 'child_process';
import { 
  TranscriptRequestDto, 
  TranscriptResponseDto, 
  Language, 
  WhisperModel, 
  ResponseFormat,
  WhisperResult,
  ParticipantTranscript,
  TranscriptSegment
} from './transcript.types';

@Injectable()
export class TranscriptService {
  private readonly logger = new Logger(TranscriptService.name);
  private readonly audioSegmentsDir = './temp/audio-segments';
  private readonly transcriptsDir = './temp/transcripts';
  private readonly whisperScriptPath = './scripts/whisper_transcriber.py';

  constructor(private readonly configService: ConfigService) {
    this.initializeDirectories();
  }

  /**
   * Get transcript for a room with optional participant filter
   */
  async getTranscript(request: TranscriptRequestDto): Promise<TranscriptResponseDto> {
    const {
      roomId,
      participantId,
      language = Language.AUTO,
      model = WhisperModel.BASE,
      format = ResponseFormat.DETAILED,
      useCache = true,
      forceRegenerate = false
    } = request;

    this.logger.log(`Generating transcript for room ${roomId}, participant: ${participantId || 'all'}, format: ${format}`);

    // Check cache first (if enabled and not forcing regeneration)
    if (useCache && !forceRegenerate) {
      const cached = await this.findCachedTranscript(roomId, participantId, language, model, format);
      if (cached) {
        this.logger.log(`Returning cached transcript for room ${roomId}`);
        return cached;
      }
    }

    const startTime = Date.now();
    
    // Get audio segments for the room/participant
    const audioSegments = await this.getAudioSegments(roomId, participantId);
    if (audioSegments.length === 0) {
      throw new NotFoundException(`No audio segments found for room ${roomId}${participantId ? ` and participant ${participantId}` : ''}`);
    }

    // Process each audio segment with Whisper
    const participantTranscripts = await this.processAudioSegments(audioSegments, language, model);
    
    // Format response based on requested format
    const response = await this.formatResponse({
      roomId,
      participantId,
      format,
      language: language === Language.AUTO ? this.detectLanguage(participantTranscripts) : language,
      model,
      participants: participantTranscripts,
      processingTime: Date.now() - startTime,
      cached: false
    });

    // Cache the result
    if (useCache) {
      await this.cacheTranscript(response);
    }

    return response;
  }

  /**
   * Find cached transcript, trying multiple language combinations
   */
  private async findCachedTranscript(
    roomId: string,
    participantId: string | undefined,
    language: Language,
    model: WhisperModel,
    format: ResponseFormat
  ): Promise<TranscriptResponseDto | null> {
    // Try different language combinations to find existing cache
    const languagesToTry = [
      language, // Requested language first
      Language.VI, // Common detected language
      Language.EN, // Fallback language
      Language.AUTO // Auto-detect language
    ].filter((lang, index, arr) => arr.indexOf(lang) === index); // Remove duplicates

    // Try better models first if user didn't specify a specific model
    const modelsToTry = model === WhisperModel.BASE ? [
      WhisperModel.LARGE_V3, // Best model first
      WhisperModel.LARGE_V2,
      WhisperModel.LARGE,
      WhisperModel.MEDIUM,
      WhisperModel.SMALL,
      WhisperModel.BASE, // Fallback to requested model
      WhisperModel.TINY
    ] : [model]; // If specific model requested, only try that one

    for (const lang of languagesToTry) {
      for (const modelToTry of modelsToTry) {
        const cached = await this.getCachedTranscript(roomId, participantId, lang, modelToTry, format);
        if (cached) {
          this.logger.log(`Found cached transcript with language: ${lang}, model: ${modelToTry}`);
          return cached;
        }
      }
    }

    return null;
  }

  /**
   * Get cached transcript if it exists
   */
  private async getCachedTranscript(
    roomId: string, 
    participantId: string | undefined, 
    language: Language, 
    model: WhisperModel, 
    format: ResponseFormat
  ): Promise<TranscriptResponseDto | null> {
    try {
      const cacheKey = this.generateCacheKey(roomId, participantId, language, model, format);
      const cacheFilePath = path.join(this.transcriptsDir, `${cacheKey}.json`);
      
      const cacheExists = await fs.access(cacheFilePath).then(() => true).catch(() => false);
      if (!cacheExists) return null;

      const cacheContent = await fs.readFile(cacheFilePath, 'utf-8');
      const cachedResponse = JSON.parse(cacheContent) as TranscriptResponseDto;
      
      // Mark as cached
      cachedResponse.cached = true;
      
      return cachedResponse;
    } catch (error) {
      this.logger.warn(`Failed to load cached transcript: ${error.message}`);
      return null;
    }
  }

  /**
   * Cache transcript response
   */
  private async cacheTranscript(response: TranscriptResponseDto): Promise<void> {
    try {
      const cacheKey = this.generateCacheKey(
        response.roomId, 
        response.participantId, 
        response.language as Language, 
        response.model, 
        response.format
      );
      const cacheFilePath = path.join(this.transcriptsDir, `${cacheKey}.json`);
      
      await fs.writeFile(cacheFilePath, JSON.stringify(response, null, 2));
      this.logger.log(`Cached transcript: ${cacheFilePath}`);
    } catch (error) {
      this.logger.error(`Failed to cache transcript: ${error.message}`);
    }
  }

  /**
   * Get audio segments for room/participant
   */
  private async getAudioSegments(roomId: string, participantId?: string): Promise<Array<{
    filePath: string;
    participantId: string;
    displayName: string;
    segmentNumber: number;
  }>> {
    try {
      const roomDir = path.join(this.audioSegmentsDir, roomId);
      const roomExists = await fs.access(roomDir).then(() => true).catch(() => false);
      
      if (!roomExists) {
        throw new NotFoundException(`No audio directory found for room ${roomId}`);
      }

      const files = await fs.readdir(roomDir);
      const audioFiles = files.filter(f => f.endsWith('.wav') && f.includes('_segment_'));
      
      const segments = audioFiles
        .map(fileName => {
          // Parse filename: displayName_participantId_segment_XXX.wav
          const match = fileName.match(/^(.+?)_([^_]+)_segment_(\d+)\.wav$/);
          if (!match) return null;
          
          const [, displayName, fileParticipantId, segmentNum] = match;
          
          // Filter by participant if specified
          if (participantId && fileParticipantId !== participantId) {
            return null;
          }
          
          return {
            filePath: path.join(roomDir, fileName),
            participantId: fileParticipantId,
            displayName: displayName.replace(/_/g, ' '), // Restore display name
            segmentNumber: parseInt(segmentNum, 10)
          };
        })
        .filter((segment): segment is NonNullable<typeof segment> => segment !== null)
        .sort((a, b) => {
          // Sort by participant first, then by segment number
          if (a.participantId !== b.participantId) {
            return a.participantId.localeCompare(b.participantId);
          }
          return a.segmentNumber - b.segmentNumber;
        });

      this.logger.log(`Found ${segments.length} audio segments for room ${roomId}${participantId ? ` (participant: ${participantId})` : ''}`);
      return segments;
    } catch (error) {
      this.logger.error(`Error getting audio segments: ${error.message}`);
      throw error;
    }
  }

  /**
   * Process audio segments with Whisper transcription
   */
  private async processAudioSegments(
    audioSegments: Array<{
      filePath: string;
      participantId: string;
      displayName: string;
      segmentNumber: number;
    }>,
    language: Language,
    model: WhisperModel
  ): Promise<ParticipantTranscript[]> {
    const participantMap = new Map<string, {
      participantId: string;
      displayName: string;
      segments: TranscriptSegment[];
    }>();

    // Process each audio segment
    for (const audioSegment of audioSegments) {
      try {
        this.logger.log(`Processing segment ${audioSegment.segmentNumber} for participant ${audioSegment.participantId}`);
        
        const whisperResult = await this.transcribeWithWhisper(
          audioSegment.filePath,
          language,
          model
        );

        if (whisperResult.success) {
          const transcriptSegment: TranscriptSegment = {
            segmentNumber: audioSegment.segmentNumber,
            fileName: path.basename(audioSegment.filePath),
            start: whisperResult.segments[0]?.start || 0,
            end: whisperResult.segments[whisperResult.segments.length - 1]?.end || whisperResult.duration,
            text: whisperResult.text,
            confidence: whisperResult.confidence,
            whisperSegments: whisperResult.segments
          };

          // Group by participant
          if (!participantMap.has(audioSegment.participantId)) {
            participantMap.set(audioSegment.participantId, {
              participantId: audioSegment.participantId,
              displayName: audioSegment.displayName,
              segments: []
            });
          }

          participantMap.get(audioSegment.participantId)!.segments.push(transcriptSegment);
        }
      } catch (error) {
        this.logger.error(`Error processing segment ${audioSegment.segmentNumber}: ${error.message}`);
        // Continue processing other segments
      }
    }

    // Convert map to array and calculate totals
    return Array.from(participantMap.values()).map(participant => {
      const totalDuration = participant.segments.reduce(
        (sum, segment) => sum + (segment.end - segment.start), 0
      );
      const averageConfidence = participant.segments.reduce(
        (sum, segment) => sum + segment.confidence, 0
      ) / participant.segments.length || 0;

      return {
        participantId: participant.participantId,
        displayName: participant.displayName,
        segments: participant.segments.sort((a, b) => a.segmentNumber - b.segmentNumber),
        totalDuration,
        confidence: averageConfidence
      };
    });
  }

  /**
   * Transcribe audio file using Whisper
   */
  private async transcribeWithWhisper(
    filePath: string,
    language: Language,
    model: WhisperModel
  ): Promise<WhisperResult> {
    return new Promise((resolve) => {
      const languageArg = language === Language.AUTO ? 'auto' : language;
      
      const whisperProcess = spawn('python3', [
        this.whisperScriptPath,
        filePath,
        '--model', model,
        '--language', languageArg,
        '--output_format', 'json'
      ]);

      let output = '';
      let errorOutput = '';

      whisperProcess.stdout.on('data', (data) => {
        output += data.toString();
      });

      whisperProcess.stderr.on('data', (data) => {
        errorOutput += data.toString();
      });

      whisperProcess.on('close', (code) => {
        if (code === 0) {
          try {
            const result = JSON.parse(output.trim()) as WhisperResult;
            resolve(result);
          } catch (error) {
            this.logger.error(`Failed to parse Whisper output: ${error.message}`);
            resolve({
              text: '',
              language: languageArg,
              language_probability: 0,
              duration: 0,
              confidence: 0,
              segments: [],
              success: false
            });
          }
        } else {
          this.logger.error(`Whisper process failed with code ${code}: ${errorOutput}`);
          resolve({
            text: '',
            language: languageArg,
            language_probability: 0,
            duration: 0,
            confidence: 0,
            segments: [],
            success: false
          });
        }
      });

      whisperProcess.on('error', (error) => {
        this.logger.error(`Whisper process error: ${error.message}`);
        resolve({
          text: '',
          language: languageArg,
          language_probability: 0,
          duration: 0,
          confidence: 0,
          segments: [],
          success: false
        });
      });

      // Set timeout for Whisper process
      setTimeout(() => {
        if (!whisperProcess.killed) {
          this.logger.warn(`Whisper process timeout for ${filePath}, killing process`);
          whisperProcess.kill('SIGTERM');
          resolve({
            text: '',
            language: languageArg,
            language_probability: 0,
            duration: 0,
            confidence: 0,
            segments: [],
            success: false
          });
        }
      }, 120000); // 2 minute timeout
    });
  }

  /**
   * Format response based on requested format
   */
  private async formatResponse(options: {
    roomId: string;
    participantId?: string;
    format: ResponseFormat;
    language: string;
    model: WhisperModel;
    participants: ParticipantTranscript[];
    processingTime: number;
    cached: boolean;
  }): Promise<TranscriptResponseDto> {
    const baseResponse: TranscriptResponseDto = {
      roomId: options.roomId,
      participantId: options.participantId,
      format: options.format,
      language: options.language,
      model: options.model,
      generatedAt: new Date(),
      cached: options.cached
    };

    switch (options.format) {
      case ResponseFormat.RAW_TEXT:
        baseResponse.rawText = this.generateRawText(options.participants);
        break;

      case ResponseFormat.TIMESTAMPED:
        baseResponse.timestampedText = this.generateTimestampedText(options.participants);
        break;

      case ResponseFormat.PARTICIPANT_SEPARATED:
        baseResponse.participants = options.participants;
        break;

      case ResponseFormat.DETAILED:
        const totalDuration = options.participants.reduce((sum, p) => sum + p.totalDuration, 0);
        const averageConfidence = options.participants.reduce((sum, p) => sum + p.confidence, 0) / options.participants.length || 0;
        
        baseResponse.detailed = {
          participants: options.participants,
          totalDuration,
          averageConfidence,
          processingTime: options.processingTime
        };
        break;
    }

    return baseResponse;
  }

  /**
   * Generate raw text format
   */
  private generateRawText(participants: ParticipantTranscript[]): string {
    return participants
      .flatMap(participant => 
        participant.segments.map(segment => segment.text)
      )
      .join(' ');
  }

  /**
   * Generate timestamped text format
   */
  private generateTimestampedText(participants: ParticipantTranscript[]): Array<{
    timestamp: string;
    text: string;
    participant: string;
  }> {
    const allSegments = participants.flatMap(participant =>
      participant.segments.map(segment => ({
        timestamp: this.formatTimestamp(segment.start),
        text: segment.text,
        participant: participant.displayName,
        startTime: segment.start
      }))
    );

    // Sort by timestamp
    return allSegments
      .sort((a, b) => a.startTime - b.startTime)
      .map(({ timestamp, text, participant }) => ({
        timestamp,
        text,
        participant
      }));
  }

  /**
   * Detect language from participant transcripts
   */
  private detectLanguage(participants: ParticipantTranscript[]): string {
    // Simple language detection based on most common language in segments
    // This could be enhanced with more sophisticated detection
    return 'vi'; // Default to Vietnamese for now
  }

  /**
   * Generate cache key for transcript
   */
  private generateCacheKey(
    roomId: string,
    participantId: string | undefined,
    language: Language,
    model: WhisperModel,
    format: ResponseFormat
  ): string {
    const parts = [roomId, participantId || 'all', language, model, format];
    return parts.join('_');
  }

  /**
   * Format timestamp for display
   */
  private formatTimestamp(seconds: number): string {
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = Math.floor(seconds % 60);
    return `${minutes.toString().padStart(2, '0')}:${remainingSeconds.toString().padStart(2, '0')}`;
  }

  /**
   * Initialize required directories
   */
  private async initializeDirectories(): Promise<void> {
    try {
      await fs.mkdir(this.transcriptsDir, { recursive: true });
      this.logger.log('Transcript directories initialized');
    } catch (error) {
      this.logger.error(`Failed to initialize directories: ${error.message}`);
    }
  }

  /**
   * Clear cached transcripts
   */
  async clearCache(filters: {
    roomId: string;
    participantId?: string;
    language?: Language;
    model?: WhisperModel;
    format?: ResponseFormat;
  }): Promise<{ cleared: boolean; filesRemoved: number }> {
    try {
      let filesRemoved = 0;
      const cacheDir = this.transcriptsDir;
      
      // Read all cache files
      const cacheFiles = await fs.readdir(cacheDir).catch(() => []);
      
      for (const file of cacheFiles) {
        if (!file.endsWith('.json')) continue;
        
        // Parse cache filename: roomId_participantId_language_model_format.json
        const parts = file.replace('.json', '').split('_');
        if (parts.length < 5) continue;
        
        const [fileRoomId, fileParticipantId, fileLanguage, fileModel, fileFormat] = parts;
        
        // Check if this cache file matches the filters
        let shouldDelete = fileRoomId === filters.roomId;
        
        if (shouldDelete && filters.participantId) {
          shouldDelete = fileParticipantId === filters.participantId;
        }
        
        if (shouldDelete && filters.language) {
          shouldDelete = fileLanguage === filters.language;
        }
        
        if (shouldDelete && filters.model) {
          shouldDelete = fileModel === filters.model;
        }
        
        if (shouldDelete && filters.format) {
          shouldDelete = fileFormat === filters.format;
        }
        
        if (shouldDelete) {
          const filePath = path.join(cacheDir, file);
          await fs.unlink(filePath);
          filesRemoved++;
          this.logger.log(`Cleared cache file: ${file}`);
        }
      }
      
      return { cleared: true, filesRemoved };
    } catch (error) {
      this.logger.error(`Failed to clear cache: ${error.message}`);
      return { cleared: false, filesRemoved: 0 };
    }
  }

  /**
   * Legacy method for backward compatibility
   */
  async getTranscriptById(id: string) {
    return this.getTranscript({ roomId: id });
  }
}
