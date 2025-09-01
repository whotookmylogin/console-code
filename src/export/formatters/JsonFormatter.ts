/**
 * JsonFormatter.ts
 * Export formatter for JSON format - exports capture sessions as structured JSON
 * Includes metadata, logs, context, and performance data with clean, parseable output
 * Handles data sanitization and filtering based on configuration
 */

import type {
  CaptureSession,
  ExportConfig,
  ExtensionError,
  LogEntry,
  SessionContext,
  SessionMetadata,
  PerformanceMetrics,
  NetworkRequest
} from '../../types/index.js';

import type { ExportFormatter, ExportTemplate } from '../ExportManager.js';

/**
 * JSON export schema version for compatibility tracking
 */
const JSON_EXPORT_SCHEMA_VERSION = '1.0.0';

/**
 * JSON export metadata
 */
interface JsonExportMetadata {
  /** Schema version for compatibility */
  schemaVersion: string;
  /** Export timestamp */
  exportedAt: string;
  /** Exporter information */
  exportedBy: {
    extension: string;
    version: string;
  };
  /** Export configuration used */
  exportConfig: ExportConfig;
  /** Data processing notes */
  processingNotes: string[];
}

/**
 * Complete JSON export structure
 */
interface JsonExportData {
  /** Export metadata */
  metadata: JsonExportMetadata;
  /** Session information */
  session: {
    id: string;
    startTime: string;
    endTime?: string;
    duration?: number;
    metadata: SessionMetadata;
  };
  /** Session context (filtered based on config) */
  context?: Partial<SessionContext>;
  /** Log entries (sanitized based on config) */
  logs: Array<Partial<LogEntry>>;
  /** Performance metrics (if included) */
  performance?: PerformanceMetrics;
  /** Network requests (if included) */
  networkRequests?: NetworkRequest[];
  /** Export statistics */
  statistics: {
    totalLogs: number;
    logsByLevel: Record<string, number>;
    sanitizedLogs: number;
    dataSize: {
      originalBytes: number;
      exportedBytes: number;
      compressionRatio: number;
    };
  };
}

/**
 * JSON export formatting options
 */
interface JsonFormattingOptions {
  /** Pretty print with indentation */
  prettyPrint: boolean;
  /** Indentation string (spaces or tabs) */
  indent: string;
  /** Include null values */
  includeNulls: boolean;
  /** Maximum depth for nested objects */
  maxDepth: number;
  /** Include metadata section */
  includeMetadata: boolean;
  /** Include statistics section */
  includeStatistics: boolean;
}

/**
 * JSON export formatter implementation
 * Exports capture sessions as structured, parseable JSON with comprehensive metadata
 */
export class JsonFormatter implements ExportFormatter {
  /** Supported export format */
  public readonly format = 'json' as const;
  
  /** Default formatting options */
  private readonly defaultOptions: JsonFormattingOptions = {
    prettyPrint: true,
    indent: '  ',
    includeNulls: false,
    maxDepth: 10,
    includeMetadata: true,
    includeStatistics: true
  };

  /**
   * Formats a capture session as JSON
   * @param session - Session to format
   * @param config - Export configuration
   * @param template - Optional custom template (for JSON schema customization)
   * @returns Promise resolving to formatted JSON string
   */
  public async format(
    session: CaptureSession,
    config: ExportConfig,
    template?: ExportTemplate
  ): Promise<string> {
    try {
      // Parse custom formatting options from template if provided
      const formattingOptions = this.parseFormattingOptions(template);
      
      // Build the JSON export data structure
      const exportData = await this.buildExportData(session, config, formattingOptions);
      
      // Apply custom JSON schema if template provides one
      if (template && template.template) {
        const customData = this.applyCustomTemplate(exportData, template);
        return this.stringifyJson(customData, formattingOptions);
      }
      
      // Return standard JSON format
      return this.stringifyJson(exportData, formattingOptions);
      
    } catch (error) {
      throw this.createJsonError(
        'JSON_FORMAT_ERROR',
        `Failed to format session as JSON: ${error instanceof Error ? error.message : 'Unknown error'}`,
        'high',
        { sessionId: session.id, error }
      );
    }
  }

  /**
   * Validates export configuration for JSON format
   * @param config - Configuration to validate
   * @returns Array of validation errors (empty if valid)
   */
  public validateConfig(config: ExportConfig): string[] {
    const errors: string[] = [];
    
    // JSON format supports all configuration options
    if (config.format !== 'json') {
      errors.push('Configuration format must be "json"');
    }
    
    // Validate formatting options if provided
    if (config.formatting) {
      // All formatting options are optional for JSON
      // JSON formatter is very flexible
    }
    
    return errors;
  }

  /**
   * Gets default configuration for JSON format
   * @returns Default export configuration
   */
  public getDefaultConfig(): Partial<ExportConfig> {
    return {
      format: 'json',
      includeSensitiveData: false,
      includeStackTraces: true,
      includeContext: true,
      includePerformance: true,
      formatting: {
        timestamps: true,
        logLevels: true,
        sourceInfo: true
      }
    };
  }

  /**
   * Estimates output size for a session
   * @param session - Session to estimate
   * @param config - Export configuration
   * @returns Estimated size in bytes
   */
  public estimateSize(session: CaptureSession, config: ExportConfig): number {
    let estimatedSize = 0;
    
    // Base JSON structure overhead
    estimatedSize += 500; // metadata, session info, etc.
    
    // Estimate log entries size
    for (const log of session.logs) {
      let logSize = 200; // Base log entry structure
      
      // Message content
      const messageToUse = config.includeSensitiveData && log.sanitizedMessage 
        ? log.sanitizedMessage 
        : log.message;
      logSize += messageToUse.length * 1.2; // JSON escaping overhead
      
      // Stack trace if included
      if (config.includeStackTraces && log.stackTrace) {
        logSize += log.stackTrace.length * 1.2;
      }
      
      // Source info if included
      if (config.formatting?.sourceInfo && log.source) {
        logSize += 100;
      }
      
      estimatedSize += logSize;
    }
    
    // Context data if included
    if (config.includeContext) {
      estimatedSize += 300; // Basic context
      
      if (session.context.networkRequests) {
        estimatedSize += session.context.networkRequests.length * 150;
      }
    }
    
    // Performance metrics if included
    if (config.includePerformance && session.context.performance) {
      estimatedSize += 200;
    }
    
    // Pretty printing overhead (approximately 30% increase)
    estimatedSize *= 1.3;
    
    return Math.round(estimatedSize);
  }

  /**
   * Builds the complete JSON export data structure
   * @param session - Session to export
   * @param config - Export configuration
   * @param options - Formatting options
   * @returns Complete export data structure
   * @private
   */
  private async buildExportData(
    session: CaptureSession,
    config: ExportConfig,
    options: JsonFormattingOptions
  ): Promise<JsonExportData> {
    const processingNotes: string[] = [];
    
    // Build metadata section
    const metadata: JsonExportMetadata = {
      schemaVersion: JSON_EXPORT_SCHEMA_VERSION,
      exportedAt: new Date().toISOString(),
      exportedBy: {
        extension: 'ConsoleCapture Pro',
        version: '1.0.0' // This should come from package.json or config
      },
      exportConfig: config,
      processingNotes
    };

    // Build session information
    const sessionData = {
      id: session.id,
      startTime: session.startTime.toISOString(),
      endTime: session.endTime?.toISOString(),
      duration: session.endTime 
        ? session.endTime.getTime() - session.startTime.getTime()
        : undefined,
      metadata: session.metadata
    };

    // Process context data based on configuration
    let contextData: Partial<SessionContext> | undefined;
    if (config.includeContext) {
      contextData = {
        url: session.context.url,
        title: session.context.title,
        userAgent: session.context.userAgent,
        viewport: session.context.viewport,
        versions: session.context.versions
      };
      
      if (session.context.networkRequests) {
        contextData.networkRequests = session.context.networkRequests;
      }
      
      if (config.includePerformance && session.context.performance) {
        contextData.performance = session.context.performance;
      }
    }

    // Process log entries based on configuration
    const processedLogs = this.processLogEntries(session.logs, config, processingNotes);
    
    // Extract performance metrics
    const performanceData = config.includePerformance ? session.context.performance : undefined;
    const networkRequests = config.includeContext ? session.context.networkRequests : undefined;

    // Calculate statistics
    const statistics = this.calculateExportStatistics(session, processedLogs, config);

    // Build the complete export structure
    const exportData: JsonExportData = {
      metadata: options.includeMetadata ? metadata : {} as JsonExportMetadata,
      session: sessionData,
      context: contextData,
      logs: processedLogs,
      performance: performanceData,
      networkRequests: networkRequests,
      statistics: options.includeStatistics ? statistics : {} as any
    };

    // Clean up undefined values if not including nulls
    if (!options.includeNulls) {
      this.removeUndefinedValues(exportData);
    }

    return exportData;
  }

  /**
   * Processes log entries based on export configuration
   * @param logs - Original log entries
   * @param config - Export configuration
   * @param processingNotes - Notes about processing actions
   * @returns Processed log entries
   * @private
   */
  private processLogEntries(
    logs: LogEntry[],
    config: ExportConfig,
    processingNotes: string[]
  ): Array<Partial<LogEntry>> {
    return logs.map(log => {
      const processedLog: Partial<LogEntry> = {
        id: log.id,
        level: log.level
      };

      // Add timestamp if configured
      if (config.formatting?.timestamps !== false) {
        processedLog.timestamp = log.timestamp;
      }

      // Handle message content and sanitization
      if (!config.includeSensitiveData && log.sanitizedMessage) {
        processedLog.message = log.sanitizedMessage;
        processingNotes.push(`Log ${log.id}: Used sanitized message`);
      } else {
        processedLog.message = log.message;
      }

      // Include stack trace if configured
      if (config.includeStackTraces && log.stackTrace) {
        processedLog.stackTrace = log.stackTrace;
      }

      // Include source information if configured
      if (config.formatting?.sourceInfo !== false && log.source) {
        processedLog.source = log.source;
      }

      // Include classification information
      if (log.classification) {
        processedLog.classification = log.classification;
      }

      return processedLog;
    });
  }

  /**
   * Calculates export statistics
   * @param session - Original session
   * @param processedLogs - Processed log entries
   * @param config - Export configuration
   * @returns Export statistics
   * @private
   */
  private calculateExportStatistics(
    session: CaptureSession,
    processedLogs: Array<Partial<LogEntry>>,
    config: ExportConfig
  ): JsonExportData['statistics'] {
    // Count logs by level
    const logsByLevel: Record<string, number> = {};
    for (const log of session.logs) {
      logsByLevel[log.level] = (logsByLevel[log.level] || 0) + 1;
    }

    // Count sanitized logs
    const sanitizedLogs = session.logs.filter(log => log.sanitizedMessage !== undefined).length;

    // Calculate data sizes (approximate)
    const originalSize = JSON.stringify(session).length;
    const exportedSize = JSON.stringify({ logs: processedLogs }).length;
    const compressionRatio = originalSize > 0 ? exportedSize / originalSize : 1;

    return {
      totalLogs: session.logs.length,
      logsByLevel,
      sanitizedLogs,
      dataSize: {
        originalBytes: originalSize,
        exportedBytes: exportedSize,
        compressionRatio
      }
    };
  }

  /**
   * Applies custom JSON template to export data
   * @param exportData - Standard export data
   * @param template - Custom template
   * @returns Customized export data
   * @private
   */
  private applyCustomTemplate(exportData: JsonExportData, template: ExportTemplate): any {
    try {
      // Parse template as JSON schema or transformation rules
      const templateConfig = JSON.parse(template.template);
      
      // Apply template transformations
      if (templateConfig.schema) {
        // Apply custom schema structure
        return this.transformDataToSchema(exportData, templateConfig.schema);
      } else if (templateConfig.fields) {
        // Apply field filtering/mapping
        return this.filterFields(exportData, templateConfig.fields);
      }
      
      // Return original data if template doesn't specify transformations
      return exportData;
      
    } catch (error) {
      // If template parsing fails, return original data
      console.warn('Failed to parse JSON template:', error);
      return exportData;
    }
  }

  /**
   * Transforms data to match custom schema
   * @param data - Original data
   * @param schema - Target schema
   * @returns Transformed data
   * @private
   */
  private transformDataToSchema(data: JsonExportData, schema: any): any {
    // Basic schema transformation - can be extended for more complex schemas
    const result: any = {};
    
    for (const [key, value] of Object.entries(schema)) {
      if (typeof value === 'string' && value.startsWith('$')) {
        // Variable reference - extract from original data
        const path = value.substring(1).split('.');
        result[key] = this.getNestedValue(data, path);
      } else if (typeof value === 'object' && value !== null) {
        // Nested object - recursively transform
        result[key] = this.transformDataToSchema(data, value);
      } else {
        // Static value
        result[key] = value;
      }
    }
    
    return result;
  }

  /**
   * Filters fields based on template configuration
   * @param data - Original data
   * @param fields - Fields to include/exclude
   * @returns Filtered data
   * @private
   */
  private filterFields(data: JsonExportData, fields: any): any {
    if (Array.isArray(fields)) {
      // Include only specified fields
      const result: any = {};
      for (const field of fields) {
        if (field in data) {
          result[field] = (data as any)[field];
        }
      }
      return result;
    } else if (typeof fields === 'object') {
      // Use field mapping
      const result: any = {};
      for (const [targetField, sourceField] of Object.entries(fields)) {
        if (typeof sourceField === 'string' && sourceField in data) {
          result[targetField] = (data as any)[sourceField];
        }
      }
      return result;
    }
    
    return data;
  }

  /**
   * Gets nested value from object using path
   * @param obj - Source object
   * @param path - Property path array
   * @returns Nested value or undefined
   * @private
   */
  private getNestedValue(obj: any, path: string[]): any {
    let current = obj;
    for (const key of path) {
      if (current && typeof current === 'object' && key in current) {
        current = current[key];
      } else {
        return undefined;
      }
    }
    return current;
  }

  /**
   * Parses formatting options from template
   * @param template - Custom template
   * @returns Formatting options
   * @private
   */
  private parseFormattingOptions(template?: ExportTemplate): JsonFormattingOptions {
    const options = { ...this.defaultOptions };
    
    if (template?.variables) {
      // Parse formatting options from template variables
      if (template.variables.prettyPrint !== undefined) {
        options.prettyPrint = template.variables.prettyPrint === 'true';
      }
      if (template.variables.indent) {
        options.indent = template.variables.indent.replace('\\t', '\t');
      }
      if (template.variables.includeNulls !== undefined) {
        options.includeNulls = template.variables.includeNulls === 'true';
      }
      if (template.variables.maxDepth) {
        options.maxDepth = parseInt(template.variables.maxDepth, 10) || 10;
      }
      if (template.variables.includeMetadata !== undefined) {
        options.includeMetadata = template.variables.includeMetadata === 'true';
      }
      if (template.variables.includeStatistics !== undefined) {
        options.includeStatistics = template.variables.includeStatistics === 'true';
      }
    }
    
    return options;
  }

  /**
   * Converts data to JSON string with formatting options
   * @param data - Data to stringify
   * @param options - Formatting options
   * @returns JSON string
   * @private
   */
  private stringifyJson(data: any, options: JsonFormattingOptions): string {
    const replacer = options.includeNulls 
      ? null 
      : (key: string, value: any) => value === undefined ? undefined : value;
    
    const space = options.prettyPrint ? options.indent : undefined;
    
    return JSON.stringify(data, replacer, space);
  }

  /**
   * Removes undefined values from object recursively
   * @param obj - Object to clean
   * @private
   */
  private removeUndefinedValues(obj: any): void {
    if (obj && typeof obj === 'object') {
      if (Array.isArray(obj)) {
        // Clean array elements
        for (let i = 0; i < obj.length; i++) {
          if (obj[i] === undefined) {
            obj.splice(i, 1);
            i--;
          } else if (typeof obj[i] === 'object') {
            this.removeUndefinedValues(obj[i]);
          }
        }
      } else {
        // Clean object properties
        for (const key in obj) {
          if (obj[key] === undefined) {
            delete obj[key];
          } else if (typeof obj[key] === 'object') {
            this.removeUndefinedValues(obj[key]);
          }
        }
      }
    }
  }

  /**
   * Creates a standardized JSON formatting error
   * @param code - Error code
   * @param message - Error message
   * @param severity - Error severity
   * @param context - Additional context
   * @returns ExtensionError instance
   * @private
   */
  private createJsonError(
    code: string,
    message: string,
    severity: 'low' | 'medium' | 'high' | 'critical',
    context?: Record<string, unknown>
  ): ExtensionError {
    return {
      name: 'JsonFormatterError',
      message,
      code,
      severity,
      reportable: true,
      context: {
        component: 'JsonFormatter',
        timestamp: new Date().toISOString(),
        ...context
      }
    } as ExtensionError;
  }
}