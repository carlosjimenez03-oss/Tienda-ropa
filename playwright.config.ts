import { defineConfig, devices } from '@playwright/test';

// E2E contra una instancia en marcha (docker compose o `npm start`).
// BASE_URL por defecto: http://localhost:3000
export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 60_000,
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  use: {
    baseURL: process.env.BASE_URL ?? 'http://localhost:3000',
    locale: 'es-DO',
    timezoneId: 'America/Santo_Domingo',
    launchOptions: process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {},
  },
  projects: [
    { name: 'escritorio', use: { ...devices['Desktop Chrome'] } },
    { name: 'movil', use: { ...devices['Pixel 7'] } },
  ],
});
