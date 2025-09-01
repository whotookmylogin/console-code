/**
 * WXT Configuration for ConsoleCapture Pro
 * Configures the browser extension build process with security and performance optimizations
 */
import { defineConfig } from 'wxt';

export default defineConfig({
  // Extension metadata
  manifest: {
    name: 'ConsoleCapture Pro',
    description: 'Intelligent console log capture with privacy-first design',
    version: '1.0.0',
    permissions: [
      'activeTab',
      'storage',
      'scripting'
    ],
    host_permissions: ['<all_urls>', 'http://localhost:*/*', 'https://localhost:*/*'],
    web_accessible_resources: [
      {
        resources: [
          'capture-worker.js',
          'content-scripts/*.js'
        ],
        matches: ['<all_urls>']
      }
    ]
  },

  // Development configuration
  dev: {
    server: {
      port: 3000
    }
  },

  // Build optimizations
  build: {
    target: 'es2022',
    minify: true,
    sourcemap: process.env['NODE_ENV'] === 'development',
    rollupOptions: {
      output: {
        manualChunks: {
          'tensorflow': ['@tensorflow/tfjs'],
          'utils': ['zod']
        }
      }
    }
  },

  // Browser support
  browser: 'chrome',
  
  // TypeScript configuration
  typescript: {
    strict: true,
    noImplicitAny: true
  }
});