#!/usr/bin/env node

/**
 * Download required third-party libraries for TestSnapper
 */

const https = require('https');
const fs = require('fs');
const path = require('path');

const LIBS_DIR = path.join(__dirname, '..', 'libs');
const LIBRARIES = [
  {
    name: 'docx.min.js',
    url: 'https://unpkg.com/docx@7.8.2/build/index.js'
  },
  {
    name: 'html2pdf.bundle.min.js',
    url: 'https://unpkg.com/html2pdf.js@0.10.1/dist/html2pdf.bundle.min.js'
  }
];

// Ensure libs directory exists
if (!fs.existsSync(LIBS_DIR)) {
  fs.mkdirSync(LIBS_DIR, { recursive: true });
  console.log('✅ Created libs/ directory');
}

// Download a file
function downloadFile(url, dest) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest);

    https.get(url, (response) => {
      // Handle redirects
      if (response.statusCode === 301 || response.statusCode === 302) {
        file.close();
        fs.unlinkSync(dest);
        return downloadFile(response.headers.location, dest)
          .then(resolve)
          .catch(reject);
      }

      if (response.statusCode !== 200) {
        file.close();
        fs.unlinkSync(dest);
        return reject(new Error(`Failed to download: ${response.statusCode}`));
      }

      response.pipe(file);

      file.on('finish', () => {
        file.close();
        resolve();
      });
    }).on('error', (err) => {
      file.close();
      fs.unlinkSync(dest);
      reject(err);
    });
  });
}

// Download all libraries
async function downloadAllLibs() {
  console.log('📦 Downloading required libraries...\n');

  for (const lib of LIBRARIES) {
    const dest = path.join(LIBS_DIR, lib.name);

    // Skip if already exists
    if (fs.existsSync(dest)) {
      console.log(`⏭️  ${lib.name} already exists, skipping`);
      continue;
    }

    console.log(`⬇️  Downloading ${lib.name}...`);
    try {
      await downloadFile(lib.url, dest);
      const stats = fs.statSync(dest);
      const sizeMB = (stats.size / 1024 / 1024).toFixed(2);
      console.log(`✅ Downloaded ${lib.name} (${sizeMB} MB)`);
    } catch (err) {
      console.error(`❌ Failed to download ${lib.name}:`, err.message);
      console.log(`   You can manually download from: ${lib.url}`);
    }
  }

  console.log('\n✅ Library setup complete!');
}

downloadAllLibs().catch(err => {
  console.error('❌ Setup failed:', err);
  process.exit(1);
});
