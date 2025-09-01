/**
 * Extension Manager - Core orchestration class for ConsoleCapture Pro
 * Manages the lifecycle and coordination of all extension components
 */

import type { ExtensionConfig, CaptureSession, ExtensionError } from '../types';
import { ConfigManager } from './ConfigManager';
import { StorageManager } from './StorageManager';
import { EventBus } from './EventBus';
import { CaptureEngine } from '../capture/CaptureEngine';
import { SecurityEngine } from '../security/SecurityEngine';
import { ExportManager } from '../export/ExportManager';

/**
 * Main extension manager that coordinates all subsystems
 */
export class ExtensionManager {
  private configManager: ConfigManager;
  private storageManager: StorageManager;
  private eventBus: EventBus;
  private captureEngine: CaptureEngine;
  private securityEngine: SecurityEngine;
  private exportManager: ExportManager;
  private isInitialized: boolean = false;

  /**
   * Creates a new ExtensionManager instance
   */
  constructor() {
    this.eventBus = new EventBus();
    this.configManager = new ConfigManager(this.eventBus);
    this.storageManager = new StorageManager(this.eventBus);
    this.securityEngine = new SecurityEngine();
    this.captureEngine = new CaptureEngine(this.eventBus, this.securityEngine);
    this.exportManager = new ExportManager();
  }

  /**
   * Initializes the extension manager and all subsystems
   * @returns Promise that resolves when initialization is complete
   * @throws {ExtensionError} When initialization fails
   */
  async initialize(): Promise<void> {
    try {
      // Initialize subsystems in dependency order
      await this.configManager.initialize();
      await this.storageManager.initialize();
      // SecurityEngine and ExportManager don't have initialize methods yet
      await this.captureEngine.initialize();

      // Set up event listeners
      this.setupEventListeners();

      this.isInitialized = true;
      this.eventBus.emit('extension:initialized', { timestamp: new Date() });
    } catch (error) {
      const extensionError: ExtensionError = {
        name: 'InitializationError',
        message: `Failed to initialize extension: ${error instanceof Error ? error.message : 'Unknown error'}`,
        code: 'INIT_FAILED',
        severity: 'critical',
        reportable: true,
        context: { originalError: error }
      };
      
      this.eventBus.emit('extension:error', extensionError);
      throw extensionError;
    }
  }

  /**
   * Starts capturing console logs
   * @returns Promise that resolves when capture starts
   * @throws {ExtensionError} When capture fails to start
   */
  async startCapture(): Promise<CaptureSession> {
    this.ensureInitialized();
    
    try {
      const session = await this.captureEngine.startSession();
      this.eventBus.emit('capture:started', { sessionId: session.id });
      return session;
    } catch (error) {
      const extensionError: ExtensionError = {
        name: 'CaptureStartError',
        message: `Failed to start capture: ${error instanceof Error ? error.message : 'Unknown error'}`,
        code: 'CAPTURE_START_FAILED',
        severity: 'high',
        reportable: true,
        context: { originalError: error }
      };
      
      this.eventBus.emit('extension:error', extensionError);
      throw extensionError;
    }
  }

  /**
   * Stops the current capture session
   * @returns Promise that resolves to the completed session
   * @throws {ExtensionError} When stopping capture fails
   */
  async stopCapture(): Promise<CaptureSession | null> {
    this.ensureInitialized();
    
    try {
      const session = await this.captureEngine.stopSession();
      if (session) {
        this.eventBus.emit('capture:stopped', { sessionId: session.id });
        await this.storageManager.saveSession(session);
      }
      return session;
    } catch (error) {
      const extensionError: ExtensionError = {
        name: 'CaptureStopError', 
        message: `Failed to stop capture: ${error instanceof Error ? error.message : 'Unknown error'}`,
        code: 'CAPTURE_STOP_FAILED',
        severity: 'medium',
        reportable: true,
        context: { originalError: error }
      };
      
      this.eventBus.emit('extension:error', extensionError);
      throw extensionError;
    }
  }

  /**
   * Gets the current capture session if active
   * @returns Current capture session or null if not capturing
   */
  getCurrentSession(): CaptureSession | null {
    this.ensureInitialized();
    return this.captureEngine.getCurrentSession();
  }

  /**
   * Gets extension configuration
   * @returns Current extension configuration
   */
  getConfig(): ExtensionConfig {
    this.ensureInitialized();
    return this.configManager.getConfig();
  }

  /**
   * Updates extension configuration
   * @param updates - Partial configuration updates
   * @returns Promise that resolves when config is updated
   */
  async updateConfig(updates: Partial<ExtensionConfig>): Promise<void> {
    this.ensureInitialized();
    await this.configManager.updateConfig(updates);
  }

  /**
   * Gets all stored capture sessions
   * @returns Promise that resolves to array of sessions
   */
  async getSessions(): Promise<CaptureSession[]> {
    this.ensureInitialized();
    return this.storageManager.getSessions();
  }

  /**
   * Exports a capture session in the specified format
   * @param sessionId - ID of the session to export
   * @param format - Export format
   * @returns Promise that resolves to exported data
   */
  async exportSession(sessionId: string, format: string): Promise<string> {
    this.ensureInitialized();
    const session = await this.storageManager.getSession(sessionId);
    if (!session) {
      throw new Error(`Session not found: ${sessionId}`);
    }
    return await this.exportManager.exportSession(session, { format } as any);
  }

  /**
   * Cleans up and shuts down the extension manager
   * @returns Promise that resolves when cleanup is complete
   */
  async shutdown(): Promise<void> {
    if (!this.isInitialized) {
      return;
    }

    try {
      // Stop any active capture
      await this.stopCapture();

      // Shutdown subsystems
      await this.captureEngine.shutdown();
      // ExportManager and SecurityEngine don't have shutdown methods yet
      await this.storageManager.shutdown();
      await this.configManager.shutdown();

      this.isInitialized = false;
      this.eventBus.emit('extension:shutdown', { timestamp: new Date() });
    } catch (error) {
      const extensionError: ExtensionError = {
        name: 'ShutdownError',
        message: `Failed to shutdown extension: ${error instanceof Error ? error.message : 'Unknown error'}`,
        code: 'SHUTDOWN_FAILED',
        severity: 'medium',
        reportable: false,
        context: { originalError: error }
      };
      
      this.eventBus.emit('extension:error', extensionError);
      throw extensionError;
    }
  }

  /**
   * Gets extension status information
   * @returns Extension status object
   */
  getStatus(): {
    initialized: boolean;
    capturing: boolean;
    sessionCount: number;
    lastError?: ExtensionError;
  } {
    return {
      initialized: this.isInitialized,
      capturing: this.captureEngine?.isCapturing() ?? false,
      sessionCount: this.storageManager?.getSessionCount() ?? 0
    };
  }

  /**
   * Sets up event listeners for inter-component communication
   */
  private setupEventListeners(): void {
    // Handle configuration changes
    this.eventBus.on('config:updated', (payload: { config: ExtensionConfig; previousConfig: ExtensionConfig; changes: Partial<ExtensionConfig> }) => {
      // Propagate config changes to relevant subsystems
      this.captureEngine.updateConfig(payload.config);
      // securityEngine.updateConfig method doesn't exist yet
      this.storageManager.updateConfig(payload.config);
    });

    // Handle storage cleanup events
    this.eventBus.on('storage:cleanup', async () => {
      await this.storageManager.cleanup();
    });

    // Handle security events
    this.eventBus.on('security:pii-detected', (data: { sessionId: string; count: number }) => {
      // Log PII detection for compliance
      console.warn(`PII detected in session ${data.sessionId}: ${data.count} instances`);
    });
  }

  /**
   * Ensures the extension manager is initialized
   * @throws {ExtensionError} When not initialized
   */
  private ensureInitialized(): void {
    if (!this.isInitialized) {
      throw new Error('ExtensionManager not initialized. Call initialize() first.');
    }
  }
}