import { eventHub } from "@/common/events.js";
import { translateLiveSyncMessage } from "@/common/translation.js";
import { ServiceContext, type StandardIo } from "@vrtmrz/livesync-commonlib/context.js";

/** Host capabilities owned by one Self-hosted LiveSync CLI composition. */
export class NodeServiceContext extends ServiceContext {
    constructor(
        readonly databasePath: string,
        readonly standardIo: StandardIo
    ) {
        super({ events: eventHub, translate: translateLiveSyncMessage });
    }
}
