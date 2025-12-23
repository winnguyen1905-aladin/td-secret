#!/usr/bin/env python3
"""
Whisper Transcription Script
Transcribes audio files using OpenAI's Whisper model
"""

import argparse
import json
import sys
import os
import time
from typing import Dict, List, Any
import warnings

# Suppress warnings
warnings.filterwarnings("ignore")

try:
    import whisper
    import torch
except ImportError as e:
    print(f"Error: Missing required dependencies. Please install: pip install openai-whisper torch", file=sys.stderr)
    sys.exit(1)

def load_model(model_name: str, device: str = None) -> whisper.Whisper:
    """Load Whisper model with error handling"""
    try:
        if device is None:
            device = "cuda" if torch.cuda.is_available() else "cpu"
        
        print(f"Loading Whisper model: {model_name} on {device}", file=sys.stderr)
        model = whisper.load_model(model_name, device=device)
        print("Model loaded successfully", file=sys.stderr)
        return model
    except Exception as e:
        print(f"Error loading model: {e}", file=sys.stderr)
        sys.exit(1)

def transcribe_audio(
    model: whisper.Whisper, 
    audio_path: str, 
    language: str = None,
    temperature: float = 0.0,
    best_of: int = 5,
    beam_size: int = 5
) -> Dict[str, Any]:
    """Transcribe audio file and return structured result"""
    try:
        print(f"Transcribing: {audio_path}", file=sys.stderr)
        
        # Prepare transcription options
        options = {
            "temperature": temperature,
            "best_of": best_of,
            "beam_size": beam_size,
            "fp16": False,  # Use fp32 for better compatibility
        }
        
        if language and language.lower() != 'auto':
            options["language"] = language
        
        # Transcribe
        result = model.transcribe(audio_path, **options)
        
        # Calculate confidence score from segments
        confidence = 0.0
        total_duration = 0.0
        
        if result.get("segments"):
            for segment in result["segments"]:
                segment_duration = segment["end"] - segment["start"]
                # Use avg_logprob as confidence proxy (convert from log space)
                segment_confidence = min(1.0, max(0.0, (segment.get("avg_logprob", -1.0) + 1.0)))
                confidence += segment_confidence * segment_duration
                total_duration += segment_duration
            
            if total_duration > 0:
                confidence = confidence / total_duration
        else:
            # Fallback if no segments
            confidence = 0.5
        
        # Structure the response
        structured_result = {
            "text": result.get("text", "").strip(),
            "language": result.get("language", language or "unknown"),
            "language_probability": getattr(result, 'language_probs', {}).get(result.get("language", "en"), 1.0) if hasattr(result, 'language_probs') else 1.0,
            "duration": total_duration if total_duration > 0 else 30.0,  # Fallback duration
            "confidence": confidence,
            "segments": [
                {
                    "start": seg["start"],
                    "end": seg["end"],
                    "text": seg["text"].strip(),
                    "avg_logprob": seg.get("avg_logprob", -1.0),
                    "no_speech_prob": seg.get("no_speech_prob", 0.0)
                }
                for seg in result.get("segments", [])
            ],
            "success": True
        }
        
        print(f"Transcription completed. Text: {structured_result['text'][:100]}...", file=sys.stderr)
        return structured_result
        
    except Exception as e:
        print(f"Error during transcription: {e}", file=sys.stderr)
        return {
            "text": "",
            "language": language or "unknown",
            "language_probability": 0.0,
            "duration": 0.0,
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
    parser.add_argument('--device', default=None,
                       choices=['cpu', 'cuda'],
                       help='Device to use (auto-detect if not specified)')
    parser.add_argument('--temperature', type=float, default=0.0,
                       help='Temperature for sampling')
    parser.add_argument('--best_of', type=int, default=5,
                       help='Number of candidates when temperature > 0')
    parser.add_argument('--beam_size', type=int, default=5,
                       help='Beam size for beam search')
    
    args = parser.parse_args()
    
    # Validate input file
    if not os.path.exists(args.audio_file):
        print(f"Error: Audio file not found: {args.audio_file}", file=sys.stderr)
        sys.exit(1)
    
    # Load model
    model = load_model(args.model, args.device)
    
    # Transcribe
    language = args.language if args.language != 'auto' else None
    result = transcribe_audio(
        model=model,
        audio_path=args.audio_file,
        language=language,
        temperature=args.temperature,
        best_of=args.best_of,
        beam_size=args.beam_size
    )
    
    # Output result
    if args.output_format == 'json':
        print(json.dumps(result, indent=2, ensure_ascii=False))
    else:
        print(result.get("text", ""))
    
    # Exit with appropriate code
    sys.exit(0 if result["success"] else 1)

if __name__ == "__main__":
    main()
