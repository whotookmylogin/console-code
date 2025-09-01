/**
 * CaptureEngine - Main capture orchestration class for ConsoleCapture Pro
 * Manages capture sessions, log collection, security integration, and performance monitoring
 */

import type { 
  CaptureSession, 
  LogEntry, 
  LogLevel, 
  ExtensionConfig, 
  SessionContext, 
  SessionMetadata,
  PerformanceMetrics,
  ExtensionError
} from '../types/index.js';
import { ConsoleInterceptor } from './ConsoleInterceptor.js';
import { ContextCollector } from './ContextCollector.js';

/**
 * Performance monitoring thresholds for capture system
 */
interface PerformanceThresholds {
  /** Maximum capture latency in milliseconds */
  maxCaptureLatencyMs: number;
  /** Maximum memory usage in MB */
  maxMemoryMB: number;
  /** Throttle threshold in milliseconds */
  throttleThresholdMs: number;
  /** Maximum logs per second before throttling */
  maxLogsPerSecond: number;
}

/**
 * Internal capture statistics for performance monitoring
 */
interface CaptureStats {
  /** Total logs captured in current session */
  totalLogs: number;
  /** Logs captured per second (rolling average) */
  logsPerSecond: number;
  /** Average capture latency in milliseconds */
  averageCaptureLatency: number;
  /** Current memory usage in MB */
  currentMemoryMB: number;
  /** Number of throttled captures */
  throttledCaptures: number;
}

/**
 * Main capture orchestration class that manages capture sessions and log collection
 * Integrates with security engine for PII detection and handles performance monitoring
 */
export class CaptureEngine {
  private currentSession: CaptureSession | null = null;
  private consoleInterceptor: ConsoleInterceptor;
  private contextCollector: ContextCollector;
  private eventBus: any; // EventBus type from core
  private securityEngine: any; // SecurityEngine type from security
  private config: ExtensionConfig | null = null;
  private isInitialized: boolean = false;
  
  // Performance monitoring
  private performanceThresholds: PerformanceThresholds = {
    maxCaptureLatencyMs: 2,
    maxMemoryMB: 50,
    throttleThresholdMs: 100,
    maxLogsPerSecond: 1000
  };
  
  private captureStats: CaptureStats = {
    totalLogs: 0,
    logsPerSecond: 0,
    averageCaptureLatency: 0,
    currentMemoryMB: 0,
    throttledCaptures: 0
  };
  
  // Throttling and rate limiting
  private lastCaptureTime: number = 0;
  private recentCaptureTimes: number[] = [];
  private throttleTimer: NodeJS.Timeout | null = null;
  private pendingLogs: LogEntry[] = [];
  
  // Memory management
  private memoryMonitorInterval: NodeJS.Timeout | null = null;
  private performanceObserver: PerformanceObserver | null = null;

  /**
   * Creates a new CaptureEngine instance
   * @param eventBus - Event bus for inter-component communication
   * @param securityEngine - Security engine for PII detection and data classification
   */
  constructor(eventBus: any, securityEngine: any) {
    this.eventBus = eventBus;
    this.securityEngine = securityEngine;
    this.consoleInterceptor = new ConsoleInterceptor();
    this.contextCollector = new ContextCollector();
  }

  /**
   * Initializes the capture engine and its components
   * @returns Promise that resolves when initialization is complete
   * @throws {ExtensionError} When initialization fails
   */
  async initialize(): Promise<void> {
    try {
      // Initialize components
      await this.consoleInterceptor.initialize();
      await this.contextCollector.initialize();
      
      // Set up console interception handler
      this.consoleInterceptor.setLogHandler(this.handleCapturedLog.bind(this));
      
      // Start performance monitoring
      this.startPerformanceMonitoring();
      
      // Set up cleanup handlers
      this.setupCleanupHandlers();
      
      this.isInitialized = true;
      this.eventBus?.emit('capture:engine-initialized', { timestamp: new Date() });
      
    } catch (error) {
      const extensionError: ExtensionError = {
        name: 'CaptureEngineInitError',
        message: `Failed to initialize capture engine: ${error instanceof Error ? error.message : 'Unknown error'}`,
        code: 'CAPTURE_ENGINE_INIT_FAILED',
        severity: 'critical',
        reportable: true,
        context: { originalError: error }
      };
      
      throw extensionError;
    }
  }

  /**
   * Starts a new capture session
   * @returns Promise that resolves to the new capture session
   * @throws {ExtensionError} When session creation fails
   */
  async startSession(): Promise<CaptureSession> {
    this.ensureInitialized();
    
    if (this.currentSession) {
      throw new Error('Capture session already active. Stop current session first.');
    }

    try {
      // Collect initial context
      const context = await this.contextCollector.collectInitialContext();
      
      // Create new session
      this.currentSession = {
        id: this.generateSessionId(),
        startTime: new Date(),
        logs: [],
        context,
        metadata: {
          totalLogs: 0,
          errorCount: 0,
          warningCount: 0,
          containsSensitiveData: false,
          tags: []
        }
      };

      // Start console interception
      await this.consoleInterceptor.startCapture();
      
      // Start context monitoring
      if (this.currentSession) {
        this.contextCollector.startMonitoring(this.currentSession.id);
      }
      
      // Reset capture statistics
      this.resetCaptureStats();
      
      if (this.currentSession) {
        this.eventBus?.emit('capture:session-started', { 
          sessionId: this.currentSession.id,
          timestamp: this.currentSession.startTime 
        });
      }
      
      return this.currentSession!;
      
    } catch (error) {
      this.currentSession = null;
      
      const extensionError: ExtensionError = {
        name: 'SessionStartError',
        message: `Failed to start capture session: ${error instanceof Error ? error.message : 'Unknown error'}`,
        code: 'SESSION_START_FAILED',
        severity: 'high',
        reportable: true,
        context: { originalError: error }
      };
      
      throw extensionError;
    }
  }

  /**
   * Stops the current capture session
   * @returns Promise that resolves to the completed session or null if no active session
   * @throws {ExtensionError} When stopping the session fails
   */
  async stopSession(): Promise<CaptureSession | null> {
    this.ensureInitialized();
    
    if (!this.currentSession) {
      return null;
    }

    try {
      // Stop console interception
      await this.consoleInterceptor.stopCapture();
      
      // Stop context monitoring
      this.contextCollector.stopMonitoring();
      
      // Process any pending logs
      await this.processPendingLogs();
      
      // Finalize session
      this.currentSession.endTime = new Date();
      this.currentSession.context = await this.contextCollector.getFinalContext();
      
      // Update performance metrics
      if (this.currentSession) {
        this.currentSession.context.performance = await this.getPerformanceMetrics();
      }
      
      const completedSession = { ...this.currentSession };
      this.currentSession = null;
      
      this.eventBus?.emit('capture:session-stopped', { 
        sessionId: completedSession.id,
        endTime: completedSession.endTime,
        totalLogs: completedSession.logs.length
      });
      
      return completedSession;
      
    } catch (error) {
      const extensionError: ExtensionError = {
        name: 'SessionStopError',
        message: `Failed to stop capture session: ${error instanceof Error ? error.message : 'Unknown error'}`,
        code: 'SESSION_STOP_FAILED',
        severity: 'medium',
        reportable: true,
        context: { originalError: error, sessionId: this.currentSession?.id }
      };
      
      throw extensionError;
    }
  }

  /**
   * Gets the current active capture session
   * @returns Current capture session or null if not capturing
   */
  getCurrentSession(): CaptureSession | null {
    return this.currentSession;
  }

  /**
   * Checks if capture is currently active
   * @returns True if capturing, false otherwise
   */
  isCapturing(): boolean {
    return this.currentSession !== null;
  }

  /**
   * Updates capture engine configuration
   * @param config - Updated configuration
   */
  updateConfig(config: ExtensionConfig): void {
    this.config = config;
    
    // Update performance thresholds based on config
    if (config.performance) {
      this.performanceThresholds.maxMemoryMB = config.performance.maxMemoryMB;
      this.performanceThresholds.throttleThresholdMs = config.performance.throttleMs;
    }
    
    // Update console interceptor configuration
    this.consoleInterceptor.updateConfig({
      capturedLevels: config.capturedLevels,
      throttleMs: config.performance?.throttleMs || 0
    });
    
    // Update context collector configuration
    this.contextCollector.updateConfig({
      enablePerformanceMonitoring: config.performance?.enableMonitoring || false
    });
  }

  /**
   * Gets current capture statistics for performance monitoring
   * @returns Current capture statistics
   */
  getCaptureStats(): CaptureStats {
    return { ...this.captureStats };
  }

  /**
   * Handles captured log entries from the console interceptor
   * @param originalArgs - Original console arguments
   * @param level - Log level
   * @param stackTrace - Stack trace if available
   */
  private async handleCapturedLog(
    originalArgs: any[], 
    level: LogLevel, 
    stackTrace?: string
  ): Promise<void> {
    if (!this.currentSession) {
      return;
    }

    const startTime = performance.now();
    
    try {
      // Check throttling
      if (this.shouldThrottle()) {
        this.captureStats.throttledCaptures++;
        this.queueForThrottledProcessing(originalArgs, level, stackTrace);
        return;
      }

      // Create log entry
      const logEntry = await this.createLogEntry(originalArgs, level, stackTrace);
      
      // Security scan for PII
      if (this.config?.privacy.enablePIIDetection) {
        await this.scanForPII(logEntry);
      }
      
      // Add to session
      this.addLogToSession(logEntry);
      
      // Update statistics
      const captureLatency = performance.now() - startTime;
      this.updateCaptureStats(captureLatency);
      
      // Check performance thresholds
      this.checkPerformanceThresholds(captureLatency);
      
      // Emit capture event
      this.eventBus?.emit('capture:log-captured', {
        sessionId: this.currentSession.id,
        logId: logEntry.id,
        level: logEntry.level
      });
      
    } catch (error) {
      this.eventBus?.emit('capture:log-capture-failed', {
        sessionId: this.currentSession?.id,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }

  /**
   * Creates a log entry from captured console arguments
   * @param originalArgs - Original console arguments
   * @param level - Log level
   * @param stackTrace - Stack trace if available
   * @returns Promise that resolves to the created log entry
   */
  private async createLogEntry(
    originalArgs: any[],
    level: LogLevel,
    stackTrace?: string
  ): Promise<LogEntry> {
    // Convert arguments to message string
    const message = originalArgs
      .map(arg => {
        if (typeof arg === 'object' && arg !== null) {
          try {
            return JSON.stringify(arg, null, 2);
          } catch {
            return String(arg);
          }
        }
        return String(arg);
      })
      .join(' ');

    // Extract source location from stack trace
    const source = this.extractSourceLocation(stackTrace);

    const logEntry: LogEntry = {
      id: this.generateLogId(),
      timestamp: new Date(),
      level,
      message
    };

    if (source) {
      logEntry.source = source;
    }

    if (stackTrace) {
      logEntry.stackTrace = stackTrace;
    }

    return logEntry;
  }

  /**
   * Scans log entry for PII and applies security classification
   * @param logEntry - Log entry to scan
   */
  private async scanForPII(logEntry: LogEntry): Promise<void> {
    if (!this.securityEngine) {
      return;
    }

    try {
      const classification = await this.securityEngine.classifyData(logEntry.message);
      logEntry.classification = classification;
      
      if (classification.sanitized) {
        logEntry.sanitizedMessage = await this.securityEngine.sanitizeData(logEntry.message);
        
        // Update session metadata
        if (this.currentSession) {
          this.currentSession.metadata.containsSensitiveData = true;
        }
        
        this.eventBus?.emit('security:pii-detected', {
          sessionId: this.currentSession?.id,
          logId: logEntry.id,
          piiTypes: classification.detectedTypes
        });
      }
      
    } catch (error) {
      this.eventBus?.emit('security:classification-failed', {
        logId: logEntry.id,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }

  /**
   * Adds a log entry to the current session
   * @param logEntry - Log entry to add
   */
  private addLogToSession(logEntry: LogEntry): void {
    if (!this.currentSession) {
      return;
    }

    this.currentSession.logs.push(logEntry);
    
    // Update session metadata
    this.currentSession.metadata.totalLogs++;
    
    switch (logEntry.level) {
      case 'error':
        this.currentSession.metadata.errorCount++;
        break;
      case 'warn':
        this.currentSession.metadata.warningCount++;
        break;
    }
  }

  /**
   * Checks if capturing should be throttled based on performance thresholds
   * @returns True if should throttle, false otherwise
   */
  private shouldThrottle(): boolean {
    const now = Date.now();
    
    // Check time-based throttling
    if (now - this.lastCaptureTime < this.performanceThresholds.throttleThresholdMs) {
      return true;
    }
    
    // Check rate-based throttling
    this.recentCaptureTimes = this.recentCaptureTimes.filter(time => now - time < 1000);
    this.recentCaptureTimes.push(now);
    
    if (this.recentCaptureTimes.length > this.performanceThresholds.maxLogsPerSecond) {
      return true;
    }
    
    this.lastCaptureTime = now;
    return false;
  }

  /**
   * Queues log for throttled processing
   * @param originalArgs - Original console arguments
   * @param level - Log level
   * @param stackTrace - Stack trace if available
   */
  private queueForThrottledProcessing(
    _originalArgs: any[],
    _level: LogLevel,
    _stackTrace?: string
  ): void {
    // If throttle timer isn't running, start it
    if (!this.throttleTimer) {
      this.throttleTimer = setTimeout(() => {
        this.processThrottledLogs();
        this.throttleTimer = null;
      }, this.performanceThresholds.throttleThresholdMs);
    }
  }

  /**
   * Processes queued logs from throttling
   */
  private async processThrottledLogs(): Promise<void> {
    // Process pending logs with reduced frequency
    // This is a simplified implementation - in practice you might batch process
    // or sample the most important logs
  }

  /**
   * Processes any pending logs before session ends
   */
  private async processPendingLogs(): Promise<void> {
    // Clear any throttling timers
    if (this.throttleTimer) {
      clearTimeout(this.throttleTimer);
      this.throttleTimer = null;
    }
    
    // Process any remaining queued logs
    await this.processThrottledLogs();
  }

  /**
   * Updates capture statistics for performance monitoring
   * @param captureLatency - Latency of the last capture operation
   */
  private updateCaptureStats(captureLatency: number): void {
    this.captureStats.totalLogs++;
    
    // Update rolling average latency
    const alpha = 0.1; // Smoothing factor
    this.captureStats.averageCaptureLatency = 
      (1 - alpha) * this.captureStats.averageCaptureLatency + alpha * captureLatency;
    
    // Update logs per second (simplified calculation)
    this.captureStats.logsPerSecond = this.recentCaptureTimes.length;
    
    // Update memory usage
    this.updateMemoryUsage();
  }

  /**
   * Updates current memory usage statistics
   */
  private updateMemoryUsage(): void {
    if ('memory' in performance && (performance as any).memory) {
      const memory = (performance as any).memory;
      this.captureStats.currentMemoryMB = memory.usedJSHeapSize / (1024 * 1024);
    }
  }

  /**
   * Checks performance thresholds and takes action if exceeded
   * @param captureLatency - Current capture latency
   */
  private checkPerformanceThresholds(captureLatency: number): void {
    // Check capture latency
    if (captureLatency > this.performanceThresholds.maxCaptureLatencyMs) {
      this.eventBus?.emit('capture:performance-warning', {
        type: 'high-latency',
        value: captureLatency,
        threshold: this.performanceThresholds.maxCaptureLatencyMs
      });
    }
    
    // Check memory usage
    if (this.captureStats.currentMemoryMB > this.performanceThresholds.maxMemoryMB) {
      this.eventBus?.emit('capture:performance-warning', {
        type: 'high-memory',
        value: this.captureStats.currentMemoryMB,
        threshold: this.performanceThresholds.maxMemoryMB
      });
      
      // Trigger cleanup if needed
      this.triggerMemoryCleanup();
    }
  }

  /**
   * Triggers memory cleanup when usage is high
   */
  private triggerMemoryCleanup(): void {
    if (this.currentSession && this.currentSession.logs.length > 1000) {
      // Remove oldest logs if session is getting too large
      const removeCount = Math.floor(this.currentSession.logs.length * 0.1);
      this.currentSession.logs.splice(0, removeCount);
      
      this.eventBus?.emit('capture:memory-cleanup', {
        sessionId: this.currentSession.id,
        removedLogs: removeCount
      });
    }
  }

  /**
   * Starts performance monitoring systems
   */
  private startPerformanceMonitoring(): void {
    // Monitor memory usage periodically
    this.memoryMonitorInterval = setInterval(() => {
      this.updateMemoryUsage();
      this.checkPerformanceThresholds(0);
    }, 5000); // Every 5 seconds
    
    // Set up Performance Observer if available
    if ('PerformanceObserver' in window) {
      try {
        this.performanceObserver = new PerformanceObserver((list) => {
          // Monitor performance entries
          const entries = list.getEntries();
          for (const entry of entries) {
            if (entry.name.includes('console-capture')) {
              this.checkPerformanceThresholds(entry.duration);
            }
          }
        });
        
        this.performanceObserver.observe({ entryTypes: ['measure'] });
      } catch (error) {
        // Performance Observer not supported or failed to initialize
        console.warn('PerformanceObserver initialization failed:', error);
      }
    }
  }

  /**
   * Sets up cleanup handlers for proper resource management
   */
  private setupCleanupHandlers(): void {
    // Handle page unload
    if (typeof window !== 'undefined') {
      window.addEventListener('beforeunload', () => {
        this.cleanup();
      });
      
      // Handle visibility change (tab switching)
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden') {
          this.cleanup();
        }
      });
    }
  }

  /**
   * Performs cleanup of resources and timers
   */
  private cleanup(): void {
    if (this.throttleTimer) {
      clearTimeout(this.throttleTimer);
      this.throttleTimer = null;
    }
    
    if (this.memoryMonitorInterval) {
      clearInterval(this.memoryMonitorInterval);
      this.memoryMonitorInterval = null;
    }
    
    if (this.performanceObserver) {
      this.performanceObserver.disconnect();
      this.performanceObserver = null;
    }
  }

  /**
   * Shuts down the capture engine and cleans up resources
   * @returns Promise that resolves when shutdown is complete
   */
  async shutdown(): Promise<void> {
    if (this.isInitialized) {
      // Stop any active session
      if (this.currentSession) {
        await this.stopSession();
      }
      
      // Shutdown components
      await this.consoleInterceptor.shutdown();
      await this.contextCollector.shutdown();
      
      // Cleanup resources
      this.cleanup();
      
      this.isInitialized = false;
    }
  }

  /**
   * Gets current performance metrics
   * @returns Promise that resolves to performance metrics
   */
  private async getPerformanceMetrics(): Promise<PerformanceMetrics> {
    const metrics: PerformanceMetrics = {};
    
    try {
      if ('performance' in window && window.performance.getEntriesByType) {
        // Get paint metrics
        const paintEntries = window.performance.getEntriesByType('paint');
        for (const entry of paintEntries) {
          if (entry.name === 'first-contentful-paint') {
            metrics.fcp = entry.startTime;
          }
        }
        
        // Get navigation metrics
        const navEntries = window.performance.getEntriesByType('navigation');
        if (navEntries.length > 0) {
          const nav = navEntries[0] as PerformanceNavigationTiming;
          metrics.tti = nav.domInteractive - (nav.fetchStart || 0);
        }
        
        // Get memory info if available
        if ('memory' in performance && (performance as any).memory) {
          const memory = (performance as any).memory;
          metrics.memory = {
            used: memory.usedJSHeapSize,
            total: memory.totalJSHeapSize
          };
        }
      }
    } catch (error) {
      // Performance API not available or failed
    }
    
    return metrics;
  }

  /**
   * Resets capture statistics for new session
   */
  private resetCaptureStats(): void {
    this.captureStats = {
      totalLogs: 0,
      logsPerSecond: 0,
      averageCaptureLatency: 0,
      currentMemoryMB: 0,
      throttledCaptures: 0
    };
    
    this.recentCaptureTimes = [];
    this.lastCaptureTime = 0;
  }

  /**
   * Extracts source location information from stack trace
   * @param stackTrace - Stack trace string
   * @returns Source location object or undefined
   */
  private extractSourceLocation(stackTrace?: string): { file: string; line: number; column: number } | undefined {
    if (!stackTrace) {
      return undefined;
    }

    // Simple regex to extract file, line, and column from common stack trace formats
    const match = stackTrace.match(/at .+? \((.+?):(\d+):(\d+)\)/);
    if (match && match[1] && match[2] && match[3]) {
      return {
        file: match[1],
        line: parseInt(match[2], 10),
        column: parseInt(match[3], 10)
      };
    }
    
    return undefined;
  }

  /**
   * Generates unique session ID
   * @returns Unique session identifier
   */
  private generateSessionId(): string {
    return `session_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
  }

  /**
   * Generates unique log ID
   * @returns Unique log identifier
   */
  private generateLogId(): string {
    return `log_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
  }

  /**
   * Ensures the capture engine is initialized
   * @throws {Error} When not initialized
   */
  private ensureInitialized(): void {
    if (!this.isInitialized) {
      throw new Error('CaptureEngine not initialized. Call initialize() first.');
    }
  }
}