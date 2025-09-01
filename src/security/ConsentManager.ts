/**
 * ConsentManager.ts
 * Manages user consent for data processing with GDPR/CCPA compliance
 * Implements privacy-by-design principles with comprehensive consent tracking
 */

import {
  ConsentPreferences,
  ConsentStatus,
  ProcessingPurpose,
  ConsentRecord,
  AuditLogEntry
} from '../types/index.js';

/**
 * Event emitted when consent status changes
 */
export interface ConsentChangeEvent {
  userId: string;
  purpose: ProcessingPurpose;
  oldStatus: ConsentStatus;
  newStatus: ConsentStatus;
  timestamp: Date;
}

/**
 * Consent verification result
 */
export interface ConsentVerificationResult {
  isValid: boolean;
  hasConsent: boolean;
  consentStatus: ConsentStatus;
  expiryDate?: Date;
  lastUpdated: Date;
  requiresRenewal: boolean;
}

/**
 * Consent collection options
 */
export interface ConsentCollectionOptions {
  purposes: ProcessingPurpose[];
  required: boolean;
  expiryDays?: number;
  granular: boolean;
  description: string;
  legalBasis: 'consent' | 'legitimate_interest' | 'contract';
}

/**
 * Privacy notice configuration
 */
export interface PrivacyNoticeConfig {
  version: string;
  lastUpdated: Date;
  purposes: Array<{
    purpose: ProcessingPurpose;
    description: string;
    legalBasis: string;
    dataTypes: string[];
    retentionPeriod: string;
    withdrawable: boolean;
  }>;
  contactInfo: {
    dpoEmail?: string;
    privacyEmail: string;
    companyName: string;
  };
  jurisdiction: 'GDPR' | 'CCPA' | 'BOTH';
}

/**
 * Data subject rights request
 */
export interface DataSubjectRequest {
  id: string;
  userId: string;
  requestType: 'access' | 'rectification' | 'erasure' | 'portability' | 'restriction' | 'objection';
  status: 'pending' | 'processing' | 'completed' | 'rejected';
  requestDate: Date;
  completionDate?: Date;
  description: string;
  attachments?: string[];
}

/**
 * Comprehensive consent management system for privacy compliance
 * Supports GDPR, CCPA, and other privacy frameworks
 */
export class ConsentManager {
  private readonly preferences: Map<string, ConsentPreferences>;
  private readonly auditLog: AuditLogEntry[];
  private readonly dataSubjectRequests: Map<string, DataSubjectRequest>;
  private readonly privacyNotice: PrivacyNoticeConfig;
  private readonly eventListeners: Map<string, Array<(event: ConsentChangeEvent) => void>>;
  private readonly consentExpiryDays: number;

  constructor(privacyNotice: PrivacyNoticeConfig, consentExpiryDays: number = 365) {
    this.preferences = new Map();
    this.auditLog = [];
    this.dataSubjectRequests = new Map();
    this.privacyNotice = privacyNotice;
    this.eventListeners = new Map();
    this.consentExpiryDays = consentExpiryDays;

    // Initialize default event listeners
    this.initializeEventHandlers();
  }

  /**
   * Records user consent for specified purposes
   * @param userId - User identifier
   * @param purposes - Processing purposes to consent to
   * @param consentGiven - Whether consent is granted
   * @param ipAddress - IP address of user when consent was given
   * @param userAgent - User agent when consent was given
   * @returns Updated consent preferences
   */
  public async recordConsent(
    userId: string,
    purposes: ProcessingPurpose[],
    consentGiven: boolean,
    ipAddress: string,
    userAgent: string
  ): Promise<ConsentPreferences> {
    const timestamp = new Date();
    const consentStatus: ConsentStatus = consentGiven ? 'granted' : 'denied';

    // Get existing preferences or create new ones
    let preferences = this.preferences.get(userId);
    
    if (!preferences) {
      preferences = {
        id: this.generateConsentId(),
        userId,
        purposes: {} as Record<ProcessingPurpose, ConsentStatus>,
        piiProcessing: 'pending',
        dataRetentionHours: 24 * this.consentExpiryDays,
        consentTimestamp: timestamp,
        lastUpdated: timestamp,
        ipAddress,
        userAgent
      };
    }

    // Update consent for specified purposes
    const oldStatuses: Record<ProcessingPurpose, ConsentStatus> = { ...preferences.purposes };
    
    for (const purpose of purposes) {
      const oldStatus = preferences.purposes[purpose] || 'pending';
      preferences.purposes[purpose] = consentStatus;

      // Emit consent change event
      this.emitConsentChange({
        userId,
        purpose,
        oldStatus,
        newStatus: consentStatus,
        timestamp
      });

      // Create audit log entry
      this.addAuditLogEntry({
        id: this.generateAuditId(),
        timestamp,
        eventType: 'consent_given',
        userId,
        details: {
          purpose,
          consentStatus,
          oldStatus,
          ipAddress,
          userAgent,
          consentId: preferences.id
        },
        ipAddress,
        userAgent,
        compliance: {
          gdpr: this.privacyNotice.jurisdiction === 'GDPR' || this.privacyNotice.jurisdiction === 'BOTH',
          ccpa: this.privacyNotice.jurisdiction === 'CCPA' || this.privacyNotice.jurisdiction === 'BOTH',
          hipaa: false
        }
      });
    }

    // Update global PII processing consent based on individual purposes
    preferences.piiProcessing = this.calculateGlobalPIIConsent(preferences.purposes);
    preferences.lastUpdated = timestamp;
    preferences.ipAddress = ipAddress;
    preferences.userAgent = userAgent;

    // Store updated preferences
    this.preferences.set(userId, preferences);

    return preferences;
  }

  /**
   * Withdraws consent for specified purposes
   * @param userId - User identifier
   * @param purposes - Purposes to withdraw consent for
   * @param ipAddress - IP address of user
   * @param userAgent - User agent
   * @returns Updated consent preferences
   */
  public async withdrawConsent(
    userId: string,
    purposes: ProcessingPurpose[],
    ipAddress: string,
    userAgent: string
  ): Promise<ConsentPreferences | null> {
    const preferences = this.preferences.get(userId);
    
    if (!preferences) {
      return null;
    }

    const timestamp = new Date();

    for (const purpose of purposes) {
      const oldStatus = preferences.purposes[purpose];
      preferences.purposes[purpose] = 'withdrawn';

      // Emit consent change event
      this.emitConsentChange({
        userId,
        purpose,
        oldStatus: oldStatus || 'pending',
        newStatus: 'withdrawn',
        timestamp
      });

      // Create audit log entry
      this.addAuditLogEntry({
        id: this.generateAuditId(),
        timestamp,
        eventType: 'consent_withdrawn',
        userId,
        details: {
          purpose,
          oldStatus,
          ipAddress,
          userAgent,
          consentId: preferences.id
        },
        ipAddress,
        userAgent,
        compliance: {
          gdpr: this.privacyNotice.jurisdiction === 'GDPR' || this.privacyNotice.jurisdiction === 'BOTH',
          ccpa: this.privacyNotice.jurisdiction === 'CCPA' || this.privacyNotice.jurisdiction === 'BOTH',
          hipaa: false
        }
      });
    }

    // Update global PII processing consent
    preferences.piiProcessing = this.calculateGlobalPIIConsent(preferences.purposes);
    preferences.lastUpdated = timestamp;

    this.preferences.set(userId, preferences);

    return preferences;
  }

  /**
   * Verifies if user has valid consent for a specific purpose
   * @param userId - User identifier
   * @param purpose - Processing purpose to verify
   * @returns Consent verification result
   */
  public verifyConsent(userId: string, purpose: ProcessingPurpose): ConsentVerificationResult {
    const preferences = this.preferences.get(userId);
    
    if (!preferences) {
      return {
        isValid: false,
        hasConsent: false,
        consentStatus: 'pending',
        lastUpdated: new Date(0),
        requiresRenewal: true
      };
    }

    const consentStatus = preferences.purposes[purpose] || 'pending';
    const hasConsent = consentStatus === 'granted';
    
    // Check if consent has expired
    const expiryDate = new Date(preferences.consentTimestamp);
    expiryDate.setDate(expiryDate.getDate() + this.consentExpiryDays);
    
    const isExpired = new Date() > expiryDate;
    const requiresRenewal = isExpired && hasConsent;

    return {
      isValid: hasConsent && !isExpired,
      hasConsent,
      consentStatus: requiresRenewal ? 'pending' : consentStatus,
      expiryDate,
      lastUpdated: preferences.lastUpdated,
      requiresRenewal
    };
  }

  /**
   * Gets user's consent preferences
   * @param userId - User identifier
   * @returns User's consent preferences or null if not found
   */
  public getConsentPreferences(userId: string): ConsentPreferences | null {
    return this.preferences.get(userId) || null;
  }

  /**
   * Updates user's data retention preference
   * @param userId - User identifier
   * @param retentionHours - Number of hours to retain data
   * @returns Updated preferences
   */
  public async updateDataRetention(userId: string, retentionHours: number): Promise<ConsentPreferences | null> {
    const preferences = this.preferences.get(userId);
    
    if (!preferences) {
      return null;
    }

    const oldRetention = preferences.dataRetentionHours;
    preferences.dataRetentionHours = Math.min(retentionHours, 24 * this.consentExpiryDays);
    preferences.lastUpdated = new Date();

    // Create audit log entry
    this.addAuditLogEntry({
      id: this.generateAuditId(),
      timestamp: new Date(),
      eventType: 'consent_given', // Data retention is part of consent
      userId,
      details: {
        retentionChanged: true,
        oldRetentionHours: oldRetention,
        newRetentionHours: preferences.dataRetentionHours,
        consentId: preferences.id
      },
      ipAddress: preferences.ipAddress,
      userAgent: preferences.userAgent,
      compliance: {
        gdpr: this.privacyNotice.jurisdiction === 'GDPR' || this.privacyNotice.jurisdiction === 'BOTH',
        ccpa: this.privacyNotice.jurisdiction === 'CCPA' || this.privacyNotice.jurisdiction === 'BOTH',
        hipaa: false
      }
    });

    this.preferences.set(userId, preferences);
    
    return preferences;
  }

  /**
   * Submits a data subject rights request
   * @param userId - User identifier
   * @param requestType - Type of request
   * @param description - Request description
   * @returns Data subject request record
   */
  public async submitDataSubjectRequest(
    userId: string,
    requestType: DataSubjectRequest['requestType'],
    description: string
  ): Promise<DataSubjectRequest> {
    const request: DataSubjectRequest = {
      id: this.generateRequestId(),
      userId,
      requestType,
      status: 'pending',
      requestDate: new Date(),
      description
    };

    this.dataSubjectRequests.set(request.id, request);

    // Create audit log entry
    this.addAuditLogEntry({
      id: this.generateAuditId(),
      timestamp: new Date(),
      eventType: 'data_exported', // Generic event for data subject rights
      userId,
      details: {
        requestType,
        requestId: request.id,
        description
      },
      ipAddress: this.preferences.get(userId)?.ipAddress || 'unknown',
      userAgent: this.preferences.get(userId)?.userAgent || 'unknown',
      compliance: {
        gdpr: true,
        ccpa: true,
        hipaa: false
      }
    });

    return request;
  }

  /**
   * Gets all data subject requests for a user
   * @param userId - User identifier
   * @returns Array of data subject requests
   */
  public getDataSubjectRequests(userId: string): DataSubjectRequest[] {
    return Array.from(this.dataSubjectRequests.values())
      .filter(request => request.userId === userId)
      .sort((a, b) => b.requestDate.getTime() - a.requestDate.getTime());
  }

  /**
   * Processes data deletion request (right to be forgotten)
   * @param userId - User identifier
   * @returns Whether deletion was successful
   */
  public async processDataDeletion(userId: string): Promise<boolean> {
    try {
      // Remove consent preferences
      this.preferences.delete(userId);

      // Remove user's data subject requests (keep anonymized version for compliance)
      const userRequests = this.getDataSubjectRequests(userId);
      for (const request of userRequests) {
        request.userId = '[DELETED]';
        this.dataSubjectRequests.set(request.id, request);
      }

      // Create audit log entry for deletion
      this.addAuditLogEntry({
        id: this.generateAuditId(),
        timestamp: new Date(),
        eventType: 'data_deleted',
        userId: '[DELETED]', // Don't store user ID after deletion
        details: {
          deletionReason: 'data_subject_request',
          originalUserId: this.hashUserId(userId), // Store hashed version for audit
          requestCount: userRequests.length
        },
        ipAddress: 'unknown',
        userAgent: 'system',
        compliance: {
          gdpr: true,
          ccpa: true,
          hipaa: false
        }
      });

      return true;
    } catch (error) {
      console.error('Error processing data deletion:', error);
      return false;
    }
  }

  /**
   * Gets privacy notice configuration
   * @returns Privacy notice configuration
   */
  public getPrivacyNotice(): PrivacyNoticeConfig {
    return { ...this.privacyNotice };
  }

  /**
   * Gets audit log entries for compliance reporting
   * @param userId - Optional user ID filter
   * @param eventType - Optional event type filter
   * @param fromDate - Optional start date filter
   * @param toDate - Optional end date filter
   * @returns Filtered audit log entries
   */
  public getAuditLog(
    userId?: string,
    eventType?: AuditLogEntry['eventType'],
    fromDate?: Date,
    toDate?: Date
  ): AuditLogEntry[] {
    return this.auditLog.filter(entry => {
      if (userId && entry.userId !== userId) return false;
      if (eventType && entry.eventType !== eventType) return false;
      if (fromDate && entry.timestamp < fromDate) return false;
      if (toDate && entry.timestamp > toDate) return false;
      return true;
    });
  }

  /**
   * Exports user's consent data for portability requests
   * @param userId - User identifier
   * @returns User's consent data in portable format
   */
  public exportUserConsentData(userId: string): {
    preferences: ConsentPreferences | null;
    auditTrail: AuditLogEntry[];
    requests: DataSubjectRequest[];
    privacyNotice: PrivacyNoticeConfig;
  } {
    return {
      preferences: this.getConsentPreferences(userId),
      auditTrail: this.getAuditLog(userId),
      requests: this.getDataSubjectRequests(userId),
      privacyNotice: this.getPrivacyNotice()
    };
  }

  /**
   * Adds event listener for consent changes
   * @param eventName - Event name to listen to
   * @param listener - Event listener function
   */
  public addEventListener(eventName: string, listener: (event: ConsentChangeEvent) => void): void {
    if (!this.eventListeners.has(eventName)) {
      this.eventListeners.set(eventName, []);
    }
    
    this.eventListeners.get(eventName)!.push(listener);
  }

  /**
   * Removes event listener
   * @param eventName - Event name
   * @param listener - Event listener function to remove
   */
  public removeEventListener(eventName: string, listener: (event: ConsentChangeEvent) => void): void {
    const listeners = this.eventListeners.get(eventName);
    
    if (listeners) {
      const index = listeners.indexOf(listener);
      if (index !== -1) {
        listeners.splice(index, 1);
      }
    }
  }

  /**
   * Gets consent statistics for compliance reporting
   * @returns Consent statistics
   */
  public getConsentStatistics(): {
    totalUsers: number;
    consentsByPurpose: Record<ProcessingPurpose, { granted: number; denied: number; withdrawn: number; pending: number }>;
    consentsByStatus: Record<ConsentStatus, number>;
    averageRetentionHours: number;
    expiringSoon: number; // Users with consent expiring in next 30 days
  } {
    const stats = {
      totalUsers: this.preferences.size,
      consentsByPurpose: {} as Record<ProcessingPurpose, { granted: number; denied: number; withdrawn: number; pending: number }>,
      consentsByStatus: { granted: 0, denied: 0, withdrawn: 0, pending: 0 } as Record<ConsentStatus, number>,
      averageRetentionHours: 0,
      expiringSoon: 0
    };

    let totalRetentionHours = 0;
    const thirtyDaysFromNow = new Date();
    thirtyDaysFromNow.setDate(thirtyDaysFromNow.getDate() + 30);

    // Initialize purpose statistics
    const purposes: ProcessingPurpose[] = ['logging', 'analytics', 'debugging', 'performance_monitoring', 'error_reporting', 'export_functionality'];
    for (const purpose of purposes) {
      stats.consentsByPurpose[purpose] = { granted: 0, denied: 0, withdrawn: 0, pending: 0 };
    }

    for (const preferences of this.preferences.values()) {
      totalRetentionHours += preferences.dataRetentionHours;

      // Check if consent is expiring soon
      const expiryDate = new Date(preferences.consentTimestamp);
      expiryDate.setDate(expiryDate.getDate() + this.consentExpiryDays);
      if (expiryDate <= thirtyDaysFromNow) {
        stats.expiringSoon++;
      }

      // Count consent by purpose
      for (const [purpose, status] of Object.entries(preferences.purposes)) {
        if (stats.consentsByPurpose[purpose as ProcessingPurpose]) {
          stats.consentsByPurpose[purpose as ProcessingPurpose][status]++;
        }
      }

      // Count global PII processing consent
      stats.consentsByStatus[preferences.piiProcessing]++;
    }

    stats.averageRetentionHours = totalRetentionHours / Math.max(1, stats.totalUsers);

    return stats;
  }

  /**
   * Calculates global PII processing consent based on individual purpose consents
   * @param purposes - Purpose-specific consent statuses
   * @returns Global PII processing consent status
   */
  private calculateGlobalPIIConsent(purposes: Record<ProcessingPurpose, ConsentStatus>): ConsentStatus {
    const values = Object.values(purposes);
    
    if (values.some(status => status === 'withdrawn')) {
      return 'withdrawn';
    }
    
    if (values.some(status => status === 'denied')) {
      return 'denied';
    }
    
    if (values.every(status => status === 'granted')) {
      return 'granted';
    }
    
    return 'pending';
  }

  /**
   * Emits consent change event to all registered listeners
   * @param event - Consent change event data
   */
  private emitConsentChange(event: ConsentChangeEvent): void {
    const listeners = this.eventListeners.get('consentChange') || [];
    
    for (const listener of listeners) {
      try {
        listener(event);
      } catch (error) {
        console.error('Error in consent change listener:', error);
      }
    }
  }

  /**
   * Adds audit log entry
   * @param entry - Audit log entry to add
   */
  private addAuditLogEntry(entry: AuditLogEntry): void {
    this.auditLog.push(entry);
    
    // Limit audit log size to prevent memory issues (keep last 10,000 entries)
    if (this.auditLog.length > 10000) {
      this.auditLog.splice(0, this.auditLog.length - 10000);
    }
  }

  /**
   * Initializes default event handlers
   */
  private initializeEventHandlers(): void {
    // Add default handler for logging consent changes
    this.addEventListener('consentChange', (event) => {
      console.log(`Consent changed for user ${event.userId}: ${event.purpose} ${event.oldStatus} -> ${event.newStatus}`);
    });
  }

  /**
   * Generates unique consent ID
   * @returns Unique consent identifier
   */
  private generateConsentId(): string {
    return `consent_${Date.now()}_${Math.random().toString(36).substring(2)}`;
  }

  /**
   * Generates unique audit ID
   * @returns Unique audit identifier
   */
  private generateAuditId(): string {
    return `audit_${Date.now()}_${Math.random().toString(36).substring(2)}`;
  }

  /**
   * Generates unique request ID
   * @returns Unique request identifier
   */
  private generateRequestId(): string {
    return `request_${Date.now()}_${Math.random().toString(36).substring(2)}`;
  }

  /**
   * Hashes user ID for audit trail (when user data is deleted)
   * @param userId - User ID to hash
   * @returns Hashed user ID
   */
  private hashUserId(userId: string): string {
    // Simple hash implementation (in production, use proper cryptographic hash)
    let hash = 0;
    for (let i = 0; i < userId.length; i++) {
      const char = userId.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32bit integer
    }
    return `user_${Math.abs(hash).toString(16)}`;
  }
}