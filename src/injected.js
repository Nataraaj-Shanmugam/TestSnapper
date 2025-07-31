// Injected script for deep DOM access and advanced recording with pause/resume support
(function() {
  'use strict';
  
  class TestSnapperInjected {
    constructor() {
      this.isRecording = false;
      this.isPaused = false;
      this.originalConsole = null;
      this.originalFetch = null;
      this.originalXHR = null;
      this.recentLogs = [];
      this.maxLogs = 100;
      this.recordingStartTime = null;
      this.pauseStartTime = null;
      this.totalPausedTime = 0;
      this.init();
    }

    init() {
      window.addEventListener('message', (event) => {
        if (event.source !== window) return;
        if (event.data.source !== 'testsnapper-content') return;
        this.handleMessage(event.data);
      });

      // Listen for recording status changes
      this.setupRecordingStatusListener();
    }

    setupRecordingStatusListener() {
      // Check initial status
      this.postMessage({
        type: 'GET_RECORDING_STATUS'
      });
    }

    handleMessage(message) {
      console.log('Injected script received message:', message.type);

      switch (message.type) {
        case 'START_ADVANCED_RECORDING':
          this.startAdvancedRecording(message.data);
          break;
        case 'PAUSE_ADVANCED_RECORDING':
          this.pauseAdvancedRecording();
          break;
        case 'RESUME_ADVANCED_RECORDING':
          this.resumeAdvancedRecording();
          break;
        case 'STOP_ADVANCED_RECORDING':
          this.stopAdvancedRecording();
          break;
        case 'CAPTURE_CONSOLE_LOGS':
          this.captureConsoleLogs();
          break;
        case 'CAPTURE_PERFORMANCE_DATA':
          this.capturePerformanceData();
          break;
        case 'INJECT_SCREENSHOT_HOTKEY':
          this.setupScreenshotHotkey();
          break;
        case 'RECORDING_STATUS_UPDATE':
          this.updateRecordingStatus(message.data);
          break;
        case 'FORCE_SCREENSHOT':
          // Allow screenshot even when paused
          this.handleForceScreenshot();
          break;
        case 'FORCE_STOP':
          // Allow stop even when paused
          this.handleForceStop();
          break;
      }
    }

    handleForceScreenshot() {
      // Send screenshot request regardless of pause state
      this.postMessage({
        type: 'FORCE_SCREENSHOT_REQUEST',
        data: {
          timestamp: Date.now(),
          relativeTime: this.getActiveRecordingTime(),
          url: window.location.href,
          paused: this.isPaused
        }
      });
    }

    handleForceStop() {
      // Force stop regardless of current state
      this.postMessage({
        type: 'FORCE_STOP_REQUEST',
        data: {
          timestamp: Date.now(),
          relativeTime: this.getActiveRecordingTime(),
          url: window.location.href,
          paused: this.isPaused
        }
      });
    }

    updateRecordingStatus(status) {
      const wasRecording = this.isRecording;
      const wasPaused = this.isPaused;

      this.isRecording = status.isRecording;
      this.isPaused = status.isPaused;
      this.recordingStartTime = status.startTime;
      this.totalPausedTime = status.totalPausedTime || 0;

      console.log('Recording status updated:', {
        isRecording: this.isRecording,
        isPaused: this.isPaused,
        wasRecording,
        wasPaused
      });

      // Handle state transitions
      if (!wasRecording && this.isRecording) {
        this.startAdvancedRecording();
      } else if (wasRecording && !this.isRecording) {
        this.stopAdvancedRecording();
      } else if (this.isRecording && !wasPaused && this.isPaused) {
        this.pauseAdvancedRecording();
      } else if (this.isRecording && wasPaused && !this.isPaused) {
        this.resumeAdvancedRecording();
      }
    }

    startAdvancedRecording(options = {}) {
      console.log('Starting advanced recording...');
      
      this.isRecording = true;
      this.isPaused = false;
      this.recordingStartTime = Date.now();
      this.recentLogs = [];
      
      this.interceptConsoleLogs();
      this.interceptNetworkCalls();
      this.interceptErrors();
      this.monitorPerformance();
      
      if (options.enableScreenshotHotkey !== false) {
        this.setupScreenshotHotkey();
      }

      this.postMessage({
        type: 'ADVANCED_RECORDING_STARTED',
        data: {
          timestamp: Date.now(),
          userAgent: navigator.userAgent,
          url: window.location.href
        }
      });

      console.log('Advanced recording started');
    }

    pauseAdvancedRecording() {
      if (!this.isRecording || this.isPaused) {
        console.log('Cannot pause: not recording or already paused');
        return;
      }

      console.log('Pausing advanced recording...');
      
      this.isPaused = true;
      this.pauseStartTime = Date.now();

      // Keep interceptors active but mark as paused
      // This allows screenshots and stops to work even when paused

      this.postMessage({
        type: 'ADVANCED_RECORDING_PAUSED',
        data: {
          timestamp: Date.now(),
          activeTime: this.getActiveRecordingTime()
        }
      });

      console.log('Advanced recording paused - screenshots and stop still available');
    }

    resumeAdvancedRecording() {
      if (!this.isRecording || !this.isPaused) {
        console.log('Cannot resume: not recording or not paused');
        return;
      }

      console.log('Resuming advanced recording...');
      
      const resumeTime = Date.now();
      const pausedDuration = resumeTime - this.pauseStartTime;
      this.totalPausedTime += pausedDuration;
      this.isPaused = false;
      this.pauseStartTime = null;

      this.postMessage({
        type: 'ADVANCED_RECORDING_RESUMED',
        data: {
          timestamp: resumeTime,
          pausedDuration: pausedDuration,
          totalPausedTime: this.totalPausedTime,
          activeTime: this.getActiveRecordingTime()
        }
      });

      console.log('Advanced recording resumed after', pausedDuration, 'ms pause');
    }

    stopAdvancedRecording() {
      console.log('Stopping advanced recording...');
      
      // Calculate final timing if paused
      if (this.isPaused && this.pauseStartTime) {
        this.totalPausedTime += Date.now() - this.pauseStartTime;
      }

      this.isRecording = false;
      this.isPaused = false;
      
      this.restoreConsoleLogs();
      this.restoreNetworkCalls();
      this.restoreErrorHandling();
      this.removeScreenshotHotkey();

      this.postMessage({
        type: 'ADVANCED_RECORDING_STOPPED',
        data: {
          timestamp: Date.now(),
          totalDuration: Date.now() - this.recordingStartTime,
          activeDuration: this.getActiveRecordingTime(),
          totalPausedTime: this.totalPausedTime,
          finalLogs: this.recentLogs.slice(-10) // Last 10 logs
        }
      });

      // Reset timing variables
      this.recordingStartTime = null;
      this.pauseStartTime = null;
      this.totalPausedTime = 0;
      this.recentLogs = [];

      console.log('Advanced recording stopped');
    }

    getActiveRecordingTime() {
      if (!this.recordingStartTime) return 0;
      
      const currentTime = Date.now();
      const totalTime = currentTime - this.recordingStartTime;
      let pausedTime = this.totalPausedTime;
      
      // If currently paused, add current pause duration
      if (this.isPaused && this.pauseStartTime) {
        pausedTime += currentTime - this.pauseStartTime;
      }
      
      return Math.max(0, totalTime - pausedTime);
    }

    interceptConsoleLogs() {
      if (this.originalConsole) return; // Already intercepted

      this.originalConsole = {
        log: console.log,
        error: console.error,
        warn: console.warn,
        info: console.info,
        debug: console.debug
      };

      const self = this;
      ['log', 'error', 'warn', 'info', 'debug'].forEach(method => {
        console[method] = function(...args) {
          // Always call original to maintain normal console behavior
          self.originalConsole[method].apply(console, args);
          
          // Only record if we're actively recording (not paused)
          if (self.isRecording && !self.isPaused) {
            const logEntry = {
              level: method,
              message: args.map(arg => {
                if (typeof arg === 'object') {
                  try {
                    return JSON.stringify(arg, null, 2);
                  } catch (e) {
                    return String(arg);
                  }
                } else {
                  return String(arg);
                }
              }).join(' '),
              timestamp: Date.now(),
              relativeTime: self.getActiveRecordingTime(),
              stack: method === 'error' ? new Error().stack : null
            };

            // Store in recent logs
            self.recentLogs.push(logEntry);
            if (self.recentLogs.length > self.maxLogs) {
              self.recentLogs.shift();
            }

            // Send to content script
            self.postMessage({
              type: 'CONSOLE_LOG',
              data: logEntry
            });
          }
        };
      });

      console.log('Console logging intercepted');
    }

    restoreConsoleLogs() {
      if (this.originalConsole) {
        Object.keys(this.originalConsole).forEach(method => {
          console[method] = this.originalConsole[method];
        });
        this.originalConsole = null;
        console.log('Console logging restored');
      }
    }

    interceptNetworkCalls() {
      this.interceptFetch();
      this.interceptXHR();
    }

    interceptFetch() {
      if (this.originalFetch) return; // Already intercepted

      this.originalFetch = window.fetch;
      const self = this;

      window.fetch = function(...args) {
        const startTime = Date.now();
        const url = args[0];
        const options = args[1] || {};
        const method = options.method || 'GET';

        // Only record if we're actively recording (not paused)
        const shouldRecord = self.isRecording && !self.isPaused;

        return self.originalFetch.apply(this, args)
          .then(response => {
            if (shouldRecord) {
              const endTime = Date.now();
              self.postMessage({
                type: 'NETWORK_CALL',
                data: {
                  type: 'fetch',
                  url: String(url),
                  method: method,
                  status: response.status,
                  statusText: response.statusText,
                  startTime: startTime,
                  endTime: endTime,
                  duration: endTime - startTime,
                  relativeTime: self.getActiveRecordingTime(),
                  headers: Object.fromEntries(response.headers.entries()),
                  success: response.ok
                }
              });
            }
            return response;
          })
          .catch(error => {
            if (shouldRecord) {
              const endTime = Date.now();
              self.postMessage({
                type: 'NETWORK_ERROR',
                data: {
                  type: 'fetch',
                  url: String(url),
                  method: method,
                  error: error.message,
                  startTime: startTime,
                  endTime: endTime,
                  duration: endTime - startTime,
                  relativeTime: self.getActiveRecordingTime()
                }
              });
            }
            throw error;
          });
      };

      console.log('Fetch intercepted');
    }

    interceptXHR() {
      if (this.originalXHR) return; // Already intercepted

      this.originalXHR = window.XMLHttpRequest;
      const self = this;

      window.XMLHttpRequest = function() {
        const xhr = new self.originalXHR();
        const originalOpen = xhr.open;
        const originalSend = xhr.send;
        
        let requestData = {
          method: '',
          url: '',
          startTime: 0
        };

        xhr.open = function(method, url, ...args) {
          requestData.method = method;
          requestData.url = url;
          return originalOpen.apply(this, [method, url, ...args]);
        };

        xhr.send = function(data) {
          requestData.startTime = Date.now();
          
          const originalOnReadyStateChange = this.onreadystatechange;
          this.onreadystatechange = function() {
            if (originalOnReadyStateChange) {
              originalOnReadyStateChange.apply(this, arguments);
            }
            
            if (this.readyState === 4 && self.isRecording && !self.isPaused) {
              const endTime = Date.now();
              const networkData = {
                type: 'xhr',
                url: requestData.url,
                method: requestData.method,
                status: this.status,
                statusText: this.statusText,
                startTime: requestData.startTime,
                endTime: endTime,
                duration: endTime - requestData.startTime,
                relativeTime: self.getActiveRecordingTime(),
                success: this.status >= 200 && this.status < 300
              };

              if (this.status === 0 || this.status >= 400) {
                self.postMessage({
                  type: 'NETWORK_ERROR',
                  data: { ...networkData, error: `HTTP ${this.status}` }
                });
              } else {
                self.postMessage({
                  type: 'NETWORK_CALL',
                  data: networkData
                });
              }
            }
          };
          
          return originalSend.apply(this, arguments);
        };

        return xhr;
      };

      console.log('XMLHttpRequest intercepted');
    }

    restoreNetworkCalls() {
      if (this.originalFetch) {
        window.fetch = this.originalFetch;
        this.originalFetch = null;
      }
      
      if (this.originalXHR) {
        window.XMLHttpRequest = this.originalXHR;
        this.originalXHR = null;
      }
      
      console.log('Network calls restored');
    }

    interceptErrors() {
      this.originalErrorHandler = window.onerror;
      this.originalUnhandledRejectionHandler = window.onunhandledrejection;

      const self = this;

      window.onerror = function(message, source, lineno, colno, error) {
        if (self.isRecording && !self.isPaused) {
          self.postMessage({
            type: 'JAVASCRIPT_ERROR',
            data: {
              message: message,
              source: source,
              line: lineno,
              column: colno,
              stack: error?.stack,
              timestamp: Date.now(),
              relativeTime: self.getActiveRecordingTime()
            }
          });
        }

        if (self.originalErrorHandler) {
          return self.originalErrorHandler.apply(this, arguments);
        }
      };

      window.onunhandledrejection = function(event) {
        if (self.isRecording && !self.isPaused) {
          self.postMessage({
            type: 'UNHANDLED_PROMISE_REJECTION',
            data: {
              reason: String(event.reason),
              stack: event.reason?.stack,
              timestamp: Date.now(),
              relativeTime: self.getActiveRecordingTime()
            }
          });
        }

        if (self.originalUnhandledRejectionHandler) {
          return self.originalUnhandledRejectionHandler.apply(this, arguments);
        }
      };

      console.log('Error handling intercepted');
    }

    restoreErrorHandling() {
      window.onerror = this.originalErrorHandler;
      window.onunhandledrejection = this.originalUnhandledRejectionHandler;
      console.log('Error handling restored');
    }

    monitorPerformance() {
      if (!window.performance) return;

      const self = this;
      
      // Monitor performance entries
      if (window.PerformanceObserver) {
        try {
          this.performanceObserver = new PerformanceObserver((list) => {
            if (!self.isRecording || self.isPaused) return;

            const entries = list.getEntries();
            entries.forEach(entry => {
              self.postMessage({
                type: 'PERFORMANCE_ENTRY',
                data: {
                  name: entry.name,
                  entryType: entry.entryType,
                  startTime: entry.startTime,
                  duration: entry.duration,
                  timestamp: Date.now(),
                  relativeTime: self.getActiveRecordingTime()
                }
              });
            });
          });

          this.performanceObserver.observe({ 
            entryTypes: ['navigation', 'resource', 'measure', 'mark'] 
          });

          console.log('Performance monitoring started');
        } catch (error) {
          console.warn('Performance monitoring not available:', error);
        }
      }
    }

    capturePerformanceData() {
      if (!window.performance) return;

      const perfData = {
        timing: performance.timing,
        navigation: performance.navigation,
        memory: performance.memory ? {
          usedJSHeapSize: performance.memory.usedJSHeapSize,
          totalJSHeapSize: performance.memory.totalJSHeapSize,
          jsHeapSizeLimit: performance.memory.jsHeapSizeLimit
        } : null,
        timestamp: Date.now(),
        relativeTime: this.getActiveRecordingTime()
      };

      this.postMessage({
        type: 'PERFORMANCE_DATA',
        data: perfData
      });
    }

    setupScreenshotHotkey() {
      if (this.screenshotKeyHandler) return; // Already set up

      this.screenshotKeyHandler = (event) => {
        // Ctrl+Shift+S (or Cmd+Shift+S on Mac)
        if ((event.ctrlKey || event.metaKey) && event.shiftKey && event.key === 'S') {
          event.preventDefault();
          
          // Allow screenshot even when paused if recording is active
          if (this.isRecording) {
            this.postMessage({
              type: 'HOTKEY_SCREENSHOT',
              data: {
                timestamp: Date.now(),
                relativeTime: this.getActiveRecordingTime(),
                url: window.location.href,
                paused: this.isPaused
              }
            });
          }
        }
      };

      document.addEventListener('keydown', this.screenshotKeyHandler, true);
      console.log('Screenshot hotkey enabled (Ctrl+Shift+S) - works even when paused');
    }

    removeScreenshotHotkey() {
      if (this.screenshotKeyHandler) {
        document.removeEventListener('keydown', this.screenshotKeyHandler, true);
        this.screenshotKeyHandler = null;
        console.log('Screenshot hotkey disabled');
      }
    }

    captureConsoleLogs() {
      this.postMessage({
        type: 'CONSOLE_LOGS_DUMP',
        data: {
          logs: this.recentLogs,
          timestamp: Date.now(),
          relativeTime: this.getActiveRecordingTime()
        }
      });
    }

    postMessage(data) {
      window.postMessage({
        source: 'testsnapper-injected',
        ...data
      }, '*');
    }
  }

  // Initialize injected functionality
  new TestSnapperInjected();
})();