#!/bin/bash
# Simple setup script for self-hosted Whisper transcription (works with externally managed environments)

echo "Setting up self-hosted Whisper transcription..."

# Check if Python is available
if ! command -v python3 &> /dev/null; then
    echo "Error: Python 3 is not installed. Please install Python 3 first."
    exit 1
fi

echo "Python version: $(python3 --version)"

# Install pip if not available (using system packages)
if ! python3 -m pip --version &> /dev/null; then
    echo "Installing pip..."
    # Try to install pip using apt first
    if command -v apt &> /dev/null; then
        sudo apt update && sudo apt install -y python3-pip python3-venv
    else
        # Fallback to get-pip.py with --break-system-packages
        curl https://bootstrap.pypa.io/get-pip.py -o get-pip.py
        python3 get-pip.py --break-system-packages
        rm get-pip.py
    fi
fi

# Install Python dependencies with --break-system-packages
echo "Installing Python dependencies..."
python3 -m pip install --break-system-packages --upgrade pip
python3 -m pip install --break-system-packages faster-whisper torch torchaudio

# Check CUDA availability (optional)
echo "Checking CUDA availability..."
python3 -c "import torch; print('CUDA available:', torch.cuda.is_available())" 2>/dev/null || echo "CUDA check failed, but installation should still work"

# Make Python script executable
chmod +x "$(dirname "$0")/whisper_transcriber.py"

# Create a simple wrapper script
cat > "$(dirname "$0")/run_whisper.sh" << 'EOF'
#!/bin/bash
# Simple wrapper script to run Whisper
SCRIPT_DIR="$(dirname "$0")"
python3 "$SCRIPT_DIR/whisper_transcriber.py" "$@"
EOF

chmod +x "$(dirname "$0")/run_whisper.sh"

echo ""
echo "Setup completed!"
echo ""
echo "Available Whisper models:"
echo "- tiny: Fastest, lowest accuracy (~39 MB)"
echo "- base: Good balance (~147 MB)" 
echo "- small: Better accuracy (~466 MB)"
echo "- medium: High accuracy (~1.5 GB)"
echo "- large-v2/large-v3: Best accuracy (~3 GB)"
echo ""
echo "Models will be downloaded automatically on first use."
echo ""
echo "To test the setup, run:"
echo "  ./scripts/run_whisper.sh --help"
echo ""
echo "To transcribe an audio file:"
echo "  ./scripts/run_whisper.sh your-audio-file.wav --model base --language vi"
