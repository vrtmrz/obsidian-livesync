import { createServiceContext } from "@vrtmrz/livesync-commonlib/context";
import { EVENT_PLUGIN_UNLOADED } from "@vrtmrz/livesync-commonlib/compat/events/coreEvents";
import { MemoryValueStore } from "@vrtmrz/value-store";

import { Menu } from "@/apps/browser/BrowserMenu";
import { createLiveSyncBrowserServiceHub } from "@/apps/browser/createLiveSyncBrowserServiceHub";
import TestLifecycleDialog from "./TestLifecycleDialog.svelte";

type OwnerName = "owner-a" | "owner-b" | "owner-c" | "owner-d";
type DialogOutcome =
    | { readonly kind: "resolved"; readonly value: unknown }
    | { readonly kind: "rejected"; readonly message: string };

interface Owner {
    readonly context: ReturnType<typeof createServiceContext>;
    readonly document: Document;
    readonly hub: ReturnType<typeof createLiveSyncBrowserServiceHub>;
    readonly menu: Menu;
    readonly parentAbort?: AbortController;
    readonly dialogOutcomes: DialogOutcome[];
    readonly menuOutcomes: string[];
    savedBackdrop?: HTMLElement;
}

interface BrowserUiLifecycleFixture {
    readonly ready: boolean;
    startDialog(name: OwnerName, initialData?: string): void;
    startMenu(name: OwnerName, title: string): void;
    clickSavedBackdrop(name: OwnerName): void;
    hideMenu(name: OwnerName): void;
    unload(name: OwnerName): void;
    abortParent(name: OwnerName): void;
    state(name: OwnerName): {
        readonly dialogs: readonly DialogOutcome[];
        readonly menus: readonly string[];
        readonly hasSavedBackdrop: boolean;
    };
}

declare global {
    interface Window {
        browserUiLifecycle?: BrowserUiLifecycleFixture;
    }
}

const owners = new Map<OwnerName, Owner>();

function ownerDocument(name: OwnerName): Document {
    const frame = document.getElementById(name);
    if (!(frame instanceof HTMLIFrameElement) || !frame.contentDocument) {
        throw new Error(`The ${name} frame is not ready`);
    }
    return frame.contentDocument;
}

function createOwner(name: OwnerName, options: { parentAbort?: AbortController; preAborted?: boolean } = {}): Owner {
    const frameDocument = ownerDocument(name);
    const parentAbort = options.parentAbort;
    if (options.preAborted) {
        parentAbort?.abort(new Error("Fixture UI owner ended"));
    }
    const context = createServiceContext();
    const hub = createLiveSyncBrowserServiceHub({
        context,
        deviceValues: new MemoryValueStore(),
        ui: {
            document: frameDocument,
            ...(parentAbort ? { signal: parentAbort.signal } : {}),
        },
    });
    return {
        context,
        document: frameDocument,
        hub,
        menu: new Menu({ document: frameDocument, signal: hub.browserUi.signal }),
        ...(parentAbort ? { parentAbort } : {}),
        dialogOutcomes: [],
        menuOutcomes: [],
    };
}

const ownerCAbort = new AbortController();
const ownerDAbort = new AbortController();
ownerDAbort.abort(new Error("Fixture UI owner ended"));

owners.set("owner-a", createOwner("owner-a"));
owners.set("owner-b", createOwner("owner-b"));
owners.set("owner-c", createOwner("owner-c", { parentAbort: ownerCAbort }));
owners.set("owner-d", createOwner("owner-d", { parentAbort: ownerDAbort, preAborted: true }));

const fixture: BrowserUiLifecycleFixture = {
    ready: true,
    startDialog(name, initialData) {
        const owner = owners.get(name)!;
        try {
            void owner.hub.UI.dialogManager.open(TestLifecycleDialog, initialData).then(
                (value) =>
                    owner.dialogOutcomes.push({ kind: "resolved", value: value === undefined ? "undefined" : value }),
                (error: unknown) =>
                    owner.dialogOutcomes.push({
                        kind: "rejected",
                        message: error instanceof Error ? error.message : String(error),
                    })
            );
        } catch (error) {
            owner.dialogOutcomes.push({
                kind: "rejected",
                message: error instanceof Error ? error.message : String(error),
            });
        }
    },
    startMenu(name, title) {
        const owner = owners.get(name)!;
        owner.savedBackdrop = owner.document.querySelector<HTMLElement>(".background") ?? undefined;
        try {
            void owner.menu
                .addItem((item) => item.setTitle(title))
                .showAtPosition({ x: 12, y: 12 })
                .then(
                    () => owner.menuOutcomes.push("resolved"),
                    (error: unknown) =>
                        owner.menuOutcomes.push(`rejected:${error instanceof Error ? error.message : String(error)}`)
                );
        } catch (error) {
            owner.menuOutcomes.push(`rejected:${error instanceof Error ? error.message : String(error)}`);
        }
    },
    clickSavedBackdrop(name) {
        const owner = owners.get(name)!;
        const window = owner.document.defaultView;
        if (owner.savedBackdrop && window) {
            owner.savedBackdrop.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
        }
    },
    hideMenu(name) {
        owners.get(name)!.menu.hide();
    },
    unload(name) {
        owners.get(name)!.context.events.emitEvent(EVENT_PLUGIN_UNLOADED);
    },
    abortParent(name) {
        owners.get(name)!.parentAbort?.abort(new Error("Fixture UI owner ended"));
    },
    state(name) {
        const owner = owners.get(name)!;
        return {
            dialogs: [...owner.dialogOutcomes],
            menus: [...owner.menuOutcomes],
            hasSavedBackdrop: owner.savedBackdrop !== undefined,
        };
    },
};

window.browserUiLifecycle = fixture;
