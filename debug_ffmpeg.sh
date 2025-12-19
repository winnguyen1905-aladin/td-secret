#!/bin/bash
# Debug FFmpeg segmentation with list creation

TEST_DIR="./temp/audio-segments/test"
mkdir -p "$TEST_DIR"

# Create a test SDP file
cat > "$TEST_DIR/test.sdp" << 'EOF'
v=0
o=- 0 0 IN IP4 127.0.0.1
s=FFmpeg
c=IN IP4 127.0.0.1
t=0 0
m=audio 12345 RTP/AVP 100
a=rtpmap:100 opus/48000/2
EOF

# Test FFmpeg command (similar to what the service uses)
echo "Testing FFmpeg segmentation with list creation..."
ffmpeg -f lavfi -i "sine=frequency=1000:duration=10" \
  -acodec pcm_s16le \
  -ar 16000 \
  -ac 1 \
  -f segment \
  -segment_time 30 \
  -segment_format wav \
  -reset_timestamps 1 \
  -segment_list "$TEST_DIR/test_segments.txt" \
  -segment_list_type flat \
  "$TEST_DIR/test_segment_%03d.wav" -y

echo "Checking results..."
echo "Files created:"
ls -la "$TEST_DIR/"
echo ""
echo "Segment list content:"
if [ -f "$TEST_DIR/test_segments.txt" ]; then
    cat "$TEST_DIR/test_segments.txt"
else
    echo "ERROR: Segment list file not created!"
fi
