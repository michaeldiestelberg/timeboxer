import { defineConfig } from "@playwright/test"

const port = 3001
const baseURL = `http://127.0.0.1:${port}`

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 30_000,
  use: {
    baseURL,
    trace: "on-first-retry",
  },
  webServer: {
    command: `PORT=${port} TIMEBOXER_STORE=memory npm run dev`,
    port,
    reuseExistingServer: false,
  },
})
