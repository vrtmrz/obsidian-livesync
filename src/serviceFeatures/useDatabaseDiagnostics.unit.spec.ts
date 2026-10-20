import { describe, expect, it, vi } from "vitest";
import type { DatabaseDiagnosticDialogOptions } from "./databaseDiagnosticDialogTypes";

vi.mock("@/modules/services/LiveSyncUI/dialogues/DatabaseDiagnosticDialog.svelte", () => ({ default: {} }));
vi.mock("./databaseDiagnostics", () => ({
    runDatabaseDiagnostic: vi.fn(async () => ({ status: "complete", nameMode: "pseudonym", artifacts: [] })),
}));
vi.mock("@/common/translation", () => ({ $msg: (value: string) => value }));

import { runDatabaseDiagnostic } from "./databaseDiagnostics";
import { useDatabaseDiagnosticsFeature } from "./useDatabaseDiagnostics";
import { EVENT_ANALYSE_DB_USAGE, EVENT_INSPECT_DB_INTEGRITY } from "@/common/events";

function fixture() {
    const initialise: Array<() => Promise<boolean>> = [];
    const unload: Array<() => Promise<boolean>> = [];
    const commands: Array<{ id: string; checkCallback: (checking: boolean) => boolean }> = [];
    const listeners = new Map<string, () => void>();
    const unsubscribe = vi.fn((event: string) => listeners.delete(event));
    const settings = { useAdvancedMode: false };
    let ready = true;
    let close!: () => void;
    const openDialog = vi.fn(
        (_component: unknown, _options: DatabaseDiagnosticDialogOptions) =>
            new Promise<void>((resolve) => {
                close = resolve;
            })
    );
    const host = {
        services: {
            setting: { currentSettings: () => settings },
            database: { isDatabaseReady: () => ready },
            path: {},
            API: { addCommand: (command: (typeof commands)[number]) => commands.push(command) },
            UI: { dialogManager: { open: openDialog } },
            appLifecycle: {
                onInitialise: { addHandler: (handler: (typeof initialise)[number]) => initialise.push(handler) },
                onUnload: { addHandler: (handler: (typeof unload)[number]) => unload.push(handler) },
            },
            context: {
                events: {
                    onEvent: (event: string, handler: () => void) => {
                        listeners.set(event, handler);
                        return () => unsubscribe(event);
                    },
                },
            },
        },
        serviceModules: { storageAccess: {} },
    } as unknown as Parameters<typeof useDatabaseDiagnosticsFeature>[0];
    const view = useDatabaseDiagnosticsFeature(host);
    return {
        host,
        view,
        initialise,
        unload,
        commands,
        listeners,
        settings,
        openDialog,
        unsubscribe,
        close: () => close(),
        setReady: (value: boolean) => {
            ready = value;
        },
    };
}

describe("database diagnostics serviceFeature", () => {
    it("retains the existing Advanced-mode Usage command gate in its new owner", async () => {
        const data = fixture();
        for (const initialise of data.initialise) await initialise();
        const usage = data.commands.find((command) => command.id === "analyse-database")!;
        const integrity = data.commands.find((command) => command.id === "inspect-database-integrity")!;
        expect(usage.checkCallback(true)).toBe(false);
        expect(integrity.checkCallback(true)).toBe(true);
        data.settings.useAdvancedMode = true;
        expect(usage.checkCallback(true)).toBe(true);
        data.setReady(false);
        expect(usage.checkCallback(true)).toBe(false);
        expect(integrity.checkCallback(true)).toBe(false);
        expect(data.openDialog).not.toHaveBeenCalled();
    });

    it("uses the existing dialogue manager and performs no analysis until the run choice is submitted", async () => {
        vi.mocked(runDatabaseDiagnostic).mockClear();
        const data = fixture();
        const opened = data.view.open("usage");
        expect(data.openDialog).toHaveBeenCalledTimes(1);
        expect(runDatabaseDiagnostic).not.toHaveBeenCalled();
        const options = data.openDialog.mock.calls[0][1];
        expect(Object.keys(options).sort()).toEqual(["cancel", "kind", "run"]);
        await options.run("original", () => {});
        expect(runDatabaseDiagnostic).toHaveBeenCalledWith(
            data.host,
            "usage",
            "original",
            expect.objectContaining({ signal: expect.any(AbortSignal) })
        );
        const signal = vi.mocked(runDatabaseDiagnostic).mock.calls.slice(-1)[0][3]!.signal!;
        await data.view.open("integrity");
        expect(data.openDialog).toHaveBeenCalledTimes(1);
        data.close();
        await opened;
        expect(signal.aborted).toBe(true);
    });

    it("wires both Hatch actions and releases its listeners and active request on unload", async () => {
        const data = fixture();
        expect(data.listeners.has(EVENT_ANALYSE_DB_USAGE)).toBe(true);
        expect(data.listeners.has(EVENT_INSPECT_DB_INTEGRITY)).toBe(true);
        const opened = data.view.open("integrity");
        await data.openDialog.mock.calls[0][1].run("pseudonym", () => {});
        const signal = vi.mocked(runDatabaseDiagnostic).mock.calls.slice(-1)[0][3]!.signal!;
        for (const unload of data.unload) await unload();
        expect(signal.aborted).toBe(true);
        expect(data.listeners.size).toBe(0);
        expect(data.unsubscribe).toHaveBeenCalledTimes(2);
        data.close();
        await opened;
    });

    it("forwards the per-run remote inspection choice and defaults existing callers to include the remote database", async () => {
        vi.mocked(runDatabaseDiagnostic).mockClear();
        const data = fixture();
        const opened = data.view.open("integrity");
        const options = data.openDialog.mock.calls[0][1];

        await options.run("pseudonym", () => {}, false);
        expect(runDatabaseDiagnostic).toHaveBeenLastCalledWith(
            data.host,
            "integrity",
            "pseudonym",
            expect.objectContaining({ includeRemote: false, signal: expect.any(AbortSignal) })
        );

        await options.run("pseudonym", () => {});
        expect(runDatabaseDiagnostic).toHaveBeenLastCalledWith(
            data.host,
            "integrity",
            "pseudonym",
            expect.objectContaining({ includeRemote: true, signal: expect.any(AbortSignal) })
        );
        data.close();
        await opened;
    });
});
