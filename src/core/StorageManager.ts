/**
 * Storage Manager - Manages capture session storage using IndexedDB
 * Implements data encryption for stored sessions, handles data cleanup and retention policies,
 * provides session CRUD operations, and implements data migration for schema changes
 */

import type { 
  CaptureSession, 
  ExtensionConfig, 
  ExtensionError,
  SessionMetadata 
} from '../types';
import type { EventBus } from './EventBus';

/**
 * Database schema version for migration tracking
 */
const CURRENT_SCHEMA_VERSION = 1;

/**
 * IndexedDB database configuration
 */
const DATABASE_CONFIG = {
  name: 'ConsoleCapturePro',
  version: CURRENT_SCHEMA_VERSION,
  stores: {
    sessions: 'sessions',
    metadata: 'metadata'
  }
} as const;

/**
 * Storage statistics interface
 */
interface StorageStats {
  totalSessions: number;
  totalSizeBytes: number;
  oldestSession?: Date;
  newestSession?: Date;
  sessionsWithSensitiveData: number;
}

/**
 * Encrypted session data interface for storage
 */
interface EncryptedSessionData {
  id: string;
  encryptedData: string;
  iv: string;
  timestamp: Date;
  metadata: SessionMetadata;
  schemaVersion: number;
}

/**
 * Storage manager that handles all session persistence operations
 */
export class StorageManager {
  private db: IDBDatabase | null = null;
  private eventBus: EventBus;
  private isInitialized: boolean = false;
  private encryptionKey: CryptoKey | null = null;
  private retentionHours: number = 168; // Default 1 week
  private maxStorageBytes: number = 100 * 1024 * 1024; // 100MB default

  /**
   * Creates a new StorageManager instance
   * @param eventBus - Event bus for emitting storage events
   */
  constructor(eventBus: EventBus) {
    this.eventBus = eventBus;
  }

  /**
   * Initializes the storage manager and IndexedDB
   * Sets up database schema and encryption keys
   * @returns Promise that resolves when initialization is complete
   * @throws {ExtensionError} When initialization fails
   */
  async initialize(): Promise<void> {
    try {
      await this.initializeDatabase();
      await this.initializeEncryption();
      await this.performMigrations();
      
      this.isInitialized = true;
      this.eventBus.emit('storage:initialized', { 
        databaseVersion: CURRENT_SCHEMA_VERSION 
      });
      
      // Schedule initial cleanup
      setTimeout(() => this.performCleanup(), 5000);
      
    } catch (error) {
      const extensionError: ExtensionError = {
        name: 'StorageInitializationError',
        message: `Failed to initialize storage manager: ${error instanceof Error ? error.message : 'Unknown error'}`,
        code: 'STORAGE_INIT_FAILED',
        severity: 'critical',
        reportable: true,
        context: { originalError: error }
      };
      throw extensionError;
    }
  }

  /**
   * Saves a capture session to storage with encryption
   * @param session - Session to save
   * @returns Promise that resolves when session is saved
   * @throws {ExtensionError} When saving fails
   */
  async saveSession(session: CaptureSession): Promise<void> {
    this.ensureInitialized();
    
    try {
      const encryptedData = await this.encryptSession(session);
      const transaction = this.db!.transaction([DATABASE_CONFIG.stores.sessions], 'readwrite');
      const store = transaction.objectStore(DATABASE_CONFIG.stores.sessions);
      
      await this.promisifyRequest(store.put(encryptedData));
      
      // Update storage statistics
      await this.updateStorageStats();
      
      this.eventBus.emit('storage:session-saved', {
        sessionId: session.id,
        containsSensitiveData: session.metadata.containsSensitiveData,
        logCount: session.logs.length
      });
      
    } catch (error) {
      const extensionError: ExtensionError = {
        name: 'SessionSaveError',
        message: `Failed to save session: ${error instanceof Error ? error.message : 'Unknown error'}`,
        code: 'SESSION_SAVE_FAILED',
        severity: 'high',
        reportable: true,
        context: { 
          originalError: error,
          sessionId: session.id
        }
      };
      throw extensionError;
    }
  }

  /**
   * Retrieves a capture session from storage by ID
   * @param sessionId - ID of the session to retrieve
   * @returns Promise that resolves to the session or null if not found
   * @throws {ExtensionError} When retrieval fails
   */
  async getSession(sessionId: string): Promise<CaptureSession | null> {
    this.ensureInitialized();
    
    try {
      const transaction = this.db!.transaction([DATABASE_CONFIG.stores.sessions], 'readonly');
      const store = transaction.objectStore(DATABASE_CONFIG.stores.sessions);
      
      const result = await this.promisifyRequest(store.get(sessionId));
      
      if (!result) {
        return null;
      }
      
      const session = await this.decryptSession(result as EncryptedSessionData);
      
      this.eventBus.emit('storage:session-retrieved', {
        sessionId: session.id,
        logCount: session.logs.length
      });
      
      return session;
      
    } catch (error) {
      const extensionError: ExtensionError = {
        name: 'SessionRetrievalError',
        message: `Failed to retrieve session: ${error instanceof Error ? error.message : 'Unknown error'}`,
        code: 'SESSION_RETRIEVAL_FAILED',
        severity: 'medium',
        reportable: true,
        context: { 
          originalError: error,
          sessionId
        }
      };
      throw extensionError;
    }
  }

  /**
   * Retrieves all capture sessions from storage
   * @param includeData - Whether to include full session data or just metadata
   * @returns Promise that resolves to array of sessions
   * @throws {ExtensionError} When retrieval fails
   */
  async getSessions(includeData: boolean = true): Promise<CaptureSession[]> {
    this.ensureInitialized();
    
    try {
      const transaction = this.db!.transaction([DATABASE_CONFIG.stores.sessions], 'readonly');
      const store = transaction.objectStore(DATABASE_CONFIG.stores.sessions);
      
      const results = await this.promisifyRequest(store.getAll());
      
      if (includeData) {
        // Decrypt all sessions
        const sessions = await Promise.all(
          results.map((encrypted: EncryptedSessionData) => this.decryptSession(encrypted))
        );
        
        // Sort by timestamp (newest first)
        return sessions.sort((a, b) => b.startTime.getTime() - a.startTime.getTime());
      } else {
        // Return minimal session info without decryption
        return results.map((encrypted: EncryptedSessionData) => ({
          id: encrypted.id,
          startTime: new Date(encrypted.timestamp),
          endTime: undefined,
          logs: [],
          context: {} as any,
          metadata: encrypted.metadata
        }));
      }
      
    } catch (error) {
      const extensionError: ExtensionError = {
        name: 'SessionsRetrievalError',
        message: `Failed to retrieve sessions: ${error instanceof Error ? error.message : 'Unknown error'}`,
        code: 'SESSIONS_RETRIEVAL_FAILED',
        severity: 'medium',
        reportable: true,
        context: { originalError: error }
      };
      throw extensionError;
    }
  }

  /**
   * Deletes a capture session from storage
   * @param sessionId - ID of the session to delete
   * @returns Promise that resolves when session is deleted
   * @throws {ExtensionError} When deletion fails
   */
  async deleteSession(sessionId: string): Promise<void> {
    this.ensureInitialized();
    
    try {
      const transaction = this.db!.transaction([DATABASE_CONFIG.stores.sessions], 'readwrite');
      const store = transaction.objectStore(DATABASE_CONFIG.stores.sessions);
      
      await this.promisifyRequest(store.delete(sessionId));
      
      // Update storage statistics
      await this.updateStorageStats();
      
      this.eventBus.emit('storage:session-deleted', { sessionId });
      
    } catch (error) {
      const extensionError: ExtensionError = {
        name: 'SessionDeleteError',
        message: `Failed to delete session: ${error instanceof Error ? error.message : 'Unknown error'}`,
        code: 'SESSION_DELETE_FAILED',
        severity: 'medium',
        reportable: true,
        context: { 
          originalError: error,
          sessionId
        }
      };
      throw extensionError;
    }
  }

  /**
   * Updates storage configuration based on extension config
   * @param config - Updated extension configuration
   */
  updateConfig(config: ExtensionConfig): void {
    this.retentionHours = config.privacy.dataRetentionHours;
    this.maxStorageBytes = config.performance.maxMemoryMB * 1024 * 1024;
    
    // Schedule cleanup if retention policy changed
    if (this.isInitialized) {
      setTimeout(() => this.performCleanup(), 1000);
    }
  }

  /**
   * Performs cleanup of expired sessions and manages storage limits
   * @returns Promise that resolves when cleanup is complete
   */
  async cleanup(): Promise<void> {
    this.ensureInitialized();
    await this.performCleanup();
  }

  /**
   * Gets storage statistics and usage information
   * @returns Promise that resolves to storage statistics
   */
  async getStorageStats(): Promise<StorageStats> {
    this.ensureInitialized();
    
    try {
      const transaction = this.db!.transaction([DATABASE_CONFIG.stores.sessions], 'readonly');
      const store = transaction.objectStore(DATABASE_CONFIG.stores.sessions);
      
      const results = await this.promisifyRequest(store.getAll());
      
      let totalSizeBytes = 0;
      let oldestSession: Date | undefined;
      let newestSession: Date | undefined;
      let sessionsWithSensitiveData = 0;
      
      for (const encrypted of results) {
        totalSizeBytes += new TextEncoder().encode(encrypted.encryptedData).length;
        
        const sessionDate = new Date(encrypted.timestamp);
        if (!oldestSession || sessionDate < oldestSession) {
          oldestSession = sessionDate;
        }
        if (!newestSession || sessionDate > newestSession) {
          newestSession = sessionDate;
        }
        
        if (encrypted.metadata.containsSensitiveData) {
          sessionsWithSensitiveData++;
        }
      }
      
      return {
        totalSessions: results.length,
        totalSizeBytes,
        oldestSession,
        newestSession,
        sessionsWithSensitiveData
      };
      
    } catch (error) {
      throw new Error(`Failed to get storage statistics: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Gets the total number of stored sessions
   * @returns Number of sessions in storage
   */
  getSessionCount(): number {
    // This is a synchronous method used by ExtensionManager for status
    // We'll return 0 if not initialized, actual count would require async call
    return 0; // TODO: Consider caching this value for sync access
  }

  /**
   * Exports all sessions for backup purposes
   * @returns Promise that resolves to serialized session data
   * @throws {ExtensionError} When export fails
   */
  async exportSessions(): Promise<string> {
    this.ensureInitialized();
    
    try {
      const sessions = await this.getSessions(true);
      const exportData = {
        version: CURRENT_SCHEMA_VERSION,
        timestamp: new Date().toISOString(),
        sessions
      };
      
      return JSON.stringify(exportData, null, 2);
      
    } catch (error) {
      const extensionError: ExtensionError = {
        name: 'SessionExportError',
        message: `Failed to export sessions: ${error instanceof Error ? error.message : 'Unknown error'}`,
        code: 'SESSION_EXPORT_FAILED',
        severity: 'low',
        reportable: false,
        context: { originalError: error }
      };
      throw extensionError;
    }
  }

  /**
   * Clears all stored sessions
   * @returns Promise that resolves when all sessions are cleared
   * @throws {ExtensionError} When clearing fails
   */
  async clearAllSessions(): Promise<void> {
    this.ensureInitialized();
    
    try {
      const transaction = this.db!.transaction([DATABASE_CONFIG.stores.sessions], 'readwrite');
      const store = transaction.objectStore(DATABASE_CONFIG.stores.sessions);
      
      await this.promisifyRequest(store.clear());
      
      this.eventBus.emit('storage:all-sessions-cleared', { timestamp: new Date() });
      
    } catch (error) {
      const extensionError: ExtensionError = {
        name: 'SessionClearError',
        message: `Failed to clear all sessions: ${error instanceof Error ? error.message : 'Unknown error'}`,
        code: 'SESSION_CLEAR_FAILED',
        severity: 'medium',
        reportable: false,
        context: { originalError: error }
      };
      throw extensionError;
    }
  }

  /**
   * Shuts down the storage manager
   * @returns Promise that resolves when shutdown is complete
   */
  async shutdown(): Promise<void> {
    if (!this.isInitialized) {
      return;
    }

    try {
      // Perform final cleanup
      await this.performCleanup();
      
      if (this.db) {
        this.db.close();
        this.db = null;
      }
      
      this.encryptionKey = null;
      this.isInitialized = false;
      
      this.eventBus.emit('storage:shutdown', { timestamp: new Date() });
      
    } catch (error) {
      console.error('StorageManager shutdown error:', error);
    }
  }

  /**
   * Initializes the IndexedDB database
   * @private
   */
  private async initializeDatabase(): Promise<void> {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DATABASE_CONFIG.name, DATABASE_CONFIG.version);
      
      request.onerror = () => reject(new Error(`IndexedDB error: ${request.error?.message}`));
      request.onsuccess = () => {
        this.db = request.result;
        resolve();
      };
      
      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;
        
        // Create sessions store if it doesn't exist
        if (!db.objectStoreNames.contains(DATABASE_CONFIG.stores.sessions)) {
          const sessionsStore = db.createObjectStore(DATABASE_CONFIG.stores.sessions, { 
            keyPath: 'id' 
          });
          sessionsStore.createIndex('timestamp', 'timestamp', { unique: false });
          sessionsStore.createIndex('containsSensitiveData', 'metadata.containsSensitiveData', { unique: false });
        }
        
        // Create metadata store for additional tracking
        if (!db.objectStoreNames.contains(DATABASE_CONFIG.stores.metadata)) {
          db.createObjectStore(DATABASE_CONFIG.stores.metadata, { 
            keyPath: 'key' 
          });
        }
      };
    });
  }

  /**
   * Initializes encryption key for session data
   * @private
   */
  private async initializeEncryption(): Promise<void> {
    try {
      // Try to load existing key from storage
      const result = await chrome.storage.local.get('consoleCapturePro:encryptionKey');
      
      if (result['consoleCapturePro:encryptionKey']) {
        // Import existing key
        const keyData = result['consoleCapturePro:encryptionKey'];
        this.encryptionKey = await crypto.subtle.importKey(
          'raw',
          new Uint8Array(keyData),
          { name: 'AES-GCM' },
          false,
          ['encrypt', 'decrypt']
        );
      } else {
        // Generate new encryption key
        this.encryptionKey = await crypto.subtle.generateKey(
          { name: 'AES-GCM', length: 256 },
          true,
          ['encrypt', 'decrypt']
        );
        
        // Export and store the key
        const keyData = await crypto.subtle.exportKey('raw', this.encryptionKey);
        await chrome.storage.local.set({
          'consoleCapturePro:encryptionKey': Array.from(new Uint8Array(keyData))
        });
      }
    } catch (error) {
      throw new Error(`Failed to initialize encryption: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Performs database migrations for schema changes
   * @private
   */
  private async performMigrations(): Promise<void> {
    // Future migrations would be implemented here
    // For now, we're at version 1, so no migrations needed
  }

  /**
   * Encrypts session data for storage
   * @param session - Session to encrypt
   * @returns Encrypted session data
   * @private
   */
  private async encryptSession(session: CaptureSession): Promise<EncryptedSessionData> {
    if (!this.encryptionKey) {
      throw new Error('Encryption key not available');
    }

    try {
      const sessionData = JSON.stringify(session);
      const encoder = new TextEncoder();
      const data = encoder.encode(sessionData);
      
      const iv = crypto.getRandomValues(new Uint8Array(12));
      const encryptedBuffer = await crypto.subtle.encrypt(
        { name: 'AES-GCM', iv },
        this.encryptionKey,
        data
      );
      
      return {
        id: session.id,
        encryptedData: Array.from(new Uint8Array(encryptedBuffer)).map(b => b.toString(16).padStart(2, '0')).join(''),
        iv: Array.from(iv).map(b => b.toString(16).padStart(2, '0')).join(''),
        timestamp: session.startTime,
        metadata: session.metadata,
        schemaVersion: CURRENT_SCHEMA_VERSION
      };
    } catch (error) {
      throw new Error(`Failed to encrypt session: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Decrypts session data from storage
   * @param encryptedData - Encrypted session data
   * @returns Decrypted session
   * @private
   */
  private async decryptSession(encryptedData: EncryptedSessionData): Promise<CaptureSession> {
    if (!this.encryptionKey) {
      throw new Error('Encryption key not available');
    }

    try {
      const encryptedBuffer = new Uint8Array(
        encryptedData.encryptedData.match(/.{2}/g)!.map(byte => parseInt(byte, 16))
      );
      const iv = new Uint8Array(
        encryptedData.iv.match(/.{2}/g)!.map(byte => parseInt(byte, 16))
      );
      
      const decryptedBuffer = await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv },
        this.encryptionKey,
        encryptedBuffer
      );
      
      const decoder = new TextDecoder();
      const sessionData = decoder.decode(decryptedBuffer);
      const session = JSON.parse(sessionData);
      
      // Convert date strings back to Date objects
      session.startTime = new Date(session.startTime);
      if (session.endTime) {
        session.endTime = new Date(session.endTime);
      }
      session.logs.forEach((log: any) => {
        log.timestamp = new Date(log.timestamp);
        if (log.classification?.scanTimestamp) {
          log.classification.scanTimestamp = new Date(log.classification.scanTimestamp);
        }
      });
      
      return session;
    } catch (error) {
      throw new Error(`Failed to decrypt session: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Performs cleanup of expired sessions and manages storage limits
   * @private
   */
  private async performCleanup(): Promise<void> {
    try {
      const cutoffTime = new Date(Date.now() - (this.retentionHours * 60 * 60 * 1000));
      const transaction = this.db!.transaction([DATABASE_CONFIG.stores.sessions], 'readwrite');
      const store = transaction.objectStore(DATABASE_CONFIG.stores.sessions);
      const index = store.index('timestamp');
      
      // Get all sessions older than cutoff
      const range = IDBKeyRange.upperBound(cutoffTime);
      const expiredSessions = await this.promisifyRequest(index.getAll(range));
      
      // Delete expired sessions
      let deletedCount = 0;
      for (const expired of expiredSessions) {
        await this.promisifyRequest(store.delete(expired.id));
        deletedCount++;
      }
      
      // Check storage size limits
      const stats = await this.getStorageStats();
      if (stats.totalSizeBytes > this.maxStorageBytes) {
        await this.cleanupBySize();
      }
      
      if (deletedCount > 0) {
        this.eventBus.emit('storage:cleanup-completed', {
          deletedCount,
          reason: 'retention-policy',
          cutoffTime
        });
      }
      
    } catch (error) {
      console.error('Storage cleanup failed:', error);
      this.eventBus.emit('storage:cleanup-failed', { error: error.message });
    }
  }

  /**
   * Cleans up sessions by size when storage limit is exceeded
   * @private
   */
  private async cleanupBySize(): Promise<void> {
    const sessions = await this.getSessions(false);
    
    // Sort by date (oldest first) and delete until under limit
    sessions.sort((a, b) => a.startTime.getTime() - b.startTime.getTime());
    
    let deletedCount = 0;
    for (const session of sessions) {
      await this.deleteSession(session.id);
      deletedCount++;
      
      const stats = await this.getStorageStats();
      if (stats.totalSizeBytes <= this.maxStorageBytes * 0.8) { // Target 80% of limit
        break;
      }
    }
    
    if (deletedCount > 0) {
      this.eventBus.emit('storage:cleanup-completed', {
        deletedCount,
        reason: 'size-limit',
        targetSizeBytes: this.maxStorageBytes
      });
    }
  }

  /**
   * Updates cached storage statistics
   * @private
   */
  private async updateStorageStats(): Promise<void> {
    try {
      const stats = await this.getStorageStats();
      const transaction = this.db!.transaction([DATABASE_CONFIG.stores.metadata], 'readwrite');
      const store = transaction.objectStore(DATABASE_CONFIG.stores.metadata);
      
      await this.promisifyRequest(store.put({
        key: 'stats',
        value: stats,
        lastUpdated: new Date()
      }));
    } catch (error) {
      console.error('Failed to update storage stats:', error);
    }
  }

  /**
   * Converts IndexedDB request to Promise
   * @param request - IndexedDB request
   * @returns Promise that resolves with request result
   * @private
   */
  private promisifyRequest<T>(request: IDBRequest<T>): Promise<T> {
    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(new Error(`IndexedDB request failed: ${request.error?.message}`));
    });
  }

  /**
   * Ensures the storage manager is initialized
   * @throws {Error} When not initialized
   * @private
   */
  private ensureInitialized(): void {
    if (!this.isInitialized) {
      throw new Error('StorageManager not initialized. Call initialize() first.');
    }
  }
}