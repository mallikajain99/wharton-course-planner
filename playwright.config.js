// Real-browser tests: serves this folder locally and drives Chromium through the survey and planner.
const { defineConfig, devices } = require("@playwright/test");
module.exports = defineConfig({
  testDir: "tests",
  timeout: 60000,
  reporter: [["list"]],
  use: { baseURL: "http://127.0.0.1:4173", trace: "retain-on-failure" },
  webServer: { command: "python3 -m http.server 4173 --bind 127.0.0.1", url: "http://127.0.0.1:4173/index.html", reuseExistingServer: true },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
    { name: "phone", use: { ...devices["iPhone 13"], browserName: "chromium" } },
  ],
});
