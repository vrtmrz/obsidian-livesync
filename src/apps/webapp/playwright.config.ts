import { defineConfig, devices } from "@playwright/test";
import * as path from "path";
import * as fs from "fs";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ---------------------------------------------------------------------------
// Load environment variables from .test.env (root) so that CouchDB
// connection details are visible to the test process.
// ---------------------------------------------------------------------------
function loadEnvFile(envPath: string): Record<string, string> {
    const result: Record<string, string> = {};
    if (!fs.existsSync(envPath)) return result;
    const lines = fs.readFileSync(envPath, "utf-8").split("\n");
    for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#")) continue;
        const eq = trimmed.indexOf("=");
        if (eq < 0) continue;
        const key = trimmed.slice(0, eq).trim();
        const val = trimmed.slice(eq + 1).trim();
        result[key] = val;
    }
    return result;
}

// __dirname is src/apps/webapp — root is three levels up
const ROOT = path.resolve(__dirname, "../../..");
const envVars = {
    ...loadEnvFile(path.join(ROOT, ".env")),
    ...loadEnvFile(path.join(ROOT, ".test.env")),
};

// Make the loaded variables available to all test files via process.env.
for (const [k, v] of Object.entries(envVars)) {
    if (!(k in process.env)) {
        process.env[k] = v;
    }
}

export default defineConfig({
    testDir: "./test",
    // Give each test plenty of time for replication round-trips.
    timeout: 120_000,
    expect: { timeout: 30_000 },
    // Run test files sequentially; the tests themselves manage two contexts.
    fullyParallel: false,
    workers: 1,
    reporter: "list",

    use: {
        baseURL: "http://localhost:3000",
        // Use Chromium for OPFS and FileSystem API support.
        ...devices["Desktop Chrome"],
        headless: true,
        // Launch args to match the main vitest browser config.
        launchOptions: {
            args: ["--js-flags=--expose-gc"],
        },
    },

    projects: [
        {
            name: "chromium",
            use: { ...devices["Desktop Chrome"] },
        },
    ],

    // Start the vite dev server before running the tests.
    webServer: {
        command: "npx vite --port 3000",
        url: "http://localhost:3000",
        // Re-use a running dev server when developing locally.
        reuseExistingServer: !process.env.CI,
        timeout: 30_000,
        // Run from the webapp directory so vite finds its config.
        cwd: __dirname,
    },
});
