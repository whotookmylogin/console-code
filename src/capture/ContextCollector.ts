/**
 * ContextCollector - Collects page context information, network requests, and performance metrics
 * Monitors user actions leading to errors and captures browser/device information
 */

import type { 
  SessionContext, 
  NetworkRequest, 
  PerformanceMetrics
} from '../types/index.js';

/**
 * Context collector configuration
 */
interface ContextCollectorConfig {
  /** Whether to monitor performance metrics */
  enablePerformanceMonitoring: boolean;
  /** Whether to monitor network requests */
  enableNetworkMonitoring: boolean;
  /** Whether to track user interactions */
  enableUserTracking: boolean;
  /** Maximum number of network requests to store */
  maxNetworkRequests: number;
  /** Maximum number of user actions to store */
  maxUserActions: number;
}

/**
 * User action tracking information
 */
interface UserAction {
  /** Action type (click, scroll, keypress, etc.) */
  type: string;
  /** Target element information */
  target: {
    tagName: string;
    id?: string;
    className?: string;
    textContent?: string;
  };
  /** Action timestamp */
  timestamp: Date;
  /** Mouse coordinates (for click events) */
  coordinates?: { x: number; y: number };
  /** Additional action-specific data */
  metadata?: Record<string, any>;
}

/**
 * Network request monitoring entry
 */
interface NetworkRequestMonitor {
  /** Request information */
  request: NetworkRequest;
  /** Associated Promise for tracking completion */
  promise?: Promise<Response>;
  /** Request start time for performance measurement */
  startTime: number;
}

/**
 * Performance metrics collection system
 */
interface PerformanceCollector {
  /** Performance observer for monitoring metrics */
  observer?: PerformanceObserver;
  /** Collected navigation timing */
  navigationTiming?: PerformanceNavigationTiming;
  /** Collected paint timing */
  paintTiming: PerformanceEntry[];
  /** Collected resource timing */
  resourceTiming: PerformanceResourceTiming[];
  /** Memory usage tracking */
  memoryUsage: Array<{ timestamp: Date; usage: number }>;
}

/**
 * Context collector that gathers comprehensive page and user context information
 * Implements performance-optimized monitoring with Web Workers when possible
 */
export class ContextCollector {
  private isInitialized: boolean = false;
  private isMonitoring: boolean = false;
  private currentSessionId: string | null = null;
  
  // Configuration
  private config: ContextCollectorConfig = {
    enablePerformanceMonitoring: true,
    enableNetworkMonitoring: true,
    enableUserTracking: true,
    maxNetworkRequests: 100,
    maxUserActions: 50
  };
  
  // Context data storage
  private initialContext: SessionContext | null = null;
  private networkRequests: NetworkRequest[] = [];
  private userActions: UserAction[] = [];
  
  // Performance monitoring
  private performanceCollector: PerformanceCollector = {
    paintTiming: [],
    resourceTiming: [],
    memoryUsage: []
  };
  
  // Event listeners cleanup
  private eventListeners: Array<{
    target: EventTarget;
    event: string;
    handler: EventListener;
    options?: AddEventListenerOptions;
  }> = [];
  
  // Network monitoring
  private originalFetch: typeof fetch;
  private originalXHROpen: typeof XMLHttpRequest.prototype.open;
  private originalXHRSend: typeof XMLHttpRequest.prototype.send;
  private activeRequests: Map<string, NetworkRequestMonitor> = new Map();
  
  // Web Worker for performance-intensive operations
  private performanceWorker: Worker | null = null;
  private workerSupported: boolean = false;
  
  // Memory management
  private memoryMonitorInterval: NodeJS.Timeout | null = null;
  private cleanupInterval: NodeJS.Timeout | null = null;

  /**
   * Creates a new ContextCollector instance
   */
  constructor() {
    // Store original network methods for restoration
    this.originalFetch = window.fetch?.bind(window) || (() => Promise.reject(new Error('fetch not available')));
    this.originalXHROpen = XMLHttpRequest.prototype.open;
    this.originalXHRSend = XMLHttpRequest.prototype.send;
  }

  /**
   * Initializes the context collector
   * @returns Promise that resolves when initialization is complete
   */
  async initialize(): Promise<void> {
    if (this.isInitialized) {
      return;
    }

    try {
      // Check Web Worker support
      this.workerSupported = this.checkWebWorkerSupport();
      
      // Initialize Web Worker for performance-intensive operations
      if (this.workerSupported) {
        await this.initializePerformanceWorker();
      }
      
      // Initialize performance monitoring
      if (this.config.enablePerformanceMonitoring) {
        this.initializePerformanceMonitoring();
      }
      
      // Set up memory monitoring
      this.startMemoryMonitoring();
      
      // Set up cleanup intervals
      this.startPeriodicCleanup();
      
      this.isInitialized = true;
      
    } catch (error) {
      throw new Error(`Failed to initialize ContextCollector: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Collects initial context information for a new session
   * @returns Promise that resolves to initial session context
   */
  async collectInitialContext(): Promise<SessionContext> {
    if (!this.isInitialized) {
      throw new Error('ContextCollector not initialized. Call initialize() first.');
    }

    try {
      const context: SessionContext = {
        url: window.location.href,
        title: document.title || 'Unknown',
        userAgent: navigator.userAgent,
        viewport: {
          width: window.innerWidth || 0,
          height: window.innerHeight || 0
        },
        versions: {
          browser: this.detectBrowserVersion(),
          extension: await this.getExtensionVersion()
        }
      };
      
      // Collect initial performance metrics
      if (this.config.enablePerformanceMonitoring) {
        context.performance = await this.collectPerformanceMetrics();
      }
      
      // Initialize network requests array
      if (this.config.enableNetworkMonitoring) {
        context.networkRequests = [];
      }
      
      this.initialContext = context;
      return context;
      
    } catch (error) {
      throw new Error(`Failed to collect initial context: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Starts monitoring context changes for the given session
   * @param sessionId - Session ID to monitor
   */
  startMonitoring(sessionId: string): void {
    if (!this.isInitialized) {
      throw new Error('ContextCollector not initialized.');
    }
    
    if (this.isMonitoring) {
      this.stopMonitoring();
    }
    
    this.currentSessionId = sessionId;
    this.isMonitoring = true;
    
    // Start network monitoring
    if (this.config.enableNetworkMonitoring) {
      this.startNetworkMonitoring();
    }
    
    // Start user action tracking
    if (this.config.enableUserTracking) {
      this.startUserActionTracking();
    }
    
    // Start viewport change monitoring
    this.startViewportMonitoring();
    
    // Start URL change monitoring (for SPAs)
    this.startURLChangeMonitoring();
  }

  /**
   * Stops monitoring context changes
   */
  stopMonitoring(): void {
    if (!this.isMonitoring) {
      return;
    }
    
    // Remove all event listeners
    this.removeAllEventListeners();
    
    // Restore original network methods
    this.restoreNetworkMethods();
    
    // Stop performance monitoring
    this.stopPerformanceMonitoring();
    
    this.isMonitoring = false;
    this.currentSessionId = null;
  }

  /**
   * Gets final context information when session ends
   * @returns Promise that resolves to final session context
   */
  async getFinalContext(): Promise<SessionContext> {
    if (!this.initialContext) {
      throw new Error('No initial context available. Call collectInitialContext() first.');
    }

    try {
      // Update context with final data
      const finalContext: SessionContext = {
        ...this.initialContext,
        url: window.location.href, // May have changed during session
        title: document.title || this.initialContext.title,
        viewport: {
          width: window.innerWidth || this.initialContext.viewport.width,
          height: window.innerHeight || this.initialContext.viewport.height
        }
      };
      
      // Add collected network requests
      if (this.config.enableNetworkMonitoring) {
        finalContext.networkRequests = this.getNetworkRequests();
      }
      
      // Add final performance metrics
      if (this.config.enablePerformanceMonitoring) {
        finalContext.performance = await this.collectPerformanceMetrics();
      }
      
      return finalContext;
      
    } catch (error) {
      // Return initial context if final collection fails
      return this.initialContext;
    }
  }

  /**
   * Updates context collector configuration
   * @param config - Partial configuration updates
   */
  updateConfig(config: Partial<ContextCollectorConfig>): void {
    const oldConfig = { ...this.config };
    this.config = { ...this.config, ...config };
    
    // Restart monitoring if configuration changed significantly
    if (this.isMonitoring && (
      oldConfig.enableNetworkMonitoring !== this.config.enableNetworkMonitoring ||
      oldConfig.enableUserTracking !== this.config.enableUserTracking ||
      oldConfig.enablePerformanceMonitoring !== this.config.enablePerformanceMonitoring
    )) {
      const sessionId = this.currentSessionId;
      this.stopMonitoring();
      if (sessionId) {
        this.startMonitoring(sessionId);
      }
    }
  }

  /**
   * Gets current context collector statistics
   * @returns Statistics object
   */
  getStats(): {
    isMonitoring: boolean;
    networkRequestsCount: number;
    userActionsCount: number;
    memoryUsageSamples: number;
    workerSupported: boolean;
  } {
    return {
      isMonitoring: this.isMonitoring,
      networkRequestsCount: this.networkRequests.length,
      userActionsCount: this.userActions.length,
      memoryUsageSamples: this.performanceCollector.memoryUsage.length,
      workerSupported: this.workerSupported
    };
  }

  /**
   * Shuts down the context collector
   * @returns Promise that resolves when shutdown is complete
   */
  async shutdown(): Promise<void> {
    if (this.isMonitoring) {
      this.stopMonitoring();
    }
    
    // Terminate Web Worker
    if (this.performanceWorker) {
      this.performanceWorker.terminate();
      this.performanceWorker = null;
    }
    
    // Clear intervals
    if (this.memoryMonitorInterval) {
      clearInterval(this.memoryMonitorInterval);
      this.memoryMonitorInterval = null;
    }
    
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
    
    // Clear data
    this.networkRequests = [];
    this.userActions = [];
    this.performanceCollector.paintTiming = [];
    this.performanceCollector.resourceTiming = [];
    this.performanceCollector.memoryUsage = [];
    
    this.isInitialized = false;
  }

  /**
   * Starts network request monitoring by intercepting fetch and XMLHttpRequest
   */
  private startNetworkMonitoring(): void {
    // Intercept fetch
    window.fetch = this.createFetchInterceptor();
    
    // Intercept XMLHttpRequest
    this.interceptXMLHttpRequest();
  }

  /**
   * Creates a fetch interceptor that monitors network requests
   * @returns Intercepted fetch function
   */
  private createFetchInterceptor(): typeof fetch {
    return async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const url = input instanceof URL ? input.href : 
                  typeof input === 'string' ? input : input.url;
      const method = init?.method || 'GET';
      const startTime = performance.now();
      
      const requestId = `fetch_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
      
      try {
        // Create network request entry
        const networkRequest: NetworkRequest = {
          url,
          method: method.toUpperCase(),
          status: 0,
          timestamp: new Date(),
          responseTime: 0,
          failed: false
        };
        
        // Store active request
        this.activeRequests.set(requestId, {
          request: networkRequest,
          startTime
        });
        
        // Make the actual request
        const response = await this.originalFetch(input, init);
        
        // Update request with response data
        networkRequest.status = response.status;
        networkRequest.responseTime = performance.now() - startTime;
        networkRequest.failed = !response.ok;
        
        // Add to collected requests
        this.addNetworkRequest(networkRequest);
        
        // Remove from active requests
        this.activeRequests.delete(requestId);
        
        return response;
        
      } catch (error) {
        // Handle failed request
        const activeRequest = this.activeRequests.get(requestId);
        if (activeRequest) {
          activeRequest.request.responseTime = performance.now() - startTime;
          activeRequest.request.failed = true;
          activeRequest.request.status = 0;
          
          this.addNetworkRequest(activeRequest.request);
          this.activeRequests.delete(requestId);
        }
        
        throw error;
      }
    };
  }

  /**
   * Intercepts XMLHttpRequest to monitor network requests
   */
  private interceptXMLHttpRequest(): void {
    const self = this;
    
    XMLHttpRequest.prototype.open = function(
      method: string,
      url: string | URL,
      async?: boolean,
      username?: string | null,
      password?: string | null
    ) {
      const urlString = typeof url === 'string' ? url : url.toString();
      const requestId = `xhr_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
      const startTime = performance.now();
      
      // Store request information on the XHR object
      (this as any).__contextCollector = {
        requestId,
        startTime,
        url: urlString,
        method: method.toUpperCase()
      };
      
      // Set up event listeners for this request
      this.addEventListener('loadend', function() {
        const requestInfo = (this as any).__contextCollector;
        if (requestInfo && self.isMonitoring) {
          const networkRequest: NetworkRequest = {
            url: requestInfo.url,
            method: requestInfo.method,
            status: this.status,
            timestamp: new Date(Date.now() - (performance.now() - requestInfo.startTime)),
            responseTime: performance.now() - requestInfo.startTime,
            failed: this.status === 0 || this.status >= 400
          };
          
          self.addNetworkRequest(networkRequest);
        }
      });
      
      // Call original method
      return self.originalXHROpen.call(this, method, url, async ?? true, username, password);
    };
    
    XMLHttpRequest.prototype.send = function(body?: XMLHttpRequestBodyInit | null) {
      // Call original method
      return self.originalXHRSend.call(this, body);
    };
  }

  /**
   * Adds a network request to the collection with size management
   * @param request - Network request to add
   */
  private addNetworkRequest(request: NetworkRequest): void {
    this.networkRequests.push(request);
    
    // Maintain maximum size
    if (this.networkRequests.length > this.config.maxNetworkRequests) {
      this.networkRequests.shift(); // Remove oldest request
    }
  }

  /**
   * Starts user action tracking
   */
  private startUserActionTracking(): void {
    // Track click events
    this.addEventListener(document, 'click', (event: Event) => {
      this.trackUserAction('click', event as MouseEvent);
    }, { passive: true });
    
    // Track scroll events (throttled)
    let scrollTimeout: NodeJS.Timeout | null = null;
    this.addEventListener(window, 'scroll', () => {
      if (scrollTimeout) {
        clearTimeout(scrollTimeout);
      }
      scrollTimeout = setTimeout(() => {
        this.trackUserAction('scroll', {
          scrollX: window.scrollX,
          scrollY: window.scrollY
        });
      }, 100);
    }, { passive: true });
    
    // Track key presses (limited information for privacy)
    this.addEventListener(document, 'keydown', (event: Event) => {
      const keyEvent = event as KeyboardEvent;
      // Only track functional keys, not content
      if (keyEvent.key === 'Enter' || keyEvent.key === 'Escape' || keyEvent.key === 'Tab') {
        this.trackUserAction('keypress', {
          key: keyEvent.key,
          ctrlKey: keyEvent.ctrlKey,
          shiftKey: keyEvent.shiftKey,
          altKey: keyEvent.altKey
        });
      }
    }, { passive: true });
    
    // Track form submissions
    this.addEventListener(document, 'submit', (event: Event) => {
      this.trackUserAction('submit', event);
    }, { passive: true });
    
    // Track page visibility changes
    this.addEventListener(document, 'visibilitychange', () => {
      this.trackUserAction('visibility-change', {
        visibilityState: document.visibilityState
      });
    }, { passive: true });
  }

  /**
   * Tracks a user action with privacy-safe data collection
   * @param type - Action type
   * @param eventOrData - Event object or action data
   */
  private trackUserAction(type: string, eventOrData?: any): void {
    try {
      const action: UserAction = {
        type,
        target: { tagName: 'unknown' },
        timestamp: new Date()
      };
      
      // Extract safe information from events
      if (eventOrData && eventOrData.target) {
        const target = eventOrData.target as Element;
        action.target = {
          tagName: target.tagName || 'unknown'
        };

        if (target.id) {
          action.target.id = target.id;
        }

        if (target.className) {
          action.target.className = target.className;
        }

        const textContent = target.textContent?.substring(0, 50);
        if (textContent) {
          action.target.textContent = textContent;
        }
        
        // Add coordinates for click events
        if (type === 'click' && 'clientX' in eventOrData && 'clientY' in eventOrData) {
          action.coordinates = {
            x: eventOrData.clientX,
            y: eventOrData.clientY
          };
        }
      } else if (eventOrData) {
        // Non-event data
        action.metadata = eventOrData;
      }
      
      // Add to collection
      this.userActions.push(action);
      
      // Maintain maximum size
      if (this.userActions.length > this.config.maxUserActions) {
        this.userActions.shift(); // Remove oldest action
      }
      
    } catch (error) {
      // Silent error handling to prevent breaking user interactions
    }
  }

  /**
   * Starts viewport monitoring for responsive layout changes
   */
  private startViewportMonitoring(): void {
    let resizeTimeout: NodeJS.Timeout | null = null;
    
    this.addEventListener(window, 'resize', () => {
      if (resizeTimeout) {
        clearTimeout(resizeTimeout);
      }
      
      resizeTimeout = setTimeout(() => {
        if (this.initialContext) {
          this.initialContext.viewport = {
            width: window.innerWidth || 0,
            height: window.innerHeight || 0
          };
        }
      }, 100);
    }, { passive: true });
    
    // Monitor orientation changes on mobile
    this.addEventListener(window, 'orientationchange', () => {
      setTimeout(() => {
        if (this.initialContext) {
          this.initialContext.viewport = {
            width: window.innerWidth || 0,
            height: window.innerHeight || 0
          };
        }
      }, 500); // Wait for orientation change to complete
    }, { passive: true });
  }

  /**
   * Starts URL change monitoring for Single Page Applications
   */
  private startURLChangeMonitoring(): void {
    // Monitor pushState and replaceState for SPA navigation
    const originalPushState = history.pushState;
    const originalReplaceState = history.replaceState;
    
    history.pushState = (...args) => {
      originalPushState.apply(history, args);
      this.handleURLChange();
    };
    
    history.replaceState = (...args) => {
      originalReplaceState.apply(history, args);
      this.handleURLChange();
    };
    
    // Monitor popstate for back/forward navigation
    this.addEventListener(window, 'popstate', () => {
      this.handleURLChange();
    }, { passive: true });
    
    // Store original methods for restoration
    (this as any).__originalPushState = originalPushState;
    (this as any).__originalReplaceState = originalReplaceState;
  }

  /**
   * Handles URL change events
   */
  private handleURLChange(): void {
    if (this.initialContext) {
      const newURL = window.location.href;
      if (newURL !== this.initialContext.url) {
        this.initialContext.url = newURL;
        this.initialContext.title = document.title || this.initialContext.title;
        
        // Track navigation as user action
        this.trackUserAction('navigation', { url: newURL, title: document.title });
      }
    }
  }

  /**
   * Initializes performance monitoring systems
   */
  private initializePerformanceMonitoring(): void {
    try {
      // Initialize Performance Observer if available
      if ('PerformanceObserver' in window) {
        this.performanceCollector.observer = new PerformanceObserver((list) => {
          this.handlePerformanceEntries(list.getEntries());
        });
        
        // Observe different entry types
        const entryTypes = ['navigation', 'paint', 'resource', 'largest-contentful-paint'];
        for (const entryType of entryTypes) {
          try {
            this.performanceCollector.observer.observe({ entryTypes: [entryType] });
          } catch {
            // Entry type not supported, continue with others
          }
        }
      }
      
      // Collect navigation timing if available
      if ('performance' in window && window.performance.getEntriesByType) {
        const navEntries = window.performance.getEntriesByType('navigation');
        if (navEntries.length > 0) {
          this.performanceCollector.navigationTiming = navEntries[0] as PerformanceNavigationTiming;
        }
      }
      
    } catch (error) {
      // Performance monitoring not available
    }
  }

  /**
   * Handles performance entries from the Performance Observer
   * @param entries - Performance entries
   */
  private handlePerformanceEntries(entries: PerformanceEntry[]): void {
    for (const entry of entries) {
      switch (entry.entryType) {
        case 'paint':
          this.performanceCollector.paintTiming.push(entry);
          break;
        case 'resource':
          this.performanceCollector.resourceTiming.push(entry as PerformanceResourceTiming);
          // Limit resource timing entries
          if (this.performanceCollector.resourceTiming.length > 200) {
            this.performanceCollector.resourceTiming.splice(0, 50);
          }
          break;
        case 'largest-contentful-paint':
          // Store the latest LCP entry
          this.performanceCollector.paintTiming = this.performanceCollector.paintTiming
            .filter(e => e.entryType !== 'largest-contentful-paint');
          this.performanceCollector.paintTiming.push(entry);
          break;
      }
    }
  }

  /**
   * Collects current performance metrics
   * @returns Promise that resolves to performance metrics
   */
  private async collectPerformanceMetrics(): Promise<PerformanceMetrics> {
    const metrics: PerformanceMetrics = {};
    
    try {
      // Get paint timing metrics
      for (const entry of this.performanceCollector.paintTiming) {
        switch (entry.name) {
          case 'first-contentful-paint':
            metrics.fcp = entry.startTime;
            break;
          case 'largest-contentful-paint':
            metrics.lcp = entry.startTime;
            break;
        }
      }
      
      // Get navigation timing metrics
      if (this.performanceCollector.navigationTiming) {
        const nav = this.performanceCollector.navigationTiming;
        metrics.tti = nav.domInteractive - (nav.fetchStart || 0);
      }
      
      // Get memory metrics
      if ('memory' in performance && (performance as any).memory) {
        const memory = (performance as any).memory;
        metrics.memory = {
          used: memory.usedJSHeapSize,
          total: memory.totalJSHeapSize
        };
      } else if (this.performanceCollector.memoryUsage.length > 0) {
        const latestMemory = this.performanceCollector.memoryUsage[this.performanceCollector.memoryUsage.length - 1];
        if (latestMemory) {
          metrics.memory = {
            used: latestMemory.usage,
            total: latestMemory.usage * 2 // Estimate
          };
        }
      }
      
      // Calculate CLS if available
      if (this.performanceCollector.resourceTiming.length > 0) {
        // CLS calculation is complex, simplified here
        metrics.cls = 0; // Would need layout shift entries
      }
      
      // Calculate FID if available
      if (this.userActions.some(action => ['click', 'keypress'].includes(action.type))) {
        metrics.fid = 0; // Would need first input delay measurement
      }
      
    } catch (error) {
      // Performance metrics collection failed, return partial metrics
    }
    
    return metrics;
  }

  /**
   * Gets collected network requests
   * @returns Array of network requests
   */
  private getNetworkRequests(): NetworkRequest[] {
    return [...this.networkRequests];
  }

  /**
   * Starts memory monitoring
   */
  private startMemoryMonitoring(): void {
    this.memoryMonitorInterval = setInterval(() => {
      try {
        if ('memory' in performance && (performance as any).memory) {
          const memory = (performance as any).memory;
          this.performanceCollector.memoryUsage.push({
            timestamp: new Date(),
            usage: memory.usedJSHeapSize
          });
          
          // Limit memory usage history
          if (this.performanceCollector.memoryUsage.length > 100) {
            this.performanceCollector.memoryUsage.splice(0, 20);
          }
        }
      } catch {
        // Memory monitoring failed, continue silently
      }
    }, 10000); // Every 10 seconds
  }

  /**
   * Starts periodic cleanup of old data
   */
  private startPeriodicCleanup(): void {
    this.cleanupInterval = setInterval(() => {
      this.performCleanup();
    }, 60000); // Every minute
  }

  /**
   * Performs cleanup of old data to prevent memory leaks
   */
  private performCleanup(): void {
    const now = Date.now();
    const maxAge = 5 * 60 * 1000; // 5 minutes
    
    // Clean old user actions
    this.userActions = this.userActions.filter(
      action => now - action.timestamp.getTime() < maxAge
    );
    
    // Clean old network requests
    this.networkRequests = this.networkRequests.filter(
      request => now - request.timestamp.getTime() < maxAge
    );
    
    // Clean old memory usage data
    this.performanceCollector.memoryUsage = this.performanceCollector.memoryUsage.filter(
      entry => now - entry.timestamp.getTime() < maxAge
    );
  }

  /**
   * Checks if Web Worker support is available
   * @returns True if Web Workers are supported
   */
  private checkWebWorkerSupport(): boolean {
    try {
      return typeof Worker !== 'undefined' && typeof Blob !== 'undefined';
    } catch {
      return false;
    }
  }

  /**
   * Initializes Web Worker for performance-intensive operations
   * @returns Promise that resolves when worker is initialized
   */
  private async initializePerformanceWorker(): Promise<void> {
    if (!this.workerSupported) {
      return;
    }

    try {
      // Create worker code as blob for CSP compatibility
      const workerCode = `
        self.onmessage = function(e) {
          const { type, data } = e.data;
          
          switch (type) {
            case 'calculateMetrics':
              // Perform heavy metric calculations
              const result = performMetricCalculations(data);
              self.postMessage({ type: 'metricsResult', data: result });
              break;
              
            case 'processNetworkData':
              // Process network request data
              const processed = processNetworkRequests(data);
              self.postMessage({ type: 'networkProcessed', data: processed });
              break;
              
            default:
              self.postMessage({ type: 'error', data: 'Unknown message type' });
          }
        };
        
        function performMetricCalculations(data) {
          // Placeholder for complex metric calculations
          return { processed: true, timestamp: Date.now() };
        }
        
        function processNetworkRequests(data) {
          // Placeholder for network data processing
          return { processed: data.length, timestamp: Date.now() };
        }
      `;
      
      const blob = new Blob([workerCode], { type: 'application/javascript' });
      this.performanceWorker = new Worker(URL.createObjectURL(blob));
      
      // Handle worker messages
      this.performanceWorker.onmessage = (event) => {
        this.handleWorkerMessage(event.data);
      };
      
      this.performanceWorker.onerror = (error) => {
        console.warn('Performance worker error:', error);
        this.performanceWorker?.terminate();
        this.performanceWorker = null;
      };
      
    } catch (error) {
      this.workerSupported = false;
    }
  }

  /**
   * Handles messages from the performance worker
   * @param data - Message data from worker
   */
  private handleWorkerMessage(data: any): void {
    switch (data.type) {
      case 'metricsResult':
        // Handle processed metrics
        break;
      case 'networkProcessed':
        // Handle processed network data
        break;
      case 'error':
        console.warn('Worker error:', data.data);
        break;
    }
  }

  /**
   * Stops performance monitoring
   */
  private stopPerformanceMonitoring(): void {
    if (this.performanceCollector.observer) {
      this.performanceCollector.observer.disconnect();
      delete this.performanceCollector.observer;
    }
  }

  /**
   * Restores original network methods
   */
  private restoreNetworkMethods(): void {
    try {
      window.fetch = this.originalFetch;
      XMLHttpRequest.prototype.open = this.originalXHROpen;
      XMLHttpRequest.prototype.send = this.originalXHRSend;
      
      // Restore history methods if they were overridden
      if ((this as any).__originalPushState) {
        history.pushState = (this as any).__originalPushState;
      }
      if ((this as any).__originalReplaceState) {
        history.replaceState = (this as any).__originalReplaceState;
      }
    } catch {
      // Restoration failed, but continue to avoid breaking the application
    }
  }

  /**
   * Adds an event listener with cleanup tracking
   * @param target - Event target
   * @param event - Event name
   * @param handler - Event handler
   * @param options - Event listener options
   */
  private addEventListener(
    target: EventTarget,
    event: string,
    handler: EventListener,
    options?: AddEventListenerOptions
  ): void {
    target.addEventListener(event, handler, options);
    this.eventListeners.push({ target, event, handler, options: options || {} });
  }

  /**
   * Removes all tracked event listeners
   */
  private removeAllEventListeners(): void {
    for (const listener of this.eventListeners) {
      try {
        listener.target.removeEventListener(listener.event, listener.handler, listener.options);
      } catch {
        // Failed to remove listener, continue with others
      }
    }
    this.eventListeners = [];
  }

  /**
   * Detects browser version information
   * @returns Browser version string
   */
  private detectBrowserVersion(): string {
    const userAgent = navigator.userAgent;
    
    // Simple browser detection
    if (userAgent.includes('Chrome/')) {
      const match = userAgent.match(/Chrome\/(\d+\.\d+)/);
      return match ? `Chrome ${match[1]}` : 'Chrome Unknown';
    } else if (userAgent.includes('Firefox/')) {
      const match = userAgent.match(/Firefox\/(\d+\.\d+)/);
      return match ? `Firefox ${match[1]}` : 'Firefox Unknown';
    } else if (userAgent.includes('Safari/')) {
      const match = userAgent.match(/Version\/(\d+\.\d+)/);
      return match ? `Safari ${match[1]}` : 'Safari Unknown';
    } else if (userAgent.includes('Edge/')) {
      const match = userAgent.match(/Edge\/(\d+\.\d+)/);
      return match ? `Edge ${match[1]}` : 'Edge Unknown';
    }
    
    return 'Unknown Browser';
  }

  /**
   * Gets extension version from manifest
   * @returns Promise that resolves to extension version
   */
  private async getExtensionVersion(): Promise<string> {
    try {
      // Try to get version from chrome extension API
      if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.getManifest) {
        const manifest = chrome.runtime.getManifest();
        return manifest.version || '1.0.0';
      }
      
      // Try to get version from package.json via fetch (if available)
      if (typeof fetch !== 'undefined') {
        try {
          const response = await fetch('/package.json');
          const packageJson = await response.json();
          return packageJson.version || '1.0.0';
        } catch {
          // Package.json not accessible
        }
      }
      
      return '1.0.0'; // Fallback version
    } catch {
      return '1.0.0';
    }
  }
}