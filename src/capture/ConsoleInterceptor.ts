/**
 * ConsoleInterceptor - Intercepts console methods while preserving original functionality
 * Handles CSP restrictions with fallback methods and implements capture filtering
 */

import type { LogLevel } from '../types/index.js';

/**
 * Console interceptor configuration
 */
interface ConsoleInterceptorConfig {
  /** Log levels to capture */
  capturedLevels: LogLevel[];
  /** Throttling delay in milliseconds */
  throttleMs: number;
  /** Whether to preserve original console behavior */
  preserveOriginal: boolean;
  /** Whether to use CSP-safe methods */
  cspSafeMode: boolean;
}

/**
 * Handler function for captured console logs
 */
type LogHandler = (
  originalArgs: any[],
  level: LogLevel,
  stackTrace?: string
) => Promise<void> | void;

/**
 * Original console methods storage
 */
interface OriginalConsoleMethods {
  log: typeof console.log;
  info: typeof console.info;
  warn: typeof console.warn;
  error: typeof console.error;
  debug: typeof console.debug;
  trace: typeof console.trace;
}

/**
 * Stack trace extraction methods for different CSP scenarios
 */
interface StackTraceExtractor {
  /** Extract stack trace using Error constructor */
  fromError: () => string | undefined;
  /** Extract stack trace from console.trace (CSP restricted) */
  fromTrace: () => string | undefined;
  /** Extract stack trace using caller inspection (fallback) */
  fromCaller: () => string | undefined;
}

/**
 * Console method interceptor that captures logs while preserving original functionality
 * Implements CSP-safe methods and performance-optimized capture filtering
 */
export class ConsoleInterceptor {
  private isInitialized: boolean = false;
  private isCapturing: boolean = false;
  private logHandler: LogHandler | null = null;
  private originalMethods: OriginalConsoleMethods;
  private stackTraceExtractor: StackTraceExtractor;
  
  // Configuration
  private config: ConsoleInterceptorConfig = {
    capturedLevels: ['log', 'info', 'warn', 'error', 'debug'],
    throttleMs: 0,
    preserveOriginal: true,
    cspSafeMode: false
  };
  
  // CSP detection and fallback handling
  private cspRestricted: boolean = false;
  private fallbackMethods: Map<LogLevel, Function> = new Map();
  
  // Performance optimization
  private lastInterceptTime: Map<LogLevel, number> = new Map();
  private interceptedCallsCount: number = 0;
  
  // Stack trace caching for performance
  private stackTraceCache: Map<string, string> = new Map();
  private stackTraceCacheSize: number = 100;

  /**
   * Creates a new ConsoleInterceptor instance
   */
  constructor() {
    // Store original console methods immediately to prevent loss
    this.originalMethods = {
      log: console.log.bind(console),
      info: console.info.bind(console),
      warn: console.warn.bind(console),
      error: console.error.bind(console),
      debug: console.debug.bind(console),
      trace: console.trace.bind(console)
    };
    
    // Initialize stack trace extractor
    this.stackTraceExtractor = this.createStackTraceExtractor();
  }

  /**
   * Initializes the console interceptor
   * @returns Promise that resolves when initialization is complete
   */
  async initialize(): Promise<void> {
    if (this.isInitialized) {
      return;
    }

    try {
      // Detect CSP restrictions
      await this.detectCSPRestrictions();
      
      // Set up appropriate configuration based on CSP
      this.config.cspSafeMode = this.cspRestricted;
      
      // Initialize fallback methods if needed
      if (this.cspRestricted) {
        this.initializeFallbackMethods();
      }
      
      // Set up error handling
      this.setupErrorHandling();
      
      this.isInitialized = true;
      
    } catch (error) {
      throw new Error(`Failed to initialize ConsoleInterceptor: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Starts capturing console logs
   * @returns Promise that resolves when capture starts
   */
  async startCapture(): Promise<void> {
    if (!this.isInitialized) {
      throw new Error('ConsoleInterceptor not initialized. Call initialize() first.');
    }
    
    if (this.isCapturing) {
      return;
    }

    try {
      // Install console interceptors
      this.installInterceptors();
      
      this.isCapturing = true;
      
    } catch (error) {
      throw new Error(`Failed to start console capture: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Stops capturing console logs
   * @returns Promise that resolves when capture stops
   */
  async stopCapture(): Promise<void> {
    if (!this.isCapturing) {
      return;
    }

    try {
      // Restore original console methods
      this.restoreOriginalMethods();
      
      this.isCapturing = false;
      
    } catch (error) {
      throw new Error(`Failed to stop console capture: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Sets the log handler function
   * @param handler - Function to handle captured logs
   */
  setLogHandler(handler: LogHandler): void {
    this.logHandler = handler;
  }

  /**
   * Updates the interceptor configuration
   * @param config - Partial configuration updates
   */
  updateConfig(config: Partial<ConsoleInterceptorConfig>): void {
    this.config = { ...this.config, ...config };
    
    // If capture is active, restart with new config
    if (this.isCapturing) {
      this.restoreOriginalMethods();
      this.installInterceptors();
    }
  }

  /**
   * Gets current interception statistics
   * @returns Statistics object
   */
  getStats(): {
    interceptedCalls: number;
    isCapturing: boolean;
    cspRestricted: boolean;
    capturedLevels: LogLevel[];
  } {
    return {
      interceptedCalls: this.interceptedCallsCount,
      isCapturing: this.isCapturing,
      cspRestricted: this.cspRestricted,
      capturedLevels: this.config.capturedLevels
    };
  }

  /**
   * Shuts down the console interceptor
   * @returns Promise that resolves when shutdown is complete
   */
  async shutdown(): Promise<void> {
    if (this.isCapturing) {
      await this.stopCapture();
    }
    
    // Clear caches
    this.stackTraceCache.clear();
    this.lastInterceptTime.clear();
    
    this.isInitialized = false;
  }

  /**
   * Installs console method interceptors
   */
  private installInterceptors(): void {
    const levels: LogLevel[] = ['log', 'info', 'warn', 'error', 'debug'];
    
    for (const level of levels) {
      if (this.config.capturedLevels.includes(level)) {
        (console as any)[level] = this.createInterceptor(level);
      }
    }
  }

  /**
   * Creates an interceptor function for a specific log level
   * @param level - Log level to intercept
   * @returns Interceptor function
   */
  private createInterceptor(level: LogLevel): Function {
    const originalMethod = this.originalMethods[level];
    
    return (...args: any[]) => {
      // Always call original method first to preserve behavior
      if (this.config.preserveOriginal) {
        try {
          originalMethod(...args);
        } catch (error) {
          // Ignore errors from original method to prevent breaking interception
        }
      }
      
      // Handle capture with performance optimizations
      this.handleInterceptedCall(args, level);
    };
  }

  /**
   * Handles intercepted console calls with performance optimizations
   * @param args - Console arguments
   * @param level - Log level
   */
  private handleInterceptedCall(args: any[], level: LogLevel): void {
    try {
      // Check throttling
      if (this.shouldThrottle(level)) {
        return;
      }
      
      // Update statistics
      this.interceptedCallsCount++;
      this.lastInterceptTime.set(level, Date.now());
      
      // Extract stack trace if available
      const stackTrace = this.extractStackTrace();
      
      // Call handler asynchronously to avoid blocking
      if (this.logHandler) {
        // Use setTimeout to make it async and non-blocking
        setTimeout(() => {
          this.logHandler!(args, level, stackTrace);
        }, 0);
      }
      
    } catch (error) {
      // Silent error handling to prevent breaking console functionality
      this.handleInterceptionError(error, level);
    }
  }

  /**
   * Checks if logging should be throttled for performance
   * @param level - Log level to check
   * @returns True if should throttle, false otherwise
   */
  private shouldThrottle(level: LogLevel): boolean {
    if (this.config.throttleMs <= 0) {
      return false;
    }
    
    const lastTime = this.lastInterceptTime.get(level) || 0;
    return Date.now() - lastTime < this.config.throttleMs;
  }

  /**
   * Extracts stack trace using CSP-safe methods
   * @returns Stack trace string or undefined
   */
  private extractStackTrace(): string | undefined {
    // Check cache first for performance
    const cacheKey = `${Date.now()}_${Math.random()}`;
    
    try {
      // Try different extraction methods based on CSP restrictions
      if (this.cspRestricted) {
        return this.stackTraceExtractor.fromError() || 
               this.stackTraceExtractor.fromCaller();
      } else {
        return this.stackTraceExtractor.fromError() || 
               this.stackTraceExtractor.fromTrace() || 
               this.stackTraceExtractor.fromCaller();
      }
    } catch (error) {
      // Stack trace extraction failed, return undefined
      return undefined;
    }
  }

  /**
   * Creates stack trace extractor with CSP-safe methods
   * @returns Stack trace extractor object
   */
  private createStackTraceExtractor(): StackTraceExtractor {
    return {
      fromError: (): string | undefined => {
        try {
          const error = new Error();
          if (error.stack) {
            // Clean up stack trace to remove interceptor frames
            return this.cleanStackTrace(error.stack);
          }
        } catch {
          // Error stack not available
        }
        return undefined;
      },
      
      fromTrace: (): string | undefined => {
        try {
          // This might be blocked by CSP
          const originalTrace = console.trace;
          let traceOutput = '';
          
          // Temporarily override console.trace to capture output
          console.trace = (...args: any[]) => {
            traceOutput = args.join(' ');
          };
          
          // Call trace
          console.trace();
          
          // Restore original trace
          console.trace = originalTrace;
          
          return traceOutput || undefined;
        } catch {
          // console.trace blocked or failed
        }
        return undefined;
      },
      
      fromCaller: (): string | undefined => {
        try {
          // Fallback method using function caller inspection
          // This is less reliable but works in some CSP scenarios
          let caller: any = this.extractStackTrace;
          let stack = '';
          let depth = 0;
          
          while (caller && caller.caller && depth < 10) {
            stack += `at ${caller.name || 'anonymous'}\n`;
            caller = (caller as any).caller;
            depth++;
          }
          
          return stack || undefined;
        } catch {
          // Caller inspection blocked
        }
        return undefined;
      }
    };
  }

  /**
   * Cleans stack trace to remove interceptor frames and noise
   * @param stack - Raw stack trace string
   * @returns Cleaned stack trace
   */
  private cleanStackTrace(stack: string): string {
    const lines = stack.split('\n');
    const cleanedLines = lines.filter(line => {
      // Remove interceptor-related frames
      return !line.includes('ConsoleInterceptor') &&
             !line.includes('createInterceptor') &&
             !line.includes('handleInterceptedCall') &&
             line.trim().length > 0;
    });
    
    return cleanedLines.slice(0, 10).join('\n'); // Limit to 10 frames
  }

  /**
   * Restores original console methods
   */
  private restoreOriginalMethods(): void {
    try {
      console.log = this.originalMethods.log;
      console.info = this.originalMethods.info;
      console.warn = this.originalMethods.warn;
      console.error = this.originalMethods.error;
      console.debug = this.originalMethods.debug;
    } catch (error) {
      // Restoration failed, but continue to avoid breaking the application
    }
  }

  /**
   * Detects CSP restrictions that might affect console interception
   * @returns Promise that resolves when detection is complete
   */
  private async detectCSPRestrictions(): Promise<void> {
    try {
      // Test if we can access stack traces
      const testError = new Error('CSP test');
      if (!testError.stack) {
        this.cspRestricted = true;
      }
      
      // Test if we can override console methods
      const originalLog = console.log;
      console.log = console.log;
      if (console.log !== originalLog) {
        this.cspRestricted = true;
      }
      
      // Test Function constructor (often blocked by CSP)
      try {
        new Function('return 1')();
      } catch {
        this.cspRestricted = true;
      }
      
    } catch (error) {
      // Assume CSP restricted if detection fails
      this.cspRestricted = true;
    }
  }

  /**
   * Initializes fallback methods for CSP-restricted environments
   */
  private initializeFallbackMethods(): void {
    // Create safe fallback methods that work under strict CSP
    const levels: LogLevel[] = ['log', 'info', 'warn', 'error', 'debug'];
    
    for (const level of levels) {
      this.fallbackMethods.set(level, (...args: any[]) => {
        // Simplified fallback that just passes through to original
        try {
          this.originalMethods[level](...args);
        } catch {
          // Ignore errors in fallback
        }
      });
    }
  }

  /**
   * Sets up error handling for interception failures
   */
  private setupErrorHandling(): void {
    // Handle unhandled errors that might break interception
    if (typeof window !== 'undefined') {
      window.addEventListener('error', (event) => {
        if (event.error && event.error.message?.includes('ConsoleInterceptor')) {
          // Our interceptor caused an error, restore original methods
          this.restoreOriginalMethods();
          this.isCapturing = false;
        }
      });
    }
  }

  /**
   * Handles errors that occur during interception
   * @param error - Error that occurred
   * @param level - Log level where error occurred
   */
  private handleInterceptionError(error: any, level: LogLevel): void {
    try {
      // Log error using original method to avoid infinite loops
      this.originalMethods.error('ConsoleInterceptor error:', error);
      
      // If errors are frequent, disable interception for this level
      const errorKey = `error_${level}`;
      const errorCount = (this as any)[errorKey] || 0;
      (this as any)[errorKey] = errorCount + 1;
      
      if (errorCount > 5) {
        // Remove this level from captured levels
        this.config.capturedLevels = this.config.capturedLevels.filter(l => l !== level);
        
        // Restore original method for this level
        console[level] = this.originalMethods[level];
      }
      
    } catch {
      // Even error handling failed, disable entire interception
      this.restoreOriginalMethods();
      this.isCapturing = false;
    }
  }
}