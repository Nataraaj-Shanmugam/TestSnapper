/**
 * Background Service Worker - With DOCX Export including Screenshots
 */

import { StorageManager } from './storage.js';

const States = {
  IDLE: 'idle',
  RECORDING: 'recording',
  PAUSED: 'paused',
  EXPORTING: 'exporting'
};

let currentState = States.IDLE;
let currentSession = null;
let eventBuffer = [];
const storage = new StorageManager();

let cachedSettings = null;
let stepSequence = 0;

storage.init().catch(console.error);

async function getSettings() {
  if (cachedSettings) return cachedSettings;
  
  const result = await chrome.storage.local.get('settings');
  cachedSettings = result.settings || {
    includeTimestamp: true,
    autoSave: true,
    maxSessions: 25,
    screenshotSeconds: 5,
    captureApiCalls: false,
    captureFailedCalls: false,
    captureAllCalls: false,
    autoScreenshot: false
  };
  
  return cachedSettings;
}

function clearSettingsCache() {
  cachedSettings = null;
}

function generateUUID() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
    const r = Math.random() * 16 | 0;
    const v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

async function createSession(tabInfo) {
  const sessionId = generateUUID();
  stepSequence = 0;
  const session = {
    sessionId,
    createdAt: new Date().toISOString(),
    env: {
      url: tabInfo.url,
      title: tabInfo.title,
      ua: navigator.userAgent,
      viewport: {
        width: tabInfo.width,
        height: tabInfo.height
      }
    },
    stepCount: 0
  };

  await storage.createSession(session);
  return session;
}

/**
 * ✅ Convert data URL to blob
 */
function dataURLtoBlob(dataURL) {
  const parts = dataURL.split(',');
  const mime = parts[0].match(/:(.*?);/)[1];
  const bstr = atob(parts[1]);
  let n = bstr.length;
  const u8arr = new Uint8Array(n);
  while (n--) {
    u8arr[n] = bstr.charCodeAt(n);
  }
  return new Blob([u8arr], { type: mime });
}

/**
 * ✅ Convert blob to data URL
 */
function blobToDataURL(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

/**
 * ✅ Escape HTML entities
 */
function escapeHtml(text) {
  if (!text) return '';
  const map = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;'
  };
  return String(text).replace(/[&<>"']/g, m => map[m]);
}

/**
 * ✅ NEW: Generate DOCX export with embedded screenshots
 */
async function generateSimpleDocx(exportData) {
  const { session, steps } = exportData;

  let html = `
<!DOCTYPE html>
<html xmlns:o='urn:schemas-microsoft-com:office:office' xmlns:w='urn:schemas-microsoft-com:office:word' xmlns='http://www.w3.org/TR/REC-html40'>
<head>
  <meta charset='utf-8'>
  <title>Test Recording Session</title>
  <style>
    body { font-family: Calibri, Arial, sans-serif; margin: 40px; }
    h1 { color: #2c3e50; border-bottom: 3px solid #3498db; padding-bottom: 10px; }
    h2 { color: #34495e; margin-top: 30px; background: #ecf0f1; padding: 10px; }
    .info { background: #f8f9fa; padding: 15px; border-left: 4px solid #3498db; margin: 20px 0; }
    .info p { margin: 5px 0; }
    .step { border: 1px solid #ddd; padding: 15px; margin: 15px 0; border-radius: 5px; page-break-inside: avoid; }
    .step-header { font-weight: bold; font-size: 16px; color: #2980b9; margin-bottom: 10px; }
    .step-oneliner { margin: 8px 0; color: #333; line-height: 1.6; }
    .screenshot { margin: 10px 0; text-align: center; }
    .screenshot img { max-width: 600px; width: 100%; height: auto; border: 1px solid #ddd; display: block; margin: 10px auto; }
    .automated-screenshots { margin-top: 30px; padding-top: 20px; border-top: 2px solid #3498db; }
  </style>
</head>
<body>
  <h1>🎬 Test Recording Session</h1>
  
  <div class='info'>
    <p><b>Session ID:</b> ${session.id}</p>
    <p><b>Created:</b> ${new Date(session.createdAt).toLocaleString()}</p>
    <p><b>URL:</b> ${session.environment.url}</p>
    <p><b>Page Title:</b> ${session.environment.title || 'N/A'}</p>
    <p><b>Total Steps:</b> ${session.stepCount}</p>
  </div>
  
  <h2>📋 Recorded Steps</h2>
`;

  const automatedScreenshots = [];
  const regularSteps = [];
  let stepNumber = 0;

  // ✅ Get all screenshot assets from IndexedDB
  const screenshotAssets = await storage.getAllAssets(session.id);
  const screenshotMap = new Map();
  
  console.log('📸 Loading screenshots for export, found:', screenshotAssets.length);
  
  for (const asset of screenshotAssets) {
    if (asset.blob) {
      try {
        const dataUrl = await blobToDataURL(asset.blob);
        screenshotMap.set(asset.stepId, dataUrl);
        console.log('✅ Loaded screenshot for step:', asset.stepId);
      } catch (err) {
        console.warn('Failed to convert screenshot blob:', err);
      }
    }
  }

  // Separate manual screenshots and automated screenshots
  steps.forEach(step => {
    if (step.action === 'screenshot' && step.isManual) {
      regularSteps.push(step);
    } else if (step.action === 'screenshot' && !step.isManual) {
      automatedScreenshots.push(step);
    } else {
      regularSteps.push(step);
    }
  });

  // Render regular steps with embedded screenshots
  for (const step of regularSteps) {
    stepNumber++;
    html += `<div class='step'>`;
    html += `<div class='step-header'>Step ${stepNumber}</div>`;
    
    if (step.action === 'screenshot') {
      html += `<div class='step-oneliner'>📸 Manual screenshot captured</div>`;
      const screenshotData = screenshotMap.get(step.id);
      if (screenshotData) {
        html += `<div class='screenshot'><img src="${screenshotData}" alt="Manual Screenshot"/></div>`;
      } else {
        html += `<div class='screenshot'><p style="color: #999;">Screenshot not available</p></div>`;
      }
    } else {
      let oneliner = `${step.action.toUpperCase()}`;
      if (step.fieldName && step.fieldName !== 'N/A') {
        oneliner += ` on "${escapeHtml(step.fieldName)}"`;
      }
      if (step.value && step.action !== 'navigate') {
        oneliner += ` with value "${escapeHtml(step.value)}"`;
      }
      if (step.action === 'navigate') {
        oneliner += ` to ${escapeHtml(step.value || step.url)}`;
      }
      
      html += `<div class='step-oneliner'>${oneliner}</div>`;
    }
    
    html += `</div>`;
  }

  // Render automated screenshots section
  if (automatedScreenshots.length > 0) {
    html += `
  <div class='automated-screenshots'>
    <h2>📷 Automated Screenshots</h2>`;
    
    for (let i = 0; i < automatedScreenshots.length; i++) {
      const screenshot = automatedScreenshots[i];
      const screenshotData = screenshotMap.get(screenshot.id);
      if (screenshotData) {
        html += `
    <div class='screenshot'>
      <p><b>Auto Screenshot ${i + 1}</b> - ${new Date(screenshot.timestamp).toLocaleTimeString()}</p>
      <img src="${screenshotData}" alt="Automated Screenshot ${i + 1}"/>
    </div>`;
      }
    }
    
    html += `</div>`;
  }

  html += `
</body>
</html>`;

  console.log('✅ DOCX HTML generated with', screenshotMap.size, 'screenshots embedded');
  return html;
}

async function startRecording(tabId, tabInfo) {
  if (currentState !== States.IDLE) {
    return { success: false, error: 'Already recording' };
  }

  try {
    currentSession = await createSession(tabInfo);
    currentState = States.RECORDING;
    eventBuffer = [];

    await chrome.action.setBadgeText({ text: 'REC', tabId });
    await chrome.action.setBadgeBackgroundColor({ color: '#FF0000', tabId });

    try {
      await chrome.scripting.executeScript({
        target: { tabId },
        files: ['src/selector.js', 'src/redactor.js', 'src/content.js']
      });
    } catch (injectErr) {
      if (!injectErr.message?.includes('already')) {
        throw injectErr;
      }
    }

    await new Promise(resolve => setTimeout(resolve, 100));

    await chrome.tabs.sendMessage(tabId, {
      action: 'startRecording',
      sessionId: currentSession.sessionId
    });

    console.log('Recording started:', currentSession.sessionId);
    return { success: true, sessionId: currentSession.sessionId };

  } catch (error) {
    console.error('Failed to start recording:', error);
    currentState = States.IDLE;
    return { success: false, error: error.message };
  }
}

async function pauseRecording(tabId) {
  if (currentState !== States.RECORDING) {
    return { success: false, error: 'Not recording' };
  }

  currentState = States.PAUSED;
  chrome.action.setBadgeText({ text: 'PAUSE', tabId });
  chrome.action.setBadgeBackgroundColor({ color: '#FFA500', tabId });

  await chrome.tabs.sendMessage(tabId, { action: 'pauseRecording' });
  return { success: true };
}

async function resumeRecording(tabId) {
  if (currentState !== States.PAUSED) {
    return { success: false, error: 'Not paused' };
  }

  currentState = States.RECORDING;
  chrome.action.setBadgeText({ text: 'REC', tabId });
  chrome.action.setBadgeBackgroundColor({ color: '#FF0000', tabId });

  await chrome.tabs.sendMessage(tabId, { action: 'resumeRecording' });
  return { success: true };
}

async function stopRecording(tabId) {
  if (currentState === States.IDLE) {
    return { success: false, error: 'Not recording' };
  }

  try {
    currentState = States.IDLE;
    chrome.action.setBadgeText({ text: '', tabId });

    await chrome.tabs.sendMessage(tabId, { action: 'stopRecording' });

    const sessionId = currentSession?.sessionId;
    currentSession = null;
    eventBuffer = [];
    stepSequence = 0;

    console.log('Recording stopped:', sessionId);
    return { success: true, sessionId };
  } catch (error) {
    console.error('Failed to stop recording:', error);
    return { success: false, error: error.message };
  }
}

/**
 * ✅ OPTIMIZED: Screenshot capture - Service Worker compatible
 */
async function captureScreenshot(tabId, isManual = true) {
  console.log('📸 Screenshot capture requested for tab:', tabId, 'manual:', isManual);
  
  if (currentState !== States.RECORDING) {
    console.error('❌ Not recording, cannot capture screenshot');
    return { success: false, error: 'Not recording' };
  }

  if (!currentSession) {
    console.error('❌ No active session');
    return { success: false, error: 'No active session' };
  }

  try {
    // 1. Get the actual tab
    const tab = await chrome.tabs.get(tabId);
    console.log('✅ Got tab:', tab.id, 'window:', tab.windowId, 'url:', tab.url);

    if (!tab || !tab.windowId) {
      throw new Error('Invalid tab or window ID');
    }

    // 2. Ensure the tab is active and visible
    await chrome.tabs.update(tab.id, { active: true });
    await chrome.windows.update(tab.windowId, { focused: true });
    await new Promise(resolve => setTimeout(resolve, 100));

    // 3. Capture screenshot with quality setting
    console.log('📸 Capturing visible tab in window:', tab.windowId);
    const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, {
      format: 'jpeg',
      quality: 80  // Lower quality for smaller file size
    });

    if (!dataUrl || !dataUrl.startsWith('data:image/')) {
      throw new Error('Screenshot capture returned invalid data');
    }

    const screenshotSize = Math.round(dataUrl.length / 1024);
    console.log('✅ Screenshot captured, size:', screenshotSize, 'KB');

    // 4. Convert to blob for storage
    const blob = dataURLtoBlob(dataUrl);
    console.log('✅ Converted to blob, size:', Math.round(blob.size / 1024), 'KB');

    // 5. Create step
    stepSequence++;
    const step = {
      id: generateUUID(),
      sessionId: currentSession.sessionId,
      sequence: stepSequence,
      action: 'screenshot',
      fieldName: 'Screenshot',
      targetLabel: isManual ? 'Manual Screenshot' : 'Auto Screenshot',
      url: tab.url,
      value: null,
      isSensitive: false,
      isManual: isManual,
      hasScreenshot: true
    };

    const settings = await getSettings();
    if (settings.includeTimestamp !== false) {
      step.timestamp = new Date().toISOString();
    }

    // 6. Save step and asset
    await storage.addStep(step);
    console.log('✅ Step added:', step.id);

    await storage.addAsset({
      id: generateUUID(),
      sessionId: currentSession.sessionId,
      stepId: step.id,
      type: 'screenshot',
      blob: blob,
      createdAt: new Date().toISOString()
    });
    console.log('✅ Screenshot asset saved');

    // 7. Update session count
    currentSession.stepCount++;
    await storage.updateSession(currentSession);
    console.log('✅ Session updated, total steps:', currentSession.stepCount);

    return { success: true, stepId: step.id };
  } catch (error) {
    console.error('❌ Screenshot capture failed:', error);
    return { success: false, error: error.message };
  }
}

async function addStep(stepData) {
  if (!currentSession) {
    return { success: false, error: 'No active session' };
  }

  try {
    const settings = await getSettings();
    
    stepSequence++;
    
    const step = {
      id: generateUUID(),
      sessionId: currentSession.sessionId,
      sequence: stepSequence,
      ...stepData
    };
    
    if (settings.includeTimestamp !== false) {
      step.timestamp = new Date().toISOString();
    }

    await storage.addStep(step);
    currentSession.stepCount++;
    await storage.updateSession(currentSession);

    console.log('Step added:', step.action, 'seq:', step.sequence);
    return { success: true, step };
  } catch (error) {
    console.error('Failed to add step:', error);
    return { success: false, error: error.message };
  }
}

function getState() {
  return {
    state: currentState,
    session: currentSession,
    stepCount: currentSession?.stepCount || 0
  };
}

/**
 * ✅ ENHANCED: Export session with DOCX support including screenshots
 */
async function exportSession(sessionId, format = 'json') {
  try {
    currentState = States.EXPORTING;
    console.log('📦 Starting export for session:', sessionId, 'format:', format);

    const session = await storage.getSession(sessionId);
    let steps = await storage.getSteps(sessionId);

    if (!session || steps.length === 0) {
      throw new Error('Session not found or has no steps');
    }

    steps.sort((a, b) => (a.sequence || 0) - (b.sequence || 0));

    const exportData = {
      session: {
        id: session.sessionId,
        createdAt: session.createdAt,
        environment: session.env,
        stepCount: steps.length
      },
      steps: steps.map((step, index) => ({
        id: step.id,
        stepNumber: index + 1,
        timestamp: step.timestamp,
        action: step.action,
        fieldName: step.fieldName,
        selector: step.selector,
        value: step.value,
        url: step.url,
        notes: step.notes || '',
        isManual: step.isManual,
        hasScreenshot: step.hasScreenshot
      }))
    };

    let content, filename, mimeType;

    if (format === 'json') {
      content = JSON.stringify(exportData, null, 2);
      filename = `testsnapper_${sessionId.substring(0, 8)}_${Date.now()}.json`;
      mimeType = 'application/json';
    } else if (format === 'csv') {
      const headers = ['Step', 'Action', 'Field Name', 'Selector (CSS)', 'Value', 'URL'];
      const rows = exportData.steps
        .filter(s => s.action !== 'screenshot')
        .map(step => [
          step.stepNumber,
          step.action,
          step.fieldName,
          step.selector?.css || '',
          step.value || '',
          step.url
        ]);

      content = [headers, ...rows]
        .map(row => row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(','))
        .join('\n');

      filename = `testsnapper_${sessionId.substring(0, 8)}_${Date.now()}.csv`;
      mimeType = 'text/csv';
    } else if (format === 'docx') {
      console.log('📄 Generating DOCX with screenshots...');
      content = await generateSimpleDocx(exportData);
      filename = `testsnapper_${sessionId.substring(0, 8)}_${Date.now()}.doc`;
      mimeType = 'application/msword';
    } else {
      throw new Error('Unsupported export format: ' + format);
    }

    const base64Content = btoa(unescape(encodeURIComponent(content)));
    const dataUrl = `data:${mimeType};base64,${base64Content}`;

    await chrome.downloads.download({
      url: dataUrl,
      filename: filename,
      saveAs: true
    });

    currentState = States.IDLE;
    console.log('✅ Export completed:', filename);
    return { success: true, filename };
  } catch (error) {
    console.error('❌ Export failed:', error);
    currentState = States.IDLE;
    return { success: false, error: error.message };
  }
}

async function getSenderTabId(sender) {
  if (sender?.tab?.id) return sender.tab.id;
  const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return activeTab?.id;
}

async function getScreenshot(stepId) {
  try {
    const assets = await storage.getAssetsByStepId(stepId);
    const screenshot = assets.find(a => a.type === 'screenshot');
    if (screenshot && screenshot.blob) {
      const dataUrl = await blobToDataURL(screenshot.blob);
      return { success: true, dataUrl };
    }
    return { success: false, error: 'Screenshot not found' };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  (async () => {
    try {
      let response;
      const tabId = await getSenderTabId(sender);

      switch (message.action) {
        case 'startRecording':
          response = await startRecording(tabId, message.tabInfo);
          break;

        case 'pauseRecording':
          response = await pauseRecording(tabId);
          break;

        case 'resumeRecording':
          response = await resumeRecording(tabId);
          break;

        case 'stopRecording':
          response = await stopRecording(tabId);
          break;

        case 'addStep':
          response = await addStep(message.stepData);
          break;

        case 'getState':
          response = getState();
          break;

        case 'exportSession':
          response = await exportSession(message.sessionId, message.format);
          break;

        case 'getAllSessions':
          let sessions = await storage.getAllSessions();
          sessions.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
          response = { success: true, sessions };
          break;

        case 'getSessionSteps':
          let steps = await storage.getSteps(message.sessionId);
          steps.sort((a, b) => (a.sequence || 0) - (b.sequence || 0));
          response = { success: true, steps };
          break;

        case 'getScreenshot':
          response = await getScreenshot(message.stepId);
          break;

        case 'deleteSession':
          await storage.clearSession(message.sessionId);
          response = { success: true };
          break;

        case 'clearAllSessions':
          const allSessions = await storage.getAllSessions();
          for (const session of allSessions) {
            await storage.clearSession(session.sessionId);
          }
          response = { success: true };
          break;

        case 'captureScreenshot':
          if (!tabId) throw new Error('No tab context for screenshot');
          response = await captureScreenshot(tabId, true);
          break;

        case 'getSettings':
          const settings = await getSettings();
          response = { success: true, settings };
          break;

        case 'saveSettings':
          clearSettingsCache();
          await chrome.storage.local.set({ settings: message.settings });
          response = { success: true };
          break;

        default:
          response = { success: false, error: 'Unknown action' };
      }

      sendResponse(response);
    } catch (error) {
      console.error('Error handling message:', error);
      sendResponse({ success: false, error: error.message });
    }
  })();

  return true;
});

console.log('TestSnapper background service worker initialized');