/**
 * Core type definitions for ConsoleCapture Pro
 * Defines interfaces and types used throughout the extension
 */

/**
 * Log levels supported by the capture system
 */
export type LogLevel = 'log' | 'info' | 'warn' | 'error' | 'debug';

/**
 * Data sensitivity classification levels
 */
export type SensitivityLevel = 'public' | 'internal' | 'confidential' | 'restricted';

/**
 * PII detection patterns and types
 */
export type PIIType = 
  | 'creditCard'
  | 'ssn' 
  | 'email'
  | 'ipAddress'
  | 'jwt'
  | 'apiKey'
  | 'password'
  | 'phone'
  | 'custom';

/**
 * Console log entry captured from the browser
 */
export interface LogEntry {
  /** Unique identifier for the log entry */
  id: string;
  /** Timestamp when the log was captured */
  timestamp: Date;
  /** Log level (error, warn, info, etc.) */
  level: LogLevel;
  /** Original log message content */
  message: string;
  /** Sanitized log message (if PII was detected) */
  sanitizedMessage?: string;
  /** Stack trace if available */
  stackTrace?: string;
  /** Source location information */
  source?: {
    file: string;
    line: number;
    column: number;
  };
  /** Data classification result */
  classification?: DataClassification;
}

/**
 * Data sensitivity classification result
 */
export interface DataClassification {
  /** Overall sensitivity level */
  sensitivityLevel: SensitivityLevel;
  /** Detected PII types */
  detectedTypes: PIIType[];
  /** Confidence score (0-1) */
  confidence: number;
  /** Timestamp of classification */
  scanTimestamp: Date;
  /** Whether sanitization was applied */
  sanitized: boolean;
}

/**
 * Capture session containing multiple log entries
 */
export interface CaptureSession {
  /** Unique session identifier */
  id: string;
  /** Session start timestamp */
  startTime: Date;
  /** Session end timestamp */
  endTime?: Date;
  /** Captured log entries */
  logs: LogEntry[];
  /** Session context information */
  context: SessionContext;
  /** Session metadata */
  metadata: SessionMetadata;
}

/**
 * Contextual information about the capture session
 */
export interface SessionContext {
  /** Current page URL */
  url: string;
  /** Page title */
  title: string;
  /** User agent information */
  userAgent: string;
  /** Viewport dimensions */
  viewport: {
    width: number;
    height: number;
  };
  /** Browser and extension version info */
  versions: {
    browser: string;
    extension: string;
  };
  /** Network requests correlation */
  networkRequests?: NetworkRequest[];
  /** Performance metrics */
  performance?: PerformanceMetrics;
}

/**
 * Session metadata for tracking and organization
 */
export interface SessionMetadata {
  /** Number of total logs captured */
  totalLogs: number;
  /** Number of error-level logs */
  errorCount: number;
  /** Number of warning-level logs */
  warningCount: number;
  /** Whether session contains sensitive data */
  containsSensitiveData: boolean;
  /** User-assigned tags */
  tags: string[];
  /** User notes */
  notes?: string;
}

/**
 * Network request information for context correlation
 */
export interface NetworkRequest {
  /** Request URL */
  url: string;
  /** HTTP method */
  method: string;
  /** Response status code */
  status: number;
  /** Request timestamp */
  timestamp: Date;
  /** Response time in milliseconds */
  responseTime: number;
  /** Whether request failed */
  failed: boolean;
}

/**
 * Performance metrics captured during session
 */
export interface PerformanceMetrics {
  /** First Contentful Paint */
  fcp?: number;
  /** Largest Contentful Paint */
  lcp?: number;
  /** Cumulative Layout Shift */
  cls?: number;
  /** First Input Delay */
  fid?: number;
  /** Time to Interactive */
  tti?: number;
  /** Memory usage information */
  memory?: {
    used: number;
    total: number;
  };
}

/**
 * User consent record for privacy compliance
 */
export interface ConsentRecord {
  /** Unique consent identifier */
  consentId: string;
  /** Data subject identifier */
  dataSubject: string;
  /** Purpose of data processing */
  purpose: string;
  /** Legal basis for processing */
  legalBasis: 'consent' | 'legitimate_interest' | 'contract';
  /** Whether consent was given */
  consentGiven: boolean;
  /** Consent timestamp */
  timestamp: string;
  /** Whether consent can be withdrawn */
  withdrawable: boolean;
  /** Data retention period */
  retention: string;
}

/**
 * Export format options for captured sessions
 */
export type ExportFormat = 
  | 'json'
  | 'markdown' 
  | 'csv'
  | 'github-issue'
  | 'slack-message'
  | 'plain-text';

/**
 * Export configuration options
 */
export interface ExportConfig {
  /** Target export format */
  format: ExportFormat;
  /** Whether to include sensitive data (if user consents) */
  includeSensitiveData: boolean;
  /** Whether to include stack traces */
  includeStackTraces: boolean;
  /** Whether to include session context */
  includeContext: boolean;
  /** Whether to include performance metrics */
  includePerformance: boolean;
  /** Custom formatting options */
  formatting?: {
    /** Include timestamps */
    timestamps: boolean;
    /** Include log levels */
    logLevels: boolean;
    /** Include source information */
    sourceInfo: boolean;
  };
}

/**
 * Extension configuration settings
 */
export interface ExtensionConfig {
  /** Whether capture is enabled */
  captureEnabled: boolean;
  /** Log levels to capture */
  capturedLevels: LogLevel[];
  /** Maximum number of logs to retain */
  maxLogsRetained: number;
  /** Whether to auto-capture on page load */
  autoCaptureOnLoad: boolean;
  /** Privacy settings */
  privacy: {
    /** Enable PII detection */
    enablePIIDetection: boolean;
    /** PII detection sensitivity (0-1) */
    piiSensitivity: number;
    /** Whether to auto-sanitize detected PII */
    autoSanitize: boolean;
    /** Data retention period in hours */
    dataRetentionHours: number;
  };
  /** Performance settings */
  performance: {
    /** Enable performance monitoring */
    enableMonitoring: boolean;
    /** Maximum memory usage in MB */
    maxMemoryMB: number;
    /** Capture throttling in ms */
    throttleMs: number;
  };
  /** Export preferences */
  export: {
    /** Default export format */
    defaultFormat: ExportFormat;
    /** Whether to include metadata by default */
    includeMetadata: boolean;
  };
}

/**
 * PII detection result with confidence scoring
 */
export interface PIIDetectionResult {
  /** Type of PII detected */
  type: PIIType;
  /** Detected value */
  value: string;
  /** Start position in text */
  startIndex: number;
  /** End position in text */
  endIndex: number;
  /** Confidence score (0-1) */
  confidence: number;
  /** Pattern name that matched */
  patternName: string;
  /** Whether this is a high-confidence match */
  highConfidence: boolean;
}

/**
 * PII detection pattern configuration
 */
export interface PIIPattern {
  /** Pattern name */
  name: string;
  /** Pattern type */
  type: PIIType;
  /** Regex pattern */
  pattern: RegExp;
  /** Validation function for additional checks */
  validator?: (match: string) => boolean;
  /** Base confidence score (0-1) */
  baseConfidence: number;
  /** Whether this pattern requires context validation */
  requiresContext: boolean;
  /** Description of what this pattern detects */
  description: string;
}

/**
 * Sanitization strategy options
 */
export type SanitizationStrategy = 'mask' | 'hash' | 'remove' | 'partial';

/**
 * Sanitization configuration
 */
export interface SanitizationConfig {
  /** Default strategy to use */
  defaultStrategy: SanitizationStrategy;
  /** Strategy per PII type */
  typeStrategies: Partial<Record<PIIType, SanitizationStrategy>>;
  /** Mask character for masking strategy */
  maskCharacter: string;
  /** Number of characters to preserve for partial strategy */
  partialPreserveLength: number;
  /** Whether to preserve format (e.g., keep dashes in SSN) */
  preserveFormat: boolean;
  /** Salt for hashing strategy */
  hashSalt: string;
}

/**
 * Sanitization result
 */
export interface SanitizationResult {
  /** Original text */
  originalText: string;
  /** Sanitized text */
  sanitizedText: string;
  /** PII detections that were sanitized */
  sanitizedDetections: PIIDetectionResult[];
  /** Sanitization actions taken */
  actions: SanitizationAction[];
  /** Whether any sanitization was performed */
  wasModified: boolean;
}

/**
 * Individual sanitization action
 */
export interface SanitizationAction {
  /** PII type that was sanitized */
  piiType: PIIType;
  /** Strategy used for sanitization */
  strategy: SanitizationStrategy;
  /** Original value (hashed for security) */
  originalValueHash: string;
  /** Sanitized value */
  sanitizedValue: string;
  /** Position in text */
  position: {
    start: number;
    end: number;
  };
  /** Timestamp of sanitization */
  timestamp: Date;
}

/**
 * Consent status for different data processing purposes
 */
export type ConsentStatus = 'granted' | 'denied' | 'pending' | 'withdrawn';

/**
 * Data processing purposes for consent
 */
export type ProcessingPurpose = 
  | 'logging'
  | 'analytics' 
  | 'debugging'
  | 'performance_monitoring'
  | 'error_reporting'
  | 'export_functionality';

/**
 * User consent preferences
 */
export interface ConsentPreferences {
  /** Consent ID */
  id: string;
  /** User identifier */
  userId: string;
  /** Consent status per purpose */
  purposes: Record<ProcessingPurpose, ConsentStatus>;
  /** Global PII processing consent */
  piiProcessing: ConsentStatus;
  /** Data retention consent in hours */
  dataRetentionHours: number;
  /** Consent timestamp */
  consentTimestamp: Date;
  /** Last updated timestamp */
  lastUpdated: Date;
  /** IP address when consent was given */
  ipAddress: string;
  /** User agent when consent was given */
  userAgent: string;
}

/**
 * Security scan result
 */
export interface SecurityScanResult {
  /** Scan ID */
  scanId: string;
  /** Timestamp of scan */
  scanTimestamp: Date;
  /** Text that was scanned */
  scannedText: string;
  /** PII detections found */
  detections: PIIDetectionResult[];
  /** Overall risk score (0-1) */
  riskScore: number;
  /** Data classification result */
  classification: DataClassification;
  /** Time taken for scan in milliseconds */
  scanTimeMs: number;
  /** Whether scan was successful */
  scanSuccessful: boolean;
  /** Any scan errors */
  scanErrors: string[];
}

/**
 * Security policy configuration
 */
export interface SecurityPolicy {
  /** Policy version */
  version: string;
  /** PII detection sensitivity (0-1) */
  piiSensitivity: number;
  /** Minimum confidence threshold for PII detection */
  minConfidenceThreshold: number;
  /** Whether to require explicit consent for PII processing */
  requireExplicitConsent: boolean;
  /** Automatic sanitization settings */
  autoSanitization: {
    enabled: boolean;
    thresholds: Record<PIIType, number>;
  };
  /** Data retention policies */
  dataRetention: {
    defaultHours: number;
    maxHours: number;
    autoDeleteEnabled: boolean;
  };
  /** Compliance settings */
  compliance: {
    gdprEnabled: boolean;
    ccpaEnabled: boolean;
    hipaaEnabled: boolean;
  };
}

/**
 * Audit log entry for compliance tracking
 */
export interface AuditLogEntry {
  /** Audit entry ID */
  id: string;
  /** Timestamp of event */
  timestamp: Date;
  /** Type of event */
  eventType: 'pii_detected' | 'data_sanitized' | 'consent_given' | 'consent_withdrawn' | 'data_exported' | 'data_deleted';
  /** User ID if applicable */
  userId?: string;
  /** Session ID */
  sessionId?: string;
  /** Event details */
  details: Record<string, unknown>;
  /** IP address */
  ipAddress: string;
  /** User agent */
  userAgent: string;
  /** Compliance flags */
  compliance: {
    gdpr: boolean;
    ccpa: boolean;
    hipaa: boolean;
  };
}

/**
 * Error types that can occur in the extension
 */
export interface ExtensionError extends Error {
  /** Error code for categorization */
  code: string;
  /** Error severity level */
  severity: 'low' | 'medium' | 'high' | 'critical';
  /** Additional error context */
  context?: Record<string, unknown>;
  /** Whether error should be reported */
  reportable: boolean;
}