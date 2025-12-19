import {
  Controller,
  Get,
  Post,
  Delete,
  Body,
  Param,
  Query,
  HttpCode,
  HttpStatus,
  BadRequestException,
  ValidationPipe,
} from '@nestjs/common';
import { TranscriptService } from './transcript.service';
import { 
  TranscriptRequestDto, 
  TranscriptResponseDto, 
  Language, 
  WhisperModel, 
  ResponseFormat 
} from './transcript.types';

@Controller('transcripts')
export class TranscriptController {
  constructor(private readonly transcriptService: TranscriptService) {}

  /**
   * Health check endpoint
   * GET /transcripts/health
   */
  @Get('health')
  async healthCheck() {
    return {
      status: 'ok',
      service: 'transcript-api',
      timestamp: new Date().toISOString(),
      endpoints: [
        // Basic transcript endpoints
        'GET /transcripts/room/{roomId}',
        'GET /transcripts/room/{roomId}/participant/{participantId}',
        'POST /transcripts/generate',
        
        // Format-specific endpoints
        'GET /transcripts/room/{roomId}/raw',
        'GET /transcripts/room/{roomId}/timestamped',
        'GET /transcripts/room/{roomId}/participants',
        'GET /transcripts/room/{roomId}/detailed',
        
        // Force re-transcription endpoints
        'POST /transcripts/room/{roomId}/retranscribe',
        'POST /transcripts/room/{roomId}/participant/{participantId}/retranscribe',
        'POST /transcripts/room/{roomId}/upgrade',
        
        // Cache management
        'DELETE /transcripts/room/{roomId}/cache'
      ],
      features: {
        'Multiple Models': ['tiny', 'base', 'small', 'medium', 'large', 'large-v2', 'large-v3'],
        'Languages': ['auto', 'vi', 'en'],
        'Response Formats': ['raw_text', 'timestamped', 'participant_separated', 'detailed'],
        'Caching': 'Smart caching with language detection',
        'Force Regeneration': 'Re-transcribe with better models'
      }
    };
  }

  /**
   * Get transcript for a specific room
   * GET /transcripts/room/{roomId}
   */
  @Get('room/:roomId')
  async getRoomTranscript(
    @Param('roomId') roomId: string,
    @Query('language') language?: string,
    @Query('model') model?: string,
    @Query('format') format?: string,
    @Query('useCache') useCache?: string,
    @Query('forceRegenerate') forceRegenerate?: string
  ): Promise<TranscriptResponseDto> {
    const request: TranscriptRequestDto = {
      roomId,
      language: this.parseLanguage(language),
      model: this.parseModel(model),
      format: this.parseFormat(format),
      useCache: useCache !== 'false',
      forceRegenerate: forceRegenerate === 'true'
    };

    return this.transcriptService.getTranscript(request);
  }

  /**
   * Get transcript for a specific participant in a room
   * GET /transcripts/room/{roomId}/participant/{participantId}
   */
  @Get('room/:roomId/participant/:participantId')
  async getParticipantTranscript(
    @Param('roomId') roomId: string,
    @Param('participantId') participantId: string,
    @Query('language') language?: string,
    @Query('model') model?: string,
    @Query('format') format?: string,
    @Query('useCache') useCache?: string,
    @Query('forceRegenerate') forceRegenerate?: string
  ): Promise<TranscriptResponseDto> {
    const request: TranscriptRequestDto = {
      roomId,
      participantId,
      language: this.parseLanguage(language),
      model: this.parseModel(model),
      format: this.parseFormat(format),
      useCache: useCache !== 'false',
      forceRegenerate: forceRegenerate === 'true'
    };

    return this.transcriptService.getTranscript(request);
  }

  /**
   * Generate transcript with POST body for complex requests
   * POST /transcripts/generate
   */
  @Post('generate')
  @HttpCode(HttpStatus.OK)
  async generateTranscript(
    @Body(ValidationPipe) request: TranscriptRequestDto
  ): Promise<TranscriptResponseDto> {
    return this.transcriptService.getTranscript(request);
  }

  /**
   * Get transcript in raw text format
   * GET /transcripts/room/{roomId}/raw
   */
  @Get('room/:roomId/raw')
  async getRoomTranscriptRaw(
    @Param('roomId') roomId: string,
    @Query('language') language?: string,
    @Query('model') model?: string,
    @Query('participantId') participantId?: string
  ): Promise<{ text: string; metadata: any }> {
    const request: TranscriptRequestDto = {
      roomId,
      participantId,
      language: this.parseLanguage(language),
      model: this.parseModel(model),
      format: ResponseFormat.RAW_TEXT
    };

    const result = await this.transcriptService.getTranscript(request);
    return {
      text: result.rawText || '',
      metadata: {
        roomId: result.roomId,
        participantId: result.participantId,
        language: result.language,
        model: result.model,
        generatedAt: result.generatedAt,
        cached: result.cached
      }
    };
  }

  /**
   * Get transcript in timestamped format
   * GET /transcripts/room/{roomId}/timestamped
   */
  @Get('room/:roomId/timestamped')
  async getRoomTranscriptTimestamped(
    @Param('roomId') roomId: string,
    @Query('language') language?: string,
    @Query('model') model?: string,
    @Query('participantId') participantId?: string
  ): Promise<TranscriptResponseDto> {
    const request: TranscriptRequestDto = {
      roomId,
      participantId,
      language: this.parseLanguage(language),
      model: this.parseModel(model),
      format: ResponseFormat.TIMESTAMPED
    };

    return this.transcriptService.getTranscript(request);
  }

  /**
   * Get transcript separated by participants
   * GET /transcripts/room/{roomId}/participants
   */
  @Get('room/:roomId/participants')
  async getRoomTranscriptByParticipants(
    @Param('roomId') roomId: string,
    @Query('language') language?: string,
    @Query('model') model?: string
  ): Promise<TranscriptResponseDto> {
    const request: TranscriptRequestDto = {
      roomId,
      language: this.parseLanguage(language),
      model: this.parseModel(model),
      format: ResponseFormat.PARTICIPANT_SEPARATED
    };

    return this.transcriptService.getTranscript(request);
  }

  /**
   * Get detailed transcript with full metadata
   * GET /transcripts/room/{roomId}/detailed
   */
  @Get('room/:roomId/detailed')
  async getRoomTranscriptDetailed(
    @Param('roomId') roomId: string,
    @Query('language') language?: string,
    @Query('model') model?: string,
    @Query('participantId') participantId?: string
  ): Promise<TranscriptResponseDto> {
    const request: TranscriptRequestDto = {
      roomId,
      participantId,
      language: this.parseLanguage(language),
      model: this.parseModel(model),
      format: ResponseFormat.DETAILED
    };

    return this.transcriptService.getTranscript(request);
  }

  /**
   * Force re-transcribe room with new parameters
   * POST /transcripts/room/{roomId}/retranscribe
   */
  @Post('room/:roomId/retranscribe')
  @HttpCode(HttpStatus.OK)
  async retranscribeRoom(
    @Param('roomId') roomId: string,
    @Query('language') language?: string,
    @Query('model') model?: string,
    @Query('format') format?: string,
    @Query('participantId') participantId?: string
  ): Promise<TranscriptResponseDto> {
    const request: TranscriptRequestDto = {
      roomId,
      participantId,
      language: this.parseLanguage(language),
      model: this.parseModel(model),
      format: this.parseFormat(format),
      useCache: true, // Save to cache after generation
      forceRegenerate: true // Skip reading old cache, but save new result
    };

    return this.transcriptService.getTranscript(request);
  }

  /**
   * Force re-transcribe participant with new parameters  
   * POST /transcripts/room/{roomId}/participant/{participantId}/retranscribe
   */
  @Post('room/:roomId/participant/:participantId/retranscribe')
  @HttpCode(HttpStatus.OK)
  async retranscribeParticipant(
    @Param('roomId') roomId: string,
    @Param('participantId') participantId: string,
    @Query('language') language?: string,
    @Query('model') model?: string,
    @Query('format') format?: string
  ): Promise<TranscriptResponseDto> {
    const request: TranscriptRequestDto = {
      roomId,
      participantId,
      language: this.parseLanguage(language),
      model: this.parseModel(model),
      format: this.parseFormat(format),
      useCache: true, // Save to cache after generation
      forceRegenerate: true // Skip reading old cache, but save new result
    };

    return this.transcriptService.getTranscript(request);
  }

  /**
   * Upgrade transcript to better model
   * POST /transcripts/room/{roomId}/upgrade
   */
  @Post('room/:roomId/upgrade')
  @HttpCode(HttpStatus.OK)
  async upgradeTranscript(
    @Param('roomId') roomId: string,
    @Query('fromModel') fromModel?: string,
    @Query('toModel') toModel?: string,
    @Query('language') language?: string,
    @Query('participantId') participantId?: string
  ): Promise<{
    upgraded: boolean;
    oldModel: string;
    newModel: string;
    transcript: TranscriptResponseDto;
  }> {
    const oldModel = this.parseModel(fromModel);
    const newModel = this.parseModel(toModel || 'large-v3'); // Default to best model
    
    if (oldModel === newModel) {
      throw new BadRequestException('Target model must be different from current model');
    }

    const request: TranscriptRequestDto = {
      roomId,
      participantId,
      language: this.parseLanguage(language),
      model: newModel,
      format: ResponseFormat.DETAILED,
      useCache: true, // Save to cache after generation
      forceRegenerate: true // Skip reading old cache, but save new result
    };

    const transcript = await this.transcriptService.getTranscript(request);
    
    return {
      upgraded: true,
      oldModel,
      newModel,
      transcript
    };
  }

  /**
   * Clear cache for specific room/participant
   * DELETE /transcripts/room/{roomId}/cache
   */
  @Delete('room/:roomId/cache')
  @HttpCode(HttpStatus.OK)
  async clearCache(
    @Param('roomId') roomId: string,
    @Query('participantId') participantId?: string,
    @Query('language') language?: string,
    @Query('model') model?: string,
    @Query('format') format?: string
  ): Promise<{
    cleared: boolean;
    filesRemoved: number;
  }> {
    const result = await this.transcriptService.clearCache({
      roomId,
      participantId,
      language: language ? this.parseLanguage(language) : undefined,
      model: model ? this.parseModel(model) : undefined,
      format: format ? this.parseFormat(format) : undefined
    });

    return result;
  }

  /**
   * Legacy endpoint for backward compatibility
   */
  @Get(':id/room')
  async getTranscriptById(@Param('id') id: string) {
    return this.transcriptService.getTranscriptById(id);
  }

  // Helper methods for parsing query parameters

  private parseLanguage(language?: string): Language {
    if (!language) return Language.AUTO;
    
    const normalizedLang = language.toLowerCase();
    switch (normalizedLang) {
      case 'en':
      case 'english':
        return Language.EN;
      case 'vi':
      case 'vietnamese':
        return Language.VI;
      case 'auto':
      case 'detect':
        return Language.AUTO;
      default:
        return Language.AUTO;
    }
  }

  private parseModel(model?: string): WhisperModel {
    if (!model) return WhisperModel.BASE;
    
    const normalizedModel = model.toLowerCase().replace('-', '_');
    switch (normalizedModel) {
      case 'tiny':
        return WhisperModel.TINY;
      case 'base':
        return WhisperModel.BASE;
      case 'small':
        return WhisperModel.SMALL;
      case 'medium':
        return WhisperModel.MEDIUM;
      case 'large':
        return WhisperModel.LARGE;
      case 'large_v2':
      case 'largev2':
        return WhisperModel.LARGE_V2;
      case 'large_v3':
      case 'largev3':
        return WhisperModel.LARGE_V3;
      default:
        return WhisperModel.BASE;
    }
  }

  private parseFormat(format?: string): ResponseFormat {
    if (!format) return ResponseFormat.DETAILED;
    
    const normalizedFormat = format.toLowerCase();
    switch (normalizedFormat) {
      case 'raw':
      case 'raw_text':
      case 'text':
        return ResponseFormat.RAW_TEXT;
      case 'timestamped':
      case 'timestamp':
      case 'time':
        return ResponseFormat.TIMESTAMPED;
      case 'participants':
      case 'participant_separated':
      case 'separated':
        return ResponseFormat.PARTICIPANT_SEPARATED;
      case 'detailed':
      case 'full':
      case 'complete':
        return ResponseFormat.DETAILED;
      default:
        return ResponseFormat.DETAILED;
    }
  }
}
