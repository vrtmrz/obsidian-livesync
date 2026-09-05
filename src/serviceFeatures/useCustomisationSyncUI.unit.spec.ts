import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/deps.ts", () => ({
    addIcon: vi.fn(),
}));
vi.mock("@/common/events.ts", () => ({
    EVENT_REQUEST_OPEN_PLUGIN_SYNC_DIALOG: "request-open-plugin-sync-dialog",
    eventHub: {
        onEvent: vi.fn(),
    },
}));
vi.mock("@/common/translation", () => ({
    $msg: vi.fn((key: string) => key),
}));
vi.mock("@/features/ConfigSync/PluginDialogModal.ts", () => ({
    PluginDialogModal: class PluginDialogModal {},
}));

import { addIcon } from "@/deps.ts";
import { eventHub } from "@/common/events.ts";
import {
    type CustomisationSyncDialog,
    type CustomisationSyncDialogFactory,
    useCustomisationSyncUI,
} from "./useCustomisationSyncUI.ts";

type Handler = () => unknown;

function createFixture(enabled = true) {
    let settingEnabled = enabled;
    let loadedHandler: Handler | undefined;
    let resumedHandler: Handler | undefined;
    let unloadHandler: Handler | undefined;

    const loadedDisposer = vi.fn();
    const resumedDisposer = vi.fn();
    const eventDisposer = vi.fn();
    const ribbonElement = {
        addClass: vi.fn(),
        remove: vi.fn(),
    };
    const commands: Array<{
        id: string;
        checkCallback?: (checking: boolean) => boolean | void;
    }> = [];
    const ribbonCallbacks: Array<() => unknown> = [];

    const host = {
        services: {
            API: {
                addCommand: vi.fn((command) => {
                    commands.push(command);
                    return command;
                }),
                addRibbonIcon: vi.fn((_icon: string, _title: string, callback: () => unknown) => {
                    ribbonCallbacks.push(callback);
                    return ribbonElement;
                }),
            },
            appLifecycle: {
                onLoaded: {
                    addHandler: vi.fn((handler: Handler) => {
                        loadedHandler = handler;
                        return loadedDisposer;
                    }),
                },
                onResumed: {
                    addHandler: vi.fn((handler: Handler) => {
                        resumedHandler = handler;
                        return resumedDisposer;
                    }),
                },
                onUnload: {
                    addHandler: vi.fn((handler: Handler) => {
                        unloadHandler = handler;
                        return vi.fn();
                    }),
                },
            },
        },
    } as any;

    const customisationSync = {
        isEnabled: vi.fn(() => settingEnabled),
    } as any;
    const hiddenFileSync = {} as any;
    const modal: CustomisationSyncDialog = {
        open: vi.fn(),
        close: vi.fn(),
        isOpened: vi.fn(() => true),
    };
    const createDialog = vi.fn<CustomisationSyncDialogFactory>(() => modal);

    return {
        host,
        customisationSync,
        hiddenFileSync,
        modal,
        createDialog,
        commands,
        ribbonCallbacks,
        ribbonElement,
        eventDisposer,
        loadedDisposer,
        resumedDisposer,
        setEnabled(value: boolean) {
            settingEnabled = value;
        },
        get loadedHandler() {
            return loadedHandler;
        },
        get resumedHandler() {
            return resumedHandler;
        },
        get unloadHandler() {
            return unloadHandler;
        },
    };
}

describe("useCustomisationSyncUI", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        delete (globalThis as { activeDocument?: unknown }).activeDocument;
        currentEventDisposer = vi.fn();
        vi.mocked(eventHub.onEvent).mockImplementation((_event, callback) => {
            fixtureEventCallback = callback as Handler;
            return currentEventDisposer;
        });
    });

    let fixtureEventCallback: Handler | undefined;
    let currentEventDisposer = vi.fn();

    it("registers the command and gates it on the focused view's enabled state", async () => {
        const fixture = createFixture(false);
        const control = useCustomisationSyncUI(
            fixture.host,
            {} as any,
            fixture.customisationSync,
            fixture.hiddenFileSync,
            fixture.createDialog
        );

        expect(addIcon).not.toHaveBeenCalled();
        await fixture.loadedHandler?.();
        expect(addIcon).toHaveBeenCalledWith("custom-sync", expect.stringContaining("rotate(-90 75 218)"));

        const command = fixture.commands.find(({ id }) => id === "livesync-plugin-dialog-ex");
        expect(command?.checkCallback?.(true)).toBe(false);
        expect(command?.checkCallback?.(false)).toBe(false);
        expect(fixture.createDialog).not.toHaveBeenCalled();

        fixture.setEnabled(true);
        expect(command?.checkCallback?.(true)).toBe(true);
        expect(command?.checkCallback?.(false)).toBe(true);
        expect(fixture.createDialog).toHaveBeenCalledOnce();
        expect(control.isOpen()).toBe(true);
    });

    it("opens from the request event and ribbon, reusing one modal instance", async () => {
        const fixture = createFixture(true);
        const control = useCustomisationSyncUI(
            fixture.host,
            {} as any,
            fixture.customisationSync,
            fixture.hiddenFileSync,
            fixture.createDialog
        );
        await fixture.loadedHandler?.();

        expect(fixture.ribbonElement.addClass).toHaveBeenCalledWith("livesync-ribbon-showcustom");
        expect(fixture.host.services.API.addRibbonIcon).toHaveBeenCalledWith(
            "custom-sync",
            "cmdConfigSync.showCustomizationSync",
            expect.any(Function)
        );
        expect(fixture.ribbonCallbacks).toHaveLength(1);
        expect(fixtureEventCallback).toBeDefined();

        fixtureEventCallback?.();
        fixture.ribbonCallbacks[0]?.();

        expect(fixture.createDialog).toHaveBeenCalledOnce();
        expect(fixture.modal.open).toHaveBeenCalledTimes(2);
        expect(control.isOpen()).toBe(true);
    });

    it("updates resumed ribbon visibility and releases the event, ribbon, and modal on unload", async () => {
        const ribbonElement = {
            toggleClass: vi.fn(),
        };
        Object.defineProperty(globalThis, "activeDocument", {
            configurable: true,
            value: {
                querySelector: vi.fn(() => ribbonElement),
            },
        });

        const fixture = createFixture(true);
        currentEventDisposer = fixture.eventDisposer;
        const control = useCustomisationSyncUI(
            fixture.host,
            {} as any,
            fixture.customisationSync,
            fixture.hiddenFileSync,
            fixture.createDialog
        );
        await fixture.loadedHandler?.();
        await fixture.resumedHandler?.();
        expect(ribbonElement.toggleClass).toHaveBeenCalledWith("sls-hidden", false);

        control.open();
        await fixture.unloadHandler?.();

        expect(fixture.modal.close).toHaveBeenCalledOnce();
        expect(fixture.eventDisposer).toHaveBeenCalledOnce();
        expect(fixture.ribbonElement.remove).toHaveBeenCalledOnce();
        expect(fixture.loadedDisposer).toHaveBeenCalledOnce();
        expect(fixture.resumedDisposer).toHaveBeenCalledOnce();
        expect(control.isOpen()).toBe(false);
    });
});
