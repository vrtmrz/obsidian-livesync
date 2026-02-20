import { AbstractObsidianModule } from "../AbstractObsidianModule.ts";
import { VIEW_TYPE_GLOBAL_HISTORY, GlobalHistoryView } from "./GlobalHistory/GlobalHistoryView.ts";

export class ModuleObsidianGlobalHistory extends AbstractObsidianModule {
    _everyOnloadStart(): Promise<boolean> {
        this.addCommand({
            id: "livesync-global-history",
            name: "Show vault history",
            callback: () => {
                this.showGlobalHistory();
            },
        });

        this.registerView(VIEW_TYPE_GLOBAL_HISTORY, (leaf) => new GlobalHistoryView(leaf, this.plugin));

        return Promise.resolve(true);
    }

    showGlobalHistory() {
        void this.services.API.showWindow(VIEW_TYPE_GLOBAL_HISTORY);
    }
    override onBindFunction(core: typeof this.core, services: typeof core.services): void {
        services.appLifecycle.onInitialise.addHandler(this._everyOnloadStart.bind(this));
    }
}
