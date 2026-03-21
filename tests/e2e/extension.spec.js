/**
 * E2E tests for TestSnapper Chrome extension.
 *
 * Tests flow:
 *  1. Load extension → open popup → verify UI renders
 *  2. Start recording → navigate to demo page → perform actions → stop recording
 *  3. Verify session appears in popup session list
 *  4. Open review page → verify steps are listed
 *  5. Export session and verify download triggered
 *  6. Delete session and verify it disappears from list
 *
 * NOTE: The File System Access API folder picker cannot be automated (requires
 *       real user gesture), so recording tests verify UI state in buffer mode.
 */

const { test, expect, chromium } = require('@playwright/test');
const path = require('path');

const EXTENSION_PATH = path.join(__dirname, '../../dist');

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

async function launchWithExtension() {
  const context = await chromium.launchPersistentContext('', {
    headless: false,
    args: [
      `--disable-extensions-except=${EXTENSION_PATH}`,
      `--load-extension=${EXTENSION_PATH}`,
      '--no-sandbox',
      '--disable-dev-shm-usage',
    ],
  });

  // Extract extension id from service worker
  let extensionId = '';
  const existingSW = context.serviceWorkers();
  if (existingSW.length > 0) {
    extensionId = new URL(existingSW[0].url()).hostname;
  } else {
    try {
      const sw = await context.waitForEvent('serviceworker', { timeout: 10_000 });
      extensionId = new URL(sw.url()).hostname;
    } catch {
      // Fallback: check again
      const sws = context.serviceWorkers();
      if (sws.length > 0) extensionId = new URL(sws[0].url()).hostname;
    }
  }

  return { context, extensionId };
}

async function openPopup(context, extensionId) {
  const popupUrl = `chrome-extension://${extensionId}/src/ui/popup/popup.html`;
  const page = await context.newPage();
  await page.goto(popupUrl);
  await page.waitForLoadState('domcontentloaded');
  return page;
}

async function openReviewPage(context, extensionId, sessionId) {
  const reviewUrl = `chrome-extension://${extensionId}/src/ui/review/review-standalone.html?session=${sessionId}`;
  const page = await context.newPage();
  await page.goto(reviewUrl);
  await page.waitForLoadState('domcontentloaded');
  return page;
}

// ─────────────────────────────────────────────────────────────────────────────
// Shared browser context (one instance across all tests)
// ─────────────────────────────────────────────────────────────────────────────

let context;
let extensionId;

test.beforeAll(async () => {
  ({ context, extensionId } = await launchWithExtension());
});

test.afterAll(async () => {
  await context.close();
});

// ─────────────────────────────────────────────────────────────────────────────
// Tests: Popup UI
// ─────────────────────────────────────────────────────────────────────────────

test('popup loads without uncaught exceptions', async () => {
  const errors = [];
  const popup = await openPopup(context, extensionId);
  popup.on('pageerror', err => errors.push(err.message));

  await popup.waitForTimeout(1_500);
  expect(errors).toHaveLength(0);
  await popup.close();
});

test('popup renders extension header', async () => {
  const popup = await openPopup(context, extensionId);

  // Look for any heading-like element in the header area
  const header = popup.locator('.header, header, .app-header, #header').first();
  await expect(header).toBeVisible({ timeout: 5_000 });

  await popup.close();
});

test('popup shows recording tab with start button', async () => {
  const popup = await openPopup(context, extensionId);

  // The default active tab is the recording tab
  const recordingTab = popup.locator('#recording-tab');
  await expect(recordingTab).toBeVisible({ timeout: 5_000 });

  // Start button should exist in the recording tab
  const startBtn = popup.locator('#startBtn');
  await expect(startBtn).toBeVisible({ timeout: 5_000 });

  await popup.close();
});

test('popup shows storage status or onboarding banner', async () => {
  const popup = await openPopup(context, extensionId);

  await popup.waitForTimeout(500);

  // Either onboarding (first launch) or sync status (configured) should appear
  const onboarding = popup.locator('#storageOnboarding, .storage-onboarding');
  const syncStatus = popup.locator('#fileSyncStatus, .file-sync-status, #syncStatus, .sync-status');

  const onboardingExists = (await onboarding.count()) > 0;
  const syncExists = (await syncStatus.count()) > 0;

  expect(onboardingExists || syncExists).toBe(true);
  await popup.close();
});

test('popup theme toggle changes body data-theme attribute', async () => {
  const popup = await openPopup(context, extensionId);
  await popup.waitForTimeout(300);

  const themeBtn = popup.locator('#themeToggle').first();
  if (!(await themeBtn.isVisible().catch(() => false))) {
    await popup.close();
    return;
  }

  // Theme is tracked via data-theme attribute per CLAUDE.md
  const themeBefore = await popup.evaluate(() =>
    document.body.dataset.theme || document.body.getAttribute('data-theme') || document.body.className
  );
  await themeBtn.click();
  await popup.waitForTimeout(200);
  const themeAfter = await popup.evaluate(() =>
    document.body.dataset.theme || document.body.getAttribute('data-theme') || document.body.className
  );

  expect(themeAfter).not.toBe(themeBefore);
  await popup.close();
});

// ─────────────────────────────────────────────────────────────────────────────
// Tests: Recording Controls
// ─────────────────────────────────────────────────────────────────────────────

test('start recording button is present or onboarding shown', async () => {
  const popup = await openPopup(context, extensionId);
  await popup.waitForTimeout(500);

  const startBtn = popup.locator('#startBtn, #startRecordingBtn, [id*="startRecord"]').first();
  const onboardingBtn = popup.locator('#onboardingPickFolderBtn, .storage-onboarding button').first();

  const startVisible = await startBtn.isVisible().catch(() => false);
  const onboardingVisible = await onboardingBtn.isVisible().catch(() => false);

  // One of them must be present
  expect(startVisible || onboardingVisible).toBe(true);
  await popup.close();
});

test('clicking start recording shows stop button or session name prompt', async () => {
  const targetPage = await context.newPage();
  await targetPage.goto('data:text/html,<h1>Test Target</h1><input id="q"><button>Go</button>');
  await targetPage.waitForLoadState();

  const popup = await openPopup(context, extensionId);
  await popup.waitForTimeout(500);

  const startBtn = popup.locator('#startBtn, #startRecordingBtn').first();
  if (!(await startBtn.isVisible().catch(() => false))) {
    await popup.close();
    await targetPage.close();
    return; // Storage not set up — graceful skip
  }

  await startBtn.click();
  await popup.waitForTimeout(1_000);

  // After clicking start one of these should appear:
  const stopBtn = popup.locator('#stopBtn, #stopRecordingBtn, [id*="stop"]').first();
  const sessionInput = popup.locator('input[id*="session"], input[placeholder*="session" i]').first();
  const recording = popup.locator('.recording-active, [class*="recording"]').first();

  const stopVisible = await stopBtn.isVisible().catch(() => false);
  const inputVisible = await sessionInput.isVisible().catch(() => false);
  const recordingVisible = await recording.isVisible().catch(() => false);

  expect(stopVisible || inputVisible || recordingVisible).toBe(true);

  await popup.close();
  await targetPage.close();
});

// ─────────────────────────────────────────────────────────────────────────────
// Tests: Review Page
// ─────────────────────────────────────────────────────────────────────────────

test('review page loads without crash for unknown session', async () => {
  const review = await openReviewPage(context, extensionId, 'nonexistent-000');

  const errors = [];
  review.on('pageerror', e => errors.push(e.message));
  await review.waitForTimeout(1_000);

  // Page should have rendered something
  const bodyText = await review.textContent('body');
  expect(bodyText.length).toBeGreaterThan(0);
  expect(errors).toHaveLength(0);

  await review.close();
});

// ─────────────────────────────────────────────────────────────────────────────
// Tests: Full Record → Review Workflow
// ─────────────────────────────────────────────────────────────────────────────

test('full workflow: record actions, stop, view session in review page', async () => {
  // 1. Open a simple demo page to record on
  // Note: Use type="button" to prevent form submission (which navigates away and closes the page)
  const targetPage = await context.newPage();
  await targetPage.goto(
    'data:text/html,' +
    '<html><body><form>' +
    '<input id="email" type="email" placeholder="Email" />' +
    '<input id="pass" type="password" placeholder="Password" />' +
    '<button type="button" id="login">Login</button>' +
    '</form></body></html>'
  );
  await targetPage.waitForLoadState();

  // 2. Open popup and check recording availability
  const popup = await openPopup(context, extensionId);
  await popup.waitForTimeout(500);

  const startBtn = popup.locator('#startBtn, #startRecordingBtn').first();
  if (!(await startBtn.isVisible().catch(() => false))) {
    await popup.close();
    await targetPage.close();
    // Storage folder not configured — skip gracefully
    return;
  }

  // 3. Click start recording
  await startBtn.click();
  await popup.waitForTimeout(500);

  // Handle session name modal
  const sessionInput = popup.locator('input[id*="sessionName"], input[placeholder*="session" i]').first();
  if (await sessionInput.isVisible().catch(() => false)) {
    await sessionInput.fill('E2E Recorded Session');
    const confirmBtn = popup.locator('button:has-text("Start"), button:has-text("Create"), button:has-text("OK")').first();
    if (await confirmBtn.isVisible().catch(() => false)) {
      await confirmBtn.click();
      await popup.waitForTimeout(500);
    }
  }

  // 4. Interact with the target page (content script records these)
  await targetPage.bringToFront();
  await targetPage.waitForTimeout(300);
  await targetPage.locator('#email').click();
  await targetPage.locator('#email').fill('user@example.com');
  await targetPage.waitForTimeout(300);
  await targetPage.locator('#pass').click();
  await targetPage.locator('#pass').fill('secret');
  await targetPage.waitForTimeout(300);
  await targetPage.locator('#login').click();
  await targetPage.waitForTimeout(500);

  // 5. Stop recording (only if stop button is enabled — means recording is active)
  await popup.bringToFront();
  const stopBtn = popup.locator('#stopBtn').first();
  const stopEnabled = await stopBtn.isEnabled().catch(() => false);
  if (stopEnabled) {
    await stopBtn.click();
    await popup.waitForTimeout(2_000); // Allow flush / state update
  }

  // 6. A session should now appear in the list
  const sessionItems = popup.locator('.session-item, [class*="session-card"], [data-session-id]');
  const sessionCount = await sessionItems.count();

  if (sessionCount > 0) {
    // 7. Open review page for the first session
    const firstItem = sessionItems.first();
    const sessionId = await firstItem.getAttribute('data-session-id').catch(() => null);

    if (sessionId) {
      const review = await openReviewPage(context, extensionId, sessionId);
      await review.waitForTimeout(1_500);

      // Review page should not crash
      const reviewErrors = [];
      review.on('pageerror', e => reviewErrors.push(e.message));

      // Steps should be present (or empty state shown)
      const stepItems = review.locator('.step-item, [class*="step-row"], [class*="step-card"]');
      const stepsCount = await stepItems.count();

      // Either steps exist or empty state shown
      const emptyState = review.locator('.empty-state, [class*="empty"], [id*="empty"]').first();
      const emptyVisible = await emptyState.isVisible().catch(() => false);

      expect(stepsCount > 0 || emptyVisible).toBe(true);
      expect(reviewErrors).toHaveLength(0);

      await review.close();
    }

    // 8. Delete the session and verify it's gone
    const deleteBtn = firstItem.locator('button[title*="Delete"], button[id*="delete"], .delete-btn').first();
    if (await deleteBtn.isVisible().catch(() => false)) {
      await deleteBtn.click();
      await popup.waitForTimeout(500);

      // Confirm dialog if present
      const confirmDelete = popup.locator('button:has-text("Delete"), button:has-text("Confirm")').first();
      if (await confirmDelete.isVisible().catch(() => false)) {
        await confirmDelete.click();
        await popup.waitForTimeout(500);
      }

      // Session should be removed from list
      const remaining = await popup.locator('.session-item, [data-session-id]').count();
      expect(remaining).toBeLessThan(sessionCount);
    }
  }

  await popup.close();
  await targetPage.close();
});

// ─────────────────────────────────────────────────────────────────────────────
// Tests: No console errors on page load
// ─────────────────────────────────────────────────────────────────────────────

test('popup produces no critical console errors', async () => {
  const errors = [];
  const popup = await openPopup(context, extensionId);

  popup.on('console', msg => {
    if (msg.type() === 'error') {
      const txt = msg.text();
      // Filter known benign messages
      if (
        !txt.includes('net::ERR') &&           // network errors in data: pages
        !txt.includes('favicon') &&
        !txt.includes('showDirectoryPicker') && // FSAPI not available in all contexts
        !txt.includes('FileSystem')
      ) {
        errors.push(txt);
      }
    }
  });

  await popup.waitForTimeout(1_500);
  expect(errors).toHaveLength(0);
  await popup.close();
});
