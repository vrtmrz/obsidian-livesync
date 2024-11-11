import { AbstractObsidianModule, type IObsidianModule } from '../AbstractObsidianModule.ts';

export class ModuleExtraSyncObsidian extends AbstractObsidianModule implements IObsidianModule {
    deviceAndVaultName: string = "";

    $$getDeviceAndVaultName(): string {
        return this.deviceAndVaultName;
    }
    $$setDeviceAndVaultName(name: string): void {
        this.deviceAndVaultName = name;
    }

}