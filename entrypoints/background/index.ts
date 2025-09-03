/**
 * Background script for ConsoleCapture Pro extension
 * Manages extension lifecycle and basic communication
 */

import { defineBackground } from 'wxt/sandbox';

export default defineBackground(() => {
  console.log('ConsoleCapture Pro background script started');

  let vscodeWebSocket: WebSocket | null = null;
  let currentSessionId: string | null = null;

  // Connect to VSCode extension WebSocket server
  function connectToVSCode() {
    try {
      vscodeWebSocket = new WebSocket('ws://localhost:8765');
      
      vscodeWebSocket.onopen = () => {
        console.log('Connected to VSCode Console Capture extension');
        currentSessionId = `session-${Date.now()}`;
        
        // Send session start message
        vscodeWebSocket?.send(JSON.stringify({
          type: 'session:start',
          url: 'Browser Extension',
          timestamp: new Date().toISOString(),
          userAgent: navigator.userAgent
        }));
      };

      vscodeWebSocket.onclose = () => {
        console.log('Disconnected from VSCode Console Capture extension');
        vscodeWebSocket = null;
        currentSessionId = null;
        
        // Try to reconnect after 5 seconds
        setTimeout(connectToVSCode, 5000);
      };

      vscodeWebSocket.onerror = (error) => {
        console.log('VSCode WebSocket error:', error);
      };

    } catch (error) {
      console.log('Failed to connect to VSCode:', error);
      setTimeout(connectToVSCode, 5000);
    }
  }

  // Function to send log to VSCode
  function sendLogToVSCode(logEntry: any) {
    if (vscodeWebSocket?.readyState === WebSocket.OPEN) {
      vscodeWebSocket.send(JSON.stringify({
        type: 'log:entry',
        level: logEntry.level,
        message: logEntry.message,
        timestamp: logEntry.timestamp?.toISOString() || new Date().toISOString(),
        url: logEntry.url || 'Unknown',
        stackTrace: logEntry.stackTrace,
        sourceInfo: logEntry.source
      }));
    }
  }

  // Try to connect to VSCode on startup
  connectToVSCode();

  // Handle extension installation
  chrome.runtime.onInstalled.addListener((details) => {
    console.log('ConsoleCapture Pro installed:', details.reason);
  });

  // Handle messages from content scripts and popup
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    console.log('Background received message:', message);
    
    const { type, payload } = message;

    switch (type) {
      case 'logs:forward':
        // Forward captured logs to VSCode
        if (payload?.logs && Array.isArray(payload.logs)) {
          payload.logs.forEach((log: any) => sendLogToVSCode(log));
        }
        sendResponse({ success: true });
        break;
      case 'ping':
        sendResponse({ success: true, message: 'Background script alive' });
        break;

      case 'websocket:status':
        // Return the current WebSocket connection status
        const wsState = vscodeWebSocket?.readyState;
        let websocketStatus = 'disconnected';

        if (wsState === WebSocket.OPEN) {
          websocketStatus = 'connected';
        } else if (wsState === WebSocket.CONNECTING) {
          websocketStatus = 'connecting';
        }

        sendResponse({
          success: true,
          websocketStatus,
          sessionId: currentSessionId
        });
        break;

      case 'config:get':
        // Return default config for now
        sendResponse({
          success: true,
          config: {
            capturedLevels: ['error', 'warn', 'info', 'log'],
            privacy: { enablePIIDetection: true },
            performance: { maxMemoryMB: 50, throttleMs: 100 }
          }
        });
        break;

      case 'open-popup':
        // Try to open the extension popup
        try {
          chrome.action.openPopup().then(() => {
            sendResponse({ success: true });
          }).catch((error) => {
            console.log('Could not open popup:', error);
            sendResponse({ success: false, error: error.message });
          });
        } catch (error) {
          console.log('openPopup not available:', error);
          sendResponse({ success: false, error: 'openPopup not available' });
        }
        break;

      default:
        console.warn('Unknown message type:', type);
        sendResponse({ success: false, error: 'Unknown message type' });
    }
    
    return true; // Keep message channel open for async response
  });
});
