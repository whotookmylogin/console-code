/**
 * Simple WebSocket test to diagnose connection issues
 */

import WebSocket, { WebSocketServer } from 'ws';

console.log('Testing WebSocket connection to Console Capture Pro...');

// Test if we can create a WebSocket server
try {
  const wss = new WebSocketServer({ port: 8765 });
  
  wss.on('listening', () => {
    console.log('✅ WebSocket server started successfully on port 8765');
    console.log('Port 8765 is available');
    
    // Test client connection
    const testClient = new WebSocket('ws://localhost:8765');
    
    testClient.on('open', () => {
      console.log('✅ WebSocket client connected successfully');
      testClient.send('{"type": "test", "message": "Hello from test client"}');
    });
    
    testClient.on('error', (error) => {
      console.error('❌ WebSocket client error:', error);
    });
    
    // Close after test
    setTimeout(() => {
      testClient.close();
      wss.close();
      console.log('🔹 Test completed');
    }, 2000);
  });
  
  wss.on('connection', (ws) => {
    console.log('✅ Client connected to test server');
    
    ws.on('message', (data) => {
      console.log('📨 Received:', data.toString());
    });
  });
  
  wss.on('error', (error) => {
    console.error('❌ WebSocket server error:', error);
    if (error.code === 'EADDRINUSE') {
      console.log('🔹 Port 8765 is already in use. This might be the issue.');
      console.log('🔹 Try stopping any running Console Capture servers.');
    }
  });
  
} catch (error) {
  console.error('❌ Failed to create WebSocket server:', error);
}