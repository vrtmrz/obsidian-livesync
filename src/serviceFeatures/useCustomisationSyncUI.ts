import type { App } from "@/deps.ts";
import { addIcon } from "@/deps.ts";
import { EVENT_REQUEST_OPEN_PLUGIN_SYNC_DIALOG, eventHub } from "@/common/events.ts";
import type { NecessaryServices } from "@vrtmrz/livesync-commonlib/compat/interfaces/ServiceModule";
import type {
    CustomisationSyncDialogView,
    CustomisationSyncUIControl,
} from "@/features/ConfigSync/customisationSyncView.ts";
import type { HiddenFileSyncInitialisationView } from "@/features/HiddenFileSync/hiddenFileSyncViews.ts";
import { PluginDialogModal } from "@/features/ConfigSync/PluginDialogModal.ts";
import { $msg } from "@/common/translation";

/** Services needed to compose the Obsidian-owned Customisation Sync UI. */
export type CustomisationSyncUIHost = NecessaryServices<"API" | "appLifecycle", never>;

/** The small modal surface owned by this composition feature. */
export interface CustomisationSyncDialog {
    open(): void;
    close(): void;
    isOpened?(): boolean;
    isOpen?(): boolean;
}

/** Replaceable modal construction seam used by focused interaction tests. */
export type CustomisationSyncDialogFactory = (
    app: App,
    customisationSync: CustomisationSyncDialogView,
    hiddenFileSync: HiddenFileSyncInitialisationView
) => CustomisationSyncDialog;

type RibbonElement = {
    addClass?: (name: string) => unknown;
    remove?: () => unknown;
};

const CUSTOM_SYNC_ICON = `<g transform="rotate(-90 75 218)"  fill="currentColor" fill-rule="evenodd">
            <path d="m272 166-9.38 9.38 9.38 9.38 9.38-9.38c1.96-1.93 5.11-1.9 7.03 0.058 1.91 1.94 1.91 5.04 0 6.98l-9.38 9.38 5.86 5.86-11.7 11.7c-8.34 8.35-21.4 9.68-31.3 3.19l-3.84 3.98c-8.45 8.7-20.1 13.6-32.2 13.6h-5.55v-9.95h5.55c9.43-0.0182 18.5-3.84 25-10.6l3.95-4.09c-6.54-9.86-5.23-23 3.14-31.3l11.7-11.7 5.86 5.86 9.38-9.38c1.96-1.93 5.11-1.9 7.03 0.0564 1.91 1.93 1.91 5.04 2e-3 6.98z"/>
        </g>`;

function defaultDialogFactory(
    app: App,
    customisationSync: CustomisationSyncDialogView,
    hiddenFileSync: HiddenFileSyncInitialisationView
): CustomisationSyncDialog {
    return new PluginDialogModal(app, customisationSync, hiddenFileSync);
}

function readDialogOpenState(dialog: CustomisationSyncDialog, fallback: boolean): boolean {
    const isOpened = dialog.isOpened?.();
    if (typeof isOpened === "boolean") return isOpened;
    const isOpen = dialog.isOpen?.();
    if (typeof isOpen === "boolean") return isOpen;
    return fallback;
}

/**
 * Compose the Obsidian-owned Customisation Sync command, ribbon, and modal.
 *
 * Registration happens from `onLoaded`: the legacy add-on registered its UI
 * from `onload`, which is invoked after that lifecycle phase. Settings have
 * already been loaded by `onLoaded`, while command availability is still
 * evaluated lazily from the focused view.
 */
export function useCustomisationSyncUI(
    host: CustomisationSyncUIHost,
    app: App,
    customisationSync: CustomisationSyncDialogView,
    hiddenFileSync: HiddenFileSyncInitialisationView,
    createDialog: CustomisationSyncDialogFactory = defaultDialogFactory
): CustomisationSyncUIControl {
    const { API, appLifecycle } = host.services;

    let dialog: CustomisationSyncDialog | undefined;
    let dialogOpened = false;
    let ribbonElement: RibbonElement | undefined;
    let requestOpenDisposer: (() => void) | undefined;
    let loadedDisposer: (() => void) | undefined;
    let resumedDisposer: (() => void) | undefined;
    let disposed = false;
    let registered = false;

    const open = () => {
        if (disposed || !customisationSync.isEnabled()) return;
        if (!dialog) {
            dialog = createDialog(app, customisationSync, hiddenFileSync);
        }
        dialog.open();
        dialogOpened = true;
    };

    const close = () => {
        const currentDialog = dialog;
        dialog = undefined;
        dialogOpened = false;
        currentDialog?.close();
    };

    const isOpen = () => {
        if (!dialog) return false;
        return readDialogOpenState(dialog, dialogOpened);
    };

    const updateRibbonVisibility = () => {
        if (typeof activeDocument === "undefined") return true;
        const element = activeDocument.querySelector<HTMLElement>(".livesync-ribbon-showcustom");
        element?.toggleClass("sls-hidden", !customisationSync.isEnabled());
        return true;
    };

    const registerUI = () => {
        if (disposed || registered) return Promise.resolve(true);
        registered = true;

        addIcon("custom-sync", CUSTOM_SYNC_ICON);
        API.addCommand({
            id: "livesync-plugin-dialog-ex",
            name: "Show customization sync dialog",
            checkCallback: (checking) => {
                if (!customisationSync.isEnabled()) return false;
                if (!checking) open();
                return true;
            },
        });

        ribbonElement = API.addRibbonIcon("custom-sync", $msg("cmdConfigSync.showCustomizationSync"), () => open());
        ribbonElement?.addClass?.("livesync-ribbon-showcustom");
        requestOpenDisposer = eventHub.onEvent(EVENT_REQUEST_OPEN_PLUGIN_SYNC_DIALOG, () => open());

        return Promise.resolve(true);
    };

    loadedDisposer = appLifecycle.onLoaded.addHandler(registerUI);
    resumedDisposer = appLifecycle.onResumed.addHandler(() => Promise.resolve(updateRibbonVisibility()));
    appLifecycle.onUnload.addHandler(() => {
        disposed = true;
        close();
        requestOpenDisposer?.();
        requestOpenDisposer = undefined;
        ribbonElement?.remove?.();
        ribbonElement = undefined;
        loadedDisposer?.();
        loadedDisposer = undefined;
        resumedDisposer?.();
        resumedDisposer = undefined;
        return Promise.resolve(true);
    });

    return Object.freeze({ open, close, isOpen });
}
