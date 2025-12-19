#!/usr/bin/env python3
"""
Self-hosted Whisper transcription script
Uses faster-whisper for optimal performance
"""

import sys
import json
import os
import argparse
from pathlib import Path

try:
    from faster_whisper import WhisperModel
except ImportError:
    print("Error: faster-whisper not installed. Please run: python3 -m pip install faster-whisper torch torchaudio", file=sys.stderr)
    sys.exit(1)

class WhisperTranscriber:
    def __init__(self, model_size="base", device="cpu", compute_type="float32"):
        """
        Initialize the Whisper transcriber
        
        Args:
            model_size: "tiny", "base", "small", "medium", "large", "large-v2", "large-v3"
            device: "cpu", "cuda", "auto"
            compute_type: "int8", "int16", "float16", "float32"
        """
        self.model_size = model_size
        self.device = device
        self.compute_type = compute_type
        self.model = None
        self._load_model()
    
    def _load_model(self):
        """Load the Whisper model"""
        try:
            print(f"Loading Whisper model: {self.model_size} on {self.device}", file=sys.stderr)
            self.model = WhisperModel(
                self.model_size, 
                device=self.device, 
                compute_type=self.compute_type
            )
            print("Model loaded successfully", file=sys.stderr)
        except Exception as e:
            print(f"Error loading model: {e}", file=sys.stderr)
            sys.exit(1)
    
    def transcribe(self, audio_file_path, language=None):
        """
        Transcribe audio file and return structured result
        
        Args:
            audio_file_path: Path to the audio file
            language: Language code (e.g., 'vi', 'en') or None for auto-detection
            
        Returns:
            Dict with transcription results
        """
        try:
            print(f"Transcribing: {audio_file_path}", file=sys.stderr)
            
            # Set up transcription parameters
            segments, info = self.model.transcribe(
                audio_file_path, 
                language=language if language and language != 'auto' else None,
                beam_size=5,
                best_of=5,
                temperature=0.0
            )
            
            # Convert segments to list and calculate metrics
            segments_list = list(segments)  # Convert generator to list first
            transcription_segments = []
            full_text = ""
            total_duration = 0.0
            confidence_sum = 0.0
            segment_count = 0
            
            print(f"Processing {len(segments_list)} segments", file=sys.stderr)
            
            if len(segments_list) == 0:
                # Handle case where no speech is detected
                print("No speech detected in audio file", file=sys.stderr)
                total_duration = info.duration if hasattr(info, 'duration') else 30.0
            else:
                for segment in segments_list:
                    segment_data = {
                        "start": segment.start,
                        "end": segment.end,
                        "text": segment.text.strip(),
                        "avg_logprob": segment.avg_logprob,
                        "no_speech_prob": segment.no_speech_prob
                    }
                    transcription_segments.append(segment_data)
                    full_text += segment.text
                    total_duration = max(total_duration, segment.end)
                    
                    # Calculate confidence from avg_logprob (convert from log space)
                    segment_confidence = min(1.0, max(0.0, (segment.avg_logprob + 1.0)))
                    confidence_sum += segment_confidence
                    segment_count += 1
            
            # Calculate overall confidence
            confidence = confidence_sum / segment_count if segment_count > 0 else 0.0
            
            result = {
                "text": full_text.strip(),
                "language": info.language,
                "language_probability": info.language_probability,
                "duration": total_duration,
                "confidence": confidence,
                "segments": transcription_segments,
                "success": True
            }
            
            print(f"Transcription completed. Text: {result['text'][:100]}...", file=sys.stderr)
            return result
            
        except Exception as e:
            print(f"Transcription error: {e}", file=sys.stderr)
            return {
                "text": "",
                "language": language or "unknown",
                "language_probability": 0.0,
                "duration": 0,
                "confidence": 0.0,
                "segments": [],
                "success": False,
                "error": str(e)
            }

def main():
    parser = argparse.ArgumentParser(description='Transcribe audio using Whisper')
    parser.add_argument('audio_file', help='Path to audio file')
    parser.add_argument('--model', default='base', 
                       choices=['tiny', 'base', 'small', 'medium', 'large', 'large-v2', 'large-v3'],
                       help='Whisper model to use')
    parser.add_argument('--language', default='auto', 
                       help='Language code (auto for auto-detection)')
    parser.add_argument('--output_format', default='json', 
                       choices=['json', 'text'],
                       help='Output format')
    parser.add_argument('--device', default='cpu',
                       choices=['cpu', 'cuda', 'auto'],
                       help='Device to use')
    parser.add_argument('--compute_type', default='float32',
                       choices=['int8', 'int16', 'float16', 'float32'],
                       help='Compute type for inference')
    
    args = parser.parse_args()
    
    # Validate input file
    if not os.path.exists(args.audio_file):
        print(f"Error: Audio file not found: {args.audio_file}", file=sys.stderr)
        sys.exit(1)
    
    # Initialize transcriber
    transcriber = WhisperTranscriber(
        model_size=args.model,
        device=args.device,
        compute_type=args.compute_type
    )
    
    # Transcribe
    language = args.language if args.language != 'auto' else None
    result = transcriber.transcribe(args.audio_file, language=language)
    
    # Output result
    if args.output_format == 'json':
        print(json.dumps(result, indent=2, ensure_ascii=False))
    else:
        print(result.get("text", ""))
    
    # Exit with appropriate code
    sys.exit(0 if result["success"] else 1)

if __name__ == "__main__":
    main()
