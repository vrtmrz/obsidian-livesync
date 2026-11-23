import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { arch, cpus, platform, release } from "node:os";
import { resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { build } from "esbuild";
import { chromium, type CDPSession } from "playwright";
import type {} from "./probe.browser";

interface TraceEvent {
    name: string;
    ph: string;
    pid: number;
    tid: number;
    ts: number;
    dur?: number;
}

async function stopTrace(session: CDPSession): Promise<TraceEvent[]> {
    const completed = new Promise<{ stream?: string; dataLossOccurred: boolean }>((resolve) => {
        session.once("Tracing.tracingComplete", resolve);
    });
    await session.send("Tracing.end");
    const { stream, dataLossOccurred } = await completed;
    if (!stream || dataLossOccurred) {
        throw new Error("Chromium renderer trace was incomplete");
    }
    const chunks: string[] = [];
    try {
        for (;;) {
            const chunk = await session.send("IO.read", { handle: stream });
            chunks.push(chunk.base64Encoded ? Buffer.from(chunk.data, "base64").toString() : chunk.data);
            if (chunk.eof) {
                break;
            }
        }
    } finally {
        await session.send("IO.close", { handle: stream });
    }
    const trace = JSON.parse(chunks.join("")) as { traceEvents: TraceEvent[] };
    return trace.traceEvents;
}

function rendererTasks(trace: TraceEvent[], phase: string) {
    const start = trace.find(({ name }) => name === `storage-event-probe:${phase}:start`);
    const end = trace.find(({ name }) => name === `storage-event-probe:${phase}:end`);
    if (!start || !end || start.pid !== end.pid || start.tid !== end.tid || start.ts >= end.ts) {
        throw new Error(`Missing renderer phase markers for ${phase}`);
    }
    const durations = trace
        .filter(({ name, ph, pid, tid }) => name === "RunTask" && ph === "X" && pid === start.pid && tid === start.tid)
        // The boundary tasks may also perform fixture setup or check results outside the timed phase.
        .map(({ ts, dur = 0 }) => (Math.min(end.ts, ts + dur) - Math.max(start.ts, ts)) / 1_000)
        .filter((duration) => duration > 0);
    if (!durations.length) {
        const names = trace
            .filter(({ pid, tid, ts }) => pid === start.pid && tid === start.tid && ts >= start.ts && ts <= end.ts)
            .map(({ name }) => name);
        throw new Error(
            `No renderer main-thread task trace for ${phase}: ${[...new Set(names)].slice(0, 30).join(", ")}`
        );
    }
    return {
        longestMs: Math.max(...durations),
        taskCount: durations.length,
        tasksAtLeast50Ms: durations.filter((duration) => duration >= 50).length,
    };
}

async function getCpuTime(session: CDPSession): Promise<number> {
    const { metrics } = await session.send("Performance.getMetrics");
    const task = metrics.find(({ name }) => name === "TaskDuration");
    if (!task) {
        throw new Error("Chromium did not report renderer TaskDuration");
    }
    return task.value * 1_000;
}

async function runWithDeadline<T>(phase: string, work: () => Promise<T>): Promise<T> {
    const timeout = new AbortController();
    try {
        return await Promise.race([
            work(),
            delay(300_000, undefined, { signal: timeout.signal }).then(() => {
                throw new Error(`Chromium did not finish ${phase} within five minutes`);
            }),
        ]);
    } finally {
        timeout.abort();
    }
}

const commonlibPath = "node_modules/@vrtmrz/livesync-commonlib";
type LockedPackage = { resolved: string; integrity: string };
const lockfile = JSON.parse(await readFile("package-lock.json", "utf8")) as {
    packages: Record<string, LockedPackage>;
};
const { resolved: commonlibResolved, integrity: commonlibIntegrity } = lockfile.packages[commonlibPath];
let commonlibTarballSha256: string | null = null;
if (commonlibResolved.startsWith("file:")) {
    const tarball = new Uint8Array(await readFile(commonlibResolved.slice("file:".length)));
    const integrity = "sha512-" + createHash("sha512").update(tarball).digest("base64");
    if (integrity !== commonlibIntegrity) {
        throw new Error("The Commonlib tarball does not match package-lock.json");
    }
    commonlibTarballSha256 = createHash("sha256").update(tarball).digest("hex");
}

const output = await build({
    entryPoints: ["test/browser-apps/storage-event-persistence-probe/probe.browser.ts"],
    bundle: true,
    write: false,
    platform: "browser",
    format: "iife",
    target: "es2022",
    external: ["crypto"], // Commonlib uses native Web Crypto on the secure Chromium origin.
    plugins: [
        {
            name: "obsidian-browser-stub",
            setup(bundle) {
                bundle.onResolve({ filter: /^obsidian$/ }, (args) => ({
                    path: args.path,
                    namespace: "probe-obsidian",
                }));
                bundle.onLoad({ filter: /.*/, namespace: "probe-obsidian" }, () => ({
                    contents: `
                        export class TFile {}
                        export class TFolder {}
                        export function normalizePath() { throw new Error("Unexpected Obsidian API call"); }
                    `,
                }));
            },
        },
    ],
});
const script = output.outputFiles[0].text.replace(/<\/script/giu, "<\\/script");
const browser = await chromium.launch({ headless: true });
try {
    const context = await browser.newContext();
    const page = await context.newPage();
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.route("https://storage-event-persistence-probe.test/**", (route) =>
        route.fulfill({
            status: 200,
            contentType: "text/html",
            body: `<!doctype html><title>Storage-event persistence probe</title><script>${script}</script>`,
        })
    );
    await page.goto("https://storage-event-persistence-probe.test/");
    const session = await context.newCDPSession(page);
    await session.send("Tracing.start", {
        categories: "toplevel,blink.user_timing,devtools.timeline,disabled-by-default-devtools.timeline",
        transferMode: "ReturnAsStream",
    });
    const database = await runWithDeadline("database measurement", () =>
        page.evaluate(() => window.runStorageEventDatabaseProbe())
    );

    console.log("Native IndexedDB baseline, migration, and replay passed");
    await session.send("Performance.enable", { timeDomain: "threadTicks" });
    const cpuStart = await getCpuTime(session);
    const cpu = await runWithDeadline("CPU measurement", () => page.evaluate(() => window.runStorageEventCpuProbe()));
    const rendererCpuMs = (await getCpuTime(session)) - cpuStart;
    const trace = await stopTrace(session);
    const rendererMainThread = {
        legacy: rendererTasks(trace, "legacy"),
        legacyGet: rendererTasks(trace, "legacy-get"),
        migration: rendererTasks(trace, "migration"),
        migrationRead: rendererTasks(trace, "migration-read"),
        replay: rendererTasks(trace, "replay"),
        cpu: rendererTasks(trace, "cpu"),
    };
    console.log("Renderer CPU checks passed. Reopening IndexedDB at each interruption boundary");
    const interruptions = await runWithDeadline("interruption checks", () =>
        page.evaluate(() => window.runStorageEventInterruptions())
    );
    if (errors.length) {
        throw new Error(errors.join("\n"));
    }

    const commonlibManifest = await readFile(resolve(commonlibPath, "package.json"), "utf8");
    const osRelease = platform() === "linux" ? await readFile("/etc/os-release", "utf8").catch(() => "") : "";
    const evidence = {
        environment: {
            chromiumVersion: browser.version(),
            userAgent: await page.evaluate(() => navigator.userAgent),
            nodeVersion: process.version,
            commonlibVersion: (JSON.parse(commonlibManifest) as { version: string }).version,
            commonlibTarballSha256,
            commonlibIntegrity,
            bundleHash: createHash("sha256").update(script).digest("hex"),
            os: /^PRETTY_NAME="?([^"\r\n]*)/m.exec(osRelease)?.[1] ?? platform(),
            release: release(),
            arch: arch(),
            cpuModel: cpus()[0]?.model,
        },
        ...database,
        rendererMainThread,
        cpu: { ...cpu, rendererCpuMs },
        interruptions,
    };
    const directory = resolve(process.env.DATABASE_PROBE_EVIDENCE_DIR ?? "/tmp/livesync-storage-event-probe");
    await mkdir(directory, { recursive: true });
    const path = resolve(directory, "chromium.json");
    await writeFile(path, JSON.stringify(evidence, null, 2) + "\n");
    console.log(`Chromium storage-event persistence probe passed. Evidence: ${path}`);
} finally {
    await browser.close();
}
