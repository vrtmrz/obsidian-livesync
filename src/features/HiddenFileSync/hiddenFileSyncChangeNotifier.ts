import type { FilePath, ObsidianLiveSyncSettings } from "@vrtmrz/livesync-commonlib/compat/common/types";

const HIDDEN_FILE_NOTIFICATION_TASK = "notify-config-change";
const HIDDEN_FILE_NOTIFICATION_DELAY_MS = 1000;

export type HiddenFileSyncChangeNotifierSettings = Pick<ObsidianLiveSyncSettings, "suppressNotifyHiddenFilesChange">;

export type HiddenFileSyncChangeNotifierTaskScheduler = (
    key: string,
    timeout: number,
    operation: () => Promise<unknown> | void
) => void;

export type HiddenFileSyncChangeNotifierDependencies = {
    getSettings(): HiddenFileSyncChangeNotifierSettings;
    getConfigDir(): string;
    scheduleTask: HiddenFileSyncChangeNotifierTaskScheduler;
    cancelTask(key: string): void;
    showConfigurationChangeNotice(updatedFolders: readonly string[]): void;
    hideConfigurationChangeNotice(): void;
};

export type HiddenFileSyncChangeNotifier = {
    queueNotification(path: FilePath): void;
    /** Compatibility seam used by the real-Obsidian Hidden File Sync fixture. */
    showConfigurationChangeNotice(updatedFolders: readonly string[]): void;
    dispose(): void;
};

class HiddenFileSyncChangeNotifierOwner implements HiddenFileSyncChangeNotifier {
    private readonly queuedNotificationFiles = new Set<string>();
    private disposed = false;

    constructor(private readonly dependencies: HiddenFileSyncChangeNotifierDependencies) {}

    queueNotification(path: FilePath): void {
        if (this.disposed) return;
        if (this.dependencies.getSettings().suppressNotifyHiddenFilesChange) return;

        const configDir = this.dependencies.getConfigDir();
        if (!path.startsWith(configDir)) return;

        const folder = path.split("/").slice(0, -1).join("/");
        this.queuedNotificationFiles.add(folder);
        this.dependencies.scheduleTask(HIDDEN_FILE_NOTIFICATION_TASK, HIDDEN_FILE_NOTIFICATION_DELAY_MS, () => {
            this.flush();
        });
    }

    showConfigurationChangeNotice(updatedFolders: readonly string[]): void {
        this.queuedNotificationFiles.clear();
        for (const folder of updatedFolders) {
            this.queuedNotificationFiles.add(folder);
        }
        this.flush();
    }

    dispose(): void {
        if (this.disposed) return;
        this.disposed = true;
        this.queuedNotificationFiles.clear();
        this.dependencies.cancelTask(HIDDEN_FILE_NOTIFICATION_TASK);
        this.dependencies.hideConfigurationChangeNotice();
    }

    private flush(): void {
        const updatedFolders = [...this.queuedNotificationFiles];
        this.queuedNotificationFiles.clear();
        if (this.disposed) return;
        this.dependencies.showConfigurationChangeNotice(updatedFolders);
    }
}

export function createHiddenFileSyncChangeNotifier(
    dependencies: HiddenFileSyncChangeNotifierDependencies
): HiddenFileSyncChangeNotifier {
    return new HiddenFileSyncChangeNotifierOwner(dependencies);
}
