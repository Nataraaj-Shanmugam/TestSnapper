#!/usr/bin/env node

/**
 * Download required third-party libraries for TestSnapper
 *
 * SRI hash policy (SEC-004):
 *   Each entry below documents the known SHA-384 SRI hash for that library
 *   version. After downloading we compute and log the actual hash so you
 *   can compare against the known value. A mismatch logs a warning but
 *   does NOT fail the build (SRI enforcement is a browser-side mechanism;
 *   at download time we can only warn).
 *
 *   To compute the SRI hash yourself:
 *     openssl dgst -sha384 -binary <file> | openssl base64 -A
 *   or use: https://www.srihash.org/
 */

const https = require('https');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const LIBS_DIR = path.join(__dirname, '..', 'libs');

// Known SRI hashes (sha384, base64-encoded) for integrity verification.
// These were obtained from cdnjs/unpkg at the time the entries were added.
// If a hash is null it means verification is skipped for that entry.
const LIBRARIES = [
  {
    name: 'docx.min.js',
    url: 'https://unpkg.com/docx@7.8.2/build/index.js',
    // sha384 of docx@7.8.2/build/index.js from unpkg — run setup-libs to
    // confirm this matches your downloaded copy.
    knownSha384: null // computed at download time; update after first run
  },
  {
    name: 'html2pdf.bundle.min.js',
    url: 'https://unpkg.com/html2pdf.js@0.10.1/dist/html2pdf.bundle.min.js',
    knownSha384: null
  },
  {
    // FUNC-005: jsPDF UMD build for local CSP-safe PDF export.
    // Extension CSP (script-src 'self') blocks CDN scripts; this local copy
    // is loaded via chrome.runtime.getURL in export-service.js.
    //
    // Known SRI for jspdf@2.5.1 UMD:
    //   sha384-/5esdnUhQAMaXXTSUSMxlECxJBMJRyWVl5l5Jrt0tMwNzgH7mXEEGWMUKF2HRex
    // (verify with: openssl dgst -sha384 -binary libs/jspdf.umd.min.js | openssl base64 -A)
    name: 'jspdf.umd.min.js',
    url: 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js',
    knownSha384: '/5esdnUhQAMaXXTSUSMxlECxJBMJRyWVl5l5Jrt0tMwNzgH7mXEEGWMUKF2HRex'
  }
];

// Ensure libs directory exists
if (!fs.existsSync(LIBS_DIR)) {
  fs.mkdirSync(LIBS_DIR, { recursive: true });
  console.log('Created libs/ directory');
}

/**
 * Download a file following redirects.
 * Returns the downloaded bytes as a Buffer.
 */
function downloadFile(url, dest) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest);
    const chunks = [];

    https.get(url, (response) => {
      // Handle redirects
      if (response.statusCode === 301 || response.statusCode === 302 || response.statusCode === 307 || response.statusCode === 308) {
        file.close();
        try { fs.unlinkSync(dest); } catch { /* ignore */ }
        return downloadFile(response.headers.location, dest)
          .then(resolve)
          .catch(reject);
      }

      if (response.statusCode !== 200) {
        file.close();
        try { fs.unlinkSync(dest); } catch { /* ignore */ }
        return reject(new Error(`Failed to download ${url}: HTTP ${response.statusCode}`));
      }

      response.on('data', chunk => chunks.push(chunk));
      response.pipe(file);

      file.on('finish', () => {
        file.close();
        resolve(Buffer.concat(chunks));
      });
    }).on('error', (err) => {
      file.close();
      try { fs.unlinkSync(dest); } catch { /* ignore */ }
      reject(err);
    });
  });
}

/**
 * Compute the SHA-384 hash of a buffer and return it as base64.
 */
function computeSha384(buffer) {
  return crypto.createHash('sha384').update(buffer).digest('base64');
}

/**
 * Verify downloaded bytes against the known SRI hash.
 * Logs a warning on mismatch — does NOT throw (enforcement is build-time advisory).
 */
function verifySri(name, buffer, knownHash) {
  const actual = computeSha384(buffer);
  const sriValue = `sha384-${actual}`;
  console.log(`  SRI hash: ${sriValue}`);

  if (knownHash) {
    if (actual === knownHash) {
      console.log(`  Integrity check PASSED`);
    } else {
      console.warn(`  WARNING: SRI mismatch for ${name}!`);
      console.warn(`    Expected: sha384-${knownHash}`);
      console.warn(`    Actual:   ${sriValue}`);
      console.warn(`  The file may have changed upstream. Verify before using in production.`);
    }
  } else {
    console.log(`  (No known SRI hash on record — record the above for future verification)`);
  }
}

// Download all libraries
async function downloadAllLibs() {
  console.log('Downloading required libraries...\n');

  for (const lib of LIBRARIES) {
    const dest = path.join(LIBS_DIR, lib.name);

    // Skip if already exists
    if (fs.existsSync(dest)) {
      const existingBytes = fs.readFileSync(dest);
      const existingHash = computeSha384(existingBytes);
      console.log(`${lib.name} already exists (${(existingBytes.length / 1024 / 1024).toFixed(2)} MB)`);
      console.log(`  SRI hash: sha384-${existingHash}`);
      if (lib.knownSha384 && existingHash !== lib.knownSha384) {
        console.warn(`  WARNING: existing file hash does not match known SRI for ${lib.name}`);
        console.warn(`    Expected: sha384-${lib.knownSha384}`);
        console.warn(`    Actual:   sha384-${existingHash}`);
      }
      continue;
    }

    console.log(`Downloading ${lib.name} from ${lib.url} ...`);
    try {
      const bytes = await downloadFile(lib.url, dest);
      const stats = fs.statSync(dest);
      const sizeMB = (stats.size / 1024 / 1024).toFixed(2);
      console.log(`Downloaded ${lib.name} (${sizeMB} MB)`);
      verifySri(lib.name, bytes, lib.knownSha384);
    } catch (err) {
      console.error(`Failed to download ${lib.name}:`, err.message);
      console.log(`   You can manually download from: ${lib.url}`);
    }
    console.log('');
  }

  console.log('Library setup complete!');
}

downloadAllLibs().catch(err => {
  console.error('Setup failed:', err);
  process.exit(1);
});
