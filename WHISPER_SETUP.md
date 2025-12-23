# Self-Hosted Whisper Setup Guide

## Quick Setup (Recommended)

Since your system has externally managed Python environment, use this one-liner:

```bash
curl https://bootstrap.pypa.io/get-pip.py -o get-pip.py && python3 get-pip.py --break-system-packages && rm get-pip.py && python3 -m pip install --break-system-packages faster-whisper torch torchaudio
```

## Why --break-system-packages is Safe Here

The `--break-system-packages` flag is safe for this use case because:
- `faster-whisper`, `torch`, and `torchaudio` don't conflict with system packages
- We're installing user-level packages that won't affect system Python
- Modern Ubuntu/Debian systems use this flag to prevent accidental system package conflicts

## Test Installation

After installation, test with:

```bash
python3 -c "import faster_whisper; print('✓ faster-whisper installed successfully')"
```

## Available Models

- **tiny** (39MB) - Fastest, good for testing
- **base** (147MB) - Recommended balance ⭐
- **small** (466MB) - Better accuracy
- **medium** (1.5GB) - High accuracy
- **large-v2/large-v3** (3GB) - Best accuracy

Models download automatically on first use.

## Configuration

Your service is configured to use:
- Model: `base` (change in `streaming-stt.service.ts`)
- Device: `cpu` (use `cuda` if you have GPU)
- Language: `vi` (Vietnamese)

## Troubleshooting

### If you get "module not found" errors:
1. Make sure you installed with `--break-system-packages`
2. Try running the installation command again
3. Check if Python path is correct: `which python3`

### To change model:
Edit `src/modules/streaming/streaming-stt.service.ts`:
```typescript
whisperModel: 'base', // Change to 'tiny', 'small', etc.
```

### To use GPU (if available):
```typescript
whisperDevice: 'cuda', // Change from 'cpu'
```

## Manual Test

Test transcription with an audio file:
```bash
python3 scripts/whisper_transcriber.py your-audio.wav --model base --language vi
```
