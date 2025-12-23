#!/bin/bash
# Setup script for self-hosted Whisper transcription using virtual environment

echo "Setting up self-hosted Whisper transcription with virtual environment..."

# Check if Python is available
if ! command -v python3 &> /dev/null; then
    echo "Error: Python 3 is not installed. Please install Python 3 first."
    exit 1
fi

echo "Python version: $(python3 --version)"

# Create virtual environment
VENV_DIR="$(dirname "$0")/venv"
if [ ! -d "$VENV_DIR" ]; then
    echo "Creating virtual environment..."
    python3 -m venv "$VENV_DIR"
fi

# Activate virtual environment
echo "Activating virtual environment..."
source "$VENV_DIR/bin/activate"

# Upgrade pip
echo "Upgrading pip..."
pip install --upgrade pip

# Install Python dependencies
echo "Installing Python dependencies..."
pip install faster-whisper torch torchaudio

# Check CUDA availability (optional)
echo "Checking CUDA availability..."
python -c "import torch; print('CUDA available:', torch.cuda.is_available())" 2>/dev/null || echo "CUDA check failed, but installation should still work"

# Make Python script executable
chmod +x "$(dirname "$0")/whisper_transcriber.py"

# Create a wrapper script that uses the virtual environment
cat > "$(dirname "$0")/run_whisper.sh" << 'EOF'
#!/bin/bash
# Wrapper script to run Whisper with the virtual environment
SCRIPT_DIR="$(dirname "$0")"
source "$SCRIPT_DIR/venv/bin/activate"
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
