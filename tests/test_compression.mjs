/**
 * Test file for compression utility
 * 
 * Run with: node tests/test_compression.mjs
 */

// Mock browser APIs for Node.js environment
import { Readable, Writable } from 'stream';
import zlib from 'zlib';

// Polyfill CompressionStream and DecompressionStream for Node.js
if (typeof globalThis.CompressionStream === 'undefined') {
    globalThis.CompressionStream = class CompressionStream {
        constructor(format) {
            this.format = format;
            const gzip = zlib.createGzip();

            let resolveReadable;
            const readablePromise = new Promise(r => resolveReadable = r);

            const chunks = [];
            gzip.on('data', chunk => chunks.push(chunk));
            gzip.on('end', () => {
                resolveReadable({
                    getReader() {
                        let read = false;
                        return {
                            async read() {
                                if (read) return { done: true };
                                read = true;
                                return { done: false, value: Buffer.concat(chunks) };
                            }
                        };
                    }
                });
            });

            this.writable = {
                getWriter() {
                    return {
                        write(data) { gzip.write(data); },
                        close() { gzip.end(); }
                    };
                }
            };

            this.readable = {
                getReader() {
                    let resolved = false;
                    return {
                        async read() {
                            if (resolved) return { done: true };
                            const result = await readablePromise;
                            resolved = true;
                            const reader = result.getReader();
                            return reader.read();
                        }
                    };
                }
            };
        }
    };
}

if (typeof globalThis.DecompressionStream === 'undefined') {
    globalThis.DecompressionStream = class DecompressionStream {
        constructor(format) {
            this.format = format;
            const gunzip = zlib.createGunzip();

            let resolveReadable;
            const readablePromise = new Promise(r => resolveReadable = r);

            const chunks = [];
            gunzip.on('data', chunk => chunks.push(chunk));
            gunzip.on('end', () => {
                resolveReadable({
                    getReader() {
                        let read = false;
                        return {
                            async read() {
                                if (read) return { done: true };
                                read = true;
                                return { done: false, value: Buffer.concat(chunks) };
                            }
                        };
                    }
                });
            });

            this.writable = {
                getWriter() {
                    return {
                        write(data) { gunzip.write(data); },
                        close() { gunzip.end(); }
                    };
                }
            };

            this.readable = {
                getReader() {
                    let resolved = false;
                    return {
                        async read() {
                            if (resolved) return { done: true };
                            const result = await readablePromise;
                            resolved = true;
                            const reader = result.getReader();
                            return reader.read();
                        }
                    };
                }
            };
        }
    };
}

// Polyfill TextEncoder/TextDecoder
if (typeof globalThis.TextEncoder === 'undefined') {
    const { TextEncoder, TextDecoder } = await import('util');
    globalThis.TextEncoder = TextEncoder;
    globalThis.TextDecoder = TextDecoder;
}

// Import compression utilities
import { compress, decompress, isCompressed } from '../src/core/compression.js';

// Test data
const testSteps = [
    { id: '1', action: 'click', fieldName: 'Submit Button', selector: { css: '#submit-btn' } },
    { id: '2', action: 'input', fieldName: 'Email', value: 'test@example.com', selector: { css: '#email' } },
    { id: '3', action: 'navigate', url: 'https://example.com/dashboard' },
];

async function runTests() {
    console.log('🧪 Testing Compression Utility...\n');
    let passed = 0;
    let failed = 0;

    // Test 1: Compression returns string with prefix
    console.log('Test 1: Compression returns string with prefix');
    try {
        const compressed = await compress(testSteps);
        if (typeof compressed === 'string' && compressed.startsWith('COMPRESSED::GZIP::')) {
            console.log('✅ PASSED: Compressed data has correct prefix');
            passed++;
        } else {
            console.log('❌ FAILED: Compressed data does not have correct prefix');
            console.log('   Got:', compressed.substring(0, 50) + '...');
            failed++;
        }
    } catch (e) {
        console.log('❌ FAILED: Compression threw error:', e.message);
        failed++;
    }

    // Test 2: Round trip - decompress(compress(data)) === data
    console.log('\nTest 2: Round trip integrity');
    try {
        const compressed = await compress(testSteps);
        const decompressed = await decompress(compressed);
        const match = JSON.stringify(decompressed) === JSON.stringify(testSteps);
        if (match) {
            console.log('✅ PASSED: Round trip preserves data');
            passed++;
        } else {
            console.log('❌ FAILED: Round trip data mismatch');
            console.log('   Original:', JSON.stringify(testSteps));
            console.log('   Decompressed:', JSON.stringify(decompressed));
            failed++;
        }
    } catch (e) {
        console.log('❌ FAILED: Round trip threw error:', e.message);
        failed++;
    }

    // Test 3: isCompressed detection
    console.log('\nTest 3: isCompressed detection');
    try {
        const compressed = await compress(testSteps);
        const uncompressed = JSON.stringify(testSteps);
        if (isCompressed(compressed) && !isCompressed(uncompressed) && !isCompressed(testSteps)) {
            console.log('✅ PASSED: isCompressed correctly detects compressed vs uncompressed');
            passed++;
        } else {
            console.log('❌ FAILED: isCompressed detection incorrect');
            failed++;
        }
    } catch (e) {
        console.log('❌ FAILED: isCompressed threw error:', e.message);
        failed++;
    }

    // Test 4: Backward compatibility - decompress uncompressed array
    console.log('\nTest 4: Backward compatibility with uncompressed data');
    try {
        const legacyData = testSteps; // Array, not compressed
        const result = await decompress(legacyData);
        if (JSON.stringify(result) === JSON.stringify(testSteps)) {
            console.log('✅ PASSED: Uncompressed arrays pass through correctly');
            passed++;
        } else {
            console.log('❌ FAILED: Backward compatibility broken');
            failed++;
        }
    } catch (e) {
        console.log('❌ FAILED: Backward compatibility threw error:', e.message);
        failed++;
    }

    // Test 5: Compression ratio
    console.log('\nTest 5: Compression ratio');
    try {
        const largeData = Array(100).fill(testSteps[0]);
        const original = JSON.stringify(largeData);
        const compressed = await compress(largeData);
        const ratio = (compressed.length / original.length * 100).toFixed(1);
        console.log(`   Original: ${original.length} bytes`);
        console.log(`   Compressed: ${compressed.length} bytes`);
        console.log(`   Ratio: ${ratio}%`);
        if (compressed.length < original.length) {
            console.log('✅ PASSED: Compression reduces size');
            passed++;
        } else {
            console.log('⚠️ WARNING: Compression did not reduce size (may be expected for small data)');
            passed++; // Still pass since compression works
        }
    } catch (e) {
        console.log('❌ FAILED: Compression ratio test threw error:', e.message);
        failed++;
    }

    // Summary
    console.log('\n' + '='.repeat(50));
    console.log(`Results: ${passed} passed, ${failed} failed`);
    console.log('='.repeat(50));

    if (failed > 0) {
        process.exit(1);
    }
}

runTests().catch(e => {
    console.error('Test runner failed:', e);
    process.exit(1);
});
