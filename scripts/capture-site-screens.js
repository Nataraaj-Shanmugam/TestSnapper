#!/usr/bin/env node

/**
 * Capture the real extension UI for the GitHub Pages walkthrough.
 *
 * Loads the built extension (dist/) in Playwright's Chromium, records a short
 * session on a sample sign-in page, and writes:
 *   docs/img/walk-*.png        screenshots of the popup, page and review UI
 *   docs/samples/*             the real Word, PDF, CSV, JSON and Markdown exports
 *   docs/site-data.js          frame list (image, caption, click target) and the
 *                              CSV/JSON/Markdown sample text that
 *                              docs/index.html plays as a GIF-style walkthrough
 *
 * Re-run after any UI change so the site always shows the current screens:
 *   npm run build && npm run site:screens
 *
 * The sample page is served by request interception, so nothing touches the
 * network and the session contains only the fixture data below.
 */

const fs = require('fs');
const path = require('path');
const { chromium } = require('@playwright/test');

const ROOT = path.join(__dirname, '..');
const DIST = path.join(ROOT, 'dist');
const IMG_DIR = path.join(ROOT, 'docs', 'img');
const SAMPLE_DIR = path.join(ROOT, 'docs', 'samples');
const ORIGIN = 'https://staging.example.com';
const SESSION_NAME = 'Sign-in smoke test';
// Keep "HeadlessChrome" out of the sample exports' environment field
// (the flag also covers the extension's service worker).
const USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36';

const PAGE_CSS = `
  body { margin: 0; font: 15px/1.5 system-ui, -apple-system, 'Segoe UI', sans-serif; background: #f4f6fb; color: #1d2433; }
  header { display: flex; align-items: center; gap: 10px; padding: 14px 32px; background: #fff; border-bottom: 1px solid #e3e8f2; font-weight: 700; }
  header i { width: 22px; height: 22px; border-radius: 6px; background: #5b6cff; }
  main { max-width: 360px; margin: 72px auto; background: #fff; border: 1px solid #e3e8f2; border-radius: 12px; padding: 28px; }
  h1 { font-size: 20px; margin: 0 0 18px; }
  label { display: block; font-size: 13px; color: #5b6478; margin: 14px 0 6px; }
  input { width: 100%; box-sizing: border-box; height: 38px; padding: 0 10px; border: 1px solid #cfd6e4; border-radius: 8px; font: inherit; }
  button { margin-top: 20px; width: 100%; height: 40px; border: 0; border-radius: 8px; background: #5b6cff; color: #fff; font: 600 15px system-ui; }
  .banner { padding: 14px 16px; border-radius: 8px; background: #e8f6ee; color: #1e6b43; font-weight: 600; }
`;
const SIGN_IN = `<!doctype html><html><head><title>Acme: Sign in</title><style>${PAGE_CSS}</style></head><body>
  <header><i></i>Acme Portal</header>
  <main><h1>Sign in</h1>
    <form action="/dashboard" method="post">
      <label for="username">Username</label><input id="username" name="username" autocomplete="off">
      <label for="password">Password</label><input id="password" name="password" type="password">
      <button type="submit" data-testid="sign-in-submit">Sign in</button>
    </form>
  </main></body></html>`;
const DASHBOARD = `<!doctype html><html><head><title>Acme: Dashboard</title><style>${PAGE_CSS}</style></head><body>
  <header><i></i>Acme Portal</header>
  <main><h1>Dashboard</h1><p class="banner">Welcome back, qa_lead</p></main></body></html>`;

const frames = [];

/** Screenshot a page and remember a click target (as % of the image). */
async function frame(page, file, { chapter, caption, target, url }) {
  await page.waitForTimeout(250);
  const vp = page.viewportSize();
  await page.screenshot({ path: path.join(IMG_DIR, file) });
  let click = null;
  if (target) {
    const box = await page.locator(target).first().boundingBox().catch(() => null);
    if (box) {
      click = {
        x: +(((box.x + box.width / 2) / vp.width) * 100).toFixed(2),
        y: +(((box.y + box.height / 2) / vp.height) * 100).toFixed(2)
      };
    }
  }
  frames.push({ img: `img/${file}`, width: vp.width, height: vp.height, chapter, caption, url, click });
  console.log(`  ${file}`);
}

async function send(page, message) {
  return page.evaluate((m) => new Promise((resolve) => chrome.runtime.sendMessage(m, resolve)), message);
}

async function main() {
  if (!fs.existsSync(path.join(DIST, 'manifest.json'))) {
    throw new Error('dist/ not found. Run "npm run build" first.');
  }
  fs.mkdirSync(IMG_DIR, { recursive: true });
  fs.mkdirSync(SAMPLE_DIR, { recursive: true });

  const context = await chromium.launchPersistentContext('', {
    channel: 'chromium',
    // Optional: point at an already-installed Chromium instead of the one
    // matching this Playwright version (`npx playwright install chromium`).
    executablePath: process.env.CHROMIUM_PATH || undefined,
    headless: true,
    acceptDownloads: true,
    viewport: { width: 1200, height: 750 },
    args: [`--disable-extensions-except=${DIST}`, `--load-extension=${DIST}`, `--user-agent=${USER_AGENT}`]
  });

  try {
    await context.route(`${ORIGIN}/**`, (route) => {
      const url = new URL(route.request().url());
      const body = url.pathname.startsWith('/dashboard') ? DASHBOARD : SIGN_IN;
      return route.fulfill({ status: 200, contentType: 'text/html', body });
    });

    let sw = context.serviceWorkers()[0];
    if (!sw) sw = await context.waitForEvent('serviceworker', { timeout: 15000 });
    const extId = new URL(sw.url()).hostname;
    const popupUrl = `chrome-extension://${extId}/src/ui/popup/popup.html`;

    // The page under test
    const site = await context.newPage();
    await site.goto(`${ORIGIN}/sign-in`);
    await site.waitForTimeout(500);

    // 1. Popup, ready to record
    const popup = await context.newPage();
    await popup.setViewportSize({ width: 380, height: 600 });
    await popup.goto(popupUrl);
    await popup.waitForTimeout(800);
    await frame(popup, 'walk-01-popup.png', {
      chapter: 0, caption: 'Open TestSnapper and press Start', target: '#startBtn', url: 'TestSnapper popup'
    });

    const tabId = await popup.evaluate(async (origin) => {
      const tabs = await chrome.tabs.query({});
      return tabs.find((t) => t.url && t.url.startsWith(origin)).id;
    }, ORIGIN);
    const started = await send(popup, {
      action: 'startRecording', tabId,
      tabInfo: { url: `${ORIGIN}/sign-in`, title: SESSION_NAME, width: 1200, height: 750, tabId }
    });
    if (!started || !started.success) throw new Error('startRecording failed: ' + JSON.stringify(started));
    await popup.close();

    // 2. Use the site
    await site.bringToFront();
    await site.waitForTimeout(600);
    await frame(site, 'walk-02-page.png', {
      chapter: 1, caption: 'Use the site as normal', target: '#username', url: `${ORIGIN}/sign-in`
    });
    await site.locator('#username').focus();
    await site.locator('#username').pressSequentially('qa_lead', { delay: 40 });
    await site.locator('#password').focus();
    await frame(site, 'walk-03-typed.png', {
      chapter: 1, caption: 'Each action is recorded as a step', target: '#password', url: `${ORIGIN}/sign-in`
    });
    await site.locator('#password').pressSequentially('correct-horse', { delay: 30 });
    await site.waitForTimeout(300);
    await frame(site, 'walk-04-password.png', {
      chapter: 1, caption: 'Passwords are masked as they are recorded', target: '[data-testid="sign-in-submit"]', url: `${ORIGIN}/sign-in`
    });
    await site.locator('[data-testid="sign-in-submit"]').click();
    await site.waitForURL('**/dashboard**');
    await site.waitForTimeout(1200);
    await frame(site, 'walk-05-dashboard.png', {
      chapter: 1, caption: 'Page changes are captured too', url: `${ORIGIN}/dashboard`
    });

    // 3. Popup with live steps, then stop
    const popup2 = await context.newPage();
    await popup2.setViewportSize({ width: 380, height: 600 });
    await popup2.goto(popupUrl);
    await popup2.waitForTimeout(1000);
    await frame(popup2, 'walk-06-popup-live.png', {
      chapter: 2, caption: 'Press Stop when you are done', target: '#stopBtn', url: 'TestSnapper popup'
    });
    const reviewOpened = context.waitForEvent('page', { timeout: 15000 });
    await send(popup2, { action: 'stopRecording', tabId });
    const review = await reviewOpened;
    await review.setViewportSize({ width: 1200, height: 750 });
    await review.waitForLoadState('domcontentloaded');
    await review.waitForTimeout(2000);
    await popup2.close().catch(() => {});

    // 4. Review page
    await review.locator('#sessionName').fill(SESSION_NAME).catch(() => {});
    await review.locator('#sessionAuthor').fill('QA team').catch(() => {});
    await review.evaluate(() => window.scrollTo(0, 0));
    await frame(review, 'walk-07-review.png', {
      chapter: 2, caption: 'Review, rename and reorder the steps', target: '#stepsContainer input', url: 'TestSnapper review'
    });
    await review.locator('#privacyAuditBtn').click();
    await review.waitForTimeout(600);
    await frame(review, 'walk-08-privacy.png', {
      chapter: 2, caption: 'The privacy audit lists what was masked', url: 'TestSnapper review'
    });
    await review.locator('#closePrivacyAudit').click();

    // 5. Export
    await review.locator('#exportFormat').selectOption('docx');
    await review.evaluate(() => window.scrollTo(0, 0));
    await frame(review, 'walk-09-export.png', {
      chapter: 3, caption: 'Pick a format and export', target: '#saveExportBtn', url: 'TestSnapper review'
    });
    await review.locator('#exportConfigDetails summary').click();
    await review.waitForTimeout(300);
    await review.locator('#previewExportBtn').click();
    await review.waitForTimeout(800);
    await frame(review, 'walk-10-preview.png', {
      chapter: 3, caption: 'Preview the document before you save it', url: 'TestSnapper review'
    });
    await review.locator('#closeExportPreview').click();

    // Real export files for the site's samples section
    const exts = { docx: 'docx', pdf: 'pdf', csv: 'csv', json: 'json', markdown: 'md' };
    for (const [fmt, ext] of Object.entries(exts)) {
      await review.locator('#exportFormat').selectOption(fmt);
      const dl = review.waitForEvent('download', { timeout: 30000 });
      await review.locator('#saveExportBtn').click();
      const file = await dl;
      await file.saveAs(path.join(SAMPLE_DIR, `sign-in-smoke-test.${ext}`));
      console.log(`  samples/sign-in-smoke-test.${ext}`);
      await review.waitForTimeout(500);
    }

    // Social share card (og:image), built from the icon and the review screen
    const b64 = (f) => fs.readFileSync(f).toString('base64');
    const card = await context.newPage();
    await card.setViewportSize({ width: 1200, height: 630 });
    await card.setContent(`<!doctype html><html><body style="margin:0;width:1200px;height:630px;overflow:hidden;
      background:#2F5FC4;font-family:system-ui,-apple-system,'Segoe UI',sans-serif;color:#fff;position:relative">
      <div style="position:absolute;left:72px;top:72px;display:flex;align-items:center;gap:18px;font-size:34px;font-weight:700">
        <img src="data:image/png;base64,${b64(path.join(ROOT, 'docs', 'icon.png'))}" style="width:64px;height:64px;border-radius:14px;box-shadow:0 0 0 3px rgba(255,255,255,.45)">TestSnapper</div>
      <div style="position:absolute;left:72px;top:190px;width:470px;font-size:54px;line-height:1.1;font-weight:800">
        Click through your test once. Get the test case.</div>
      <div style="position:absolute;left:72px;bottom:72px;font-size:24px;opacity:.9">Free Chrome extension</div>
      <img src="data:image/png;base64,${b64(path.join(IMG_DIR, 'walk-07-review.png'))}"
        style="position:absolute;left:600px;top:90px;width:760px;border-radius:14px;box-shadow:0 30px 60px rgba(0,0,0,.35)">
      </body></html>`);
    await card.screenshot({ path: path.join(IMG_DIR, 'og.png') });
    console.log('  og.png');

    // Everything the page needs, as a plain script, so it also works when
    // index.html is opened straight from disk (file:// blocks fetch()).
    const sample = (ext) => fs.readFileSync(path.join(SAMPLE_DIR, `sign-in-smoke-test.${ext}`), 'utf8');
    const siteData = {
      generated: new Date().toISOString().slice(0, 10),
      version: require(path.join(ROOT, 'package.json')).version,
      walkthrough: { chapters: ['Start recording', 'Use the site', 'Review', 'Export'], frames },
      samples: { csv: sample('csv'), json: sample('json'), md: sample('md') }
    };
    fs.writeFileSync(
      path.join(ROOT, 'docs', 'site-data.js'),
      '// Generated by scripts/capture-site-screens.js. Do not edit by hand.\n' +
      'window.SITE_DATA = ' + JSON.stringify(siteData, null, 2) + ';\n'
    );
    console.log('  site-data.js');
  } finally {
    await context.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
