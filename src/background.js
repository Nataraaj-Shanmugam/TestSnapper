/**
 * Background Service Worker - State management and message handling
 */

import { StorageManager } from './storage.js';

// State machine states
const States = {
  IDLE: 'idle',
  RECORDING: 'recording',
  PAUSED: 'paused',
  EXPORTING: 'exporting'
};

// Global state
let currentState = States.IDLE;
let currentSession = null;
let eventBuffer = [];
const storage = new StorageManager();

// Initialize storage
storage.init().catch(console.error);

/**
 * Generate UUID
 */
function generateUUID() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
    const r = Math.random() * 16 | 0;
    const v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

/**
 * Create a new recording session
 */
async function createSession(tabInfo) {
  const sessionId = generateUUID();
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
 * Generate Markdown format
 */
function generateMarkdown(exportData) {
  const { session, steps } = exportData;

  let content = `# Test Recording Session\n\n`;
  content += `**Session ID:** ${session.id}\n`;
  content += `**Created:** ${new Date(session.createdAt).toLocaleString()}\n`;
  content += `**URL:** ${session.environment.url}\n`;
  content += `**Page Title:** ${session.environment.title || 'N/A'}\n`;
  content += `**Total Steps:** ${session.stepCount}\n\n`;
  content += `---\n\n`;
  content += `## Steps\n\n`;

  steps.forEach((step, index) => {
    content += `### Step ${index + 1}: ${step.action}\n\n`;
    content += `- **Field Name:** ${step.fieldName || 'N/A'}\n`;
    content += `- **Selector (CSS):** \`${step.selector?.css || 'N/A'}\`\n`;
    if (step.selector?.xpath) {
      content += `- **Selector (XPath):** \`${step.selector.xpath}\`\n`;
    }
    if (step.selector?.text) {
      content += `- **Text Content:** "${step.selector.text}"\n`;
    }
    if (step.value) {
      content += `- **Value:** ${step.value}\n`;
    }
    content += `- **URL:** ${step.url}\n`;
    content += `- **Timestamp:** ${new Date(step.timestamp).toLocaleString()}\n`;
    if (step.notes) {
      content += `- **Notes:** ${step.notes}\n`;
    }
    content += `\n`;
  });

  return content;
}

/**
 * Generate DOCX file (simplified HTML-based approach)
 * Creates an HTML document that Word can open as DOCX
 */
function generateSimpleDocx(exportData) {
  const { session, steps } = exportData;

  // Generate HTML that Microsoft Word can open
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
    .step { border: 1px solid #ddd; padding: 15px; margin: 15px 0; border-radius: 5px; }
    .step-header { font-weight: bold; font-size: 16px; color: #2980b9; margin-bottom: 10px; }
    .step-detail { margin: 8px 0; padding-left: 15px; }
    .label { font-weight: bold; color: #555; display: inline-block; width: 120px; }
    .value { color: #333; }
    code { background: #f4f4f4; padding: 2px 6px; border-radius: 3px; font-family: 'Courier New', monospace; }
  </style>
</head>
<body>
  <h1>🎬 Test Recording Session</h1>
  
  <div class='info'>
    <p><span class='label'>Session ID:</span> <span class='value'>${session.id}</span></p>
    <p><span class='label'>Created:</span> <span class='value'>${new Date(session.createdAt).toLocaleString()}</span></p>
    <p><span class='label'>URL:</span> <span class='value'>${session.environment.url}</span></p>
    <p><span class='label'>Page Title:</span> <span class='value'>${session.environment.title || 'N/A'}</span></p>
    <p><span class='label'>Total Steps:</span> <span class='value'>${session.stepCount}</span></p>
  </div>
  
  <h2>📋 Recorded Steps</h2>
`;

  steps.forEach((step, index) => {
    html += `
  <div class='step'>
    <div class='step-header'>Step ${index + 1}: ${escapeHtml(step.action).toUpperCase()}</div>
    <div class='step-detail'>
      <span class='label'>Field Name:</span> 
      <span class='value'>${escapeHtml(step.fieldName || 'N/A')}</span>
    </div>
    <div class='step-detail'>
      <span class='label'>Selector (CSS):</span> 
      <code>${escapeHtml(step.selector?.css || 'N/A')}</code>
    </div>`;

    if (step.selector?.xpath) {
      html += `
    <div class='step-detail'>
      <span class='label'>Selector (XPath):</span> 
      <code>${escapeHtml(step.selector.xpath)}</code>
    </div>`;
    }

    if (step.selector?.text) {
      html += `
    <div class='step-detail'>
      <span class='label'>Text Content:</span> 
      <span class='value'>"${escapeHtml(step.selector.text)}"</span>
    </div>`;
    }

    if (step.value) {
      html += `
    <div class='step-detail'>
      <span class='label'>Value:</span> 
      <span class='value'>${escapeHtml(step.value)}</span>
    </div>`;
    }

    html += `
    <div class='step-detail'>
      <span class='label'>URL:</span> 
      <span class='value' style='font-size: 11px; word-break: break-all;'>${escapeHtml(step.url)}</span>
    </div>
    <div class='step-detail'>
      <span class='label'>Timestamp:</span> 
      <span class='value'>${new Date(step.timestamp).toLocaleString()}</span>
    </div>`;

    if (step.notes) {
      html += `
    <div class='step-detail'>
      <span class='label'>Notes:</span> 
      <span class='value'>${escapeHtml(step.notes)}</span>
    </div>`;
    }

    html += `
  </div>`;
  });

  html += `
</body>
</html>`;

  return html;
}

/**
 * Escape HTML special characters
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
 * Start recording
 */
async function startRecording(tabId, tabInfo) {
  if (currentState !== States.IDLE) {
    console.log('Cannot start: already recording or busy');
    return { success: false, error: 'Already recording' };
  }

  try {
    currentSession = await createSession(tabInfo);
    currentState = States.RECORDING;
    eventBuffer = [];

    // Update badge
    await chrome.action.setBadgeText({ text: 'REC', tabId });
    await chrome.action.setBadgeBackgroundColor({ color: '#FF0000', tabId });

    // ✅ Ensure content script is injected before sending message
    try {
      // Inject in correct order: dependencies first
      await chrome.scripting.executeScript({
        target: { tabId },
        files: ['src/selector.js']
      });

      await chrome.scripting.executeScript({
        target: { tabId },
        files: ['src/redactor.js']
      });

      await chrome.scripting.executeScript({
        target: { tabId },
        files: ['src/content.js']
      });

      console.log('Injected content scripts into tab:', tabId);
    } catch (injectErr) {
      // Check if already injected
      const isAlreadyInjected = injectErr.message && (
        injectErr.message.includes('already') ||
        injectErr.message.includes('duplicate')
      );

      if (!isAlreadyInjected) {
        console.error('Failed to inject content script:', injectErr);
        throw injectErr;
      }
      console.log('Content script already present in tab');
    }

    // ✅ Now safely send message to start recording
    await new Promise(resolve => setTimeout(resolve, 100));

    // ✅ Now safely send message to start recording
    try {
      await chrome.tabs.sendMessage(tabId, {
        action: 'startRecording',
        sessionId: currentSession.sessionId
      });
    } catch (msgErr) {
      console.error('Failed to send start message:', msgErr);
      throw new Error('Could not communicate with content script');
    }

    console.log('Recording started:', currentSession.sessionId);
    return { success: true, sessionId: currentSession.sessionId };

  } catch (error) {
    console.error('Failed to start recording:', error);
    currentState = States.IDLE;
    return { success: false, error: error.message };
  }
}

/**
 * Pause recording
 */
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

/**
 * Resume recording
 */
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

/**
 * Stop recording
 */
async function stopRecording(tabId) {
  if (currentState === States.IDLE) {
    return { success: false, error: 'Not recording' };
  }

  try {
    currentState = States.IDLE;
    chrome.action.setBadgeText({ text: '', tabId });

    // Notify content script
    await chrome.tabs.sendMessage(tabId, { action: 'stopRecording' });

    const sessionId = currentSession?.sessionId;
    currentSession = null;
    eventBuffer = [];

    console.log('Recording stopped:', sessionId);
    return { success: true, sessionId };
  } catch (error) {
    console.error('Failed to stop recording:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Capture screenshot
 */
async function captureScreenshot(tabId) {
  if (currentState !== States.RECORDING) {
    return { success: false, error: 'Not recording' };
  }

  try {
    const screenshot = await chrome.tabs.captureVisibleTab(null, {
      format: 'png'
    });

    // Create a screenshot step
    const stepData = {
      action: 'screenshot',
      selector: null,
      fieldName: 'Screenshot',
      targetLabel: 'Manual Screenshot',
      url: (await chrome.tabs.get(tabId)).url,
      value: screenshot, // Base64 image data
      isSensitive: false
    };

    const result = await addStep(stepData);
    return { success: true, stepId: result.step.id };
  } catch (error) {
    console.error('Failed to capture screenshot:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Add step to current session
 */
async function addStep(stepData) {
  if (!currentSession) {
    console.error('No active session');
    return { success: false, error: 'No active session' };
  }

  try {
    const step = {
      id: generateUUID(),
      sessionId: currentSession.sessionId,
      timestamp: new Date().toISOString(),
      ...stepData
    };

    await storage.addStep(step);
    currentSession.stepCount++;
    await storage.updateSession(currentSession);

    console.log('Step added:', step.action, step.fieldName);
    return { success: true, step };
  } catch (error) {
    console.error('Failed to add step:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Get current state
 */
function getState() {
  return {
    state: currentState,
    session: currentSession,
    stepCount: currentSession?.stepCount || 0
  };
}

/**
 * Export session
 */
async function exportSession(sessionId, format = 'json') {
  try {
    currentState = States.EXPORTING;

    const session = await storage.getSession(sessionId);
    const steps = await storage.getSteps(sessionId);

    if (!session || steps.length === 0) {
      throw new Error('Session not found or has no steps');
    }

    const exportData = {
      session: {
        id: session.sessionId,
        createdAt: session.createdAt,
        environment: session.env,
        stepCount: steps.length
      },
      steps: steps.map((step, index) => ({
        stepNumber: index + 1,
        timestamp: step.timestamp,
        action: step.action,
        fieldName: step.fieldName,
        selector: step.selector,
        value: step.value,
        url: step.url,
        notes: step.notes || ''
      }))
    };

    let content, filename, mimeType;

    if (format === 'json') {
      content = JSON.stringify(exportData, null, 2);
      filename = `testsnapper_${sessionId.substring(0, 8)}_${Date.now()}.json`;
      mimeType = 'application/json';
    } else if (format === 'csv') {
      // CSV format
      const headers = ['Step', 'Timestamp', 'Action', 'Field Name', 'Selector (CSS)', 'Value', 'URL', 'Notes'];
      const rows = exportData.steps.map(step => [
        step.stepNumber,
        step.timestamp,
        step.action,
        step.fieldName,
        step.selector?.css || '',
        step.value || '',
        step.url,
        step.notes
      ]);

      content = [headers, ...rows]
        .map(row => row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(','))
        .join('\n');

      filename = `testsnapper_${sessionId.substring(0, 8)}_${Date.now()}.csv`;
      mimeType = 'text/csv';
    } else if (format === 'docx') {
      // DOCX format (HTML-based that Word can open)
      content = generateSimpleDocx(exportData);
      filename = `testsnapper_${sessionId.substring(0, 8)}_${Date.now()}.doc`;
      mimeType = 'application/msword';
    } else if (format === 'markdown') {
      // Markdown format
      content = generateMarkdown(exportData);
      filename = `testsnapper_${sessionId.substring(0, 8)}_${Date.now()}.md`;
      mimeType = 'text/markdown';
    }

    // Create blob and download
    let dataUrl;
    if (content.length > 1000000) {
      // For large files, create a simpler data URL without base64
      dataUrl = `data:${mimeType};charset=utf-8,${encodeURIComponent(content)}`;
    } else {
      // For smaller files, use base64
      const base64Content = btoa(unescape(encodeURIComponent(content)));
      dataUrl = `data:${mimeType};base64,${base64Content}`;
    }

    await chrome.downloads.download({
      url: dataUrl,
      filename: filename,
      saveAs: true
    });

    currentState = States.IDLE;
    console.log('Export completed:', filename);
    return { success: true, filename };
  } catch (error) {
    console.error('Export failed:', error);
    currentState = States.IDLE;
    return { success: false, error: error.message };
  }
}

// Helper function to safely resolve the tab ID
async function getSenderTabId(sender) {
  if (sender?.tab?.id) return sender.tab.id;
  const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return activeTab?.id;
}

// Global message handler
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log('Background received message:', message.action);

  (async () => {
    try {
      let response;
      const tabId = await getSenderTabId(sender);

      switch (message.action) {
        case 'startRecording': {
          if (!tabId) throw new Error('No tab context for startRecording');
          response = await startRecording(tabId, message.tabInfo);
          break;
        }

        case 'pauseRecording': {
          if (!tabId) throw new Error('No tab context for pauseRecording');
          response = await pauseRecording(tabId);
          break;
        }

        case 'resumeRecording': {
          if (!tabId) throw new Error('No tab context for resumeRecording');
          response = await resumeRecording(tabId);
          break;
        }

        case 'stopRecording': {
          if (!tabId) throw new Error('No tab context for stopRecording');
          response = await stopRecording(tabId);
          break;
        }

        case 'addStep': {
          response = await addStep(message.stepData);
          break;
        }

        case 'getState': {
          response = getState();
          break;
        }

        case 'exportSession': {
          response = await exportSession(message.sessionId, message.format);
          break;
        }

        case 'getAllSessions': {
          const sessions = await storage.getAllSessions();
          response = { success: true, sessions };
          break;
        }

        case 'getSessionSteps': {
          const steps = await storage.getSteps(message.sessionId);
          response = { success: true, steps };
          break;
        }

        case 'deleteSession': {
          const result = await storage.clearSession(message.sessionId);
          response = { success: true };
          break;
        }

        case 'clearAllSessions': {
          const sessions = await storage.getAllSessions();
          for (const session of sessions) {
            await storage.clearSession(session.sessionId);
          }
          response = { success: true };
          break;
        }

        case 'captureScreenshot': {
          if (!tabId) throw new Error('No tab context for screenshot');
          response = await captureScreenshot(tabId);
          break;
        }

        default:
          response = { success: false, error: 'Unknown action' };
      }

      sendResponse(response);
    } catch (error) {
      console.error('Error handling message:', error);
      sendResponse({ success: false, error: error.message });
    }
  })();

  // Keep the message channel open for async responses
  return true;
});



console.log('TestSnapper background service worker initialized');
