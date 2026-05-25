import { defineConfig } from "playwright/test";
import path from "node:path";

export default defineConfig({
    testDir: path.join(__dirname, "tests"),
    outputDir: path.join(__dirname, "test-results"),

    // Each test may need to cold-start Obsidian and wait for the vault to load.
    timeout: 120_000,
    expect: { timeout: 20_000 },

    // Tests are stateful (one Obsidian process per test file), so no parallelism.
    fullyParallel: false,
    workers: 1,
    retries: 0,

    reporter: [["list"], ["html", { open: "never", outputFolder: path.join(__dirname, "playwright-report") }]],
    use: {
        // Artefacts are kept only when a test fails.
        screenshot: "only-on-failure",
        video: "retain-on-failure",
        trace: "retain-on-failure",
    },
});
