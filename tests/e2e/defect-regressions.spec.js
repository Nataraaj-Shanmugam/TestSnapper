/**
 * Regression tests for content-script defects fixed on fix/remaining-defects.
 *
 * These drive the real extension on a real page (via a routed test origin) and
 * read the recorded steps back from the background, so they assert on exact
 * actions, order and fields rather than on a rendered card count.
 *
 *   Q-1  Enter in a form-less input (a JS search box) was never recorded, and
 *        the 800ms input debounce would have recorded it BEFORE the typed text.
 *   F-4  "Skip" on the field-name prompt discarded the step itself.
 */
const { test, expect, chromium } = require('@playwright/test');
const path = require('path');

const EXTENSION_PATH = path.join(__dirname, '../../dist');
const TEST_ORIGIN = 'http://testsnapper-e2e.test';

let context;
let extensionId;

test.beforeAll(async () => {
  context = await chromium.launchPersistentContext('', {
    headless: false,
    args: [
      `--disable-extensions-except=${EXTENSION_PATH}`,
      `--load-extension=${EXTENSION_PATH}`,
      '--no-sandbox',
      '--disable-dev-shm-usage',
    ],
  });
  let sw = context.serviceWorkers()[0];
  if (!sw) sw = await context.waitForEvent('serviceworker', { timeout: 10_000 });
  extensionId = new URL(sw.url()).hostname;
});

test.afterAll(async () => {
  await context?.close();
});

/** An extension page we can use to talk to the background. */
async function extensionPage() {
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/src/ui/popup/popup.html`);
  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(600);
  return page;
}

function send(page, message) {
  return page.evaluate((m) => new Promise((resolve) => chrome.runtime.sendMessage(m, resolve)), message);
}

/**
 * Serve `body` at a routed path, start recording on it, run `interact`, stop,
 * and return the recorded steps in sequence order.
 */
async function record(pathname, body, interact) {
  await context.route(`${TEST_ORIGIN}${pathname}`, (route) =>
    route.fulfill({ status: 200, contentType: 'text/html', body: `<html><body>${body}</body></html>` }));

  const target = await context.newPage();
  await target.goto(`${TEST_ORIGIN}${pathname}`);
  await target.waitForLoadState();
  await target.waitForTimeout(400);

  const ctl = await extensionPage();
  const tabId = await ctl.evaluate(async (url) => {
    const tabs = await chrome.tabs.query({});
    return tabs.find((t) => t.url === url)?.id ?? null;
  }, `${TEST_ORIGIN}${pathname}`);
  expect(tabId, 'target tab should be found').not.toBeNull();

  const started = await send(ctl, {
    action: 'startRecording',
    tabId,
    tabInfo: { url: `${TEST_ORIGIN}${pathname}`, title: pathname, width: 1280, height: 800, tabId },
  });
  expect(started?.success, `startRecording failed: ${started?.error}`).toBe(true);
  const sessionId = started.sessionId;

  await target.bringToFront();
  await interact(target);

  // Stop through the background so the review tab it opens can be closed.
  const reviewOpened = context.waitForEvent('page', { timeout: 8_000 }).catch(() => null);
  const stopped = await send(ctl, { action: 'stopRecording', tabId });
  expect(stopped?.success, `stopRecording failed: ${stopped?.error}`).toBe(true);
  const review = await reviewOpened;

  const res = await send(ctl, { action: 'getSessionSteps', sessionId });
  await review?.close().catch(() => {});
  await ctl.close().catch(() => {});
  await target.close().catch(() => {});
  return res?.steps || [];
}

test('Q-1: Enter in a form-less input is recorded, after the text it submits', async () => {
  const steps = await record(
    '/enter-search',
    '<label for="q">Search</label><input id="q" name="q" type="search">',
    async (page) => {
      const q = page.locator('#q');
      await q.click();
      await q.fill('shoes');
      // Press Enter well inside the 800ms input debounce: before the fix the
      // Enter step would have been sent first (or the text lost on navigation).
      await q.press('Enter');
      await page.waitForTimeout(1_200);
    }
  );

  const typed = steps.find((s) => s.action === 'type' && s.value === 'shoes');
  const enter = steps.find((s) => s.action === 'keypress' && s.value === 'Enter');
  expect(typed, `a type step with "shoes" — got ${JSON.stringify(steps.map((s) => s.action))}`).toBeTruthy();
  expect(enter, 'a keypress step for Enter').toBeTruthy();
  expect(typed.sequence).toBeLessThan(enter.sequence);
});

test('Q-1: Enter inside a <form> is left to the submit step (no duplicate keypress)', async () => {
  const steps = await record(
    '/enter-form',
    '<form onsubmit="event.preventDefault()"><label for="f">City</label><input id="f" name="city"></form>',
    async (page) => {
      await page.locator('#f').fill('Leeds');
      await page.locator('#f').press('Enter');
      await page.waitForTimeout(1_200);
    }
  );
  expect(steps.some((s) => s.action === 'keypress'), 'no keypress step inside a form').toBe(false);
  expect(steps.some((s) => s.action === 'submit'), 'the form submission is recorded').toBe(true);
});

test('F-4: "Name later" on the field-name prompt keeps the step', async () => {
  const steps = await record(
    '/unnamed-field',
    // No label, id, name, placeholder or nearby text: the resolver cannot name
    // this field, so the prompt appears.
    '<input>',
    async (page) => {
      await page.locator('input').fill('blue');
      const later = page.getByRole('button', { name: 'Name later' });
      await later.waitFor({ state: 'visible', timeout: 5_000 });
      await later.click();
      await page.waitForTimeout(800);
    }
  );

  const typed = steps.find((s) => s.action === 'type' && s.value === 'blue');
  expect(typed, `the typed step survives — got ${JSON.stringify(steps.map((s) => s.action))}`).toBeTruthy();
  expect(typed.fieldName).toBe('Unnamed field');
  expect(typed.needsName).toBe(true);
});

test('Stop right after typing keeps the text (pending input is flushed first)', async () => {
  const steps = await record(
    '/stop-while-typing',
    '<label for="note">Note</label><input id="note" name="note" type="text">',
    async (page) => {
      const note = page.locator('#note');
      await note.click();
      await note.fill('last words');
      // No wait: stop arrives well inside the 800ms input debounce, the way
      // the stop keyboard shortcut does. Before the fix the stop cleared the
      // debounce timer and the text was never recorded.
    }
  );

  const typed = steps.find((s) => s.action === 'type' && s.value === 'last words');
  expect(typed, `a type step with "last words" — got ${JSON.stringify(steps.map((s) => [s.action, s.value]))}`).toBeTruthy();
});

test('Q-2: deliberate repeated clicks are each recorded', async () => {
  const steps = await record(
    '/repeat-click',
    '<button id="add" type="button">Add item</button>',
    async (page) => {
      for (let i = 0; i < 3; i++) {
        await page.locator('#add').click();
        await page.waitForTimeout(700); // clearly deliberate, outside the double-fire window
      }
    }
  );

  const clicks = steps.filter((s) => s.action === 'click');
  expect(clicks.length, `three click steps — got ${JSON.stringify(steps.map((s) => s.action))}`).toBe(3);
});
