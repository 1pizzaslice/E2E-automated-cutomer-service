import { defineConfig, devices } from "@playwright/test";

/**
 * Browser walkthrough tier (Milestone 23), run by `pnpm test:e2e:console` — kept
 * out of the root `pnpm test` (which requires uv). It builds the console and
 * serves the static bundle with `vite preview`; the spec mocks `/v1/*` at the
 * network boundary, so it drives the real console bundle in a real browser
 * without a running API or database. The full-stack live drive against a
 * deployed API is exercised on the VM per SOPS §19.
 */
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  reporter: [["list"]],
  use: {
    baseURL: "http://localhost:4173",
    trace: "on-first-retry",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: "pnpm run build && pnpm run preview",
    url: "http://localhost:4173",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
