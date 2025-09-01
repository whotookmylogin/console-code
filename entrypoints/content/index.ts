/**
 * Content script for ConsoleCapture Pro extension
 * Advanced console interception with CaptureEngine integration
 */

import { CaptureEngine } from '../../src/capture/CaptureEngine.js';
import { EventBus } from '../../src/core/EventBus.js';
import { SecurityEngine } from '../../src/security/SecurityEngine.js';
import type { CaptureSession, ExtensionConfig } from '../../src/types/index.js';

export default defineContentScript({
  matches: ['<all_urls>', 'http://localhost:*/*', 'https://localhost:*/*'],
  runAt: 'document_start',
  main: async () => {
    console.log('ConsoleCapture Pro content script injected at:', window.location.href);

    // Initialize core components
    const eventBus = new EventBus();
    const securityEngine = new SecurityEngine();
    const captureEngine = new CaptureEngine(eventBus, securityEngine);

    // Default configuration
    const defaultConfig: ExtensionConfig = {
      captureEnabled: true,
      capturedLevels: ['log', 'warn', 'error', 'info'],
      maxLogsRetained: 1000,
      autoCaptureOnLoad: false,
      privacy: {
        enablePIIDetection: true,
        piiSensitivity: 0.8,
        autoSanitize: true,
        dataRetentionHours: 720 // 30 days
      },
      performance: {
        enableMonitoring: true,
        throttleMs: 0,
        maxMemoryMB: 50
      },
      export: {
        defaultFormat: 'json',
        includeMetadata: true
      }
    };

    let currentSession: CaptureSession | null = null;

    try {
      // Initialize capture engine
      await captureEngine.initialize();
      captureEngine.updateConfig(defaultConfig);

      // Forward logs to background script for VSCode integration
      eventBus.on('capture:log-captured', (event: any) => {
        const activeSession = captureEngine.getCurrentSession();
        if (activeSession) {
          chrome.runtime.sendMessage({
            type: 'logs:forward',
            payload: {
              logs: [activeSession.logs[activeSession.logs.length - 1]] // Send the latest log
            }
          }).catch(() => {
            // Ignore errors if background script isn't ready
          });
        }
      });
    } catch (error) {
      console.error('Failed to initialize ConsoleCapture Pro:', error);
    }

    // Message handling
    chrome.runtime.onMessage.addListener(async (message, _sender, sendResponse) => {
      const { type } = message;

      try {
        switch (type) {
          case 'capture:start':
            currentSession = await captureEngine.startSession();
            sendResponse({ 
              success: true, 
              session: {
                id: currentSession.id,
                startTime: currentSession.startTime,
                logs: currentSession.logs
              }
            });
            return true;

          case 'capture:stop':
            const stoppedSession = await captureEngine.stopSession();
            currentSession = null;
            sendResponse({ 
              success: true, 
              session: stoppedSession ? {
                id: stoppedSession.id,
                startTime: stoppedSession.startTime,
                endTime: stoppedSession.endTime,
                logs: stoppedSession.logs
              } : null
            });
            return true;

          case 'capture:status':
            const isCapturing = captureEngine.isCapturing();
            const activeSession = captureEngine.getCurrentSession();
            sendResponse({ 
              success: true, 
              status: { 
                isCapturing, 
                currentSession: activeSession ? {
                  id: activeSession.id,
                  logs: activeSession.logs,
                  metadata: activeSession.metadata
                } : null 
              }
            });
            return true;

          case 'ping':
            sendResponse({ 
              success: true, 
              message: 'ConsoleCapture Pro content script active',
              url: window.location.href,
              initialized: true
            });
            return true;

          default:
            sendResponse({ success: false, error: 'Unknown message type' });
            return true;
        }
      } catch (error) {
        console.error('ConsoleCapture Pro message handling error:', error);
        sendResponse({ 
          success: false, 
          error: error instanceof Error ? error.message : 'Unknown error' 
        });
        return true;
      }
    });
  }
});