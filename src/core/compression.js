/**
 * Compression Utility for Step Data
 * 
 * Implements GZIP compression using native CompressionStream API
 * for compressing step JSON data before storage.
 * 
 * BUG FIX: STR-MED-001 - No Compression for Step Data
 */

const COMPRESSION_PREFIX = 'COMPRESSED::GZIP::';
const PLAIN_PREFIX = 'PLAIN::';

/**
 * Compress data using GZIP
 * @param {any} data - Data to compress (will be JSON stringified)
 * @returns {Promise<string>} - Base64 encoded compressed string with prefix
 */
export async function compress(data) {
    try {
        const jsonString = JSON.stringify(data);
        const encoder = new TextEncoder();
        const inputBytes = encoder.encode(jsonString);

        // Use CompressionStream for GZIP
        const cs = new CompressionStream('gzip');
        const writer = cs.writable.getWriter();
        writer.write(inputBytes);
        writer.close();

        // Read compressed output
        const reader = cs.readable.getReader();
        const chunks = [];
        let totalLength = 0;

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            chunks.push(value);
            totalLength += value.length;
        }

        // Combine chunks into single Uint8Array
        const compressed = new Uint8Array(totalLength);
        let offset = 0;
        for (const chunk of chunks) {
            compressed.set(chunk, offset);
            offset += chunk.length;
        }

        // Convert to base64
        let binary = '';
        const chunkSize = 0x8000;
        for (let i = 0; i < compressed.length; i += chunkSize) {
            const chunk = compressed.subarray(i, i + chunkSize);
            binary += String.fromCharCode.apply(null, chunk);
        }
        const base64 = btoa(binary);

        console.log(`🗜️ Step data compressed: ${(jsonString.length / 1024).toFixed(1)}KB → ${(base64.length / 1024).toFixed(1)}KB`);

        return COMPRESSION_PREFIX + base64;
    } catch (error) {
        console.warn('Compression failed, storing with PLAIN prefix:', error);
        // FIX: FUNC-007 — Use PLAIN:: prefix so _readSteps can identify and round-trip this format.
        // Previously returned bare JSON.stringify(data) which _readSteps could not recognise
        // (it only handled COMPRESSED::GZIP:: or a raw Array), silently yielding [] on read-back.
        return PLAIN_PREFIX + JSON.stringify(data);
    }
}

/**
 * Decompress data
 * @param {string} compressedString - Compressed string (with or without prefix)
 * @returns {Promise<any>} - Original data
 */
export async function decompress(compressedString) {
    try {
        // Check if data is compressed
        if (typeof compressedString !== 'string') {
            // Already an object (uncompressed legacy data)
            return compressedString;
        }

        // FIX: FUNC-007 — Handle PLAIN:: prefix written by the compression fallback path.
        if (compressedString.startsWith(PLAIN_PREFIX)) {
            return JSON.parse(compressedString.slice(PLAIN_PREFIX.length));
        }

        if (!compressedString.startsWith(COMPRESSION_PREFIX)) {
            // Uncompressed data - try to parse as JSON
            try {
                return JSON.parse(compressedString);
            } catch {
                // Not JSON, return as-is (shouldn't happen for step data)
                return compressedString;
            }
        }

        // Remove prefix and decode base64
        const base64 = compressedString.slice(COMPRESSION_PREFIX.length);
        const binary = atob(base64);
        const compressedBytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) {
            compressedBytes[i] = binary.charCodeAt(i);
        }

        // Use DecompressionStream for GZIP
        const ds = new DecompressionStream('gzip');
        const writer = ds.writable.getWriter();
        writer.write(compressedBytes);
        writer.close();

        // Read decompressed output
        const reader = ds.readable.getReader();
        const chunks = [];
        let totalLength = 0;

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            chunks.push(value);
            totalLength += value.length;
        }

        // Combine chunks
        const decompressed = new Uint8Array(totalLength);
        let offset = 0;
        for (const chunk of chunks) {
            decompressed.set(chunk, offset);
            offset += chunk.length;
        }

        // Decode and parse JSON
        const decoder = new TextDecoder();
        const jsonString = decoder.decode(decompressed);
        return JSON.parse(jsonString);
    } catch (error) {
        console.error('Decompression failed:', error);
        // Try to return original if decompression fails
        if (typeof compressedString === 'string') {
            try {
                return JSON.parse(compressedString);
            } catch {
                return [];
            }
        }
        return compressedString;
    }
}

/**
 * Check if data is GZIP-compressed (has the GZIP prefix)
 * @param {any} data - Data to check
 * @returns {boolean}
 */
export function isCompressed(data) {
    return typeof data === 'string' && data.startsWith(COMPRESSION_PREFIX);
}

/**
 * Check if data was stored with the PLAIN fallback prefix
 * @param {any} data - Data to check
 * @returns {boolean}
 */
export function isPlainFallback(data) {
    return typeof data === 'string' && data.startsWith(PLAIN_PREFIX);
}
