/**
 * DataSanitizer.ts
 * Sanitizes detected PII with configurable masking strategies
 * Preserves log readability while protecting sensitive data
 */

import {
  PIIDetectionResult,
  SanitizationConfig,
  SanitizationResult,
  SanitizationAction,
  SanitizationStrategy,
  PIIType
} from '../types/index.js';

/**
 * Data sanitization engine that removes or masks PII while preserving log readability
 * Implements multiple sanitization strategies with audit trail capabilities
 */
export class DataSanitizer {
  private readonly config: SanitizationConfig;
  private readonly auditTrail: SanitizationAction[];
  private readonly hashCache: Map<string, string>;

  constructor(config?: Partial<SanitizationConfig>) {
    this.config = {
      defaultStrategy: 'mask',
      typeStrategies: {
        creditCard: 'mask',
        ssn: 'mask',
        email: 'partial',
        phone: 'partial',
        apiKey: 'remove',
        jwt: 'remove',
        password: 'remove',
        ipAddress: 'hash',
        custom: 'mask'
      },
      maskCharacter: '*',
      partialPreserveLength: 4,
      preserveFormat: true,
      hashSalt: this.generateSalt(),
      ...config
    };

    this.auditTrail = [];
    this.hashCache = new Map();
  }

  /**
   * Sanitizes text containing detected PII
   * @param originalText - Original text containing PII
   * @param detections - Array of PII detections to sanitize
   * @returns Sanitization result with audit trail
   */
  public sanitizeText(originalText: string, detections: PIIDetectionResult[]): SanitizationResult {
    if (detections.length === 0) {
      return {
        originalText,
        sanitizedText: originalText,
        sanitizedDetections: [],
        actions: [],
        wasModified: false
      };
    }

    // Sort detections by start index in reverse order to maintain position integrity
    const sortedDetections = [...detections].sort((a, b) => b.startIndex - a.startIndex);
    
    let sanitizedText = originalText;
    const actions: SanitizationAction[] = [];
    const sanitizedDetections: PIIDetectionResult[] = [];

    for (const detection of sortedDetections) {
      const strategy = this.getStrategyForPIIType(detection.type);
      const sanitizedValue = this.applySanitizationStrategy(detection.value, detection.type, strategy);
      
      // Replace the detected PII with sanitized value
      const beforeText = sanitizedText.substring(0, detection.startIndex);
      const afterText = sanitizedText.substring(detection.endIndex);
      sanitizedText = beforeText + sanitizedValue + afterText;

      // Create sanitization action for audit trail
      const action: SanitizationAction = {
        piiType: detection.type,
        strategy,
        originalValueHash: this.hashValue(detection.value),
        sanitizedValue,
        position: {
          start: detection.startIndex,
          end: detection.endIndex
        },
        timestamp: new Date()
      };

      actions.push(action);
      this.auditTrail.push(action);

      // Update detection with new end position
      const updatedDetection: PIIDetectionResult = {
        ...detection,
        endIndex: detection.startIndex + sanitizedValue.length
      };
      
      sanitizedDetections.push(updatedDetection);
    }

    return {
      originalText,
      sanitizedText,
      sanitizedDetections,
      actions,
      wasModified: true
    };
  }

  /**
   * Sanitizes complex nested objects containing PII
   * @param data - Object that may contain PII
   * @param maxDepth - Maximum depth to traverse (prevents infinite recursion)
   * @returns Sanitized object with audit information
   */
  public sanitizeObject(data: unknown, maxDepth: number = 10): { 
    sanitizedData: unknown; 
    actions: SanitizationAction[];
    piiFound: boolean;
  } {
    if (maxDepth <= 0) {
      return {
        sanitizedData: data,
        actions: [],
        piiFound: false
      };
    }

    const actions: SanitizationAction[] = [];
    let piiFound = false;

    const sanitizeValue = (value: unknown, path: string = ''): unknown => {
      if (typeof value === 'string') {
        // Check if string contains PII (requires PIIDetector integration)
        // For now, we'll implement basic string sanitization
        const result = this.sanitizeStringValue(value, path);
        if (result.wasModified) {
          actions.push(...result.actions);
          piiFound = true;
        }
        return result.sanitizedValue;
      }

      if (Array.isArray(value)) {
        return value.map((item, index) => 
          sanitizeValue(item, `${path}[${index}]`)
        );
      }

      if (value && typeof value === 'object') {
        const sanitizedObj: Record<string, unknown> = {};
        
        for (const [key, val] of Object.entries(value)) {
          const currentPath = path ? `${path}.${key}` : key;
          
          // Check if key name suggests sensitive data
          if (this.isSensitiveKey(key)) {
            const sanitizedKey = this.sanitizeKeyValue(val, key, currentPath);
            sanitizedObj[key] = sanitizedKey.sanitizedValue;
            
            if (sanitizedKey.wasModified) {
              actions.push(...sanitizedKey.actions);
              piiFound = true;
            }
          } else {
            sanitizedObj[key] = sanitizeValue(val, currentPath);
          }
        }
        
        return sanitizedObj;
      }

      return value;
    };

    const sanitizedData = sanitizeValue(data);

    return {
      sanitizedData,
      actions,
      piiFound
    };
  }

  /**
   * Gets sanitization strategy for specific PII type
   * @param piiType - Type of PII
   * @returns Sanitization strategy to use
   */
  public getStrategyForPIIType(piiType: PIIType): SanitizationStrategy {
    return this.config.typeStrategies[piiType] || this.config.defaultStrategy;
  }

  /**
   * Updates sanitization configuration
   * @param updates - Partial configuration updates
   */
  public updateConfig(updates: Partial<SanitizationConfig>): void {
    Object.assign(this.config, updates);
  }

  /**
   * Gets current audit trail
   * @returns Array of sanitization actions
   */
  public getAuditTrail(): SanitizationAction[] {
    return [...this.auditTrail];
  }

  /**
   * Clears audit trail
   */
  public clearAuditTrail(): void {
    this.auditTrail.length = 0;
  }

  /**
   * Gets sanitization statistics
   * @returns Statistics about sanitization operations
   */
  public getStatistics(): {
    totalActions: number;
    actionsByType: Record<PIIType, number>;
    actionsByStrategy: Record<SanitizationStrategy, number>;
    lastActionTime: Date | null;
  } {
    const actionsByType: Record<PIIType, number> = {} as Record<PIIType, number>;
    const actionsByStrategy: Record<SanitizationStrategy, number> = {} as Record<SanitizationStrategy, number>;

    for (const action of this.auditTrail) {
      actionsByType[action.piiType] = (actionsByType[action.piiType] || 0) + 1;
      actionsByStrategy[action.strategy] = (actionsByStrategy[action.strategy] || 0) + 1;
    }

    return {
      totalActions: this.auditTrail.length,
      actionsByType,
      actionsByStrategy,
      lastActionTime: this.auditTrail.length > 0 
        ? this.auditTrail[this.auditTrail.length - 1].timestamp 
        : null
    };
  }

  /**
   * Applies specific sanitization strategy to a value
   * @param value - Value to sanitize
   * @param piiType - Type of PII
   * @param strategy - Sanitization strategy to apply
   * @returns Sanitized value
   */
  private applySanitizationStrategy(value: string, piiType: PIIType, strategy: SanitizationStrategy): string {
    switch (strategy) {
      case 'mask':
        return this.maskValue(value, piiType);
      
      case 'hash':
        return this.hashValue(value);
      
      case 'remove':
        return '[REDACTED]';
      
      case 'partial':
        return this.partialMaskValue(value, piiType);
      
      default:
        return this.maskValue(value, piiType);
    }
  }

  /**
   * Masks value with configured mask character
   * @param value - Value to mask
   * @param piiType - Type of PII for format preservation
   * @returns Masked value
   */
  private maskValue(value: string, piiType: PIIType): string {
    if (!this.config.preserveFormat) {
      return this.config.maskCharacter.repeat(value.length);
    }

    // Preserve format for specific PII types
    switch (piiType) {
      case 'creditCard':
        return value.replace(/\d/g, this.config.maskCharacter);
      
      case 'ssn':
        return value.replace(/\d/g, this.config.maskCharacter);
      
      case 'phone':
        return value.replace(/\d/g, this.config.maskCharacter);
      
      case 'email':
        const [local, domain] = value.split('@');
        const maskedLocal = local.length > 2 
          ? local[0] + this.config.maskCharacter.repeat(local.length - 2) + local[local.length - 1]
          : this.config.maskCharacter.repeat(local.length);
        return `${maskedLocal}@${domain}`;
      
      default:
        // Replace alphanumeric characters but preserve symbols
        return value.replace(/[a-zA-Z0-9]/g, this.config.maskCharacter);
    }
  }

  /**
   * Partially masks value, preserving some characters for readability
   * @param value - Value to partially mask
   * @param piiType - Type of PII
   * @returns Partially masked value
   */
  private partialMaskValue(value: string, piiType: PIIType): string {
    const preserveLength = Math.min(this.config.partialPreserveLength, Math.floor(value.length / 3));
    
    if (value.length <= preserveLength * 2) {
      return this.maskValue(value, piiType);
    }

    switch (piiType) {
      case 'email':
        const [local, domain] = value.split('@');
        if (local.length <= 4) {
          return `${local[0]}${this.config.maskCharacter.repeat(local.length - 1)}@${domain}`;
        }
        const maskedLocal = local.substring(0, 2) + 
          this.config.maskCharacter.repeat(local.length - 4) + 
          local.substring(local.length - 2);
        return `${maskedLocal}@${domain}`;
      
      case 'creditCard':
        const digits = value.replace(/\D/g, '');
        if (digits.length >= 8) {
          const masked = digits.substring(0, 4) + 
            this.config.maskCharacter.repeat(digits.length - 8) + 
            digits.substring(digits.length - 4);
          return value.replace(/\d/g, (match, index) => {
            const digitIndex = value.substring(0, index + 1).replace(/\D/g, '').length - 1;
            return masked[digitIndex] || match;
          });
        }
        return this.maskValue(value, piiType);
      
      case 'phone':
        const phoneDigits = value.replace(/\D/g, '');
        if (phoneDigits.length >= 7) {
          const maskedDigits = phoneDigits.substring(0, 3) + 
            this.config.maskCharacter.repeat(phoneDigits.length - 6) + 
            phoneDigits.substring(phoneDigits.length - 3);
          return value.replace(/\d/g, (match, index) => {
            const digitIndex = value.substring(0, index + 1).replace(/\D/g, '').length - 1;
            return maskedDigits[digitIndex] || match;
          });
        }
        return this.maskValue(value, piiType);
      
      default:
        // Generic partial masking
        const start = value.substring(0, preserveLength);
        const end = value.substring(value.length - preserveLength);
        const middle = this.config.maskCharacter.repeat(value.length - preserveLength * 2);
        return start + middle + end;
    }
  }

  /**
   * Hashes value using SHA-256 with salt
   * @param value - Value to hash
   * @returns Hashed value with indicator
   */
  private hashValue(value: string): string {
    // Check cache first for consistent hashing
    if (this.hashCache.has(value)) {
      return this.hashCache.get(value)!;
    }

    // Simple hash implementation (in production, use crypto.subtle)
    const saltedValue = value + this.config.hashSalt;
    let hash = 0;
    
    for (let i = 0; i < saltedValue.length; i++) {
      const char = saltedValue.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32bit integer
    }
    
    const hashString = `[HASH:${Math.abs(hash).toString(16).padStart(8, '0')}]`;
    
    // Cache the result
    this.hashCache.set(value, hashString);
    
    return hashString;
  }

  /**
   * Sanitizes string value (basic implementation without full PII detection)
   * @param value - String value to check and sanitize
   * @param path - Object path for audit trail
   * @returns Sanitization result
   */
  private sanitizeStringValue(value: string, path: string): {
    sanitizedValue: string;
    wasModified: boolean;
    actions: SanitizationAction[];
  } {
    // Basic patterns for common sensitive data in strings
    const sensitivePatterns: Array<{ pattern: RegExp; type: PIIType; strategy: SanitizationStrategy }> = [
      { pattern: /password\s*[:=]\s*['"]([^'"]+)['"]/gi, type: 'password', strategy: 'remove' },
      { pattern: /api[_-]?key\s*[:=]\s*['"]([^'"]+)['"]/gi, type: 'apiKey', strategy: 'remove' },
      { pattern: /token\s*[:=]\s*['"]([^'"]+)['"]/gi, type: 'jwt', strategy: 'remove' }
    ];

    let sanitizedValue = value;
    const actions: SanitizationAction[] = [];
    let wasModified = false;

    for (const { pattern, type, strategy } of sensitivePatterns) {
      let match;
      pattern.lastIndex = 0; // Reset regex state
      
      while ((match = pattern.exec(value)) !== null) {
        const originalMatch = match[0];
        const sensitiveValue = match[1];
        const sanitizedSensitiveValue = this.applySanitizationStrategy(sensitiveValue, type, strategy);
        const replacement = originalMatch.replace(sensitiveValue, sanitizedSensitiveValue);
        
        sanitizedValue = sanitizedValue.replace(originalMatch, replacement);
        wasModified = true;

        actions.push({
          piiType: type,
          strategy,
          originalValueHash: this.hashValue(sensitiveValue),
          sanitizedValue: sanitizedSensitiveValue,
          position: {
            start: match.index,
            end: match.index + originalMatch.length
          },
          timestamp: new Date()
        });

        // Prevent infinite loops
        if (match[0].length === 0) {
          pattern.lastIndex++;
        }
      }
    }

    return {
      sanitizedValue,
      wasModified,
      actions
    };
  }

  /**
   * Checks if object key name suggests sensitive data
   * @param key - Object key name
   * @returns Whether key suggests sensitive data
   */
  private isSensitiveKey(key: string): boolean {
    const sensitiveKeyPatterns = [
      /password/i,
      /passwd/i,
      /pwd/i,
      /secret/i,
      /token/i,
      /key/i,
      /auth/i,
      /credential/i,
      /ssn/i,
      /social/i,
      /credit/i,
      /card/i,
      /cvv/i,
      /cvc/i,
      /pin/i
    ];

    return sensitiveKeyPatterns.some(pattern => pattern.test(key));
  }

  /**
   * Sanitizes value based on sensitive key context
   * @param value - Value to sanitize
   * @param key - Object key that suggests sensitivity
   * @param path - Object path for audit trail
   * @returns Sanitization result
   */
  private sanitizeKeyValue(value: unknown, key: string, path: string): {
    sanitizedValue: unknown;
    wasModified: boolean;
    actions: SanitizationAction[];
  } {
    if (typeof value !== 'string') {
      return {
        sanitizedValue: '[REDACTED]',
        wasModified: true,
        actions: [{
          piiType: 'custom',
          strategy: 'remove',
          originalValueHash: this.hashValue(String(value)),
          sanitizedValue: '[REDACTED]',
          position: { start: 0, end: String(value).length },
          timestamp: new Date()
        }]
      };
    }

    // Determine PII type based on key name
    let piiType: PIIType = 'custom';
    if (/password|passwd|pwd/i.test(key)) piiType = 'password';
    else if (/token|auth/i.test(key)) piiType = 'jwt';
    else if (/key/i.test(key)) piiType = 'apiKey';
    else if (/ssn|social/i.test(key)) piiType = 'ssn';
    else if (/credit|card/i.test(key)) piiType = 'creditCard';

    const strategy = this.getStrategyForPIIType(piiType);
    const sanitizedValue = this.applySanitizationStrategy(value, piiType, strategy);

    return {
      sanitizedValue,
      wasModified: sanitizedValue !== value,
      actions: [{
        piiType,
        strategy,
        originalValueHash: this.hashValue(value),
        sanitizedValue,
        position: { start: 0, end: value.length },
        timestamp: new Date()
      }]
    };
  }

  /**
   * Generates a random salt for hashing
   * @returns Random salt string
   */
  private generateSalt(): string {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let salt = '';
    
    for (let i = 0; i < 32; i++) {
      salt += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    
    return salt;
  }
}