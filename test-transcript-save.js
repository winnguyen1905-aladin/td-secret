const fs = require('fs');
const path = require('path');

// Test to verify transcript directory structure and file format
async function testTranscriptSaving() {
  const transcriptDir = './temp/transcripts';
  
  // Check if transcript directory exists
  if (fs.existsSync(transcriptDir)) {
    console.log('✓ Transcript directory exists:', transcriptDir);
    
    // List all transcript files
    const files = fs.readdirSync(transcriptDir);
    console.log('\nTranscript files found:', files.length);
    
    if (files.length > 0) {
      // Read and display the first transcript file as example
      const firstFile = files[0];
      const filePath = path.join(transcriptDir, firstFile);
      const content = fs.readFileSync(filePath, 'utf-8');
      const transcript = JSON.parse(content);
      
      console.log('\nSample transcript structure:');
      console.log('- Room ID:', transcript.roomId);
      console.log('- Participant ID:', transcript.participantId);
      console.log('- Session Start:', transcript.sessionStartTime);
      console.log('- Session End:', transcript.sessionEndTime);
      console.log('- Total Segments:', transcript.totalSegments);
      console.log('- First segment text:', transcript.segments[0]?.text || 'No segments');
    }
  } else {
    console.log('✗ Transcript directory does not exist');
  }
}

// Run the test
testTranscriptSaving().catch(console.error);
