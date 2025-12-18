#!/bin/bash
# Setup script for self-hosted Whisper transcription

echo "Setting up self-hosted Whisper transcription..."

# Check if Python is available
if ! command -v python3 &> /dev/null; then
    echo "Error: Python 3 is not installed. Please install Python 3 first."
    exit 1
fi

echo "Python version: $(python3 --version)"

# Install pip if not available
if ! python3 -m pip --version &> /dev/null; then
    echo "Installing pip..."
    curl https://bootstrap.pypa.io/get-pip.py -o get-pip.py
    python3 get-pip.py
    rm get-pip.py
fi

# Install Python dependencies
echo "Installing Python dependencies..."
python3 -m pip install --upgrade pip
python3 -m pip install faster-whisper torch torchaudio

# Check CUDA availability (optional)
echo "Checking CUDA availability..."
if python3 -c "import torch; print('CUDA available:', torch.cuda.is_available())" 2>/dev/null; then
    echo "CUDA detection completed"
else
    echo "PyTorch not yet installed, CUDA check will be available after installation"
fi

# Make Python script executable
chmod +x "$(dirname "$0")/whisper_transcriber.py"

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
echo "To test the setup, run:"
echo "python3 $(dirname "$0")/whisper_transcriber.py --help"
