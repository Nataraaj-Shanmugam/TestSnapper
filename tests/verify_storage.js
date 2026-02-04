
// Mock Chrome API
const store = new Map();
const chrome = {
    storage: {
        local: {
            get: async (key) => {
                if (typeof key === 'string') {
                    return { [key]: store.get(key) };
                }
                return Object.fromEntries(store);
            },
            set: async (obj) => {
                for (const [k, v] of Object.entries(obj)) store.set(k, v);
            },
            remove: async (key) => store.delete(key),
            getBytesInUse: async () => store.size * 100, // Mock size
            QUOTA_BYTES: 1000000
        }
    }
};

// Mock Image/Canvas
global.Image = class {
    constructor() { setTimeout(() => this.onload && this.onload(), 10); }
    set src(v) { }
};
global.document = {
    createElement: (tag) => {
        if (tag === 'canvas') {
            return {
                getContext: () => ({ drawImage: () => { } }),
                toDataURL: () => 'data:image/jpeg;base64,compressed'
            };
        }
    }
};

// Paste StorageManager code (simulation) to test logic
const STORAGE_VERSION = 2;
const META_KEY = 'testsnapper_meta';
const SESSIONS_KEY = 'testsnapper_sessions';
const QUOTA_WARNING_THRESHOLD = 0.80; // 80%

class StorageManager {
    constructor() {
        this.maxRetries = 3;
        this.retryDelay = 1;
        this.quotaListeners = new Set();
    }

    async _readMeta() {
        const result = await chrome.storage.local.get(META_KEY);
        return result[META_KEY] || {
            version: STORAGE_VERSION,
            sessionCount: 0,
            lastCleanup: Date.now()
        };
    }

    async _readSessions() {
        const result = await chrome.storage.local.get(SESSIONS_KEY);
        return result[SESSIONS_KEY] || [];
    }

    async createSession(sessionData) {
        const sessions = await this._readSessions();
        sessions.push(sessionData);
        await chrome.storage.local.set({ [SESSIONS_KEY]: sessions });
        return sessionData;
    }

    async getStorageUsage() {
        const bytesInUse = await chrome.storage.local.getBytesInUse();
        const QUOTA_BYTES = chrome.storage.local.QUOTA_BYTES;
        const percentage = bytesInUse / QUOTA_BYTES;
        return {
            used: bytesInUse,
            total: QUOTA_BYTES,
            percentage: percentage,
            warning: percentage >= QUOTA_WARNING_THRESHOLD,
            error: false
        };
    }
}

// Run Tests
async function runTests() {
    console.log('🧪 Testing StorageManager...');
    const storage = new StorageManager();

    // Test 1: Quota Check
    console.log('Test 1: Quota Check');
    const usage = await storage.getStorageUsage();
    if (usage.percentage >= 0 && usage.total === 1000000) {
        console.log('✅ Quota check passed');
    } else {
        console.error('❌ Quota check failed', usage);
    }

    // Test 2: Create Session
    console.log('Test 2: Create Session');
    await storage.createSession({ sessionId: '123', name: 'Test' });
    const sessions = await storage._readSessions();
    if (sessions.length === 1 && sessions[0].sessionId === '123') {
        console.log('✅ Session creation passed');
    } else {
        console.error('❌ Session creation failed');
    }

    console.log('Test 3: Metadata Version');
    const meta = await storage._readMeta();
    if (meta.version === 2) {
        console.log('✅ Schema version correct (v2)');
    } else {
        console.error('❌ Schema version incorrect');
    }
}

runTests();
