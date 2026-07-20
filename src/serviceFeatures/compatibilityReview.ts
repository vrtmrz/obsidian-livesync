import { fireAndForget } from "octagonal-wheels/promises";
import { VER } from "@vrtmrz/livesync-commonlib/compat/common/types";
import type { LiveSyncCore } from "@/main.ts";
import {
    COMPATIBILITY_PAUSE_SETTING_MESSAGE,
    DATABASE_COMPATIBILITY_VERSION_KEY,
    evaluateCompatibilityPause,
    legacyDatabaseCompatibilityVersionKey,
    type CompatibilityPause,
} from "@/common/databaseCompatibility.ts";

export type CompatibilityReviewSummaryAction = "details" | "resume" | "keep-paused" | false;
export type CompatibilityReviewDetailsAction = "back" | false;

// Explicit flag-file recovery runs at priorities 5, 10, and 20. Present the
// compatibility review only after those operations have completed; a recovery
// handler which stops start-up also prevents this dialogue from competing with it.
export const COMPATIBILITY_REVIEW_LAYOUT_PRIORITY = 30;

export interface CompatibilityReviewUi {
    showSummary(pause: CompatibilityPause): Promise<CompatibilityReviewSummaryAction>;
    showDetails(pause: CompatibilityPause): Promise<CompatibilityReviewDetailsAction>;
    showReminder(openReview: () => void): void;
    clearReminder(): void;
}

export class CompatibilityReviewController {
    private pause: CompatibilityPause | undefined;
    private activeReview: Promise<void> | undefined;
    private _initialised = false;
    private disposed = false;

    constructor(
        private readonly core: LiveSyncCore,
        private readonly ui: CompatibilityReviewUi,
        private readonly currentVersion: number = VER
    ) {}

    get pendingPause(): CompatibilityPause | undefined {
        return this.pause;
    }

    get initialised(): boolean {
        return this._initialised;
    }

    private readAcknowledgedVersion(): string | null {
        const setting = this.core.services.setting;
        const currentMarker = setting.getSmallConfig(DATABASE_COMPATIBILITY_VERSION_KEY);
        if (currentMarker) return currentMarker;

        const legacyKey = legacyDatabaseCompatibilityVersionKey(this.core.services.vault.getVaultName());
        const legacyMarker = setting.getDeviceLocalConfig(legacyKey);
        if (!legacyMarker) return null;

        setting.setSmallConfig(DATABASE_COMPATIBILITY_VERSION_KEY, legacyMarker);
        setting.deleteDeviceLocalConfig(legacyKey);
        return legacyMarker;
    }

    async initialise(): Promise<boolean> {
        if (this.disposed) return true;
        const setting = this.core.services.setting;
        const settings = setting.currentSettings();
        const acknowledgedVersion = this.readAcknowledgedVersion();
        const evaluation = evaluateCompatibilityPause({
            acknowledgedVersion,
            currentVersion: this.currentVersion,
            migrationState: setting.getSettingsMigrationState(),
            legacyReviewMessage: settings.versionUpFlash,
        });

        this.pause = evaluation.pause;
        if (evaluation.initialiseAcknowledgedVersion) {
            setting.setSmallConfig(DATABASE_COMPATIBILITY_VERSION_KEY, `${this.currentVersion}`);
            this._initialised = true;
            return true;
        }
        if (!this.pause) {
            this._initialised = true;
            return true;
        }

        if (settings.versionUpFlash === "") {
            settings.versionUpFlash = COMPATIBILITY_PAUSE_SETTING_MESSAGE;
            await setting.saveSettingData();
        }
        this._initialised = true;
        return true;
    }

    private async acknowledge(): Promise<void> {
        if (!this.pause?.resumable) return;
        const setting = this.core.services.setting;
        const settings = setting.currentSettings();
        const previousMessage = settings.versionUpFlash;
        settings.versionUpFlash = "";
        try {
            await setting.saveSettingData();
        } catch (error) {
            settings.versionUpFlash = previousMessage || COMPATIBILITY_PAUSE_SETTING_MESSAGE;
            throw error;
        }

        setting.setSmallConfig(DATABASE_COMPATIBILITY_VERSION_KEY, `${this.currentVersion}`);
        const legacyKey = legacyDatabaseCompatibilityVersionKey(this.core.services.vault.getVaultName());
        setting.deleteDeviceLocalConfig(legacyKey);
        this.pause = undefined;
        this.ui.clearReminder();
        await this.core.services.control.applySettings();
    }

    private async runReview(): Promise<void> {
        while (this.pause) {
            const action = await this.ui.showSummary(this.pause);
            if (action === "details") {
                const detailsAction = await this.ui.showDetails(this.pause);
                if (detailsAction === "back") continue;
                break;
            }
            if (action === "resume" && this.pause.resumable) {
                await this.acknowledge();
                return;
            }
            break;
        }
        if (this.pause && !this.disposed) {
            this.ui.showReminder(() => {
                fireAndForget(() => this.openReview());
            });
        }
    }

    openReview(): Promise<void> {
        if (this.disposed || !this.pause) return Promise.resolve();
        if (this.activeReview) return this.activeReview;
        this.ui.clearReminder();
        this.activeReview = this.runReview().finally(() => {
            this.activeReview = undefined;
        });
        return this.activeReview;
    }

    dispose(): void {
        this.disposed = true;
        this.pause = undefined;
        this.ui.clearReminder();
    }
}

export function useCompatibilityReview(core: LiveSyncCore, ui: CompatibilityReviewUi): CompatibilityReviewController {
    const controller = new CompatibilityReviewController(core, ui);
    core.services.appLifecycle.onSettingLoaded.addHandler(() => controller.initialise());
    core.services.appLifecycle.onLayoutReady.addHandler(() => {
        fireAndForget(() => controller.openReview());
        return Promise.resolve(true);
    }, COMPATIBILITY_REVIEW_LAYOUT_PRIORITY);
    core.services.appLifecycle.onUnload.addHandler(() => {
        controller.dispose();
        return Promise.resolve(true);
    });
    core.services.API.addCommand({
        id: "livesync-review-compatibility-pause",
        name: "Review why synchronisation is paused",
        checkCallback: (checking) => {
            if (!controller.pendingPause) return false;
            if (!checking) fireAndForget(() => controller.openReview());
            return true;
        },
    });
    return controller;
}
