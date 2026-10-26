import { ObsidianLiveSyncSettingTab } from "./SettingDialogue/ObsidianLiveSyncSettingTab.ts";
import { AbstractObsidianModule } from "@/modules/AbstractObsidianModule.ts";
// import { PouchDB } from "../../lib/src/pouchdb/pouchdb-browser";
import { EVENT_REQUEST_OPEN_SETTINGS, eventHub } from "@/common/events.ts";
import type { LiveSyncCore } from "@/main.ts";
import { openObsidianSettings } from "@/common/obsidianSettings.ts";

export class ModuleObsidianSettingDialogue extends AbstractObsidianModule {
    settingTab!: ObsidianLiveSyncSettingTab;

    async _everyOnloadAfterLoadSettings(): Promise<boolean> {
        this.settingTab = new ObsidianLiveSyncSettingTab(this.app, this.plugin);
        await this.settingTab.loadSettings();
        this.plugin.addSettingTab(this.settingTab);
        eventHub.onEvent(EVENT_REQUEST_OPEN_SETTINGS, () => this.openSetting());

        return true;
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
