import { build } from "esbuild";
import { chromium, webkit } from "playwright";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const output = await build({
    entryPoints: ["test/browser-apps/database-probe/probe.browser.ts"],
    bundle: true,
    write: false,
    platform: "browser",
    format: "iife",
    target: "es2022",
});
const script = output.outputFiles[0].text.replace(/<\/script/giu, "<\\/script");
const requestedEngines = (process.env.DATABASE_PROBE_BROWSERS ?? "chromium,webkit").split(",");
if (requestedEngines.some((name) => name !== "chromium" && name !== "webkit")) {
    throw new Error("DATABASE_PROBE_BROWSERS must contain chromium and/or webkit");
}
for (const engine of [chromium, webkit].filter((candidate) => requestedEngines.includes(candidate.name()))) {
    const browser = await engine.launch({ headless: true });
    try {
        const context = await browser.newContext();
        const page = await context.newPage();
        const errors: string[] = [];
        page.on("pageerror", (error) => errors.push(error.message));
        await page.route("https://database-probe.test/**", (route) =>
            route.fulfill({
                status: 200,
                contentType: "text/html",
                body: `<!doctype html><title>Disposable database probe</title><script>${script}</script>`,
            })
        );
        await page.goto("https://database-probe.test/");
        const result = await page.evaluate(async () => await window.runDatabaseProbeSmoke());
        if (errors.length) {
            throw new Error(`${engine.name()}: ${errors.join("; ")}`);
        }
        const directory = resolve(process.env.DATABASE_PROBE_EVIDENCE_DIR ?? "/tmp/livesync-database-probe");
        await mkdir(directory, { recursive: true });
        await writeFile(resolve(directory, `${engine.name()}.json`), JSON.stringify(result, null, 2) + "\n");
        console.log(
            `${engine.name()}: native close, stale cache, event coverage, same-database reopen, and cleanup passed`
        );
        await context.close();
    } finally {
        await browser.close();
    }
}
