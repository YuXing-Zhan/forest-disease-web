import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
  fullyParallel: false,
  use: {
    baseURL: "http://127.0.0.1:5173",
    headless: true,
    channel: process.env.CI ? undefined : "chrome",
  },
  webServer: {
    env: {
      VITE_SHARED_KINDWISE_KEY: "test-public-kindwise",
      VITE_SHARED_DEEPSEEK_KEY: "test-public-deepseek",
    },
    command: "npm run dev -- --port 5173 --strictPort",
    url: "http://127.0.0.1:5173",
    reuseExistingServer: !process.env.CI,
  },
});
