#!/usr/bin/env python3
"""
Self-hosted Whisper transcription script
Requires: faster-whisper, torch, torchaudio
Install with: python3 -m pip install faster-whisper torch torchaudio
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
    def __init__(self, model_size="large-v3", device="cpu", compute_type="float32"):
        """
        Initialize the Whisper transcriber
        
        Args:
            model_size: "tiny", "base", "small", "medium", "large-v2", "large-v3"
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
        Transcribe audio file
        Args:
            audio_file_path: Path to audio file
            language: Language code (e.g., 'vi', 'en') or None for auto-detection  
        Returns:
            dict: Transcription result with text, language, confidence, etc.
        """
        try:
            if not os.path.exists(audio_file_path):
                raise FileNotFoundError(f"Audio file not found: {audio_file_path}")
            
            print(f"Transcribing: {audio_file_path}", file=sys.stderr)
            
            # Transcribe with faster-whisper
            segments, info = self.model.transcribe(
                audio_file_path,
                language=language,
                beam_size=5,
                word_timestamps=True
            )
            
            # Collect segments
            transcription_segments = []
            full_text = ""
            total_duration = 0
            avg_confidence = 0
            segment_count = 0
            
            for segment in segments:
                segment_text = segment.text.strip()
                if segment_text:  # Only include non-empty segments
                    full_text += segment_text + " "
                    total_duration = max(total_duration, segment.end)
                    avg_confidence += segment.avg_logprob
                    segment_count += 1
                    
                    transcription_segments.append({
                        "start": segment.start,
                        "end": segment.end,
                        "text": segment_text,
                        "avg_logprob": segment.avg_logprob,
                        "no_speech_prob": segment.no_speech_prob
                    })
            
            # Calculate average confidence
            if segment_count > 0:
                avg_confidence = avg_confidence / segment_count
                # Convert log probability to confidence (0-1)
                confidence = min(1.0, max(0.0, (avg_confidence + 5) / 5))  # Approximate conversion
            else:
                confidence = 0.0
            
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
                "language": "unknown",
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
    parser.add_argument('--model', default='base', help='Whisper model size (tiny, base, small, medium, large-v2, large-v3)')
    parser.add_argument('--language', help='Language code (e.g., vi, en)')
    parser.add_argument('--device', default='cpu', help='Device (cpu, cuda, auto)')
    parser.add_argument('--compute-type', default='int8', help='Compute type (int8, int16, float16, float32)')
    
    args = parser.parse_args()
    
    # Create transcriber
    transcriber = WhisperTranscriber(
        model_size=args.model,
        device=args.device,
        compute_type=args.compute_type
    )
    
    # Transcribe
    result = transcriber.transcribe(args.audio_file, args.language)
    
    # Output JSON result
    print(json.dumps(result, ensure_ascii=False, indent=2))

if __name__ == "__main__":
    main()