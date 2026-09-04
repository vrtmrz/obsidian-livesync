import { describe, expect, it, vi } from "vitest";

vi.mock("@/deps.ts", () => ({}));
vi.mock("./configureHiddenFileSyncMode.ts", () => ({
    configureHiddenFileSyncMode: vi.fn(),
}));

import { HiddenFileSyncContext } from "./hiddenFileSyncContext.ts";

function getProcessedState(context: HiddenFileSyncContext): unknown {
    return (context as unknown as { readonly processedState: unknown }).processedState;
}

function getPrivate<T>(context: HiddenFileSyncContext, key: string): T {
    return (context as unknown as Record<string, T>)[key];
}

function createContext(processedFiles = new Map()) {
    const periodicProcessor = { enable: vi.fn(), disable: vi.fn() };
    const publishActivity = vi.fn();
    const hideConfigurationChangeNotice = vi.fn();
    const keyValueDatabase = {
        get: vi.fn(async (key: IDBValidKey) => {
            if (key == "hidden-file-lastProcessed") return processedFiles;
            return new Map();
        }),
    };
    const context = new HiddenFileSyncContext({
        createPeriodicProcessor: vi.fn(() => periodicProcessor),
        getKeyValueDatabase: () => keyValueDatabase,
        getSettings: () => ({ syncInternalFiles: true }),
        log: vi.fn(),
        publishActivity,
        closeJsonConflictDialogs: vi.fn(),
        hideConfigurationChangeNotice,
    } as never);
    return { context, hideConfigurationChangeNotice, periodicProcessor, publishActivity };
}

describe("HiddenFileSyncContext ownership and start-up lifecycle", () => {
    it("creates each stateful capability owner per context instance", () => {
        const first = createContext();
        const second = createContext();

        expect(getPrivate<unknown>(first.context, "pathAdmission")).not.toBe(
            getPrivate<unknown>(second.context, "pathAdmission")
        );
        expect(getPrivate<unknown>(first.context, "changeNotifier")).not.toBe(
            getPrivate<unknown>(second.context, "changeNotifier")
        );
        expect(first.context.testing.conflictResolution).not.toBe(second.context.testing.conflictResolution);
        expect(getProcessedState(first.context)).not.toBe(getProcessedState(second.context));
        expect(getPrivate<unknown>(first.context, "changeProcessor")).not.toBe(
            getPrivate<unknown>(second.context, "changeProcessor")
        );
        expect(getPrivate<unknown>(first.context, "periodicInternalFileScanProcessor")).toBe(first.periodicProcessor);
        expect(getPrivate<unknown>(second.context, "periodicInternalFileScanProcessor")).toBe(second.periodicProcessor);

        first.context.dispose();
        second.context.dispose();
    });

    it.each([
        [new Map(), true],
        [new Map([[".obsidian/app.json", "1-2-3"]]), false],
    ])(
        "preserves start-up scan notice selection for the processed-file cache",
        async (processedFiles, forcedNotice) => {
            const { context } = createContext(processedFiles);
            const applyOfflineChanges = vi.fn(async () => undefined);
            context.applyOfflineChanges = applyOfflineChanges;

            await context.serviceHandlers.onDatabaseInitialised(false);

            expect(applyOfflineChanges).toHaveBeenCalledWith(forcedNotice);
            context.dispose();
        }
    );
});
