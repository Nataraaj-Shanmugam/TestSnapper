const { defineConfig } = require('@playwright/test');
const path = require('path');

module.exports = defineConfig({
  testDir: './tests/e2e',
  timeout: 60_000,
  retries: 0,
  workers: 1,
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'playwright-report' }]],
  use: {
    headless: false,
    viewport: { width: 1280, height: 800 },
  },
  projects: [
    {
      name: 'chrome-extension',
      use: {
        launchOptions: {
          args: [
            `--disable-extensions-except=${path.join(__dirname, 'dist')}`,
            `--load-extension=${path.join(__dirname, 'dist')}`,
            '--no-sandbox',
          ],
        },
      },
    },
  ],
});
