import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/deps.ts", () => ({
    addIcon: vi.fn(),
    debounce: (callback: () => void) => callback,
    normalizePath: (path: string) => path,
    Notice: class {},
    stringifyYaml: vi.fn(),
}));
vi.mock("./Log/LogPaneView.ts", () => ({ LogPaneView: class {}, VIEW_TYPE_LOG: "log" }));
vi.mock("@/common/reportTool.ts", () => ({ generateReport: vi.fn() }));
vi.mock("@/common/utils.ts", () => ({ isValidPath: () => true }));
vi.mock("@/common/translation", () => ({ $msg: (key: string) => key }));
vi.mock("@/common/events.ts", () => ({
    EVENT_FILE_RENAMED: "renamed",
    EVENT_LAYOUT_READY: "ready",
    EVENT_LEAF_ACTIVE_CHANGED: "active",
    EVENT_ON_UNRESOLVED_ERROR: "error",
    eventHub: { onEvent: vi.fn() },
}));
vi.mock("@vrtmrz/livesync-commonlib/compat/replication/trystero/P2PLogCollector", () => ({
    P2PLogCollector: class {},
}));
vi.mock("@vrtmrz/livesync-commonlib/p2p", () => ({ EVENT_P2P_DIAGNOSTIC: "p2p-diagnostic" }));

async function harness(diag = true, verbose = false, lessInformation = false) {
    const { ModuleLog } = await import("./ModuleLog.ts");
    const { reactiveSource } = await import("octagonal-wheels/dataobject/reactive");
    const { logMessages } = await import("@vrtmrz/livesync-commonlib/compat/mock_and_interop/stores");
    logMessages.value = [];
    const notices = { show: vi.fn() };
    const module = Object.assign(Object.create(ModuleLog.prototype), {
        core: {
            settings: { P2P_useDiagRTC: diag, showVerboseLog: verbose, lessInformationInLog: lessInformation },
            services: { vault: { getVaultName: () => "fixture" }, context: { notices } },
        },
        statusLog: reactiveSource("existing status"),
        logLines: [],
        notifies: {},
    }) as InstanceType<typeof ModuleLog>;
    const { LOG_LEVEL_VERBOSE, LOG_LEVEL_INFO } = await import("@vrtmrz/livesync-commonlib/compat/common/types");
    return { module, notices, logMessages, LOG_LEVEL_VERBOSE, LOG_LEVEL_INFO } as const;
}

describe("P2P diagnostic log routing", () => {
    beforeEach(() => vi.resetModules());
    afterEach(() => vi.unstubAllGlobals());

    it("shows enabled diagnostics in Log Pane despite normal log visibility settings", async () => {
        const { module, notices, logMessages, LOG_LEVEL_VERBOSE } = await harness(true, false, true);
        module.__addLog("[P2P Diag] Peer: Authentication timed out", LOG_LEVEL_VERBOSE, "p2p-diagnostic");
        expect(logMessages.value).toEqual([expect.stringContaining("[P2P Diag] Peer: Authentication timed out")]);
        expect(module.statusLog.value).toBe("existing status");
        expect(module.logLines).toEqual([]);
        expect(notices.show).not.toHaveBeenCalled();
    });

    it("keeps diagnostic detail out of editor status and notification surfaces", async () => {
        const { module, notices, logMessages, LOG_LEVEL_INFO } = await harness(true, true);
        module.__addLog("[P2P Diag] Sync: Pull completed", LOG_LEVEL_INFO, "p2p-diagnostic");
        expect(logMessages.value).toEqual([expect.stringContaining("[P2P Diag] Sync: Pull completed")]);
        expect(module.statusLog.value).toBe("existing status");
        expect(module.logLines).toEqual([]);
        expect(notices.show).not.toHaveBeenCalled();
    });

    it("keeps disabled diagnostic detail out of Log Pane", async () => {
        const { module, logMessages, LOG_LEVEL_INFO } = await harness(false, true);
        module.__addLog("[P2P Diag] Relay: Room opened", LOG_LEVEL_INFO, "p2p-diagnostic");
        expect(logMessages.value).toEqual([]);
        expect(module.statusLog.value).toBe("existing status");
    });

    it("preserves normal log routing", async () => {
        const { module, logMessages, LOG_LEVEL_INFO } = await harness();
        module.__addLog("Normal operation", LOG_LEVEL_INFO);
        expect(logMessages.value).toEqual([expect.stringContaining("Normal operation")]);
        expect(module.statusLog.value).toBe("Normal operation");
        expect(module.logLines).toHaveLength(1);
    });
});
