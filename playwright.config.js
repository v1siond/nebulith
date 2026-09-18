import { defineConfig } from '@playwright/test'

// Records the Nebulith demo against the ALREADY-RUNNING dev server (:3000).
// The 4K capture + cursor overlay come from playwright/support/video-showcase.js.
export default defineConfig({
  testDir: './playwright/tours',
  timeout: 30 * 60 * 1000,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: 'list',
  use: {
    baseURL: process.env.BASE_URL || 'http://localhost:6328',
    // Bound each action so a missing locator fails fast (with its name) instead of
    // hanging until the whole test timeout.
    actionTimeout: 15000,
    navigationTimeout: 30000,
    // viewport / deviceScaleFactor / recordVideo are set by the showcase fixture.
  },
  projects: [{ name: 'chromium', use: {} }],
})
