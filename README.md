# TestSnapper - Chrome Extension

TestSnapper is a Chrome Extension (Manifest V3) that records user interactions on web pages and extracts field names and CSS selectors automatically. It's designed for QA testers, developers, and anyone who needs to document UI test steps.

## Features

✅ **Automatic Field Name & Locator Extraction**
- Extracts field names from multiple sources: aria-label, label, placeholder, name, id
- Generates robust CSS selectors with priority: id > data-testid > name > aria-label > class
- XPath fallback for complex elements
- Text content and role attributes captured

✅ **User Interaction Recording**
- Click events
- Input/type events  
- Change events (select, checkbox, radio)
- Form submissions
- Page navigation
- Visual highlighting of captured elements

✅ **Privacy & Security**
- Automatic redaction of sensitive fields (passwords, tokens, API keys)
- Email, phone, and credit card masking
- Data stays local (IndexedDB storage)
- No external API calls (No AI)

✅ **Multiple Export Formats**
- **JSON**: Complete session data with all metadata
- **CSV**: Spreadsheet-ready format with field names and selectors
- **Markdown**: Human-readable documentation format

## Quick Start

### Installation

1. Open Chrome and navigate to `chrome://extensions/`
2. Enable "Developer mode" (toggle in top right)
3. Click "Load unpacked"
4. Select the `/app` directory
5. Click the TestSnapper icon in your toolbar

### Usage

1. Click "Start Recording" in the popup
2. Interact with your webpage (clicks, inputs, selections)
3. Click "Stop" when done
4. Select session and export format
5. Click "Export Session" to download

## Documentation

See full documentation in this README below for:
- Detailed features
- Architecture
- File structure
- API reference
- Troubleshooting
