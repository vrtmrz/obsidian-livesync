import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Page } from "playwright";
import { withObsidianPage } from "./ui.ts";
import {
    REMOTE_OPERATION_ACTIVITY_ICON,
    REMOTE_REQUEST_ACTIVITY_ICON,
} from "../../../src/modules/features/RemoteActivityStatus.ts";

export const REMOTE_ACTIVITY_E2E_STATE_KEY = "__livesyncE2ERemoteActivity";
export const REMOTE_ACTIVITY_GATE_KIND = {
    chunkFetch: "chunk-fetch",
    oneShot: "one-shot",
    trackedRequest: "tracked-request",
} as const;
export const REMOTE_ACTIVITY_EXPECTED_STATE = {
    chunkFetchActive: "chunk-fetch-active",
    finiteReplicationActive: "finite-replication-active",
    idle: "idle",
    trackedRequestActive: "tracked-request-active",
} as const;
export type RemoteActivityGateKind = (typeof REMOTE_ACTIVITY_GATE_KIND)[keyof typeof REMOTE_ACTIVITY_GATE_KIND];

export type RemoteActivitySnapshot = {
    boundedRemoteActivityCount: number;
    finiteReplicationActivityCount: number;
    gateDone?: boolean;
    gateEntered?: boolean;
    gateError?: string;
    gateKind?: RemoteActivityGateKind;
    requestCount: number;
    remoteOperationIndicatorVisible: boolean;
    remoteRequestIndicatorVisible: boolean;
    responseCount: number;
    statusBarFound: boolean;
    statusBarText: string;
};

export type ExpectedRemoteActivityState =
    (typeof REMOTE_ACTIVITY_EXPECTED_STATE)[keyof typeof REMOTE_ACTIVITY_EXPECTED_STATE];

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
    kind?: RemoteActivityGateKind;
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
        ({ operationIcon, pluginId, requestIcon, stateKey }) => {
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
                remoteOperationIndicatorVisible: statusBars.some((element) =>
                    (element.textContent ?? "").includes(operationIcon)
                ),
                remoteRequestIndicatorVisible: statusBars.some((element) =>
                    (element.textContent ?? "").includes(requestIcon)
                ),
                responseCount: Number(core.services?.API?.responseCount?.value ?? -1),
                statusBarFound: statusBars.length > 0,
                statusBarText: statusBars.map((element) => element.textContent ?? "").join("\n"),
            } satisfies RemoteActivitySnapshot;
        },
        {
            operationIcon: REMOTE_OPERATION_ACTIVITY_ICON,
            pluginId: "obsidian-livesync",
            requestIcon: REMOTE_REQUEST_ACTIVITY_ICON,
            stateKey: REMOTE_ACTIVITY_E2E_STATE_KEY,
        }
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
                ({ expectedState, expectedStates, gateKinds, operationIcon, pluginId, requestIcon, stateKey }) => {
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
                    const operationIconVisible = statusBarText.includes(operationIcon);
                    const requestIconVisible = statusBarText.includes(requestIcon);
                    const trackedRequests = Math.max(0, requests - responses);

                    if (expectedState === expectedStates.finiteReplicationActive) {
                        return (
                            gate?.kind === gateKinds.oneShot &&
                            gate.entered === true &&
                            bounded > 0 &&
                            finite > 0 &&
                            operationIconVisible &&
                            !requestIconVisible &&
                            trackedRequests === 0
                        );
                    }
                    if (expectedState === expectedStates.chunkFetchActive) {
                        return (
                            gate?.kind === gateKinds.chunkFetch &&
                            gate.entered === true &&
                            bounded > 0 &&
                            finite === 0 &&
                            operationIconVisible &&
                            !requestIconVisible &&
                            trackedRequests === 0
                        );
                    }
                    if (expectedState === expectedStates.trackedRequestActive) {
                        return (
                            gate?.kind === gateKinds.trackedRequest &&
                            gate.entered === true &&
                            bounded === 0 &&
                            finite === 0 &&
                            trackedRequests > 0 &&
                            !operationIconVisible &&
                            statusBarText.includes(`${requestIcon}${trackedRequests}`)
                        );
                    }
                    return (
                        bounded === 0 &&
                        finite === 0 &&
                        requests === responses &&
                        !operationIconVisible &&
                        !requestIconVisible
                    );
                },
                {
                    expectedState: expected,
                    expectedStates: REMOTE_ACTIVITY_EXPECTED_STATE,
                    gateKinds: REMOTE_ACTIVITY_GATE_KIND,
                    operationIcon: REMOTE_OPERATION_ACTIVITY_ICON,
                    pluginId: "obsidian-livesync",
                    requestIcon: REMOTE_REQUEST_ACTIVITY_ICON,
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
