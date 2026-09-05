import type { LiveSyncCore } from "@/main.ts";
// import { __$checkInstanceBinding } from "@vrtmrz/livesync-commonlib/compat/dev/checks";
import { LiveSyncContext } from "./LiveSyncContext.ts";

export abstract class LiveSyncCommands extends LiveSyncContext {
    constructor(core: LiveSyncCore) {
        super(core);
        this.onBindFunction(this.core, this.core.services);
        // __$checkInstanceBinding(this);
    }
    abstract onunload(): void;
    abstract onload(): void | Promise<void>;

    onBindFunction(core: LiveSyncCore, services: typeof core.services) {
        // Override if needed.
    }
}
