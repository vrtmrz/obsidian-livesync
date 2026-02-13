import { InjectableAPIService } from "@lib/services/implements/injectable/InjectableAPIService";
import { InjectableConflictService } from "@lib/services/implements/injectable/InjectableConflictService";
import { InjectableDatabaseEventService } from "@lib/services/implements/injectable/InjectableDatabaseEventService";
import { InjectableDatabaseService } from "@lib/services/implements/injectable/InjectableDatabaseService";
import { InjectableFileProcessingService } from "@lib/services/implements/injectable/InjectableFileProcessingService";
import { InjectableRemoteService } from "@lib/services/implements/injectable/InjectableRemoteService";
import { InjectableReplicationService } from "@lib/services/implements/injectable/InjectableReplicationService";
import { InjectableReplicatorService } from "@lib/services/implements/injectable/InjectableReplicatorService";
import { InjectableSettingService } from "@lib/services/implements/injectable/InjectableSettingService";
import { InjectableTestService } from "@lib/services/implements/injectable/InjectableTestService";
import { InjectableTweakValueService } from "@lib/services/implements/injectable/InjectableTweakValueService";
import { ConfigServiceBrowserCompat } from "@lib/services/implements/browser/ConfigServiceBrowserCompat";
import type { ObsidianServiceContext } from "@lib/services/implements/obsidian/ObsidianServiceContext.ts";
import { Platform } from "@/deps";
import type { SimpleStore } from "@/lib/src/common/utils";
import type { IDatabaseService } from "@/lib/src/services/base/IService";
import { handlers } from "@/lib/src/services/lib/HandlerUtils";
import { ObsHttpHandler } from "../essentialObsidian/APILib/ObsHttpHandler";
import type { Command, ViewCreator } from "obsidian";

// All Services will be migrated to be based on Plain Services, not Injectable Services.
// This is a migration step.

export class ObsidianAPIService extends InjectableAPIService<ObsidianServiceContext> {
    _customHandler: ObsHttpHandler | undefined;
    getCustomFetchHandler(): ObsHttpHandler {
        if (!this._customHandler) this._customHandler = new ObsHttpHandler(undefined, undefined);
        return this._customHandler;
    }

    async showWindow(viewType: string): Promise<void> {
        const leaves = this.app.workspace.getLeavesOfType(viewType);
        if (leaves.length == 0) {
            await this.app.workspace.getLeaf(true).setViewState({
                type: viewType,
                active: true,
            });
        } else {
            await leaves[0].setViewState({
                type: viewType,
                active: true,
            });
        }
        if (leaves.length > 0) {
            await this.app.workspace.revealLeaf(leaves[0]);
        }
    }

    private get app() {
        return this.context.app;
    }

    getPlatform(): string {
        if (Platform.isAndroidApp) {
            return "android-app";
        } else if (Platform.isIosApp) {
            return "ios";
        } else if (Platform.isMacOS) {
            return "macos";
        } else if (Platform.isMobileApp) {
            return "mobile-app";
        } else if (Platform.isMobile) {
            return "mobile";
        } else if (Platform.isSafari) {
            return "safari";
        } else if (Platform.isDesktop) {
            return "desktop";
        } else if (Platform.isDesktopApp) {
            return "desktop-app";
        } else {
            return "unknown-obsidian";
        }
    }
    override isMobile(): boolean {
        //@ts-ignore : internal API
        return this.app.isMobile;
    }
    override getAppID(): string {
        return `${"appId" in this.app ? this.app.appId : ""}`;
    }
    override getAppVersion(): string {
        const navigatorString = globalThis.navigator?.userAgent ?? "";
        const match = navigatorString.match(/obsidian\/([0-9]+\.[0-9]+\.[0-9]+)/);
        if (match && match.length >= 2) {
            return match[1];
        }
        return "0.0.0";
    }

    override getPluginVersion(): string {
        return this.context.plugin.manifest.version;
    }

    addCommand<TCommand extends Command>(command: TCommand): TCommand {
        return this.context.plugin.addCommand(command) as TCommand;
    }

    registerWindow(type: string, factory: ViewCreator): void {
        return this.context.plugin.registerView(type, factory);
    }
    addRibbonIcon(icon: string, title: string, callback: (evt: MouseEvent) => any): HTMLElement {
        return this.context.plugin.addRibbonIcon(icon, title, callback);
    }
    registerProtocolHandler(action: string, handler: (params: Record<string, string>) => any): void {
        return this.context.plugin.registerObsidianProtocolHandler(action, handler);
    }
}
export class ObsidianDatabaseService extends InjectableDatabaseService<ObsidianServiceContext> {
    openSimpleStore = handlers<IDatabaseService>().binder("openSimpleStore") as (<T>(
        kind: string
    ) => SimpleStore<T>) & { setHandler: (handler: IDatabaseService["openSimpleStore"], override?: boolean) => void };
}
export class ObsidianDatabaseEventService extends InjectableDatabaseEventService<ObsidianServiceContext> {}

// InjectableReplicatorService
export class ObsidianReplicatorService extends InjectableReplicatorService<ObsidianServiceContext> {}
// InjectableFileProcessingService
export class ObsidianFileProcessingService extends InjectableFileProcessingService<ObsidianServiceContext> {}
// InjectableReplicationService
export class ObsidianReplicationService extends InjectableReplicationService<ObsidianServiceContext> {}
// InjectableRemoteService
export class ObsidianRemoteService extends InjectableRemoteService<ObsidianServiceContext> {}
// InjectableConflictService
export class ObsidianConflictService extends InjectableConflictService<ObsidianServiceContext> {}
// InjectableSettingService
export class ObsidianSettingService extends InjectableSettingService<ObsidianServiceContext> {}
// InjectableTweakValueService
export class ObsidianTweakValueService extends InjectableTweakValueService<ObsidianServiceContext> {}
// InjectableTestService
export class ObsidianTestService extends InjectableTestService<ObsidianServiceContext> {}
export class ObsidianConfigService extends ConfigServiceBrowserCompat<ObsidianServiceContext> {}
