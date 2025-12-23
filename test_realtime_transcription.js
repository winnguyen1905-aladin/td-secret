#!/usr/bin/env node
// Test script to simulate real-time transcription

const fs = require('fs');
const path = require('path');

async function testRealtimeTranscription() {
  console.log('🧪 Testing Real-time Transcription...\n');
  
  // Simulate copying an existing audio file to trigger the file watcher
  const sourceFile = 'temp/audio-segments/8d2-da23-8e8/5e537b45-3869-440c-b621-8c7056016c36_segment_001.wav';
  const testRoomId = 'test-room-' + Date.now().toString().slice(-3);
  const testParticipantId = 'test-participant-' + Math.random().toString(36).slice(-8);
  
  // Create test directory
  const testDir = `temp/audio-segments/${testRoomId}`;
  fs.mkdirSync(testDir, { recursive: true });
  
  // Copy file to simulate new segment creation
  const targetFile = path.join(testDir, `${testParticipantId}_segment_000.wav`);
  
  console.log(`📁 Creating test room: ${testRoomId}`);
  console.log(`👤 Test participant: ${testParticipantId}`);
  console.log(`📄 Copying audio file to: ${targetFile}`);
  
  if (fs.existsSync(sourceFile)) {
    fs.copyFileSync(sourceFile, targetFile);
    console.log('✅ Audio file copied successfully');
    console.log(`\n🔍 File should now be detected by the service's file watcher`);
    console.log('📊 Check your service logs for transcription processing...');
    
    // Display file info
    const stats = fs.statSync(targetFile);
    console.log(`📈 File size: ${(stats.size / 1024).toFixed(1)}KB`);
    console.log(`⏰ Created: ${stats.birthtime.toLocaleString()}`);
  } else {
    console.log('❌ Source audio file not found:', sourceFile);
    console.log('🔄 Try starting a new audio session to generate segments');
  }
  
  console.log('\n🎯 What to expect in service logs:');
  console.log('  - "Processing new audio segment: ..."');
  console.log('  - "Loading Whisper model: large-v3 on cpu"');
  console.log('  - "✅ Transcription completed for ... segment 0: ..."');
  
  console.log('\n🔧 If no logs appear, restart your service to apply the file watcher updates.');
}

testRealtimeTranscription().catch(console.error);
