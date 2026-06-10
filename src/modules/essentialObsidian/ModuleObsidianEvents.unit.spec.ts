import { describe, it, expect, vi, afterEach } from "vitest";

import { ModuleObsidianEvents } from "./ModuleObsidianEvents";
import { DEFAULT_SETTINGS, REMOTE_COUCHDB } from "@lib/common/types";

type SetupOptions = {
    settings?: Partial<typeof DEFAULT_SETTINGS>;
    hidden: boolean;
    isLastHidden?: boolean;
    hasFocus?: boolean;
    isSuspended?: boolean;
    // Platform is read via services.API.isMobile(); default desktop (false) so the feature applies.
    isMobile?: boolean;
};

function setup(opts: SetupOptions) {
    const appLifecycle = {
        isReady: vi.fn(() => true),
        isSuspended: vi.fn(() => opts.isSuspended ?? false),
        onSuspending: vi.fn(async () => true),
        onResuming: vi.fn(async () => true),
        onResumed: vi.fn(async () => true),
    };
    const fileProcessing = { commitPendingFileEvents: vi.fn(async () => true) };

    const core = {
        _services: {
            API: {
                addLog: vi.fn(),
                addCommand: vi.fn(),
                registerWindow: vi.fn(),
                addRibbonIcon: vi.fn(),
                registerProtocolHandler: vi.fn(),
                isMobile: vi.fn(() => opts.isMobile ?? false),
            },
            setting: { saveSettingData: vi.fn(async () => undefined) },
            appLifecycle,
            fileProcessing,
        },
        settings: {
            ...DEFAULT_SETTINGS,
            remoteType: REMOTE_COUCHDB,
            isConfigured: true,
            ...opts.settings,
        },
    } as any;
    Object.defineProperty(core, "services", { get: () => core._services });

    const module = new ModuleObsidianEvents({} as any, core);
    module.isLastHidden = opts.isLastHidden ?? false;
    module.hasFocus = opts.hasFocus ?? true;

    // The handler reads `activeWindow.document.hidden`.
    (globalThis as any).activeWindow = { document: { hidden: opts.hidden } };

    return { module, appLifecycle, fileProcessing };
}

describe("watchWindowVisibilityAsync — keepReplicationActiveInBackground", () => {
    afterEach(() => {
        // The handler reads a global `activeWindow`; clear it so it doesn't leak into sibling spec
        // files running in the same worker.
        delete (globalThis as any).activeWindow;
    });

    it("does NOT suspend on hide when enabled in LiveSync mode on the desktop app", async () => {
        const { module, appLifecycle } = setup({
            settings: { keepReplicationActiveInBackground: true, liveSync: true },
            hidden: true,
        });
        await module.watchWindowVisibilityAsync();
        expect(appLifecycle.onSuspending).not.toHaveBeenCalled();
    });

    it("suspends on hide by default (setting off)", async () => {
        const { module, appLifecycle } = setup({
            settings: { keepReplicationActiveInBackground: false, liveSync: true },
            hidden: true,
        });
        await module.watchWindowVisibilityAsync();
        expect(appLifecycle.onSuspending).toHaveBeenCalledTimes(1);
    });

    it("forces onSuspending before the resume on becoming visible when enabled (LiveSync teardown)", async () => {
        const { module, appLifecycle } = setup({
            settings: { keepReplicationActiveInBackground: true, liveSync: true },
            hidden: false,
            isLastHidden: true, // hidden -> visible transition
        });
        await module.watchWindowVisibilityAsync();
        // Decision-logic only: on visible + enabled + LiveSync the handler calls onSuspending (the
        // forced teardown) before onResuming. The actual stalled-channel replacement is exercised by
        // the manual integration test, not here.
        expect(appLifecycle.onSuspending).toHaveBeenCalledTimes(1);
        expect(appLifecycle.onResuming).toHaveBeenCalledTimes(1);
        expect(appLifecycle.onResumed).toHaveBeenCalledTimes(1);
        expect(appLifecycle.onSuspending.mock.invocationCallOrder[0]).toBeLessThan(
            appLifecycle.onResuming.mock.invocationCallOrder[0]
        );
    });

    it("does not force a teardown on becoming visible by default (setting off)", async () => {
        const { module, appLifecycle } = setup({
            settings: { keepReplicationActiveInBackground: false, liveSync: true },
            hidden: false,
            isLastHidden: true,
        });
        await module.watchWindowVisibilityAsync();
        expect(appLifecycle.onSuspending).not.toHaveBeenCalled();
        expect(appLifecycle.onResumed).toHaveBeenCalledTimes(1);
    });

    it("does not apply in On-Events mode even if the flag is set (no scope leak)", async () => {
        const { module, appLifecycle } = setup({
            settings: {
                keepReplicationActiveInBackground: true,
                liveSync: false,
                periodicReplication: false,
            },
            hidden: true,
        });
        await module.watchWindowVisibilityAsync();
        expect(appLifecycle.onSuspending).toHaveBeenCalledTimes(1);
    });

    it("does NOT suspend on hide when enabled in Periodic mode (the periodic timer also stalls otherwise)", async () => {
        const { module, appLifecycle } = setup({
            settings: {
                keepReplicationActiveInBackground: true,
                liveSync: false,
                periodicReplication: true,
            },
            hidden: true,
        });
        await module.watchWindowVisibilityAsync();
        expect(appLifecycle.onSuspending).not.toHaveBeenCalled();
    });

    it("does NOT force a teardown on becoming visible in Periodic mode (only the continuous channel can stall)", async () => {
        const { module, appLifecycle } = setup({
            settings: {
                keepReplicationActiveInBackground: true,
                liveSync: false,
                periodicReplication: true,
            },
            hidden: false,
            isLastHidden: true,
        });
        await module.watchWindowVisibilityAsync();
        // The teardown is gated on liveSync: a periodic timer doesn't go half-open, so bouncing it
        // on every restore would be needless churn. Resume still runs normally.
        expect(appLifecycle.onSuspending).not.toHaveBeenCalled();
        expect(appLifecycle.onResuming).toHaveBeenCalledTimes(1);
        expect(appLifecycle.onResumed).toHaveBeenCalledTimes(1);
    });

    it("does not apply on mobile even if the flag is set", async () => {
        const { module, appLifecycle } = setup({
            settings: { keepReplicationActiveInBackground: true, liveSync: true },
            hidden: true,
            isMobile: true,
        });
        await module.watchWindowVisibilityAsync();
        expect(appLifecycle.onSuspending).toHaveBeenCalledTimes(1);
    });
});
