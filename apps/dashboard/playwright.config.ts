import { defineConfig } from '@playwright/test';

export const E2E_PORT = Number(process.env.E2E_PORT ?? 4318);

export default defineConfig({
  testDir: './e2e',
  testMatch: '*.spec.ts',
  globalSetup: './e2e/global-setup.ts',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: `http://127.0.0.1:${String(E2E_PORT)}`,
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: {
        browserName: 'chromium',
        // Optional: run against an already installed Chromium instead of the pinned download.
        ...(process.env.E2E_CHROMIUM_PATH
          ? { launchOptions: { executablePath: process.env.E2E_CHROMIUM_PATH } }
          : {}),
      },
    },
  ],
});
