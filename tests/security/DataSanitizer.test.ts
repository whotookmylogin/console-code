/**
 * DataSanitizer.test.ts
 * Comprehensive test suite for data sanitization functionality
 * Tests masking strategies, audit trails, and complex data handling
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { DataSanitizer } from '../../src/security/DataSanitizer.js';
import type { 
  PIIDetectionResult, 
  SanitizationConfig,
  PIIType 
} from '../../src/types/index.js';

describe('DataSanitizer', () => {
  let sanitizer: DataSanitizer;

  beforeEach(() => {
    sanitizer = new DataSanitizer();
  });

  describe('Text Sanitization', () => {
    it('should sanitize text with detected PII', () => {
      const originalText = 'User email: john@example.com';
      const detections: PIIDetectionResult[] = [{
        type: 'email',
        value: 'john@example.com',
        startIndex: 12,
        endIndex: 28,
        confidence: 0.95,
        patternName: 'email_standard',
        highConfidence: true
      }];

      const result = sanitizer.sanitizeText(originalText, detections);

      expect(result.wasModified).toBe(true);
      expect(result.sanitizedText).not.toContain('john@example.com');
      expect(result.sanitizedDetections).toHaveLength(1);
      expect(result.actions).toHaveLength(1);
    });

    it('should not modify text with no detections', () => {
      const originalText = 'This is a clean log entry';
      const detections: PIIDetectionResult[] = [];

      const result = sanitizer.sanitizeText(originalText, detections);

      expect(result.wasModified).toBe(false);
      expect(result.sanitizedText).toBe(originalText);
      expect(result.actions).toHaveLength(0);
    });

    it('should handle multiple PII detections in same text', () => {
      const originalText = 'Contact: john@example.com or call (555) 123-4567';
      const detections: PIIDetectionResult[] = [
        {
          type: 'email',
          value: 'john@example.com',
          startIndex: 9,
          endIndex: 25,
          confidence: 0.95,
          patternName: 'email_standard',
          highConfidence: true
        },
        {
          type: 'phone',
          value: '(555) 123-4567',
          startIndex: 34,
          endIndex: 48,
          confidence: 0.85,
          patternName: 'us_phone',
          highConfidence: true
        }
      ];

      const result = sanitizer.sanitizeText(originalText, detections);

      expect(result.wasModified).toBe(true);
      expect(result.sanitizedDetections).toHaveLength(2);
      expect(result.actions).toHaveLength(2);
      expect(result.sanitizedText).not.toContain('john@example.com');
      expect(result.sanitizedText).not.toContain('(555) 123-4567');
    });
  });

  describe('Sanitization Strategies', () => {
    describe('Mask Strategy', () => {
      it('should mask values with asterisks', () => {
        const sanitizer = new DataSanitizer({
          defaultStrategy: 'mask',
          maskCharacter: '*'
        });

        const originalText = 'Password: secret123';
        const detections: PIIDetectionResult[] = [{
          type: 'password',
          value: 'secret123',
          startIndex: 10,
          endIndex: 19,
          confidence: 0.9,
          patternName: 'password_assignment',
          highConfidence: true
        }];

        const result = sanitizer.sanitizeText(originalText, detections);

        expect(result.sanitizedText).toContain('*********');
        expect(result.sanitizedText).not.toContain('secret123');
      });

      it('should preserve format when masking credit cards', () => {
        const sanitizer = new DataSanitizer({
          defaultStrategy: 'mask',
          preserveFormat: true
        });

        const originalText = 'Card: 4532-1234-5678-9012';
        const detections: PIIDetectionResult[] = [{
          type: 'creditCard',
          value: '4532-1234-5678-9012',
          startIndex: 6,
          endIndex: 25,
          confidence: 0.95,
          patternName: 'visa',
          highConfidence: true
        }];

        const result = sanitizer.sanitizeText(originalText, detections);

        expect(result.sanitizedText).toMatch(/Card: \*\*\*\*-\*\*\*\*-\*\*\*\*-\*\*\*\*/);
      });

      it('should preserve email format when masking', () => {
        const sanitizer = new DataSanitizer({
          typeStrategies: { email: 'mask' },
          preserveFormat: true
        });

        const originalText = 'Email: john.doe@example.com';
        const detections: PIIDetectionResult[] = [{
          type: 'email',
          value: 'john.doe@example.com',
          startIndex: 7,
          endIndex: 26,
          confidence: 0.95,
          patternName: 'email_standard',
          highConfidence: true
        }];

        const result = sanitizer.sanitizeText(originalText, detections);

        expect(result.sanitizedText).toMatch(/Email: \*@example\.com/);
      });
    });

    describe('Hash Strategy', () => {
      it('should hash values consistently', () => {
        const sanitizer = new DataSanitizer({
          defaultStrategy: 'hash',
          hashSalt: 'testsalt'
        });

        const originalText = 'API Key: abc123def456';
        const detections: PIIDetectionResult[] = [{
          type: 'apiKey',
          value: 'abc123def456',
          startIndex: 9,
          endIndex: 21,
          confidence: 0.8,
          patternName: 'generic_api_key',
          highConfidence: true
        }];

        const result1 = sanitizer.sanitizeText(originalText, detections);
        const result2 = sanitizer.sanitizeText(originalText, detections);

        expect(result1.sanitizedText).toEqual(result2.sanitizedText);
        expect(result1.sanitizedText).toMatch(/API Key: \[HASH:[a-f0-9]+\]/);
      });

      it('should produce different hashes for different values', () => {
        const sanitizer = new DataSanitizer({
          defaultStrategy: 'hash'
        });

        const text1 = 'Value: secret1';
        const text2 = 'Value: secret2';

        const detections1: PIIDetectionResult[] = [{
          type: 'custom',
          value: 'secret1',
          startIndex: 7,
          endIndex: 14,
          confidence: 0.8,
          patternName: 'custom',
          highConfidence: true
        }];

        const detections2: PIIDetectionResult[] = [{
          type: 'custom',
          value: 'secret2',
          startIndex: 7,
          endIndex: 14,
          confidence: 0.8,
          patternName: 'custom',
          highConfidence: true
        }];

        const result1 = sanitizer.sanitizeText(text1, detections1);
        const result2 = sanitizer.sanitizeText(text2, detections2);

        expect(result1.sanitizedText).not.toEqual(result2.sanitizedText);
      });
    });

    describe('Remove Strategy', () => {
      it('should replace values with [REDACTED]', () => {
        const sanitizer = new DataSanitizer({
          defaultStrategy: 'remove'
        });

        const originalText = 'JWT: eyJhbGciOiJIUzI1NiJ9.payload.signature';
        const detections: PIIDetectionResult[] = [{
          type: 'jwt',
          value: 'eyJhbGciOiJIUzI1NiJ9.payload.signature',
          startIndex: 5,
          endIndex: 39,
          confidence: 0.9,
          patternName: 'jwt_token',
          highConfidence: true
        }];

        const result = sanitizer.sanitizeText(originalText, detections);

        expect(result.sanitizedText).toBe('JWT: [REDACTED]');
      });
    });

    describe('Partial Strategy', () => {
      it('should partially mask email addresses', () => {
        const sanitizer = new DataSanitizer({
          typeStrategies: { email: 'partial' },
          partialPreserveLength: 2
        });

        const originalText = 'Email: john.doe@example.com';
        const detections: PIIDetectionResult[] = [{
          type: 'email',
          value: 'john.doe@example.com',
          startIndex: 7,
          endIndex: 26,
          confidence: 0.95,
          patternName: 'email_standard',
          highConfidence: true
        }];

        const result = sanitizer.sanitizeText(originalText, detections);

        expect(result.sanitizedText).toMatch(/Email: jo\*\*\*oe@example\.com/);
      });

      it('should partially mask credit card numbers', () => {
        const sanitizer = new DataSanitizer({
          typeStrategies: { creditCard: 'partial' }
        });

        const originalText = 'Card: 4532123456789012';
        const detections: PIIDetectionResult[] = [{
          type: 'creditCard',
          value: '4532123456789012',
          startIndex: 6,
          endIndex: 22,
          confidence: 0.9,
          patternName: 'visa',
          highConfidence: true
        }];

        const result = sanitizer.sanitizeText(originalText, detections);

        expect(result.sanitizedText).toMatch(/Card: 4532\*\*\*\*\*\*\*\*9012/);
      });

      it('should partially mask phone numbers', () => {
        const sanitizer = new DataSanitizer({
          typeStrategies: { phone: 'partial' }
        });

        const originalText = 'Phone: (555) 123-4567';
        const detections: PIIDetectionResult[] = [{
          type: 'phone',
          value: '(555) 123-4567',
          startIndex: 7,
          endIndex: 21,
          confidence: 0.85,
          patternName: 'us_phone',
          highConfidence: true
        }];

        const result = sanitizer.sanitizeText(originalText, detections);

        expect(result.sanitizedText).toMatch(/Phone: \(555\) \*\*\*-567/);
      });
    });

    describe('Type-Specific Strategies', () => {
      it('should use different strategies for different PII types', () => {
        const sanitizer = new DataSanitizer({
          typeStrategies: {
            email: 'partial',
            creditCard: 'mask',
            apiKey: 'remove'
          }
        });

        expect(sanitizer.getStrategyForPIIType('email')).toBe('partial');
        expect(sanitizer.getStrategyForPIIType('creditCard')).toBe('mask');
        expect(sanitizer.getStrategyForPIIType('apiKey')).toBe('remove');
        expect(sanitizer.getStrategyForPIIType('ssn')).toBe('mask'); // default
      });
    });
  });

  describe('Object Sanitization', () => {
    it('should sanitize nested objects', () => {
      const data = {
        user: {
          email: 'user@example.com',
          profile: {
            phone: '555-123-4567'
          }
        },
        metadata: {
          created: '2023-01-01'
        }
      };

      const result = sanitizer.sanitizeObject(data);

      expect(result.piiFound).toBe(true);
      expect(result.actions.length).toBeGreaterThan(0);
      
      const sanitizedData = result.sanitizedData as any;
      expect(sanitizedData.user.email).not.toBe('user@example.com');
      expect(sanitizedData.metadata.created).toBe('2023-01-01'); // Non-sensitive data unchanged
    });

    it('should handle arrays in objects', () => {
      const data = {
        users: [
          { email: 'user1@example.com' },
          { email: 'user2@example.com' }
        ]
      };

      const result = sanitizer.sanitizeObject(data);

      expect(result.piiFound).toBe(true);
      
      const sanitizedData = result.sanitizedData as any;
      expect(sanitizedData.users[0].email).not.toBe('user1@example.com');
      expect(sanitizedData.users[1].email).not.toBe('user2@example.com');
    });

    it('should detect sensitive keys', () => {
      const data = {
        password: 'secret123',
        api_key: 'abc123def456',
        normal_field: 'safe_value'
      };

      const result = sanitizer.sanitizeObject(data);

      expect(result.piiFound).toBe(true);
      expect(result.actions.length).toBe(2);
      
      const sanitizedData = result.sanitizedData as any;
      expect(sanitizedData.password).toBe('[REDACTED]');
      expect(sanitizedData.api_key).toBe('[REDACTED]');
      expect(sanitizedData.normal_field).toBe('safe_value');
    });

    it('should handle primitive values', () => {
      const stringResult = sanitizer.sanitizeObject('user@example.com');
      expect(stringResult.piiFound).toBe(true);

      const numberResult = sanitizer.sanitizeObject(12345);
      expect(numberResult.piiFound).toBe(false);

      const boolResult = sanitizer.sanitizeObject(true);
      expect(boolResult.piiFound).toBe(false);
    });

    it('should prevent infinite recursion', () => {
      const circularObj: any = { name: 'test' };
      circularObj.self = circularObj;

      expect(() => sanitizer.sanitizeObject(circularObj, 5)).not.toThrow();
    });
  });

  describe('Configuration Management', () => {
    it('should allow configuration updates', () => {
      sanitizer.updateConfig({
        maskCharacter: '#',
        partialPreserveLength: 3
      });

      const originalText = 'Secret: password123';
      const detections: PIIDetectionResult[] = [{
        type: 'password',
        value: 'password123',
        startIndex: 8,
        endIndex: 19,
        confidence: 0.9,
        patternName: 'password',
        highConfidence: true
      }];

      const result = sanitizer.sanitizeText(originalText, detections);

      expect(result.sanitizedText).toContain('#');
    });

    it('should use custom sanitization config', () => {
      const customConfig: SanitizationConfig = {
        defaultStrategy: 'hash',
        typeStrategies: {
          email: 'remove'
        },
        maskCharacter: '•',
        partialPreserveLength: 2,
        preserveFormat: false,
        hashSalt: 'customsalt'
      };

      const customSanitizer = new DataSanitizer(customConfig);

      expect(customSanitizer.getStrategyForPIIType('email')).toBe('remove');
      expect(customSanitizer.getStrategyForPIIType('phone')).toBe('hash'); // default
    });
  });

  describe('Audit Trail', () => {
    it('should maintain audit trail of sanitization actions', () => {
      const originalText = 'Email: user@example.com';
      const detections: PIIDetectionResult[] = [{
        type: 'email',
        value: 'user@example.com',
        startIndex: 7,
        endIndex: 23,
        confidence: 0.95,
        patternName: 'email_standard',
        highConfidence: true
      }];

      sanitizer.sanitizeText(originalText, detections);

      const auditTrail = sanitizer.getAuditTrail();
      
      expect(auditTrail).toHaveLength(1);
      expect(auditTrail[0].piiType).toBe('email');
      expect(auditTrail[0].strategy).toBeDefined();
      expect(auditTrail[0].originalValueHash).toBeDefined();
      expect(auditTrail[0].timestamp).toBeInstanceOf(Date);
    });

    it('should accumulate audit trail across multiple sanitizations', () => {
      const text1 = 'Email: user1@example.com';
      const text2 = 'Phone: (555) 123-4567';

      const detections1: PIIDetectionResult[] = [{
        type: 'email',
        value: 'user1@example.com',
        startIndex: 7,
        endIndex: 24,
        confidence: 0.95,
        patternName: 'email_standard',
        highConfidence: true
      }];

      const detections2: PIIDetectionResult[] = [{
        type: 'phone',
        value: '(555) 123-4567',
        startIndex: 7,
        endIndex: 21,
        confidence: 0.85,
        patternName: 'us_phone',
        highConfidence: true
      }];

      sanitizer.sanitizeText(text1, detections1);
      sanitizer.sanitizeText(text2, detections2);

      const auditTrail = sanitizer.getAuditTrail();
      expect(auditTrail).toHaveLength(2);
    });

    it('should clear audit trail', () => {
      const originalText = 'Email: user@example.com';
      const detections: PIIDetectionResult[] = [{
        type: 'email',
        value: 'user@example.com',
        startIndex: 7,
        endIndex: 23,
        confidence: 0.95,
        patternName: 'email_standard',
        highConfidence: true
      }];

      sanitizer.sanitizeText(originalText, detections);
      expect(sanitizer.getAuditTrail()).toHaveLength(1);

      sanitizer.clearAuditTrail();
      expect(sanitizer.getAuditTrail()).toHaveLength(0);
    });
  });

  describe('Statistics', () => {
    it('should provide sanitization statistics', () => {
      const originalText = 'Contact: user@example.com or (555) 123-4567';
      const detections: PIIDetectionResult[] = [
        {
          type: 'email',
          value: 'user@example.com',
          startIndex: 9,
          endIndex: 25,
          confidence: 0.95,
          patternName: 'email_standard',
          highConfidence: true
        },
        {
          type: 'phone',
          value: '(555) 123-4567',
          startIndex: 29,
          endIndex: 43,
          confidence: 0.85,
          patternName: 'us_phone',
          highConfidence: true
        }
      ];

      sanitizer.sanitizeText(originalText, detections);

      const stats = sanitizer.getStatistics();
      
      expect(stats.totalActions).toBe(2);
      expect(stats.actionsByType.email).toBe(1);
      expect(stats.actionsByType.phone).toBe(1);
      expect(stats.lastActionTime).toBeInstanceOf(Date);
    });

    it('should track actions by strategy', () => {
      const sanitizer = new DataSanitizer({
        typeStrategies: {
          email: 'mask',
          phone: 'partial'
        }
      });

      const originalText = 'Contact: user@example.com or (555) 123-4567';
      const detections: PIIDetectionResult[] = [
        {
          type: 'email',
          value: 'user@example.com',
          startIndex: 9,
          endIndex: 25,
          confidence: 0.95,
          patternName: 'email_standard',
          highConfidence: true
        },
        {
          type: 'phone',
          value: '(555) 123-4567',
          startIndex: 29,
          endIndex: 43,
          confidence: 0.85,
          patternName: 'us_phone',
          highConfidence: true
        }
      ];

      sanitizer.sanitizeText(originalText, detections);

      const stats = sanitizer.getStatistics();
      
      expect(stats.actionsByStrategy.mask).toBe(1);
      expect(stats.actionsByStrategy.partial).toBe(1);
    });
  });

  describe('Edge Cases', () => {
    it('should handle overlapping detections gracefully', () => {
      const originalText = 'Data: user@example.com';
      const overlappingDetections: PIIDetectionResult[] = [
        {
          type: 'email',
          value: 'user@example.com',
          startIndex: 6,
          endIndex: 22,
          confidence: 0.95,
          patternName: 'email_standard',
          highConfidence: true
        },
        {
          type: 'custom',
          value: '@example.com',
          startIndex: 10,
          endIndex: 22,
          confidence: 0.8,
          patternName: 'custom_domain',
          highConfidence: true
        }
      ];

      expect(() => sanitizer.sanitizeText(originalText, overlappingDetections)).not.toThrow();
    });

    it('should handle empty detection arrays', () => {
      const result = sanitizer.sanitizeText('Clean text', []);
      
      expect(result.wasModified).toBe(false);
      expect(result.sanitizedText).toBe('Clean text');
      expect(result.actions).toHaveLength(0);
    });

    it('should handle null and undefined values in objects', () => {
      const data = {
        nullValue: null,
        undefinedValue: undefined,
        emptyString: '',
        validEmail: 'user@example.com'
      };

      const result = sanitizer.sanitizeObject(data);
      
      expect(result.piiFound).toBe(true);
      
      const sanitizedData = result.sanitizedData as any;
      expect(sanitizedData.nullValue).toBeNull();
      expect(sanitizedData.undefinedValue).toBeUndefined();
      expect(sanitizedData.emptyString).toBe('');
      expect(sanitizedData.validEmail).not.toBe('user@example.com');
    });

    it('should handle very long strings without performance issues', () => {
      const longText = 'email: user@example.com ' + 'x'.repeat(10000);
      const detections: PIIDetectionResult[] = [{
        type: 'email',
        value: 'user@example.com',
        startIndex: 7,
        endIndex: 23,
        confidence: 0.95,
        patternName: 'email_standard',
        highConfidence: true
      }];

      const startTime = performance.now();
      const result = sanitizer.sanitizeText(longText, detections);
      const endTime = performance.now();

      expect(endTime - startTime).toBeLessThan(100); // Should complete quickly
      expect(result.wasModified).toBe(true);
    });
  });
});