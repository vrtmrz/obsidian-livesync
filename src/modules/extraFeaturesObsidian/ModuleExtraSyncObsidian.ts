import type { LiveSyncCore } from "../../main.ts";
import { AbstractObsidianModule } from "../AbstractObsidianModule.ts";

export class ModuleExtraSyncObsidian extends AbstractObsidianModule {
    deviceAndVaultName: string = "";

    _getDeviceAndVaultName(): string {
        return this.deviceAndVaultName;
    }
    _setDeviceAndVaultName(name: string): void {
        this.deviceAndVaultName = name;
    }

    onBindFunction(core: LiveSyncCore, services: typeof core.services): void {
        services.setting.handleGetDeviceAndVaultName(this._getDeviceAndVaultName.bind(this));
        services.setting.handleSetDeviceAndVaultName(this._setDeviceAndVaultName.bind(this));
    }
}
