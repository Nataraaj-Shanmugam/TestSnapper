// FILE: src/injected.js  
// Page context network capture hook - injected into main world to intercept fetch/XHR

console.log('[TestSnapper Injected] Network capture hook loading...');

/////////////////////////////
// Network Capture Setup    //
/////////////////////////////

function uuid() {
  return Date.now().toString(16) + '-' + Math.random().toString(36).slice(2, 8);
}

function sanitizeHeaders(headers) {
  const result = [];
  if (headers instanceof Headers) {
    for (const [name, value] of headers.entries()) {
      result.push({ name, value: String(value).slice(0, 500) });
    }
  } else if (headers && typeof headers === 'object') {
    for (const [name, value] of Object.entries(headers)) {
      result.push({ name, value: String(value).slice(0, 500) });
    }
  }
  return result;
}

function postNetworkEvent(net) {
  try {
    window.postMessage({
      source: 'testsnapper-injected',
      type: 'NETWORK_EVENT',
      net: net
    }, '*');
  } catch (error) {
    console.warn('[TestSnapper Injected] Failed to post network event:', error);
  }
}

/////////////////////////////
// Fetch API Hook          //
/////////////////////////////

const originalFetch = window.fetch;

window.fetch = async function(resource, init = {}) {
  const requestId = uuid();
  const startTime = performance.now();
  const requestTimestamp = Date.now();
  
  let url, method = 'GET', headers = [];
  
  try {
    // Parse request details
    if (typeof resource === 'string') {
      url = resource;
    } else if (resource instanceof Request) {
      url = resource.url;
      method = resource.method;
      headers = sanitizeHeaders(resource.headers);
    } else {
      url = String(resource);
    }
    
    if (init.method) method = init.method;
    if (init.headers) headers = sanitizeHeaders(init.headers);
    
    // Create base network event
    const netEvent = {
      id: requestId,
      ts: requestTimestamp,
      method: method.toUpperCase(),
      url: url,
      requestHeaders: headers,
      requestBody: null, // Don't capture body content for privacy
      type: 'fetch'
    };
    
    try {
      // Make the actual request
      const response = await originalFetch(resource, init);
      const endTime = performance.now();
      
      // Capture response details
      netEvent.status = response.status;
      netEvent.statusText = response.statusText;
      netEvent.responseHeaders = sanitizeHeaders(response.headers);
      netEvent.time = endTime - startTime;
      netEvent.wait = netEvent.time; // Simplified timing
      netEvent.receive = 0;
      
      // Determine content type
      const contentType = response.headers.get('content-type') || '';
      netEvent.mimeType = contentType.split(';')[0].trim();
      
      // Post the network event
      postNetworkEvent(netEvent);
      
      return response;
      
    } catch (networkError) {
      const endTime = performance.now();
      
      // Capture error details
      netEvent.status = 0;
      netEvent.statusText = 'Network Error';
      netEvent.responseHeaders = [];
      netEvent.time = endTime - startTime;
      netEvent.error = String(networkError.message || networkError);
      
      // Post the failed network event
      postNetworkEvent(netEvent);
      
      throw networkError;
    }
    
  } catch (error) {
    console.warn('[TestSnapper Injected] Fetch hook error:', error);
    // Fall back to original fetch
    return originalFetch(resource, init);
  }
};

/////////////////////////////
// XMLHttpRequest Hook      //
/////////////////////////////

const OriginalXHR = window.XMLHttpRequest;

window.XMLHttpRequest = function() {
  const xhr = new OriginalXHR();
  const requestId = uuid();
  let startTime, requestTimestamp;
  let method = 'GET', url = '', requestHeaders = [];
  
  // Hook open method
  const originalOpen = xhr.open;
  xhr.open = function(m, u, ...args) {
    method = (m || 'GET').toUpperCase();
    url = u || '';
    requestHeaders = [];
    return originalOpen.apply(this, [m, u, ...args]);
  };
  
  // Hook setRequestHeader
  const originalSetHeader = xhr.setRequestHeader;
  xhr.setRequestHeader = function(name, value) {
    requestHeaders.push({ name, value: String(value).slice(0, 500) });
    return originalSetHeader.apply(this, arguments);
  };
  
  // Hook send method
  const originalSend = xhr.send;
  xhr.send = function(data) {
    startTime = performance.now();
    requestTimestamp = Date.now();
    
    const netEvent = {
      id: requestId,
      ts: requestTimestamp,
      method: method,
      url: url,
      requestHeaders: [...requestHeaders],
      requestBody: null, // Don't capture body for privacy
      type: 'xhr'
    };
    
    // Set up response handlers
    const originalOnReadyStateChange = xhr.onreadystatechange;
    xhr.onreadystatechange = function() {
      if (xhr.readyState === 4) { // DONE
        const endTime = performance.now();
        
        // Capture response details
        netEvent.status = xhr.status;
        netEvent.statusText = xhr.statusText;
        netEvent.time = endTime - startTime;
        netEvent.wait = netEvent.time;
        netEvent.receive = 0;
        
        // Get response headers
        try {
          const headerText = xhr.getAllResponseHeaders();
          netEvent.responseHeaders = [];
          if (headerText) {
            headerText.split('\r\n').forEach(line => {
              const colonIndex = line.indexOf(':');
              if (colonIndex > 0) {
                const name = line.slice(0, colonIndex).trim();
                const value = line.slice(colonIndex + 1).trim();
                netEvent.responseHeaders.push({ name, value: value.slice(0, 500) });
              }
            });
          }
        } catch (e) {
          netEvent.responseHeaders = [];
        }
        
        // Determine content type
        const contentType = xhr.getResponseHeader('content-type') || '';
        netEvent.mimeType = contentType.split(';')[0].trim();
        
        // Post the network event
        postNetworkEvent(netEvent);
      }
      
      // Call original handler if it exists
      if (originalOnReadyStateChange) {
        return originalOnReadyStateChange.apply(this, arguments);
      }
    };
    
    // Handle errors
    const originalOnError = xhr.onerror;
    xhr.onerror = function() {
      const endTime = performance.now();
      netEvent.status = 0;
      netEvent.statusText = 'Network Error';
      netEvent.time = endTime - startTime;
      netEvent.error = 'XHR Error';
      netEvent.responseHeaders = [];
      
      postNetworkEvent(netEvent);
      
      if (originalOnError) {
        return originalOnError.apply(this, arguments);
      }
    };
    
    return originalSend.apply(this, arguments);
  };
  
  return xhr;
};

// Copy static properties
Object.defineProperty(window.XMLHttpRequest, 'UNSENT', { value: 0, writable: false });
Object.defineProperty(window.XMLHttpRequest, 'OPENED', { value: 1, writable: false });
Object.defineProperty(window.XMLHttpRequest, 'HEADERS_RECEIVED', { value: 2, writable: false });
Object.defineProperty(window.XMLHttpRequest, 'LOADING', { value: 3, writable: false });
Object.defineProperty(window.XMLHttpRequest, 'DONE', { value: 4, writable: false });

/////////////////////////////
// Navigation Detection     //
/////////////////////////////

// Detect programmatic navigation that might not be caught by content script
const originalAssign = window.location.assign;
const originalReplace = window.location.replace;

if (originalAssign) {
  window.location.assign = function(url) {
    console.log('[TestSnapper Injected] Location.assign detected:', url);
    return originalAssign.call(this, url);
  };
}

if (originalReplace) {
  window.location.replace = function(url) {
    console.log('[TestSnapper Injected] Location.replace detected:', url);
    return originalReplace.call(this, url);
  };
}

/////////////////////////////
// Error Tracking           //
/////////////////////////////

// Track JavaScript errors that might affect test reliability
window.addEventListener('error', (event) => {
  try {
    postNetworkEvent({
      id: uuid(),
      ts: Date.now(),
      type: 'js_error',
      error: event.error?.message || event.message || 'Unknown error',
      filename: event.filename || '',
      lineno: event.lineno || 0,
      colno: event.colno || 0,
      stack: event.error?.stack || ''
    });
  } catch (e) {
    console.warn('[TestSnapper Injected] Failed to post error event:', e);
  }
});

// Track unhandled promise rejections
window.addEventListener('unhandledrejection', (event) => {
  try {
    postNetworkEvent({
      id: uuid(),
      ts: Date.now(),
      type: 'promise_rejection',
      error: event.reason?.message || String(event.reason) || 'Unhandled promise rejection',
      stack: event.reason?.stack || ''
    });
  } catch (e) {
    console.warn('[TestSnapper Injected] Failed to post rejection event:', e);
  }
});

/////////////////////////////
// Performance Tracking     //
/////////////////////////////

// Track long tasks that might affect test timing
if ('PerformanceObserver' in window) {
  try {
    const observer = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        if (entry.duration > 50) { // Long task threshold
          postNetworkEvent({
            id: uuid(),
            ts: Date.now(),
            type: 'performance',
            name: entry.name,
            duration: entry.duration,
            startTime: entry.startTime
          });
        }
      }
    });
    
    observer.observe({ entryTypes: ['longtask'] });
  } catch (e) {
    console.warn('[TestSnapper Injected] Performance observer setup failed:', e);
  }
}

/////////////////////////////
// Console Integration      //
/////////////////////////////

// Hook console.error to track application errors
const originalConsoleError = console.error;
console.error = function(...args) {
  try {
    const message = args.map(arg => 
      typeof arg === 'object' ? JSON.stringify(arg) : String(arg)
    ).join(' ');
    
    postNetworkEvent({
      id: uuid(),
      ts: Date.now(),
      type: 'console_error',
      message: message.slice(0, 1000) // Limit message length
    });
  } catch (e) {
    // Ignore errors in error logging to avoid recursion
  }
  
  return originalConsoleError.apply(this, arguments);
};

console.log('[TestSnapper Injected] Network capture hooks installed successfully');
console.log('[TestSnapper Injected] Monitoring fetch, XMLHttpRequest, errors, and performance');