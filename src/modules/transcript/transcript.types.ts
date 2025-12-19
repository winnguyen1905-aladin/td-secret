export enum Language {
    EN = 'en',
    VI = 'vi',
    AUTO = 'auto', // Auto-detect language
}

export enum WhisperModel {
    TINY = 'tiny',
    BASE = 'base', 
    SMALL = 'small',
    MEDIUM = 'medium',
    LARGE = 'large',
    LARGE_V2 = 'large-v2',
    LARGE_V3 = 'large-v3',
}

export enum ResponseFormat {
    RAW_TEXT = 'raw_text',           // All text concatenated
    TIMESTAMPED = 'timestamped',     // Text with timestamps
    PARTICIPANT_SEPARATED = 'participant_separated', // Grouped by participant
    DETAILED = 'detailed',           // Full segments with confidence scores
}

export interface TranscriptRequestDto {
    roomId: string;
    participantId?: string;          // Optional: specific participant
    language?: Language;             // Default: auto
    model?: WhisperModel;           // Default: base
    format?: ResponseFormat;        // Default: detailed
    useCache?: boolean;             // Default: true
    forceRegenerate?: boolean;      // Default: false
}

export interface WhisperSegment {
    start: number;
    end: number;
    text: string;
    avg_logprob: number;
    no_speech_prob: number;
}

export interface WhisperResult {
    text: string;
    language: string;
    language_probability: number;
    duration: number;
    confidence: number;
    segments: WhisperSegment[];
    success: boolean;
}

export interface ParticipantTranscript {
    participantId: string;
    displayName: string;
    segments: TranscriptSegment[];
    totalDuration: number;
    confidence: number;
}

export interface TranscriptSegment {
    segmentNumber: number;
    fileName: string;
    start: number;
    end: number;
    text: string;
    confidence: number;
    whisperSegments: WhisperSegment[];
}

export interface TranscriptResponseDto {
    roomId: string;
    participantId?: string;
    format: ResponseFormat;
    language: string;
    model: WhisperModel;
    generatedAt: Date;
    cached: boolean;
    
    // Response data based on format
    rawText?: string;
    timestampedText?: Array<{
        timestamp: string;
        text: string;
        participant: string;
    }>;
    participants?: ParticipantTranscript[];
    detailed?: {
        participants: ParticipantTranscript[];
        totalDuration: number;
        averageConfidence: number;
        processingTime: number;
    };
}

export interface CachedTranscript {
    roomId: string;
    participantId?: string;
    language: Language;
    model: WhisperModel;
    format: ResponseFormat;
    filePath: string;
    generatedAt: Date;
    audioSegmentCount: number;
    totalDuration: number;
}