/**
 * MarkdownFormatter.ts
 * Export formatter for Markdown format - creates human-readable reports
 * Includes formatted headers, log tables, and context sections
 * Supports GitHub-flavored markdown syntax with template customization
 */

import type {
  CaptureSession,
  ExportConfig,
  ExtensionError,
  LogEntry,
  LogLevel,
  SessionContext,
  SessionMetadata,
  PerformanceMetrics,
  NetworkRequest
} from '../../types/index.js';

import type { ExportFormatter, ExportTemplate } from '../ExportManager.js';

/**
 * Markdown formatting theme options
 */
interface MarkdownTheme {
  /** Header styles (1-6) */
  headerLevels: {
    title: number;
    section: number;
    subsection: number;
  };
  /** Table styling options */
  tables: {
    useHeaderSeparators: boolean;
    alignColumns: boolean;
    includeRowNumbers: boolean;
  };
  /** Code block styling */
  codeBlocks: {
    language: string;
    useBackticks: boolean;
    indentSize: number;
  };
  /** List formatting */
  lists: {
    bulletChar: string;
    numberFormat: string;
    indentSize: number;
  };
}

/**
 * Markdown section configuration
 */
interface MarkdownSection {
  /** Section identifier */
  id: string;
  /** Section title */
  title: string;
  /** Whether section is enabled */
  enabled: boolean;
  /** Section order */
  order: number;
  /** Custom content generator */
  contentGenerator?: (session: CaptureSession, config: ExportConfig) => string;
}

/**
 * Log level styling for markdown
 */
interface LogLevelStyle {
  /** Emoji or symbol to display */
  symbol: string;
  /** Text color (if supported) */
  color?: string;
  /** Background color (if supported) */
  backgroundColor?: string;
  /** Bold text */
  bold: boolean;
}

/**
 * Markdown export formatter implementation
 * Creates human-readable reports with comprehensive formatting and GitHub-flavored markdown
 */
export class MarkdownFormatter implements ExportFormatter {
  /** Supported export format */
  public readonly format = 'markdown' as const;

  /** Default theme configuration */
  private readonly defaultTheme: MarkdownTheme = {
    headerLevels: {
      title: 1,
      section: 2,
      subsection: 3
    },
    tables: {
      useHeaderSeparators: true,
      alignColumns: true,
      includeRowNumbers: false
    },
    codeBlocks: {
      language: 'text',
      useBackticks: true,
      indentSize: 2
    },
    lists: {
      bulletChar: '-',
      numberFormat: '1.',
      indentSize: 2
    }
  };

  /** Default sections configuration */
  private readonly defaultSections: MarkdownSection[] = [
    { id: 'header', title: 'Session Report', enabled: true, order: 1 },
    { id: 'summary', title: 'Summary', enabled: true, order: 2 },
    { id: 'context', title: 'Session Context', enabled: true, order: 3 },
    { id: 'performance', title: 'Performance Metrics', enabled: true, order: 4 },
    { id: 'logs', title: 'Console Logs', enabled: true, order: 5 },
    { id: 'network', title: 'Network Activity', enabled: true, order: 6 },
    { id: 'appendix', title: 'Technical Details', enabled: true, order: 7 }
  ];

  /** Log level styling */
  private readonly logLevelStyles: Record<LogLevel, LogLevelStyle> = {
    error: { symbol: '🔴', bold: true, color: 'red' },
    warn: { symbol: '🟡', bold: true, color: 'orange' },
    info: { symbol: '🔵', bold: false, color: 'blue' },
    log: { symbol: '⚪', bold: false },
    debug: { symbol: '🔍', bold: false, color: 'gray' }
  };

  /**
   * Formats a capture session as Markdown
   * @param session - Session to format
   * @param config - Export configuration
   * @param template - Optional custom template
   * @returns Promise resolving to formatted Markdown string
   */
  public async format(
    session: CaptureSession,
    config: ExportConfig,
    template?: ExportTemplate
  ): Promise<string> {
    try {
      const theme = this.parseThemeFromTemplate(template);
      const sections = this.parseSectionsFromTemplate(template);
      
      // Build markdown sections
      const markdownSections: string[] = [];
      
      // Sort sections by order
      sections.sort((a, b) => a.order - b.order);
      
      for (const section of sections) {
        if (!section.enabled) continue;
        
        let content = '';
        
        switch (section.id) {
          case 'header':
            content = this.generateHeader(session, config, theme);
            break;
          case 'summary':
            content = this.generateSummary(session, config, theme);
            break;
          case 'context':
            if (config.includeContext) {
              content = this.generateContext(session, config, theme);
            }
            break;
          case 'performance':
            if (config.includePerformance && session.context.performance) {
              content = this.generatePerformance(session.context.performance, theme);
            }
            break;
          case 'logs':
            content = this.generateLogs(session.logs, config, theme);
            break;
          case 'network':
            if (config.includeContext && session.context.networkRequests) {
              content = this.generateNetworkActivity(session.context.networkRequests, theme);
            }
            break;
          case 'appendix':
            content = this.generateAppendix(session, config, theme);
            break;
          default:
            // Custom section
            if (section.contentGenerator) {
              content = section.contentGenerator(session, config);
            }
        }
        
        if (content.trim()) {
          markdownSections.push(content);
        }
      }
      
      // Join sections with appropriate spacing
      return markdownSections.join('\n\n---\n\n');
      
    } catch (error) {
      throw this.createMarkdownError(
        'MARKDOWN_FORMAT_ERROR',
        `Failed to format session as Markdown: ${error instanceof Error ? error.message : 'Unknown error'}`,
        'high',
        { sessionId: session.id, error }
      );
    }
  }

  /**
   * Validates export configuration for Markdown format
   * @param config - Configuration to validate
   * @returns Array of validation errors (empty if valid)
   */
  public validateConfig(config: ExportConfig): string[] {
    const errors: string[] = [];
    
    if (config.format !== 'markdown') {
      errors.push('Configuration format must be "markdown"');
    }
    
    // Markdown supports all standard configuration options
    return errors;
  }

  /**
   * Gets default configuration for Markdown format
   * @returns Default export configuration
   */
  public getDefaultConfig(): Partial<ExportConfig> {
    return {
      format: 'markdown',
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
    
    // Header and summary sections
    estimatedSize += 800;
    
    // Context section if included
    if (config.includeContext) {
      estimatedSize += 600;
    }
    
    // Performance section if included
    if (config.includePerformance && session.context.performance) {
      estimatedSize += 400;
    }
    
    // Log entries (largest section)
    for (const log of session.logs) {
      let logSize = 150; // Base formatting overhead
      
      const messageToUse = (!config.includeSensitiveData && log.sanitizedMessage) 
        ? log.sanitizedMessage 
        : log.message;
      logSize += messageToUse.length;
      
      if (config.includeStackTraces && log.stackTrace) {
        logSize += log.stackTrace.length * 0.8; // Markdown code blocks
      }
      
      estimatedSize += logSize;
    }
    
    // Network activity if included
    if (config.includeContext && session.context.networkRequests) {
      estimatedSize += session.context.networkRequests.length * 100;
    }
    
    // Appendix section
    estimatedSize += 300;
    
    return Math.round(estimatedSize);
  }

  /**
   * Generates the report header section
   * @param session - Capture session
   * @param config - Export configuration  
   * @param theme - Markdown theme
   * @returns Header markdown content
   * @private
   */
  private generateHeader(session: CaptureSession, config: ExportConfig, theme: MarkdownTheme): string {
    const title = this.createHeader('Console Capture Report', theme.headerLevels.title);
    
    const metadata = [
      `**Session ID:** \`${session.id}\``,
      `**Generated:** ${new Date().toLocaleString()}`,
      `**Duration:** ${this.formatDuration(session.startTime, session.endTime)}`,
      `**Page:** [${session.context.title}](${session.context.url})`,
      `**User Agent:** ${this.truncateText(session.context.userAgent, 80)}`
    ];
    
    if (!config.includeSensitiveData) {
      metadata.push('**Note:** Sensitive data has been sanitized for privacy');
    }
    
    return `${title}\n\n${metadata.join('\n')}`;
  }

  /**
   * Generates the summary section
   * @param session - Capture session
   * @param config - Export configuration
   * @param theme - Markdown theme
   * @returns Summary markdown content
   * @private
   */
  private generateSummary(session: CaptureSession, config: ExportConfig, theme: MarkdownTheme): string {
    const header = this.createHeader('Summary', theme.headerLevels.section);
    
    const stats = session.metadata;
    const logsByLevel = this.countLogsByLevel(session.logs);
    
    const summaryItems = [
      `📊 **Total Log Entries:** ${stats.totalLogs}`,
      `🔴 **Errors:** ${stats.errorCount}`,
      `🟡 **Warnings:** ${stats.warningCount}`,
      `🔵 **Info/Debug:** ${stats.totalLogs - stats.errorCount - stats.warningCount}`
    ];
    
    if (stats.containsSensitiveData) {
      summaryItems.push('🔒 **Contains Sensitive Data:** Yes');
    }
    
    if (session.context.networkRequests && session.context.networkRequests.length > 0) {
      const failedRequests = session.context.networkRequests.filter(req => req.failed).length;
      summaryItems.push(`🌐 **Network Requests:** ${session.context.networkRequests.length} (${failedRequests} failed)`);
    }
    
    if (stats.tags.length > 0) {
      summaryItems.push(`🏷️ **Tags:** ${stats.tags.map(tag => `\`${tag}\``).join(', ')}`);
    }
    
    let content = `${header}\n\n${summaryItems.join('\n')}`;
    
    // Add log level breakdown table
    if (Object.keys(logsByLevel).length > 1) {
      content += '\n\n' + this.createLogLevelTable(logsByLevel, theme);
    }
    
    if (stats.notes) {
      content += `\n\n**Notes:** ${stats.notes}`;
    }
    
    return content;
  }

  /**
   * Generates the context section
   * @param session - Capture session
   * @param config - Export configuration
   * @param theme - Markdown theme
   * @returns Context markdown content
   * @private
   */
  private generateContext(session: CaptureSession, config: ExportConfig, theme: MarkdownTheme): string {
    const header = this.createHeader('Session Context', theme.headerLevels.section);
    const context = session.context;
    
    const contextItems = [
      `**URL:** ${context.url}`,
      `**Page Title:** ${context.title}`,
      `**Viewport:** ${context.viewport.width} × ${context.viewport.height}px`,
      `**Browser:** ${context.versions.browser}`,
      `**Extension:** ${context.versions.extension}`
    ];
    
    let content = `${header}\n\n${contextItems.join('\n')}`;
    
    // Add user agent details in code block
    content += '\n\n' + this.createSubHeader('User Agent', theme.headerLevels.subsection);
    content += '\n\n' + this.createCodeBlock(context.userAgent, 'text', theme);
    
    return content;
  }

  /**
   * Generates the performance metrics section
   * @param performance - Performance metrics
   * @param theme - Markdown theme
   * @returns Performance markdown content
   * @private
   */
  private generatePerformance(performance: PerformanceMetrics, theme: MarkdownTheme): string {
    const header = this.createHeader('Performance Metrics', theme.headerLevels.section);
    
    const performanceTable = this.createTable(
      ['Metric', 'Value', 'Description'],
      [
        ['First Contentful Paint', this.formatMs(performance.fcp), 'Time to first content render'],
        ['Largest Contentful Paint', this.formatMs(performance.lcp), 'Time to largest content render'],
        ['Cumulative Layout Shift', this.formatNumber(performance.cls, 3), 'Visual stability score'],
        ['First Input Delay', this.formatMs(performance.fid), 'Input responsiveness'],
        ['Time to Interactive', this.formatMs(performance.tti), 'Time until page is interactive']
      ].filter(row => row[1] !== 'N/A'),
      theme
    );
    
    let content = `${header}\n\n${performanceTable}`;
    
    // Add memory information if available
    if (performance.memory) {
      content += '\n\n' + this.createSubHeader('Memory Usage', theme.headerLevels.subsection);
      content += `\n\n📊 **Used:** ${this.formatBytes(performance.memory.used)} / **Total:** ${this.formatBytes(performance.memory.total)}`;
      
      const memoryPercentage = (performance.memory.used / performance.memory.total * 100).toFixed(1);
      content += `\n\n🔋 **Memory Usage:** ${memoryPercentage}%`;
    }
    
    return content;
  }

  /**
   * Generates the logs section
   * @param logs - Log entries
   * @param config - Export configuration
   * @param theme - Markdown theme
   * @returns Logs markdown content
   * @private
   */
  private generateLogs(logs: LogEntry[], config: ExportConfig, theme: MarkdownTheme): string {
    const header = this.createHeader('Console Logs', theme.headerLevels.section);
    
    if (logs.length === 0) {
      return `${header}\n\n*No logs captured during this session.*`;
    }
    
    let content = header + '\n\n';
    
    // Group logs by level for better organization
    const logsByLevel = this.groupLogsByLevel(logs);
    const levels: LogLevel[] = ['error', 'warn', 'info', 'log', 'debug'];
    
    for (const level of levels) {
      const levelLogs = logsByLevel[level];
      if (!levelLogs || levelLogs.length === 0) continue;
      
      const style = this.logLevelStyles[level];
      const levelHeader = this.createSubHeader(
        `${style.symbol} ${this.capitalizeFirst(level)} Messages (${levelLogs.length})`,
        theme.headerLevels.subsection
      );
      
      content += levelHeader + '\n\n';
      
      for (let i = 0; i < levelLogs.length; i++) {
        const log = levelLogs[i];
        content += this.formatLogEntry(log, config, theme, i + 1);
        
        if (i < levelLogs.length - 1) {
          content += '\n\n';
        }
      }
      
      content += '\n\n';
    }
    
    return content.trim();
  }

  /**
   * Generates the network activity section
   * @param requests - Network requests
   * @param theme - Markdown theme
   * @returns Network activity markdown content
   * @private
   */
  private generateNetworkActivity(requests: NetworkRequest[], theme: MarkdownTheme): string {
    const header = this.createHeader('Network Activity', theme.headerLevels.section);
    
    if (requests.length === 0) {
      return `${header}\n\n*No network requests captured during this session.*`;
    }
    
    // Create summary statistics
    const totalRequests = requests.length;
    const failedRequests = requests.filter(req => req.failed).length;
    const avgResponseTime = requests.reduce((sum, req) => sum + req.responseTime, 0) / totalRequests;
    
    const summary = [
      `📈 **Total Requests:** ${totalRequests}`,
      `❌ **Failed Requests:** ${failedRequests}`,
      `⏱️ **Average Response Time:** ${avgResponseTime.toFixed(0)}ms`
    ].join('\n');
    
    // Create requests table
    const tableHeaders = ['Method', 'URL', 'Status', 'Response Time', 'Result'];
    const tableRows = requests.map(req => [
      req.method,
      this.truncateText(req.url, 50),
      req.status.toString(),
      `${req.responseTime}ms`,
      req.failed ? '❌ Failed' : '✅ Success'
    ]);
    
    const requestsTable = this.createTable(tableHeaders, tableRows, theme);
    
    return `${header}\n\n${summary}\n\n${requestsTable}`;
  }

  /**
   * Generates the appendix section
   * @param session - Capture session
   * @param config - Export configuration
   * @param theme - Markdown theme
   * @returns Appendix markdown content
   * @private
   */
  private generateAppendix(session: CaptureSession, config: ExportConfig, theme: MarkdownTheme): string {
    const header = this.createHeader('Technical Details', theme.headerLevels.section);
    
    const technicalDetails = [
      '### Export Configuration',
      '',
      this.createCodeBlock(JSON.stringify({
        format: config.format,
        includeSensitiveData: config.includeSensitiveData,
        includeStackTraces: config.includeStackTraces,
        includeContext: config.includeContext,
        includePerformance: config.includePerformance,
        formatting: config.formatting
      }, null, 2), 'json', theme),
      '',
      '### Session Metadata',
      '',
      this.createCodeBlock(JSON.stringify(session.metadata, null, 2), 'json', theme)
    ];
    
    return `${header}\n\n${technicalDetails.join('\n')}`;
  }

  /**
   * Formats a single log entry
   * @param log - Log entry to format
   * @param config - Export configuration
   * @param theme - Markdown theme
   * @param index - Entry index
   * @returns Formatted log entry markdown
   * @private
   */
  private formatLogEntry(log: LogEntry, config: ExportConfig, theme: MarkdownTheme, index: number): string {
    const style = this.logLevelStyles[log.level];
    let content = '';
    
    // Entry header with timestamp and source
    const timestamp = config.formatting?.timestamps !== false 
      ? log.timestamp.toISOString() 
      : '';
    
    const source = config.formatting?.sourceInfo !== false && log.source
      ? `${log.source.file}:${log.source.line}:${log.source.column}`
      : '';
    
    const entryHeader = [
      `**Entry ${index}**`,
      timestamp && `⏰ ${timestamp}`,
      source && `📍 \`${source}\``
    ].filter(Boolean).join(' | ');
    
    content += entryHeader + '\n\n';
    
    // Message content
    const messageToUse = (!config.includeSensitiveData && log.sanitizedMessage) 
      ? log.sanitizedMessage 
      : log.message;
    
    if (style.bold) {
      content += `**${messageToUse}**\n`;
    } else {
      content += `${messageToUse}\n`;
    }
    
    // Stack trace if available and included
    if (config.includeStackTraces && log.stackTrace) {
      content += '\n<details>\n<summary>Stack Trace</summary>\n\n';
      content += this.createCodeBlock(log.stackTrace, 'text', theme);
      content += '\n</details>';
    }
    
    // Classification information if available
    if (log.classification && log.classification.sensitivityLevel !== 'public') {
      content += `\n\n🔒 **Data Classification:** ${log.classification.sensitivityLevel.toUpperCase()}`;
      
      if (log.classification.detectedTypes.length > 0) {
        content += ` (${log.classification.detectedTypes.join(', ')})`;
      }
    }
    
    return content;
  }

  /**
   * Creates a markdown header
   * @param text - Header text
   * @param level - Header level (1-6)
   * @returns Markdown header string
   * @private
   */
  private createHeader(text: string, level: number): string {
    const hashes = '#'.repeat(Math.max(1, Math.min(6, level)));
    return `${hashes} ${text}`;
  }

  /**
   * Creates a markdown subheader
   * @param text - Subheader text
   * @param level - Header level (1-6)
   * @returns Markdown subheader string
   * @private
   */
  private createSubHeader(text: string, level: number): string {
    return this.createHeader(text, level);
  }

  /**
   * Creates a markdown table
   * @param headers - Table headers
   * @param rows - Table rows
   * @param theme - Markdown theme
   * @returns Markdown table string
   * @private
   */
  private createTable(headers: string[], rows: string[][], theme: MarkdownTheme): string {
    if (headers.length === 0 || rows.length === 0) return '';
    
    let table = '';
    
    // Headers
    table += '| ' + headers.join(' | ') + ' |\n';
    
    // Separator
    if (theme.tables.useHeaderSeparators) {
      table += '| ' + headers.map(() => '---').join(' | ') + ' |\n';
    }
    
    // Rows
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      
      if (theme.tables.includeRowNumbers) {
        table += `| ${i + 1} | ${row.join(' | ')} |\n`;
      } else {
        table += '| ' + row.join(' | ') + ' |\n';
      }
    }
    
    return table;
  }

  /**
   * Creates a log level breakdown table
   * @param logsByLevel - Count of logs by level
   * @param theme - Markdown theme
   * @returns Markdown table for log levels
   * @private
   */
  private createLogLevelTable(logsByLevel: Record<string, number>, theme: MarkdownTheme): string {
    const headers = ['Level', 'Count', 'Percentage'];
    const total = Object.values(logsByLevel).reduce((sum, count) => sum + count, 0);
    
    const rows = Object.entries(logsByLevel)
      .sort(([, a], [, b]) => b - a)
      .map(([level, count]) => {
        const style = this.logLevelStyles[level as LogLevel];
        const percentage = ((count / total) * 100).toFixed(1);
        return [
          `${style?.symbol || '⚪'} ${this.capitalizeFirst(level)}`,
          count.toString(),
          `${percentage}%`
        ];
      });
    
    return this.createTable(headers, rows, theme);
  }

  /**
   * Creates a markdown code block
   * @param code - Code content
   * @param language - Language identifier
   * @param theme - Markdown theme
   * @returns Markdown code block string
   * @private
   */
  private createCodeBlock(code: string, language: string, theme: MarkdownTheme): string {
    if (theme.codeBlocks.useBackticks) {
      return `\`\`\`${language}\n${code}\n\`\`\``;
    } else {
      const indent = ' '.repeat(theme.codeBlocks.indentSize);
      return code.split('\n').map(line => indent + line).join('\n');
    }
  }

  /**
   * Groups logs by level
   * @param logs - Log entries
   * @returns Logs grouped by level
   * @private
   */
  private groupLogsByLevel(logs: LogEntry[]): Record<LogLevel, LogEntry[]> {
    const grouped: Record<LogLevel, LogEntry[]> = {
      error: [],
      warn: [],
      info: [],
      log: [],
      debug: []
    };
    
    for (const log of logs) {
      if (grouped[log.level]) {
        grouped[log.level].push(log);
      }
    }
    
    return grouped;
  }

  /**
   * Counts logs by level
   * @param logs - Log entries
   * @returns Count by level
   * @private
   */
  private countLogsByLevel(logs: LogEntry[]): Record<string, number> {
    const counts: Record<string, number> = {};
    
    for (const log of logs) {
      counts[log.level] = (counts[log.level] || 0) + 1;
    }
    
    return counts;
  }

  /**
   * Parses theme configuration from template
   * @param template - Custom template
   * @returns Theme configuration
   * @private
   */
  private parseThemeFromTemplate(template?: ExportTemplate): MarkdownTheme {
    const theme = { ...this.defaultTheme };
    
    if (template?.variables) {
      // Parse theme variables from template
      if (template.variables.headerLevel) {
        const level = parseInt(template.variables.headerLevel, 10);
        if (level >= 1 && level <= 6) {
          theme.headerLevels.title = level;
          theme.headerLevels.section = Math.min(6, level + 1);
          theme.headerLevels.subsection = Math.min(6, level + 2);
        }
      }
      
      if (template.variables.useBackticks !== undefined) {
        theme.codeBlocks.useBackticks = template.variables.useBackticks === 'true';
      }
      
      if (template.variables.bulletChar) {
        theme.lists.bulletChar = template.variables.bulletChar;
      }
      
      if (template.variables.includeRowNumbers !== undefined) {
        theme.tables.includeRowNumbers = template.variables.includeRowNumbers === 'true';
      }
    }
    
    return theme;
  }

  /**
   * Parses sections configuration from template
   * @param template - Custom template
   * @returns Sections configuration
   * @private
   */
  private parseSectionsFromTemplate(template?: ExportTemplate): MarkdownSection[] {
    const sections = [...this.defaultSections];
    
    if (template?.template) {
      try {
        const templateConfig = JSON.parse(template.template);
        
        if (templateConfig.sections) {
          // Override section configuration
          for (const sectionConfig of templateConfig.sections) {
            const section = sections.find(s => s.id === sectionConfig.id);
            if (section) {
              Object.assign(section, sectionConfig);
            } else {
              sections.push(sectionConfig);
            }
          }
        }
      } catch (error) {
        // Template parsing failed, use default sections
        console.warn('Failed to parse markdown template sections:', error);
      }
    }
    
    return sections;
  }

  /**
   * Utility functions
   * @private
   */

  private formatDuration(start: Date, end?: Date): string {
    if (!end) return 'Session in progress';
    
    const duration = end.getTime() - start.getTime();
    const seconds = Math.floor(duration / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    
    if (hours > 0) {
      return `${hours}h ${minutes % 60}m ${seconds % 60}s`;
    } else if (minutes > 0) {
      return `${minutes}m ${seconds % 60}s`;
    } else {
      return `${seconds}s`;
    }
  }

  private formatMs(value?: number): string {
    return value !== undefined ? `${value.toFixed(1)}ms` : 'N/A';
  }

  private formatNumber(value?: number, decimals: number = 2): string {
    return value !== undefined ? value.toFixed(decimals) : 'N/A';
  }

  private formatBytes(bytes: number): string {
    if (bytes === 0) return '0 B';
    
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    
    return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`;
  }

  private truncateText(text: string, maxLength: number): string {
    return text.length > maxLength ? text.substring(0, maxLength - 3) + '...' : text;
  }

  private capitalizeFirst(text: string): string {
    return text.charAt(0).toUpperCase() + text.slice(1);
  }

  private createMarkdownError(
    code: string,
    message: string,
    severity: 'low' | 'medium' | 'high' | 'critical',
    context?: Record<string, unknown>
  ): ExtensionError {
    return {
      name: 'MarkdownFormatterError',
      message,
      code,
      severity,
      reportable: true,
      context: {
        component: 'MarkdownFormatter',
        timestamp: new Date().toISOString(),
        ...context
      }
    } as ExtensionError;
  }
}