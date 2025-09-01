/**
 * Configuration Manager - Manages extension configuration with type safety
 * Handles config persistence to browser storage, validation using Zod schemas,
 * emits events when config changes, and implements default configuration values
 */

import { z } from 'zod';
import type { ExtensionConfig, ExtensionError, LogLevel, ExportFormat } from '../types';
import type { EventBus } from './EventBus';

/**
 * Zod schema for LogLevel validation
 */
const LogLevelSchema = z.enum(['log', 'info', 'warn', 'error', 'debug']);

/**
 * Zod schema for ExportFormat validation
 */
const ExportFormatSchema = z.enum(['json', 'markdown', 'csv', 'github-issue', 'slack-message', 'plain-text']);

/**
 * Comprehensive Zod schema for ExtensionConfig validation
 */
const ExtensionConfigSchema = z.object({
  captureEnabled: z.boolean(),
  capturedLevels: z.array(LogLevelSchema),
  maxLogsRetained: z.number().min(1).max(100000),
  autoCaptureOnLoad: z.boolean(),
  privacy: z.object({
    enablePIIDetection: z.boolean(),
    piiSensitivity: z.number().min(0).max(1),
    autoSanitize: z.boolean(),
    dataRetentionHours: z.number().min(1).max(8760) // Max 1 year
  }),
  performance: z.object({
    enableMonitoring: z.boolean(),
    maxMemoryMB: z.number().min(1).max(1024),
    throttleMs: z.number().min(0).max(5000)
  }),
  export: z.object({
    defaultFormat: ExportFormatSchema,
    includeMetadata: z.boolean()
  })
});

/**
 * Default configuration values for the extension
 */
const DEFAULT_CONFIG: ExtensionConfig = {
  captureEnabled: true,
  capturedLevels: ['error', 'warn', 'info', 'log'],
  maxLogsRetained: 1000,
  autoCaptureOnLoad: false,
  privacy: {
    enablePIIDetection: true,
    piiSensitivity: 0.8,
    autoSanitize: true,
    dataRetentionHours: 168 // 1 week
  },
  performance: {
    enableMonitoring: true,
    maxMemoryMB: 64,
    throttleMs: 100
  },
  export: {
    defaultFormat: 'json',
    includeMetadata: true
  }
};

/**
 * Storage key for configuration in browser storage
 */
const CONFIG_STORAGE_KEY = 'consoleCapturePro:config';

/**
 * Configuration manager that handles all extension settings
 */
export class ConfigManager {
  private config: ExtensionConfig;
  private eventBus: EventBus;
  private isInitialized: boolean = false;

  /**
   * Creates a new ConfigManager instance
   * @param eventBus - Event bus for emitting configuration change events
   */
  constructor(eventBus: EventBus) {
    this.eventBus = eventBus;
    this.config = { ...DEFAULT_CONFIG };
  }

  /**
   * Initializes the configuration manager
   * Loads configuration from storage and validates it
   * @returns Promise that resolves when initialization is complete
   * @throws {ExtensionError} When initialization fails
   */
  async initialize(): Promise<void> {
    try {
      await this.loadConfiguration();
      this.isInitialized = true;
      this.eventBus.emit('config:initialized', { config: this.config });
    } catch (error) {
      const extensionError: ExtensionError = {
        name: 'ConfigInitializationError',
        message: `Failed to initialize configuration manager: ${error instanceof Error ? error.message : 'Unknown error'}`,
        code: 'CONFIG_INIT_FAILED',
        severity: 'high',
        reportable: true,
        context: { originalError: error }
      };
      throw extensionError;
    }
  }

  /**
   * Gets the current extension configuration
   * @returns Current configuration object
   * @throws {ExtensionError} When not initialized
   */
  getConfig(): ExtensionConfig {
    this.ensureInitialized();
    return { ...this.config };
  }

  /**
   * Updates the extension configuration with partial updates
   * Validates changes and persists to storage
   * @param updates - Partial configuration updates to apply
   * @returns Promise that resolves when configuration is updated
   * @throws {ExtensionError} When validation or persistence fails
   */
  async updateConfig(updates: Partial<ExtensionConfig>): Promise<void> {
    this.ensureInitialized();
    
    try {
      // Create merged configuration
      const mergedConfig = this.deepMerge(this.config, updates);
      
      // Validate the merged configuration
      const validationResult = ExtensionConfigSchema.safeParse(mergedConfig);
      
      if (!validationResult.success) {
        throw new Error(`Configuration validation failed: ${this.formatZodError(validationResult.error)}`);
      }

      const oldConfig = { ...this.config };
      this.config = validationResult.data;

      // Persist to storage
      await this.saveConfiguration();

      // Emit configuration change event
      this.eventBus.emit('config:updated', {
        config: this.config,
        previousConfig: oldConfig,
        changes: updates
      });

    } catch (error) {
      const extensionError: ExtensionError = {
        name: 'ConfigUpdateError',
        message: `Failed to update configuration: ${error instanceof Error ? error.message : 'Unknown error'}`,
        code: 'CONFIG_UPDATE_FAILED',
        severity: 'medium',
        reportable: true,
        context: { 
          originalError: error,
          attemptedUpdates: updates
        }
      };
      throw extensionError;
    }
  }

  /**
   * Resets configuration to default values
   * @returns Promise that resolves when configuration is reset
   * @throws {ExtensionError} When reset fails
   */
  async resetConfig(): Promise<void> {
    this.ensureInitialized();
    
    try {
      const oldConfig = { ...this.config };
      this.config = { ...DEFAULT_CONFIG };
      
      await this.saveConfiguration();
      
      this.eventBus.emit('config:reset', {
        config: this.config,
        previousConfig: oldConfig
      });
      
    } catch (error) {
      const extensionError: ExtensionError = {
        name: 'ConfigResetError',
        message: `Failed to reset configuration: ${error instanceof Error ? error.message : 'Unknown error'}`,
        code: 'CONFIG_RESET_FAILED',
        severity: 'medium',
        reportable: true,
        context: { originalError: error }
      };
      throw extensionError;
    }
  }

  /**
   * Validates a configuration object against the schema
   * @param config - Configuration to validate
   * @returns Validation result with success status and data/errors
   */
  validateConfig(config: unknown): { success: boolean; data?: ExtensionConfig; errors?: string[] } {
    const result = ExtensionConfigSchema.safeParse(config);
    
    if (result.success) {
      return { success: true, data: result.data };
    } else {
      return { 
        success: false, 
        errors: result.error.issues.map(issue => 
          `${issue.path.join('.')}: ${issue.message}`
        )
      };
    }
  }

  /**
   * Gets the default configuration values
   * @returns Default configuration object
   */
  getDefaultConfig(): ExtensionConfig {
    return { ...DEFAULT_CONFIG };
  }

  /**
   * Exports current configuration for backup or migration
   * @returns Promise that resolves to serialized configuration
   */
  async exportConfig(): Promise<string> {
    this.ensureInitialized();
    
    try {
      const exportData = {
        version: '1.0',
        timestamp: new Date().toISOString(),
        config: this.config
      };
      
      return JSON.stringify(exportData, null, 2);
    } catch (error) {
      const extensionError: ExtensionError = {
        name: 'ConfigExportError',
        message: `Failed to export configuration: ${error instanceof Error ? error.message : 'Unknown error'}`,
        code: 'CONFIG_EXPORT_FAILED',
        severity: 'low',
        reportable: false,
        context: { originalError: error }
      };
      throw extensionError;
    }
  }

  /**
   * Imports configuration from exported data
   * @param configData - Serialized configuration data
   * @returns Promise that resolves when configuration is imported
   * @throws {ExtensionError} When import fails
   */
  async importConfig(configData: string): Promise<void> {
    this.ensureInitialized();
    
    try {
      const importData = JSON.parse(configData);
      
      if (!importData.config) {
        throw new Error('Invalid import data: missing config property');
      }

      // Validate imported configuration
      const validationResult = this.validateConfig(importData.config);
      
      if (!validationResult.success) {
        throw new Error(`Invalid configuration data: ${validationResult.errors?.join(', ')}`);
      }

      await this.updateConfig(validationResult.data!);
      
      this.eventBus.emit('config:imported', {
        config: this.config,
        importVersion: importData.version
      });
      
    } catch (error) {
      const extensionError: ExtensionError = {
        name: 'ConfigImportError',
        message: `Failed to import configuration: ${error instanceof Error ? error.message : 'Unknown error'}`,
        code: 'CONFIG_IMPORT_FAILED',
        severity: 'medium',
        reportable: false,
        context: { 
          originalError: error,
          configData: configData.substring(0, 100) // First 100 chars for context
        }
      };
      throw extensionError;
    }
  }

  /**
   * Cleans up and shuts down the configuration manager
   * @returns Promise that resolves when shutdown is complete
   */
  async shutdown(): Promise<void> {
    if (!this.isInitialized) {
      return;
    }

    try {
      // Ensure final configuration is saved
      await this.saveConfiguration();
      this.isInitialized = false;
      this.eventBus.emit('config:shutdown', { timestamp: new Date() });
    } catch (error) {
      // Log error but don't throw during shutdown
      console.error('ConfigManager shutdown error:', error);
    }
  }

  /**
   * Loads configuration from browser storage
   * @private
   */
  private async loadConfiguration(): Promise<void> {
    try {
      const result = await chrome.storage.local.get(CONFIG_STORAGE_KEY);
      const storedConfig = result[CONFIG_STORAGE_KEY];

      if (storedConfig) {
        // Validate stored configuration
        const validationResult = ExtensionConfigSchema.safeParse(storedConfig);
        
        if (validationResult.success) {
          // Merge with defaults to handle new config properties
          this.config = this.deepMerge(DEFAULT_CONFIG, validationResult.data);
        } else {
          console.warn('Invalid stored configuration, using defaults:', validationResult.error);
          this.config = { ...DEFAULT_CONFIG };
          await this.saveConfiguration(); // Save corrected config
        }
      } else {
        // No stored config, use defaults
        this.config = { ...DEFAULT_CONFIG };
        await this.saveConfiguration();
      }
    } catch (error) {
      console.error('Failed to load configuration from storage:', error);
      this.config = { ...DEFAULT_CONFIG };
    }
  }

  /**
   * Saves current configuration to browser storage
   * @private
   */
  private async saveConfiguration(): Promise<void> {
    try {
      await chrome.storage.local.set({
        [CONFIG_STORAGE_KEY]: this.config
      });
    } catch (error) {
      throw new Error(`Failed to save configuration to storage: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Deep merges two configuration objects
   * @param target - Target object to merge into
   * @param source - Source object to merge from
   * @returns Merged object
   * @private
   */
  private deepMerge(target: any, source: any): any {
    const result = { ...target };
    
    for (const key in source) {
      if (source[key] && typeof source[key] === 'object' && !Array.isArray(source[key])) {
        result[key] = this.deepMerge(target[key] || {}, source[key]);
      } else {
        result[key] = source[key];
      }
    }
    
    return result;
  }

  /**
   * Formats Zod validation errors into human-readable message
   * @param error - Zod error object
   * @returns Formatted error message
   * @private
   */
  private formatZodError(error: z.ZodError): string {
    return error.issues
      .map(issue => `${issue.path.join('.')}: ${issue.message}`)
      .join('; ');
  }

  /**
   * Ensures the configuration manager is initialized
   * @throws {Error} When not initialized
   * @private
   */
  private ensureInitialized(): void {
    if (!this.isInitialized) {
      throw new Error('ConfigManager not initialized. Call initialize() first.');
    }
  }
}