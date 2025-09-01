/**
 * SecurityEngine.ts
 * Main security orchestration class that coordinates PII detection and sanitization
 * Manages consent, privacy controls, and security policy enforcement
 */

import {
  LogEntry,
  SecurityScanResult,
  SecurityPolicy,
  PIIDetectionResult,
  SanitizationResult,
  ConsentPreferences,
  ProcessingPurpose,
  DataClassification,
  SensitivityLevel,
  PIIType,
  AuditLogEntry
} from '../types/index.js';

import { PIIDetector } from './PIIDetector.js';
import { DataSanitizer } from './DataSanitizer.js';
import { ConsentManager } from './ConsentManager.js';

/**
 * Security scan options
 */
export interface SecurityScanOptions {
  /** User ID for consent verification */
  userId?: string;
  /** Minimum confidence threshold for PII detection */
  minConfidence?: number;
  /** Whether to automatically sanitize detected PII */
  autoSanitize?: boolean;
  /** Processing purpose for consent verification */
  purpose?: ProcessingPurpose;
  /** Whether to skip consent verification */
  skipConsentCheck?: boolean;
}

/**
 * Security engine statistics
 */
export interface SecurityEngineStatistics {
  totalScans: number;
  totalPIIDetected: number;
  totalSanitizations: number;
  scanPerformance: {
    averageTimeMs: number;
    minTimeMs: number;
    maxTimeMs: number;
  };
  detectionStats: Record<PIIType, number>;
  riskLevelDistribution: Record<SensitivityLevel, number>;
  consentCompliance: {
    totalUsers: number;
    compliantScans: number;
    nonCompliantScans: number;
  };
}

/**
 * Security alert configuration
 */
export interface SecurityAlert {
  id: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  type: 'pii_detected' | 'consent_violation' | 'data_breach' | 'policy_violation';
  message: string;
  details: Record<string, unknown>;
  timestamp: Date;
  resolved: boolean;
}

/**
 * Main security orchestration engine
 * Coordinates PII detection, data sanitization, consent management, and policy enforcement
 */
export class SecurityEngine {
  private readonly piiDetector: PIIDetector;
  private readonly dataSanitizer: DataSanitizer;
  private readonly consentManager: ConsentManager;
  private readonly securityPolicy: SecurityPolicy;
  private readonly statistics: SecurityEngineStatistics;
  private readonly alerts: Map<string, SecurityAlert>;
  private readonly scanHistory: Map<string, SecurityScanResult[]>;

  constructor(
    securityPolicy: SecurityPolicy,
    consentManager: ConsentManager,
    customPIIDetector?: PIIDetector,
    customDataSanitizer?: DataSanitizer
  ) {
    this.piiDetector = customPIIDetector || new PIIDetector();
    this.dataSanitizer = customDataSanitizer || new DataSanitizer({
      defaultStrategy: 'mask',
      typeStrategies: {
        creditCard: 'mask',
        ssn: 'mask',
        email: 'partial',
        phone: 'partial',
        apiKey: 'remove',
        jwt: 'remove',
        password: 'remove',
        ipAddress: 'hash'
      }
    });
    
    this.consentManager = consentManager;
    this.securityPolicy = securityPolicy;
    this.alerts = new Map();
    this.scanHistory = new Map();
    
    this.statistics = {
      totalScans: 0,
      totalPIIDetected: 0,
      totalSanitizations: 0,
      scanPerformance: {
        averageTimeMs: 0,
        minTimeMs: Infinity,
        maxTimeMs: 0
      },
      detectionStats: {} as Record<PIIType, number>,
      riskLevelDistribution: {
        public: 0,
        internal: 0,
        confidential: 0,
        restricted: 0
      },
      consentCompliance: {
        totalUsers: 0,
        compliantScans: 0,
        nonCompliantScans: 0
      }
    };

    this.initializeSecurityEngine();
  }

  /**
   * Performs comprehensive security scan on log entry
   * @param logEntry - Log entry to scan
   * @param options - Scan options including user context
   * @returns Security scan result with PII detections and risk assessment
   */
  public async scanLogEntry(logEntry: LogEntry, options: SecurityScanOptions = {}): Promise<SecurityScanResult> {
    const startTime = performance.now();
    const scanId = this.generateScanId();

    try {
      // Verify consent if user ID is provided
      let consentValid = true;
      if (options.userId && !options.skipConsentCheck) {
        const purpose = options.purpose || 'logging';
        const consentVerification = this.consentManager.verifyConsent(options.userId, purpose);
        
        if (!consentVerification.isValid) {
          consentValid = false;
          this.updateConsentComplianceStats(false);
          
          if (this.securityPolicy.requireExplicitConsent) {
            return this.createFailedScanResult(scanId, logEntry.message, ['Consent not provided or invalid']);
          }
        } else {
          this.updateConsentComplianceStats(true);
        }
      }

      // Perform PII detection
      const minConfidence = options.minConfidence || this.securityPolicy.minConfidenceThreshold;
      const detections = this.piiDetector.scanText(logEntry.message, minConfidence);

      // Apply policy-based filtering
      const filteredDetections = this.applySecurityPolicyFiltering(detections);

      // Calculate risk score and classification
      const riskScore = this.calculateRiskScore(filteredDetections, logEntry.level);
      const classification = this.classifyData(filteredDetections, riskScore);

      // Generate security alerts if necessary
      await this.generateSecurityAlerts(scanId, filteredDetections, classification, options.userId);

      // Auto-sanitize if enabled and consent allows
      let sanitizationResult: SanitizationResult | undefined;
      if (options.autoSanitize !== false && 
          this.securityPolicy.autoSanitization.enabled &&
          consentValid &&
          this.shouldAutoSanitize(filteredDetections)) {
        
        sanitizationResult = this.dataSanitizer.sanitizeText(logEntry.message, filteredDetections);
      }

      const scanTimeMs = performance.now() - startTime;
      
      const scanResult: SecurityScanResult = {
        scanId,
        scanTimestamp: new Date(),
        scannedText: logEntry.message,
        detections: filteredDetections,
        riskScore,
        classification,
        scanTimeMs,
        scanSuccessful: true,
        scanErrors: []
      };

      // Update log entry with security information
      if (sanitizationResult?.wasModified) {
        logEntry.sanitizedMessage = sanitizationResult.sanitizedText;
      }
      logEntry.classification = classification;

      // Update statistics
      this.updateStatistics(scanResult, filteredDetections);

      // Store scan history
      this.storeScanResult(scanId, scanResult);

      return scanResult;

    } catch (error) {
      const scanTimeMs = performance.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      
      return this.createFailedScanResult(scanId, logEntry.message, [errorMessage], scanTimeMs);
    }
  }

  /**
   * Scans and processes multiple log entries in batch
   * @param logEntries - Array of log entries to scan
   * @param options - Scan options
   * @returns Array of security scan results
   */
  public async scanLogEntries(logEntries: LogEntry[], options: SecurityScanOptions = {}): Promise<SecurityScanResult[]> {
    const results: SecurityScanResult[] = [];
    
    // Process in batches to avoid blocking the main thread
    const batchSize = 10;
    
    for (let i = 0; i < logEntries.length; i += batchSize) {
      const batch = logEntries.slice(i, i + batchSize);
      const batchPromises = batch.map(entry => this.scanLogEntry(entry, options));
      const batchResults = await Promise.all(batchPromises);
      results.push(...batchResults);

      // Yield control to prevent blocking
      if (i + batchSize < logEntries.length) {
        await new Promise(resolve => setTimeout(resolve, 1));
      }
    }

    return results;
  }

  /**
   * Updates security policy configuration
   * @param policyUpdates - Partial policy updates
   */
  public updateSecurityPolicy(policyUpdates: Partial<SecurityPolicy>): void {
    Object.assign(this.securityPolicy, policyUpdates);
    
    // Update sanitizer configuration if needed
    if (policyUpdates.autoSanitization) {
      this.dataSanitizer.updateConfig({
        typeStrategies: this.convertPolicyToSanitizerStrategies(policyUpdates.autoSanitization.thresholds)
      });
    }
  }

  /**
   * Gets current security engine statistics
   * @returns Security engine statistics
   */
  public getStatistics(): SecurityEngineStatistics {
    return { ...this.statistics };
  }

  /**
   * Gets security alerts matching criteria
   * @param severity - Optional severity filter
   * @param resolved - Optional resolved status filter
   * @param limit - Maximum number of alerts to return
   * @returns Array of security alerts
   */
  public getSecurityAlerts(severity?: SecurityAlert['severity'], resolved?: boolean, limit: number = 50): SecurityAlert[] {
    const alerts = Array.from(this.alerts.values())
      .filter(alert => {
        if (severity && alert.severity !== severity) return false;
        if (resolved !== undefined && alert.resolved !== resolved) return false;
        return true;
      })
      .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime())
      .slice(0, limit);

    return alerts;
  }

  /**
   * Resolves a security alert
   * @param alertId - Alert ID to resolve
   * @returns Whether alert was found and resolved
   */
  public resolveSecurityAlert(alertId: string): boolean {
    const alert = this.alerts.get(alertId);
    
    if (alert) {
      alert.resolved = true;
      return true;
    }
    
    return false;
  }

  /**
   * Gets scan history for analysis
   * @param scanId - Optional specific scan ID
   * @param limit - Maximum number of results
   * @returns Array of scan results
   */
  public getScanHistory(scanId?: string, limit: number = 100): SecurityScanResult[] {
    if (scanId) {
      return this.scanHistory.get(scanId) || [];
    }

    const allScans: SecurityScanResult[] = [];
    
    for (const scans of this.scanHistory.values()) {
      allScans.push(...scans);
    }

    return allScans
      .sort((a, b) => b.scanTimestamp.getTime() - a.scanTimestamp.getTime())
      .slice(0, limit);
  }

  /**
   * Performs health check on security engine components
   * @returns Health check results
   */
  public healthCheck(): {
    overall: 'healthy' | 'degraded' | 'unhealthy';
    components: {
      piiDetector: 'healthy' | 'unhealthy';
      dataSanitizer: 'healthy' | 'unhealthy';
      consentManager: 'healthy' | 'unhealthy';
    };
    performance: {
      averageScanTimeMs: number;
      recentErrorRate: number;
    };
    alerts: {
      critical: number;
      high: number;
      unresolved: number;
    };
  } {
    const piiMetrics = this.piiDetector.getPerformanceMetrics();
    const sanitizerStats = this.dataSanitizer.getStatistics();
    const consentStats = this.consentManager.getConsentStatistics();
    
    // Check component health
    const piiDetectorHealth = piiMetrics.averageScanTimeMs < 10 ? 'healthy' : 'unhealthy';
    const dataSanitizerHealth = sanitizerStats.totalActions >= 0 ? 'healthy' : 'unhealthy';
    const consentManagerHealth = consentStats.totalUsers >= 0 ? 'healthy' : 'unhealthy';
    
    // Calculate recent error rate
    const recentScans = this.getScanHistory(undefined, 100);
    const failedScans = recentScans.filter(scan => !scan.scanSuccessful).length;
    const recentErrorRate = recentScans.length > 0 ? failedScans / recentScans.length : 0;
    
    // Count alerts by severity
    const alerts = Array.from(this.alerts.values());
    const criticalAlerts = alerts.filter(a => a.severity === 'critical' && !a.resolved).length;
    const highAlerts = alerts.filter(a => a.severity === 'high' && !a.resolved).length;
    const unresolvedAlerts = alerts.filter(a => !a.resolved).length;
    
    // Determine overall health
    let overall: 'healthy' | 'degraded' | 'unhealthy' = 'healthy';
    
    if (criticalAlerts > 0 || recentErrorRate > 0.1 || 
        [piiDetectorHealth, dataSanitizerHealth, consentManagerHealth].includes('unhealthy')) {
      overall = 'unhealthy';
    } else if (highAlerts > 0 || recentErrorRate > 0.05 || this.statistics.scanPerformance.averageTimeMs > 5) {
      overall = 'degraded';
    }

    return {
      overall,
      components: {
        piiDetector: piiDetectorHealth,
        dataSanitizer: dataSanitizerHealth,
        consentManager: consentManagerHealth
      },
      performance: {
        averageScanTimeMs: this.statistics.scanPerformance.averageTimeMs,
        recentErrorRate
      },
      alerts: {
        critical: criticalAlerts,
        high: highAlerts,
        unresolved: unresolvedAlerts
      }
    };
  }

  /**
   * Exports comprehensive security audit report
   * @param userId - Optional user ID filter
   * @param fromDate - Optional start date
   * @param toDate - Optional end date
   * @returns Security audit report
   */
  public exportSecurityAuditReport(userId?: string, fromDate?: Date, toDate?: Date): {
    reportMetadata: {
      generatedAt: Date;
      reportId: string;
      coverage: { fromDate?: Date; toDate?: Date; userId?: string };
    };
    statistics: SecurityEngineStatistics;
    alerts: SecurityAlert[];
    scanHistory: SecurityScanResult[];
    consentAudit: AuditLogEntry[];
    policyCompliance: {
      totalScans: number;
      compliantScans: number;
      complianceRate: number;
    };
  } {
    const reportId = `security_audit_${Date.now()}`;
    
    // Filter scan history by date range
    let scanHistory = this.getScanHistory(undefined, 10000);
    if (fromDate || toDate) {
      scanHistory = scanHistory.filter(scan => {
        if (fromDate && scan.scanTimestamp < fromDate) return false;
        if (toDate && scan.scanTimestamp > toDate) return false;
        return true;
      });
    }

    // Get consent audit log
    const consentAudit = this.consentManager.getAuditLog(userId, undefined, fromDate, toDate);

    // Calculate policy compliance
    const totalScans = scanHistory.length;
    const compliantScans = scanHistory.filter(scan => scan.scanSuccessful).length;
    const complianceRate = totalScans > 0 ? compliantScans / totalScans : 1;

    return {
      reportMetadata: {
        generatedAt: new Date(),
        reportId,
        coverage: { fromDate, toDate, userId }
      },
      statistics: this.getStatistics(),
      alerts: this.getSecurityAlerts(),
      scanHistory,
      consentAudit,
      policyCompliance: {
        totalScans,
        compliantScans,
        complianceRate
      }
    };
  }

  /**
   * Initializes security engine with default configurations
   */
  private initializeSecurityEngine(): void {
    // Set up consent change event listener
    this.consentManager.addEventListener('consentChange', (event) => {
      console.log(`Security Engine: Consent changed for user ${event.userId}`);
    });

    // Initialize detection statistics
    const supportedTypes = this.piiDetector.getSupportedPIITypes();
    for (const type of supportedTypes) {
      this.statistics.detectionStats[type] = 0;
    }
  }

  /**
   * Applies security policy filtering to PII detections
   * @param detections - Raw PII detections
   * @returns Filtered detections based on policy
   */
  private applySecurityPolicyFiltering(detections: PIIDetectionResult[]): PIIDetectionResult[] {
    return detections.filter(detection => {
      // Filter by confidence threshold
      if (detection.confidence < this.securityPolicy.minConfidenceThreshold) {
        return false;
      }

      // Filter by auto-sanitization thresholds
      const threshold = this.securityPolicy.autoSanitization.thresholds[detection.type];
      if (threshold !== undefined && detection.confidence < threshold) {
        return false;
      }

      return true;
    });
  }

  /**
   * Calculates risk score based on PII detections and context
   * @param detections - PII detections
   * @param logLevel - Log level for context
   * @returns Risk score (0-1)
   */
  private calculateRiskScore(detections: PIIDetectionResult[], logLevel: string): number {
    if (detections.length === 0) {
      return 0;
    }

    let riskScore = 0;
    
    // Base risk from PII types
    for (const detection of detections) {
      let typeRisk = 0;
      
      switch (detection.type) {
        case 'creditCard':
        case 'ssn':
          typeRisk = 0.9;
          break;
        case 'password':
        case 'apiKey':
        case 'jwt':
          typeRisk = 0.8;
          break;
        case 'email':
        case 'phone':
          typeRisk = 0.6;
          break;
        case 'ipAddress':
          typeRisk = 0.4;
          break;
        default:
          typeRisk = 0.5;
      }
      
      // Weight by confidence
      riskScore = Math.max(riskScore, typeRisk * detection.confidence);
    }

    // Adjust based on log level
    const logLevelMultiplier = logLevel === 'error' ? 1.2 : logLevel === 'warn' ? 1.1 : 1.0;
    riskScore *= logLevelMultiplier;

    // Adjust based on number of detections
    if (detections.length > 1) {
      riskScore = Math.min(1.0, riskScore * (1 + (detections.length - 1) * 0.1));
    }

    return Math.min(1.0, riskScore);
  }

  /**
   * Classifies data based on PII detections and risk score
   * @param detections - PII detections
   * @param riskScore - Calculated risk score
   * @returns Data classification
   */
  private classifyData(detections: PIIDetectionResult[], riskScore: number): DataClassification {
    let sensitivityLevel: SensitivityLevel = 'public';
    
    if (riskScore >= 0.8 || detections.some(d => ['creditCard', 'ssn', 'password'].includes(d.type))) {
      sensitivityLevel = 'restricted';
    } else if (riskScore >= 0.6 || detections.some(d => ['apiKey', 'jwt'].includes(d.type))) {
      sensitivityLevel = 'confidential';
    } else if (riskScore >= 0.3 || detections.length > 0) {
      sensitivityLevel = 'internal';
    }

    return {
      sensitivityLevel,
      detectedTypes: detections.map(d => d.type),
      confidence: detections.length > 0 ? Math.max(...detections.map(d => d.confidence)) : 0,
      scanTimestamp: new Date(),
      sanitized: false // Will be updated if sanitization occurs
    };
  }

  /**
   * Determines if auto-sanitization should be applied
   * @param detections - PII detections
   * @returns Whether to auto-sanitize
   */
  private shouldAutoSanitize(detections: PIIDetectionResult[]): boolean {
    if (!this.securityPolicy.autoSanitization.enabled) {
      return false;
    }

    return detections.some(detection => {
      const threshold = this.securityPolicy.autoSanitization.thresholds[detection.type];
      return threshold !== undefined && detection.confidence >= threshold;
    });
  }

  /**
   * Generates security alerts based on scan results
   * @param scanId - Scan identifier
   * @param detections - PII detections
   * @param classification - Data classification
   * @param userId - Optional user ID
   */
  private async generateSecurityAlerts(
    scanId: string,
    detections: PIIDetectionResult[],
    classification: DataClassification,
    userId?: string
  ): Promise<void> {
    // Alert for high-risk PII detection
    if (classification.sensitivityLevel === 'restricted') {
      const alert: SecurityAlert = {
        id: `alert_${Date.now()}_${Math.random().toString(36).substring(2)}`,
        severity: 'high',
        type: 'pii_detected',
        message: `High-risk PII detected in scan ${scanId}`,
        details: {
          scanId,
          detectedTypes: classification.detectedTypes,
          sensitivityLevel: classification.sensitivityLevel,
          userId: userId || 'unknown'
        },
        timestamp: new Date(),
        resolved: false
      };
      
      this.alerts.set(alert.id, alert);
    }

    // Alert for multiple PII types
    if (detections.length >= 3) {
      const alert: SecurityAlert = {
        id: `alert_${Date.now()}_${Math.random().toString(36).substring(2)}`,
        severity: 'medium',
        type: 'pii_detected',
        message: `Multiple PII types detected in single scan: ${detections.length} types found`,
        details: {
          scanId,
          detectionCount: detections.length,
          detectedTypes: classification.detectedTypes,
          userId: userId || 'unknown'
        },
        timestamp: new Date(),
        resolved: false
      };
      
      this.alerts.set(alert.id, alert);
    }
  }

  /**
   * Updates engine statistics with scan results
   * @param scanResult - Scan result to process
   * @param detections - PII detections
   */
  private updateStatistics(scanResult: SecurityScanResult, detections: PIIDetectionResult[]): void {
    this.statistics.totalScans++;
    this.statistics.totalPIIDetected += detections.length;

    // Update performance metrics
    const currentAvg = this.statistics.scanPerformance.averageTimeMs;
    const totalScans = this.statistics.totalScans;
    this.statistics.scanPerformance.averageTimeMs = 
      (currentAvg * (totalScans - 1) + scanResult.scanTimeMs) / totalScans;
    
    this.statistics.scanPerformance.minTimeMs = Math.min(
      this.statistics.scanPerformance.minTimeMs, 
      scanResult.scanTimeMs
    );
    
    this.statistics.scanPerformance.maxTimeMs = Math.max(
      this.statistics.scanPerformance.maxTimeMs, 
      scanResult.scanTimeMs
    );

    // Update detection statistics
    for (const detection of detections) {
      this.statistics.detectionStats[detection.type] = 
        (this.statistics.detectionStats[detection.type] || 0) + 1;
    }

    // Update risk level distribution
    this.statistics.riskLevelDistribution[scanResult.classification.sensitivityLevel]++;
  }

  /**
   * Updates consent compliance statistics
   * @param compliant - Whether scan was compliant
   */
  private updateConsentComplianceStats(compliant: boolean): void {
    if (compliant) {
      this.statistics.consentCompliance.compliantScans++;
    } else {
      this.statistics.consentCompliance.nonCompliantScans++;
    }
  }

  /**
   * Stores scan result in history
   * @param scanId - Scan identifier
   * @param scanResult - Scan result to store
   */
  private storeScanResult(scanId: string, scanResult: SecurityScanResult): void {
    if (!this.scanHistory.has(scanId)) {
      this.scanHistory.set(scanId, []);
    }
    
    this.scanHistory.get(scanId)!.push(scanResult);
    
    // Limit history size to prevent memory issues
    const maxHistorySize = 1000;
    if (this.scanHistory.size > maxHistorySize) {
      const oldestScanId = Array.from(this.scanHistory.keys())[0];
      this.scanHistory.delete(oldestScanId);
    }
  }

  /**
   * Creates a failed scan result
   * @param scanId - Scan identifier
   * @param scannedText - Text that was being scanned
   * @param errors - Array of error messages
   * @param scanTimeMs - Optional scan time
   * @returns Failed scan result
   */
  private createFailedScanResult(
    scanId: string, 
    scannedText: string, 
    errors: string[], 
    scanTimeMs?: number
  ): SecurityScanResult {
    return {
      scanId,
      scanTimestamp: new Date(),
      scannedText,
      detections: [],
      riskScore: 0,
      classification: {
        sensitivityLevel: 'public',
        detectedTypes: [],
        confidence: 0,
        scanTimestamp: new Date(),
        sanitized: false
      },
      scanTimeMs: scanTimeMs || 0,
      scanSuccessful: false,
      scanErrors: errors
    };
  }

  /**
   * Converts policy thresholds to sanitizer strategies
   * @param thresholds - Policy thresholds
   * @returns Sanitizer type strategies
   */
  private convertPolicyToSanitizerStrategies(
    thresholds?: Record<PIIType, number>
  ): Partial<Record<PIIType, any>> {
    if (!thresholds) return {};

    const strategies: Partial<Record<PIIType, any>> = {};
    
    for (const [piiType, threshold] of Object.entries(thresholds)) {
      // Higher thresholds mean more aggressive sanitization
      if (threshold >= 0.8) {
        strategies[piiType as PIIType] = 'remove';
      } else if (threshold >= 0.6) {
        strategies[piiType as PIIType] = 'hash';
      } else if (threshold >= 0.4) {
        strategies[piiType as PIIType] = 'mask';
      } else {
        strategies[piiType as PIIType] = 'partial';
      }
    }

    return strategies;
  }

  /**
   * Generates unique scan identifier
   * @returns Unique scan ID
   */
  private generateScanId(): string {
    return `scan_${Date.now()}_${Math.random().toString(36).substring(2)}`;
  }
}