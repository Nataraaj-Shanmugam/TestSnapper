# TestSnapper

TestSnapper is a Chrome-based UI test recorder that captures user actions, generates clean field names and selectors, captures screenshots, and exports tests into multiple formats (DOCX, JSON, CSV). It includes a rich standalone step editor with screenshot preview, drag reordering, and full metadata editing.

---

## ✨ Features

### 🔴 Recording Engine
- Start / Pause / Resume / Stop recording  
- Real-time step capture  
- Auto & manual screenshot support  
- API call logging (optional)

### 🧭 Smart Selector Engine
- CSS selector generation  
- XPath generation  
- Visible text & semantic locator fallback  
- Multi-strategy scoring  

### 🧪 Clean Field Name Extraction
From:
- `<label>` association  
- `aria-label`  
- `placeholder`  
- `id` / `name` fallback  

### 🧼 Redaction
- Input masking  
- Sensitive fields skipped  
- No raw password storage  

### 📄 Full Review & Editing
- Rich standalone review UI  
- Edit step text & metadata  
- Hide/Show screenshots  
- Reorder steps (drag & drop)  
- Add manual steps  

### 📤 Export Formats
- **DOCX** (with compressed screenshots)  
- **JSON**  
- **CSV**  

### 💾 Storage
- IndexedDB session storage  
- Automatic cleanup  
- Session limit handling  

---

## 🚀 Installation

1. Open **chrome://extensions**
2. Enable **Developer Mode**
3. Click **Load Unpacked**
4. Select the TestSnapper root folder

---

## 💡 Quick Overview

1. Click **Start Recording**  
2. Perform actions on any webpage  
3. Use **Pause/Resume** when needed  
4. Press **Stop** to finish  
5. Export through the **Export** tab  
6. Use “View Steps” for full editing  

---

## 📚 Additional Guides

- **Quick Start** → `QUICK_START.md`  
- **Developer Guide** → `DEVELOPER_GUIDE.md`  
- **Testing Guide** → `TESTING_GUIDE.md`

---
