/**
 * Vitest Configuration for ConsoleCapture Pro
 * Configures testing framework with security testing support
 */
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./tests/setup.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: [
        'node_modules/',
        'dist/',
        '.output/',
        'tests/',
        '*.config.*'
      ],
      thresholds: {
        global: {
          branches: 80,
          functions: 80,
          lines: 80,
          statements: 80
        }
      }
    },
    // Security test configuration
    include: [
      'tests/**/*.test.ts',
      'src/**/*.test.ts'
    ],
    exclude: [
      'node_modules/',
      'dist/',
      '.output/'
    ],
    testTimeout: 10000
  },
  resolve: {
    alias: {
      '@': '/src',
      '@tests': '/tests'
    }
  }
});