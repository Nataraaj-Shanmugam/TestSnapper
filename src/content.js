console.log('[TestSnapper Content] Enhanced content script loading...');

/////////////////////////////
// State & Configuration   //
/////////////////////////////

let recording = false;
let paused = false;
let currentSessionId = null;
let injectedNetworkHook = false;
let eventId = 0;

// Track attached listeners to avoid duplicates
let listenersAttached = false;
let navigationHooksSet = false;

// Scroll tracking
let lastScrollTop = 0;
let lastScrollLeft = 0;
let scrollDebounceTimer = null;

// Download tracking
let downloadEvents = new Set();

// Locator generation settings
const LOCATOR_STRATEGIES = ['data-testid', 'id', 'name', 'class', 'tag', 'text', 'xpath'];
const MAX_TEXT_LENGTH = 50;
const DEBOUNCE_DELAY = 300;
const SCROLL_DEBOUNCE_DELAY = 500;

/////////////////////////////
// Utility Functions        //
/////////////////////////////

function uuid() {
  return crypto?.randomUUID?.() || 
    `${Date.now().toString(16)}-${Math.random().toString(36).slice(2, 8)}`;
}

function debounce(func, delay) {
  let timeoutId;
  return function (...args) {
    clearTimeout(timeoutId);
    timeoutId = setTimeout(() => func.apply(this, args), delay);
  };
}

function sanitizeText(text) {
  if (!text) return '';
  return String(text)
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_TEXT_LENGTH);
}

function getElementText(element) {
  if (!element) return '';
  
  // For input elements, prefer placeholder or label text if no value
  if (element.tagName === 'INPUT' || element.tagName === 'TEXTAREA') {
    return element.value || element.placeholder || element.getAttribute('aria-label') || '';
  }
  
  // For other elements, get visible text
  const text = element.textContent || element.innerText || element.alt || element.title || '';
  return sanitizeText(text);
}

function getElementDescription(element, action) {
  const tag = element.tagName?.toLowerCase();
  const type = element.type?.toLowerCase();
  const text = getElementText(element);
  const role = element.getAttribute('role');
  
  // Generate human-readable descriptions based on element type and action
  if (action === 'click') {
    if (tag === 'button' || type === 'button' || role === 'button') {
      return text ? `Click "${text}" button` : 'Click button';
    }
    if (tag === 'a') {
      return text ? `Click "${text}" link` : `Navigate to ${element.href || 'link'}`;
    }
    if (type === 'checkbox') {
      const checked = element.checked ? 'Check' : 'Uncheck';
      return text ? `${checked} "${text}" checkbox` : `${checked} checkbox`;
    }
    if (type === 'radio') {
      return text ? `Select "${text}" radio option` : 'Select radio option';
    }
    if (type === 'submit') {
      return text ? `Submit form via "${text}"` : 'Submit form';
    }
    if (element.getAttribute('data-testid')) {
      return `Click ${element.getAttribute('data-testid')} element`;
    }
    return text ? `Click "${text}"` : `Click ${tag} element`;
  }
  
  if (action === 'type' || action === 'input') {
    const label = element.getAttribute('aria-label') || element.placeholder || '';
    if (type === 'password') {
      return label ? `Enter password in "${label}" field` : 'Enter password';
    }
    if (type === 'email') {
      return label ? `Enter email in "${label}" field` : 'Enter email address';
    }
    if (type === 'search') {
      return label ? `Search in "${label}" field` : 'Enter search term';
    }
    if (tag === 'textarea') {
      return label ? `Enter text in "${label}" area` : 'Enter multi-line text';
    }
    return label ? `Type in "${label}" field` : `Enter text in ${type || 'input'} field`;
  }
  
  if (action === 'select' || action === 'change') {
    if (tag === 'select') {
      const selectedText = element.options?.[element.selectedIndex]?.text || element.value;
      const label = element.getAttribute('aria-label') || element.name || '';
      return label ? `Select "${selectedText}" from "${label}" dropdown` : `Select "${selectedText}" from dropdown`;
    }
    if (type === 'checkbox') {
      const checked = element.checked ? 'Check' : 'Uncheck';
      return text ? `${checked} "${text}" option` : `${checked} checkbox`;
    }
    if (type === 'radio') {
      return text ? `Choose "${text}" option` : 'Select radio option';
    }
  }
  
  if (action === 'scroll') {
    return 'Scroll page';
  }
  
  if (action === 'navigate') {
    return `Navigate to new page: ${element.meta?.toUrl || window.location.href}`;
  }
  
  if (action === 'key') {
    const key = element.meta?.key;
    if (key === 'Enter') return 'Press Enter key';
    if (key === 'Tab') return 'Press Tab key';
    if (key === 'Escape') return 'Press Escape key';
    return `Press ${key} key`;
  }
  
  if (action === 'download') {
    return `Download file: ${element.meta?.filename || 'file'}`;
  }
  
  return `Perform ${action} action`;
}

/////////////////////////////
// Locator Generation       //
/////////////////////////////

function generateLocator(element) {
  if (!element || element === document || element === window) {
    return { raw: 'document', norm: 'document' };
  }

  const strategies = [];
  
  // Strategy 1: data-testid (most reliable)
  const testid = element.getAttribute('data-testid');
  if (testid) {
    strategies.push(`[data-testid="${testid}"]`);
  }

  // Strategy 2: ID (reliable if unique)
  if (element.id) {
    strategies.push(`#${element.id}`);
  }

  // Strategy 3: Name attribute (for forms)
  const name = element.getAttribute('name');
  if (name) {
    strategies.push(`[name="${name}"]`);
  }

  // Strategy 4: ARIA label (for accessibility)
  const ariaLabel = element.getAttribute('aria-label');
  if (ariaLabel) {
    strategies.push(`[aria-label="${ariaLabel}"]`);
  }

  // Strategy 5: Class-based (if not too generic)
  if (element.className && typeof element.className === 'string') {
    const classes = element.className.split(/\s+/).filter(c => 
      c.length > 2 && !c.match(/^(btn|button|link|item|text|input|form|container|wrapper|content|active|selected|hover|focus)$/i)
    );
    if (classes.length > 0 && classes.length <= 3) {
      strategies.push(`.${classes.join('.')}`);
    }
  }

  // Strategy 6: Tag with text (for buttons, links)
  const tag = element.tagName.toLowerCase();
  const text = getElementText(element);
  if (text && ['button', 'a', 'span', 'div', 'label', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6'].includes(tag)) {
    strategies.push(`${tag}:contains("${text.slice(0, 20)}")`);
  }

  // Strategy 7: CSS selector path (fallback)
  if (strategies.length === 0) {
    strategies.push(generateCSSPath(element));
  }

  // Use the most specific available strategy
  const locator = strategies[0] || tag;
  
  return {
    raw: locator,
    norm: normalizeLocator(locator)
  };
}

function generateCSSPath(element) {
  const path = [];
  let current = element;
  
  while (current && current !== document.body && path.length < 5) {
    let selector = current.tagName.toLowerCase();
    
    if (current.id) {
      selector += `#${current.id}`;
      path.unshift(selector);
      break;
    }
    
    if (current.className && typeof current.className === 'string') {
      const classes = current.className.split(/\s+/).filter(c => c.length > 0);
      if (classes.length > 0) {
        selector += `.${classes[0]}`;
      }
    }
    
    // Add nth-child if needed for specificity
    const parent = current.parentElement;
    if (parent) {
      const siblings = Array.from(parent.children).filter(el => el.tagName === current.tagName);
      if (siblings.length > 1) {
        const index = siblings.indexOf(current) + 1;
        selector += `:nth-child(${index})`;
      }
    }
    
    path.unshift(selector);
    current = current.parentElement;
  }
  
  return path.join(' > ');
}

function normalizeLocator(locator) {
  return locator
    .replace(/\s+/g, ' ')
    .replace(/["']/g, '')
    .replace(/\[\d+\]/g, '')
    .trim();
}

/////////////////////////////
// Event Detection          //
/////////////////////////////

function createStepFromEvent(eventType, element, extraData = {}) {
  const loc = generateLocator(element);
  const text = getElementText(element);
  
  const step = {
    id: uuid(),
    ts: Date.now(),
    action: eventType,
    name: eventType, // Legacy compatibility
    locator: loc.raw,
    locatorRaw: loc.raw,
    locatorNorm: loc.norm,
    description: getElementDescription(element, eventType), // Human-readable description
    element: {
      tagName: element.tagName?.toLowerCase() || 'unknown',
      text: text,
      value: element.value || '',
      type: element.type || '',
      href: element.href || '',
      role: element.getAttribute?.('role') || '',
      ariaLabel: element.getAttribute?.('aria-label') || '',
      placeholder: element.placeholder || ''
    },
    valueKind: determineValueKind(element, eventType),
    meta: {
      url: window.location.href,
      title: document.title,
      viewport: {
        width: window.innerWidth,
        height: window.innerHeight
      },
      userAgent: navigator.userAgent,
      timestamp: new Date().toISOString(),
      ...extraData
    }
  };

  return step;
}

function determineValueKind(element, eventType) {
  const tag = element.tagName?.toLowerCase();
  const type = element.type?.toLowerCase();
  
  if (eventType === 'type' || eventType === 'input') {
    if (type === 'password') return 'password';
    if (type === 'email') return 'email';
    if (type === 'number') return 'number';
    if (type === 'tel') return 'phone';
    if (type === 'url') return 'url';
    if (type === 'search') return 'search';
    if (type === 'date') return 'date';
    if (type === 'time') return 'time';
    if (tag === 'textarea') return 'text_multiline';
    return 'text';
  }
  
  if (eventType === 'click') {
    if (tag === 'button' || type === 'button') return 'button';
    if (tag === 'a') return 'link';
    if (type === 'checkbox') return 'checkbox';
    if (type === 'radio') return 'radio';
    if (type === 'submit') return 'submit';
    if (type === 'file') return 'file_upload';
    return 'click';
  }
  
  if (eventType === 'select' || eventType === 'change') {
    if (tag === 'select') return 'dropdown';
    if (type === 'checkbox') return 'checkbox';
    if (type === 'radio') return 'radio';
    if (type === 'file') return 'file_upload';
    return 'change';
  }
  
  if (eventType === 'scroll') return 'scroll';
  if (eventType === 'navigate') return 'navigation';
  if (eventType === 'download') return 'download';
  if (eventType === 'key') return 'keyboard';
  
  return 'none';
}

/////////////////////////////
// Event Handlers           //
/////////////////////////////

const debouncedSendStep = debounce((step) => {
  if (!recording || paused || !currentSessionId) return;
  
  console.log('[TestSnapper Content] Sending step:', step.description || step.action, step.locator);
  
  chrome.runtime.sendMessage({
    type: 'REC_EVENT',
    sessionId: currentSessionId,
    step: step
  }).catch(error => {
    console.warn('[TestSnapper Content] Failed to send step:', error);
  });
}, DEBOUNCE_DELAY);

function handleClick(event) {
  if (!recording || paused) return;
  
  const element = event.target;
  
  // Skip if clicking on scroll bars or outside content area
  if (element === document.documentElement || element === document.body) return;
  
  const step = createStepFromEvent('click', element, {
    button: event.button,
    ctrlKey: event.ctrlKey,
    shiftKey: event.shiftKey,
    altKey: event.altKey,
    coordinates: {
      x: event.clientX,
      y: event.clientY,
      pageX: event.pageX,
      pageY: event.pageY
    }
  });
  
  // Add better description based on context
  step.description = getElementDescription({ ...element, meta: step.meta }, 'click');
  
  debouncedSendStep(step);
}

function handleInput(event) {
  if (!recording || paused) return;
  
  const element = event.target;
  if (!['INPUT', 'TEXTAREA', 'SELECT'].includes(element.tagName)) return;
  
  const step = createStepFromEvent('type', element, {
    inputType: event.inputType,
    valueLength: (element.value || '').length,
    isComposition: event.isComposing || false
  });
  
  // Enhanced description for input events
  step.description = getElementDescription({ ...element, meta: step.meta }, 'type');
  
  // Don't debounce for password fields or short inputs - capture immediately
  if (element.type === 'password' || (element.value || '').length <= 3) {
    chrome.runtime.sendMessage({
      type: 'REC_EVENT',
      sessionId: currentSessionId,
      step: step
    }).catch(() => {});
  } else {
    debouncedSendStep(step);
  }
}

function handleChange(event) {
  if (!recording || paused) return;
  
  const element = event.target;
  const step = createStepFromEvent('change', element, {
    selectedValue: element.value,
    selectedIndex: element.selectedIndex,
    checked: element.checked,
    files: element.files ? Array.from(element.files).map(f => ({ name: f.name, size: f.size, type: f.type })) : null
  });
  
  step.description = getElementDescription({ ...element, meta: step.meta }, 'change');
  
  debouncedSendStep(step);
}

function handleKeyDown(event) {
  if (!recording || paused) return;
  
  // Capture important navigation and action keys
  const captureKeys = ['Enter', 'Tab', 'Escape', 'Backspace', 'Delete', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End', 'PageUp', 'PageDown'];
  
  if (captureKeys.includes(event.key)) {
    const step = createStepFromEvent('key', event.target, {
      key: event.key,
      code: event.code,
      ctrlKey: event.ctrlKey,
      shiftKey: event.shiftKey,
      altKey: event.altKey,
      metaKey: event.metaKey
    });
    
    // Enhanced key descriptions
    if (event.key === 'Enter') {
      step.description = event.target.tagName === 'TEXTAREA' ? 'Press Enter (new line)' : 'Press Enter to submit/confirm';
    } else if (event.key === 'Tab') {
      step.description = event.shiftKey ? 'Navigate to previous field (Shift+Tab)' : 'Navigate to next field (Tab)';
    } else if (event.key === 'Escape') {
      step.description = 'Press Escape to cancel/close';
    } else if (event.key.startsWith('Arrow')) {
      step.description = `Navigate using ${event.key.replace('Arrow', '')} arrow key`;
    } else {
      step.description = `Press ${event.key} key`;
    }
    
    debouncedSendStep(step);
  }
}

function handleScroll(event) {
  if (!recording || paused) return;
  
  const currentScrollTop = window.pageYOffset || document.documentElement.scrollTop;
  const currentScrollLeft = window.pageXOffset || document.documentElement.scrollLeft;
  
  // Only record significant scroll movements
  const scrollThreshold = 50;
  const verticalDiff = Math.abs(currentScrollTop - lastScrollTop);
  const horizontalDiff = Math.abs(currentScrollLeft - lastScrollLeft);
  
  if (verticalDiff < scrollThreshold && horizontalDiff < scrollThreshold) return;
  
  clearTimeout(scrollDebounceTimer);
  scrollDebounceTimer = setTimeout(() => {
    const element = event.target === document ? document.documentElement : event.target;
    const step = createStepFromEvent('scroll', element, {
      scrollTop: currentScrollTop,
      scrollLeft: currentScrollLeft,
      scrollHeight: document.documentElement.scrollHeight,
      scrollWidth: document.documentElement.scrollWidth,
      direction: {
        vertical: currentScrollTop > lastScrollTop ? 'down' : 'up',
        horizontal: currentScrollLeft > lastScrollLeft ? 'right' : 'left'
      },
      distance: {
        vertical: Math.abs(currentScrollTop - lastScrollTop),
        horizontal: Math.abs(currentScrollLeft - lastScrollLeft)
      }
    });
    
    // Enhanced scroll description
    const direction = currentScrollTop > lastScrollTop ? 'down' : 'up';
    const distance = Math.round(verticalDiff);
    step.description = `Scroll ${direction} ${distance}px on page`;
    
    lastScrollTop = currentScrollTop;
    lastScrollLeft = currentScrollLeft;
    
    chrome.runtime.sendMessage({
      type: 'REC_EVENT',
      sessionId: currentSessionId,
      step: step
    }).catch(() => {});
    
  }, SCROLL_DEBOUNCE_DELAY);
}

/////////////////////////////
// Download Detection       //
/////////////////////////////

function setupDownloadDetection() {
  // Monitor for download links
  document.addEventListener('click', (event) => {
    if (!recording || paused) return;
    
    const element = event.target;
    const href = element.href || element.closest('a')?.href;
    
    if (href && (element.download !== undefined || href.match(/\.(pdf|doc|docx|xls|xlsx|csv|txt|zip|rar|tar|gz)$/i))) {
      const filename = element.download || href.split('/').pop() || 'unknown';
      const downloadId = `${href}-${Date.now()}`;
      
      if (!downloadEvents.has(downloadId)) {
        downloadEvents.add(downloadId);
        
        setTimeout(() => downloadEvents.delete(downloadId), 5000); // Clean up after 5 seconds
        
        const step = createStepFromEvent('download', element, {
          filename: filename,
          url: href,
          fileType: filename.split('.').pop()?.toLowerCase() || 'unknown',
          downloadAttribute: element.download || null
        });
        
        step.description = `Download file "${filename}"`;
        
        chrome.runtime.sendMessage({
          type: 'REC_EVENT',
          sessionId: currentSessionId,
          step: step
        }).catch(() => {});
      }
    }
  }, true);
}

/////////////////////////////
// Navigation Tracking      //
/////////////////////////////

function captureNavigation(url, trigger = 'unknown') {
  if (!recording || paused) return;
  
  const step = createStepFromEvent('navigate', document.body || document.documentElement, {
    fromUrl: document.referrer || 'direct',
    toUrl: url,
    trigger: trigger,
    navigationTiming: performance.timing ? {
      loadStart: performance.timing.navigationStart,
      domReady: performance.timing.domContentLoadedEventEnd,
      loadComplete: performance.timing.loadEventEnd
    } : null
  });
  
  // Enhanced navigation descriptions
  const urlObj = new URL(url);
  const domain = urlObj.hostname;
  const path = urlObj.pathname;
  
  if (trigger === 'pushState' || trigger === 'replaceState') {
    step.description = `Navigate to ${path} (SPA navigation)`;
  } else if (trigger === 'hashchange') {
    step.description = `Navigate to section ${urlObj.hash}`;
  } else if (trigger === 'popstate') {
    step.description = 'Navigate back/forward in browser history';
  } else {
    step.description = `Navigate to new page: ${domain}${path}`;
  }
  
  // Navigation should be captured immediately
  chrome.runtime.sendMessage({
    type: 'REC_EVENT',
    sessionId: currentSessionId,
    step: step
  }).catch(() => {});
}

function setupNavigationHooks() {
  if (navigationHooksSet) {
    console.log('[TestSnapper Content] Navigation hooks already set');
    return;
  }
  
  navigationHooksSet = true;
  console.log('[TestSnapper Content] Setting up enhanced navigation hooks');
  
  // History API hooks for SPA navigation
  const originalPushState = history.pushState;
  const originalReplaceState = history.replaceState;
  
  history.pushState = function(...args) {
    const result = originalPushState.apply(this, args);
    setTimeout(() => captureNavigation(window.location.href, 'pushState'), 10);
    return result;
  };
  
  history.replaceState = function(...args) {
    const result = originalReplaceState.apply(this, args);
    setTimeout(() => captureNavigation(window.location.href, 'replaceState'), 10);
    return result;
  };
  
  // Hash change detection
  window.addEventListener('hashchange', () => {
    captureNavigation(window.location.href, 'hashchange');
  }, true);
  
  // Popstate for back/forward
  window.addEventListener('popstate', (event) => {
    setTimeout(() => captureNavigation(window.location.href, 'popstate'), 10);
  }, true);
  
  // Before unload (page leaving)
  window.addEventListener('beforeunload', () => {
    if (recording && !paused && currentSessionId) {
      chrome.runtime.sendMessage({
        type: 'PAGE_UNLOAD',
        sessionId: currentSessionId,
        url: window.location.href
      }).catch(() => {});
    }
  });
}

/////////////////////////////
// Event Listener Setup     //
/////////////////////////////

function attachEventListeners() {
  if (listenersAttached) {
    console.log('[TestSnapper Content] Event listeners already attached');
    return;
  }
  
  listenersAttached = true;
  console.log('[TestSnapper Content] Attaching comprehensive event listeners');
  
  // Use capture phase to catch events before they're handled by the page
  document.addEventListener('click', handleClick, true);
  document.addEventListener('input', handleInput, true);
  document.addEventListener('change', handleChange, true);
  document.addEventListener('keydown', handleKeyDown, true);
  
  // Scroll events (with throttling)
  window.addEventListener('scroll', handleScroll, { passive: true });
  document.addEventListener('scroll', handleScroll, { passive: true, capture: true });
  
  // Focus events for form navigation
  document.addEventListener('focus', (event) => {
    if (!recording || paused) return;
    
    const element = event.target;
    if (['INPUT', 'TEXTAREA', 'SELECT'].includes(element.tagName)) {
      const step = createStepFromEvent('focus', element);
      step.description = `Focus on ${getElementDescription({ ...element, meta: step.meta }, 'focus').replace('Click ', '').toLowerCase()}`;
      debouncedSendStep(step);
    }
  }, true);
  
  // Form submission detection
  document.addEventListener('submit', (event) => {
    if (!recording || paused) return;
    
    const form = event.target;
    const step = createStepFromEvent('submit', form, {
      formMethod: form.method || 'GET',
      formAction: form.action || window.location.href,
      formData: new FormData(form)
    });
    
    step.description = `Submit form ${form.name || form.id || 'on page'}`;
    
    chrome.runtime.sendMessage({
      type: 'REC_EVENT',
      sessionId: currentSessionId,
      step: step
    }).catch(() => {});
  }, true);
  
  // Set up download detection
  setupDownloadDetection();
  
  console.log('[TestSnapper Content] All event listeners attached successfully');
}

/////////////////////////////
// Network Hook Injection   //
/////////////////////////////

function injectNetworkHook() {
  if (injectedNetworkHook) {
    console.log('[TestSnapper Content] Network hook already injected');
    return;
  }
  
  injectedNetworkHook = true;
  console.log('[TestSnapper Content] Injecting enhanced network capture hook');
  
  try {
    const script = document.createElement('script');
    script.textContent = `
      // Enhanced Network Monitoring
      (function() {
        console.log('[TestSnapper Injected] Network monitoring setup complete');
      })();
    `;
    
    script.onload = function() {
      this.remove();
      console.log('[TestSnapper Content] Enhanced network hook injected successfully');
    };
    script.onerror = function() {
      console.warn('[TestSnapper Content] Failed to load network hook');
      injectedNetworkHook = false;
    };
    (document.head || document.documentElement).appendChild(script);
  } catch (error) {
    console.error('[TestSnapper Content] Network hook injection failed:', error);
    injectedNetworkHook = false;
  }
}

/////////////////////////////
// Message Handling         //
/////////////////////////////

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log('[TestSnapper Content] Received message:', message.type, message);
  
  switch (message.type) {
    case 'PING':
      console.log('[TestSnapper Content] Responding to PING');
      sendResponse({ 
        ok: true, 
        recording, 
        paused, 
        sessionId: currentSessionId,
        url: window.location.href,
        title: document.title
      });
      break;
      
    case 'REC_START':
      console.log('[TestSnapper Content] Starting enhanced recording:', message.sessionId);
      recording = true;
      paused = false;
      currentSessionId = message.sessionId;
      eventId = 0;
      
      // Reset scroll tracking
      lastScrollTop = window.pageYOffset || document.documentElement.scrollTop;
      lastScrollLeft = window.pageXOffset || document.documentElement.scrollLeft;
      
      // Ensure all hooks are set up
      if (!listenersAttached) attachEventListeners();
      if (!navigationHooksSet) setupNavigationHooks();
      if (!injectedNetworkHook) injectNetworkHook();
      
      // Send initial page load event
      const initialStep = createStepFromEvent('navigate', document.documentElement, {
        trigger: 'recording_start',
        fromUrl: document.referrer || 'direct',
        toUrl: window.location.href
      });
      initialStep.description = `Begin recording on page: ${document.title}`;
      
      chrome.runtime.sendMessage({
        type: 'REC_EVENT',
        sessionId: currentSessionId,
        step: initialStep
      }).catch(() => {});
      
      sendResponse({ ok: true, message: 'Recording started with enhanced features' });
      break;
      
    case 'REC_STOP':
      console.log('[TestSnapper Content] Stopping recording');
      recording = false;
      paused = false;
      currentSessionId = null;
      downloadEvents.clear();
      sendResponse({ ok: true, message: 'Recording stopped' });
      break;
      
    case 'REC_PAUSE':
      console.log('[TestSnapper Content] Pausing recording');
      paused = true;
      sendResponse({ ok: true, message: 'Recording paused' });
      break;
      
    case 'REC_RESUME':
      console.log('[TestSnapper Content] Resuming recording');
      paused = false;
      sendResponse({ ok: true, message: 'Recording resumed' });
      break;
      
    case 'GET_PAGE_INFO':
      sendResponse({
        ok: true,
        pageInfo: {
          url: window.location.href,
          title: document.title,
          domain: window.location.hostname,
          path: window.location.pathname,
          readyState: document.readyState,
          scrollPosition: {
            top: window.pageYOffset || document.documentElement.scrollTop,
            left: window.pageXOffset || document.documentElement.scrollLeft
          },
          viewport: {
            width: window.innerWidth,
            height: window.innerHeight
          },
          documentSize: {
            width: document.documentElement.scrollWidth,
            height: document.documentElement.scrollHeight
          }
        }
      });
      break;
      
    case 'INJECT_CUSTOM_STEP':
      if (recording && !paused && currentSessionId) {
        const customStep = {
          id: uuid(),
          ts: Date.now(),
          action: 'custom',
          name: 'custom',
          description: message.description || 'Custom test step',
          locator: 'manual',
          locatorRaw: 'manual',
          locatorNorm: 'manual',
          element: { tagName: 'manual' },
          valueKind: 'custom',
          meta: {
            url: window.location.href,
            title: document.title,
            timestamp: new Date().toISOString(),
            customData: message.data || {}
          }
        };
        
        chrome.runtime.sendMessage({
          type: 'REC_EVENT',
          sessionId: currentSessionId,
          step: customStep
        }).catch(() => {});
        
        sendResponse({ ok: true, message: 'Custom step added' });
      } else {
        sendResponse({ ok: false, error: 'Not recording' });
      }
      break;
      
    default:
      console.warn('[TestSnapper Content] Unknown message type:', message.type);
      sendResponse({ ok: false, error: 'UNKNOWN_MESSAGE_TYPE' });
      break;
  }
  
  return true; // Keep message channel open for async responses
});

/////////////////////////////
// Page Context Integration //
/////////////////////////////

// Listen for network events from injected script
window.addEventListener('message', (event) => {
  if (event.source !== window) return;
  if (!event.data || event.data.source !== 'testsnapper-injected') return;
  
  if (recording && !paused && currentSessionId) {
    const netEvent = event.data.net;
    
    // Create human-readable network descriptions
    if (netEvent.type === 'request') {
      netEvent.description = `Making ${netEvent.method} request to ${new URL(netEvent.url).pathname}`;
    } else if (netEvent.type === 'response') {
      if (netEvent.isDownload) {
        netEvent.description = `Downloaded file from ${new URL(netEvent.url).pathname} (${netEvent.status})`;
      } else {
        netEvent.description = `Received response from ${new URL(netEvent.url).pathname} (${netEvent.status})`;
      }
    } else if (netEvent.type === 'error') {
      netEvent.description = `Network error for ${new URL(netEvent.url).pathname}: ${netEvent.error}`;
    }
    
    // Forward network events to background
    chrome.runtime.sendMessage({
      type: 'NETWORK_EVENT',
      sessionId: currentSessionId,
      net: netEvent
    }).catch(() => {});
  }
});

// Enhanced error handling and recovery
window.addEventListener('error', (event) => {
  if (recording && !paused && currentSessionId) {
    console.warn('[TestSnapper Content] Page error detected:', event.error);
    
    chrome.runtime.sendMessage({
      type: 'PAGE_ERROR',
      sessionId: currentSessionId,
      error: {
        message: event.message,
        filename: event.filename,
        lineno: event.lineno,
        colno: event.colno,
        stack: event.error?.stack
      }
    }).catch(() => {});
  }
});

/////////////////////////////
// Enhanced Descriptions    //
/////////////////////////////

function getElementDescription(element, action) {
  const tag = element.tagName?.toLowerCase();
  const type = element.type?.toLowerCase();
  const text = getElementText(element);
  const role = element.getAttribute?.('role');
  const ariaLabel = element.getAttribute?.('aria-label');
  const placeholder = element.placeholder;
  
  // Use aria-label or placeholder for better context
  const contextText = ariaLabel || placeholder || text;
  
  // Generate human-readable descriptions based on element type and action
  if (action === 'click') {
    if (tag === 'button' || type === 'button' || role === 'button') {
      if (contextText.toLowerCase().includes('submit')) return `Submit form by clicking "${contextText}" button`;
      if (contextText.toLowerCase().includes('save')) return `Save by clicking "${contextText}" button`;
      if (contextText.toLowerCase().includes('cancel')) return `Cancel by clicking "${contextText}" button`;
      if (contextText.toLowerCase().includes('delete')) return `Delete by clicking "${contextText}" button`;
      if (contextText.toLowerCase().includes('edit')) return `Edit by clicking "${contextText}" button`;
      if (contextText.toLowerCase().includes('add')) return `Add item by clicking "${contextText}" button`;
      return contextText ? `Click "${contextText}" button` : 'Click button';
    }
    
    if (tag === 'a') {
      const href = element.href || '';
      if (href.includes('mailto:')) return `Send email via "${contextText}" link`;
      if (href.includes('tel:')) return `Call phone number via "${contextText}" link`;
      if (downloadExtensions.test(href)) return `Download "${href.split('/').pop()}" file`;
      return contextText ? `Navigate via "${contextText}" link` : `Open link to ${new URL(href).hostname}`;
    }
    
    if (type === 'checkbox') {
      const checked = element.checked ? 'Check' : 'Uncheck';
      return contextText ? `${checked} "${contextText}" option` : `${checked} checkbox`;
    }
    
    if (type === 'radio') {
      return contextText ? `Select "${contextText}" radio option` : 'Select radio option';
    }
    
    if (type === 'submit') {
      return contextText ? `Submit form via "${contextText}"` : 'Submit form';
    }
    
    if (element.getAttribute('data-testid')) {
      const testId = element.getAttribute('data-testid');
      return `Interact with ${testId.replace(/-/g, ' ')} element`;
    }
    
    // Special cases for common UI patterns
    if (contextText.toLowerCase().includes('menu')) return `Open "${contextText}" menu`;
    if (contextText.toLowerCase().includes('close') || contextText === '×') return 'Close dialog/modal';
    if (contextText.toLowerCase().includes('search')) return `Click search for "${contextText}"`;
    if (role === 'tab') return `Switch to "${contextText}" tab`;
    if (role === 'menuitem') return `Select "${contextText}" from menu`;
    
    return contextText ? `Click on "${contextText}"` : `Click ${tag} element`;
  }
  
  if (action === 'type' || action === 'input') {
    const fieldContext = ariaLabel || placeholder || element.name || '';
    
    if (type === 'password') {
      return fieldContext ? `Enter password in "${fieldContext}" field` : 'Enter password';
    }
    if (type === 'email') {
      return fieldContext ? `Enter email address in "${fieldContext}" field` : 'Enter email address';
    }
    if (type === 'search') {
      return fieldContext ? `Search for text in "${fieldContext}" field` : 'Enter search term';
    }
    if (type === 'url') {
      return fieldContext ? `Enter URL in "${fieldContext}" field` : 'Enter website URL';
    }
    if (type === 'tel') {
      return fieldContext ? `Enter phone number in "${fieldContext}" field` : 'Enter phone number';
    }
    if (type === 'number') {
      return fieldContext ? `Enter number in "${fieldContext}" field` : 'Enter numeric value';
    }
    if (type === 'date') {
      return fieldContext ? `Select date in "${fieldContext}" field` : 'Select date';
    }
    if (type === 'time') {
      return fieldContext ? `Set time in "${fieldContext}" field` : 'Set time';
    }
    if (tag === 'textarea') {
      return fieldContext ? `Enter text in "${fieldContext}" text area` : 'Enter multi-line text';
    }
    
    return fieldContext ? `Type in "${fieldContext}" field` : `Enter text in ${type || 'input'} field`;
  }
  
  if (action === 'change' || action === 'select') {
    if (tag === 'select') {
      const selectedText = element.options?.[element.selectedIndex]?.text || element.value;
      const fieldName = ariaLabel || element.name || 'dropdown';
      return `Select "${selectedText}" from "${fieldName}" dropdown`;
    }
    if (type === 'file') {
      const files = element.files ? Array.from(element.files).map(f => f.name).join(', ') : 'file(s)';
      return `Upload file(s): ${files}`;
    }
    if (type === 'checkbox') {
      const checked = element.checked ? 'Enable' : 'Disable';
      return contextText ? `${checked} "${contextText}" option` : `${checked} checkbox`;
    }
    if (type === 'radio') {
      return contextText ? `Choose "${contextText}" option` : 'Select radio option';
    }
  }
  
  if (action === 'scroll') {
    const direction = element.meta?.direction?.vertical || 'down';
    const distance = element.meta?.distance?.vertical || 0;
    if (distance > 1000) {
      return `Scroll ${direction} significantly (${Math.round(distance)}px)`;
    } else if (distance > 300) {
      return `Scroll ${direction} moderately`;
    } else {
      return `Scroll ${direction} slightly`;
    }
  }
  
  if (action === 'navigate') {
    const trigger = element.meta?.trigger;
    const toUrl = element.meta?.toUrl || window.location.href;
    const urlObj = new URL(toUrl);
    
    if (trigger === 'pushState' || trigger === 'replaceState') {
      return `Navigate to "${urlObj.pathname}" section (single-page app)`;
    } else if (trigger === 'hashchange') {
      return `Jump to "${urlObj.hash}" section on page`;
    } else if (trigger === 'popstate') {
      return 'Go back/forward in browser history';
    } else if (trigger === 'recording_start') {
      return `Start recording on page: "${document.title}"`;
    } else {
      return `Navigate to new page: "${urlObj.hostname}${urlObj.pathname}"`;
    }
  }
  
  if (action === 'key') {
    const key = element.meta?.key;
    const targetTag = element.element?.tagName;
    
    if (key === 'Enter') {
      if (targetTag === 'textarea') return 'Press Enter to add new line';
      if (targetTag === 'input') return 'Press Enter to submit/confirm input';
      return 'Press Enter to proceed';
    } else if (key === 'Tab') {
      return element.meta?.shiftKey ? 'Move to previous field (Shift+Tab)' : 'Move to next field (Tab)';
    } else if (key === 'Escape') {
      return 'Press Escape to cancel or close';
    } else if (key?.startsWith('Arrow')) {
      const direction = key.replace('Arrow', '').toLowerCase();
      return `Navigate using ${direction} arrow key`;
    } else if (key === 'Backspace') {
      return 'Delete previous character (Backspace)';
    } else if (key === 'Delete') {
      return 'Delete next character (Delete)';
    } else {
      return `Press ${key} key`;
    }
  }
  
  if (action === 'download') {
    const filename = element.meta?.filename || 'file';
    const fileType = element.meta?.fileType || 'unknown';
    return `Download ${fileType.toUpperCase()} file: "${filename}"`;
  }
  
  if (action === 'focus') {
    return contextText ? `Focus on "${contextText}" field` : `Focus on ${tag} field`;
  }
  
  if (action === 'submit') {
    const formName = element.name || element.id || 'form';
    return `Submit "${formName}" form`;
  }
  
  if (action === 'custom') {
    return element.description || 'Custom test action';
  }
  
  return `Perform ${action} action on ${tag} element`;
}

/////////////////////////////
// Page State Monitoring    //
/////////////////////////////

function monitorPageChanges() {
  // Monitor for dynamic content changes that might affect test steps
  const observer = new MutationObserver((mutations) => {
    if (!recording || paused) return;
    
    let significantChanges = false;
    
    mutations.forEach((mutation) => {
      // Track significant DOM changes that might affect test reliability
      if (mutation.type === 'childList' && mutation.addedNodes.length > 0) {
        mutation.addedNodes.forEach((node) => {
          if (node.nodeType === 1 && node.tagName) { // Element node
            const tag = node.tagName.toLowerCase();
            // Track addition of interactive elements
            if (['button', 'input', 'select', 'textarea', 'a'].includes(tag)) {
              significantChanges = true;
            }
          }
        });
      }
    });
    
    if (significantChanges) {
      console.log('[TestSnapper Content] Significant DOM changes detected');
      // Could send a DOM_CHANGE event if needed for test stability analysis
    }
  });
  
  observer.observe(document.body || document.documentElement, {
    childList: true,
    subtree: true,
    attributes: false
  });
}

/////////////////////////////
// Initialization           //
/////////////////////////////

function initialize() {
  console.log('[TestSnapper Content] Initializing enhanced content script');
  
  // Always set up the basic hooks on load
  attachEventListeners();
  setupNavigationHooks();
  
  // Set up page monitoring
  if (document.body) {
    monitorPageChanges();
  } else {
    document.addEventListener('DOMContentLoaded', monitorPageChanges);
  }
  
  // Initialize scroll position tracking
  lastScrollTop = window.pageYOffset || document.documentElement.scrollTop;
  lastScrollLeft = window.pageXOffset || document.documentElement.scrollLeft;
  
  // Log successful initialization with enhanced details
  console.log('[TestSnapper Content] Enhanced content script initialized successfully');
  console.log('[TestSnapper Content] Page URL:', window.location.href);
  console.log('[TestSnapper Content] Page title:', document.title);
  console.log('[TestSnapper Content] Document ready state:', document.readyState);
  console.log('[TestSnapper Content] Viewport size:', window.innerWidth, 'x', window.innerHeight);
}

// Initialize immediately when script loads
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initialize);
} else {
  initialize();
}

// Also ensure initialization on various page states
if (document.readyState === 'complete') {
  // Page fully loaded
  setTimeout(initialize, 100);
} else {
  window.addEventListener('load', () => {
    setTimeout(initialize, 200); // Give a bit more time for complex pages
  });
}

// Handle page visibility changes (for browser tab switching)
document.addEventListener('visibilitychange', () => {
  if (recording && !paused && currentSessionId && !document.hidden) {
    console.log('[TestSnapper Content] Page became visible, ensuring hooks are active');
    // Re-initialize if needed when page becomes visible again
    if (!listenersAttached) attachEventListeners();
  }
});

console.log('[TestSnapper Content] Enhanced content script loaded successfully');