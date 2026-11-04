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

async function createHarness() {
    const { ModuleLog } = await import("./ModuleLog.ts");
    const { bindableFunction, allFunction } =
        await import("@vrtmrz/livesync-commonlib/compat/services/lib/HandlerUtils");
    const services = {
        API: {
            addLog: bindableFunction<(message: unknown, level?: number, key?: string) => void>("log"),
            addCommand: vi.fn(),
            registerWindow: vi.fn(),
            addRibbonIcon: vi.fn(),
            registerProtocolHandler: vi.fn(),
        },
        context: { events: {}, notices: { hide: vi.fn() } },
        appLifecycle: {
            onInitialise: allFunction<() => Promise<boolean>>(),
            onSettingLoaded: allFunction<() => Promise<boolean>>(),
            onLoaded: allFunction<() => Promise<boolean>>(),
            onBeforeUnload: allFunction<() => Promise<boolean>>(),
        },
    };
    const core = { services, settings: {} };
    const module = new ModuleLog({ app: {} } as never, core as never);
    const sink = vi.spyOn(module, "__addLog").mockImplementation(() => undefined);
    vi.spyOn(module, "observeForLogs").mockImplementation(() => undefined);
    vi.spyOn(module, "adjustStatusDivPosition").mockImplementation(() => undefined);
    module.onBindFunction(core as never, services as never);
    const { Logger } = await import("octagonal-wheels/common/logger");
    return { module, services, sink, Logger };
}

describe("ModuleLog service connection", () => {
    beforeEach(() => {
        vi.resetModules();
        vi.stubGlobal("document", { querySelectorAll: () => [] });
    });
    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it("buffers startup logs and preserves global and service call order", async () => {
        const { services, sink, Logger } = await createHarness();
        Logger("before-global");
        services.API.addLog("before-service", 32, "startup");
        Logger("between-global");
        expect(sink).not.toHaveBeenCalled();
        await services.appLifecycle.onSettingLoaded();
        const messages = sink.mock.calls.map(([message]) => message);
        expect(messages.filter((message) => typeof message === "string" && /^(before|between)-/.test(message))).toEqual(
            ["before-global", "before-service", "between-global"]
        );
        expect(sink).toHaveBeenCalledWith("before-service", 32, "startup");
    });

    it("delivers service logs only to their own module", async () => {
        const first = await createHarness();
        const second = await createHarness();
        await first.services.appLifecycle.onSettingLoaded();
        await second.services.appLifecycle.onSettingLoaded();
        first.sink.mockClear();
        second.sink.mockClear();

        first.services.API.addLog("first", 32, "first-key");
        second.services.API.addLog("second", 64, "second-key");
        expect(first.sink.mock.calls).toEqual([["first", 32, "first-key"]]);
        expect(second.sink.mock.calls).toEqual([["second", 64, "second-key"]]);
    });

    it("preserves message conversion, levels, keys, and error causes", async () => {
        const { services, sink } = await createHarness();
        await services.appLifecycle.onSettingLoaded();
        sink.mockClear();
        const error = new Error("failed");
        services.API.addLog(error, 128, "failure");
        services.API.addLog({ result: "value" }, 32, "object");
        services.API.addLog("plain");
        const converted = sink.mock.calls[0][0] as Error & { cause: unknown };
        expect(converted.message).toBe("[Error Logged]: failed");
        expect(converted.cause).toBe(error);
        expect(sink.mock.calls[0].slice(1)).toEqual([128, "failure"]);
        expect(sink.mock.calls.slice(1)).toEqual([
            ['{"result":"value"}', 32, "object"],
            ["plain", undefined, undefined],
        ]);
    });

    it("keeps service logging callable after disposal and sends late logs to the console", async () => {
        const { services, module, sink } = await createHarness();
        await services.appLifecycle.onSettingLoaded();
        sink.mockClear();
        const consoleLog = vi.spyOn(console, "log").mockImplementation(() => undefined);

        await module.logResource.dispose();
        try {
            expect(() => services.API.addLog("late-service", 32, "late-key")).not.toThrow();
            expect(consoleLog).toHaveBeenCalledExactlyOnceWith({
                message: "late-service",
                level: 32,
                key: "late-key",
            });
            const cause = new Error("root cause");
            const error = Object.assign(new Error("late failure"), { cause });
            services.API.addLog(error, 128, "late-error");
            const errorEntry = consoleLog.mock.calls[1][0] as {
                message: Error & { cause?: unknown };
                level?: number;
                key?: string;
            };
            expect(errorEntry.message).toBe(error);
            expect(errorEntry.message.cause).toBe(cause);
            expect(errorEntry.level).toBe(128);
            expect(errorEntry.key).toBe("late-error");
            expect(sink).not.toHaveBeenCalled();
        } finally {
            consoleLog.mockRestore();
        }
    });

    it("sends late circular service messages directly to the console", async () => {
        const { services, module, sink } = await createHarness();
        await services.appLifecycle.onSettingLoaded();
        sink.mockClear();
        const consoleLog = vi.spyOn(console, "log").mockImplementation(() => undefined);
        const circular: { self?: unknown } = {};
        circular.self = circular;

        try {
            await module.logResource.dispose();
            expect(() => services.API.addLog(circular, 32, "circular")).not.toThrow();
            const consoleEntry = consoleLog.mock.calls[0][0] as {
                message: unknown;
                level?: number;
                key?: string;
            };
            expect(consoleEntry.message).toBe(circular);
            expect(consoleEntry.level).toBe(32);
            expect(consoleEntry.key).toBe("circular");
            expect(sink).not.toHaveBeenCalled();
        } finally {
            consoleLog.mockRestore();
        }
    });

    it("releases legacy and UI subscriptions while retaining late service console logging", async () => {
        const first = await createHarness();
        const second = await createHarness();
        await first.services.appLifecycle.onSettingLoaded();
        await second.services.appLifecycle.onSettingLoaded();
        first.sink.mockClear();
        second.sink.mockClear();
        const consoleLog = vi.spyOn(console, "log").mockImplementation(() => undefined);

        try {
            await first.module.logResource.dispose();
            await first.module.logResource.dispose();
            expect(() => first.services.API.addLog("retired", 32, "retired-key")).not.toThrow();
            expect(consoleLog).toHaveBeenCalledWith({
                message: "retired",
                level: 32,
                key: "retired-key",
            });
            second.services.API.addLog("active", 32, "service");
            first.Logger("legacy-after-retirement", 32, "legacy");
            expect(first.sink).not.toHaveBeenCalled();
            expect(second.sink.mock.calls).toEqual([
                ["active", 32, "service"],
                ["legacy-after-retirement", 32, "legacy"],
            ]);
            await second.module.logResource.dispose();
        } finally {
            consoleLog.mockRestore();
        }
    });

    it("leaves a replacement service handler registered when the old owner is disposed", async () => {
        const { services, module, sink, Logger } = await createHarness();
        await services.appLifecycle.onSettingLoaded();
        const replacement = vi.fn();
        services.API.addLog.setHandler(replacement, true);
        sink.mockClear();

        await module.logResource.dispose();
        await module.logResource.dispose();
        services.API.addLog("replacement", 32, "key");
        Logger("detached-legacy");
        expect(replacement).toHaveBeenCalledExactlyOnceWith("replacement", 32, "key");
        expect(sink).not.toHaveBeenCalled();
    });

    it("retires a connection which never reached the settings-loaded phase", async () => {
        const { services, module, sink, Logger } = await createHarness();
        services.API.addLog("pending");
        const consoleLog = vi.spyOn(console, "log").mockImplementation(() => undefined);
        try {
            await module.logResource.dispose();
            Logger("after-disposal");
            expect(() => services.API.addLog("retired", 32, "retired-key")).not.toThrow();
            expect(consoleLog).toHaveBeenCalledWith({
                message: "retired",
                level: 32,
                key: "retired-key",
            });
            expect(sink).not.toHaveBeenCalled();

            const replacement = await createHarness();
            await replacement.services.appLifecycle.onSettingLoaded();
            const messages = replacement.sink.mock.calls.map(([message]) => message);
            expect(messages).toContain("after-disposal");
            expect(messages).not.toContain("pending");
            expect(messages).not.toContain("retired");
            await replacement.module.logResource.dispose();
        } finally {
            consoleLog.mockRestore();
        }
    });

    it.each(["complete", "fail"] as const)(
        "keeps logging through asynchronous database shutdown and releases after it: %s",
        async (outcome) => {
            const { services, module, sink, Logger } = await createHarness();
            await services.appLifecycle.onSettingLoaded();
            sink.mockClear();
            const { ControlService } = await import("@vrtmrz/livesync-commonlib/compat/services/base/ControlService");
            const { ServiceContext } = await import("@vrtmrz/livesync-commonlib/context");
            const { withOwnedResource } = await import("octagonal-wheels/resource");
            let finish!: () => void;
            let fail!: (reason: Error) => void;
            let started!: () => void;
            const closing = new Promise<void>((resolve) => {
                started = resolve;
            });
            const closed = new Promise<void>((resolve, reject) => {
                finish = resolve;
                fail = reject;
            });
            const control = new ControlService(new ServiceContext({ translate: (key) => key }), {
                appLifecycleService: {
                    ...services.appLifecycle,
                    onAppUnload: vi.fn(async () => []),
                    onUnload: vi.fn(async () => {
                        services.API.addLog("lifecycle-unload");
                        return true;
                    }),
                },
                APIService: services.API,
                databaseService: {
                    localDatabaseDirect: {
                        onunload: vi.fn(() => services.API.addLog("database-unload")),
                        close: vi.fn(() => {
                            started();
                            return closed;
                        }),
                    },
                },
            } as never);

            const unloading = withOwnedResource(module.logResource, () => control.onUnload());
            await closing;
            services.API.addLog("during-close");
            expect(sink.mock.calls.map(([message]) => message)).toEqual([
                "lifecycle-unload",
                "database-unload",
                "during-close",
            ]);
            if (outcome === "fail") {
                const failure = new Error("database close failed");
                const rejected = expect(unloading).rejects.toBe(failure);
                fail(failure);
                await rejected;
            } else {
                finish();
                await unloading;
                expect(sink.mock.calls[sink.mock.calls.length - 1][0]).toContain(
                    "moduleLiveSyncMain.logUnloadingPlugin"
                );
            }
            const consoleLog = vi.spyOn(console, "log").mockImplementation(() => undefined);
            try {
                expect(() => services.API.addLog("late-after-close", 32, "late-after-close")).not.toThrow();
                expect(consoleLog).toHaveBeenCalledWith({
                    message: "late-after-close",
                    level: 32,
                    key: "late-after-close",
                });
                sink.mockClear();
                Logger("after-unload");
                expect(sink).not.toHaveBeenCalled();
            } finally {
                consoleLog.mockRestore();
            }
        }
    );
});
