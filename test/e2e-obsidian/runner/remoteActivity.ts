import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Page } from "playwright";
import { withObsidianPage } from "./ui.ts";

export const REMOTE_ACTIVITY_E2E_STATE_KEY = "__livesyncE2ERemoteActivity";

export type RemoteActivitySnapshot = {
    boundedRemoteActivityCount: number;
    finiteReplicationActivityCount: number;
    gateDone?: boolean;
    gateEntered?: boolean;
    gateError?: string;
    gateKind?: string;
    requestCount: number;
    responseCount: number;
    statusBarFound: boolean;
    statusBarText: string;
};

export type ExpectedRemoteActivityState = "chunk-fetch-active" | "finite-replication-active" | "idle";

type RuntimeCounter = { value?: number };

type RuntimeCore = {
    services?: {
        API?: {
            requestCount?: RuntimeCounter;
            responseCount?: RuntimeCounter;
        };
        replicator?: {
            boundedRemoteActivityCount?: RuntimeCounter;
            finiteReplicationActivityCount?: RuntimeCounter;
        };
    };
};

type RuntimeGate = {
    done?: boolean;
    entered?: boolean;
    error?: string;
    kind?: string;
};

type RendererGlobals = typeof globalThis & {
    app?: {
        plugins?: {
            plugins?: Record<string, { core?: RuntimeCore }>;
        };
    };
};

async function readRemoteActivitySnapshotFromPage(page: Page): Promise<RemoteActivitySnapshot> {
    return await page.evaluate(
        ({ pluginId, stateKey }) => {
            const globals = globalThis as RendererGlobals;
            const core = globals.app?.plugins?.plugins?.[pluginId]?.core;
            if (!core) throw new Error(`Obsidian plug-in is not loaded: ${pluginId}`);
            const gate = (globalThis as unknown as Record<string, RuntimeGate | undefined>)[stateKey];
            const statusBars = Array.from(document.querySelectorAll<HTMLElement>(".syncstatusbar"));
            return {
                boundedRemoteActivityCount: Number(core.services?.replicator?.boundedRemoteActivityCount?.value ?? -1),
                finiteReplicationActivityCount: Number(
                    core.services?.replicator?.finiteReplicationActivityCount?.value ?? -1
                ),
                gateDone: gate?.done,
                gateEntered: gate?.entered,
                gateError: gate?.error,
                gateKind: gate?.kind,
                requestCount: Number(core.services?.API?.requestCount?.value ?? -1),
                responseCount: Number(core.services?.API?.responseCount?.value ?? -1),
                statusBarFound: statusBars.length > 0,
                statusBarText: statusBars.map((element) => element.textContent ?? "").join("\n"),
            } satisfies RemoteActivitySnapshot;
        },
        { pluginId: "obsidian-livesync", stateKey: REMOTE_ACTIVITY_E2E_STATE_KEY }
    );
}

export async function readRemoteActivitySnapshot(port: number): Promise<RemoteActivitySnapshot> {
    return await withObsidianPage(port, async (page) => await readRemoteActivitySnapshotFromPage(page));
}

function formatWaitFailure(
    expected: ExpectedRemoteActivityState,
    snapshot: RemoteActivitySnapshot | undefined,
    error: unknown
): Error {
    return new Error(
        [
            `Timed out waiting for remote activity state: ${expected}`,
            snapshot ? `Last snapshot: ${JSON.stringify(snapshot)}` : undefined,
            error instanceof Error ? error.message : String(error),
        ]
            .filter((line): line is string => line !== undefined)
            .join("\n")
    );
}

export async function waitForRemoteActivityState(
    port: number,
    expected: ExpectedRemoteActivityState,
    timeoutMs = Number(process.env.E2E_OBSIDIAN_REMOTE_ACTIVITY_TIMEOUT_MS ?? 30000)
): Promise<RemoteActivitySnapshot> {
    try {
        return await withObsidianPage(port, async (page) => {
            await page.waitForFunction(
                ({ expectedState, pluginId, stateKey }) => {
                    const globals = globalThis as RendererGlobals;
                    const core = globals.app?.plugins?.plugins?.[pluginId]?.core;
                    if (!core) return false;
                    const gate = (globalThis as unknown as Record<string, RuntimeGate | undefined>)[stateKey];
                    const statusBarText = Array.from(document.querySelectorAll<HTMLElement>(".syncstatusbar"))
                        .map((element) => element.textContent ?? "")
                        .join("\n");
                    const bounded = Number(core.services?.replicator?.boundedRemoteActivityCount?.value ?? -1);
                    const finite = Number(core.services?.replicator?.finiteReplicationActivityCount?.value ?? -1);
                    const requests = Number(core.services?.API?.requestCount?.value ?? -1);
                    const responses = Number(core.services?.API?.responseCount?.value ?? -1);
                    const iconVisible = statusBarText.includes("📲");

                    if (expectedState === "finite-replication-active") {
                        return (
                            gate?.kind === "one-shot" &&
                            gate.entered === true &&
                            bounded > 0 &&
                            finite > 0 &&
                            iconVisible
                        );
                    }
                    if (expectedState === "chunk-fetch-active") {
                        return (
                            gate?.kind === "chunk-fetch" &&
                            gate.entered === true &&
                            bounded > 0 &&
                            finite === 0 &&
                            iconVisible
                        );
                    }
                    return bounded === 0 && finite === 0 && requests === responses && !iconVisible;
                },
                {
                    expectedState: expected,
                    pluginId: "obsidian-livesync",
                    stateKey: REMOTE_ACTIVITY_E2E_STATE_KEY,
                },
                { timeout: timeoutMs }
            );
            return await readRemoteActivitySnapshotFromPage(page);
        });
    } catch (error) {
        const snapshot = await readRemoteActivitySnapshot(port).catch(() => undefined);
        throw formatWaitFailure(expected, snapshot, error);
    }
}

export type RemoteActivityDiagnostics = {
    screenshotPath: string;
    snapshot: RemoteActivitySnapshot;
    snapshotPath: string;
};

export async function captureRemoteActivityDiagnostics(
    port: number,
    label: string
): Promise<RemoteActivityDiagnostics> {
    const outputDirectory = process.env.E2E_OBSIDIAN_DIAGNOSTICS_DIR ?? "/tmp/obsidian-livesync-e2e";
    await mkdir(outputDirectory, { recursive: true });
    const safeLabel = label.replace(/[^a-z0-9_-]+/gi, "-").replace(/^-+|-+$/g, "") || "remote-activity";
    const prefix = `${safeLabel}-${new Date().toISOString().replace(/[:.]/g, "-")}`;
    const screenshotPath = join(outputDirectory, `${prefix}.png`);
    const snapshotPath = join(outputDirectory, `${prefix}.json`);
    const snapshot = await withObsidianPage(port, async (page) => {
        const current = await readRemoteActivitySnapshotFromPage(page);
        await page.screenshot({ path: screenshotPath, fullPage: true });
        return current;
    });
    await writeFile(snapshotPath, `${JSON.stringify(snapshot, undefined, 2)}\n`, "utf8");
    return { screenshotPath, snapshot, snapshotPath };
}
