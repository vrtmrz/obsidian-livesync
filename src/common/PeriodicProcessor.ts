import { Logger } from "octagonal-wheels/common/logger";
import { fireAndForget } from "octagonal-wheels/promises";
import { eventHub, EVENT_PLUGIN_UNLOADED } from "./events";
import type { NecessaryServices } from "@lib/interfaces/ServiceModule";
type PeriodicProcessorHost = NecessaryServices<"API" | "control", never>;
export class PeriodicProcessor {
    _process: () => Promise<any>;
    _timer?: number = undefined;
    _core: PeriodicProcessorHost;
    constructor(core: PeriodicProcessorHost, process: () => Promise<any>) {
        // this._plugin = plugin;
        this._core = core;
        this._process = process;
        eventHub.onceEvent(EVENT_PLUGIN_UNLOADED, () => {
            this.disable();
        });
    }
    async process() {
        try {
            await this._process();
        } catch (ex) {
            Logger(ex);
        }
    }
    enable(interval: number) {
        this.disable();
        if (interval == 0) return;
        this._timer = this._core.services.API.setInterval(
            () =>
                fireAndForget(async () => {
                    await this.process();
                    if (this._core.services?.control?.hasUnloaded()) {
                        this.disable();
                    }
                }),
            interval
        );
    }
    disable() {
        if (this._timer !== undefined) {
            this._core.services.API.clearInterval(this._timer);
            this._timer = undefined;
        }
    }
}
