import { eventHub } from "@/common/events";
import { translateLiveSyncMessage } from "@/common/translation";
import { ServiceContext } from "@vrtmrz/livesync-commonlib/context";

/** Host capabilities owned by one Self-hosted LiveSync CLI composition. */
export class NodeServiceContext extends ServiceContext {
    constructor(readonly databasePath: string) {
        super({ events: eventHub, translate: translateLiveSyncMessage });
    }
}
