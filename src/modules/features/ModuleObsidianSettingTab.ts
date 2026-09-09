import { ObsidianLiveSyncSettingTab } from "./SettingDialogue/ObsidianLiveSyncSettingTab.ts";
import { AbstractObsidianModule } from "@/modules/AbstractObsidianModule.ts";
// import { PouchDB } from "../../lib/src/pouchdb/pouchdb-browser";
import { EVENT_REQUEST_OPEN_SETTINGS, eventHub } from "@/common/events.ts";
import type ObsidianLiveSyncPlugin from "@/main.ts";
import type { LiveSyncCore } from "@/main.ts";
import { openObsidianSettings } from "@/common/obsidianSettings.ts";
import type { HiddenFileSyncRepairView } from "@/features/HiddenFileSync/hiddenFileSyncViews.ts";

export type ModuleObsidianSettingDialogueDependencies = {
    getHiddenFileSyncRepair(): HiddenFileSyncRepairView | undefined;
};

export class ModuleObsidianSettingDialogue extends AbstractObsidianModule {
    private readonly dependencies: ModuleObsidianSettingDialogueDependencies;
    settingTab!: ObsidianLiveSyncSettingTab;

    constructor(
        plugin: ObsidianLiveSyncPlugin,
        core: LiveSyncCore,
        dependencies: Partial<ModuleObsidianSettingDialogueDependencies> = {}
    ) {
        super(plugin, core);
        this.dependencies = {
            getHiddenFileSyncRepair: dependencies.getHiddenFileSyncRepair ?? (() => undefined),
        };
    }

    _everyOnloadAfterLoadSettings(): Promise<boolean> {
        const hiddenFileSyncRepair = this.dependencies.getHiddenFileSyncRepair();
        this.settingTab = new ObsidianLiveSyncSettingTab(this.app, this.plugin, { hiddenFileSyncRepair });
        this.settingTab.reloadAllSettings(true);
        this.plugin.addSettingTab(this.settingTab);
        eventHub.onEvent(EVENT_REQUEST_OPEN_SETTINGS, () => this.openSetting());

        return Promise.resolve(true);
    }

    openSetting() {
        openObsidianSettings(this.app, "obsidian-livesync");
    }

    get appId() {
        return `${"appId" in this.app ? this.app.appId : ""}`;
    }
    override onBindFunction(core: LiveSyncCore, services: typeof core.services): void {
        services.appLifecycle.onSettingLoaded.addHandler(this._everyOnloadAfterLoadSettings.bind(this));
    }
}
