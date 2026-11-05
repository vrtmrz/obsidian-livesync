import { afterEach, describe, expect, it, vi } from "vitest";

const maintenanceHarness = vi.hoisted(() => ({
    createdSettings: [] as Array<{
        name: string;
        click?: () => Promise<void>;
        toggleKey?: string;
        onUpdate?: () => { visibility?: boolean };
    }>,
    logger: vi.fn(),
    notice: vi.fn(),
}));

vi.mock("@/common/events.ts", () => ({
    EVENT_REQUEST_PERFORM_GC_V3: "request-gc-v3",
    eventHub: { emitEvent: vi.fn() },
}));
vi.mock("@/common/translation", () => ({
    $msg: (message: string, replacements?: Record<string, unknown>) => {
        for (const [key, value] of Object.entries(replacements ?? {})) {
            message = message.split(String.fromCharCode(36) + "{" + key + "}").join(String(value));
        }
        return message;
    },
}));
vi.mock("@/deps.ts", () => ({
    Notice: class {
        constructor(message: string) {
            maintenanceHarness.notice(message);
        }
    },
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
vi.mock("@vrtmrz/livesync-commonlib/compat/replication/journal/LiveSyncJournalReplicator", () => {
    class LiveSyncJournalReplicator {}
    return {
        LiveSyncJournalReplicator,
        isLiveSyncJournalReplicator: (value: unknown) => value instanceof LiveSyncJournalReplicator,
    };
});
vi.mock("./LiveSyncSetting.ts", () => ({
    LiveSyncSetting: class {
        name = "";
        click?: () => Promise<void>;
        toggleKey?: string;
        onUpdate?: () => { visibility?: boolean };

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

        autoWireToggle(key: string) {
            this.toggleKey = key;
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

        addOnUpdate(onUpdate: () => { visibility?: boolean }) {
            this.onUpdate = onUpdate;
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

import { LiveSyncJournalReplicator } from "@vrtmrz/livesync-commonlib/compat/replication/journal/LiveSyncJournalReplicator";
import { paneMaintenance } from "./PaneMaintenance.ts";

afterEach(() => {
    maintenanceHarness.createdSettings.length = 0;
    maintenanceHarness.logger.mockClear();
    maintenanceHarness.notice.mockClear();
    vi.clearAllMocks();
});

type TestStoppedJournal = Readonly<{ key: string; stage: string }>;
type ConfirmationOptions = { title: string; defaultOption: "No" };
type AskYesNoDialog = (message: string, options: ConfirmationOptions) => Promise<"yes" | "no">;

function createJournalReplicator(stoppedJournal: TestStoppedJournal | undefined, result = true) {
    const getStoppedJournal = vi.fn(() => stoppedJournal);
    const skipStoppedJournalAndResume = vi.fn(async (_settings: unknown, _snapshot: unknown) => result);
    const replicator = Object.assign(new LiveSyncJournalReplicator({} as never), {
        getStoppedJournal,
        skipStoppedJournalAndResume,
    });
    return { replicator, getStoppedJournal, skipStoppedJournalAndResume };
}

function createSyncingPane(replicator: unknown, askYesNoDialog: AskYesNoDialog = async () => "no") {
    const settings = { databaseName: "test-database" };
    const onlyOnMinIO = vi.fn(() => ({ visibility: true }));
    const confirmation = vi.fn(askYesNoDialog);
    const host = {
        core: { replicator, settings, confirm: { askYesNoDialog: confirmation } },
        createEl: vi.fn(),
        getMinioJournalSyncClient: vi.fn(),
        onlyOnCouchDB: vi.fn(),
        onlyOnCouchDBOrMinIO: vi.fn(),
        onlyOnMinIO,
        services: { replication: { markLocked: vi.fn(), markUnlocked: vi.fn() } },
    };
    const addPanel = vi.fn((_parent: HTMLElement, heading: string) => ({
        then(callback: (paneEl: HTMLElement) => void) {
            if (heading === "Syncing") {
                callback({} as HTMLElement);
            }
            return Promise.resolve();
        },
    }));

    paneMaintenance.call(host as never, {} as HTMLElement, { addPanel } as never);

    const setting = maintenanceHarness.createdSettings.find(({ name }) => name === "Skip stopped Journal and resume");
    if (!setting?.click) {
        throw new Error("Skip stopped Journal action was not registered");
    }
    return { setting, click: setting.click, host, settings, askYesNoDialog: confirmation, onlyOnMinIO };
}

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
        expect(maintenanceHarness.logger).toHaveBeenCalledWith("Ui.Common.LocalDatabaseInitialisationFailed", "notice");
    });

    it("removes the broken journal toggle and preserves received history reset semantics", async () => {
        const checkpoint = {
            receivedFiles: new Set(["received-file"]),
            knownIDs: new Set(["known-id"]),
            sentIDs: new Set(["sent-id"]),
            sentFiles: new Set(["sent-file"]),
            lastLocalSeq: 23,
        };
        let updatedCheckpoint: typeof checkpoint | undefined;
        const updateCheckPointInfo = vi.fn(async (update: (info: typeof checkpoint) => typeof checkpoint) => {
            updatedCheckpoint = update(checkpoint);
        });
        const onlyOnMinIO = vi.fn(() => ({ visibility: true }));
        const addPanel = vi.fn((_parent: HTMLElement, heading: string) => ({
            then(callback: (paneEl: HTMLElement) => void) {
                if (heading === "Syncing") {
                    callback({} as HTMLElement);
                }
                return Promise.resolve();
            },
        }));
        const host = {
            core: { replicator: {}, storageAccess: {} },
            createEl: vi.fn(),
            getMinioJournalSyncClient: vi.fn(() => ({ updateCheckPointInfo })),
            onlyOnCouchDB: vi.fn(),
            onlyOnCouchDBOrMinIO: vi.fn(),
            onlyOnMinIO,
            services: { replication: { markLocked: vi.fn(), markUnlocked: vi.fn() } },
        };

        paneMaintenance.call(host as never, {} as HTMLElement, { addPanel } as never);

        expect(maintenanceHarness.createdSettings.some(({ toggleKey }) => toggleKey === "ignoreBrokenJournals")).toBe(
            false
        );
        const resetReceivedHistory = maintenanceHarness.createdSettings.find(
            ({ name }) => name === "Reset journal received history"
        );
        if (!resetReceivedHistory?.click) {
            throw new Error("Reset journal received history action was not registered");
        }
        await resetReceivedHistory.click();

        expect(updateCheckPointInfo).toHaveBeenCalledOnce();
        expect(updatedCheckpoint).toEqual({
            ...checkpoint,
            receivedFiles: new Set(),
            knownIDs: new Set(),
        });
        expect(maintenanceHarness.logger).toHaveBeenCalledWith("Journal received history has been cleared.", "notice");
    });

    it("asks the user to retry when there is no stopped Journal", async () => {
        const { replicator, getStoppedJournal, skipStoppedJournalAndResume } = createJournalReplicator(undefined);
        const rendered = createSyncingPane(replicator);

        expect(rendered.setting.onUpdate).toBe(rendered.onlyOnMinIO);
        await rendered.click();

        expect(getStoppedJournal).toHaveBeenCalledOnce();
        expect(rendered.askYesNoDialog).not.toHaveBeenCalled();
        expect(skipStoppedJournalAndResume).not.toHaveBeenCalled();
        expect(maintenanceHarness.logger).toHaveBeenCalledWith(
            "No stopped Journal is available. Retry replication to identify the stopped Journal.",
            "notice"
        );
        expect(maintenanceHarness.notice).not.toHaveBeenCalled();
    });

    it("does not skip the stopped Journal when confirmation is cancelled", async () => {
        const stoppedJournal = { key: "journal/one", stage: "save-records" } as const;
        const { replicator, skipStoppedJournalAndResume } = createJournalReplicator(stoppedJournal);
        const rendered = createSyncingPane(replicator);

        await rendered.click();

        expect(rendered.askYesNoDialog).toHaveBeenCalledOnce();
        const call = rendered.askYesNoDialog.mock.calls[0];
        if (!call) {
            throw new Error("Stopped Journal confirmation was not requested");
        }
        const [message, options] = call;
        expect(message).toContain(stoppedJournal.key);
        expect(message).toContain(stoppedJournal.stage);
        expect(options).toEqual({ title: "Skip stopped Journal and resume", defaultOption: "No" });
        expect(skipStoppedJournalAndResume).not.toHaveBeenCalled();
    });

    it("skips and resumes with the exact confirmed stopped Journal snapshot", async () => {
        const stoppedJournal = { key: "journal/one", stage: "save-records" } as const;
        const { replicator, skipStoppedJournalAndResume } = createJournalReplicator(stoppedJournal);
        const confirm = vi.fn(async () => "yes" as const);
        const rendered = createSyncingPane(replicator, confirm);

        await rendered.click();

        expect(skipStoppedJournalAndResume).toHaveBeenCalledOnce();
        expect(skipStoppedJournalAndResume.mock.calls[0]?.[0]).toBe(rendered.settings);
        expect(skipStoppedJournalAndResume.mock.calls[0]?.[1]).toBe(stoppedJournal);
    });

    it("does not skip after the active replicator changes during confirmation", async () => {
        const stoppedJournal = { key: "journal/one", stage: "save-records" } as const;
        const active = createJournalReplicator(stoppedJournal);
        const replacement = createJournalReplicator(stoppedJournal);
        const confirm = vi.fn(async () => "yes" as const);
        const rendered = createSyncingPane(active.replicator, confirm);
        confirm.mockImplementation(async () => {
            rendered.host.core.replicator = replacement.replicator;
            return "yes";
        });

        await rendered.click();

        expect(active.skipStoppedJournalAndResume).not.toHaveBeenCalled();
        expect(replacement.skipStoppedJournalAndResume).not.toHaveBeenCalled();
        expect(maintenanceHarness.logger).toHaveBeenCalledWith(
            "The active replicator changed. Retry replication to identify the stopped Journal.",
            "notice"
        );
        expect(maintenanceHarness.notice).not.toHaveBeenCalled();
    });

    it("reports when receipt does not complete after skip and resume", async () => {
        const stoppedJournal = { key: "journal/one", stage: "save-records" } as const;
        const { replicator, skipStoppedJournalAndResume } = createJournalReplicator(stoppedJournal, false);
        const rendered = createSyncingPane(replicator, async () => "yes");

        await rendered.click();

        expect(skipStoppedJournalAndResume).toHaveBeenCalledOnce();
        expect(maintenanceHarness.logger).toHaveBeenCalledWith(
            "Journal receipt did not complete after this action. Check the current failure before retrying.",
            "notice"
        );
        expect(maintenanceHarness.notice).not.toHaveBeenCalled();
    });
});
