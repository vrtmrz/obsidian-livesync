import { ObsidianLiveSyncSettingTab } from "./SettingDialogue/ObsidianLiveSyncSettingTab.ts";
import { type IObsidianModule, AbstractObsidianModule } from "../AbstractObsidianModule.ts";
// import { PouchDB } from "../../lib/src/pouchdb/pouchdb-browser";
import { EVENT_REQUEST_OPEN_SETTINGS, eventHub } from "../../common/events.ts";

export class ModuleObsidianSettingDialogue extends AbstractObsidianModule implements IObsidianModule {

    settingTab!: ObsidianLiveSyncSettingTab;

    $everyOnloadStart(): Promise<boolean> {
        this.settingTab = new ObsidianLiveSyncSettingTab(this.app, this.plugin);
        this.plugin.addSettingTab(this.settingTab);
        eventHub.onEvent(EVENT_REQUEST_OPEN_SETTINGS, () => this.openSetting());
        return Promise.resolve(true);
    }

    openSetting() {
        // Undocumented API
        //@ts-ignore
        this.app.setting.open();
        //@ts-ignore
        this.app.setting.openTabById("obsidian-livesync");
    }

    get appId() {
        return `${("appId" in this.app ? this.app.appId : "")}`;
    }


}