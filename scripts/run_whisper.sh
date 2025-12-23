#!/bin/bash
# Simple wrapper script to run Whisper
SCRIPT_DIR="$(dirname "$0")"
python3 "$SCRIPT_DIR/whisper_transcriber.py" "$@"
