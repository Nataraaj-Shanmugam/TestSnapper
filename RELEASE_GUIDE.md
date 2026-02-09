# TestSnapper Release Guide

**Complete step-by-step process for releasing TestSnapper to Chrome Web Store.**

This guide takes you from final development to published extension with zero guesswork.

---

## 📋 Table of Contents

1. [Pre-Release Checklist](#-pre-release-checklist)
2. [Version Management](#-version-management)
3. [Build Process](#-build-process)
4. [Local Testing](#-local-testing)
5. [Create Release Package](#-create-release-package)
6. [Chrome Web Store Upload](#-chrome-web-store-upload)
7. [Post-Release Tasks](#-post-release-tasks)
8. [Rollback Procedure](#-rollback-procedure)
9. [Troubleshooting](#-troubleshooting)

---

## ✅ Pre-Release Checklist

Complete these tasks **before** building the release:

### 1. Code Quality
- [ ] All features complete and tested
- [ ] All Critical/High bugs fixed (check `BUG_ENHANCEMENT_REPORT.md`)
- [ ] Code reviewed (if team project)
- [ ] No console.log statements in production code
- [ ] No commented-out code blocks

### 2. Documentation
- [ ] README.md updated with new features
- [ ] QUICK_START.md reflects current functionality
- [ ] CLAUDE.md updated with architecture changes
- [ ] BUG_ENHANCEMENT_REPORT.md status current

### 3. Testing
- [ ] Manual testing completed on Windows/Mac/Linux
- [ ] Recording flow tested (start/pause/resume/stop)
- [ ] All export formats tested (DOCX, PDF, JSON, CSV, Markdown)
- [ ] Screenshot capture working (manual + auto)
- [ ] Theme toggle working (light + dark)
- [ ] Privacy mode redaction verified
- [ ] Session recovery tested
- [ ] Storage quota handling tested

### 4. Security
- [ ] No hardcoded credentials or API keys
- [ ] CSP rules verified in manifest.json
- [ ] Permissions minimized and justified
- [ ] No external script loading (except documented CDN fallbacks)

### 5. Performance
- [ ] Large sessions tested (100+ steps)
- [ ] Memory leaks checked
- [ ] Storage cleanup verified
- [ ] GZIP compression working

---

## 🔢 Version Management

### Update Version Number

Version format: `MAJOR.MINOR.PATCH` (e.g., `1.1.3`)

#### 1. Update `manifest.json`
```json
{
  "version": "1.1.3",
  "version_name": "1.1.3"
}
```

**Location:** Line 3-4 in `manifest.json`

#### 2. Update `package.json`
```json
{
  "version": "1.1.3"
}
```

**Location:** Line 3 in `package.json`

#### 3. Update Release Scripts
Update version in **both** scripts:

**`create-release-zip.sh`** (Line 6):
```bash
echo "TestSnapper v1.1.3 - Release Packager"
```

**`create-release-zip.sh`** (Line 57):
```bash
RELEASE_ZIP="testsnapper-v1.1.3-${TIMESTAMP}.zip"
```

**`create-release-zip.bat`** (Line 6):
```batch
echo TestSnapper v1.1.3 - Release Packager
```

**`create-release-zip.bat`** (Line 76):
```batch
set "RELEASE_NAME=testsnapper-v1.1.3-%YMD%-%HMS%"
```

#### 4. Update Git Branch (if applicable)
```bash
git checkout -b V1.1.3
```

### Versioning Rules
- **MAJOR:** Breaking changes, major rewrites
- **MINOR:** New features, non-breaking changes
- **PATCH:** Bug fixes, small improvements

---

## 🏗 Build Process

Follow these steps **in order**:

### Step 1: Clean Previous Build
```bash
npm run clean
```

**What it does:**
- Deletes `dist/` folder
- Removes old build artifacts
- Ensures fresh build

**Expected output:**
```
Cleaning dist/ folder...
✅ Clean complete
```

---

### Step 2: Install Dependencies
```bash
npm install
```

**When to run:**
- First time setup
- After pulling new code
- After package.json changes

**Expected output:**
```
added 42 packages in 8s
```

**Verify:** `node_modules/` folder exists

---

### Step 3: Download Libraries
```bash
npm run setup-libs
```

**What it downloads:**
- `libs/docx.min.js` (~600 KB)
- `libs/html2pdf.bundle.min.js` (~2.5 MB)

**Expected output:**
```
📦 Downloading required libraries...

⬇️  Downloading docx.min.js...
✅ Downloaded docx.min.js (0.62 MB)

⬇️  Downloading html2pdf.bundle.min.js...
✅ Downloaded html2pdf.bundle.min.js (2.48 MB)

✅ Library setup complete!
```

**Verify:**
```bash
ls libs/
# Should show:
# docx.min.js
# html2pdf.bundle.min.js
```

---

### Step 4: Build Extension
```bash
npm run build
```

**What it does:**
1. Runs Webpack to bundle `src/background/background.js`
2. Copies all source files to `dist/`
3. Copies libraries to `dist/libs/`
4. Copies manifest.json to `dist/`

**Expected output:**
```
> testsnapper@1.1.3 build
> cross-env NODE_ENV=production webpack

asset src/background/background.js 156 KiB [emitted] (name: background)
webpack 5.x.x compiled successfully in 2154 ms
```

**Verify dist/ structure:**
```bash
ls dist/
# Should show:
# manifest.json
# src/
# libs/
```

**Critical files check:**
```bash
ls dist/manifest.json                  # ✅ Must exist
ls dist/src/background/background.js   # ✅ Must exist
ls dist/libs/docx.min.js               # ✅ Must exist
ls dist/libs/html2pdf.bundle.min.js    # ✅ Must exist
ls dist/src/core/compression.js        # ✅ Must exist
```

---

### Step 5: Quick Build Verification

**Check manifest.json:**
```bash
cat dist/manifest.json | grep version
```

**Expected:** `"version": "1.1.3"`

**Check file count:**
```bash
find dist -type f | wc -l
```

**Expected:** ~30-40 files (depending on assets)

---

## 🧪 Local Testing

**CRITICAL:** Always test the built extension before creating release ZIP.

### Load Extension in Chrome

#### Step 1: Open Extensions Page
1. Open Chrome browser
2. Navigate to `chrome://extensions`
3. Enable **Developer mode** (toggle in top-right)

#### Step 2: Remove Old Version (if exists)
1. Find "TestSnapper" in extensions list
2. Click **Remove**
3. Confirm deletion

#### Step 3: Load Built Extension
1. Click **Load unpacked** button
2. Navigate to your project folder
3. Select the **`dist/`** folder (NOT the root folder)
4. Click **Select Folder**

**Expected:** TestSnapper appears in extensions list with version number.

---

### Test Core Functionality

Run through this test script:

#### Test 1: Basic Recording
- [ ] Click extension icon → popup opens
- [ ] Click **Start Recording**
- [ ] Indicator turns red
- [ ] Navigate to `https://example.com`
- [ ] Click a link on the page
- [ ] Type in search box (if available)
- [ ] Click **Stop Recording**
- [ ] No errors in console (`F12` → Console tab)

#### Test 2: Screenshots
- [ ] Start recording
- [ ] Press `Ctrl+Shift+S` (Windows/Linux) or `Cmd+Shift+S` (Mac)
- [ ] Screenshot captured (check live viewer)
- [ ] Enable **Auto Screenshot** in settings
- [ ] Set interval to 3 seconds
- [ ] Wait for 2-3 auto captures
- [ ] Stop recording
- [ ] Screenshots visible in session

#### Test 3: Review Page
- [ ] Click **View Steps** from popup
- [ ] Review page opens in new tab
- [ ] All steps visible with descriptions
- [ ] Screenshots display correctly
- [ ] Theme toggle works (moon/sun icon)
- [ ] Drag-and-drop reordering works
- [ ] Edit step description works
- [ ] Delete step works

#### Test 4: Export Formats
Test each format:

- [ ] **JSON:** Opens save dialog, file downloads
- [ ] **CSV:** Opens save dialog, file downloads, opens in Excel
- [ ] **Markdown:** Opens save dialog, file downloads, readable format
- [ ] **DOCX:** Opens save dialog, file downloads, opens in Word with images
- [ ] **PDF:** Opens save dialog, file downloads, opens with images

#### Test 5: Privacy Mode
- [ ] Enable **Privacy Mode** in settings
- [ ] Start recording
- [ ] Type in password field (type="password")
- [ ] Stop recording
- [ ] Check step description shows `••••••••` instead of actual password

#### Test 6: Session Management
- [ ] Record multiple sessions (3-5)
- [ ] All sessions appear in Export tab
- [ ] Delete a session → confirms deletion
- [ ] Deleted session removed from list
- [ ] Refresh page → sessions persist

---

### Check Browser Console

Open DevTools (`F12`) and check for:

**No errors in:**
- Extension popup console
- Background service worker console (Extensions page → TestSnapper → "service worker")
- Review page console
- Content script console (on test pages)

**Expected warnings are OK:**
- "Service worker registered" (informational)
- Font loading warnings (cosmetic)

---

## 📦 Create Release Package

### Windows Users

#### Step 1: Run Release Script
```bash
./create-release-zip.bat
```

**Or double-click** `create-release-zip.bat` in File Explorer.

#### Step 2: Verify Output
```
========================================
TestSnapper v1.1.3 - Release Packager
========================================

Verifying dist/ contents...

  [OK] manifest.json
  [OK] src/background/background.js
  [OK] libs/docx.min.js
  [OK] libs/html2pdf.bundle.min.js

All required files present!

Creating ZIP: testsnapper-v1.1.3-20260208-143022.zip

========================================
SUCCESS! Release package created:
testsnapper-v1.1.3-20260208-143022.zip
========================================

File location: D:\Professional\AI_Generated\testsnapper-extension\testsnapper-v1.1.3-20260208-143022.zip
```

---

### Linux/Mac Users

#### Step 1: Make Script Executable (first time only)
```bash
chmod +x create-release-zip.sh
```

#### Step 2: Run Release Script
```bash
./create-release-zip.sh
```

#### Step 3: Verify Output
```
========================================
TestSnapper v1.1.3 - Release Packager
========================================

Verifying dist/ contents...

  [OK] manifest.json
  [OK] src/background/background.js
  [OK] libs/docx.min.js
  [OK] libs/html2pdf.bundle.min.js

All required files present!

Creating ZIP: testsnapper-v1.1.3-20260208-143022.zip

========================================
SUCCESS! Release package created:
testsnapper-v1.1.3-20260208-143022.zip
Size: 3.2M
========================================

File location: /Users/you/testsnapper/testsnapper-v1.1.3-20260208-143022.zip
```

---

### Verify ZIP Contents

#### Extract and Inspect (Optional)
```bash
# Create test folder
mkdir test-extract
cd test-extract

# Extract ZIP
unzip ../testsnapper-v1.1.3-*.zip

# Verify structure
ls -la
```

**Expected structure:**
```
manifest.json
src/
├── background/
│   └── background.js
├── content/
│   ├── content.js
│   ├── selector.js
│   └── redactor.js
├── ui/
│   ├── popup/
│   └── review/
├── core/
│   ├── utils.js
│   ├── compression.js
│   └── export-service.js
├── storage.js
└── export.js
libs/
├── docx.min.js
└── html2pdf.bundle.min.js
src/assets/
└── (icons, images)
```

**CRITICAL:** No source files should exist:
- ❌ No `webpack.config.js`
- ❌ No `package.json`
- ❌ No `node_modules/`
- ❌ No `scripts/` folder
- ❌ No `.git/` folder
- ❌ No `*.md` files (except maybe docs/)

---

## 🌐 Chrome Web Store Upload

### Prerequisites
- [ ] Google account
- [ ] Chrome Web Store developer account ($5 one-time fee)
- [ ] Release ZIP file ready

---

### Step 1: Access Developer Console

1. Go to: **https://chrome.google.com/webstore/devconsole**
2. Sign in with your Google account
3. Accept terms if first time

---

### Step 2: Create New Item (First Release Only)

**If this is your first release:**

1. Click **"New Item"** button
2. Click **"Choose file"**
3. Select your release ZIP: `testsnapper-v1.1.3-*.zip`
4. Wait for upload to complete
5. Click **"Continue to fill in details"**

**Skip to Step 4** (Store Listing) if first release.

---

### Step 3: Update Existing Item (Version Updates)

**If updating existing extension:**

1. Find "TestSnapper" in your items list
2. Click on the item name
3. Navigate to **"Package"** tab on the left
4. Click **"Upload new package"**
5. Select your release ZIP: `testsnapper-v1.1.3-*.zip`
6. Wait for upload validation

**Expected validation:**
- ✅ Manifest valid
- ✅ Icons present
- ✅ No prohibited code
- ✅ File size OK (~3-5 MB)

7. Click **"Save draft"**

---

### Step 4: Store Listing Details

Fill in or verify these fields:

#### Product Details
| Field | Value | Notes |
|-------|-------|-------|
| **Name** | `TestSnapper` | Max 45 characters |
| **Summary** | `Record UI test sessions with automated field detection, multi-strategy selectors, and export to DOCX/PDF/JSON` | Max 132 characters |
| **Category** | Developer Tools | Primary category |
| **Language** | English (United States) | Default language |

#### Description
```markdown
TestSnapper is a professional Chrome extension for recording UI test sessions with:

✅ Automated selector generation (ID, data-testid, ARIA, XPath, framework-specific)
✅ Screenshot capture (manual & auto-interval)
✅ Privacy mode with sensitive data redaction
✅ Multi-format export (DOCX, PDF, JSON, CSV, Markdown)
✅ Drag-and-drop step reordering
✅ Professional light + terminal dark themes
✅ GZIP compression for efficient storage

Perfect for:
- QA Engineers documenting test cases
- Developers creating bug reports
- Teams building test automation scripts
- Trainers creating visual workflows

Key Features:
• Start/Pause/Resume recording with live step viewer
• Multi-strategy selector engine for resilient automation
• Full-width screenshots in DOCX exports
• Session recovery on browser restart
• Local-only storage (no cloud sync)
• WCAG AAA accessible design

Export your recorded sessions to:
- DOCX (Word) with professional layout
- PDF for archival and sharing
- JSON for test automation tools
- CSV for analysis in Excel
- Markdown for GitHub/wikis

Privacy & Security:
✓ All data stored locally (chrome.storage.local)
✓ No external servers or tracking
✓ Password field redaction
✓ Open-source architecture

Version 1.1.3 includes:
- GZIP compression (40-60% size savings)
- Enhanced selector strategies for React/Vue/Angular/Svelte/Solid
- Improved screenshot quality (1200px width)
- Terminal aesthetic dark theme with scanline overlay
- Age-friendly light theme (WCAG AAA contrast)
- Batch operations for step management

Documentation:
Full README, Quick Start Guide, and troubleshooting included.

License: MIT
```

---

#### Graphics Assets

**Icon Requirements:**
- 128x128px (required)
- 48x48px (optional but recommended)
- 16x16px (optional)

Upload from: `src/assets/icon-*.png`

**Screenshots (1280x800 or 640x400):**

Capture these screenshots for the store listing:

1. **Recording in progress** - Show popup with red indicator
2. **Review page** - Show step cards with screenshots
3. **Export dialog** - Show format selection
4. **DOCX export** - Show Word document with images
5. **Theme toggle** - Show light vs dark comparison

**Promotional Images (Optional):**
- Small promo tile: 440x280px
- Large promo tile: 920x680px
- Marquee promo tile: 1400x560px

---

#### Privacy Practices

**Single Purpose Description:**
```
TestSnapper records user interactions (clicks, inputs, screenshots) on web pages to generate test documentation and automation scripts.
```

**Permissions Justification:**

| Permission | Justification |
|------------|---------------|
| `activeTab` | Required to inject content scripts and capture screenshots of the active tab during recording sessions |
| `scripting` | Required to inject content scripts that capture user interactions (clicks, inputs, navigation) |
| `storage` | Required to save recorded sessions, steps, and screenshot data locally |
| `unlimitedStorage` | Required to store large screenshot data without quota limits |
| `notifications` | Required to alert users about session recovery failures after browser restart |

**Host Permissions:**
- `<all_urls>`: Required to record interactions on any website the user chooses to test

**Data Usage:**
- ✅ All data stored locally (no remote transmission)
- ✅ No user data collection
- ✅ No analytics or tracking

---

#### Support & Contact

| Field | Value |
|-------|-------|
| **Website** | Your project homepage or GitHub Pages |
| **Support URL** | GitHub Issues page |
| **Support Email** | Your email address |

---

### Step 5: Distribution Settings

**Visibility:**
- [ ] **Public** - Visible in Chrome Web Store search
- [ ] **Unlisted** - Only accessible via direct link
- [ ] **Private** - Only for trusted testers (requires allowlist)

**Recommended for production:** Public

**Regions:**
- [ ] All regions (default)
- Or select specific countries

---

### Step 6: Submit for Review

1. Review all tabs (Package, Store Listing, Privacy, Distribution)
2. Click **"Submit for review"** (top-right)
3. Confirm submission

**Review timeline:**
- **First submission:** 1-3 business days
- **Updates:** Few hours to 1 day
- **During holidays:** Up to 5 business days

---

### Step 7: Monitor Review Status

**Check status:**
1. Go to Developer Console
2. View item status badge:
   - 🟡 **Pending review** - Submitted, waiting
   - 🔵 **In review** - Being reviewed by Google
   - 🟢 **Published** - Live on store
   - 🔴 **Rejected** - Issues found (check email)

**If rejected:**
- Check developer account email for details
- Fix issues listed in rejection notice
- Re-upload corrected package
- Submit again

---

## ✅ Post-Release Tasks

### 1. Git Tagging

**Create release tag:**
```bash
git add .
git commit -m "Release v1.1.3 - Production build"
git tag -a v1.1.3 -m "Version 1.1.3 - [Brief description of changes]"
git push origin V1.1.3
git push origin v1.1.3  # Push tag
```

---

### 2. GitHub Release (If applicable)

1. Go to your GitHub repository
2. Click **Releases** → **Create a new release**
3. Tag: `v1.1.3`
4. Title: `TestSnapper v1.1.3`
5. Description:
   ```markdown
   ## What's New
   - Feature 1
   - Feature 2
   - Bug fix 1

   ## Download
   Available on [Chrome Web Store](link)

   ## Installation
   See [QUICK_START.md](link)
   ```
6. Attach: Release ZIP file (optional)
7. Click **Publish release**

---

### 3. Update Documentation

**Update version references in:**
- [ ] README.md (if version-specific)
- [ ] CHANGELOG.md (create if doesn't exist)
- [ ] docs/VERSION_HISTORY.md

---

### 4. Announcement

**Notify stakeholders:**
- Team Slack/Discord
- Email to beta testers
- Social media (if applicable)
- Update website/landing page

---

### 5. Monitor Post-Release

**First 24 hours:**
- [ ] Check Chrome Web Store reviews
- [ ] Monitor error reports (if crash reporting enabled)
- [ ] Check GitHub issues
- [ ] Test auto-update (install old version, wait for update)

**First week:**
- [ ] Review user feedback
- [ ] Address critical bugs immediately
- [ ] Plan patch release if needed

---

## 🔄 Rollback Procedure

**If critical bug found after release:**

### Step 1: Quick Assessment
- **Severity:** Does it break core functionality?
- **Impact:** How many users affected?
- **Fix time:** Can you fix in < 2 hours?

### Step 2: Decision

**If quick fix possible:**
1. Create hotfix branch
2. Fix bug
3. Test thoroughly
4. Release as patch version (e.g., 1.1.4)
5. Submit to Chrome Web Store

**If rollback needed:**
1. Go to Chrome Web Store Developer Console
2. Navigate to Package tab
3. Find previous version in history
4. Click "Revert to this version"
5. Submit for review (usually faster for rollbacks)

---

## 🔧 Troubleshooting

### Build Errors

#### Error: `webpack: command not found`
**Solution:**
```bash
npm install
```

#### Error: `libs/docx.min.js not found`
**Solution:**
```bash
npm run setup-libs
```

#### Error: `ENOSPC: no space left on device`
**Solution:**
- Free up disk space
- Clean old builds: `npm run clean`

---

### Upload Errors

#### Error: "Manifest file is invalid"
**Cause:** Syntax error in manifest.json

**Solution:**
1. Validate JSON: https://jsonlint.com/
2. Check required fields: `name`, `version`, `manifest_version`, `icons`

#### Error: "Package size exceeds limit"
**Cause:** ZIP > 128 MB (very rare)

**Solution:**
- Remove unnecessary assets
- Compress images
- Remove docs from build (edit webpack.config.js)

#### Error: "Icons missing"
**Cause:** Icon files not in dist/

**Solution:**
- Verify `src/assets/icon-*.png` exists
- Check webpack.config.js copies assets

---

### Review Rejection Reasons

#### "Uses remote code"
**Cause:** CDN script loading detected

**Fix:**
- Ensure docx/html2pdf loaded from local libs/ first
- Verify no `<script src="https://...">` in HTML

#### "Violates minimum functionality"
**Cause:** Extension too simple or broken

**Fix:**
- Test all features work
- Provide clear description of functionality

#### "Spam or keyword stuffing"
**Cause:** Store description has repeated keywords

**Fix:**
- Rewrite description naturally
- Avoid repeating same words 5+ times

---

## 📞 Support Contacts

- **Chrome Web Store Support:** https://support.google.com/chrome_webstore/
- **Developer Forum:** https://groups.google.com/a/chromium.org/g/chromium-extensions
- **GitHub Issues:** (Your repository)

---

## 📚 Related Documentation

- **Build System:** webpack.config.js
- **User Guide:** QUICK_START.md
- **Full Documentation:** README.md
- **Developer Guide:** CLAUDE.md
- **Bug Tracking:** BUG_ENHANCEMENT_REPORT.md

---

**TestSnapper v1.1.3 Release Guide**
Last Updated: 2026-02-08
