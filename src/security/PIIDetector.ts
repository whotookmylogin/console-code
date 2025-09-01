/**
 * PIIDetector.ts
 * Implements pattern-based PII detection using regex patterns
 * Provides high-performance scanning with confidence scoring
 */

import {
  PIIType,
  PIIPattern,
  PIIDetectionResult
} from '../types/index.js';

/**
 * High-performance PII detection engine using pattern matching
 * Implements zero-knowledge architecture with client-side only processing
 */
export class PIIDetector {
  private readonly patterns: Map<PIIType, PIIPattern[]>;
  private readonly customPatterns: PIIPattern[];
  private readonly performanceMetrics: {
    totalScans: number;
    totalScanTimeMs: number;
    averageScanTimeMs: number;
    lastScanTimeMs: number;
  };

  constructor() {
    this.patterns = new Map();
    this.customPatterns = [];
    this.performanceMetrics = {
      totalScans: 0,
      totalScanTimeMs: 0,
      averageScanTimeMs: 0,
      lastScanTimeMs: 0
    };

    this.initializeDefaultPatterns();
  }

  /**
   * Scans text for PII patterns with high performance and accuracy
   * @param text - Text to scan for PII
   * @param minConfidence - Minimum confidence threshold (0-1)
   * @returns Array of PII detection results
   */
  public scanText(text: string, minConfidence: number = 0.7): PIIDetectionResult[] {
    const startTime = performance.now();
    const detections: PIIDetectionResult[] = [];

    try {
      // Scan with each pattern type
      for (const [piiType, patterns] of this.patterns) {
        for (const pattern of patterns) {
          const matches = this.findPatternMatches(text, pattern);
          detections.push(...matches.filter(match => match.confidence >= minConfidence));
        }
      }

      // Scan custom patterns
      for (const pattern of this.customPatterns) {
        const matches = this.findPatternMatches(text, pattern);
        detections.push(...matches.filter(match => match.confidence >= minConfidence));
      }

      // Remove overlapping detections (keep highest confidence)
      const filteredDetections = this.removeOverlappingDetections(detections);

      return filteredDetections;
    } finally {
      // Update performance metrics
      const scanTime = performance.now() - startTime;
      this.updatePerformanceMetrics(scanTime);
    }
  }

  /**
   * Adds a custom PII pattern for detection
   * @param pattern - Custom PII pattern configuration
   */
  public addCustomPattern(pattern: PIIPattern): void {
    // Validate pattern
    if (!pattern.pattern || !pattern.name || !pattern.type) {
      throw new Error('Invalid PII pattern: missing required fields');
    }

    // Test pattern compilation
    try {
      pattern.pattern.test('test');
    } catch (error) {
      throw new Error(`Invalid regex pattern: ${error}`);
    }

    this.customPatterns.push({
      ...pattern,
      // Ensure pattern is global for finding all matches
      pattern: new RegExp(pattern.pattern.source, 'gi')
    });
  }

  /**
   * Removes a custom PII pattern
   * @param patternName - Name of pattern to remove
   * @returns Whether pattern was found and removed
   */
  public removeCustomPattern(patternName: string): boolean {
    const initialLength = this.customPatterns.length;
    const index = this.customPatterns.findIndex(p => p.name === patternName);
    
    if (index !== -1) {
      this.customPatterns.splice(index, 1);
      return true;
    }
    
    return false;
  }

  /**
   * Gets current performance metrics
   * @returns Performance metrics object
   */
  public getPerformanceMetrics(): typeof this.performanceMetrics {
    return { ...this.performanceMetrics };
  }

  /**
   * Resets performance metrics
   */
  public resetPerformanceMetrics(): void {
    this.performanceMetrics.totalScans = 0;
    this.performanceMetrics.totalScanTimeMs = 0;
    this.performanceMetrics.averageScanTimeMs = 0;
    this.performanceMetrics.lastScanTimeMs = 0;
  }

  /**
   * Gets all available PII types that can be detected
   * @returns Array of PII types
   */
  public getSupportedPIITypes(): PIIType[] {
    const types = new Set<PIIType>();
    
    // Add default pattern types
    for (const piiType of this.patterns.keys()) {
      types.add(piiType);
    }
    
    // Add custom pattern types
    for (const pattern of this.customPatterns) {
      types.add(pattern.type);
    }
    
    return Array.from(types);
  }

  /**
   * Finds all matches for a specific pattern in text
   * @param text - Text to search
   * @param pattern - Pattern to match
   * @returns Array of detection results
   */
  private findPatternMatches(text: string, pattern: PIIPattern): PIIDetectionResult[] {
    const matches: PIIDetectionResult[] = [];
    let match: RegExpExecArray | null;

    // Reset regex lastIndex to ensure fresh search
    pattern.pattern.lastIndex = 0;

    while ((match = pattern.pattern.exec(text)) !== null) {
      const matchedValue = match[0];
      let confidence = pattern.baseConfidence;

      // Apply custom validation if provided
      if (pattern.validator) {
        if (!pattern.validator(matchedValue)) {
          continue; // Skip invalid matches
        }
        // Boost confidence for validated matches
        confidence = Math.min(1.0, confidence + 0.1);
      }

      // Apply context validation for improved accuracy
      if (pattern.requiresContext) {
        const contextConfidence = this.validateContext(text, match.index, matchedValue, pattern.type);
        confidence = confidence * contextConfidence;
      }

      // Apply additional validation based on PII type
      confidence = this.applyTypeSpecificValidation(matchedValue, pattern.type, confidence);

      const detection: PIIDetectionResult = {
        type: pattern.type,
        value: matchedValue,
        startIndex: match.index,
        endIndex: match.index + matchedValue.length,
        confidence,
        patternName: pattern.name,
        highConfidence: confidence >= 0.8
      };

      matches.push(detection);

      // Prevent infinite loops with zero-width matches
      if (match[0].length === 0) {
        pattern.pattern.lastIndex++;
      }
    }

    return matches;
  }

  /**
   * Validates context around a match to improve accuracy
   * @param text - Full text
   * @param matchIndex - Index of the match
   * @param matchValue - Matched value
   * @param piiType - Type of PII
   * @returns Context confidence multiplier (0-1)
   */
  private validateContext(text: string, matchIndex: number, matchValue: string, piiType: PIIType): number {
    const contextRadius = 20;
    const contextStart = Math.max(0, matchIndex - contextRadius);
    const contextEnd = Math.min(text.length, matchIndex + matchValue.length + contextRadius);
    const context = text.substring(contextStart, contextEnd).toLowerCase();

    switch (piiType) {
      case 'email':
        // Look for email-related keywords
        if (context.includes('email') || context.includes('mail') || context.includes('@')) {
          return 1.0;
        }
        if (context.includes('user') || context.includes('login') || context.includes('account')) {
          return 0.9;
        }
        return 0.8;

      case 'creditCard':
        // Look for payment-related keywords
        if (context.includes('card') || context.includes('payment') || context.includes('visa') || 
            context.includes('mastercard') || context.includes('amex')) {
          return 1.0;
        }
        if (context.includes('number') || context.includes('cc') || context.includes('credit')) {
          return 0.9;
        }
        return 0.7; // Credit cards without context are less reliable

      case 'ssn':
        // Look for SSN-related keywords
        if (context.includes('ssn') || context.includes('social') || context.includes('security')) {
          return 1.0;
        }
        if (context.includes('tax') || context.includes('id') || context.includes('number')) {
          return 0.8;
        }
        return 0.6; // SSN patterns can be false positives

      case 'phone':
        // Look for phone-related keywords
        if (context.includes('phone') || context.includes('tel') || context.includes('call') || 
            context.includes('mobile') || context.includes('contact')) {
          return 1.0;
        }
        return 0.8;

      case 'apiKey':
      case 'jwt':
        // Look for API/token-related keywords
        if (context.includes('key') || context.includes('token') || context.includes('auth') ||
            context.includes('api') || context.includes('bearer')) {
          return 1.0;
        }
        return 0.8;

      default:
        return 0.8; // Default confidence for context validation
    }
  }

  /**
   * Applies additional validation specific to PII type
   * @param value - Detected value
   * @param piiType - Type of PII
   * @param currentConfidence - Current confidence score
   * @returns Adjusted confidence score
   */
  private applyTypeSpecificValidation(value: string, piiType: PIIType, currentConfidence: number): number {
    switch (piiType) {
      case 'creditCard':
        return this.validateCreditCard(value) ? currentConfidence : currentConfidence * 0.5;
      
      case 'email':
        return this.validateEmail(value) ? currentConfidence : currentConfidence * 0.3;
      
      case 'ssn':
        return this.validateSSN(value) ? currentConfidence : currentConfidence * 0.2;
      
      case 'phone':
        return this.validatePhone(value) ? currentConfidence : currentConfidence * 0.6;
      
      default:
        return currentConfidence;
    }
  }

  /**
   * Validates credit card using Luhn algorithm
   * @param cardNumber - Credit card number to validate
   * @returns Whether card number is valid
   */
  private validateCreditCard(cardNumber: string): boolean {
    const digits = cardNumber.replace(/\D/g, '');
    
    if (digits.length < 13 || digits.length > 19) {
      return false;
    }

    // Luhn algorithm
    let sum = 0;
    let alternate = false;
    
    for (let i = digits.length - 1; i >= 0; i--) {
      let n = parseInt(digits.charAt(i), 10);
      
      if (alternate) {
        n *= 2;
        if (n > 9) {
          n = (n % 10) + 1;
        }
      }
      
      sum += n;
      alternate = !alternate;
    }
    
    return sum % 10 === 0;
  }

  /**
   * Validates email format
   * @param email - Email to validate
   * @returns Whether email format is valid
   */
  private validateEmail(email: string): boolean {
    // More comprehensive email validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email) && !email.includes('..');
  }

  /**
   * Validates SSN format
   * @param ssn - SSN to validate
   * @returns Whether SSN format is valid
   */
  private validateSSN(ssn: string): boolean {
    const digits = ssn.replace(/\D/g, '');
    
    // Check for invalid SSN patterns
    const invalidPatterns = [
      '000', '666', '900', '999', // Invalid area numbers
      '0000', // Invalid serial number
      '00' // Invalid group number
    ];
    
    if (digits.length !== 9) return false;
    
    const area = digits.substring(0, 3);
    const group = digits.substring(3, 5);
    const serial = digits.substring(5, 9);
    
    return !invalidPatterns.includes(area) && 
           !invalidPatterns.includes(group) && 
           !invalidPatterns.includes(serial);
  }

  /**
   * Validates phone number format
   * @param phone - Phone number to validate
   * @returns Whether phone format is valid
   */
  private validatePhone(phone: string): boolean {
    const digits = phone.replace(/\D/g, '');
    return digits.length >= 10 && digits.length <= 15;
  }

  /**
   * Removes overlapping detections, keeping highest confidence matches
   * @param detections - Array of detections to filter
   * @returns Filtered array without overlaps
   */
  private removeOverlappingDetections(detections: PIIDetectionResult[]): PIIDetectionResult[] {
    if (detections.length <= 1) return detections;

    // Sort by confidence descending, then by start index
    const sorted = detections.sort((a, b) => {
      if (a.confidence !== b.confidence) {
        return b.confidence - a.confidence;
      }
      return a.startIndex - b.startIndex;
    });

    const filtered: PIIDetectionResult[] = [];
    
    for (const detection of sorted) {
      // Check if this detection overlaps with any already accepted detection
      const hasOverlap = filtered.some(existing => 
        !(detection.endIndex <= existing.startIndex || detection.startIndex >= existing.endIndex)
      );
      
      if (!hasOverlap) {
        filtered.push(detection);
      }
    }

    // Sort final results by start index for consistent ordering
    return filtered.sort((a, b) => a.startIndex - b.startIndex);
  }

  /**
   * Updates performance metrics with scan time
   * @param scanTimeMs - Time taken for scan in milliseconds
   */
  private updatePerformanceMetrics(scanTimeMs: number): void {
    this.performanceMetrics.lastScanTimeMs = scanTimeMs;
    this.performanceMetrics.totalScans++;
    this.performanceMetrics.totalScanTimeMs += scanTimeMs;
    this.performanceMetrics.averageScanTimeMs = 
      this.performanceMetrics.totalScanTimeMs / this.performanceMetrics.totalScans;
  }

  /**
   * Initializes default PII detection patterns
   * Covers credit cards, SSNs, emails, API keys, JWTs, and more
   */
  private initializeDefaultPatterns(): void {
    // Credit Card Patterns
    this.addPatternToType('creditCard', [
      {
        name: 'visa',
        type: 'creditCard',
        pattern: /\b4\d{3}[\s-]?\d{4}[\s-]?\d{4}[\s-]?\d{4}\b/gi,
        baseConfidence: 0.9,
        requiresContext: true,
        description: 'Visa credit card number'
      },
      {
        name: 'mastercard',
        type: 'creditCard',
        pattern: /\b5[1-5]\d{2}[\s-]?\d{4}[\s-]?\d{4}[\s-]?\d{4}\b/gi,
        baseConfidence: 0.9,
        requiresContext: true,
        description: 'Mastercard credit card number'
      },
      {
        name: 'amex',
        type: 'creditCard',
        pattern: /\b3[47]\d{2}[\s-]?\d{6}[\s-]?\d{5}\b/gi,
        baseConfidence: 0.9,
        requiresContext: true,
        description: 'American Express credit card number'
      },
      {
        name: 'discover',
        type: 'creditCard',
        pattern: /\b6(?:011|5\d{2})[\s-]?\d{4}[\s-]?\d{4}[\s-]?\d{4}\b/gi,
        baseConfidence: 0.9,
        requiresContext: true,
        description: 'Discover credit card number'
      }
    ]);

    // SSN Patterns
    this.addPatternToType('ssn', [
      {
        name: 'ssn_standard',
        type: 'ssn',
        pattern: /\b\d{3}[-.\s]?\d{2}[-.\s]?\d{4}\b/gi,
        baseConfidence: 0.8,
        requiresContext: true,
        description: 'Social Security Number'
      }
    ]);

    // Email Patterns
    this.addPatternToType('email', [
      {
        name: 'email_standard',
        type: 'email',
        pattern: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/gi,
        baseConfidence: 0.95,
        requiresContext: false,
        description: 'Email address'
      }
    ]);

    // Phone Number Patterns
    this.addPatternToType('phone', [
      {
        name: 'us_phone',
        type: 'phone',
        pattern: /\b(?:\+?1[-.\s]?)?\(?([0-9]{3})\)?[-.\s]?([0-9]{3})[-.\s]?([0-9]{4})\b/gi,
        baseConfidence: 0.85,
        requiresContext: true,
        description: 'US phone number'
      },
      {
        name: 'international_phone',
        type: 'phone',
        pattern: /\+(?:[0-9] ?){6,14}[0-9]/gi,
        baseConfidence: 0.8,
        requiresContext: true,
        description: 'International phone number'
      }
    ]);

    // IP Address Patterns
    this.addPatternToType('ipAddress', [
      {
        name: 'ipv4',
        type: 'ipAddress',
        pattern: /\b(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\b/gi,
        baseConfidence: 0.9,
        requiresContext: false,
        description: 'IPv4 address'
      },
      {
        name: 'ipv6',
        type: 'ipAddress',
        pattern: /\b(?:[0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}\b/gi,
        baseConfidence: 0.9,
        requiresContext: false,
        description: 'IPv6 address'
      }
    ]);

    // API Key Patterns
    this.addPatternToType('apiKey', [
      {
        name: 'generic_api_key',
        type: 'apiKey',
        pattern: /\b[A-Za-z0-9]{32,}\b/gi,
        validator: (value: string) => value.length >= 32 && /[A-Z]/.test(value) && /[a-z]/.test(value) && /[0-9]/.test(value),
        baseConfidence: 0.7,
        requiresContext: true,
        description: 'Generic API key'
      },
      {
        name: 'aws_access_key',
        type: 'apiKey',
        pattern: /\bAKIA[0-9A-Z]{16}\b/gi,
        baseConfidence: 0.95,
        requiresContext: false,
        description: 'AWS Access Key'
      },
      {
        name: 'github_token',
        type: 'apiKey',
        pattern: /\bghp_[0-9a-zA-Z]{36}\b/gi,
        baseConfidence: 0.95,
        requiresContext: false,
        description: 'GitHub Personal Access Token'
      }
    ]);

    // JWT Token Patterns
    this.addPatternToType('jwt', [
      {
        name: 'jwt_token',
        type: 'jwt',
        pattern: /\beyJ[A-Za-z0-9_-]*\.[A-Za-z0-9_-]*\.[A-Za-z0-9_-]*\b/gi,
        validator: (value: string) => {
          const parts = value.split('.');
          return parts.length === 3 && parts.every(part => part.length > 0);
        },
        baseConfidence: 0.9,
        requiresContext: false,
        description: 'JWT token'
      }
    ]);

    // Password Patterns (in URLs or forms)
    this.addPatternToType('password', [
      {
        name: 'password_in_url',
        type: 'password',
        pattern: /password=([^&\s]+)/gi,
        baseConfidence: 0.9,
        requiresContext: false,
        description: 'Password in URL parameter'
      },
      {
        name: 'password_assignment',
        type: 'password',
        pattern: /(?:password|pwd|pass)\s*[:=]\s*['"]([^'"]+)['"]/gi,
        baseConfidence: 0.8,
        requiresContext: false,
        description: 'Password assignment in code'
      }
    ]);
  }

  /**
   * Helper method to add patterns to a specific PII type
   * @param piiType - Type of PII
   * @param patterns - Array of patterns to add
   */
  private addPatternToType(piiType: PIIType, patterns: PIIPattern[]): void {
    if (!this.patterns.has(piiType)) {
      this.patterns.set(piiType, []);
    }
    
    const existingPatterns = this.patterns.get(piiType)!;
    existingPatterns.push(...patterns);
  }
}