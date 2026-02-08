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

## Fallback Behavior

The extension has built-in CDN fallback:
- If local library files are not found, the extension will attempt to load from CDN
- This requires an internet connection
- Local files are preferred for offline functionality and faster loading

## License Information

All libraries are used under their respective MIT licenses. See individual library documentation for details.
