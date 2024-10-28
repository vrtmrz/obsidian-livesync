import { AbstractObsidianModule, type IObsidianModule } from "../AbstractObsidianModule.ts";
import { VIEW_TYPE_GLOBAL_HISTORY, GlobalHistoryView } from "./GlobalHistory/GlobalHistoryView.ts";


export class ModuleObsidianGlobalHistory extends AbstractObsidianModule implements IObsidianModule {

    $everyOnloadStart(): Promise<boolean> {

        this.addCommand({
            id: "livesync-global-history",
            name: "Show vault history",
            callback: () => {
                this.showGlobalHistory()
            }
        })

        this.registerView(
            VIEW_TYPE_GLOBAL_HISTORY,
            (leaf) => new GlobalHistoryView(leaf, this.plugin)
        );

        return Promise.resolve(true);
    }

    showGlobalHistory() {
        void this.core.$$showView(VIEW_TYPE_GLOBAL_HISTORY);
    }

}