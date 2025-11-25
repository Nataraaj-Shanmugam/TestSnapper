# Testing Guide

This guide covers manual + functional testing for TestSnapper.

---

# 🧭 Test Categories

### 1. Recording Engine  
### 2. Selector Logic  
### 3. Field Name Extraction  
### 4. Redaction  
### 5. Screenshots  
### 6. Storage  
### 7. Review UI  
### 8. Exporting  
### 9. Settings  

---

# 1️⃣ Recording Engine Tests

### ✔ Should capture:
- Clicks  
- Inputs  
- Dropdown changes  
- Navigation events  
- Manual screenshots  
- Auto screenshots  

### Steps:
1. Start recording  
2. Interact with demo form  
3. Open popup → check Live Steps  
4. Validate step count  
5. Stop → verify session saved  

---

# 2️⃣ Selector Logic Tests

For each element type:
- inputs  
- buttons  
- checkboxes  
- radios  
- selects  
- links  
- custom widgets  

Verify selectors include:
- CSS  
- XPath  
- Best-match chosen correctly  

---

# 3️⃣ Field Name Extraction Tests

Test combinations:
- Labeled inputs  
- Label wrapped inputs  
- ARIA-based inputs  
- Placeholder-only fields  
- No-name, no-id fields  

Expected:
- Clean readable name  
- No leakage of sensitive data  

---

# 4️⃣ Redaction Tests

Ensure:
- password fields masked  
- credit card masked  
- email partially masked (if configured)  
- no raw secrets in JSON  

---

# 5️⃣ Screenshot Tests

### Manual Screenshot
- Trigger manually  
- Verify asset stored  

### Auto Screenshot
- Set interval = 3 seconds  
- Record 10 seconds  
- Expect 3–4 screenshots  

### File Integrity
- Export DOCX  
- Images present  
- Images compressed correctly  

---

# 6️⃣ Storage Tests (IndexedDB)

- Session creation  
- Step append  
- Asset storage  
- Deletion of sessions  
- Clear All function  
- Max session limit enforcement  

---

# 7️⃣ Review UI Tests

Verify:
- Step editing  
- Adding steps  
- Drag sorting  
- Screenshot visibility toggle  
- Insert-between-line feature  
- Delete step  
- Title editing  
- Responsive layout  

---

# 8️⃣ Export Tests

### JSON  
- Must include all steps + metadata  

### CSV  
- Columns aligned  
- Special characters handled  

### DOCX  
- Heading  
- Step text  
- Screenshots  
- Layout intact  
- No blank images  

---

# 9️⃣ Settings Tests

Validate:
- Auto Screenshot  
- API Logging  
- Capture Failed Calls  
- Capture All Calls  
- Limit sessions  
- Timestamp inclusion  

---

# 🏁 Final Acceptance Scenarios

1. Record login → dashboard → logout  
2. Capture 2–3 screenshots  
3. Edit steps  
4. Export DOCX  
5. Verify selectors  
6. Verify DOCX formatting  
7. Clear sessions  
8. Restart recording → works correctly  

---

