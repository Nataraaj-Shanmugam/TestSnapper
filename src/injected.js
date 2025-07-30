// Injected script for deep DOM access and advanced recording
(function() {
  'use strict';
  class TestSnapperInjected {
    constructor() {
      this.isRecording = false;
      this.init();
    }
    init() {
      window.addEventListener('message', (event) => {
        if (event.source !== window) return;
        if (event.data.source !== 'testsnapper-content') return;
        this.handleMessage(event.data);
      });
    }
    handleMessage(message) {
      switch (message.type) {
        case 'START_ADVANCED_RECORDING':
          this.startAdvancedRecording();
          break;
        case 'STOP_ADVANCED_RECORDING':
          this.stopAdvancedRecording();
          break;
        case 'CAPTURE_CONSOLE_LOGS':
          this.captureConsoleLogs();
          break;
      }
    }
    startAdvancedRecording() {
      this.isRecording = true;
      this.interceptConsoleLogs();
      this.interceptNetworkCalls();
    }
    stopAdvancedRecording() {
      this.isRecording = false;
      this.restoreConsoleLogs();
      this.restoreNetworkCalls();
    }
    interceptConsoleLogs() {
      this.originalConsole = {
        log: console.log,
        error: console.error,
        warn: console.warn,
        info: console.info
      };
      const self = this;
      ['log', 'error', 'warn', 'info'].forEach(method => {
        console[method] = function(...args) {
          self.originalConsole[method].apply(console, args);
          if (self.isRecording) {
            window.postMessage({
              source: 'testsnapper-injected',
              type: 'CONSOLE_LOG',
              data: {
                level: method,
                message: args.map(arg => typeof arg === 'object' ? JSON.stringify(arg) : String(arg)).join(' '),
                timestamp: Date.now()
              }
            }, '*');
          }
        };
      });
    }
    restoreConsoleLogs() {
      if (this.originalConsole) {
        Object.keys(this.originalConsole).forEach(method => {
          console[method] = this.originalConsole[method];
        });
      }
    }
    interceptNetworkCalls() {
      this.originalFetch = window.fetch;
      const self = this;
      window.fetch = function(...args) {
        if (self.isRecording) {
          const startTime = Date.now();
          const url = args[0];
          const options = args[1] || {};
          return self.originalFetch.apply(this, args)
            .then(response => {
              window.postMessage({
                source: 'testsnapper-injected',
                type: 'NETWORK_CALL',
                data: {
                  url: url,
                  method: options.method || 'GET',
                  status: response.status,
                  statusText: response.statusText,
                  startTime: startTime,
                  endTime: Date.now(),
                  headers: Object.fromEntries(response.headers.entries())
                }
              }, '*');
              return response;
            })
            .catch(error => {
              window.postMessage({
                source: 'testsnapper-injected',
                type: 'NETWORK_ERROR',
                data: {
                  url: url,
                  method: options.method || 'GET',
                  error: error.message,
                  startTime: startTime,
                  endTime: Date.now()
                }
              }, '*');
              throw error;
            });
        }
        return self.originalFetch.apply(this, args);
      };
    }
    restoreNetworkCalls() {
      if (this.originalFetch) {
        window.fetch = this.originalFetch;
      }
    }
    captureConsoleLogs() {
      const logs = this.recentLogs || [];
      window.postMessage({
        source: 'testsnapper-injected',
        type: 'CONSOLE_LOGS_DUMP',
        data: logs
      }, '*');
    }
  }
  new TestSnapperInjected();
})();
