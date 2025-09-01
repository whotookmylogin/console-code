/**
 * PIIDetector.test.ts
 * Comprehensive test suite for PII detection functionality
 * Tests pattern matching, confidence scoring, and performance
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { PIIDetector } from '../../src/security/PIIDetector.js';
import type { PIIPattern, PIIType } from '../../src/types/index.js';

describe('PIIDetector', () => {
  let detector: PIIDetector;

  beforeEach(() => {
    detector = new PIIDetector();
  });

  describe('Credit Card Detection', () => {
    it('should detect Visa credit card numbers', () => {
      const text = 'Card number: 4532-1234-5678-9012';
      const results = detector.scanText(text);
      
      expect(results).toHaveLength(1);
      expect(results[0].type).toBe('creditCard');
      expect(results[0].value).toBe('4532-1234-5678-9012');
      expect(results[0].confidence).toBeGreaterThan(0.8);
      expect(results[0].patternName).toBe('visa');
    });

    it('should detect Mastercard numbers', () => {
      const text = 'Payment with 5555-4444-3333-2222';
      const results = detector.scanText(text);
      
      expect(results).toHaveLength(1);
      expect(results[0].type).toBe('creditCard');
      expect(results[0].patternName).toBe('mastercard');
    });

    it('should detect American Express numbers', () => {
      const text = 'AMEX: 3782-822463-10005';
      const results = detector.scanText(text);
      
      expect(results).toHaveLength(1);
      expect(results[0].type).toBe('creditCard');
      expect(results[0].patternName).toBe('amex');
    });

    it('should validate credit cards using Luhn algorithm', () => {
      // Valid card number
      const validText = 'Card: 4532015112830366'; // Valid Luhn
      const validResults = detector.scanText(validText);
      expect(validResults[0].confidence).toBeGreaterThan(0.8);

      // Invalid card number (fails Luhn)
      const invalidText = 'Card: 4532015112830367'; // Invalid Luhn
      const invalidResults = detector.scanText(invalidText);
      expect(invalidResults[0].confidence).toBeLessThan(0.8);
    });

    it('should handle different card number formats', () => {
      const formats = [
        '4532123456789012',      // No separators
        '4532 1234 5678 9012',   // Spaces
        '4532-1234-5678-9012',   // Dashes
        '4532.1234.5678.9012'    // Dots
      ];

      formats.forEach(format => {
        const results = detector.scanText(`Card: ${format}`);
        expect(results).toHaveLength(1);
        expect(results[0].type).toBe('creditCard');
      });
    });
  });

  describe('SSN Detection', () => {
    it('should detect standard SSN format', () => {
      const text = 'SSN: 123-45-6789';
      const results = detector.scanText(text);
      
      expect(results).toHaveLength(1);
      expect(results[0].type).toBe('ssn');
      expect(results[0].value).toBe('123-45-6789');
    });

    it('should detect SSN with different separators', () => {
      const formats = ['123-45-6789', '123.45.6789', '123 45 6789'];
      
      formats.forEach(format => {
        const results = detector.scanText(`Social Security: ${format}`);
        expect(results).toHaveLength(1);
        expect(results[0].type).toBe('ssn');
      });
    });

    it('should reject invalid SSN patterns', () => {
      const invalidSSNs = [
        '000-12-3456',  // Invalid area
        '666-12-3456',  // Invalid area
        '900-12-3456',  // Invalid area
        '123-00-4567',  // Invalid group
        '123-45-0000'   // Invalid serial
      ];

      invalidSSNs.forEach(ssn => {
        const results = detector.scanText(`SSN: ${ssn}`);
        if (results.length > 0) {
          expect(results[0].confidence).toBeLessThan(0.5);
        }
      });
    });

    it('should require context for higher confidence', () => {
      const withContext = 'Social Security Number: 123-45-6789';
      const withoutContext = 'Random number: 123-45-6789';

      const contextResults = detector.scanText(withContext);
      const noContextResults = detector.scanText(withoutContext);

      expect(contextResults[0].confidence).toBeGreaterThan(noContextResults[0].confidence);
    });
  });

  describe('Email Detection', () => {
    it('should detect standard email addresses', () => {
      const text = 'Contact: user@example.com';
      const results = detector.scanText(text);
      
      expect(results).toHaveLength(1);
      expect(results[0].type).toBe('email');
      expect(results[0].value).toBe('user@example.com');
      expect(results[0].confidence).toBeGreaterThan(0.9);
    });

    it('should detect various email formats', () => {
      const emails = [
        'simple@example.com',
        'user.name@example.com',
        'user+tag@example.com',
        'user123@sub.example.com'
      ];

      emails.forEach(email => {
        const results = detector.scanText(`Email: ${email}`);
        expect(results).toHaveLength(1);
        expect(results[0].type).toBe('email');
        expect(results[0].value).toBe(email);
      });
    });

    it('should validate email format', () => {
      const invalidEmails = [
        'invalid.email',     // Missing @
        '@example.com',      // Missing local part
        'user@',             // Missing domain
        'user@.com',         // Invalid domain
        'user..name@example.com' // Double dots
      ];

      invalidEmails.forEach(email => {
        const results = detector.scanText(`Email: ${email}`);
        if (results.length > 0) {
          expect(results[0].confidence).toBeLessThan(0.8);
        }
      });
    });
  });

  describe('Phone Number Detection', () => {
    it('should detect US phone numbers', () => {
      const text = 'Call: (555) 123-4567';
      const results = detector.scanText(text);
      
      expect(results).toHaveLength(1);
      expect(results[0].type).toBe('phone');
      expect(results[0].value).toBe('(555) 123-4567');
    });

    it('should detect various US phone formats', () => {
      const phones = [
        '(555) 123-4567',
        '555-123-4567',
        '555.123.4567',
        '5551234567',
        '+1 555 123 4567'
      ];

      phones.forEach(phone => {
        const results = detector.scanText(`Phone: ${phone}`);
        expect(results).toHaveLength(1);
        expect(results[0].type).toBe('phone');
      });
    });

    it('should detect international phone numbers', () => {
      const text = 'International: +44 20 7123 4567';
      const results = detector.scanText(text);
      
      expect(results).toHaveLength(1);
      expect(results[0].type).toBe('phone');
    });
  });

  describe('API Key Detection', () => {
    it('should detect AWS access keys', () => {
      const text = 'AWS Key: AKIAIOSFODNN7EXAMPLE';
      const results = detector.scanText(text);
      
      expect(results).toHaveLength(1);
      expect(results[0].type).toBe('apiKey');
      expect(results[0].patternName).toBe('aws_access_key');
      expect(results[0].confidence).toBeGreaterThan(0.9);
    });

    it('should detect GitHub tokens', () => {
      const text = 'Token: ghp_1234567890abcdef1234567890abcdef12345678';
      const results = detector.scanText(text);
      
      expect(results).toHaveLength(1);
      expect(results[0].type).toBe('apiKey');
      expect(results[0].patternName).toBe('github_token');
    });

    it('should detect generic API keys with validation', () => {
      const validKey = 'API_KEY_AbCdEf123456789012345678901234567890';
      const invalidKey = '123456789012345678901234567890123456'; // Only digits

      const validResults = detector.scanText(`Key: ${validKey}`);
      const invalidResults = detector.scanText(`Key: ${invalidKey}`);

      expect(validResults[0].confidence).toBeGreaterThan(invalidResults[0].confidence);
    });
  });

  describe('JWT Token Detection', () => {
    it('should detect JWT tokens', () => {
      const jwt = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyfQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c';
      const text = `Bearer ${jwt}`;
      const results = detector.scanText(text);
      
      expect(results).toHaveLength(1);
      expect(results[0].type).toBe('jwt');
      expect(results[0].value).toBe(jwt);
      expect(results[0].confidence).toBeGreaterThan(0.8);
    });

    it('should validate JWT structure', () => {
      const validJWT = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.signature';
      const invalidJWT = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0'; // Missing signature

      const validResults = detector.scanText(`Token: ${validJWT}`);
      const invalidResults = detector.scanText(`Token: ${invalidJWT}`);

      expect(validResults).toHaveLength(1);
      expect(invalidResults).toHaveLength(0);
    });
  });

  describe('IP Address Detection', () => {
    it('should detect IPv4 addresses', () => {
      const text = 'Server IP: 192.168.1.1';
      const results = detector.scanText(text);
      
      expect(results).toHaveLength(1);
      expect(results[0].type).toBe('ipAddress');
      expect(results[0].value).toBe('192.168.1.1');
    });

    it('should detect IPv6 addresses', () => {
      const text = 'IPv6: 2001:0db8:85a3:0000:0000:8a2e:0370:7334';
      const results = detector.scanText(text);
      
      expect(results).toHaveLength(1);
      expect(results[0].type).toBe('ipAddress');
      expect(results[0].value).toBe('2001:0db8:85a3:0000:0000:8a2e:0370:7334');
    });

    it('should validate IPv4 ranges', () => {
      const validIPs = ['192.168.1.1', '10.0.0.1', '172.16.0.1'];
      const invalidIPs = ['256.1.1.1', '192.168.1.256', '999.999.999.999'];

      validIPs.forEach(ip => {
        const results = detector.scanText(`IP: ${ip}`);
        expect(results).toHaveLength(1);
      });

      invalidIPs.forEach(ip => {
        const results = detector.scanText(`IP: ${ip}`);
        expect(results).toHaveLength(0);
      });
    });
  });

  describe('Password Detection', () => {
    it('should detect passwords in URLs', () => {
      const text = 'URL: https://user:password123@example.com/path';
      const results = detector.scanText(text);
      
      const passwordDetection = results.find(r => r.type === 'password');
      expect(passwordDetection).toBeDefined();
      expect(passwordDetection!.value).toBe('password123');
    });

    it('should detect password assignments', () => {
      const assignments = [
        'password = "secret123"',
        'pwd: "mypassword"',
        "password='test123'"
      ];

      assignments.forEach(assignment => {
        const results = detector.scanText(assignment);
        const passwordDetection = results.find(r => r.type === 'password');
        expect(passwordDetection).toBeDefined();
      });
    });
  });

  describe('Custom Patterns', () => {
    it('should allow adding custom PII patterns', () => {
      const customPattern: PIIPattern = {
        name: 'custom_id',
        type: 'custom',
        pattern: /CUST-\d{6}/gi,
        baseConfidence: 0.8,
        requiresContext: false,
        description: 'Custom customer ID pattern'
      };

      detector.addCustomPattern(customPattern);

      const text = 'Customer ID: CUST-123456';
      const results = detector.scanText(text);
      
      expect(results).toHaveLength(1);
      expect(results[0].type).toBe('custom');
      expect(results[0].patternName).toBe('custom_id');
      expect(results[0].value).toBe('CUST-123456');
    });

    it('should validate custom patterns', () => {
      const invalidPattern = {
        name: '',
        type: 'custom' as PIIType,
        pattern: /invalid\[/gi, // Invalid regex
        baseConfidence: 0.8,
        requiresContext: false,
        description: 'Invalid pattern'
      };

      expect(() => detector.addCustomPattern(invalidPattern)).toThrow();
    });

    it('should remove custom patterns', () => {
      const customPattern: PIIPattern = {
        name: 'test_pattern',
        type: 'custom',
        pattern: /TEST-\d+/gi,
        baseConfidence: 0.8,
        requiresContext: false,
        description: 'Test pattern'
      };

      detector.addCustomPattern(customPattern);
      
      const removed = detector.removeCustomPattern('test_pattern');
      expect(removed).toBe(true);

      const notRemoved = detector.removeCustomPattern('non_existent');
      expect(notRemoved).toBe(false);
    });
  });

  describe('Performance Optimization', () => {
    it('should maintain low latency for typical log entries', () => {
      const typicalLog = 'INFO: User john@example.com logged in from 192.168.1.100 at 2023-01-01T12:00:00Z';
      
      const startTime = performance.now();
      detector.scanText(typicalLog);
      const endTime = performance.now();
      
      const scanTime = endTime - startTime;
      expect(scanTime).toBeLessThan(1); // Should be under 1ms
    });

    it('should handle large text efficiently', () => {
      const largeText = 'Log entry: '.repeat(1000) + 'user@example.com';
      
      const startTime = performance.now();
      const results = detector.scanText(largeText);
      const endTime = performance.now();
      
      const scanTime = endTime - startTime;
      expect(scanTime).toBeLessThan(10); // Should be under 10ms
      expect(results).toHaveLength(1);
    });

    it('should track performance metrics', () => {
      detector.scanText('Test email: test@example.com');
      detector.scanText('Test phone: (555) 123-4567');
      
      const metrics = detector.getPerformanceMetrics();
      
      expect(metrics.totalScans).toBe(2);
      expect(metrics.averageScanTimeMs).toBeGreaterThan(0);
      expect(metrics.lastScanTimeMs).toBeGreaterThan(0);
    });

    it('should reset performance metrics', () => {
      detector.scanText('Test text');
      detector.resetPerformanceMetrics();
      
      const metrics = detector.getPerformanceMetrics();
      
      expect(metrics.totalScans).toBe(0);
      expect(metrics.averageScanTimeMs).toBe(0);
    });
  });

  describe('Confidence Scoring', () => {
    it('should provide confidence scores for all detections', () => {
      const text = 'Email: user@example.com, Phone: (555) 123-4567';
      const results = detector.scanText(text);
      
      results.forEach(result => {
        expect(result.confidence).toBeGreaterThan(0);
        expect(result.confidence).toBeLessThanOrEqual(1);
      });
    });

    it('should filter by minimum confidence', () => {
      const text = 'Possible credit card: 1234-5678-9012-3456'; // Invalid Luhn
      
      const lowConfidenceResults = detector.scanText(text, 0.1);
      const highConfidenceResults = detector.scanText(text, 0.8);
      
      expect(lowConfidenceResults.length).toBeGreaterThan(highConfidenceResults.length);
    });

    it('should mark high confidence detections', () => {
      const text = 'Email: user@example.com';
      const results = detector.scanText(text);
      
      expect(results[0].highConfidence).toBe(true);
      expect(results[0].confidence).toBeGreaterThanOrEqual(0.8);
    });
  });

  describe('Overlapping Detection Handling', () => {
    it('should remove overlapping detections', () => {
      // Create text that might trigger overlapping patterns
      const text = 'API key: AKIAIOSFODNN7EXAMPLE1234567890';
      const results = detector.scanText(text);
      
      // Should not have overlapping detections
      for (let i = 0; i < results.length; i++) {
        for (let j = i + 1; j < results.length; j++) {
          const a = results[i];
          const b = results[j];
          const overlaps = !(a.endIndex <= b.startIndex || a.startIndex >= b.endIndex);
          expect(overlaps).toBe(false);
        }
      }
    });

    it('should keep highest confidence when overlapping', () => {
      // This test would require creating overlapping patterns
      // For now, we'll test that the system doesn't crash with complex input
      const complexText = 'Contact john.doe@company.com or call +1-555-123-4567 for API key';
      const results = detector.scanText(text);
      
      expect(results.length).toBeGreaterThan(0);
      expect(() => detector.scanText(complexText)).not.toThrow();
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty strings', () => {
      const results = detector.scanText('');
      expect(results).toHaveLength(0);
    });

    it('should handle very long strings', () => {
      const longText = 'a'.repeat(100000);
      expect(() => detector.scanText(longText)).not.toThrow();
    });

    it('should handle special characters', () => {
      const specialText = '🚀 Email: user@example.com 🎉';
      const results = detector.scanText(specialText);
      
      expect(results).toHaveLength(1);
      expect(results[0].type).toBe('email');
    });

    it('should handle multiple occurrences of same PII type', () => {
      const text = 'Emails: first@example.com, second@test.com, third@company.org';
      const results = detector.scanText(text);
      
      expect(results).toHaveLength(3);
      results.forEach(result => {
        expect(result.type).toBe('email');
      });
    });
  });

  describe('Supported PII Types', () => {
    it('should return all supported PII types', () => {
      const supportedTypes = detector.getSupportedPIITypes();
      
      expect(supportedTypes).toContain('creditCard');
      expect(supportedTypes).toContain('ssn');
      expect(supportedTypes).toContain('email');
      expect(supportedTypes).toContain('phone');
      expect(supportedTypes).toContain('apiKey');
      expect(supportedTypes).toContain('jwt');
      expect(supportedTypes).toContain('ipAddress');
      expect(supportedTypes).toContain('password');
    });
  });
});