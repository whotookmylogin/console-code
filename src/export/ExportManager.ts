/**
 * ExportManager.ts
 * Main export orchestration class for ConsoleCapture Pro
 * Handles multiple export formats, integrates with security engine for data sanitization,
 * provides template-based formatting, and manages export configuration
 */

import type {
  CaptureSession,
  ExportConfig,
  ExportFormat,
  ExtensionError,
  ProcessingPurpose,
  ConsentPreferences
} from '../types/index.js';

import { EventBus, type EventPayloads } from '../core/EventBus.js';
import { SecurityEngine } from '../security/SecurityEngine.js';
import { JsonFormatter } from './formatters/JsonFormatter.js';
import { MarkdownFormatter } from './formatters/MarkdownFormatter.js';
// import { GitHubIssueFormatter } from './formatters/GitHubIssueFormatter.js';

/**
 * Export result containing the formatted data and metadata
 */
export interface ExportResult {
  /** Export identifier */
  id: string;
  /** Exported data as string */
  data: string;
  /** Export format used */
  format: ExportFormat;
  /** Size of exported data in bytes */
  size: number;
  /** Export timestamp */
  timestamp: Date;
  /** Whether export contained sanitized data */
  containsSanitizedData: boolean;
  /** Export configuration used */
  config: ExportConfig;
  /** Session that was exported */
  sessionId: string;
  /** Any warnings generated during export */
  warnings: string[];
}

/**
 * Export progress information for long-running exports
 */
export interface ExportProgress {
  /** Export identifier */
  exportId: string;
  /** Current stage of export */
  stage: 'initializing' | 'processing' | 'formatting' | 'sanitizing' | 'finalizing' | 'complete' | 'error';
  /** Progress percentage (0-100) */
  progress: number;
  /** Current operation description */
  currentOperation: string;
  /** Number of items processed */
  processedItems: number;
  /** Total number of items to process */
  totalItems: number;
  /** Start time of export */
  startTime: Date;
  /** Estimated completion time */
  estimatedCompletion?: Date;
}

/**
 * Export template configuration for custom formatting
 */
export interface ExportTemplate {
  /** Template name */
  name: string;
  /** Target format */
  format: ExportFormat;
  /** Template content with placeholders */
  template: string;
  /** Custom CSS for styled formats */
  styles?: string;
  /** JavaScript for interactive formats */
  scripts?: string;
  /** Template variables and their descriptions */
  variables: Record<string, string>;
}

/**
 * Export statistics and performance metrics
 */
export interface ExportStatistics {
  /** Total exports performed */
  totalExports: number;
  /** Exports by format */
  exportsByFormat: Record<ExportFormat, number>;
  /** Export performance metrics */
  performance: {
    averageTimeMs: number;
    minTimeMs: number;
    maxTimeMs: number;
    averageSize: number;
  };
  /** Success and failure rates */
  reliability: {
    successfulExports: number;
    failedExports: number;
    successRate: number;
  };
  /** Data sanitization statistics */
  sanitization: {
    totalSanitizations: number;
    sanitizationsByType: Record<string, number>;
  };
}

/**
 * Base formatter interface that all export formatters must implement
 */
export interface ExportFormatter {
  /** Supported export format */
  readonly format: ExportFormat;
  
  /**
   * Formats a capture session for export
   * @param session - Session to format
   * @param config - Export configuration
   * @param template - Optional custom template
   * @returns Promise resolving to formatted string
   */
  format(session: CaptureSession, config: ExportConfig, template?: ExportTemplate): Promise<string>;
  
  /**
   * Validates export configuration for this formatter
   * @param config - Configuration to validate
   * @returns Array of validation errors (empty if valid)
   */
  validateConfig(config: ExportConfig): string[];
  
  /**
   * Gets default configuration for this formatter
   * @returns Default export configuration
   */
  getDefaultConfig(): Partial<ExportConfig>;
  
  /**
   * Estimates output size for a session
   * @param session - Session to estimate
   * @param config - Export configuration
   * @returns Estimated size in bytes
   */
  estimateSize(session: CaptureSession, config: ExportConfig): number;
}

/**
 * Main export orchestration class
 * Coordinates multiple formatters, handles security integration, and manages export operations
 */
export class ExportManager {
  private readonly formatters: Map<ExportFormat, ExportFormatter> = new Map();
  private readonly eventBus: EventBus;
  private readonly securityEngine: SecurityEngine;
  private readonly statistics: ExportStatistics;
  private readonly activeExports: Map<string, ExportProgress> = new Map();
  private readonly exportHistory: Map<string, ExportResult> = new Map();
  private readonly customTemplates: Map<string, ExportTemplate> = new Map();
  private readonly maxConcurrentExports: number = 3;
  private readonly maxHistorySize: number = 1000;

  /**
   * Creates a new ExportManager instance
   * @param eventBus - Event bus for progress and error reporting
   * @param securityEngine - Security engine for data sanitization
   */
  constructor(eventBus: EventBus, securityEngine: SecurityEngine) {
    this.eventBus = eventBus;
    this.securityEngine = securityEngine;
    
    // Initialize statistics
    this.statistics = {
      totalExports: 0,
      exportsByFormat: {} as Record<ExportFormat, number>,
      performance: {
        averageTimeMs: 0,
        minTimeMs: Infinity,
        maxTimeMs: 0,
        averageSize: 0
      },
      reliability: {
        successfulExports: 0,
        failedExports: 0,
        successRate: 1.0
      },
      sanitization: {
        totalSanitizations: 0,
        sanitizationsByType: {}
      }
    };

    // Initialize all supported export formats
    this.initializeFormatters();
    
    // Set up event listeners
    this.setupEventListeners();
  }

  /**
   * Exports a capture session in the specified format
   * @param session - Capture session to export
   * @param config - Export configuration
   * @param templateName - Optional custom template name
   * @returns Promise resolving to export result
   */
  public async exportSession(
    session: CaptureSession,
    config: ExportConfig,
    templateName?: string
  ): Promise<ExportResult> {
    const exportId = this.generateExportId();
    const startTime = Date.now();

    try {
      // Check concurrent export limit
      if (this.activeExports.size >= this.maxConcurrentExports) {
        throw this.createExportError(
          'EXPORT_LIMIT_EXCEEDED',
          'Maximum concurrent exports reached. Please wait for current exports to complete.',
          'medium'
        );
      }

      // Validate configuration
      this.validateExportConfig(config);

      // Get formatter for the specified format
      const formatter = this.getFormatter(config.format);
      
      // Create progress tracker
      const progress: ExportProgress = {
        exportId,
        stage: 'initializing',
        progress: 0,
        currentOperation: 'Initializing export',
        processedItems: 0,
        totalItems: session.logs.length,
        startTime: new Date(startTime)
      };
      
      this.activeExports.set(exportId, progress);
      this.updateProgress(exportId, progress);

      // Emit export started event
      this.eventBus.emit('export:started', {
        sessionId: session.id,
        format: config.format
      });

      // Security scan and sanitization if needed
      const processedSession = await this.processSessionForExport(session, config, exportId);
      
      // Get custom template if specified
      const template = templateName ? this.customTemplates.get(templateName) : undefined;
      
      // Format the session data
      this.updateProgress(exportId, { ...progress, stage: 'formatting', progress: 70, currentOperation: 'Formatting data' });
      const formattedData = await formatter.format(processedSession, config, template);
      
      // Create export result
      const exportResult: ExportResult = {
        id: exportId,
        data: formattedData,
        format: config.format,
        size: new Blob([formattedData]).size,
        timestamp: new Date(),
        containsSanitizedData: processedSession.logs.some(log => log.sanitizedMessage !== undefined),
        config,
        sessionId: session.id,
        warnings: []
      };

      // Finalize export
      this.updateProgress(exportId, { 
        ...progress, 
        stage: 'complete', 
        progress: 100, 
        currentOperation: 'Export completed',
        estimatedCompletion: new Date()
      });
      
      // Update statistics
      this.updateExportStatistics(exportResult, Date.now() - startTime, true);
      
      // Store in history
      this.storeExportResult(exportResult);
      
      // Clean up active export tracking
      this.activeExports.delete(exportId);

      // Emit completion event
      this.eventBus.emit('export:completed', {
        sessionId: session.id,
        format: config.format,
        size: exportResult.size
      });

      return exportResult;

    } catch (error) {
      // Handle export failure
      this.activeExports.delete(exportId);
      this.updateExportStatistics(null, Date.now() - startTime, false);
      
      const exportError = error instanceof Error ? error : this.createExportError(
        'EXPORT_UNKNOWN_ERROR',
        'Unknown error occurred during export',
        'high'
      );

      // Emit failure event
      this.eventBus.emit('export:failed', {
        sessionId: session.id,
        format: config.format,
        error: exportError.message
      });

      throw exportError;
    }
  }

  /**
   * Gets export progress for active exports
   * @param exportId - Optional specific export ID
   * @returns Export progress information
   */
  public getExportProgress(exportId?: string): ExportProgress[] {
    if (exportId) {
      const progress = this.activeExports.get(exportId);
      return progress ? [progress] : [];
    }
    
    return Array.from(this.activeExports.values());
  }

  /**
   * Cancels an active export
   * @param exportId - Export ID to cancel
   * @returns Whether export was successfully cancelled
   */
  public cancelExport(exportId: string): boolean {
    const progress = this.activeExports.get(exportId);
    
    if (progress && progress.stage !== 'complete') {
      this.activeExports.delete(exportId);
      
      // Emit cancellation event
      this.eventBus.emit('export:failed', {
        sessionId: 'unknown',
        format: 'json',
        error: 'Export cancelled by user'
      });
      
      return true;
    }
    
    return false;
  }

  /**
   * Registers a custom export template
   * @param template - Template configuration
   */
  public registerTemplate(template: ExportTemplate): void {
    this.validateTemplate(template);
    this.customTemplates.set(template.name, template);
  }

  /**
   * Gets available templates for a format
   * @param format - Export format
   * @returns Array of available templates
   */
  public getTemplates(format?: ExportFormat): ExportTemplate[] {
    const templates = Array.from(this.customTemplates.values());
    
    if (format) {
      return templates.filter(template => template.format === format);
    }
    
    return templates;
  }

  /**
   * Gets export statistics and performance metrics
   * @returns Current export statistics
   */
  public getStatistics(): ExportStatistics {
    return { ...this.statistics };
  }

  /**
   * Gets export history
   * @param limit - Maximum number of results
   * @param format - Optional format filter
   * @returns Array of export results
   */
  public getExportHistory(limit: number = 50, format?: ExportFormat): ExportResult[] {
    const results = Array.from(this.exportHistory.values())
      .filter(result => !format || result.format === format)
      .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime())
      .slice(0, limit);
    
    return results;
  }

  /**
   * Clears export history
   * @param olderThan - Optional date to clear entries older than
   * @returns Number of entries cleared
   */
  public clearHistory(olderThan?: Date): number {
    let cleared = 0;
    
    for (const [id, result] of this.exportHistory.entries()) {
      if (!olderThan || result.timestamp < olderThan) {
        this.exportHistory.delete(id);
        cleared++;
      }
    }
    
    return cleared;
  }

  /**
   * Gets supported export formats
   * @returns Array of supported formats
   */
  public getSupportedFormats(): ExportFormat[] {
    return Array.from(this.formatters.keys());
  }

  /**
   * Validates export configuration for a specific format
   * @param config - Configuration to validate
   * @returns Array of validation errors (empty if valid)
   */
  public validateExportConfig(config: ExportConfig): string[] {
    const errors: string[] = [];
    
    // Check if format is supported
    if (!this.formatters.has(config.format)) {
      errors.push(`Unsupported export format: ${config.format}`);
      return errors;
    }
    
    // Get formatter-specific validation
    const formatter = this.formatters.get(config.format)!;
    const formatterErrors = formatter.validateConfig(config);
    errors.push(...formatterErrors);
    
    return errors;
  }

  /**
   * Estimates export size for a session and configuration
   * @param session - Session to estimate
   * @param config - Export configuration
   * @returns Estimated size in bytes
   */
  public estimateExportSize(session: CaptureSession, config: ExportConfig): number {
    const formatter = this.formatters.get(config.format);
    
    if (!formatter) {
      return 0;
    }
    
    return formatter.estimateSize(session, config);
  }

  /**
   * Initializes all supported export formatters
   * @private
   */
  private initializeFormatters(): void {
    // Initialize built-in formatters
    const jsonFormatter = new JsonFormatter();
    const markdownFormatter = new MarkdownFormatter();
    // const githubIssueFormatter = new GitHubIssueFormatter();
    
    this.formatters.set(jsonFormatter.format, jsonFormatter);
    this.formatters.set(markdownFormatter.format, markdownFormatter);
    // this.formatters.set(githubIssueFormatter.format, githubIssueFormatter);
    
    // Initialize format statistics
    for (const format of this.formatters.keys()) {
      this.statistics.exportsByFormat[format] = 0;
    }
  }

  /**
   * Sets up event listeners for export operations
   * @private
   */
  private setupEventListeners(): void {
    // Listen for security events during exports
    this.eventBus.on('security:sanitization-applied', (payload) => {
      this.statistics.sanitization.totalSanitizations++;
      // Update sanitization statistics if this is during an export
    });
  }

  /**
   * Processes a session for export with security scanning and sanitization
   * @param session - Original session
   * @param config - Export configuration
   * @param exportId - Export identifier for progress tracking
   * @returns Processed session ready for export
   * @private
   */
  private async processSessionForExport(
    session: CaptureSession,
    config: ExportConfig,
    exportId: string
  ): Promise<CaptureSession> {
    const progress = this.activeExports.get(exportId)!;
    
    // Create a copy of the session to avoid modifying the original
    const processedSession: CaptureSession = {
      ...session,
      logs: [...session.logs]
    };

    // Security processing if sensitive data handling is enabled
    if (config.includeSensitiveData === false) {
      this.updateProgress(exportId, { 
        ...progress, 
        stage: 'sanitizing', 
        progress: 20, 
        currentOperation: 'Scanning for sensitive data' 
      });

      // Batch process logs for PII detection and sanitization
      const batchSize = 10;
      for (let i = 0; i < processedSession.logs.length; i += batchSize) {
        const batch = processedSession.logs.slice(i, i + batchSize);
        
        // Scan each log entry
        for (const log of batch) {
          try {
            const scanResult = await this.securityEngine.scanLogEntry(log, {
              purpose: 'export_functionality' as ProcessingPurpose,
              autoSanitize: true,
              minConfidence: 0.7
            });
            
            // Update sanitization statistics
            if (scanResult.detections.length > 0) {
              for (const detection of scanResult.detections) {
                this.statistics.sanitization.sanitizationsByType[detection.type] = 
                  (this.statistics.sanitization.sanitizationsByType[detection.type] || 0) + 1;
              }
            }
          } catch (error) {
            // Log security processing errors but continue with export
            console.warn(`Security processing failed for log entry ${log.id}:`, error);
          }
        }
        
        // Update progress
        const processedItems = Math.min(i + batchSize, processedSession.logs.length);
        const progressPercentage = 20 + (processedItems / processedSession.logs.length) * 30; // 20-50%
        
        this.updateProgress(exportId, {
          ...progress,
          progress: progressPercentage,
          processedItems,
          currentOperation: `Processed ${processedItems}/${processedSession.logs.length} log entries`
        });
        
        // Yield control to prevent blocking
        await new Promise(resolve => setTimeout(resolve, 1));
      }
    }

    // Filter out stack traces if not included
    if (!config.includeStackTraces) {
      for (const log of processedSession.logs) {
        delete log.stackTrace;
      }
    }

    // Filter out context if not included
    if (!config.includeContext) {
      delete processedSession.context.networkRequests;
      delete processedSession.context.performance;
    }

    // Filter out performance metrics if not included
    if (!config.includePerformance) {
      delete processedSession.context.performance;
    }

    this.updateProgress(exportId, { 
      ...progress, 
      stage: 'processing', 
      progress: 60, 
      currentOperation: 'Preparing data for formatting' 
    });

    return processedSession;
  }

  /**
   * Gets formatter for a specific format
   * @param format - Export format
   * @returns Export formatter instance
   * @private
   */
  private getFormatter(format: ExportFormat): ExportFormatter {
    const formatter = this.formatters.get(format);
    
    if (!formatter) {
      throw this.createExportError(
        'FORMATTER_NOT_FOUND',
        `No formatter available for format: ${format}`,
        'high'
      );
    }
    
    return formatter;
  }

  /**
   * Updates export progress and emits events
   * @param exportId - Export identifier
   * @param progress - Progress information
   * @private
   */
  private updateProgress(exportId: string, progress: Partial<ExportProgress>): void {
    const currentProgress = this.activeExports.get(exportId);
    
    if (currentProgress) {
      const updatedProgress = { ...currentProgress, ...progress };
      this.activeExports.set(exportId, updatedProgress);
      
      // Emit progress event (Note: This would need to be added to EventBus types)
      // For now, we'll use a generic extension event
    }
  }

  /**
   * Updates export statistics
   * @param result - Export result (null for failed exports)
   * @param timeMs - Export time in milliseconds
   * @param success - Whether export was successful
   * @private
   */
  private updateExportStatistics(result: ExportResult | null, timeMs: number, success: boolean): void {
    this.statistics.totalExports++;
    
    if (success && result) {
      this.statistics.successfulExports++;
      this.statistics.exportsByFormat[result.format]++;
      
      // Update performance metrics
      const currentAvg = this.statistics.performance.averageTimeMs;
      const totalSuccessful = this.statistics.reliability.successfulExports;
      
      this.statistics.performance.averageTimeMs = 
        (currentAvg * (totalSuccessful - 1) + timeMs) / totalSuccessful;
      
      this.statistics.performance.minTimeMs = Math.min(this.statistics.performance.minTimeMs, timeMs);
      this.statistics.performance.maxTimeMs = Math.max(this.statistics.performance.maxTimeMs, timeMs);
      
      // Update average size
      const currentSizeAvg = this.statistics.performance.averageSize;
      this.statistics.performance.averageSize = 
        (currentSizeAvg * (totalSuccessful - 1) + result.size) / totalSuccessful;
        
    } else {
      this.statistics.reliability.failedExports++;
    }
    
    // Recalculate success rate
    this.statistics.reliability.successRate = 
      this.statistics.reliability.successfulExports / this.statistics.totalExports;
  }

  /**
   * Stores export result in history with size limits
   * @param result - Export result to store
   * @private
   */
  private storeExportResult(result: ExportResult): void {
    this.exportHistory.set(result.id, result);
    
    // Maintain history size limit
    if (this.exportHistory.size > this.maxHistorySize) {
      // Remove oldest entries
      const entries = Array.from(this.exportHistory.entries())
        .sort(([, a], [, b]) => a.timestamp.getTime() - b.timestamp.getTime());
      
      const toRemove = entries.slice(0, this.exportHistory.size - this.maxHistorySize);
      
      for (const [id] of toRemove) {
        this.exportHistory.delete(id);
      }
    }
  }

  /**
   * Validates a custom template configuration
   * @param template - Template to validate
   * @private
   */
  private validateTemplate(template: ExportTemplate): void {
    if (!template.name || typeof template.name !== 'string') {
      throw this.createExportError(
        'INVALID_TEMPLATE',
        'Template name is required and must be a string',
        'medium'
      );
    }
    
    if (!this.formatters.has(template.format)) {
      throw this.createExportError(
        'INVALID_TEMPLATE',
        `Template format '${template.format}' is not supported`,
        'medium'
      );
    }
    
    if (!template.template || typeof template.template !== 'string') {
      throw this.createExportError(
        'INVALID_TEMPLATE',
        'Template content is required and must be a string',
        'medium'
      );
    }
  }

  /**
   * Creates a standardized export error
   * @param code - Error code
   * @param message - Error message
   * @param severity - Error severity
   * @returns ExtensionError instance
   * @private
   */
  private createExportError(code: string, message: string, severity: 'low' | 'medium' | 'high' | 'critical'): ExtensionError {
    return {
      name: 'ExportError',
      message,
      code,
      severity,
      reportable: true,
      context: {
        component: 'ExportManager',
        timestamp: new Date().toISOString()
      }
    } as ExtensionError;
  }

  /**
   * Generates unique export identifier
   * @returns Unique export ID
   * @private
   */
  private generateExportId(): string {
    return `export_${Date.now()}_${Math.random().toString(36).substring(2)}`;
  }
}