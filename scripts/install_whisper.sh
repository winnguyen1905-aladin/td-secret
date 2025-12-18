#!/bin/bash
# Direct installation using --break-system-packages (safe for this use case)

echo "Installing Whisper dependencies..."

# Install pip first
curl https://bootstrap.pypa.io/get-pip.py -o get-pip.py
python3 get-pip.py --break-system-packages
rm get-pip.py

# Install the required packages
python3 -m pip install --break-system-packages faster-whisper torch torchaudio

echo "Installation completed!"
echo ""
echo "Test the installation:"
python3 -c "import faster_whisper; print('faster-whisper installed successfully')"
