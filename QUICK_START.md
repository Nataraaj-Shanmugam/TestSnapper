# Quick Start Guide

A fast guide for testers and end-users.

---

## ▶️ Start a Recording

1. Open TestSnapper popup  
2. Click **Start**  
3. Indicator changes to **Red**  
4. Steps appear live in the viewer

Recorded steps include:
- Click  
- Input typing  
- Dropdown selection  
- Checkbox / radio  
- Page navigation  
- Screenshot actions  

---

## ⏸ Pause & ▶ Resume Recording

- Click **Pause** to temporarily stop capturing  
- Click **Resume** to continue  

The indicator updates accordingly.

---

## ⏹ Stop Recording

When finished:
- Click **Stop**  
- Session is saved automatically  
- Live viewer closes  
- Your session is available in the **Export** tab  

---

## 📸 Screenshots

### Manual Screenshot
Click **Capture Screenshot** at any time.

### Auto Screenshot
Enable under **Settings**:
- Auto Screenshot = ON  
- Interval = X seconds  

Screenshots are saved as compressed Blobs in IndexedDB.

---

## 👁 View / Edit Steps

Click **View Steps** to open the editor:
- Rename step  
- Edit description  
- Add steps  
- Reorder steps (drag & drop)  
- Delete steps  
- Toggle screenshot visibility  
- Replace screenshot  

---

## 📤 Exporting

1. Go to **Export** tab  
2. Select a session  
3. Choose format:
   - DOCX  
   - JSON  
   - CSV  
4. Click **Export**

DOCX includes:
- Screenshot compression  
- Multi-page layout  
- Clean step formatting  

---

## ⚠ Common Issues

### No steps recorded?
- Make sure you're recording in the **active tab**  
- Ensure page allowed content scripts  
- If iframe-heavy, reload and try again  

### Screenshots blank?
- Page blocked capture → try different domain  
- Disable DRM / protected-content mode  

---

