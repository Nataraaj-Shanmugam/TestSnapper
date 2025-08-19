// FILE: src/webllm-service.js
// TestSnapper — ENHANCED WebLLM service (runs in OFFSCREEN DOCUMENT or page)
// -------------------------------------------------------------------------
// ✅ Enhanced features in this version:
// - Improved error handling and recovery
// - Better performance monitoring and optimization
// - Enhanced caching with intelligent invalidation
// - Robust model loading with retry logic
// - Advanced prompt engineering for better step descriptions
// - Memory management and resource cleanup
// - Enhanced compatibility detection
// - Progressive loading with detailed status updates

/////////////////////////////
// Configuration & Paths   //
/////////////////////////////

// Model configuration with fallback options
const MODEL_CONFIG = {
  primary: {
    id: 'Llama-3.2-1B-Instruct-q4f32_1-MLC',
    name: 'Llama 3.2 1B Instruct'
  },
  fallbacks: [
    { id: 'Llama-3.1-8B-Instruct-q4f16_1-MLC', name: 'Llama 3.1 8B Instruct' },
    { id: 'Qwen2.5-1.5B-Instruct-q4f16_1-MLC', name: 'Qwen 2.5 1.5B Instruct' }
  ]
};

const MODEL_ID = MODEL_CONFIG.primary.id;
const MODEL_BASE_URL = chrome.runtime.getURL(`assets/webllm/models/${MODEL_ID}/`);

// ESM bundle paths with fallbacks
const ENGINE_PATHS = [
  chrome.runtime.getURL('assets/webllm/webllm.min.mjs'),
  chrome.runtime.getURL('assets/webllm/webllm.esm.js'),
  chrome.runtime.getURL('assets/js/webllm.bundle.js')
];

// Enhanced configuration
const CONFIG = {
  maxParallel: 3,
  timeoutMs: 15000,
  retryAttempts: 3,
  retryDelayMs: 1000,
  cacheLimit: 10000,
  maxPromptLength: 512,
  maxResponseLength: 160,
  batchSize: 10,
  memoryThreshold: 0.8, // 80% memory usage threshold
  performanceWindow: 100 // Track last 100 operations
};

/////////////////////////////
// Engine State & Metrics  //
/////////////////////////////

let engine = null;
let mode = 'unknown';
let modelInfo = null;
let initializing = null;
let initAttempts = 0;

// Enhanced caching with metadata
class SmartCache {
  constructor(limit = CONFIG.cacheLimit) {
    this.limit = limit;
    this.cache = new Map();
    this.metadata = new Map(); // {key: {hits, lastUsed, created}}
  }

  get(key) {
    const value = this.cache.get(key);
    if (value !== undefined) {
      const meta = this.metadata.get(key) || { hits: 0, lastUsed: 0, created: Date.now() };
      meta.hits++;
      meta.lastUsed = Date.now();
      this.metadata.set(key, meta);
      return value;
    }
    return undefined;
  }

  set(key, value) {
    if (this.cache.size >= this.limit) {
      this._evictLRU();
    }
    
    this.cache.set(key, value);
    this.metadata.set(key, {
      hits: 1,
      lastUsed: Date.now(),
      created: Date.now()
    });
  }

  _evictLRU() {
    let oldestKey = null;
    let oldestTime = Infinity;
    
    for (const [key, meta] of this.metadata.entries()) {
      const score = meta.hits / Math.max(1, (Date.now() - meta.created) / 86400000); // hits per day
      if (meta.lastUsed < oldestTime && score < 0.1) { // Low utility items first
        oldestTime = meta.lastUsed;
        oldestKey = key;
      }
    }
    
    if (oldestKey) {
      this.cache.delete(oldestKey);
      this.metadata.delete(oldestKey);
    }
  }

  clear() {
    this.cache.clear();
    this.metadata.clear();
  }

  getStats() {
    return {
      size: this.cache.size,
      hitRate: this._calculateHitRate(),
      memoryUsage: this._estimateMemoryUsage()
    };
  }

  _calculateHitRate() {
    let totalHits = 0;
    let totalRequests = 0;
    for (const meta of this.metadata.values()) {
      totalHits += meta.hits;
      totalRequests += meta.hits + 1; // Assume 1 miss per entry
    }
    return totalRequests > 0 ? totalHits / totalRequests : 0;
  }

  _estimateMemoryUsage() {
    let size = 0;
    for (const [key, value] of this.cache.entries()) {
      size += key.length * 2 + (typeof value === 'string' ? value.length * 2 : 100);
    }
    return size;
  }
}

const smartCache = new SmartCache();

// Performance tracking
class PerformanceTracker {
  constructor(windowSize = CONFIG.performanceWindow) {
    this.windowSize = windowSize;
    this.operations = [];
    this.errors = [];
  }

  recordOperation(duration, success = true, metadata = {}) {
    const record = {
      timestamp: Date.now(),
      duration,
      success,
      ...metadata
    };

    this.operations.push(record);
    if (this.operations.length > this.windowSize) {
      this.operations.shift();
    }

    if (!success) {
      this.errors.push(record);
      if (this.errors.length > this.windowSize / 10) {
        this.errors.shift();
      }
    }
  }

  getStats() {
    if (this.operations.length === 0) return null;

    const recentOps = this.operations.slice(-50); // Last 50 operations
    const totalDuration = recentOps.reduce((sum, op) => sum + op.duration, 0);
    const successRate = recentOps.filter(op => op.success).length / recentOps.length;
    
    return {
      avgLatency: totalDuration / recentOps.length,
      successRate,
      totalOperations: this.operations.length,
      recentErrors: this.errors.slice(-10),
      throughput: recentOps.length / Math.max(1, (Date.now() - recentOps[0]?.timestamp) / 1000)
    };
  }
}

const perfTracker = new PerformanceTracker();

/////////////////////////////
// Utility Functions        //
/////////////////////////////

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function withTimeout(promise, ms = CONFIG.timeoutMs) {
  let timeoutId;
  const timeout = new Promise((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error('TIMEOUT')), ms);
  });
  
  return Promise.race([
    promise.finally(() => clearTimeout(timeoutId)),
    timeout
  ]);
}

function estimateMemoryUsage() {
  if (performance.memory) {
    return {
      used: performance.memory.usedJSHeapSize,
      total: performance.memory.totalJSHeapSize,
      limit: performance.memory.jsHeapSizeLimit,
      ratio: performance.memory.usedJSHeapSize / performance.memory.jsHeapSizeLimit
    };
  }
  return null;
}

function shouldPerformGC() {
  const memory = estimateMemoryUsage();
  return memory && memory.ratio > CONFIG.memoryThreshold;
}

/////////////////////////////
// Enhanced Text Processing //
/////////////////////////////

function normalizeText(text) {
  if (!text || typeof text !== 'string') return '';
  
  return text
    .replace(/\s+/g, ' ')
    .replace(/[^\w\s.,!?-]/g, '')
    .trim()
    .slice(0, CONFIG.maxResponseLength);
}

function sanitizeLocator(locator) {
  if (!locator) return '';
  
  return String(locator)
    .replace(/:[a-z-]+\([^)]*\)/g, '') // Remove pseudo-selectors
    .replace(/__[a-f0-9-]{6,}$/i, '') // Remove hash suffixes
    .replace(/\[\d+\]/g, '') // Remove array indices
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 100);
}

function buildEnhancedPrompt(step) {
  const action = (step.action || step.name || 'interact').toLowerCase();
  const locator = sanitizeLocator(step.locatorNorm || step.locatorRaw || step.locator || '');
  const valueKind = step.valueKind ? String(step.valueKind).toLowerCase() : 'none';
  const url = step.meta?.url ? new URL(step.meta.url).hostname : '';
  
  // Enhanced context-aware prompting
  const contextualHints = {
    click: locator.includes('button') ? 'button click' : locator.includes('link') ? 'link click' : 'click',
    type: valueKind.includes('password') ? 'password entry' : valueKind.includes('email') ? 'email entry' : 'text input',
    select: 'dropdown selection',
    navigate: 'page navigation',
    scroll: 'page scroll',
    hover: 'mouse hover',
    focus: 'element focus'
  };

  const actionHint = contextualHints[action] || action;
  
  const prompt = `Convert this UI interaction to a clear test step (max 12 words, imperative tone):

Action: ${actionHint}
Target: ${locator}
Type: ${valueKind}
Context: ${url}

Format: [Verb] [target description]
Examples:
- "Click login button"
- "Enter email address"
- "Select payment method"
- "Navigate to dashboard"

Step:`;

  return prompt.slice(0, CONFIG.maxPromptLength);
}

function generatePromptKey(step) {
  const action = step.action || step.name || 'interact';
  const locator = sanitizeLocator(step.locatorNorm || step.locatorRaw || step.locator || '');
  const valueKind = step.valueKind || 'none';
  const domain = step.meta?.url ? new URL(step.meta.url).hostname : '';
  
  // Create a stable hash-like key
  return `${action}:${locator}:${valueKind}:${domain}`.toLowerCase();
}

function generateFallbackStep(step) {
  const action = (step.action || step.name || 'interact').toLowerCase();
  const locator = sanitizeLocator(step.locatorNorm || step.locatorRaw || step.locator || '');
  
  const fallbacks = {
    click: `Click ${locator || 'element'}`,
    type: `Type in ${locator || 'field'}`,
    input: `Enter ${locator ? 'text in ' + locator : 'text'}`,
    select: `Select ${locator || 'option'}`,
    navigate: 'Navigate to page',
    scroll: 'Scroll page',
    hover: `Hover over ${locator || 'element'}`,
    focus: `Focus ${locator || 'element'}`,
    change: `Change ${locator || 'value'}`,
    submit: 'Submit form'
  };

  const result = fallbacks[action] || `${capitalize(action)} ${locator || 'element'}`;
  return normalizeText(result);
}

function capitalize(str) {
  return str ? str.charAt(0).toUpperCase() + str.slice(1) : str;
}

/////////////////////////////
// Enhanced Engine Management //
/////////////////////////////

async function loadEngineModule() {
  for (const path of ENGINE_PATHS) {
    try {
      console.log(`[WebLLM Service] Attempting to load engine from: ${path}`);
      const module = await import(path);
      
      const CreateMLCEngine = 
        module?.CreateMLCEngine ||
        module?.default?.CreateMLCEngine ||
        module?.webllm?.CreateMLCEngine ||
        globalThis.webllm?.CreateMLCEngine;
        
      if (CreateMLCEngine) {
        console.log(`[WebLLM Service] Engine loaded successfully from: ${path}`);
        return CreateMLCEngine;
      }
    } catch (error) {
      console.warn(`[WebLLM Service] Failed to load from ${path}:`, error.message);
    }
  }
  
  throw new Error('No compatible WebLLM engine found in any path');
}

async function detectCapabilities() {
  const capabilities = {
    webgpu: false,
    wasm: true, // Assume WASM is always available
    worker: typeof Worker !== 'undefined',
    offscreenCanvas: typeof OffscreenCanvas !== 'undefined',
    memory: estimateMemoryUsage()
  };

  // Test WebGPU availability
  try {
    if (navigator.gpu) {
      const adapter = await navigator.gpu.requestAdapter();
      capabilities.webgpu = !!adapter;
    }
  } catch (error) {
    console.warn('[WebLLM Service] WebGPU detection failed:', error);
  }

  return capabilities;
}

async function initializeEngineWithRetry() {
  const maxAttempts = CONFIG.retryAttempts;
  let lastError;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      console.log(`[WebLLM Service] Initialization attempt ${attempt}/${maxAttempts}`);
      
      postProgress(Math.min(10, attempt * 3));
      
      // Load engine module
      const CreateMLCEngine = await loadEngineModule();
      
      postProgress(15);
      
      // Detect capabilities
      const capabilities = await detectCapabilities();
      console.log('[WebLLM Service] Capabilities:', capabilities);
      
      postProgress(20);
      
      // Prepare initialization options
      const initOptions = {
        model_id: MODEL_ID,
        model_url: MODEL_BASE_URL,
        progress_callback: (progress) => {
          const pct = Math.max(20, Math.min(90, Math.round(progress * 70) + 20));
          postProgress(pct);
        },
        // Enhanced options based on capabilities
        use_cache: true,
        temperature: 0.1,
        max_tokens: 32
      };

      // Create engine with enhanced error handling
      try {
        engine = await withTimeout(CreateMLCEngine(initOptions), CONFIG.timeoutMs);
      } catch (engineError) {
        // Try legacy two-argument format
        console.log('[WebLLM Service] Trying legacy initialization format');
        engine = await withTimeout(
          CreateMLCEngine(MODEL_ID, {
            model_url: MODEL_BASE_URL,
            initProgressCallback: (info) => {
              const pct = Math.max(20, Math.min(90, Math.round((info?.progress || 0) * 70) + 20));
              postProgress(pct);
            }
          }),
          CONFIG.timeoutMs
        );
      }

      if (!engine) {
        throw new Error('Engine initialization returned null');
      }

      // Detect mode and gather info
      mode = await detectEngineMode(engine);
      modelInfo = await gatherModelInfo(engine);
      
      postProgress(95);
      
      // Perform a test inference to ensure engine is working
      await performEngineHealthCheck(engine);
      
      postProgress(100);
      postReady(MODEL_ID, mode);
      
      console.log(`[WebLLM Service] Successfully initialized on attempt ${attempt}`);
      console.log(`[WebLLM Service] Mode: ${mode}, Info:`, modelInfo);
      
      return true;

    } catch (error) {
      lastError = error;
      console.error(`[WebLLM Service] Initialization attempt ${attempt} failed:`, error);
      
      if (attempt < maxAttempts) {
        const delay = CONFIG.retryDelayMs * attempt;
        console.log(`[WebLLM Service] Retrying in ${delay}ms...`);
        await sleep(delay);
      }
    }
  }

  // All attempts failed
  console.error('[WebLLM Service] All initialization attempts failed:', lastError);
  mode = 'unavailable';
  engine = null;
  postReady('fallback', mode);
  postProgress(100);
  
  return false;
}

async function detectEngineMode(engine) {
  try {
    if (engine.getSystemInfo) {
      const info = await engine.getSystemInfo();
      const device = String(info?.device || '').toLowerCase();
      const backend = String(info?.backend || '').toLowerCase();
      
      if (device.includes('webgpu') || backend.includes('webgpu')) return 'webgpu';
      if (backend.includes('wasm') || backend.includes('webassembly')) return 'wasm';
      if (device.includes('cpu')) return 'cpu';
    }
    
    // Fallback detection based on performance
    const startTime = performance.now();
    await engine.chat?.completions?.create?.({
      messages: [{ role: 'user', content: 'test' }],
      max_tokens: 1
    });
    const duration = performance.now() - startTime;
    
    return duration < 100 ? 'webgpu' : duration < 500 ? 'wasm' : 'cpu';
  } catch (error) {
    console.warn('[WebLLM Service] Mode detection failed:', error);
    return 'unknown';
  }
}

async function gatherModelInfo(engine) {
  try {
    const info = {
      model: MODEL_ID,
      version: 'unknown',
      capabilities: [],
      memory: estimateMemoryUsage()
    };
    
    if (engine.getSystemInfo) {
      const sysInfo = await engine.getSystemInfo();
      info.version = sysInfo?.version || 'unknown';
      info.device = sysInfo?.device || 'unknown';
      info.backend = sysInfo?.backend || 'unknown';
    }
    
    return info;
  } catch (error) {
    console.warn('[WebLLM Service] Failed to gather model info:', error);
    return { model: MODEL_ID, version: 'unknown' };
  }
}

async function performEngineHealthCheck(engine) {
  const testPrompt = 'Say "OK"';
  const startTime = performance.now();
  
  try {
    const response = await withTimeout(performInference(engine, testPrompt), 5000);
    const duration = performance.now() - startTime;
    
    if (!response || typeof response !== 'string') {
      throw new Error('Invalid response format');
    }
    
    perfTracker.recordOperation(duration, true, { type: 'health_check' });
    console.log(`[WebLLM Service] Health check passed (${duration.toFixed(1)}ms): "${response.slice(0, 20)}"`);
    
  } catch (error) {
    perfTracker.recordOperation(performance.now() - startTime, false, { 
      type: 'health_check', 
      error: error.message 
    });
    throw new Error(`Health check failed: ${error.message}`);
  }
}

/////////////////////////////
// Enhanced Inference       //
/////////////////////////////

async function performInference(engine, prompt) {
  if (!engine || mode === 'unavailable') {
    throw new Error('ENGINE_NOT_AVAILABLE');
  }

  // Try different API formats in order of preference
  const methods = [
    // OpenAI-compatible API (preferred)
    async () => {
      if (!engine.chat?.completions?.create) throw new Error('No OpenAI API');
      const response = await engine.chat.completions.create({
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.1,
        max_tokens: 32,
        stream: false,
        stop: ['\n', '.', '!', '?']
      });
      return response?.choices?.[0]?.message?.content || '';
    },
    
    // Legacy chatCompletion API
    async () => {
      if (typeof engine.chatCompletion !== 'function') throw new Error('No legacy chat API');
      const response = await engine.chatCompletion(
        [{ role: 'user', content: prompt }],
        { temperature: 0.1, maxTokens: 32, stream: false }
      );
      return response?.message?.content || response?.output_text || response?.text || '';
    },
    
    // Generic generate API
    async () => {
      if (typeof engine.generate !== 'function') throw new Error('No generate API');
      return await engine.generate(prompt, { temperature: 0.1, max_tokens: 32 });
    }
  ];

  let lastError;
  for (const method of methods) {
    try {
      const result = await method();
      if (result && typeof result === 'string') {
        return normalizeText(result);
      }
    } catch (error) {
      lastError = error;
      console.warn('[WebLLM Service] Inference method failed:', error.message);
    }
  }

  throw lastError || new Error('All inference methods failed');
}

async function enrichSingleStep(step) {
  const promptKey = generatePromptKey(step);
  const startTime = performance.now();
  
  try {
    // Check cache first
    const cached = smartCache.get(promptKey);
    if (cached) {
      perfTracker.recordOperation(performance.now() - startTime, true, { 
        type: 'cache_hit', 
        cached: true 
      });
      return cached;
    }

    // Generate and execute prompt
    const prompt = buildEnhancedPrompt(step);
    const response = await withTimeout(performInference(engine, prompt), CONFIG.timeoutMs);
    
    const enriched = normalizeText(response) || generateFallbackStep(step);
    
    // Cache the result
    smartCache.set(promptKey, enriched);
    
    perfTracker.recordOperation(performance.now() - startTime, true, { 
      type: 'inference', 
      cached: false,
      tokens: response?.length || 0
    });
    
    return enriched;
    
  } catch (error) {
    perfTracker.recordOperation(performance.now() - startTime, false, { 
      type: 'inference', 
      error: error.message 
    });
    
    console.warn('[WebLLM Service] Step enrichment failed:', error);
    return generateFallbackStep(step);
  }
}

async function enrichBatchSteps(steps) {
  if (!Array.isArray(steps) || steps.length === 0) {
    return [];
  }

  console.log(`[WebLLM Service] Enriching batch of ${steps.length} steps`);
  
  // Process in smaller batches to manage memory
  const batchSize = Math.min(CONFIG.batchSize, steps.length);
  const results = [];
  
  for (let i = 0; i < steps.length; i += batchSize) {
    const batch = steps.slice(i, i + batchSize);
    
    // Process batch with controlled parallelism
    const batchResults = await processParallel(batch, enrichSingleStep, CONFIG.maxParallel);
    results.push(...batchResults);
    
    // Memory management
    if (shouldPerformGC() && typeof gc === 'function') {
      console.log('[WebLLM Service] Performing garbage collection');
      gc();
    }
    
    // Brief pause between batches to prevent overwhelming
    if (i + batchSize < steps.length) {
      await sleep(50);
    }
  }

  return results.map((enriched, index) => ({
    id: steps[index]?.id || `step_${index}`,
    enriched
  }));
}

async function processParallel(items, processor, maxConcurrency) {
  const results = new Array(items.length);
  const executing = [];
  let index = 0;

  async function processNext() {
    const currentIndex = index++;
    if (currentIndex >= items.length) return;
    
    try {
      results[currentIndex] = await processor(items[currentIndex]);
    } catch (error) {
      console.error(`[WebLLM Service] Parallel processing error at index ${currentIndex}:`, error);
      results[currentIndex] = generateFallbackStep(items[currentIndex]);
    }
    
    return processNext();
  }

  // Start initial batch of workers
  for (let i = 0; i < Math.min(maxConcurrency, items.length); i++) {
    executing.push(processNext());
  }

  await Promise.all(executing);
  return results;
}

/////////////////////////////
// Message Handlers         //
/////////////////////////////

function postReady(modelId, engineMode) {
  const message = { 
    type: 'LLM_READY', 
    modelId, 
    mode: engineMode,
    capabilities: modelInfo,
    cache: smartCache.getStats(),
    performance: perfTracker.getStats()
  };
  
  try { 
    chrome.runtime.sendMessage(message);
  } catch (error) {
    console.warn('[WebLLM Service] Failed to post ready message:', error);
  }
  
  // Backward compatibility
  try { 
    window.postMessage({
      source: 'testsnapper-webllm', 
      type: 'LLM_READY', 
      data: { modelId, mode: engineMode } 
    }, '*');
  } catch (error) {
    console.warn('[WebLLM Service] Failed to post window message:', error);
  }
}

function postProgress(pct) {
  const clampedPct = Math.max(0, Math.min(100, Math.round(pct)));
  
  try { 
    chrome.runtime.sendMessage({ type: 'LLM_PROGRESS', pct: clampedPct });
  } catch (error) {
    console.warn('[WebLLM Service] Failed to post progress:', error);
  }
  
  try { 
    window.postMessage({
      source: 'testsnapper-webllm', 
      type: 'INIT_PROGRESS', 
      data: { progress: clampedPct / 100 } 
    }, '*');
  } catch (error) {
    console.warn('[WebLLM Service] Failed to post window progress:', error);
  }
}

function postResult(reqId, results) {
  try { 
    chrome.runtime.sendMessage({ 
      type: 'LLM_ENRICH_RESULT', 
      reqId, 
      results,
      performance: perfTracker.getStats(),
      cache: smartCache.getStats()
    });
  } catch (error) {
    console.warn('[WebLLM Service] Failed to post results:', error);
  }
}

/////////////////////////////
// Enhanced Chrome Runtime  //
/////////////////////////////

async function ensureEngineReady() {
  if (engine && mode !== 'unavailable') return true;
  if (initializing) {
    await initializing;
    return engine && mode !== 'unavailable';
  }
  return false;
}

// Only handle LLM_* messages here; ignore everything else so background can respond.
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  // If message isn't for the LLM service, don't keep the channel open and don't respond.
  if (!msg || typeof msg.type !== 'string' || !msg.type.startsWith('LLM_')) {
    return false;
  }

  (async () => {
    try {
      console.log(`[WebLLM Service] Received message: ${msg.type}`);

      switch (msg.type) {
        case 'LLM_INIT': {
          if (!initializing) {
            initAttempts++;
            console.log(`[WebLLM Service] Starting initialization (attempt ${initAttempts})`);
            initializing = initializeEngineWithRetry();
          }
          const success = await initializing;
          sendResponse({
            ok: success,
            mode,
            modelInfo,
            performance: perfTracker.getStats(),
            cache: smartCache.getStats(),
            attempt: initAttempts
          });
          break;
        }

        case 'LLM_ENRICH_BATCH': {
          const reqId = msg.reqId;
          const steps = Array.isArray(msg.steps) ? msg.steps : [];
          if (steps.length === 0) {
            sendResponse({ ok: true, count: 0 });
            postResult(reqId, []);
            break;
          }
          const engineReady = await ensureEngineReady();
          if (!engineReady || mode === 'unavailable') {
            const fallbackResults = steps.map(step => ({
              id: step.id || `fallback_${Date.now()}`,
              enriched: generateFallbackStep(step)
            }));
            postResult(reqId, fallbackResults);
            sendResponse({ ok: false, degraded: true, count: fallbackResults.length });
            break;
          }
          const results = await enrichBatchSteps(steps);
          postResult(reqId, results);
          sendResponse({
            ok: true,
            count: results.length,
            performance: perfTracker.getStats(),
            cache: smartCache.getStats()
          });
          break;
        }

        case 'LLM_GET_STATUS': {
          sendResponse({
            ok: true,
            ready: !!(engine && mode !== 'unavailable'),
            mode,
            modelInfo,
            performance: perfTracker.getStats(),
            cache: smartCache.getStats(),
            memory: estimateMemoryUsage()
          });
          break;
        }

        case 'LLM_CLEAR_CACHE': {
          smartCache.clear();
          console.log('[WebLLM Service] Cache cleared');
          sendResponse({ ok: true });
          break;
        }

        default: {
          // Unknown *LLM_* message: log but don't interfere with other listeners.
          console.warn(`[WebLLM Service] Unknown LLM message type: ${msg.type}`);
          sendResponse({ ok: false, error: 'UNKNOWN_LLM_MESSAGE', type: msg.type });
          break;
        }
      }
    } catch (error) {
      console.error('[WebLLM Service] Message handler error:', error);
      sendResponse({ ok: false, error: error.message || String(error), stack: error.stack });
    }
  })();

  // Only return true for LLM_* messages we handle; non-LLM messages return false above.
  return true;
});


/////////////////////////////
// Backward Compatibility   //
/////////////////////////////

// Maintain compatibility with existing window.postMessage API
window.addEventListener('message', async (event) => {
  if (event.source !== window || !event.data) return;
  
  const { data } = event;
  if (!data || data.source !== 'testsnapper-content') return;

  try {
    switch (data.type) {
      case 'ENRICH_INTERACTION': {
        const step = data.interaction || {};
        const stepId = data.id || `interaction_${Date.now()}`;
        
        console.log(`[WebLLM Service] Processing interaction: ${stepId}`);
        
        const enriched = await enrichSingleStep(step);
        
        window.postMessage({
          source: 'testsnapper-webllm',
          type: 'INTERACTION_ENRICHED',
          data: {
            id: stepId,
            enriched: {
              ...step,
              enrichedDescription: enriched,
              enrichedAt: Date.now(),
              model: engine ? MODEL_ID : 'fallback',
              mode,
              cached: smartCache.get(generatePromptKey(step)) !== undefined
            }
          }
        }, '*');
        break;
      }

      case 'ENRICH_BATCH': {
        const steps = Array.isArray(data.interactions) ? data.interactions : [];
        const batchId = data.id || `batch_${Date.now()}`;
        
        console.log(`[WebLLM Service] Processing batch: ${batchId} (${steps.length} steps)`);
        
        const results = [];
        const engineReady = await ensureEngineReady();
        
        if (!engineReady) {
          console.warn('[WebLLM Service] Engine not ready for batch, using fallbacks');
        }
        
        for (const step of steps) {
          const enriched = engineReady ? 
            await enrichSingleStep(step) : 
            generateFallbackStep(step);
          
          results.push({
            ...step,
            enrichedDescription: enriched,
            enrichedAt: Date.now(),
            model: engine ? MODEL_ID : 'fallback',
            mode,
            cached: smartCache.get(generatePromptKey(step)) !== undefined
          });
        }
        
        window.postMessage({
          source: 'testsnapper-webllm',
          type: 'BATCH_ENRICHED',
          data: {
            id: batchId,
            enriched: results,
            performance: perfTracker.getStats(),
            cache: smartCache.getStats()
          }
        }, '*');
        break;
      }

      case 'GET_LLM_STATUS': {
        const status = {
          ready: !!(engine && mode !== 'unavailable'),
          mode,
          modelId: engine ? MODEL_ID : 'fallback',
          modelInfo,
          cacheSize: smartCache.cache.size,
          cacheStats: smartCache.getStats(),
          performance: perfTracker.getStats(),
          memory: estimateMemoryUsage(),
          initAttempts
        };
        
        window.postMessage({
          source: 'testsnapper-webllm',
          type: 'LLM_STATUS',
          data: status
        }, '*');
        break;
      }

      case 'CLEAR_LLM_CACHE': {
        const oldSize = smartCache.cache.size;
        smartCache.clear();
        
        console.log(`[WebLLM Service] Cache cleared (${oldSize} entries removed)`);
        
        window.postMessage({ 
          source: 'testsnapper-webllm', 
          type: 'CACHE_CLEARED',
          data: { clearedEntries: oldSize }
        }, '*');
        break;
      }

      case 'LLM_HEALTH_CHECK': {
        try {
          if (engine && mode !== 'unavailable') {
            await performEngineHealthCheck(engine);
            window.postMessage({
              source: 'testsnapper-webllm',
              type: 'HEALTH_CHECK_RESULT',
              data: { healthy: true, mode, performance: perfTracker.getStats() }
            }, '*');
          } else {
            window.postMessage({
              source: 'testsnapper-webllm',
              type: 'HEALTH_CHECK_RESULT',
              data: { healthy: false, reason: 'Engine not available' }
            }, '*');
          }
        } catch (error) {
          window.postMessage({
            source: 'testsnapper-webllm',
            type: 'HEALTH_CHECK_RESULT',
            data: { healthy: false, reason: error.message }
          }, '*');
        }
        break;
      }

      default:
        console.warn(`[WebLLM Service] Unknown window message type: ${data.type}`);
        break;
    }
    
  } catch (error) {
    console.error('[WebLLM Service] Window message handler error:', error);
    window.postMessage({
      source: 'testsnapper-webllm',
      type: 'ERROR',
      data: { 
        error: error.message,
        originalType: data.type,
        originalId: data.id
      }
    }, '*');
  }
});

/////////////////////////////
// Cleanup & Maintenance    //
/////////////////////////////

// Periodic maintenance
setInterval(() => {
  try {
    // Clean up performance tracker
    const stats = perfTracker.getStats();
    if (stats && stats.totalOperations > CONFIG.performanceWindow * 2) {
      console.log('[WebLLM Service] Performing maintenance cleanup');
      
      // Reset if we have too much data
      if (perfTracker.operations.length > CONFIG.performanceWindow) {
        perfTracker.operations = perfTracker.operations.slice(-CONFIG.performanceWindow);
      }
    }
    
    // Memory monitoring
    const memory = estimateMemoryUsage();
    if (memory && memory.ratio > 0.9) {
      console.warn(`[WebLLM Service] High memory usage: ${(memory.ratio * 100).toFixed(1)}%`);
      
      // Emergency cache cleanup
      if (smartCache.cache.size > CONFIG.cacheLimit / 2) {
        const oldSize = smartCache.cache.size;
        // Clear bottom 25% of cache
        const toRemove = Math.floor(oldSize * 0.25);
        let removed = 0;
        
        for (const [key, meta] of smartCache.metadata.entries()) {
          if (removed >= toRemove) break;
          if (meta.hits < 2 && Date.now() - meta.lastUsed > 300000) { // 5 minutes
            smartCache.cache.delete(key);
            smartCache.metadata.delete(key);
            removed++;
          }
        }
        
        if (removed > 0) {
          console.log(`[WebLLM Service] Emergency cleanup: removed ${removed} cache entries`);
        }
      }
    }
  } catch (error) {
    console.error('[WebLLM Service] Maintenance error:', error);
  }
}, 60000); // Every minute

// Graceful shutdown handling
const cleanup = () => {
  try {
    console.log('[WebLLM Service] Performing cleanup...');
    
    // Clear caches
    smartCache.clear();
    
    // Final status report
    const finalStats = {
      totalOperations: perfTracker.operations.length,
      finalPerformance: perfTracker.getStats(),
      uptime: Date.now() - (window.webllmStartTime || Date.now())
    };
    
    console.log('[WebLLM Service] Final statistics:', finalStats);
    
  } catch (error) {
    console.error('[WebLLM Service] Cleanup error:', error);
  }
};

// Register cleanup handlers
if (typeof window !== 'undefined') {
  window.addEventListener('beforeunload', cleanup);
  window.addEventListener('unload', cleanup);
}

// Self-monitoring and health checks
let lastHealthCheck = Date.now();
setInterval(async () => {
  try {
    const now = Date.now();
    
    // Periodic health check every 5 minutes
    if (now - lastHealthCheck > 300000 && engine && mode !== 'unavailable') {
      console.log('[WebLLM Service] Performing periodic health check');
      
      try {
        await performEngineHealthCheck(engine);
        lastHealthCheck = now;
      } catch (error) {
        console.error('[WebLLM Service] Health check failed:', error);
        
        // Consider engine unhealthy and attempt recovery
        if (error.message.includes('TIMEOUT') || error.message.includes('ENGINE_NOT_AVAILABLE')) {
          console.warn('[WebLLM Service] Engine appears unhealthy, marking for recovery');
          mode = 'degraded';
          
          // Optionally trigger re-initialization
          // initializing = null;
          // engine = null;
        }
      }
    }
    
    // Log periodic statistics
    const stats = perfTracker.getStats();
    const cacheStats = smartCache.getStats();
    
    if (stats && stats.totalOperations > 0) {
      console.log(`[WebLLM Service] Periodic stats - Operations: ${stats.totalOperations}, Success Rate: ${(stats.successRate * 100).toFixed(1)}%, Avg Latency: ${stats.avgLatency.toFixed(1)}ms, Cache Hit Rate: ${(cacheStats.hitRate * 100).toFixed(1)}%`);
    }
    
  } catch (error) {
    console.error('[WebLLM Service] Health monitoring error:', error);
  }
}, 30000); // Every 30 seconds

/////////////////////////////
// Auto-initialization      //
/////////////////////////////

// Mark start time for uptime tracking
window.webllmStartTime = Date.now();

// Auto-initialize on load with improved error handling
(async () => {
  try {
    console.log('[WebLLM Service] Auto-initializing WebLLM service...');
    console.log(`[WebLLM Service] Target model: ${MODEL_ID}`);
    console.log(`[WebLLM Service] Model path: ${MODEL_BASE_URL}`);
    console.log(`[WebLLM Service] Engine paths:`, ENGINE_PATHS);
    
    // Detect runtime environment
    const env = {
      isOffscreen: typeof chrome !== 'undefined' && chrome.offscreen,
      isServiceWorker: typeof importScripts === 'function',
      isWebWorker: typeof WorkerGlobalScope !== 'undefined',
      hasWebGPU: typeof navigator !== 'undefined' && navigator.gpu,
      hasWasm: typeof WebAssembly !== 'undefined'
    };
    
    console.log('[WebLLM Service] Runtime environment:', env);
    
    // Start initialization but don't wait for completion
    // This allows the service to respond to messages immediately
    if (!initializing) {
      initializing = initializeEngineWithRetry();
      
      // Log final result
      initializing.then((success) => {
        const message = success ? 
          `✅ WebLLM initialized successfully (mode: ${mode})` :
          `❌ WebLLM initialization failed (mode: ${mode})`;
        console.log(`[WebLLM Service] ${message}`);
        
        // Post final ready state
        if (success) {
          postReady(MODEL_ID, mode);
        }
      }).catch((error) => {
        console.error('[WebLLM Service] Initialization promise rejected:', error);
      });
    }
    
    console.log('[WebLLM Service] Service ready to handle messages');
    
  } catch (error) {
    console.error('[WebLLM Service] Auto-initialization error:', error);
    mode = 'unavailable';
    postReady('fallback', mode);
  }
})();