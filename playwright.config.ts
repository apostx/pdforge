import { defineConfig, devices } from '@playwright/test';

// End-to-end tests against the production build (strict CSP, service worker), served by
// `vite preview`. First time: `npx playwright install chromium`, then `npm run test:e2e`.
export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 120_000,
  fullyParallel: true,
  // the font test is heavy; a few workers keep timings steady on small machines
  workers: process.env.CI ? 2 : 3,
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:4173/',
    locale: 'en-US',
    // most tests load fonts with page.route watching; the offline test turns this back on
    serviceWorkers: 'block',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'npm run build && npx vite preview --port 4173 --strictPort',
    // Google Drive on, with made-up values: the tests stand in for Google (see drive.spec.ts)
    env: {
      VITE_GOOGLE_CLIENT_ID: 'test-client.apps.googleusercontent.com',
      VITE_GOOGLE_API_KEY: 'test-api-key',
      VITE_GOOGLE_APP_ID: '123456789',
    },
    url: 'http://localhost:4173/',
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
});
