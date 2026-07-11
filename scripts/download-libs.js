#!/usr/bin/env node

/**
 * Download required third-party libraries for TestSnapper
 *
 * SRI hash policy (SEC-004):
 *   Each entry below documents the known SHA-384 SRI hash for that library
 *   version. After downloading (or finding an existing file in libs/) we
 *   compute the actual hash and compare it against the known value. A
 *   mismatch aborts the script (non-zero exit) instead of just warning —
 *   a changed hash means either the upstream CDN content shifted
 *   unexpectedly or the file was tampered with, and shipping it either way
 *   is exactly the supply-chain risk this check exists to catch. A missing
 *   `knownSha384` (null) is a deliberate TOFU exception for a brand-new
 *   entry with no pin recorded yet — that case is only logged, not enforced.
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
    // sha384 of the copy currently shipped in libs/ (TOFU-pinned 2026-07-04).
    knownSha384: 'QxNyiozsFHtk+CF8nwd9MwE50MZuAAGZuwp/tHHW790X9zq+45L4/LS1Yhi+NJRU'
  },
  {
    name: 'html2pdf.bundle.min.js',
    url: 'https://unpkg.com/html2pdf.js@0.10.1/dist/html2pdf.bundle.min.js',
    // sha384 of the copy currently shipped in libs/ (TOFU-pinned 2026-07-04).
    knownSha384: 'x0pf6PlKg8dNEMtgviNo4aEmRQJc11QyHXYibt9al8MH6yWkcffjV4tvwJwti1ed'
  },
  {
    // FUNC-005: jsPDF UMD build for local CSP-safe PDF export.
    // Extension CSP (script-src 'self') blocks CDN scripts; this local copy
    // is loaded via chrome.runtime.getURL in export-service.js.
    //
    // sha384 of jspdf@2.5.1 UMD — cross-verified identical from cdnjs,
    // jsdelivr, and unpkg on 2026-07-04.
    name: 'jspdf.umd.min.js',
    url: 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js',
    knownSha384: 'JcnsjUPPylna1s1fvi1u12X5qjY5OL56iySh75FdtrwhO/SWXgMjoVqcKyIIWOLk'
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
 * Verify bytes against the known SRI hash.
 * Throws on a real mismatch (SEC-004) — a missing knownHash is a deliberate
 * TOFU exception and only gets logged, not enforced.
 */
function verifySri(name, buffer, knownHash) {
  const actual = computeSha384(buffer);
  const sriValue = `sha384-${actual}`;
  console.log(`  SRI hash: ${sriValue}`);

  if (!knownHash) {
    console.log(`  (No known SRI hash on record — record the above for future verification)`);
    return;
  }

  if (actual === knownHash) {
    console.log(`  Integrity check PASSED`);
    return;
  }

  throw new Error(
    `SRI mismatch for ${name}!\n` +
    `    Expected: sha384-${knownHash}\n` +
    `    Actual:   ${sriValue}\n` +
    `  The file differs from its pinned hash — it may have changed upstream ` +
    `or been tampered with. If this change is expected, update knownSha384 ` +
    `in scripts/download-libs.js after verifying the new content yourself.`
  );
}

// Download all libraries
async function downloadAllLibs() {
  console.log('Downloading required libraries...\n');

  for (const lib of LIBRARIES) {
    const dest = path.join(LIBS_DIR, lib.name);

    // Skip if already exists
    if (fs.existsSync(dest)) {
      const existingBytes = fs.readFileSync(dest);
      console.log(`${lib.name} already exists (${(existingBytes.length / 1024 / 1024).toFixed(2)} MB)`);
      // SEC-004: a mismatch here throws (fatal) — see verifySri doc comment.
      verifySri(lib.name, existingBytes, lib.knownSha384);
      continue;
    }

    console.log(`Downloading ${lib.name} from ${lib.url} ...`);
    let bytes;
    try {
      bytes = await downloadFile(lib.url, dest);
    } catch (err) {
      // Network/HTTP failures are non-fatal — the dev can retry or grab it manually.
      console.error(`Failed to download ${lib.name}:`, err.message);
      console.log(`   You can manually download from: ${lib.url}`);
      console.log('');
      continue;
    }

    const stats = fs.statSync(dest);
    const sizeMB = (stats.size / 1024 / 1024).toFixed(2);
    console.log(`Downloaded ${lib.name} (${sizeMB} MB)`);

    try {
      verifySri(lib.name, bytes, lib.knownSha384);
    } catch (err) {
      // SEC-004: integrity failure IS fatal — discard the untrusted file and abort.
      try { fs.unlinkSync(dest); } catch { /* ignore */ }
      throw err;
    }
    console.log('');
  }

  console.log('Library setup complete!');
}

downloadAllLibs().catch(err => {
  console.error('Setup failed:', err);
  process.exit(1);
});
