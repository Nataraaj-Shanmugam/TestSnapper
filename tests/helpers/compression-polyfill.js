/**
 * CompressionStream / DecompressionStream polyfill for Node.js and jsdom tests.
 *
 * Extracted from tests/core/compression.test.js to avoid duplication.
 * Call installCompressionPolyfill() in test beforeAll() to set up the polyfills.
 */

import zlib from 'zlib';

/**
 * Install CompressionStream and DecompressionStream polyfills if not present.
 * @returns {void}
 */
export function installCompressionPolyfill() {
  if (typeof globalThis.CompressionStream === 'undefined') {
    globalThis.CompressionStream = class CompressionStream {
      constructor() {
        const gz = zlib.createGzip();
        const chunks = [];
        let resolveDone;
        const done = new Promise((r) => (resolveDone = r));
        gz.on('data', (c) => chunks.push(c));
        gz.on('end', () => resolveDone(Buffer.concat(chunks)));

        this.writable = {
          getWriter: () => ({
            write: (d) => gz.write(d),
            close: () => gz.end(),
          }),
        };
        this.readable = {
          getReader: () => {
            let sent = false;
            return {
              read: async () => {
                if (sent) return { done: true };
                const buf = await done;
                sent = true;
                return { done: false, value: new Uint8Array(buf) };
              },
            };
          },
        };
      }
    };
  }

  if (typeof globalThis.DecompressionStream === 'undefined') {
    globalThis.DecompressionStream = class DecompressionStream {
      constructor() {
        const gunzip = zlib.createGunzip();
        const chunks = [];
        let resolveDone;
        const done = new Promise((r) => (resolveDone = r));
        gunzip.on('data', (c) => chunks.push(c));
        gunzip.on('end', () => resolveDone(Buffer.concat(chunks)));

        this.writable = {
          getWriter: () => ({
            write: (d) => gunzip.write(d),
            close: () => gunzip.end(),
          }),
        };
        this.readable = {
          getReader: () => {
            let sent = false;
            return {
              read: async () => {
                if (sent) return { done: true };
                const buf = await done;
                sent = true;
                return { done: false, value: new Uint8Array(buf) };
              },
            };
          },
        };
      }
    };
  }
}
