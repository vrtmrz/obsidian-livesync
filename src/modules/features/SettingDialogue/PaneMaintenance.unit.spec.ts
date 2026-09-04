import { afterEach, describe, expect, it, vi } from "vitest";

const maintenanceHarness = vi.hoisted(() => ({
    createdSettings: [] as Array<{ name: string; click?: () => Promise<void> }>,
    logger: vi.fn(),
}));

vi.mock("@/common/events.ts", () => ({
    EVENT_REQUEST_PERFORM_GC_V3: "request-gc-v3",
    eventHub: { emitEvent: vi.fn() },
}));
vi.mock("@/common/translation", () => ({
    $msg: (message: string) => message,
}));
vi.mock("@/serviceFeatures/setupObsidian/settingsReset.ts", () => ({
    createCoreSettingsAfterFullReset: vi.fn(),
    createEditingSettingsAfterFullReset: vi.fn(),
}));
vi.mock("@vrtmrz/livesync-commonlib/compat/common/logger", () => ({
    LOG_LEVEL_NOTICE: "notice",
    Logger: maintenanceHarness.logger,
}));
vi.mock("@vrtmrz/livesync-commonlib/compat/common/types", () => ({
    FlagFilesHumanReadable: {
        FETCH_ALL: "fetch-all",
        REBUILD_ALL: "rebuild-all",
    },
    FlagFilesOriginal: { SUSPEND_ALL: "suspend-all" },
}));
vi.mock("@vrtmrz/livesync-commonlib/compat/common/utils", () => ({
    fireAndForget: (operation: Promise<unknown>) => operation,
}));
vi.mock("@vrtmrz/livesync-commonlib/compat/replication/couchdb/LiveSyncReplicator", () => ({
    LiveSyncCouchDBReplicator: class {},
}));
vi.mock("./LiveSyncSetting.ts", () => ({
    LiveSyncSetting: class {
        name = "";
        click?: () => Promise<void>;

        constructor() {
            maintenanceHarness.createdSettings.push(this);
        }

        setName(name: string) {
            this.name = name;
            return this;
        }

        setDesc() {
            return this;
        }

        addButton(callback: (button: this) => void) {
            callback(this);
            return this;
        }

        setButtonText() {
            return this;
        }

        setDisabled() {
            return this;
        }

        setCta() {
            return this;
        }

        onClick(callback: () => Promise<void>) {
            this.click = callback;
            return this;
        }

        addOnUpdate() {
            return this;
        }
    },
}));
vi.mock("./SettingPane", () => ({
    visibleOnly: vi.fn(() => vi.fn()),
}));
vi.mock("./settingComponentStyles.ts", () => ({
    setButtonDestructiveState: <T>(button: T) => button,
}));

import { paneMaintenance } from "./PaneMaintenance.ts";

afterEach(() => {
    maintenanceHarness.createdSettings.length = 0;
    maintenanceHarness.logger.mockClear();
    vi.clearAllMocks();
});

describe("paneMaintenance", () => {
    it("does not announce success when the remote wipe reports failure", async () => {
        const updateCheckPointInfo = vi.fn(async () => undefined);
        const resetRemoteBucket = vi.fn(async () => false);
        const addPanel = vi.fn((_parent: HTMLElement, heading: string) => ({
            then(callback: (paneEl: HTMLElement) => void) {
                if (heading === "Rebuilding Operations (Remote Only)") {
                    callback({} as HTMLElement);
                }
                return Promise.resolve();
            },
        }));
        const host = {
            core: {
                replicator: {},
                storageAccess: {},
            },
            createEl: vi.fn(),
            getMinioJournalSyncClient: vi.fn(() => ({ updateCheckPointInfo })),
            onlyOnCouchDB: vi.fn(),
            onlyOnCouchDBOrMinIO: vi.fn(),
            onlyOnMinIO: vi.fn(),
            resetRemoteBucket,
            services: {
                appLifecycle: { performRestart: vi.fn() },
                database: { resetDatabase: vi.fn() },
                databaseEvents: { initialiseDatabase: vi.fn() },
                replication: { markLocked: vi.fn(), markUnlocked: vi.fn() },
                setting: { saveSettingData: vi.fn() },
            },
        };

        paneMaintenance.call(host as never, {} as HTMLElement, { addPanel } as never);
        const freshStartWipe = maintenanceHarness.createdSettings.find(({ name }) => name === "Fresh Start Wipe");
        if (!freshStartWipe?.click) {
            throw new Error("Fresh Start Wipe action was not registered");
        }

        await freshStartWipe.click();

        expect(resetRemoteBucket).toHaveBeenCalledOnce();
        expect(maintenanceHarness.logger).toHaveBeenCalledWith(
            "Fresh Start Wipe did not complete. Keep all synchronising devices stopped and run it again.",
            "notice"
        );
        expect(maintenanceHarness.logger).not.toHaveBeenCalledWith("Deleted all data on remote server", "notice");
    });

    it("reports when database initialisation after a local reset does not complete", async () => {
        const resetDatabase = vi.fn(async () => undefined);
        const initialiseDatabase = vi.fn(async () => false);
        const addPanel = vi.fn((_parent: HTMLElement, heading: string) => ({
            then(callback: (paneEl: HTMLElement) => void) {
                if (heading === "Reset") {
                    callback({} as HTMLElement);
                }
                return Promise.resolve();
            },
        }));
        const host = {
            core: {},
            createEl: vi.fn(),
            editingSettings: {},
            isConfiguredAs: vi.fn(),
            onlyOnCouchDB: vi.fn(),
            onlyOnCouchDBOrMinIO: vi.fn(),
            onlyOnMinIO: vi.fn(),
            services: {
                appLifecycle: { askRestart: vi.fn() },
                database: { resetDatabase },
                databaseEvents: { initialiseDatabase },
                setting: { saveSettingData: vi.fn() },
            },
        };

        paneMaintenance.call(host as never, {} as HTMLElement, { addPanel } as never);
        const deleteLocalDatabase = maintenanceHarness.createdSettings.find(
            ({ name }) => name === "Delete local database to reset or uninstall Self-hosted LiveSync"
        );
        if (!deleteLocalDatabase?.click) {
            throw new Error("Delete local database action was not registered");
        }

        await deleteLocalDatabase.click();

        expect(resetDatabase).toHaveBeenCalledOnce();
        expect(initialiseDatabase).toHaveBeenCalledOnce();
        expect(maintenanceHarness.logger).toHaveBeenCalledWith(
            "Ui.Common.LocalDatabaseInitialisationFailed",
            "notice"
        );
    });
});
