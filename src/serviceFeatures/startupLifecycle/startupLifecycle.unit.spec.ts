import { describe, expect, it, vi } from "vitest";
import { EVENT_REQUEST_RUN_DOCTOR, EVENT_REQUEST_RUN_FIX_INCOMPLETE, EVENT_SETTING_SAVED } from "@/common/events";
vi.mock("@/common/utils", () => ({
    isValidPath: () => true,
}));
import {
    STARTUP_LIFECYCLE_LAYOUT_PRIORITY,
    useStartupLifecycleFeature,
    type StartupLifecycleFeatureOptions,
    type StartupLifecycleHost,
} from "./index";

function createHost() {
    const addLayoutHandler = vi.fn();
    const addFirstInitialiseHandler = vi.fn();
    const eventHandlers = new Map<
        string,
        { callback: (...args: unknown[]) => unknown; unsubscribe: ReturnType<typeof vi.fn> }
    >();
    const onEvent = vi.fn((event: string, callback: (...args: unknown[]) => unknown) => {
        const unsubscribe = vi.fn();
        eventHandlers.set(event, { callback, unsubscribe });
        return unsubscribe;
    });
    const host = {
        services: {
            API: {},
            UI: {},
            appLifecycle: {
                onLayoutReady: { addHandler: addLayoutHandler },
                onFirstInitialise: { addHandler: addFirstInitialiseHandler },
            },
            context: {
                events: { onEvent },
                noticeGroups: {},
                translate: String,
            },
            setting: {
                currentSettings: vi.fn(() => ({ isConfigured: true })),
            },
        },
        serviceModules: {},
    } as unknown as StartupLifecycleHost;
    return { addFirstInitialiseHandler, addLayoutHandler, eventHandlers, host, onEvent };
}

function createOptions(events: string[] = []): StartupLifecycleFeatureOptions {
    return {
        inviteToOnboarding: vi.fn(() => events.push("invite")),
        waitForCompatibilityReview: vi.fn(async () => {
            events.push("compatibility-review");
        }),
        databaseReady: true,
        reportDatabaseNotReady: vi.fn(() => events.push("database-not-ready")),
        hasCompromisedChunks: vi.fn(async () => {
            events.push("compromised-chunks");
            return true;
        }),
        hasIncompleteDocuments: vi.fn(async () => {
            events.push("incomplete-documents");
            return true;
        }),
        runDoctor: vi.fn(async () => {
            events.push("doctor");
            return true;
        }),
        migrateBulkSend: vi.fn(async () => {
            events.push("bulk-send");
        }),
        log: vi.fn(),
    };
}

describe("useStartupLifecycleFeature", () => {
    it("registers layout admission at priority 1 and first-initialise in the established order", async () => {
        const events: string[] = [];
        const { addFirstInitialiseHandler, addLayoutHandler, host } = createHost();
        const options = createOptions(events);
        useStartupLifecycleFeature(host, options);

        expect(addLayoutHandler).toHaveBeenCalledWith(expect.any(Function), STARTUP_LIFECYCLE_LAYOUT_PRIORITY);
        expect(addFirstInitialiseHandler).toHaveBeenCalledWith(expect.any(Function));

        const layoutAdmission = addLayoutHandler.mock.calls[0][0] as () => Promise<boolean>;
        await expect(layoutAdmission()).resolves.toBe(true);
        const firstInitialise = addFirstInitialiseHandler.mock.calls[0][0] as () => Promise<boolean>;
        await expect(firstInitialise()).resolves.toBe(true);
        expect(events).toEqual([
            "compromised-chunks",
            "incomplete-documents",
            "compatibility-review",
            "doctor",
            "bulk-send",
        ]);
    });

    it("short-circuits first-initialise when database readiness or an integrity check fails", async () => {
        const events: string[] = [];
        const { addFirstInitialiseHandler, addLayoutHandler, host } = createHost();
        const options = createOptions(events);
        let databaseReady = false;
        Object.assign(options, { databaseReady: () => databaseReady });

        useStartupLifecycleFeature(host, options);
        const layoutAdmission = addLayoutHandler.mock.calls[0][0] as () => Promise<boolean>;
        await expect(layoutAdmission()).resolves.toBe(true);
        const firstInitialise = addFirstInitialiseHandler.mock.calls[0][0] as () => Promise<boolean>;
        await expect(firstInitialise()).resolves.toBe(false);
        expect(events).toEqual(["database-not-ready"]);

        databaseReady = true;
        vi.mocked(options.hasCompromisedChunks!).mockImplementation(async () => {
            events.push("compromised-chunks");
            return false;
        });
        await expect(firstInitialise()).resolves.toBe(false);
        expect(events).toEqual(["database-not-ready", "compromised-chunks"]);
        expect(options.hasIncompleteDocuments).not.toHaveBeenCalled();
    });

    it("does not re-admit a Vault which was unconfigured at its first layout invocation", async () => {
        const { addFirstInitialiseHandler, addLayoutHandler, eventHandlers, host } = createHost();
        const inviteToOnboarding = vi.fn();
        const options = {
            ...createOptions(),
            configured: false,
            inviteToOnboarding,
        } satisfies StartupLifecycleFeatureOptions;
        useStartupLifecycleFeature(host, options);
        const layoutAdmission = addLayoutHandler.mock.calls[0][0] as () => Promise<boolean>;

        await expect(layoutAdmission()).resolves.toBe(false);
        expect(inviteToOnboarding).toHaveBeenCalledOnce();
        expect(eventHandlers.has(EVENT_REQUEST_RUN_DOCTOR)).toBe(false);
        expect(eventHandlers.has(EVENT_REQUEST_RUN_FIX_INCOMPLETE)).toBe(false);

        Object.assign(options, { configured: true });
        await expect(layoutAdmission()).resolves.toBe(false);
        expect(eventHandlers.has(EVENT_REQUEST_RUN_DOCTOR)).toBe(false);
        expect(eventHandlers.has(EVENT_REQUEST_RUN_FIX_INCOMPLETE)).toBe(false);

        const firstInitialise = addFirstInitialiseHandler.mock.calls[0][0] as () => Promise<boolean>;
        await expect(firstInitialise()).resolves.toBe(false);
        expect(options.runDoctor).not.toHaveBeenCalled();
        expect(eventHandlers.has(EVENT_SETTING_SAVED)).toBe(false);
    });

    it("retires an admitted generation when settings become unconfigured and guards request races", async () => {
        const { addFirstInitialiseHandler, addLayoutHandler, eventHandlers, host } = createHost();
        let configured = true;
        let databaseReady = true;
        const options = {
            ...createOptions(),
            configured: () => configured,
            databaseReady: () => databaseReady,
        } satisfies StartupLifecycleFeatureOptions;
        useStartupLifecycleFeature(host, options);
        const layoutAdmission = addLayoutHandler.mock.calls[0][0] as () => Promise<boolean>;

        await expect(layoutAdmission()).resolves.toBe(true);
        expect(eventHandlers.get(EVENT_REQUEST_RUN_DOCTOR)).toBeDefined();
        expect(eventHandlers.get(EVENT_REQUEST_RUN_FIX_INCOMPLETE)).toBeDefined();

        const runDoctor = eventHandlers.get(EVENT_REQUEST_RUN_DOCTOR)!.callback as (reason: string) => Promise<void>;
        const fixIncomplete = eventHandlers.get(EVENT_REQUEST_RUN_FIX_INCOMPLETE)!.callback as () => Promise<void>;
        const settingSaved = eventHandlers.get(EVENT_SETTING_SAVED)!.callback as (settings: unknown) => unknown;

        await settingSaved({ isConfigured: true });
        expect(eventHandlers.get(EVENT_REQUEST_RUN_DOCTOR)!.unsubscribe).not.toHaveBeenCalled();
        expect(eventHandlers.get(EVENT_REQUEST_RUN_FIX_INCOMPLETE)!.unsubscribe).not.toHaveBeenCalled();

        databaseReady = false;
        await runDoctor("database race");
        await fixIncomplete();
        expect(options.runDoctor).not.toHaveBeenCalled();
        expect(options.hasIncompleteDocuments).not.toHaveBeenCalled();

        databaseReady = true;
        configured = false;
        await runDoctor("configuration race");
        await fixIncomplete();
        expect(options.runDoctor).not.toHaveBeenCalled();
        expect(options.hasIncompleteDocuments).not.toHaveBeenCalled();

        await settingSaved({ isConfigured: false });
        expect(eventHandlers.get(EVENT_REQUEST_RUN_DOCTOR)!.unsubscribe).toHaveBeenCalledOnce();
        expect(eventHandlers.get(EVENT_REQUEST_RUN_FIX_INCOMPLETE)!.unsubscribe).toHaveBeenCalledOnce();
        expect(eventHandlers.get(EVENT_SETTING_SAVED)!.unsubscribe).toHaveBeenCalledOnce();

        configured = true;
        await expect(layoutAdmission()).resolves.toBe(false);
        await runDoctor("retired generation");
        await fixIncomplete();
        expect(options.runDoctor).not.toHaveBeenCalled();
        expect(options.hasIncompleteDocuments).not.toHaveBeenCalled();

        const firstInitialise = addFirstInitialiseHandler.mock.calls[0][0] as () => Promise<boolean>;
        await expect(firstInitialise()).resolves.toBe(false);
    });

    it("keeps doctor and incomplete-document request operations behind layout admission", async () => {
        const { addLayoutHandler, eventHandlers, host, onEvent } = createHost();
        const options = createOptions();
        useStartupLifecycleFeature(host, options);
        const layoutAdmission = addLayoutHandler.mock.calls[0][0] as () => Promise<boolean>;

        await layoutAdmission();
        await layoutAdmission();
        expect(onEvent.mock.calls.filter(([event]) => event === EVENT_REQUEST_RUN_DOCTOR)).toHaveLength(1);
        expect(onEvent.mock.calls.filter(([event]) => event === EVENT_REQUEST_RUN_FIX_INCOMPLETE)).toHaveLength(1);

        const runDoctor = eventHandlers.get(EVENT_REQUEST_RUN_DOCTOR)!.callback as (reason: string) => Promise<void>;
        const fixIncomplete = eventHandlers.get(EVENT_REQUEST_RUN_FIX_INCOMPLETE)!.callback as () => Promise<void>;
        await runDoctor("manual request");
        await fixIncomplete();

        expect(options.runDoctor).toHaveBeenCalledWith(false, "manual request", true);
        expect(options.hasIncompleteDocuments).toHaveBeenCalledWith(true);
    });
});
