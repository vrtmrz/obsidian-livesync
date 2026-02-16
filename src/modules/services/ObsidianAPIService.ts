import { InjectableAPIService } from "@/lib/src/services/implements/injectable/InjectableAPIService";
import type { ObsidianServiceContext } from "@/lib/src/services/implements/obsidian/ObsidianServiceContext";
import { Platform, type Command, type ViewCreator } from "obsidian";
import { ObsHttpHandler } from "../essentialObsidian/APILib/ObsHttpHandler";

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
