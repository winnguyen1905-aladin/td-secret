FROM python:3.11-slim

# Install system dependencies
RUN apt-get update && apt-get install -y \
    ffmpeg \
    && rm -rf /var/lib/apt/lists/*

# Install Python dependencies
RUN pip install --no-cache-dir faster-whisper torch torchaudio

# Create a non-root user
RUN useradd -m -u 1000 whisper
USER whisper

# Create directories for input/output
WORKDIR /app
RUN mkdir -p /app/input /app/output

# Copy the transcriber script
COPY whisper_transcriber.py /app/

# Make the script executable
RUN chmod +x /app/whisper_transcriber.py

# Set the entrypoint
ENTRYPOINT ["python3", "/app/whisper_transcriber.py"]
