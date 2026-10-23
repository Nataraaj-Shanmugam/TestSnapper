# TestSnapper Libraries

This directory contains third-party libraries used by TestSnapper.

## Required Libraries

### 1. docx.min.js
- **Purpose:** Generate .docx (Word) documents
- **Version:** 7.8.2 or higher
- **Source:** https://unpkg.com/docx@7.8.2/build/index.js
- **License:** MIT
- **Download:**
  ```bash
  curl -o libs/docx.min.js https://unpkg.com/docx@7.8.2/build/index.js
  ```

### 2. html2pdf.bundle.min.js
- **Purpose:** Generate PDF documents from HTML
- **Version:** 0.10.1 or higher
- **Source:** https://unpkg.com/html2pdf.js@0.10.1/dist/html2pdf.bundle.min.js
- **License:** MIT
- **Download:**
  ```bash
  curl -o libs/html2pdf.bundle.min.js https://unpkg.com/html2pdf.js@0.10.1/dist/html2pdf.bundle.min.js
  ```

## Installation

Run the setup script to download all required libraries:

```bash
npm run setup-libs
```

Or manually download using curl:

```bash
cd libs
curl -o docx.min.js https://unpkg.com/docx@7.8.2/build/index.js
curl -o html2pdf.bundle.min.js https://unpkg.com/html2pdf.js@0.10.1/dist/html2pdf.bundle.min.js
```

## Loading Behavior

Libraries are loaded **only** from the extension package via
`chrome.runtime.getURL()`. There is no CDN fallback and no remote code path:
Manifest V3 forbids remote hosted code, and both extension pages ship
`script-src 'self'`. If a local library is missing, the affected export
format fails cleanly rather than fetching anything.

## License Information

All libraries are used under their respective MIT licenses. See individual library documentation for details.
