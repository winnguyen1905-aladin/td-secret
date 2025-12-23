#!/bin/bash
# User-level setup script for self-hosted Whisper transcription

echo "Setting up self-hosted Whisper transcription (user-level)..."

# Check if Python is available
if ! command -v python3 &> /dev/null; then
    echo "Error: Python 3 is not installed. Please install Python 3 first."
    exit 1
fi

echo "Python version: $(python3 --version)"

# Try different installation methods
echo "Attempting to install dependencies..."

# Method 1: Try pipx (recommended for user-level installations)
if command -v pipx &> /dev/null; then
    echo "Using pipx to install packages..."
    pipx install --include-deps faster-whisper
    echo "Installed faster-whisper via pipx"
else
    # Method 2: Try installing pip in user directory
    echo "Installing pip in user directory..."
    curl https://bootstrap.pypa.io/get-pip.py -o get-pip.py
    python3 get-pip.py --user
    rm get-pip.py
    
    # Add user pip to PATH if not already there
    export PATH="$HOME/.local/bin:$PATH"
    
    # Install packages with --user flag
    echo "Installing packages in user directory..."
    python3 -m pip install --user --upgrade pip
    python3 -m pip install --user faster-whisper torch torchaudio
    
    echo "Installed packages in user directory"
fi

# Check CUDA availability
echo "Checking CUDA availability..."
python3 -c "import torch; print('CUDA available:', torch.cuda.is_available())" 2>/dev/null || echo "CUDA check failed, but installation should still work"

# Make Python script executable
chmod +x "$(dirname "$0")/whisper_transcriber.py"

# Create wrapper script that ensures user packages are available
cat > "$(dirname "$0")/run_whisper.sh" << 'EOF'
#!/bin/bash
# Wrapper script that ensures user packages are in PATH
SCRIPT_DIR="$(dirname "$0")"
export PATH="$HOME/.local/bin:$PATH"
export PYTHONPATH="$HOME/.local/lib/python*/site-packages:$PYTHONPATH"
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
echo ""
echo "If you get 'module not found' errors, add this to your ~/.bashrc or ~/.zshrc:"
echo "  export PATH=\"\$HOME/.local/bin:\$PATH\""
