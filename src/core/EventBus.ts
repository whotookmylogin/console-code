/**
 * Event Bus - Implements type-safe event system for component communication
 * Provides subscribe/unsubscribe functionality, handles event queuing and async event processing,
 * implements error handling for event listeners, and provides debugging/logging for events in development
 */

import type { ExtensionError, CaptureSession, ExtensionConfig } from '../types';

/**
 * Event payload type definitions for type safety
 */
export interface EventPayloads {
  // Extension lifecycle events
  'extension:initialized': { timestamp: Date };
  'extension:error': ExtensionError;
  'extension:shutdown': { timestamp: Date };

  // Configuration events
  'config:initialized': { config: ExtensionConfig };
  'config:updated': { config: ExtensionConfig; previousConfig: ExtensionConfig; changes: Partial<ExtensionConfig> };
  'config:reset': { config: ExtensionConfig; previousConfig: ExtensionConfig };
  'config:imported': { config: ExtensionConfig; importVersion: string };
  'config:shutdown': { timestamp: Date };

  // Storage events
  'storage:initialized': { databaseVersion: number };
  'storage:session-saved': { sessionId: string; containsSensitiveData: boolean; logCount: number };
  'storage:session-retrieved': { sessionId: string; logCount: number };
  'storage:session-deleted': { sessionId: string };
  'storage:all-sessions-cleared': { timestamp: Date };
  'storage:cleanup-completed': { deletedCount: number; reason: string; cutoffTime?: Date; targetSizeBytes?: number };
  'storage:cleanup-failed': { error: string };
  'storage:cleanup': {};
  'storage:shutdown': { timestamp: Date };

  // Capture events
  'capture:started': { sessionId: string };
  'capture:stopped': { sessionId: string };
  'capture:log-captured': { sessionId: string; logLevel: string; containsPII: boolean };
  'capture:session-ended': { session: CaptureSession };

  // Security events
  'security:pii-detected': { sessionId: string; count: number };
  'security:sanitization-applied': { sessionId: string; logId: string; originalLength: number; sanitizedLength: number };
  'security:encryption-completed': { sessionId: string; dataSize: number };

  // Performance events
  'performance:memory-warning': { currentMB: number; limitMB: number };
  'performance:throttle-applied': { eventType: string; delayMs: number };

  // Export events
  'export:started': { sessionId: string; format: string };
  'export:completed': { sessionId: string; format: string; size: number };
  'export:failed': { sessionId: string; format: string; error: string };
}

/**
 * Event listener function type
 */
export type EventListener<T = any> = (payload: T) => void | Promise<void>;

/**
 * Event subscription interface
 */
interface EventSubscription {
  id: string;
  eventName: string;
  listener: EventListener;
  once: boolean;
  priority: number;
  created: Date;
}

/**
 * Event processing options
 */
interface EventOptions {
  /** Whether this is a one-time listener */
  once?: boolean;
  /** Priority for event processing (higher numbers processed first) */
  priority?: number;
  /** Maximum time to wait for async listeners (ms) */
  timeout?: number;
}

/**
 * Event processing statistics
 */
interface EventStats {
  totalEventsEmitted: number;
  totalListeners: number;
  eventCounts: Record<string, number>;
  averageProcessingTime: number;
  failedEvents: number;
  lastError?: {
    event: string;
    error: string;
    timestamp: Date;
  };
}

/**
 * Queued event for async processing
 */
interface QueuedEvent {
  eventName: string;
  payload: any;
  timestamp: Date;
  retryCount: number;
  maxRetries: number;
}

/**
 * Type-safe event bus for inter-component communication
 */
export class EventBus {
  private subscriptions: Map<string, EventSubscription[]> = new Map();
  private subscriptionIdCounter: number = 0;
  private eventQueue: QueuedEvent[] = [];
  private isProcessingQueue: boolean = false;
  private stats: EventStats = {
    totalEventsEmitted: 0,
    totalListeners: 0,
    eventCounts: {},
    averageProcessingTime: 0,
    failedEvents: 0
  };
  private processingTimes: number[] = [];
  private maxQueueSize: number = 1000;
  private defaultTimeout: number = 5000; // 5 seconds
  private debugMode: boolean = process.env['NODE_ENV'] === 'development';

  /**
   * Creates a new EventBus instance
   */
  constructor() {
    // Start queue processing
    this.startQueueProcessor();
  }

  /**
   * Subscribes to an event with type safety
   * @param eventName - Name of the event to subscribe to
   * @param listener - Event listener function
   * @param options - Subscription options
   * @returns Unsubscribe function
   */
  on<K extends keyof EventPayloads>(
    eventName: K,
    listener: EventListener<EventPayloads[K]>,
    options: EventOptions = {}
  ): () => void {
    const subscription: EventSubscription = {
      id: `sub_${++this.subscriptionIdCounter}`,
      eventName: eventName as string,
      listener,
      once: options.once || false,
      priority: options.priority || 0,
      created: new Date()
    };

    if (!this.subscriptions.has(eventName as string)) {
      this.subscriptions.set(eventName as string, []);
    }

    const subscriptions = this.subscriptions.get(eventName as string)!;
    subscriptions.push(subscription);

    // Sort by priority (higher priority first)
    subscriptions.sort((a, b) => b.priority - a.priority);

    this.stats.totalListeners++;

    if (this.debugMode) {
      console.debug(`[EventBus] Subscribed to '${eventName}' (ID: ${subscription.id}, Priority: ${subscription.priority})`);
    }

    // Return unsubscribe function
    return () => this.unsubscribe(subscription.id);
  }

  /**
   * Subscribes to an event for one-time execution
   * @param eventName - Name of the event to subscribe to
   * @param listener - Event listener function
   * @param options - Subscription options
   * @returns Unsubscribe function
   */
  once<K extends keyof EventPayloads>(
    eventName: K,
    listener: EventListener<EventPayloads[K]>,
    options: Omit<EventOptions, 'once'> = {}
  ): () => void {
    return this.on(eventName, listener, { ...options, once: true });
  }

  /**
   * Emits an event to all subscribers
   * @param eventName - Name of the event to emit
   * @param payload - Event payload data
   * @param options - Emission options
   */
  emit<K extends keyof EventPayloads>(
    eventName: K,
    payload: EventPayloads[K],
    options: { async?: boolean; timeout?: number } = {}
  ): void {
    const startTime = performance.now();
    
    this.stats.totalEventsEmitted++;
    this.stats.eventCounts[eventName as string] = (this.stats.eventCounts[eventName as string] || 0) + 1;

    if (this.debugMode) {
      console.debug(`[EventBus] Emitting '${eventName}'`, payload);
    }

    const subscriptions = this.subscriptions.get(eventName as string) || [];
    
    if (subscriptions.length === 0) {
      if (this.debugMode) {
        console.debug(`[EventBus] No listeners for '${eventName}'`);
      }
      return;
    }

    if (options.async) {
      // Queue for async processing
      this.queueEvent(eventName as string, payload, options.timeout);
    } else {
      // Process synchronously
      this.processEventSync(eventName as string, payload, subscriptions, startTime, options.timeout);
    }
  }

  /**
   * Emits an event asynchronously
   * @param eventName - Name of the event to emit
   * @param payload - Event payload data
   * @param timeout - Timeout for async processing
   * @returns Promise that resolves when all async listeners complete
   */
  async emitAsync<K extends keyof EventPayloads>(
    eventName: K,
    payload: EventPayloads[K],
    timeout?: number
  ): Promise<void> {
    const startTime = performance.now();
    
    this.stats.totalEventsEmitted++;
    this.stats.eventCounts[eventName as string] = (this.stats.eventCounts[eventName as string] || 0) + 1;

    if (this.debugMode) {
      console.debug(`[EventBus] Emitting async '${eventName}'`, payload);
    }

    const subscriptions = this.subscriptions.get(eventName as string) || [];
    
    if (subscriptions.length === 0) {
      return;
    }

    await this.processEventAsync(eventName as string, payload, subscriptions, startTime, timeout);
  }

  /**
   * Unsubscribes from an event by subscription ID
   * @param subscriptionId - ID of the subscription to remove
   * @returns Whether the subscription was found and removed
   */
  unsubscribe(subscriptionId: string): boolean {
    for (const [eventName, subscriptions] of this.subscriptions.entries()) {
      const index = subscriptions.findIndex(sub => sub.id === subscriptionId);
      
      if (index !== -1) {
        subscriptions.splice(index, 1);
        this.stats.totalListeners--;
        
        if (subscriptions.length === 0) {
          this.subscriptions.delete(eventName);
        }

        if (this.debugMode) {
          console.debug(`[EventBus] Unsubscribed from '${eventName}' (ID: ${subscriptionId})`);
        }
        
        return true;
      }
    }
    
    return false;
  }

  /**
   * Removes all listeners for a specific event
   * @param eventName - Name of the event to clear
   * @returns Number of listeners removed
   */
  removeAllListeners<K extends keyof EventPayloads>(eventName?: K): number {
    if (eventName) {
      const subscriptions = this.subscriptions.get(eventName as string) || [];
      const count = subscriptions.length;
      
      this.subscriptions.delete(eventName as string);
      this.stats.totalListeners -= count;
      
      if (this.debugMode) {
        console.debug(`[EventBus] Removed ${count} listeners for '${eventName}'`);
      }
      
      return count;
    } else {
      // Remove all listeners for all events
      const totalCount = this.stats.totalListeners;
      this.subscriptions.clear();
      this.stats.totalListeners = 0;
      
      if (this.debugMode) {
        console.debug(`[EventBus] Removed all ${totalCount} listeners`);
      }
      
      return totalCount;
    }
  }

  /**
   * Gets the number of listeners for an event
   * @param eventName - Name of the event
   * @returns Number of listeners
   */
  listenerCount<K extends keyof EventPayloads>(eventName: K): number {
    const subscriptions = this.subscriptions.get(eventName as string);
    return subscriptions ? subscriptions.length : 0;
  }

  /**
   * Gets all event names that have listeners
   * @returns Array of event names
   */
  eventNames(): string[] {
    return Array.from(this.subscriptions.keys());
  }

  /**
   * Gets event processing statistics
   * @returns Event statistics object
   */
  getStats(): EventStats {
    return { ...this.stats };
  }

  /**
   * Resets event statistics
   */
  resetStats(): void {
    this.stats = {
      totalEventsEmitted: 0,
      totalListeners: this.stats.totalListeners, // Keep current listener count
      eventCounts: {},
      averageProcessingTime: 0,
      failedEvents: 0
    };
    this.processingTimes = [];
  }

  /**
   * Sets debug mode for detailed logging
   * @param enabled - Whether to enable debug mode
   */
  setDebugMode(enabled: boolean): void {
    this.debugMode = enabled;
    
    if (this.debugMode) {
      console.debug('[EventBus] Debug mode enabled');
    }
  }

  /**
   * Gets the current size of the event queue
   * @returns Number of queued events
   */
  getQueueSize(): number {
    return this.eventQueue.length;
  }

  /**
   * Clears the event queue
   * @returns Number of events cleared
   */
  clearQueue(): number {
    const count = this.eventQueue.length;
    this.eventQueue = [];
    
    if (this.debugMode) {
      console.debug(`[EventBus] Cleared ${count} queued events`);
    }
    
    return count;
  }

  /**
   * Processes events synchronously
   * @private
   */
  private processEventSync(
    eventName: string,
    payload: any,
    subscriptions: EventSubscription[],
    startTime: number,
    timeout?: number
  ): void {
    const toRemove: string[] = [];
    
    for (const subscription of subscriptions) {
      try {
        const result = subscription.listener(payload);
        
        // Handle async listeners in sync context
        if (result instanceof Promise) {
          const timeoutMs = timeout || this.defaultTimeout;
          
          Promise.race([
            result,
            new Promise((_, reject) => 
              setTimeout(() => reject(new Error('Listener timeout')), timeoutMs)
            )
          ]).catch(error => {
            this.handleListenerError(eventName, subscription, error);
          });
        }
        
        // Mark for removal if it's a one-time listener
        if (subscription.once) {
          toRemove.push(subscription.id);
        }
        
      } catch (error) {
        this.handleListenerError(eventName, subscription, error);
      }
    }
    
    // Remove one-time listeners
    toRemove.forEach(id => this.unsubscribe(id));
    
    // Update processing time stats
    this.updateProcessingTime(performance.now() - startTime);
  }

  /**
   * Processes events asynchronously
   * @private
   */
  private async processEventAsync(
    eventName: string,
    payload: any,
    subscriptions: EventSubscription[],
    startTime: number,
    timeout?: number
  ): Promise<void> {
    const toRemove: string[] = [];
    const timeoutMs = timeout || this.defaultTimeout;
    
    const promises = subscriptions.map(async (subscription) => {
      try {
        const listenerPromise = Promise.resolve(subscription.listener(payload));
        
        await Promise.race([
          listenerPromise,
          new Promise((_, reject) => 
            setTimeout(() => reject(new Error('Listener timeout')), timeoutMs)
          )
        ]);
        
        // Mark for removal if it's a one-time listener
        if (subscription.once) {
          toRemove.push(subscription.id);
        }
        
      } catch (error) {
        this.handleListenerError(eventName, subscription, error);
      }
    });
    
    await Promise.allSettled(promises);
    
    // Remove one-time listeners
    toRemove.forEach(id => this.unsubscribe(id));
    
    // Update processing time stats
    this.updateProcessingTime(performance.now() - startTime);
  }

  /**
   * Queues an event for async processing
   * @private
   */
  private queueEvent(eventName: string, payload: any, timeout?: number): void {
    if (this.eventQueue.length >= this.maxQueueSize) {
      // Remove oldest event to make space
      this.eventQueue.shift();
      
      if (this.debugMode) {
        console.warn('[EventBus] Event queue full, dropping oldest event');
      }
    }
    
    this.eventQueue.push({
      eventName,
      payload,
      timestamp: new Date(),
      retryCount: 0,
      maxRetries: 3
    });
  }

  /**
   * Starts the async event queue processor
   * @private
   */
  private startQueueProcessor(): void {
    const processQueue = async () => {
      if (this.isProcessingQueue || this.eventQueue.length === 0) {
        return;
      }
      
      this.isProcessingQueue = true;
      
      while (this.eventQueue.length > 0) {
        const queuedEvent = this.eventQueue.shift()!;
        
        try {
          const subscriptions = this.subscriptions.get(queuedEvent.eventName) || [];
          await this.processEventAsync(
            queuedEvent.eventName,
            queuedEvent.payload,
            subscriptions,
            performance.now()
          );
        } catch (error) {
          queuedEvent.retryCount++;
          
          if (queuedEvent.retryCount < queuedEvent.maxRetries) {
            // Re-queue for retry
            this.eventQueue.push(queuedEvent);
          } else {
            this.stats.failedEvents++;
            this.stats.lastError = {
              event: queuedEvent.eventName,
              error: error instanceof Error ? error.message : 'Unknown error',
              timestamp: new Date()
            };
            
            if (this.debugMode) {
              console.error(`[EventBus] Failed to process queued event '${queuedEvent.eventName}' after ${queuedEvent.maxRetries} retries:`, error);
            }
          }
        }
      }
      
      this.isProcessingQueue = false;
    };
    
    // Process queue every 100ms
    setInterval(processQueue, 100);
  }

  /**
   * Handles listener execution errors
   * @private
   */
  private handleListenerError(eventName: string, subscription: EventSubscription, error: unknown): void {
    this.stats.failedEvents++;
    this.stats.lastError = {
      event: eventName,
      error: error instanceof Error ? error.message : 'Unknown error',
      timestamp: new Date()
    };
    
    if (this.debugMode) {
      console.error(`[EventBus] Listener error for '${eventName}' (ID: ${subscription.id}):`, error);
    }
    
    // Emit error event (be careful not to create infinite loops)
    if (eventName !== 'extension:error') {
      try {
        this.emit('extension:error', {
          name: 'EventListenerError',
          message: `Listener failed for event '${eventName}': ${error instanceof Error ? error.message : 'Unknown error'}`,
          code: 'EVENT_LISTENER_FAILED',
          severity: 'low',
          reportable: false,
          context: { 
            eventName,
            subscriptionId: subscription.id,
            originalError: error
          }
        } as ExtensionError);
      } catch {
        // Ignore errors when emitting error events to prevent infinite loops
      }
    }
  }

  /**
   * Updates processing time statistics
   * @private
   */
  private updateProcessingTime(timeMs: number): void {
    this.processingTimes.push(timeMs);
    
    // Keep only last 100 measurements
    if (this.processingTimes.length > 100) {
      this.processingTimes = this.processingTimes.slice(-100);
    }
    
    // Calculate average
    this.stats.averageProcessingTime = 
      this.processingTimes.reduce((sum, time) => sum + time, 0) / this.processingTimes.length;
  }
}